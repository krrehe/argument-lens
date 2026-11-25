import { useEffect, useMemo, useState } from 'react';
import {
  MODE_META,
  normalizeMode,
  type ArchiveFind,
  type ArchiveHealth,
  type ArchiveIssueKind,
  type ObjectionStat,
  type ReportMeta,
} from '@shared/types';
import { highlightParts, parseTerms, WHERE_LABEL } from '@shared/archive-search';
import { LEVEL_LABEL, THEORY_BY_ID } from '@shared/theories';
import { objectionFieldName } from '@shared/objection';
import { formatMoney } from '@shared/tokens';
import {
  DEEP_KINDS,
  DEEP_KIND_LABEL,
  DEEP_STATUSES,
  DEEP_STATUS_LABEL,
  type DeepKind,
  type DeepStatus,
} from '@shared/deep';
import type { DeepArchiveView } from '@shared/deep-archive';

/**
 * 历史面板。
 *
 * 它不是「存档列表」，是**修订链的入口**。每一份报告都可能是一棵树上的一个节点：
 * 从某一版修补出来的下一版，挂着 parentId。所以列表里要能看见「这一份是从哪来的」
 * 以及「它后来又被改了几版」，否则只有一堆时间戳，用户仍然找不到「我上次改的那一版」。
 *
 * 另一半是异议统计：哪几条判定最常被同一个人反对。
 * 单个用户的一次不同意只是意见；同一个位置反复被反对，那就是这个工具的系统性偏差。
 * 这一栏存在的意义，是让那种偏差有机会被发现——不然它只会消失在每次会话里。
 *
 * 这里有三处兜底不是多余的谨慎，是修过的 bug：
 *   透镜名 / 模式 / 档位 都从磁盘读回来。旧存档、手改过的文件、将来删掉的一副透镜，
 *   都会让 `THEORY_BY_ID[x].name` 这类直接取值抛异常——而它抛在 render 里，
 *   后果是整个面板白屏，用户看到的是「历史点不开」，不是「有一条记录坏了」。
 *   未知就照实显示未知，这一条记录仍然可读、可删。
 */

interface Props {
  onOpen: (id: string) => void;
  onClose: () => void;
  /** 预览页用：直接打开某个页签，省得为了拍一张图先点一下。 */
  initialTab?: 'reports' | 'objections' | 'deep';
}

type Tab = 'reports' | 'objections' | 'deep';

/** 终态到样式类的静态映射：拼 `st-${status}` 会让样式检查器只看到一个残缺类名。 */
const DEEP_ST_CLASS: Record<DeepStatus, string> = {
  confirmed: 'hs-st-confirmed',
  weakened: 'hs-st-weakened',
  rejected: 'hs-st-rejected',
  open: 'hs-st-open',
  unresolved: 'hs-st-unresolved',
};

/** 坏文件的三种原因说成人话，且与主进程 `ArchiveIssueKind` 一一对应。 */
const ISSUE_LABEL: Record<ArchiveIssueKind, string> = {
  unreadable: '文件读不出来',
  'invalid-json': '写坏了（JSON 解不开）',
  incomplete: '能解析，但不像一份完整报告',
};

/**
 * 时间说成人话。导出给 App 用——「这段跑过没有」那一行要跟历史面板说同一个时间，
 * 两处各写一份格式化，迟早会出现同一天两种写法。
 */
export function when(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (sameDay) return `今天 ${hm}`;
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${hm}`;
}

export function HistoryPanel({ onOpen, onClose, initialTab = 'reports' }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [list, setList] = useState<ReportMeta[]>([]);
  const [stats, setStats] = useState<ObjectionStat[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** 只读体检结果。null 表示还没读到或读失败，界面不能据此说「一切正常」。 */
  const [health, setHealth] = useState<ArchiveHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  /** 正在等待二次确认的那一份。删除不可逆，且会切断修订对照。 */
  const [confirmId, setConfirmId] = useState<string | null>(null);
  /** 搜索框里的原文。查询串本身不做任何加工，切词与折大小写都在纯函数里。 */
  const [q, setQ] = useState('');
  /** 检索结果。null = 没在搜（或正在搜）；与 `list` 分开，因为来源不同、可能一棵是空的。 */
  const [found, setFound] = useState<ArchiveFind | null>(null);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  /*
   * 深查发现库。与报告列表分开取：它要读全部报告，比列表重；
   * 只有切到这个 tab 才读，读完缓存，不跟着搜索框重扫。
   */
  const [deepView, setDeepView] = useState<DeepArchiveView | null>(null);
  const [deepErr, setDeepErr] = useState<string | null>(null);
  const [deepBad, setDeepBad] = useState(0);
  const [deepLoading, setDeepLoading] = useState(false);
  const [deepStatus, setDeepStatus] = useState<'all' | DeepStatus>('all');
  const [deepKind, setDeepKind] = useState<'all' | DeepKind>('all');
  const [deepQ, setDeepQ] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      /*
       * 体检必须排在列表前面：`list()` 在索引坏时会从磁盘重建并写回 index.json。
       * 顺序反了，体检看到的已经是修好的文件，「索引刚才坏过」这件事就永远报不出来。
       * 两条通道都是只读与自查，串行多花的只是扫一次目录的十几毫秒。
       */
      try {
        const h = await window.api.archive.health();
        if (alive) setHealth(h);
      } catch (err) {
        if (alive) setHealthError((err as Error)?.message ?? '原因不明');
      }
      try {
        const l = await window.api.archive.list();
        if (alive) setList(l);
      } catch (err) {
        /* 列表读失败以前被吞成一张空表，和「还没跑过分析」长得一模一样。 */
        if (alive) setListError((err as Error)?.message ?? '原因不明');
      }
      /* 体检和列表都问过了才允许显示空态，免得「还没有」先闪一下再说有坏文件。 */
      if (alive) setLoaded(true);
    })();
    window.api.objections
      .stats()
      .then(setStats)
      .catch(() => setStats([]));
    return () => {
      alive = false;
    };
  }, []);

  /*
   * 检索。三处细节都有理由：
   *   · 延后 220ms 才读盘——每按一次键就扫一百个文件，输入会一顿一顿的；
   *   · 新查询一开始就清掉上一次的结果：留着它，界面会拿旧结果配新查询，
   *     那个「0 份」可能属于上一句话；
   *   · `alive` 挡乱序返回：慢的那次回来时不许盖掉快的那次。
   */
  useEffect(() => {
    if (!parseTerms(q).length) {
      setFound(null);
      setFinding(false);
      setFindError(null);
      return;
    }
    let alive = true;
    setFinding(true);
    setFound(null);
    setFindError(null);
    const timer = window.setTimeout(() => {
      window.api.archive
        .find(q)
        .then((r) => {
          if (alive) setFound(r);
        })
        .catch((err: unknown) => {
          if (alive) setFindError((err as Error)?.message ?? '原因不明');
        })
        .finally(() => {
          if (alive) setFinding(false);
        });
    }, 220);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [q]);

  const issues = health?.issues ?? [];
  const missing = health?.missing ?? [];
  const orphans = health?.orphans ?? [];
  const dirError = health?.dirError ?? healthError;
  /* 空机器上没有 index.json 是完全正常的，只有磁盘上确实有东西时才算线索。 */
  const indexMissing =
    health?.indexState === 'missing' &&
    (health.healthyFiles > 0 || issues.length > 0 || health.indexEntries > 0);
  const indexBad = health?.indexState === 'invalid' || health?.indexState === 'rebuilt';
  const problemCount =
    issues.length + missing.length + orphans.length + (indexBad ? 1 : 0) + (indexMissing ? 1 : 0);
  const hasProblem = !!dirError || !!listError || problemCount > 0;

  const byId = useMemo(() => new Map(list.map((m) => [m.id, m])), [list]);

  /** 每一份被当作「上一版」引用了几次。修订链要两头都看得见，只显示 parent 是半条。 */
  const revisedCount = useMemo(() => {
    const c = new Map<string, number>();
    for (const m of list) if (m.parentId) c.set(m.parentId, (c.get(m.parentId) ?? 0) + 1);
    return c;
  }, [list]);

  const remove = (id: string) => {
    window.api.archive
      .remove(id)
      .then((l) => {
        setList(l);
        setConfirmId(null);
      })
      .catch(() => setConfirmId(null));
  };

  /* ── 检索的派生值 ── */

  const terms = useMemo(() => parseTerms(q), [q]);
  /** 命中按 id 索引。列表顺序不因检索而重排：先后仍是时间。 */
  const hitById = useMemo(() => new Map((found?.hits ?? []).map((h) => [h.id, h])), [found]);
  const shown = useMemo(
    () => (terms.length ? list.filter((m) => hitById.has(m.id)) : list),
    [list, terms.length, hitById],
  );
  const hitTotal = useMemo(() => (found?.hits ?? []).reduce((n, h) => n + h.count, 0), [found]);
  /**
   * 命中、但列表里没有这一份——索引与磁盘不同步时会出现。
   * 不把它藏掉：两处数字对不上，比少显示一行更像出了事。
   */
  const outOfList = found ? Math.max(0, found.hits.length - shown.length) : 0;
  const searching = terms.length > 0;
  /**
   * 状态条的一个稳定读数。文案会改，状态不该改——所以探针读它，不读那句话。
   * `pending` 是「查询换了、结果还没回来」，这个瞬间既不是命中也不是没有。
   */
  const findState: 'off' | 'error' | 'dir' | 'hit' | 'none' | 'pending' = !searching
    ? 'off'
    : findError
      ? 'error'
      : found?.dirError
        ? 'dir'
        : found
          ? found.hits.length
            ? 'hit'
            : 'none'
          : 'pending';

  /*
   * 深查发现库按需读一次。读失败要说出来：空表会被读成「没有发现」，
   * 而那与「读不出来」是两件事。
   */
  const loadDeep = () => {
    if (deepLoading) return;
    setDeepLoading(true);
    setDeepErr(null);
    window.api.archive
      .deep()
      .then((r) => {
        setDeepView(r.view);
        setDeepErr(r.dirError);
        setDeepBad(r.badFiles);
      })
      .catch((e: Error) => setDeepErr(e?.message ?? '原因不明'))
      .finally(() => setDeepLoading(false));
  };

  /* 预览页可以直接落在「深查发现」页签；真机上它只是一个默认值。 */
  useEffect(() => {
    if (initialTab === 'deep' && !deepView && !deepLoading) loadDeep();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  const deepShown = useMemo(() => {
    const needle = deepQ.trim();
    return (deepView?.items ?? []).filter(
      (x) =>
        (deepStatus === 'all' || x.status === deepStatus) &&
        (deepKind === 'all' || x.kind === deepKind) &&
        (!needle || `${x.title} ${x.detail} ${x.quote} ${x.passageHead}`.includes(needle)),
    );
  }, [deepView, deepStatus, deepKind, deepQ]);

  /*
   * 反复出现的类型由纯函数排好，界面只画。
   * 这里不按相关度重排——历史列表的先后必须仍是时间。
   */
  const deepRepeat = deepView?.repeats ?? [];

  return (
    <div className="mask" onClick={onClose}>
      <div className="dialog hs-dialog" role="dialog" aria-label="历史、我的判断与深查发现" onClick={(e) => e.stopPropagation()}>
        <div className="hs-head">
          <div className="hs-title">历史</div>
          <div className="hs-tabs">
            <button
              className={`hs-tab ${tab === 'reports' ? 'on' : ''}`}
              data-hs-tab="reports"
              title={hasProblem ? `列表里能读到的 ${list.length} 份；另有 ${problemCount} 处对不上，见下方体检` : undefined}
              onClick={() => setTab('reports')}
            >
              报告{' '}
              <span className="hs-n">
                {searching && finding ? `…/${list.length}` : searching ? `${shown.length}/${list.length}` : list.length}
              </span>
            </button>
            <button
              className={`hs-tab ${tab === 'objections' ? 'on' : ''}`}
              data-hs-tab="objections"
              onClick={() => setTab('objections')}
            >
              我不同意过 <span className="hs-n">{stats.length}</span>
            </button>
            <button
              className={`hs-tab ${tab === 'deep' ? 'on' : ''}`}
              data-hs-tab="deep"
              onClick={() => {
                setTab('deep');
                if (!deepView && !deepLoading) loadDeep();
              }}
              title="历次深查找出来的问题，按状态与类型汇总；点一条回到那份报告"
            >
              深查发现 <span className="hs-n">{deepView ? deepView.total : '…'}</span>
            </button>
          </div>
          <div className="hs-spacer" />
          <button className="hs-x" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        {tab === 'reports' && (
          <div className="hs-body">
            <p className="hs-note">
              每跑一次分析都会自动存在这里，报告全文连同原文一起，只在本机。
              <b>它的主要用途不是存档，是验收</b>——补完再判一次，两份就能摆在一起看。
            </p>

            {/*
              检索放在最上面：一百多份之后，滚动条已经不是找东西的办法。
              输入框不加「搜索」按钮——它每敲一个字就搜一次（延后 220ms），
              按钮会让人以为不按就不搜。
            */}
            <div className="hs-find">
              <input
                className="hs-q"
                type="search"
                value={q}
                data-hs-q
                aria-label="在存档里按字面找"
                placeholder="在原文与报告里找字…（多个词用空格分开，都要有）"
                title="按字面找，不认同义词。范围：原文、结论、前提、中间结论、修补、检查依据、判读。"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setQ('');
                }}
              />
              {searching && (
                <button className="hs-q-clear" data-hs-q-clear onClick={() => setQ('')}>
                  清空
                </button>
              )}
            </div>

            {searching && (
              <div className="hs-find-line" data-hs-line data-hs-state={findState}>
                {finding ? (
                  '正在读存档…'
                ) : findError ? (
                  `搜不了：${findError}`
                ) : found?.dirError ? (
                  `存档目录读不出来：${found.dirError}。这时不能断定「没有匹配」。`
                ) : found ? (
                  found.hits.length ? (
                    <>
                      <b>{found.hits.length} 份命中</b> · 共 {hitTotal} 处
                      {found.unreadable > 0 && (
                        <span className="hs-find-soft">
                          ；另有 {found.unreadable} 份读不出来，它们不在结果里
                        </span>
                      )}
                      {outOfList > 0 && (
                        <span className="hs-find-soft">
                          ；另有 {outOfList} 份命中的文件不在列表里（见体检）
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <b>一份都没有匹配</b>
                      <span className="hs-find-soft">
                        （在 {found.scanned} 份里按字面找的
                        {found.unreadable > 0 ? `；另有 ${found.unreadable} 份读不出来，没法搜` : ''}）
                      </span>
                    </>
                  )
                ) : null}
              </div>
            )}

            {searching && (
              <p className="hs-find-note">
                按字面找：不认同义词（搜「晨读」找不到「早读」），多个词要都有。
                范围是原文、结论、前提、中间结论、修补、检查依据、判读——模型写的其余解释不在其中。
                片段里的连续空白被折成一个空格，字没有改。
              </p>
            )}

            {hasProblem && (
              <div className="hs-health" data-archive-health>
                <div className="hs-health-top">
                  <span className="hs-health-dot" />
                  <b>{dirError ? '存档目录读不出来' : `${problemCount} 处存档对不上`}</b>
                  <span className="hs-health-sub">这是只读体检的结果：没有删除、没有改写任何文件。</span>
                </div>
                <div className="hs-health-lines">
                  {dirError && <div>· 目录：{dirError}。这时「0 份」不可信，数目没有显示。</div>}
                  {listError && <div>· 列表读取失败：{listError}</div>}
                  {issues.length > 0 && (
                    <div>· {issues.length} 个报告文件读不出来，列表里可能就少了这几份。</div>
                  )}
                  {missing.length > 0 && (
                    <div>· 索引里有 {missing.length} 条找不到对应文件，点那些行会是空的。</div>
                  )}
                  {orphans.length > 0 && (
                    <div>· 磁盘上有 {orphans.length} 个文件不在索引里：报告还在，只是列表没列出来。</div>
                  )}
                  {indexBad && (
                    <div>
                      · 索引{health?.indexState === 'rebuilt' ? '读到过损坏，列表已按磁盘重建' : '读到损坏'}：
                      {health?.indexReason ?? '原因不明'}。
                    </div>
                  )}
                  {indexMissing && <div>· 索引文件不在，但磁盘上有报告；列表会按磁盘重建。</div>}
                </div>
                <details className="hs-health-more" data-archive-issues>
                  <summary>逐条看文件名与原因</summary>
                  <ul className="hs-health-list">
                    {issues.map((i) => (
                      <li key={`bad-${i.file}`}>
                        <span className="hs-health-file">{i.file}</span>
                        <span className="hs-health-kind">{ISSUE_LABEL[i.kind]}</span>
                        <span>{i.reason}</span>
                      </li>
                    ))}
                    {missing.map((id) => (
                      <li key={`gone-${id}`}>
                        <span className="hs-health-file">{id}.json</span>
                        <span className="hs-health-kind">索引里的幽灵行</span>
                        <span>索引有这一行，磁盘上没有这个文件</span>
                      </li>
                    ))}
                    {orphans.map((n) => (
                      <li key={`orphan-${n}`}>
                        <span className="hs-health-file">{n}.json</span>
                        <span className="hs-health-kind">磁盘上的孤儿</span>
                        <span>文件在，索引里没有这一行</span>
                      </li>
                    ))}
                    {indexBad && (
                      <li>
                        <span className="hs-health-file">index.json</span>
                        <span className="hs-health-kind">索引</span>
                        <span>{health?.indexReason ?? '读到损坏'}</span>
                      </li>
                    )}
                  </ul>
                </details>
                <div className="hs-health-foot">
                  <button className="hs-link" onClick={() => window.api.archive.reveal()}>
                    打开报告文件夹
                  </button>
                  <span className="hs-fine">
                    先看清楚再动手。要恢复请从你自己的备份里拷回来；这里不会替你删、也不会替你修。
                  </span>
                </div>
              </div>
            )}

            {!loaded && <p className="hs-empty">正在读…</p>}
            {loaded && !list.length && (
              <p className="hs-empty" data-archive-empty>
                {dirError
                  ? '目录读不出来，现在没法判断有没有报告。'
                  : issues.length > 0 || orphans.length > 0
                    ? `列表里一行也没有，但磁盘上还有 ${issues.length + orphans.length} 个报告文件读不出来或没进索引。`
                    : '还没有。跑一次分析之后，这里就会出现第一份。'}
              </p>
            )}

            <div className="hs-list">
              {shown.map((m) => {
                const parent = m.parentId ? byId.get(m.parentId) : null;
                const kids = revisedCount.get(m.id) ?? 0;
                const mode = normalizeMode(m.mode);
                const level = LEVEL_LABEL[m.level] ?? m.level;
                const theory = THEORY_BY_ID[m.theory]?.name ?? m.theory;
                const hit = hitById.get(m.id) ?? null;
                return (
                  <div key={m.id} className={`hs-row lv-${m.level}`}>
                    <button className="hs-main" onClick={() => onOpen(m.id)}>
                      <div className="hs-line1">
                        <span className="hs-time">{when(m.at)}</span>
                        <span className="hs-theory">{theory}</span>
                        {/* 给档位的模式默认不标，不给档位的必须标：一份没有档位的报告，不标就看不出为什么没有 */}
                        {mode !== 'diagnose' && (
                          <span className={`hs-mode mode-${mode}`}>{MODE_META[mode].label}</span>
                        )}
                        <span className={`hs-level lv-${m.level}`}>{level}</span>
                        {m.parentId && (
                          <span
                            className="hs-parent"
                            title={parent ? `上一版：${when(parent.at)}` : '上一版已删除'}
                          >
                            ↳ 修订{parent ? ` · ${when(parent.at)}` : '（上一版已删除）'}
                          </span>
                        )}
                        {kids > 0 && <span className="hs-parent">此后改了 {kids} 版</span>}
                      </div>
                      <div className="hs-excerpt" data-hs-excerpt={hit ? 'hit' : 'head'}>
                        {hit ? <Snippet text={hit.snippet} terms={terms} /> : m.excerpt}
                      </div>
                      <div className="hs-meta">
                        {hit && (
                          <span
                            className="hs-where"
                            title={`命中在：${hit.where.map((w) => WHERE_LABEL[w]).join('、')}（共 ${hit.count} 处）`}
                          >
                            {WHERE_LABEL[hit.snippetWhere]} · {hit.count} 处
                          </span>
                        )}
                        <span>{m.chars} 字</span>
                        {m.open > 0 && <span className="open">{m.open} 项没答</span>}
                        {m.cost !== null && <span>{formatMoney(m.cost, '¥')}</span>}
                      </div>
                    </button>
                    <button
                      className={`hs-del ${confirmId === m.id ? 'confirm' : ''}`}
                      title={confirmId === m.id ? '再点一次确认删除' : '删除这一份'}
                      aria-label={confirmId === m.id ? '确认删除这一份' : '删除这一份'}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirmId === m.id) remove(m.id);
                        else setConfirmId(m.id);
                      }}
                    >
                      {confirmId === m.id ? '确认？' : '删'}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="hs-foot">
              <button className="hs-link" onClick={() => window.api.archive.reveal()}>
                打开报告文件夹
              </button>
              <span className="hs-fine">
                删掉的报告不会回到「上一版对照」里。要留证据的话，先别删。
              </span>
            </div>
          </div>
        )}

        {tab === 'objections' && (
          <div className="hs-body">
            <p className="hs-note">
              你对某些判定的不同意见。这里<b>不改报告</b>——报告按它自己的标准写，你保留不同意见。
              同一个位置反复被反对，就是这个工具最可能出错的地方。
            </p>

            {!stats.length && (
              <p className="hs-empty">
                还没有。在报告里任何一条判定下面都有「不同意」——包括判读、每一条检查、命名候选、此处合法。
              </p>
            )}

            <div className="hs-list">
              {stats.map((s) => (
                <div key={s.key} className="hs-obj">
                  <div className="hs-line1">
                    <span className="hs-theory">{THEORY_BY_ID[s.theory]?.name ?? s.theory}</span>
                    <span className="hs-field">{objectionFieldName(s.field)}</span>
                    <span className="hs-ref">{s.refLabel || s.refId}</span>
                    {s.count > 1 && <span className="hs-count">反对 {s.count} 次</span>}
                    <span className="hs-obj-time">{when(s.lastAt)}</span>
                  </div>
                  <div className="hs-obj-q">{s.excerpt}</div>
                  {s.reasons.length > 0 && (
                    <ul className="hs-reasons">
                      {s.reasons.slice(0, 4).map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>

            <div className="hs-foot">
              <button className="hs-link" onClick={() => window.api.objections.reveal()}>
                打开异议文件夹
              </button>
            </div>
          </div>
        )}

        {tab === 'deep' && (
          <div className="hs-body">
            <p className="hs-note">
              本机所有深查报告里的发现，按时间从新到旧汇总。<b>只汇总已落盘的账本</b>，不重新分析，
              也不判发现真假；点一条回到那份报告，发现栏在报告最前面。
            </p>

            {deepLoading && !deepView && <p className="hs-empty">正在读本机存档…</p>}
            {deepErr && (
              <p className="hs-empty">
                读不出来：{deepErr}。这不是「没有发现」，是这次没读到；可以关上再开一次。
              </p>
            )}

            {!deepErr && deepView && (
              <>
                <div className="hs-deep-sum" data-deep-sum>
                  <span><b>{deepView.reports}</b> 份深查报告</span>
                  <span><b>{deepView.total}</b> 条发现</span>
                  <span><b>{deepView.unlocated}</b> 条落不到原文</span>
                  {deepBad > 0 && <span className="hs-deep-warn">另有 {deepBad} 份读不出来</span>}
                </div>
                {deepRepeat.length > 0 && (
                  <p className="hs-deep-repeat" data-deep-repeat>
                    反复出现：
                    {deepRepeat.map((x, i) => (
                      <span key={x.kind}>
                        {i > 0 ? '、' : ''}
                        {DEEP_KIND_LABEL[x.kind]}（{x.reports} 份）
                      </span>
                    ))}
                  </p>
                )}

                {deepView.total === 0 ? (
                  <p className="hs-empty" data-deep-empty>
                    还没有深查发现。在分析页把模式切到「深查」跑一段；旧报告没有账本，不会被补造。
                  </p>
                ) : (
                  <>
                    <div className="hs-deep-filters">
                      <button
                        className={`hs-deep-chip ${deepStatus === 'all' ? 'on' : ''}`}
                        onClick={() => setDeepStatus('all')}
                      >
                        全部 {deepView.total}
                      </button>
                      {DEEP_STATUSES.map((s) => (
                        <button
                          key={s}
                          className={`hs-deep-chip ${deepStatus === s ? 'on' : ''}`}
                          onClick={() => setDeepStatus(s)}
                        >
                          {DEEP_STATUS_LABEL[s]} {deepView.byStatus[s]}
                        </button>
                      ))}
                      <select
                        className="hs-deep-select"
                        value={deepKind}
                        onChange={(e) => setDeepKind(e.target.value as 'all' | DeepKind)}
                        aria-label="按发现类型筛选"
                      >
                        <option value="all">所有类型</option>
                        {DEEP_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {DEEP_KIND_LABEL[k]}
                          </option>
                        ))}
                      </select>
                      <input
                        className="hs-deep-q"
                        value={deepQ}
                        onChange={(e) => setDeepQ(e.target.value)}
                        placeholder="找标题、引文或原文"
                        aria-label="在深查发现里查找"
                      />
                    </div>

                    <div className="hs-list">
                      {deepShown.map((x) => (
                        <button
                          key={`${x.reportId}-${x.findingId}`}
                          className="hs-deep-item"
                          data-deep-arc={`${x.reportId}-${x.findingId}`}
                          onClick={() => onOpen(x.reportId)}
                          title="打开这份报告；深查发现是报告第一节"
                        >
                          <span className="hs-line1">
                            <span className={`hs-deep-st ${DEEP_ST_CLASS[x.status]}`}>
                              {DEEP_STATUS_LABEL[x.status]}
                            </span>
                            <span className="hs-deep-kind">{DEEP_KIND_LABEL[x.kind]}</span>
                            <b className="hs-deep-title">{x.title}</b>
                          </span>
                          <span className="hs-deep-meta">
                            {when(x.at)} ·{' '}
                            {THEORY_BY_ID[x.theory as keyof typeof THEORY_BY_ID]?.name ?? x.theory} ·{' '}
                            {x.passageHead || '（原文为空）'}
                          </span>
                          {x.quote && <span className="hs-deep-quote">「{x.quote}」</span>}
                        </button>
                      ))}
                      {deepShown.length === 0 && <p className="hs-empty">没有符合筛选的发现。</p>}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 片段与加亮。
 *
 * 切词、找词都由纯函数做，这里只把「是不是命中」翻成一个 span：
 * 界面上不再有一套自己的匹配规则——两套规则迟早会在同一个片段上给出两种加亮，
 * 而图上看不出哪一套错了。
 */
function Snippet({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlightParts(text, terms).map((p, i) => (
        <span key={i} className={p.hit ? 'hs-hit' : undefined}>
          {p.t}
        </span>
      ))}
    </>
  );
}
