import { OVERALL_NOTE, locationLabel } from '@shared/overall';
import type { Diagnosis } from '@shared/types';

/**
 * 整体分析。
 *
 * 与首屏那条「五环主线」的分工写在这里，免得后来人把两块合并：
 *   主线回答「这个论证为什么有问题」，一环扣一环，末了落到档位；
 *   这一块回答「把这段话当一个整体看，它在做什么、哪里最强、哪里最弱」，
 *   是模型写下的一段整体判断，本地只排版、不补一句。
 *
 * 它不参与判读，也不与档位互相折算：两处说法不一致时，判读栏为准。
 */
export function OverallCard({ d }: { d: Diagnosis }) {
  const o = d.overall;
  if (!o) return null;
  const paras = o.summary
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean);
  return (
    <div className="ov" data-overall="1">
      {paras.map((p, i) => (
        <p className="ov-p" key={i}>
          {p}
        </p>
      ))}
      {(o.strongest || o.weakest) && (
        <div className="ov-pair">
          {o.strongest && (
            <div className="ov-cell" data-overall-point="strongest">
              <div className="ov-k">
                最强的一处
                {o.strongest.at ? <span className="ov-at">{locationLabel(d, o.strongest.at)}</span> : null}
              </div>
              <div className="ov-what">{o.strongest.what}</div>
              {o.strongest.why ? <div className="ov-why">{o.strongest.why}</div> : null}
            </div>
          )}
          {o.weakest && (
            <div className="ov-cell" data-overall-point="weakest">
              <div className="ov-k">
                最弱的一处
                {o.weakest.at ? <span className="ov-at">{locationLabel(d, o.weakest.at)}</span> : null}
              </div>
              <div className="ov-what">{o.weakest.what}</div>
              {o.weakest.why ? <div className="ov-why">{o.weakest.why}</div> : null}
            </div>
          )}
        </div>
      )}
      {o.ifOneChange && (
        <div className="ov-one" data-overall-change="1">
          <div className="ov-k">
            如果只改一处
            {o.ifOneChange.at ? <span className="ov-at">{locationLabel(d, o.ifOneChange.at)}</span> : null}
          </div>
          <div className="ov-what">{o.ifOneChange.change}</div>
          {o.ifOneChange.because ? <div className="ov-why">{o.ifOneChange.because}</div> : null}
        </div>
      )}
      <p className="ov-note">{OVERALL_NOTE}</p>
    </div>
  );
}
