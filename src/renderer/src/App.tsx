import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ANALYSIS_MODES,
  MODE_META,
  type AnalysisMode,
  Diagnosis,
  LlmSettings,
  Objection,
  PragmaRule,
  ProgressEvent,
  UsageRecord,
  UsageSummary,
} from '@shared/types';
import { DEFAULT_THEORY, THEORIES, THEORY_BY_ID, type TheoryId } from '@shared/theories';
import { DiagnosisView } from './components/Diagnosis';
import { TheoryBrief } from './components/TheoryBrief';
import { TheoryBaseDialog } from './components/TheoryBase';
import { PromptView } from './components/PromptView';
import { Settings } from './components/Settings';
import { PlainCtx, GlossaryDialog } from './components/Term';
import { DisputeDialog } from './components/Disputes';
import { ObjectionCtx } from './components/Objection';
import { UsageChip, UsagePanel } from './components/Usage';
import { SegmentBar } from './components/SegmentBar';
import { RevisionBar } from './components/Revision';
import { HistoryPanel } from './components/History';
import { formatMoney, formatTokens } from '@shared/tokens';
import { disputesIn } from '@shared/disputes';
import type { Segment } from '@shared/segment';
import { diffRevision } from '@shared/compare';

type Tab = 'analyze' | 'prompt';

/** 一次分析调用的返回形状。推断出来而不是手写，免得 preload 改了这里不跟。 */
type RunResult = Awaited<ReturnType<typeof window.api.analysis.run>>;

const SAMPLE = `我们学校去年取消了早读，今年高考一本率下降了 6 个百分点。这说明取消早读是错的。
王校长在一份公开材料里说，早读能提高记忆效率，学生就该早起读书。
很多家长也支持恢复早读，可见早读肯定有益。
另外，如果连早读都保证不了，将来上课、自习、考试还能保证什么？`;

export default function App() {
  const [tab, setTab] = useState<Tab>('analyze');
  const [theory, setTheory] = useState<TheoryId>(DEFAULT_THEORY);
  const [passage, setPassage] = useState('');
  /**
   * 长文切分。`whole` 是切分前的完整原文——没有它，「恢复全文」就无从恢复。
   * 用户一旦在输入框里手动改动，说明他不想要原来那篇了，快照随即作废。
   */
  const [whole, setWhole] = useState<string | null>(null);
  const [pickedIndex, setPickedIndex] = useState<number | null>(null);
  /** 五种问法。给不给档位、给不给名字，都由 MODE_META 的两个开关决定——它是唯一的定义处。 */
  const [mode, setMode] = useState<AnalysisMode>('diagnose');
  const [diag, setDiag] = useState<Diagnosis | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * 一条「事情没成，但结果照给你」的提示。
   *
   * 和 error 分开是因为这两件事不能混：error 意味着这次分析没有结果，
   * notice 意味着结果有了，只是另外一件事没做成（异议没记上、报告没存进历史）。
   * 混在一起显示，用户会以为报告是坏的——而报告是好的。
   */
  const [notice, setNotice] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [onboard, setOnboard] = useState(false);
  const [hasKey, setHasKey] = useState(true);
  /** 默认开：第一次打开这个软件的人，正是最需要「人话」的那个人。 */
  const [plain, setPlain] = useState(() => localStorage.getItem('al:plain') !== '0');
  const [glossOpen, setGlossOpen] = useState(false);
  /** 争议地图。和术语表分开：术语表解释词，这张图解释「谁不同意谁」。 */
  const [dispOpen, setDispOpen] = useState(false);
  /**
   * 理论主张库。三层的最后一层：
   * 术语表解释「这个词什么意思」→ 理论卡解释「这副透镜凭什么」→ 这里解释
   * 「那一条主张本身有多硬」。`focusClaim` 是从侧栏点进来的那一条。
   */
  const [theoryOpen, setTheoryOpen] = useState(false);
  const [focusClaim, setFocusClaim] = useState<string | undefined>(undefined);
  /** 十规则。语用辩证透镜的检查项逐条由它生成，所以它也算理论基座的一部分。 */
  const [pragmaRules, setPragmaRules] = useState<PragmaRule[]>([]);
  /** 用量账本的快照。null 表示还没读到（首帧不显示芯片，避免闪一个 0）。 */
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);
  /** 刚跑完那一次的账。报告顶部要显示「这一份花了多少」。 */
  const [lastUsage, setLastUsage] = useState<UsageRecord | null>(null);
  /**
   * 用户对某几条判定的不同意见。一次全取，按 diagId 过滤——
   * 量级是几十条，分两次取反而容易旧。
   */
  const [objections, setObjections] = useState<Objection[]>([]);
  /** 历史面板。这里同时放异议统计——两者都是「跨会话才看得出的东西」。 */
  const [histOpen, setHistOpen] = useState(false);
  /**
   * 上一版报告。只有当前这份带 parentId 时才去取一次。
   * 存在这里而不是算出来，是因为取它是异步的，而对照条要等它到了才出现。
   */
  const [parent, setParent] = useState<Diagnosis | null>(null);
  /**
   * 待对照的上一版。点了「把这一版填回输入框」之后才有值。
   * 它与 run(override) 里的 parentId 是同一件事的两条来路：
   * 一条来自明确的重跑调用，一条来自用户接下来自己按的那次「分析」。
   */
  const [pendingParent, setPendingParent] = useState<string | null>(null);
  const abortRef = useRef(false);

  const profile = THEORY_BY_ID[theory];

  const refreshUsage = useCallback(() => {
    window.api.usage
      .summary()
      .then(setUsage)
      .catch(() => setUsage(null));
  }, []);

  useEffect(() => {
    window.api.settings
      .get()
      .then((s) => {
        setHasKey(s.hasKey);
        // 首次启动没有 Key：不弹个框讲清楚，用户装完只会看到一个点不动的「分析」
        if (!s.hasKey && !localStorage.getItem('al:onboarded')) setOnboard(true);
      })
      .catch(() => setHasKey(false));
    refreshUsage();
    /*
     * 十规则是静态知识，只需要取一次。取不到也不报错——那一节在主张库里
     * 是可选的补充，缺了不影响其它内容。这是「可有可无的功能不许挡住必需的」。
     */
    window.api.kb
      .pragmaRules()
      .then(setPragmaRules)
      .catch(() => setPragmaRules([]));
    window.api.objections
      .list()
      .then(setObjections)
      .catch(() => setObjections([]));
    return window.api.analysis.onProgress((e) => setProgress(e));
  }, [refreshUsage]);

  const togglePlain = () => {
    setPlain((v) => {
      localStorage.setItem('al:plain', v ? '0' : '1');
      return !v;
    });
  };

  const pickSegment = useCallback(
    (s: Segment) => {
      setWhole((w) => w ?? passage);
      setPassage(s.text);
      setPickedIndex(s.index);
    },
    [passage]
  );

  const restoreWhole = useCallback(() => {
    if (whole) setPassage(whole);
    setWhole(null);
    setPickedIndex(null);
  }, [whole]);

  /**
   * 跑一次分析。
   *
   * override 有两种用法：修补版重跑（带 parentId，跑完要对照），
   * 以及历史面板里「重新分析这一版」。不传就用输入框里的文本。
   */
  const run = useCallback(
    async (override?: { text: string; parentId: string | null }) => {
      const text = (override?.text ?? passage).trim();
      if (!text || loading) return;
      if (!hasKey) {
        setOnboard(true);
        return;
      }
      abortRef.current = false;
      setLoading(true);
      setError(null);
      setNotice(null);
      setDiag(null);
      setProgress({ stage: 'scope', label: '准备', percent: 4 });

      /* 切分过的段落照样能跑：切分只是帮人选一段，不是改写文本。 */
      /*
       * IPC 调用本身也要兜住。
       *
       * 主进程里的 try/catch 只盖住 runAnalysis 抛的错；通道名写错、主进程崩溃、
       * 返回值无法序列化，这几种会直接 reject 到渲染层。不接住它们，
       * `loading` 就永远停在 true——按钮点不动、进度条卡住，
       * 用户唯一能得出的结论是「软件死了」，而那恰恰是最难报的一个 bug。
       */
      const res = await window.api.analysis.run(
        text,
        theory,
        mode,
        override?.parentId ?? pendingParent ?? null
      ).catch(
        (err: Error): RunResult => ({
          ok: false,
          error: { code: 'IPC_FAILED', message: `与主进程通信失败：${err?.message ?? '原因不明'}` },
        })
      );
      // 用掉就清掉：下一次分析默认是新的一份，不该莫名其妙接着上一次比
      setPendingParent(null);

      // 无论成败都刷一次：失败也计费，成功更要知道花了多少
      refreshUsage();
      /*
       * 先复位 loading，再判断要不要丢掉结果。
       *
       * 原来的顺序反了：`if (abortRef.current) return;` 在 `setLoading(false)` 之前，
       * 一旦真的放弃，进度条会永远停在那个百分比、按钮永远是禁用——
       * 而「放弃」本来就该意味着界面回到可操作状态。这条分支以前从不成立
       * （没人把 abortRef 置 true），所以顺序错着也看不出来。
       */
      setLoading(false);
      setProgress(null);
      if (abortRef.current) return;

      if (res.ok && res.data) {
        setDiag(res.data);
        setLastUsage(res.usage ?? null);
        /*
         * 存档没写进去要明说。
         *
         * 结果照常显示（这一次的钱已经花了），但这份从此不在历史里：
         * 下次想拿它当「上一版」做修订对照时，找不到它。
         * 不说，用户会在那个时刻才发现，而那时他不知道原因，只会以为软件丢了东西。
         */
        if (res.saved === false) {
          setNotice(
            `这一份没能存进历史（${res.saveError ?? '原因不明'}）。报告照常显示，但它不会出现在历史里，也无法作为下一版的对照对象。`
          );
        }
      } else {
        setError(res.error?.message ?? '分析失败，原因不明。');
      }
    },
    [passage, theory, mode, loading, hasKey, refreshUsage, pendingParent]
  );

  /** 换透镜不自动重跑：跑一次要花钱和时间，而且旧结果仍有对照价值。 */
  const switchTheory = (id: TheoryId) => setTheory(id);

  const stale = useMemo(() => !!diag && diag.theory !== theory, [diag, theory]);
  /** 这一份碰到了几处理论争议。没分析时是 0，芯片不显示数字。 */
  const disputes = useMemo(() => (diag ? disputesIn(diag) : []), [diag]);

  /**
   * 异议上下文。挂在报告外层，让每一处判定自己决定要不要出现「不同意」。
   * 不用 props 逐层传：检查表一行一个，穿四层会把这条链变成参数管道。
   */
  const objCtx = useMemo(
    () =>
      diag
        ? {
            diagId: diag.id,
            theory: diag.theory,
            list: objections,
            add: (v: {
              field: Objection['field'];
              refId: string;
              refLabel: string;
              excerpt: string;
              reason: string;
            }) => {
              window.api.objections
                .add({ diagId: diag.id, theory: diag.theory, ...v })
                .then((r) => {
                  if (r.ok) setObjections(r.list);
                  // 记不上去必须说出来：按钮弹回原样，用户只会以为自己没点中
                  else setNotice(`这条不同意见没记上：${r.error ?? '写入失败'}。可以看看磁盘是不是只读或满了。`);
                })
                .catch((err: Error) => setNotice(`这条不同意见没记上：${err?.message ?? '与主进程通信失败'}`));
            },
            remove: (key: string) => {
              window.api.objections
                .remove(diag.id, key)
                .then((r) => {
                  if (r.ok) setObjections(r.list);
                  else setNotice(`撤销没生效：${r.error ?? '写入失败'}。文件里的那条还在。`);
                })
                .catch((err: Error) => setNotice(`撤销没生效：${err?.message ?? '与主进程通信失败'}`));
            },
          }
        : null,
    [diag, objections]
  );

  /*
   * 上一版报告只在这一份确实是修订版时才取。
   * 不取就显示不出对照条——而对照条正是「补完再判一次」的全部意义所在。
   */
  useEffect(() => {
    if (!diag?.parentId) {
      setParent(null);
      return;
    }
    let alive = true;
    window.api.archive
      .get(diag.parentId)
      .then((p) => {
        if (alive) setParent(p ?? null);
      })
      .catch(() => alive && setParent(null));
    return () => {
      alive = false;
    };
  }, [diag?.parentId, diag?.id]);

  /** 与上一版的对照。两份都在时才算得出来。 */
  const revision = useMemo(() => (diag && parent ? diffRevision(parent, diag) : null), [diag, parent]);

  /**
   * 从历史里打开一份。
   * 同时把原文、透镜、模式一起换回去——只看报告不换原文，点「再判一次」判的就是另一段话了。
   * 花费不清空也不补：存档里没有那一条，凭印象写一个数字比留空更糟。
   */
  const openReport = useCallback((id: string) => {
    /*
     * 放弃正在进行的那一次。
     *
     * 用户在看某份旧报告时，如果刚才那次分析稍后返回，它会把这份覆盖成
     * 另一段话的结果——屏幕上换了内容，却没有任何提示，用户会以为
     * 自己点开的就是刚跑出来的那份。`abortRef` 存在的唯一理由就是这个场景；
     * 不在这里置位，它就是一个永远为 false 的摆设。
     */
    abortRef.current = true;
    setLoading(false);
    setProgress(null);
    window.api.archive
      .get(id)
      .then((d) => {
        if (!d) return;
        setDiag(d);
        setTheory(d.theory);
        setPassage(d.passage);
        setMode(d.mode);
        setLastUsage(null);
        setError(null);
        setWhole(null);
        setPickedIndex(null);
        setHistOpen(false);
      })
      /*
       * 读不出来要说出来。以前这里接住异常却什么都不做：
       * 点在历史里的一份报告上、屏幕毫无变化，用户只能以为自己没点中。
       * 常见原因就是文件被手动删了或写坏了一半。
       */
      .catch(() => setNotice('这份报告读不出来（文件可能被手动删掉或写坏了一半）。列表里那一行可以先移除。'));
  }, []);

  /**
   * 把修补版填回输入框。
   *
   * 填的是「原文 + 补上的那句前提」，不是修补后那一栏——后者是「P1… P2… ∴ C」
   * 这种重构记号，不是成段的话。用记号去分析，分析的就是一句格式，不是论证。
   *
   * 这里只填不跑。跑一次要花钱，而你要先看清楚即将被分析的那段话是什么；
   * 填回去之后还可以自己改，改完按「分析」——那时才花这一笔。
   */
  const loadRepair = useCallback(() => {
    if (!diag) return;
    const add = diag.repair.missingPremise?.trim();
    const text = add ? `${diag.passage.trim()}\n${add}` : diag.passage.trim();
    setPassage(text);
    setWhole(null);
    setPickedIndex(null);
    // 透镜与模式跟着上一版走：换一副透镜再比，比出来的是两个不可换算的刻度
    setTheory(diag.theory);
    setMode(diag.mode);
    setPendingParent(diag.id);
  }, [diag]);

  return (
    <PlainCtx.Provider value={plain}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            论证镜<small>ARGUMENT LENS</small>
          </div>
          <nav className="tabs">
            <button className={`tab ${tab === 'analyze' ? 'on' : ''}`} onClick={() => setTab('analyze')}>
              分析
            </button>
            <button className={`tab ${tab === 'prompt' ? 'on' : ''}`} onClick={() => setTab('prompt')}>
              提示词
            </button>
          </nav>
          <div className="spacer" />
          <UsageChip summary={usage} onClick={() => setUsageOpen(true)} />
          <button
            className={`plain-toggle ${plain ? 'on' : ''}`}
            onClick={togglePlain}
            title={plain ? '关掉：只留术语，界面更紧' : '打开：每一栏都补一句人话'}
          >
            <i />
            大白话
          </button>
          {/* 顶栏按钮带 data-panel：截图脚本要按名字点它，不能靠第几个 button 猜 */}
          <button className="ghost-btn" data-panel="glossary" onClick={() => setGlossOpen(true)}>
            术语表
          </button>
          <button
            className="ghost-btn"
            data-panel="theory"
            onClick={() => {
              setFocusClaim(undefined);
              setTheoryOpen(true);
            }}
            title="这份分析依据的每一条主张，以及它有多硬"
          >
            理论
          </button>
          <button
            className="ghost-btn dp-open"
            data-panel="disputes"
            onClick={() => setDispOpen(true)}
            title="这份判断里，学界两派分歧的地方"
          >
            争议
            {disputes.length > 0 && <span className="dp-open-n">{disputes.length}</span>}
          </button>
          <button
            className="ghost-btn"
            data-panel="history"
            onClick={() => setHistOpen(true)}
            title="跑过的报告，以及你不认同过的判定"
          >
            历史
          </button>
          {!hasKey && (
            <button className="hint warn" onClick={() => setSettingsOpen(true)}>
              未接模型，点此配置
            </button>
          )}
          <button className="ghost-btn" onClick={() => setSettingsOpen(true)}>
            设置
          </button>
        </header>

        <div className="lens-bar">
          {THEORIES.map((t) => (
            <button
              key={t.id}
              className={`lens-chip ${t.id === theory ? 'on' : ''}`}
              onClick={() => switchTheory(t.id)}
              title={`${t.name}\n\n${t.plainClaim}\n\n什么时候别用：${t.failsWhen[0]}`}
            >
              <span className="n">{t.name}</span>
              <span className="u">{plain ? t.plainUnit : t.unit}</span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="progress">
            <i style={{ width: `${progress?.percent ?? 6}%` }} />
          </div>
        ) : (
          <div className="progress" />
        )}

        {tab === 'prompt' ? (
          <PromptView theory={theory} mode={mode} />
        ) : (
          <div className="body">
            <aside className="side">
              <div className="composer">
                <div className="side-head" style={{ padding: 0, border: 'none' }}>
                  <div className="side-title">原文</div>
                </div>
                <textarea
                  value={passage}
                  onChange={(e) => {
                    setPassage(e.target.value);
                    // 手动改动即放弃切分：留着「恢复全文」反而会覆盖他刚写的东西
                    if (whole) setWhole(null);
                    if (pickedIndex !== null) setPickedIndex(null);
                  }}
                  placeholder="粘贴一段真实的话：社论、评论区争论、广告文案、论文段落、面试说辞、公开信……"
                  spellCheck={false}
                />
                {/*
                  待对照提示。放在输入框下面：它解释的是「下次按分析会发生什么」，
                  不写清楚的话，那份并排对照会显得像凭空冒出来的。
                */}
                {pendingParent && (
                  <div className="pend-bar">
                    <span className="pend-k">下一份是修订版</span>
                    <span className="pend-note">
                      按下「分析」后，这份会与上一版并排对照。先改也没关系——改太多对照条会直说「这更像两次独立分析」。
                    </span>
                    <button className="pend-x" onClick={() => setPendingParent(null)}>
                      不比了
                    </button>
                  </div>
                )}
                <SegmentBar
                  text={passage}
                  pickedIndex={pickedIndex}
                  wholeChars={whole?.length ?? 0}
                  onPick={pickSegment}
                  onRestore={restoreWhole}
                  disabled={loading}
                />
                {/*
                  模式切换。放在输入区而不是顶栏：它改的是「这一次问什么」，
                  跟原文贴在一起才看得出它作用在这段话上。
                */}
                <div className="mode-bar">
                  {ANALYSIS_MODES.map((m) => (
                    <button
                      key={m}
                      className={`mode-chip ${mode === m ? 'on' : ''}`}
                      data-mode={m}
                      /*
                       * 这个模式允不允许给谬误名，由 MODE_META 一处定义，挂在按钮上给冒烟测试读。
                       *
                       * 为什么不写进脚本：脚本里抄一份模式名单，加模式时必然漏改，
                       * 而漏改的表现是那一条断言**静默不跑**——输出里既不通过也不失败。
                       * 挂在 DOM 上，脚本问的是应用自己，而不是自己记忆里的应用。
                       */
                      data-labels={MODE_META[m].allowsLabels ? '1' : '0'}
                      onClick={() => setMode(m)}
                      title={MODE_META[m].hint}
                      disabled={loading}
                    >
                      {MODE_META[m].label}
                    </button>
                  ))}
                  <span className="mode-note">{MODE_META[mode].hint}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="count">{passage.length} 字</span>
                  <div className="spacer" />
                  <button
                    className="ghost-btn"
                    onClick={() => {
                      setPassage(SAMPLE);
                      setWhole(null);
                      setPickedIndex(null);
                    }}
                    disabled={loading}
                  >
                    填入示例
                  </button>
                  <button
                    className="primary"
                    onClick={() => run()}
                    disabled={loading || !passage.trim()}
                  >
                    {loading ? progress?.label ?? '分析中…' : MODE_META[mode].action}
                  </button>
                </div>
                <p className="hint">
                  {/* 模式条下面那行 mode-note 已经显示过 MODE_META[mode].hint，
                      这里再重复一遍，同一句话会在 50px 内出现两次。这里只说透镜立场。 */}
                  这副透镜是「{profile.name}」。换一副透镜，同一处地方会被判成不同的东西——这不是错误，是这个工具的立场。
                </p>
                {usage?.balance.runsLeft === 0 && (
                  <button className="u-exhausted" onClick={() => setUsageOpen(true)}>
                    余额按最近均价只够跑 0 次了。仍可以按，失败会报余额不足。
                    <b>去记一笔 →</b>
                  </button>
                )}
                {usage && usage.balance.runsLeft !== null && usage.balance.runsLeft > 0 && usage.balance.runsLeft <= 3 && (
                  <button className="u-low" onClick={() => setUsageOpen(true)}>
                    余额不多了，大约还能跑 {usage.balance.runsLeft} 次
                    {usage.balance.avgCostPerRun
                      ? `（每次约 ${formatMoney(usage.balance.avgCostPerRun, usage.pricing.currency)}）`
                      : ''}
                  </button>
                )}
              </div>

              <TheoryBrief
                theory={theory}
                onSwitch={switchTheory}
                onOpenClaim={(id) => {
                  setFocusClaim(id);
                  setTheoryOpen(true);
                }}
              />
            </aside>

            <main className="main">
              {error && (
                <div className="banner bad">
                  <div>
                    <b>分析未完成</b>
                    {error}
                  </div>
                  <button className="banner-act" onClick={() => setUsageOpen(true)}>
                    看余额与用量
                  </button>
                </div>
              )}

              {notice && (
                <div className="banner warn">
                  <div>
                    <b>有一件事没做成</b>
                    {notice}
                  </div>
                  <button className="banner-x" onClick={() => setNotice(null)} aria-label="知道了">
                    ✕
                  </button>
                </div>
              )}

              {stale && diag && (
                <div className="banner info">
                  <div>
                    <b>当前展示的是「{THEORY_BY_ID[diag.theory].name}」的结果</b>
                    你已切到「{profile.name}」。同一段文本换一副透镜就是另一次分析，需要重新运行才能得到这份结果。
                  </div>
                </div>
              )}

              {/*
                这一条放在报告最上面，是因为「这一份花了多少」必须在读报告之前知道，
                而不是读完再去后台翻账本。数据来自本次调用本身，不取账本里最近一条——
                取最近一条会在快速连跑时认错行。
              */}
              {diag && lastUsage && (
                <div className="run-cost">
                  <span className="rc-k">这一次</span>
                  <span>
                    {formatTokens(lastUsage.promptTokens)} 进 / {formatTokens(lastUsage.completionTokens)} 出
                    {lastUsage.estimated && (
                      <sup className="est" title="接口没返回用量，这个数是本地按字数估的">
                        估
                      </sup>
                    )}
                  </span>
                  <i>·</i>
                  {lastUsage.priced ? (
                    <span>{formatMoney(lastUsage.cost, lastUsage.currency)}</span>
                  ) : (
                    <button className="rc-link" onClick={() => setUsageOpen(true)}>
                      没填单价，只记了 token
                    </button>
                  )}
                  <i>·</i>
                  <span>{(lastUsage.ms / 1000).toFixed(1)} 秒</span>
                </div>
              )}

              {/*
                对照条放在报告最上方，在花费行之后。
                它回答的是「我改的那一下有没有用」——这个答案必须在重读整份报告之前就看到，
                否则用户会把两版报告各读一遍，自己心算，那正是工具该替他做的事。
              */}
              {revision && <RevisionBar diff={revision} onOpenParent={() => parent && openReport(parent.id)} />}

              {diag ? (
                <ObjectionCtx.Provider value={objCtx}>
                  <DiagnosisView
                    d={diag}
                    onLoadRepair={loadRepair}
                    onOpenClaim={(id) => {
                      // 从报告里的边界栏点一条主张进来：打开库并滚到那一条。
                      // 「点开能看到出处与反对意见」这句话要是点不动，文档就比软件自信了。
                      setFocusClaim(id);
                      setTheoryOpen(true);
                    }}
                  />
                </ObjectionCtx.Provider>
              ) : (
                !error && (
                  <div className="empty">
                    <h2>先给一段真话</h2>
                    {/*
                      这段话设定的是期望，所以它必须跟着功能走：
                      加了查谬误模式之后，「这里不检测谬误」就成了假话——
                      它检测，只是不给一串光秃秃的名字。文案与功能不一致，
                      用户会按旧印象低估新功能，或按新名词高估旧承诺，两头都是误读。
                    */}
                    <p>
                      这里不给总分，也不替你站队。它把一段话拆成结构，逐条走完这套理论要问的问题，
                      告诉你它站在哪、倒在哪、哪一处其实站得住。想要「有没有谬误」的名单，
                      切到查谬误——但每个名字都得指得出原文哪一句，附上什么时候其实合法。
                    </p>
                    <div className="steps">
                      <div className="step">
                        <b>1</b>
                        <span>左边粘一段话</span>
                      </div>
                      <div className="step">
                        <b>2</b>
                        <span>上面挑一副透镜</span>
                      </div>
                      <div className="step">
                        <b>3</b>
                        <span>点「分析」，先看开头那四句话</span>
                      </div>
                    </div>
                    <div className="empty-map">
                      <div className="em-title">报告会是这个样子</div>
                      <div className="em-steps">
                        <div>
                          <b>①</b>
                          <span>开头四句话把结论说完，不用读整页</span>
                        </div>
                        <div>
                          <b>②</b>
                          <span>一张结构图：左依据、右结论，线断在哪一眼看见</span>
                        </div>
                        <div>
                          <b>③</b>
                          <span>一排关卡：绿过、红没过、黄没答，点进去看依据</span>
                        </div>
                        <div>
                          <b>④</b>
                          <span>能直接拿去说的话，附对方最强回击</span>
                        </div>
                      </div>
                      <p className="hint">
                        上面画的是诊断模式。输入框下面还有四种问法，各出一份不同的报告：
                        红队找攻击点、查谬误给名字、重构只画结构、提问只给问题——不判档位的那些，报告上会写明为什么。
                      </p>
                    </div>
                  </div>
                )
              )}
            </main>
          </div>
        )}

        {glossOpen && <GlossaryDialog onClose={() => setGlossOpen(false)} />}

        {theoryOpen && (
          <TheoryBaseDialog
            initial={focusClaim}
            pragmaRules={pragmaRules}
            onClose={() => {
              setTheoryOpen(false);
              setFocusClaim(undefined);
            }}
          />
        )}

        {dispOpen && <DisputeDialog hits={disputes} onClose={() => setDispOpen(false)} />}

        {histOpen && <HistoryPanel onOpen={openReport} onClose={() => setHistOpen(false)} />}

        {usageOpen && (
          <UsagePanel
            onClose={() => {
              setUsageOpen(false);
              refreshUsage();
            }}
            onChanged={setUsage}
          />
        )}

        {(settingsOpen || onboard) && (
          <Settings
            mode={onboard ? 'onboard' : 'normal'}
            onClose={() => {
              // 跳过也算答复过，不再每次开窗都弹
              if (onboard) localStorage.setItem('al:onboarded', '1');
              setSettingsOpen(false);
              setOnboard(false);
            }}
            onSaved={(s: LlmSettings & { hasKey: boolean }) => {
              localStorage.setItem('al:onboarded', '1');
              setHasKey(s.hasKey);
              setSettingsOpen(false);
              setOnboard(false);
            }}
          />
        )}
      </div>
    </PlainCtx.Provider>
  );
}
