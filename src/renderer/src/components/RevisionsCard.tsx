import { REVISIONS_NOTE, locationLabel, revisionShortfall } from '@shared/overall';
import type { Diagnosis } from '@shared/types';

/**
 * 三种改法与代价。
 *
 * 三条规矩，缺一条这块就退回许愿池：
 *   - 每种改法必须写代价（解析层已经丢掉没写代价的，这里再兜一次空值）；
 *   - 不排序、不打分：三种改法不是一条尺子的三档；
 *   - 少给就照实说少给，本地不替模型补第三种。
 */
export function RevisionsCard({ d }: { d: Diagnosis }) {
  const list = d.revisions;
  if (!list || list.length === 0) return null;
  const short = revisionShortfall(list);
  return (
    <div className="rv" data-revisions="1">
      {short ? <p className="rv-short">{short}</p> : null}
      {list.map((r, i) => (
        <div className="rv-item" key={`${r.kind}-${i}`}>
          <div className="rv-head">
            <span className="rv-no">{i + 1}</span>
            <span className="rv-kind">{r.kind}</span>
            {r.fixes.length > 0 ? (
              <span className="rv-fix">修的是 {r.fixes.map((id) => locationLabel(d, id)).join('、')}</span>
            ) : null}
          </div>
          <p className="rv-change">{r.change}</p>
          <dl className="rv-meta">
            {r.keeps ? (
              <>
                <dt>保住了</dt>
                <dd>{r.keeps}</dd>
              </>
            ) : null}
            <dt>代价</dt>
            <dd>{r.cost}</dd>
            {r.leaves ? (
              <>
                <dt>仍然没解决</dt>
                <dd>{r.leaves}</dd>
              </>
            ) : null}
          </dl>
        </div>
      ))}
      <p className="rv-note">{REVISIONS_NOTE}</p>
    </div>
  );
}
