import type { PivotView } from '@shared/pivot';

/**
 * 枢纽前提：这一段压在谁身上，而谁正是要被争的那件事。
 *
 * 排版上的两个决定：
 *
 *   1. 主句放在最上面，一整行。「他把 X 当前提用了，而 X 是争点」这句话如果混在
 *      十行卡片里，读者还是要自己拼——而它本来就是这一栏唯一想说的话。
 *   2. 每条的争点信号逐条列出，不合并成「有 N 个问题」。合并之后读者只能相信数字，
 *      看到清单才能挑出「这一条我不同意」——这一栏的价值全在他能不能反驳。
 */
export function PivotCard({ v }: { v: PivotView }) {
  if (!v.rows.length || !v.top) {
    return (
      <div className="pvt">
        <p className="pvt-none">
          {v.line}
          {v.counts.support + v.counts.silent > 0
            ? '——没有一条同时「结论经过它」且「有人不同意」。这不是好话也不是坏话：可能是这段论证确实单薄到没什么可争，也可能是报告没把争点记下来。'
            : ''}
        </p>
        <p className="pvt-fine">{v.orderNote}</p>
      </div>
    );
  }

  return (
    <div className="pvt">
      {v.headline && (
        <p className="pvt-head" data-pivot-top={v.top.id}>
          {v.headline}
        </p>
      )}

      <p className="pvt-line">{v.line}</p>

      {v.rows.map((r) => (
        <div className="pvt-row" key={r.id} data-pivot={r.id} data-kind={r.kind}>
          <div className="pvt-l">
            <span className={`pvt-badge k-${r.kind}`}>{r.badge}</span>
            <span className={`id-badge${r.implicit ? ' impl' : ''}`}>{r.id}</span>
            <span className="pvt-role">
              {r.roleLabel}
              {r.implicit ? '·补出的' : ''}
            </span>
          </div>
          <div className="pvt-b">
            <div className="pvt-text">{r.text}</div>
            <div className="pvt-meta">
              <span>{r.kind === 'noisy' ? '结论不经过它' : `到结论 ${r.steps} 步`}</span>
              {r.substitutes !== null && (
                <span>
                  {r.substitutes === 0 ? '这一步只有它一个支撑者' : `同一步还有 ${r.substitutes} 个替补`}
                </span>
              )}
              <span>一垮连带 {r.falls.length} 条</span>
            </div>
            <ul className="pvt-sig">
              {r.signals.map((s, i) => (
                <li key={`${s.kind}-${i}`} data-sig={s.kind}>
                  {s.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}

      {v.nextToCheck && (
        <p className="pvt-next" data-pivot-next="">
          {v.nextToCheck}
        </p>
      )}

      <p className="pvt-fine">{v.orderNote}</p>
      <p className="pvt-fine">
        这一栏不说「所以这条是假的」。它只把「结论压在谁身上」和「谁身上已经有反对意见」两件事摆到一起——
        剩下那一步由你来判。另外它靠的是报告里落盘的支撑关系：那份结构要是模型随手写的，这一栏就是在把一张错的结构画得更精细。
      </p>
    </div>
  );
}
