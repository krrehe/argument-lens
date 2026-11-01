import { useEffect, useMemo, useState } from 'react';
import { MODE_META, normalizeMode, type ObjectionStat, type ReportMeta } from '@shared/types';
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

function when(at: number): string {
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
  /** 正在等待二次确认的那一份。删除不可逆，且会切断修订对照。 */
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    window.api.archive
      .list()
      .then((l) => {
        setList(l);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    window.api.objections
      .stats()
      .then(setStats)
      .catch(() => setStats([]));
  }, []);

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
            <button className={`hs-tab ${tab === 'reports' ? 'on' : ''}`} onClick={() => setTab('reports')}>
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

            {!loaded && <p className="hs-empty">正在读…</p>}
            {loaded && !list.length && (
              <p className="hs-empty">还没有。跑一次分析之后，这里就会出现第一份。</p>
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
                        {/* 判定类模式默认不标，描述类必须标：一份没有档位的报告，不标就看不出为什么没有 */}
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
