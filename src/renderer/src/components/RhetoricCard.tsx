import type { Diagnosis } from '@shared/types';
import {
  CORRECTION_LABEL,
  DEGREE_LABEL,
  FRAME_LABEL,
  FUNC_LABEL,
  HARM_LABEL,
  RHETORIC_BOUNDARY,
  RHETORIC_COLUMNS,
  RHETORIC_ISOLATION,
  RHETORIC_ITEMS,
  SUBSTITUTE_LABEL,
  VERIFIABLE_LABEL,
  auditLine,
  auditRhetoric,
  chainLine,
  promptHasRhetoric,
  rhetoricExpected,
} from '@shared/rhetoric';

/**
 * 修辞审计卡（D-03）：一张八列的表，加上它最要紧的那句话。
 *
 * 为什么要把整张表铺在界面上，而不是给一句「有 2 处修辞替代」：
 * D-03 的复核标准是「第二位分析者能只凭句位编号重跑四步测试」。一句结论做不到这件事——
 * 它既说不出是哪一句、也说不清顶掉的是证据还是推论桥，读者只能选择信或不信。
 *
 * 这张卡不做三件事，三件都写在卡上：
 *   1. 不改档位（档位在判档卡里，审计结果只是 D-01 的输入之一）；
 *   2. 不改命题真假（一段话煽情，不等于它说的事实为假——谬误谬误）；
 *   3. 不做文风点评（「语言偏激」没有句位也没有替代链，那不是审计）。
 *
 * 本地只核「做完了没有」：替代成立的行有没有链、链上四项缺不缺、
 * 说移交 D5 的够不够两条手法。核出来的缺口逐条点名，不替模型补一句判断。
 */
export function RhetoricCard({ d }: { d: Diagnosis }) {
  const a = d.rhetoric;

  if (!a || a.rows.length === 0) {
    // 不走到裁决层的模式本来就没有审计对象：整块不出现，空面板会被读成「漏了」。
    if (!rhetoricExpected(d)) return null;
    const old = !promptHasRhetoric(d.prompt?.version);
    return (
      <div className="rh-none" data-rhetoric-none>
        <b>没有修辞审计表。</b>
        {old
          ? `这份产自 v${d.prompt?.version ?? '未知'}，当时还没有这一层。`
          : '模型这次没做审计。'}
        没有它，「这一段是不是靠情绪／身份／故事顶掉了理由」就没有可复核的位置——只能凭印象说。
      </div>
    );
  }

  const gaps = auditRhetoric(d);
  const blocks = gaps.filter((x) => x.severity === 'block');
  const warns = gaps.filter((x) => x.severity === 'warn');
  const subs = a.rows.filter((r) => r.test === 'substitute').length;

  return (
    <section
      className="rhetoric"
      data-rhetoric
      data-rhetoric-rows={a.rows.length}
      data-rhetoric-chains={a.chains.length}
      data-rhetoric-subs={subs}
    >
      <div className="rh-head">
        <span className="rh-line" data-rhetoric-line={a.rows.length}>
          {auditLine(a)}
        </span>
        {blocks.length === 0 ? (
          <span className="rh-ok">审计表齐全</span>
        ) : (
          <span className="rh-bad">缺 {blocks.length} 项，按 D-03 还没做完</span>
        )}
      </div>

      <div className="rh-which">四项审计：{RHETORIC_ITEMS.join(' / ')}</div>

      <table className="rh-table">
          <thead>
            <tr>
              {RHETORIC_COLUMNS.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {a.rows.map((r, i) => (
              <tr key={`${r.at}-${i}`} data-rhetoric-row={r.at} data-rhetoric-test={r.test}>
                <td className="rh-at">{r.at}</td>
                <td>
                  {/* 三诉求各占一行：横着排会挤成「品格无·情绪辅·理由无」，读的人要自己拆 */}
                  <span className="rh-fn">品格{FUNC_LABEL[r.ethos]}</span>
                  <span className="rh-fn">情绪{FUNC_LABEL[r.pathos]}</span>
                  <span className="rh-fn">理由{FUNC_LABEL[r.logos]}</span>
                </td>
                <td>{r.frame.length ? r.frame.map((f) => FRAME_LABEL[f]).join('、') : '—'}</td>
                <td>{DEGREE_LABEL[r.degree]}</td>
                <td>
                  <span className="rh-dim">{VERIFIABLE_LABEL[r.verifiable]}</span>
                  <span className="rh-dim">{CORRECTION_LABEL[r.corrections]}</span>
                  {r.relay && r.relay.trim() ? <span className="rh-dim">转发链：{r.relay}</span> : null}
                </td>
                <td className={r.test === 'substitute' ? 'rh-sub' : ''}>{SUBSTITUTE_LABEL[r.test]}</td>
                <td>{r.harm.length ? r.harm.map((h) => HARM_LABEL[h]).join('、') : '—'}</td>
                <td className="rh-note-cell">{r.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

      {a.chains.length > 0 && (
        <div className="rh-chains">
          <div className="rh-ct">替代链（{a.chains.length} 条）</div>
          <ul>
            {a.chains.map((c, i) => (
              <li key={i} data-rhetoric-chain={`${c.at}-${c.kind}`} data-rhetoric-replaced={c.replaced}>
                {chainLine(c)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rh-close">
        <span>
          替代链 {a.chains.length} 条 · 与结论强度超载重复 {a.overlaps} 处（同一缺陷只计一次）
        </span>
        <span className="rh-iso" data-rhetoric-iso>
          {RHETORIC_ISOLATION}
        </span>
      </div>

      {gaps.length > 0 && (
        <ul className="rh-gaps">
          {[...blocks, ...warns].map((x, i) => (
            <li key={i} className={x.severity === 'block' ? 'blk' : 'wrn'}>
              {x.text}
            </li>
          ))}
        </ul>
      )}

      <p className="rh-boundary">{RHETORIC_BOUNDARY}</p>
    </section>
  );
}
