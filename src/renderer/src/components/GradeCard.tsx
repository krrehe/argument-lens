import type { Diagnosis } from '@shared/types';
import {
  CONFIDENCE_LABEL,
  GRADE_BOUNDARY,
  GRADE_LABEL,
  auditGrade,
  gradeExpected,
  promptHasGrade,
} from '@shared/grading';

/**
 * 判档记录卡：D0–D5 与「这份记录齐不齐」。
 *
 * 为什么要有这一块：D-01 第九节把「档位必须挂原文位置、未过的 CQ、降级条件，
 * 缺一不算判决，只算感觉」写成硬边界。原来判定那一格只有一个「削弱」，
 * 读者无从知道它是 D2（补证据就行）还是 D3（得换型式）——而这两件事的处置完全不同。
 *
 * 三件事分开说，不许混成一句：
 *   1. 档位本身（D 几、什么名字、按哪一条判据）；
 *   2. 记录齐不齐。缺「缺陷位置」或「降级条件」时，按体系这一份还不能当判决读，
 *      界面要说出来，而不是照样渲染成一个自信的档位；
 *   3. D5 的三道闸门。D5 是门槛不是刻度，没有协同闸门的记录就不是 D5。
 *
 * 本地不改档位。这里只把模型写下的记录摆出来，并把缺口点名——
 * 缺口是「记录不齐」，不是「本地认为该判另一档」。
 */
export function GradeCard({ d }: { d: Diagnosis }) {
  const g = d.verdict.grade;

  if (!g) {
    // 不给档位的模式本来就没有 D 档，这一块整块不出现：空面板会被读成「漏了」。
    if (!gradeExpected(d)) return null;
    const old = !promptHasGrade(d.prompt?.version);
    return (
      <div className="grade-none" data-grade-none>
        <b>没有 D 档记录。</b>
        {old
          ? `这份产自 v${d.prompt?.version ?? '未知'}，当时还没有 D0–D5 这一层。`
          : '模型这次没给 D 档。'}
        它给的档位是本工具的四档粗桶，与体系的六档不能直接对表——粗桶说不清是「补证据」还是「换型式」。
      </div>
    );
  }

  const gaps = auditGrade(d);
  const blocks = gaps.filter((x) => x.severity === 'block');
  const warns = gaps.filter((x) => x.severity === 'warn');

  return (
    <section className="gradecard" data-grade={g.level} data-grade-gap={blocks.length}>
      <div className="ghead">
        <span className={`glv g-${g.level.toLowerCase()}`}>{g.level}</span>
        <span className="glb">{GRADE_LABEL[g.level]}</span>
        <span className="gcl">触发 {g.clause}</span>
        {blocks.length === 0 ? (
          <span className="gok">记录齐全</span>
        ) : (
          <span className="gbad">
            缺 {blocks.length} 项，按 D-01 还不算判决
          </span>
        )}
      </div>

      <dl className="grows">
        <div>
          <dt>缺陷位置</dt>
          <dd>{g.at.length ? g.at.join('、') : g.level === 'D0' || g.level === 'D1' ? '无（全过）' : '—'}</dd>
        </div>
        <div>
          <dt>必要证据</dt>
          <dd>{g.evidence || '—'}</dd>
        </div>
        <div>
          <dt>处置</dt>
          <dd>{g.fix || '—'}</dd>
        </div>
        <div>
          <dt>降级条件</dt>
          <dd>{g.downgrade || '—'}</dd>
        </div>
      </dl>

      {g.level === 'D5' && (
        <div className="ggates" data-grade-gates>
          <div className="ggt">D5 三道闸门（缺一不得算 D5）</div>
          <div className="ggate">
            <span className="gk">后果</span>
            <span>{g.d5?.consequence || '未记录'}</span>
          </div>
          <div className="ggate">
            <span className="gk">协同</span>
            <span>{g.d5?.synergy || '未记录'}</span>
          </div>
          <div className="ggate">
            <span className="gk">协议</span>
            <span>{g.d5?.protocol || '未记录'}</span>
          </div>
          {(g.d5?.removed.length ?? 0) > 0 && (
            <ul className="gremoved">
              {g.d5?.removed.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {gaps.length > 0 && (
        <ul className="ggaps">
          {[...blocks, ...warns].map((x, i) => (
            <li key={i} className={x.severity === 'block' ? 'blk' : 'wrn'}>
              {x.text}
            </li>
          ))}
        </ul>
      )}

      {d.confidence && (
        <div className="gconf">
          <span className="gk">评估置信度</span>
          {CONFIDENCE_LABEL[d.confidence.level]}
          {d.confidence.why ? `｜${d.confidence.why}` : ''}
          <span className="gconf-note">与档位并列，不折算</span>
        </div>
      )}

      <p className="gnote">{GRADE_BOUNDARY}</p>
    </section>
  );
}
