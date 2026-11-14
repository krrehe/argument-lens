import { useEffect, useMemo, useState } from 'react';
import {
  MODE_META,
  normalizeMode,
  type ArchiveHealth,
  type ArchiveIssueKind,
  type ObjectionStat,
  type ReportMeta,
} from '@shared/types';
import { LEVEL_LABEL, THEORY_BY_ID } from '@shared/theories';
import { objectionFieldName } from '@shared/objection';
import { formatMoney } from '@shared/tokens';

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
}

type Tab = 'reports' | 'objections';

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

export function HistoryPanel({ onOpen, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('reports');
  const [list, setList] = useState<ReportMeta[]>([]);
  const [stats, setStats] = useState<ObjectionStat[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** 只读体检结果。null 表示还没读到或读失败，界面不能据此说「一切正常」。 */
  const [health, setHealth] = useState<ArchiveHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  /** 正在等待二次确认的那一份。删除不可逆，且会切断修订对照。 */
  const [confirmId, setConfirmId] = useState<string | null>(null);

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

  return (
    <div className="mask" onClick={onClose}>
      <div className="dialog hs-dialog" role="dialog" aria-label="历史与我的判断" onClick={(e) => e.stopPropagation()}>
        <div className="hs-head">
          <div className="hs-title">历史</div>
          <div className="hs-tabs">
            <button
              className={`hs-tab ${tab === 'reports' ? 'on' : ''}`}
              title={hasProblem ? `列表里能读到的 ${list.length} 份；另有 ${problemCount} 处对不上，见下方体检` : undefined}
              onClick={() => setTab('reports')}
            >
              报告 <span className="hs-n">{list.length}</span>
            </button>
            <button className={`hs-tab ${tab === 'objections' ? 'on' : ''}`} onClick={() => setTab('objections')}>
              我不同意过 <span className="hs-n">{stats.length}</span>
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
              {list.map((m) => {
                const parent = m.parentId ? byId.get(m.parentId) : null;
                const kids = revisedCount.get(m.id) ?? 0;
                const mode = normalizeMode(m.mode);
                const level = LEVEL_LABEL[m.level] ?? m.level;
                const theory = THEORY_BY_ID[m.theory]?.name ?? m.theory;
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
                      <div className="hs-excerpt">{m.excerpt}</div>
                      <div className="hs-meta">
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
      </div>
    </div>
  );
}
