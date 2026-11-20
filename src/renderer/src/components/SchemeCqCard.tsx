import type { Diagnosis } from '@shared/types';
import {
  ANSWER_LABEL,
  SCHEME_CQ_BOUNDARY,
  SCHEME_CQ_ISOLATION,
  SOURCE_LABEL,
  auditSchemeCq,
  cqLine,
} from '@shared/scheme-cq';

/**
 * 型式—CQ 对表卡（C-04 + C-03）。
 *
 * 为什么不是一句「检查表 3 项」：读者看不出那 3 项是不是这一型该问的 3 项。
 * 这一段用「相关—因果」，表内第 8 型最低集有四问，而库内只列了三问——
 * 少的那一问是「机制」。这一栏把三种缺席分开摆：
 *
 *   本库没有：库的 23 个型式里，这一问压根不在题目集里（要改库，不是要模型补答）；
 *   报告未登记：库里有这一问，报告却找不到编号（要模型补答）；
 *   不适用：文本没给它机会，按 C-03 不计入分母。
 *
 * 它不做三件事，也都写在卡上：不改档位、不改命题真假、不判这一问答得对不对。
 * 表外型式不套最低集——十九型是封闭清单，不新造第 20 型。
 */
export function SchemeCqCard({ d }: { d: Diagnosis }) {
  const a = auditSchemeCq(d);

  // 非 walton 透镜的检查项是规则与三问，不是型式 CQ。整块不出现，
  // 空面板会被读成「这一型没有该问的问题」。
  if (!a) return null;

  if (!a.row) {
    return (
      <div className="scq scq-out" data-scheme-cq data-scq-table="out">
        <div className="scq-head">
          <span className="scq-line">{cqLine(a)}</span>
          <span className="scq-tag">不套最低集</span>
        </div>
        <p className="scq-why" data-scq-why>
          {a.why}
        </p>
        <p className="scq-boundary">{SCHEME_CQ_BOUNDARY}</p>
      </div>
    );
  }

  const { row, counts } = a;

  return (
    <section
      className="scq"
      data-scheme-cq
      data-scq-table="in"
      data-scq-no={row.no}
      data-scq-min={counts.min}
      data-scq-registered={counts.registered}
      data-scq-libgap={counts.libraryGap}
      data-scq-unlisted={counts.unlisted}
    >
      <div className="scq-head">
        <span className="scq-line" data-scq-line>
          {cqLine(a)}
        </span>
        <span className="scq-src" data-scq-source={row.source} title="这一型在 C-04 表里的来源层级">
          来源 · {SOURCE_LABEL[row.source]}
        </span>
      </div>

      <p className="scq-point">
        <b>判定要点</b>（只用来核对读数有没有跑题，不替代逐条登记）：{row.point}
      </p>

      <table className="scq-table">
        <thead>
          <tr>
            <th>问</th>
            <th>这一问要问什么</th>
            <th>库内</th>
            <th>报告</th>
          </tr>
        </thead>
        <tbody>
          {a.rows.map((r) => (
            <tr
              key={r.cq.no}
              data-scq-row={r.cq.no}
              data-scq-gap={r.gap ?? 'none'}
              data-scq-answer={r.check?.answer ?? 'none'}
            >
              <td className="scq-no">
                {r.cq.no}
                {r.cq.key ? <span className="scq-key">关键</span> : null}
              </td>
              <td>{r.cq.ask}</td>
              <td className={r.cover ? 'scq-lib' : 'scq-miss'}>{r.cover ?? '没有这一问'}</td>
              <td className={r.check ? 'scq-got' : 'scq-miss'}>
                {r.check ? `${r.check.id} · ${ANSWER_LABEL[r.check.answer]}` : r.gap === 'library-gap' ? '—' : '未登记'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {counts.libraryGap > 0 && (
        <ul className="scq-notes">
          {a.rows
            .filter((r) => r.gap === 'library-gap')
            .map((r) => (
              <li key={r.cq.no} data-scq-note={r.cq.no}>
                <b>本库没有第 {r.cq.no} 问</b>：{r.coverNote}
              </li>
            ))}
        </ul>
      )}

      {a.extra.length > 0 && (
        <p className="scq-extra" data-scq-extra={a.extra.length}>
          表外追加 {a.extra.length} 问（C-04 允许按对话协议追加，须单列计数）：{' '}
          {a.extra.map((c) => `${c.id} ${ANSWER_LABEL[c.answer]}`).join('、')}
        </p>
      )}

      <p className="scq-example">
        <b>微型示例</b>（构造的，不是判据，也不是案例）：{row.example}
      </p>

      <div className="scq-close">
        <span>
          最低集内：登记 {counts.registered} · 过 {counts.passed} · 不过 {counts.violated} · 未答 {counts.unanswered}
          {counts.na > 0 ? ` · 不适用 ${counts.na}` : ''}
        </span>
        <span className="scq-iso">{SCHEME_CQ_ISOLATION}</span>
      </div>

      <p className="scq-boundary">{SCHEME_CQ_BOUNDARY}</p>
    </section>
  );
}
