import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ANALYSIS_MODES,
  MODE_META,
  type AnalysisMode,
  type AnalysisStage,
  type ReportProbe,
  Diagnosis,
  LlmSettings,
  Objection,
  PragmaRule,
  ProgressEvent,
  type ReportMeta,
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
import { Running, type RunEvent } from './components/Running';
import { RevisionBar } from './components/Revision';
import { HistoryPanel, when } from './components/History';
import { formatMoney, formatTokens } from '@shared/tokens';
import { disputesIn } from '@shared/disputes';
import type { Segment } from '@shared/segment';
import { samenessLine, type Sameness } from '@shared/sameness';
import type { PortfolioView } from '@shared/portfolio';
import type { AgreementView } from '@shared/agreement';
import { PortfolioBar } from './components/PortfolioBar';
import { AgreementBar } from './components/AgreementBar';
import { SideBySide } from './components/SideBySide';
import { NextLineBar } from './components/NextLine';
import type { NextLineView } from '@shared/nextline';
import { diffRevision } from '@shared/compare';
import { SAMPLES } from '@shared/samples';
import { decideCapture, type CaptureStatus } from '@shared/capture';

type Tab = 'analyze' | 'prompt';

/**
 * 点开一份打不开的报告时，按探测结果说人话。
 *
 * 「文件可能被手动删了或写坏了一半」这句旧提示把三种情况揉在一起，
 * 用户没法判断该去找备份、该去查权限、还是该当这份报告已经废了。
 */
const PROBE_TEXT: Record<ReportProbe['state'], string> = {
  ok: '刚才还能读，这次却没取到（可能正被别的程序改动）',
  missing: '磁盘上没有这个文件（索引里这一行已经找不到对应报告）',
  unreadable: '文件在，但读不出来（可能被占用或权限不够）',
  'invalid-json': '文件在，但内容写坏了，JSON 解不开',
  incomplete: '文件能解析，但缺了报告该有的字段',
};

/** 一次分析调用的返回形状。推断出来而不是手写，免得 preload 改了这里不跟。 */
type RunResult = Awaited<ReturnType<typeof window.api.analysis.run>>;

/**
 * 示例是一组，按一次换一段。
 *
 * 详见 `@shared/samples`：原来只有一段，于是「再试一次」永远得到同一段，
 * 存档里一百多份报告绝大多数是同一段文本——那不是一个样本判了一百次，
 * 是同一个样本跑了一百遍。它证明软件稳定，不证明判断准。
 */
const SAMPLE_LIB = SAMPLES;

export default function App() {
  const [tab, setTab] = useState<Tab>('analyze');
  const [theory, setTheory] = useState<TheoryId>(DEFAULT_THEORY);
  const [passage, setPassage] = useState('');
  /**
   * 下一次按「示例」会填第几段。填完就前进一位，填到末尾回第一段。
   *
   * 这个游标只在内存里，不落盘：它服务于「这一会儿试了几段」，
   * 不是用户偏好。重新打开应用回到第一段是正常的——第一段是校园那段，
   * 也是文档和截图里用的那段，先看到它比较好对得上。
   */
  const [sampleAt, setSampleAt] = useState(0);
  /**
   * 「框里是用户自己写的，按下去会覆盖掉」的那一次二次确认。
   *
   * 为什么需要它：这个按钮以前直接覆盖。用户粘了一整段社论，
   * 手滑按一下示例，那段就没了，而且没法撤销——输入框里没有历史。
   * 删除报告那边已经有「删 / 确认？」这一套，这里沿用同一种两下确认，
   * 不弹系统对话框：覆盖示例这件事不值得打断到一个模拟对话框里。
   */
  const [sampleConfirm, setSampleConfirm] = useState(false);
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
  /** 这次已经等了多少秒。只用来回答「还要不要等」，不参与任何判定。 */
  const [waited, setWaited] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /**
   * 一条「事情没成，但结果照给你」的提示。
   *
   * 和 error 分开是因为这两件事不能混：error 意味着这次分析没有结果，
   * notice 意味着结果有了，只是另外一件事没做成（异议没记上、报告没存进历史）。
   * 混在一起显示，用户会以为报告是坏的——而报告是好的。
   */
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * 全局快捷键从剪贴板读到的那段字——**只是候选**，还没写进框里。
   *
   * 为什么要多这一步：框里可能是他写了二十分钟的东西，而剪贴板里那段是
   * 十分钟前复制的别的什么。一按就换，等于让他回来发现原文没了，
   * 而输入框没有撤销。所以「框里是自己的字」时，这个功能只负责把它端上来，
   * 换不换由他点。
   *
   * 什么时候不问：框是空的，或者框里是示例——这两种都没有「失去」可言。
   * 判定不在这个文件里，在 `@shared/capture`，那边有 28 条断言守着。
   */
  const [capAsk, setCapAsk] = useState<{ text: string; chars: number; note: string } | null>(null);
  /** 快捷键相关的一句话（填进来了 / 剪贴板是空的 / 太长了）。和 notice 分开：这都不是失败。 */
  const [capNote, setCapNote] = useState<string | null>(null);
  /** 注册结果。null 表示还没问到。 */
  const [capStatus, setCapStatus] = useState<CaptureStatus | null>(null);
  /**
   * 「你按停的那一次」的结果。
   *
   * 单独一条，不塞进 notice：notice 的标题是「有一件事没做成」——
   * 而按停恰恰是做成了。把主动停下的话挂在失败标题下面，用户会以为自己弄坏了什么。
   * 这条也不进 error：error 意味着「这次没有结果，去改配置」，
   * 而停下是用户自己选的结局，不该给他一个要排查的红条。
   */
  const [stopNote, setStopNote] = useState<string | null>(null);
  /** 按了停、还在等主进程确认。按钮这时显示「正在停…」并且不可再点。 */
  const [stopping, setStopping] = useState(false);
  /**
   * 这一次已经收到的进度事件（带到达时刻）。
   *
   * 主进程只在真的进入某一步时发一条，所以这串东西是「已经走过哪几步、
   * 每步花了多久」的唯一证据。它不是进度估算——不插值、不预测，
   * 清单上没走到的步骤一律显示中性说明，不替模型编时间。
   */
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  /** 上一条进度事件的到达时刻。用来分辨「在动」和「没动静」。 */
  const [progressAt, setProgressAt] = useState(0);
  /**
   * 上一次发起分析时那段文字的快照。
   *
   * 「重跑这一次」必须对准失败的那一段，而不是输入框里现有的字——
   * 用户失败后常会先去改设置或改别处，回来再点一次，那时框里可能已经是另一段话了。
   * 用快照重跑，跑出来的才是他想再试的那一次。
   */
  const [lastAttempt, setLastAttempt] = useState<{
    text: string;
    parentId: string | null;
    chars: number;
  } | null>(null);
  /**
   * 屏幕上这份报告是对着哪段字跑出来的。
   *
   * 分析要几十秒，这期间输入框是可编辑的。跑完之后框里已经换成另一段话，
   * 而报告还在说上一段——旧界面一个字都不提。带上报告 id 是为了不误判：
   * 从历史里点开旧报告时，这份对不上框里的字是理所当然的，不该提示。
   */
  const [ranFor, setRanFor] = useState<{ id: string; text: string } | null>(null);
  /**
   * 「这段文字跑过没有」。
   *
   * 这一条的存在理由不是功能，是证据：102 份存档里 98 份落在同一段早读上。
   * 软件当时一句话都没说，于是「试过多少种文本」全靠人记，而人记不住。
   * 它只陈述位置（跑过 N 次、最像哪一份），不拦、不劝——重跑是合法用法：
   * 同一段文字跑两遍，差多少正是模型稳不稳的证据。
   */
  const [same, setSame] = useState<Sameness | null>(null);
  /** 样本账。null 表示还没读到，首帧不闪一个「0 组」。 */
  const [folio, setFolio] = useState<{ view: PortfolioView | null; dirError: string | null } | null>(null);
  /**
   * 同题复跑。样本账说了「几组文字」，它说下一层：同一组里的报告彼此一样吗。
   * 与 folio 同一次刷新、同样不缓存，理由相同——删过报告的人不该继续看到旧数字。
   */
  const [agree, setAgree] = useState<{ view: AgreementView | null; dirError: string | null } | null>(null);
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
  /**
   * 「下一句」的账。null 表示还没读到。
   *
   * 这是整份路线图里唯一一条只能由人填的输入：看完报告之后那句话。
   * 软件只负责把它原样存下、原样数出来——不分析、不归类、不给选项。
   */
  const [nextLines, setNextLines] = useState<NextLineView | null>(null);
  /** 读不出本机记录时的原因。有它就不摆输入框，见 NextLineBar 的说明。 */
  const [nextLinesErr, setNextLinesErr] = useState<string | null>(null);
  /** 历史面板。这里同时放异议统计——两者都是「跨会话才看得出的东西」。 */
  const [histOpen, setHistOpen] = useState(false);
  /** 首屏「最近报告」：只读存档索引，不写回、不发起分析。 */
  const [recent, setRecent] = useState<ReportMeta[]>([]);
  /*
   * 正在对照的两份报告。null 表示没开。
   * 存的是**全文**而不是 id：读盘只该发生一次，之后翻来覆去看的是同一份数据。
   */
  const [pair, setPair] = useState<{ a: Diagnosis; b: Diagnosis } | null>(null);
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
  /**
   * 这一次跑的过程里，用户有没有按过「停」。
   *
   * 用来分辨那一瞬间的两种结局：真停住了，还是它刚好在按下的同一刻跑完了。
   * 后者界面会突然冒出一份报告——那一刻必须有一句话说明「你的停没赶上」，
   * 否则用户会以为按钮坏了。
   */
  const stopRef = useRef(false);

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
    /*
     * 「下一句」的账：只读一次（挂载时）。写与删都由 IPC 返回整份账直接替换状态，
     * 不另取一次，避免「刚记上、显示的还是一分钟前的数目」。
     *
     * 读失败**不静默**：这里跟异议不一样。异议列表读不出来，界面上只是没有异议标记，
     * 用户不知道有东西坏了也不会有损失；而这一栏要是悄悄消失，用户会以为「这软件没有这个功能」，
     * 于是那条本来该留下的反应根本没有机会留下。
     */
    window.api.nextlines
      .list()
      .then((v) => {
        setNextLines(v);
        setNextLinesErr(null);
      })
      .catch((err: Error) => setNextLinesErr(err?.message ?? '原因不明'));
    return window.api.analysis.onProgress((e) => {
      setProgress(e);
      /*
       * 到达时刻在这里记，不在主进程记：清单说的是「你等了多久」，
       * 用渲染层的时钟才算得上用户真正经历的时间。
       */
      const at = Date.now();
      setProgressAt(at);
      setRunEvents((v) => [...v, { stage: e.stage, label: e.label, at }].slice(-24));
    });
  }, [refreshUsage]);

  /*
   * 输入框里这段文字，存档里跑过没有。
   *
   * 时机：停手 400ms 之后才问。每敲一个字问一次，等于一边打字一边读一百个文件，
   * 而答案在打字过程中几乎不变——人改的是句子中间，开头那几十个字早就定了。
   *
   * 结果乱序：两次请求可能先后返回。token 对不上就丢掉，否则会出现
   * 「文字已经换成新的，屏幕上的次数还是旧的」——一个看起来完全正常的错。
   *
   * 门槛 8 字：比这短的话，相似度本来就不可靠（见 @shared/sameness 里
   * 关于短文本的说明），而这个栏目要的是「你真的试过一段文本」，不是「你打了两个字」。
   */
  useEffect(() => {
    const text = passage.trim();
    if (text.length < 8) {
      setSame(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      window.api.archive
        .same(text)
        .then((s) => {
          if (alive) setSame(s);
        })
        .catch(() => {
          // 读不到就什么都不说。这一栏是补充信息，不能因为它而让输入区报错。
          if (alive) setSame(null);
        });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [passage, diag?.id]);

  /*
   * 样本账：出了新报告、或开关历史面板（删报告就在那里面）时重数一遍。
   *
   * 不缓存的理由与「这段跑过没有」一样：缓存一旦漏了失效时机，
   * 就会在删过报告的人身上继续显示旧数目——一个看起来完全正常的错。
   * 取数失败不静默：dirError 原样显示在那一栏，而不是让整块悄悄消失。
   */
  const refreshPortfolio = useCallback(() => {
    window.api.archive
      .portfolio()
      .then(setFolio)
      .catch((err: Error) => setFolio({ view: null, dirError: err?.message ?? '原因不明' }));
    window.api.archive
      .agreement()
      .then(setAgree)
      .catch((err: Error) => setAgree({ view: null, dirError: err?.message ?? '原因不明' }));
  }, []);
  useEffect(() => {
    refreshPortfolio();
  }, [refreshPortfolio, diag?.id, histOpen]);

  /*
   * 首屏不该是一片空白：本机跑过的报告要能被一眼看见、一点就回得去。
   * 这里只读索引前三份；换报告、开关历史面板时重读，其余时候不打扰。
   */
  useEffect(() => {
    if (diag || loading) return;
    let alive = true;
    window.api.archive
      .list()
      .then((list) => { if (alive) setRecent(list.slice(0, 3)); })
      .catch(() => {
        // @allow-silent: 读不到索引就老实显示「还没有存档」，不该因为附加内容报错。
      });
    return () => { alive = false; };
  }, [diag, loading, histOpen]);

  /*
   * 全局快捷键的接线。
   *
   * 两件事，顺序不能反：
   * 1. 问一次注册结果 —— 没注册上时界面必须说的是实话（「这个键被占了」），
   *    否则那一行提示会变成「按 Ctrl+Alt+A」，而按了没反应。
   * 2. 订阅候选 —— 主进程只交上来「剪贴板里读到这段」，填不填在这里判。
   *
   * 为什么用 ref 存最新原文：订阅只在挂载时做一次。若把 passage 放进依赖，
   * 每敲一个字就会重新订阅一次，中间那一小段时间里的按键会掉进空档——
   * 掉一次没人发现，掉十次就成了「这个键时灵时不灵」。
   */
  const passageRef = useRef(passage);
  useEffect(() => {
    passageRef.current = passage;
  }, [passage]);

  useEffect(() => {
    let alive = true;
    window.api.capture
      .status()
      .then((s) => {
        if (alive) setCapStatus(s);
      })
      .catch(() => {
        /*
         * 问不到也要说出来。
         *
         * 这里的「静默」特别坏：界面会照常不显示那一行提示，于是用户既不知道
         * 有这个功能，也不知道它其实坏了——他会一直以为是自己记错了快捷键。
         */
        if (alive) {
          setCapStatus({
            accelerator: '',
            human: '',
            registered: false,
            reason: '查不到全局快捷键的注册状态（与主进程通信失败）。',
          });
        }
      });

    const off = window.api.capture.onOffer((p) => {
      const cur = passageRef.current;
      const dec = decideCapture({
        current: cur,
        clip: p.text,
        currentIsSample: SAMPLE_LIB.some((s) => s.text === cur),
      });
      if (dec.kind === 'fill') {
        setPassage(dec.text);
        setWhole(null);
        setPickedIndex(null);
        setSampleConfirm(false);
        setCapAsk(null);
        setCapNote(dec.note);
      } else if (dec.kind === 'ask') {
        // 不写进框，只把它端上来。框里那些字一个都不动。
        setCapAsk({ text: dec.text, chars: dec.chars, note: dec.note });
        setCapNote(null);
      } else if (!dec.quiet) {
        setCapNote(dec.note);
      }
    });

    return () => {
      alive = false;
      off();
    };
  }, []);

  /*
   * 「已等 42 秒」。
   *
   * 每 500 毫秒加一次是为了让 1 秒的跳动不至于晚半拍，但对外只显示整秒——
   * 数字跳得比现实快，会让人以为快好了。
   */
  useEffect(() => {
    if (!loading) {
      setWaited(0);
      return;
    }
    const t0 = Date.now();
    const id = window.setInterval(() => setWaited(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => window.clearInterval(id);
  }, [loading]);

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

  /** 框里是用户自己的文字（不是空、也不是某一段示例）。覆盖它之前要先问一声。 */
  const passageIsMine = passage.trim() !== '' && !SAMPLE_LIB.some((s) => s.text === passage);

  const fillSample = useCallback(() => {
    if (passageIsMine && !sampleConfirm) {
      setSampleConfirm(true);
      return;
    }
    const s = SAMPLE_LIB[sampleAt % SAMPLE_LIB.length];
    setPassage(s.text);
    setWhole(null);
    setPickedIndex(null);
    setSampleAt((i) => (i + 1) % SAMPLE_LIB.length);
    setSampleConfirm(false);
  }, [passageIsMine, sampleConfirm, sampleAt]);

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
      const parentForThis = override?.parentId ?? pendingParent ?? null;
      abortRef.current = false;
      stopRef.current = false;
      setStopping(false);
      setStopNote(null);
      setLoading(true);
      setError(null);
      setNotice(null);
      setDiag(null);
      setProgress({ stage: 'scope', label: '准备', percent: 4 });
      /*
       * 清单从零开始，并且立刻记下「现在」：否则第一条进度到达之前，
       * 「多久没动静」会从一个更早的时刻起算，把还没起步的准备阶段算成卡住。
       */
      setRunEvents([]);
      setProgressAt(Date.now());
      /* 失败时「重跑这一次」要对准这一段，而不是那时输入框里可能已经改过的字 */
      setLastAttempt({ text, parentId: parentForThis, chars: text.length });

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
        parentForThis
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
      setStopping(false);
      setProgress(null);
      if (abortRef.current) return;

      if (res.ok && res.data) {
        setDiag(res.data);
        setLastUsage(res.usage ?? null);
        /* 记下这份报告对应的输入，好在框里的字被改过之后照实说出来 */
        setRanFor({ id: res.data.id, text });
        /*
         * 按了停却照样出了报告：说一句「没赶上」。
         *
         * 这两件事可以同时成立——abort 打过去时请求刚好返回，一切都已经算完了。
         * 不说的话，用户刚才明明看着「正在停…」，一秒后屏幕上多了一份完整报告，
         * 他会以为那个按钮是装饰。钱也确实照收，这一点不能瞒。
         */
        if (stopRef.current) {
          setStopNote('你按了「停」，但请求在同一刻已经跑完，这一份照常给出——这次的钱也照收。');
        }
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
      } else if (res.error?.code === 'CANCELED') {
        /*
         * 停住了。
         *
         * 不复用 error 那条红条：红条写着「分析未完成」，还配一个「看余额与用量」的按钮，
         * 像是出了故障。而这是用户按下的结果，不是故障。
         *
         * 账单那半句必须说准：这一次会记成一条**失败**（token 按字数估、金额记 0），
         * 所以账本里会多一行、余额不会因此扣减。真实花费可能已经发生，
         * 只是拿不到用量就写不下准确数字——「没记账」和「记了个 0」是两件事，
         * 说成前者，用户去账本里看到那一行时会以为工具在自相矛盾。
         *
         * 秒数取整到「不到 1 秒」：`waited` 每 500 毫秒更新一次，刚开始就按停时它是 0，
         * 「等了 0 秒」会被读成一个坏掉的计数器，而不是「停得很快」。
         */
        const dur = waited >= 1 ? `等了 ${waited} 秒` : '还不到 1 秒';
        setStopNote(
          `已停下（${dur}）。文本还在输入框里，可以改完再按一次。账本里会多一条失败记录：token 按字数估、金额记 0——钱可能已经花了，只是拿不到用量，余额不会因此扣减。`
        );
      } else {
        setError(res.error?.message ?? '分析失败，原因不明。');
      }
    },
    [passage, theory, mode, loading, hasKey, refreshUsage, pendingParent, waited]
  );

  /**
   * 停。
   *
   * 为什么不是「界面先停、请求随它去」：那样按钮会立刻变回可用，
   * 而模型还在生成、钱还在花。停要停到 fetch 上，所以要过主进程。
   *
   * `canceled: false` 是一种真会发生的结局：请求在这 200 毫秒里跑完了。
   * 那种时候不能报「已停止」——下一秒报告就浮出来了，与刚说的话自相矛盾。
   */
  const stop = useCallback(() => {
    if (!loading || stopping) return;
    setStopping(true);
    stopRef.current = true;
    window.api.analysis
      .cancel()
      .then((r) => {
        if (!r.canceled) {
          setStopping(false);
          stopRef.current = false;
          setStopNote('这一刻没有正在跑的请求——它多半刚好跑完了，报告马上出来。');
        }
      })
      .catch((err: Error) => {
        /*
         * 停不下来必须说出来。
         * 静默复位按钮的话，用户会以为自己没点中，再点一次、再等三十秒，
         * 而真正发生的事是「它还在跑，只是停不了」。
         */
        setStopping(false);
        stopRef.current = false;
        setStopNote(`没停住：${err?.message ?? '与主进程通信失败'}。这一次还在跑。`);
      });
  }, [loading, stopping]);

  /**
   * 「重跑这一次」。
   *
   * 用的是失败那次的文字快照，不是输入框里现在的字：失败之后用户常先去改设置、
   * 或者顺手把框里的话改成另一段，回来再点一次时，想重试的仍然是刚才那一次。
   * 透镜与问法用当前选中的——改这两样本来就是「换一副眼镜再看」，不是重试。
   */
  const retry = useCallback(() => {
    if (!lastAttempt || loading) return;
    setError(null);
    setStopNote(null);
    run({ text: lastAttempt.text, parentId: lastAttempt.parentId });
  }, [lastAttempt, loading, run]);

  /*
   * 键盘：Ctrl/⌘+Enter 跑、Esc 停。
   *
   * 界面上写了这两条（按钮旁、停止说明里），写了就得真的能按。
   * 对话框打开时不接管：那时 Esc 属于对话框，抢过来会让人关不掉设置页。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dialogOpen =
        settingsOpen || onboard || histOpen || usageOpen || glossOpen || theoryOpen || dispOpen;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (dialogOpen || loading) return;
        e.preventDefault();
        void run();
        return;
      }
      if (e.key === 'Escape' && loading && !dialogOpen) {
        e.preventDefault();
        stop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run, stop, loading, settingsOpen, onboard, histOpen, usageOpen, glossOpen, theoryOpen, dispOpen]);

  /** 换透镜不自动重跑：跑一次要花钱和时间，而且旧结果仍有对照价值。 */
  const switchTheory = (id: TheoryId) => setTheory(id);

  const stale = useMemo(() => !!diag && diag.theory !== theory, [diag, theory]);
  /*
   * 距上一条进度事件过了多久。每次渲染现算，靠的是「已等几秒」那个
   * 每 500 毫秒一次的刷新——所以它只在分析进行中才有意义，也只在那里显示。
   * 不在 state 里另起一个计时器：两个计时器会各自漂移，界面上就会自相矛盾。
   */
  const stillMs = progressAt ? Math.max(0, Date.now() - progressAt) : 0;
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

  /**
   * 报告目录是主进程注入的独立脚本，不在 React 树里。它原先靠「.main 节点换了
   * 或区块数变了」判断换报告；18 个一级区块被架构检查冻结、React 又复用 .main，
   * 两个判据经常同时不成立，于是上一份收起的节被套到新报告上。
   * 这里改成显式通知：报告 id 一变，等这一帧渲染落地，让注入脚本重扫并全展开。
   * 事件只带 id，不带报告内容，不写盘；连点时只保留最后一次通知。
   */
  useEffect(() => {
    if (!diag?.id) return;
    const t = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('al:report-change', { detail: { id: diag.id } }));
    }, 180);
    return () => window.clearTimeout(t);
  }, [diag?.id]);

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
    setStopping(false);
    /* 这一条说的是「刚才那一次」，而屏幕上马上换成另一份报告，留着会张冠李戴 */
    setStopNote(null);
    setProgress(null);
    window.api.archive
      .get(id)
      .then(async (d) => {
        if (!d) {
          /*
           * get() 只回 null，说不出「不存在」和「写坏了」的区别；以前这里
           * `if (!d) return`，点了毫无反应——正是下面那段注释说要避免的症状。
           * 补问一次 probe，把具体原因和「文件没被改动」一起讲清楚。
           */
          let p: ReportProbe | null = null;
          try {
            p = await window.api.archive.probe(id);
          } catch {
            // @allow-silent: 探测也失败时不再弹第二条错，下面用兜底文案说明「原因读不出来」；
            // 屏幕上仍然有反应，不是把异常吞成「什么都没发生」。
          }
          const why = p ? PROBE_TEXT[p.state] : '读不出原因';
          const detail = p?.reason ? `（${p.reason}）` : '';
          setNotice(
            `这份报告打不开：${why}${detail}。原文件没有被改动；到「历史」里的体检条能看全本机还有哪些读不出来。`
          );
          return;
        }
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
       * 常见原因就是文件被手动删了或写坏了一半。别劝人删那一行——先看体检。
       */
      .catch((err: Error) =>
        setNotice(
          `读这份报告时出错：${err?.message ?? '原因不明'}。原文件没有改动；到「历史」里看体检结果，先弄清少了什么。`
        )
      );
  }, []);

  /**
   * 同题复跑里挑中的两份，读出来摆在一起。
   *
   * 与 openReport 的差别：它**不换**屏幕上的报告、不换原文、不碰任何状态。
   * 这一屏是旁证，不是一次新的分析——用户看完关掉，原来那份报告还在原处。
   *
   * 读不出来必须说出来。两份里只要有一份是坏的，就不给一张空表：
   * 0 行的表会被读成「两份完全一样」，那是这一屏能给出的最误导人的结论。
   */
  const openPair = useCallback((aId: string, bId: string) => {
    Promise.all([window.api.archive.get(aId), window.api.archive.get(bId)])
      .then(([a, b]) => {
        if (!a || !b) {
          setNotice('这两份里有一份读不出来（文件可能被手动删掉或写坏了一半），所以没有可对照的内容。');
          return;
        }
        setPair({ a, b });
      })
      .catch(() => setNotice('这两份读不出来，存档目录可能暂时不可用。'));
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
                    // 一旦开始改，就不再想覆盖：那次确认是给他「按住不放」的，不是给他瞄准的
                    if (sampleConfirm) setSampleConfirm(false);
                    // 同理：他已经在写了，「要不要用剪贴板那段替换」这条问话就过时了
                    if (capAsk) setCapAsk(null);
                    if (capNote) setCapNote(null);
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
                {/*
                  快捷键提示。
                  「按哪个键」必须写在界面上——不写，这个功能等于不存在；
                  而写出来的字必须与主进程注册的那个键同源（@shared/capture 的
                  CAPTURE_ACCELERATOR 推出来），否则人按的键永远没反应。
                  注册失败时不允许继续显示那个键：那是在教人按一个不响的按钮。
                */}
                {capStatus &&
                  (capStatus.registered ? (
                    <div
                      className="cap-hint"
                      data-cap-status="on"
                      title="读的是剪贴板，不是你鼠标选中的那段文字。选中文本需要在别的程序里模拟 Ctrl+C，那会改动剪贴板，也可能触发粘贴副作用，所以这一步没有做。先复制，再按这里写的键。"
                    >
                      按 <b>{capStatus.human}</b> 把剪贴板里的字叫进来。
                      <br />
                      框里是你写的字时，只问、不覆盖。
                    </div>
                  ) : (
                    <div className="cap-hint off" data-cap-status="off">
                      全局快捷键没启用：{capStatus.reason}
                    </div>
                  ))}

                {/*
                  「剪贴板里没有文字」「太长了」这类回话。
                  它们不是失败，所以不挂到 notice（那一条的标题是「有一件事没做成」）。
                */}
                {capNote && (
                  <div className="cap-bar note" data-cap-note="1">
                    <span className="cap-note">{capNote}</span>
                    <button className="cap-x" onClick={() => setCapNote(null)}>
                      知道了
                    </button>
                  </div>
                )}

                {/*
                  候选条。这一条存在的全部意义就是：框里那段字还在。
                  「用它」才写，「不用」什么都不发生——没有默认动作。
                */}
                {capAsk && (
                  <div className="cap-bar ask" data-cap-ask="1">
                    <span className="cap-note">{capAsk.note}</span>
                    <button
                      className="cap-use"
                      onClick={() => {
                        setPassage(capAsk.text);
                        setWhole(null);
                        setPickedIndex(null);
                        setSampleConfirm(false);
                        setCapAsk(null);
                        setCapNote('已用剪贴板里的文字替换。原来那段没有备份，如果你需要它，现在只能从报告历史里找。');
                      }}
                    >
                      用它（{capAsk.chars} 字）
                    </button>
                    <button className="cap-keep" onClick={() => setCapAsk(null)}>
                      不用
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
                    className={`ghost-btn ${sampleConfirm ? 'confirm' : ''}`}
                    onClick={fillSample}
                    disabled={loading}
                    data-sample-btn="1"
                    data-genre={SAMPLE_LIB[sampleAt % SAMPLE_LIB.length].genre}
                    data-at={sampleAt}
                    title={
                      sampleConfirm
                        ? '再按一次会用示例覆盖框里的文字。框里的内容不会自动备份，想留着就先复制出去。'
                        : `填入第 ${sampleAt + 1} 段（共 ${SAMPLE_LIB.length} 段）：「${
                            SAMPLE_LIB[sampleAt % SAMPLE_LIB.length].genre
                          }」——${SAMPLE_LIB[sampleAt % SAMPLE_LIB.length].hint}。再按一次换下一段。`
                    }
                  >
                    {sampleConfirm
                      ? '覆盖原文？'
                      : passageIsMine
                        ? '换一段'
                        : `示例 ${sampleAt + 1}/${SAMPLE_LIB.length}`}
                  </button>
                  <button
                    className="primary"
                    onClick={() => run()}
                    disabled={loading || !passage.trim()}
                  >
                    {/*
                      这里只写短词，不写阶段名。
                      阶段名是一整句（「逐条走型式的一条批判性问题（CQ）」），
                      塞进这个按钮会把它撑成三行，顺带把左边的「128 字」和「填入示例」
                      各挤成两行——整条工具栏变形。整句现在有地方去了：主区那块
                      「分析进行中」写的就是它，还带百分比和已等时间。
                    */}
                    {loading ? '分析中…' : MODE_META[mode].action}
                  </button>
                </div>
                {/*
                  「这段跑过没有」。
                  单独一行，不塞进上面那排按钮里——那一排已经有字数、示例、主按钮，
                  再加一句会各挤成两行（候选条那次就是这么把「替换」断在词中间的）。
                  位置放在按钮正下方：这句话的意义是「按下去之前想一下」，
                  放得离按钮越近越有用；放得远，它就只是装饰。
                */}
                {same && samenessLine(same, when) && (
                  <p className="same-bar" data-same={same.exact} data-same-near={same.near}>
                    <span className="sb-v">{samenessLine(same, when)}</span>
                    {same.exact > 0 && (
                      <em className="sb-why">
                        重跑一次能看出模型会不会换说法；要看新的东西，得换一段文字。
                      </em>
                    )}
                  </p>
                )}
                {/*
                  样本账放在按钮正下方：这句话的意义是「按下去之前，先看一眼自己
                  试过几种文字」。放远了就只是装饰。它是唯一一处文字全部来自本地
                  存档、一个字都不来自模型的地方。
                */}
                <PortfolioBar view={folio?.view ?? null} dirError={folio?.dirError ?? null} fmt={when} />
                {/*
                  紧接着样本账：样本账说「落在 6 组文字上」，这一栏说「同一组里的报告彼此一样吗」。
                  两句话合起来才说清一件裸提示词永远不知道的事——你重复跑的是同一个输入，
                  而重复跑出来的东西是不是同一份。
                */}
                <AgreementBar view={agree?.view ?? null} dirError={agree?.dirError ?? null} fmt={when} onCompare={openPair} />
                <p className="hint">
                  {/* 模式条下面那行 mode-note 已经显示过 MODE_META[mode].hint，
                      这里再重复一遍，同一句话会在 50px 内出现两次。这里只说透镜立场。 */}
                  这副透镜是「{profile.name}」。换一副透镜，同一处地方会被判成不同的东西——这不是错误，是这个工具的立场。
                  <br />
                  <b>Ctrl/⌘+Enter</b> 直接跑；跑起来之后按 <b>Esc</b> 停。
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
                    {lastAttempt && !loading && (
                      <span className="banner-sub">
                        「重跑这一次」用的是刚才那 {lastAttempt.chars} 字，不是框里现在的字；透镜与问法用现在选中的。
                      </span>
                    )}
                  </div>
                  <div className="banner-acts">
                    {lastAttempt && !loading && (
                      <button className="banner-act" onClick={retry} data-retry="1">
                        重跑这一次
                      </button>
                    )}
                    <button className="banner-act" onClick={() => setUsageOpen(true)}>
                      看余额与用量
                    </button>
                  </div>
                </div>
              )}

              {stopNote && (
                /*
                 * data-stop-note 是给端到端冒烟定位用的。
                 * 不用类名，是因为它不该有自己的样子——它就是一条 info 提示，
                 * 加一个只为测试存在、没有样式的类，等于给样式表塞一条死规则。
                 */
                <div className="banner info" data-stop-note="1">
                  <div>
                    <b>停在这里</b>
                    {stopNote}
                  </div>
                  <div className="banner-acts">
                    {/* 停是主动选择，不是故障：这里给的是「接着来」，不是「去排查」 */}
                    <button className="banner-act" onClick={() => run()} data-retry="1">
                      再跑一次
                    </button>
                    <button className="banner-x" onClick={() => setStopNote(null)} aria-label="知道了">
                      ✕
                    </button>
                  </div>
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

              {/*
                报告出自我自己按下的那一次，而框里的字已经被改过。
                分析要几十秒，这期间输入框一直是可编辑的——跑完之后屏幕上这份
                说的还是旧那一段，旧界面一个字都不提，用户会以为它在判现在这段。
                只有 id 对得上才提：从历史里点开旧报告时对不上是理所当然的。
              */}
              {diag &&
                !loading &&
                ranFor &&
                ranFor.id === diag.id &&
                ranFor.text !== passage.trim() && (
                  <div className="banner info" data-ran-text="1">
                    <div>
                      <b>这份报告判的不是框里现在这段字</b>
                      它对应你按下「分析」时的那 {ranFor.text.length} 字；框里现在是另一段（
                      {passage.trim().length} 字）。要判断现在这段，需要再跑一次——报告不会自己跟着改。
                    </div>
                    <div className="banner-acts">
                      <button className="banner-act" onClick={() => run()} data-retry="1">
                        用框里这段跑
                      </button>
                    </div>
                  </div>
                )}

              {stale && diag && (
                <div className="banner info" data-stale="1">
                  <div>
                    <b>当前展示的是「{THEORY_BY_ID[diag.theory].name}」的结果</b>
                    你已切到「{profile.name}」。同一段文本换一副透镜就是另一次分析，需要重新运行才能得到这份结果。
                    <span className="banner-sub">
                      重跑用的是这份报告的 {diag.passage.length} 字，不是框里现在那段（可能已经被改过）。
                    </span>
                  </div>
                  <div className="banner-acts">
                    {/*
                      这句话既然说了「需要重新运行」，就得给得出那一下。
                      不带 parentId：换透镜的两份不是「改稿前后」，拿它们做修订对照
                      会把两把尺子的差别读成「改好了 / 改坏了」。
                    */}
                    <button
                      className="banner-act"
                      onClick={() => void run({ text: diag.passage, parentId: null })}
                      disabled={loading}
                      data-stale-retry="1"
                    >
                      用「{profile.name}」重跑这段
                    </button>
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

              {loading ? (
                <Running progress={progress} elapsed={waited} stopping={stopping} onStop={stop} events={runEvents} stillMs={stillMs} />
              ) : diag ? (
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
                  {/*
                    放在报告的最后，不是开头。
                    它问的是「读完之后的下一句」，放在开头等于在人还没读的时候先要一句评价——
                    那样收上来的字，回答的就不是路线图想知道的那个问题了。
                  */}
                  <NextLineBar
                    view={nextLines}
                    readError={nextLinesErr}
                    diagId={diag.id}
                    /* 报告删了也还认得出来这是哪一次之后说的；只留开头，逐字取自原文。 */
                    passageHead={(diag.passage ?? '').replace(/\s+/g, ' ').trim().slice(0, 32)}
                    theory={diag.theory}
                    fmt={when}
                    onSave={async (input) => {
                      const r = await window.api.nextlines.add(input);
                      setNextLines(r.view);
                      setNextLinesErr(null);
                      return r;
                    }}
                    onRemove={async (id) => {
                      const r = await window.api.nextlines.remove(id);
                      setNextLines(r.view);
                      setNextLinesErr(null);
                      return r;
                    }}
                  />
                </ObjectionCtx.Provider>
              ) : (
                !error && (
                  <div className="empty">
                    <h2>先给一段真话</h2>
                    {/*
                      首屏起始区。原来只有「标题 + 说明 + 三步 + 报告预览」全部居中，
                      右半屏一大片空白，也没有一个能直接按的入口。这里补三件真动作
                      （聚焦输入框 / 填示例 / 开历史）和本机最近三份报告，一点就回得去。
                      下面原有的说明、三步与报告预览一字未删——首屏冒烟是逐项数过的。

                      这一版做减法：导语原来与下面那段 <p> 几乎是同一句话，读两遍；
                      报告预览又长又靠下，把首屏撑到要滚。现在导语只说「现在做什么」，
                      预览收进可展开区。探针数的是 .empty > p / .step / .em-steps > div
                      这些节点，收起不等于删掉，一条断言都不用放宽。
                    */}
                    <div className="start-hero">
                      <div className="start-lead">一次只处理一段话。给它原文，剩下的按下面三步走。</div>
                      <div className="start-actions">
                        <button
                          className="start-primary"
                          onClick={() => {
                            const t = document.querySelector('.composer textarea') as HTMLTextAreaElement | null;
                            t?.focus();
                            t?.scrollIntoView({ block: 'center' });
                            /* 按下去要看得见落点：输入框在左侧，只 focus 常常像「没反应」。
                               给两秒高亮，用户一开始打字 React 重渲染会自然带走它。 */
                            if (t) {
                              t.classList.add('al-start-focus');
                              window.setTimeout(() => t.classList.remove('al-start-focus'), 2400);
                            }
                          }}
                        >
                          粘贴一段话，开始
                        </button>
                        <button className="start-ghost" onClick={fillSample}>
                          先载入一段示例
                        </button>
                        <button className="start-ghost" onClick={() => setHistOpen(true)}>
                          打开历史报告
                        </button>
                      </div>
                      <div className="start-meta">
                        已存下的报告随时能回看，不需要重新分析，也不花钱。
                      </div>
                      {/*
                        产品定位（2026-11-12，用户选 B）：判断由模型写出，软件只做可读化与回看。
                        这句话必须与报告页 SourceBar 是同一套口径——首屏是用户第一次看到
                        这个软件的地方，在这里把判断说成软件自己下的，后面再纠正就晚了。
                        用 div 而不是 p：空态探针读的是 .empty > p 的第一个直接子元素。
                      */}
                      <div className="start-scope">
                        判断由模型写出；这里做的是把它拆开、对回原文、存下来能回看。软件不替你判定这段话站不站得住。
                      </div>
                    </div>
                    <div className="start-recent">
                      <div className="start-recent-h">
                        <span>最近看过的报告</span>
                        <button onClick={() => void window.api.workbench.open()}>回看工作台 →</button>
                      </div>
                      {recent.length ? (
                        <div className="start-recent-list">
                          {recent.map((m) => (
                            <button className="start-recent-item" key={m.id} onClick={() => openReport(m.id)}>
                              <b>
                                {m.excerpt.slice(0, 34)}
                                {m.excerpt.length > 34 ? '…' : ''}
                              </b>
                              <span>
                                {new Date(m.at).toLocaleString('zh-CN', {
                                  month: 'numeric',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}{' '}
                                · {m.chars} 字 · 未答 {m.open}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="start-recent-empty">还没有存档。跑完第一份，这里会留着它。</div>
                      )}
                    </div>
                    {/*
                      这段话设定的是期望，所以它必须跟着功能走：
                      加了查谬误模式之后，「这里不检测谬误」就成了假话——
                      它检测，只是不给一串光秃秃的名字。文案与功能不一致，
                      用户会按旧印象低估新功能，或按新名词高估旧承诺，两头都是误读。
                    */}
                    <p>
                      这里不给总分，也不替你站队。模型按这副透镜要问的问题写出判断，软件把它拆成结构、
                      每一处对回原文，让你自己核对哪一处站得住、哪一处倒了。想要「有没有谬误」的名单，
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
                    {/* 目录与逐节读只出现在报告页，首屏不提一句就没人知道它们存在。
                        这里说的是「有什么」，不是替读者规定「该先读哪一节」。 */}
                    <div className="start-navhint">
                      报告出来后，右侧有目录：能跳到任意一节、收起暂时不看的节，也能「逐节读」一次只看一节。
                    </div>
                    {/*
                      报告预览是给「想先看看会得到什么」的人看的，不是开始分析的前提。
                      它原来把首屏撑到要滚两屏，现在收进原生 details：节点仍在 DOM 里，
                      首屏冒烟数的四步一条不少，想看的人点一下就展开。
                    */}
                    <details className="start-more">
                      <summary>先看看报告长什么样</summary>
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
                    </details>
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
        {pair && <SideBySide pair={pair} fmt={when} onClose={() => setPair(null)} />}

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
