import { useState } from 'react';
import type { Diagnosis } from '@shared/types';
import {
  DEEP_CAVEAT,
  DEEP_EMPTY_NOTE,
  DEEP_KIND_LABEL,
  DEEP_STATUS_LABEL,
  deepLine,
  deepSummary,
  type DeepReport,
} from '@shared/deep';
import { locationLabel } from '@shared/overall';

/**
 * 深查发现账本。
 *
 * 只排版模型写下的候选：类型、标题、细节、落点/引文、理论依据、什么会改变它、
 * 第二遍的最强反驳与状态。本地只标「落点/引文/理论依据有没有对上」，不判发现真假。
 */
export function DeepFindings({
  d,
  deep,
  onOpenClaim,
  onLocate,
  onLocateQuote,
}: {
  d: Diagnosis;
  deep: DeepReport;
  onOpenClaim?: (id: string) => void;
  onLocate?: (id: string) => void;
  onLocateQuote?: (quote: string) => void;
}) {
  const sum = deepSummary(deep);
  const line = deepLine(deep);
  /*
   * 默认只露前五条。这一栏要读的是文字，一屏塞十几条会把总结与下面的诊断
   * 一起推走；但也不能替人砍掉——第六条之后折起来，写明还有几条。
   */
  const [all, setAll] = useState(false);
  const shown = all ? deep.findings : deep.findings.slice(0, 5);
  return (
    <div className="dp" data-deep-findings data-deep-count={sum.total} data-deep-unlocated={sum.unlocated}>
      <p className="dp-line" data-deep-line>
        {line ?? DEEP_EMPTY_NOTE}
      </p>
      <p className="dp-caveat">{DEEP_CAVEAT}</p>

      {shown.map((f) => (
        <article
          className="dp-find"
          key={f.id}
          data-deep-finding={f.id}
          data-deep-status={f.status}
        >
          <div className="dp-head">
            <span className="dp-kind">{DEEP_KIND_LABEL[f.kind]}</span>
            <b className="dp-title">{f.title}</b>
            <span className={`dp-status dp-status-${f.status}`} data-deep-status-label>
              {DEEP_STATUS_LABEL[f.status]}
            </span>
          </div>

          {f.detail && <p className="dp-detail">{f.detail}</p>}

          <div className="dp-meta">
            {f.targetId &&
              (f.targetOk && onLocate ? (
                <button
                  type="button"
                  className="dp-target dp-loc"
                  data-deep-target={f.targetId}
                  data-deep-target-ok="1"
                  onClick={() => onLocate(f.targetId)}
                  title="在报告里定位这一处"
                >
                  落点：{locationLabel(d, f.targetId)}
                </button>
              ) : (
                <span className="dp-target" data-deep-target-ok={f.targetOk ? '1' : '0'}>
                  落点：{f.targetOk ? locationLabel(d, f.targetId) : `${f.targetId}（报告里找不到这个位置）`}
                </span>
              ))}
            {f.quote &&
              (f.quoteOk && onLocateQuote ? (
                <button
                  type="button"
                  className="dp-quote dp-loc"
                  data-deep-quote
                  data-deep-quote-ok="1"
                  onClick={() => onLocateQuote(f.quote)}
                  title="在原文里定位这一句"
                >
                  原文：「{f.quote}」
                </button>
              ) : (
                <span className="dp-quote" data-deep-quote-ok={f.quoteOk ? '1' : '0'}>
                  原文：「{f.quote}」{f.quoteOk ? '' : '（与原文对不上）'}
                </span>
              ))}
            {f.theoryRef &&
              (f.theoryOk && onOpenClaim ? (
                <button
                  type="button"
                  className="dp-theory"
                  data-deep-theory={f.theoryRef}
                  onClick={() => onOpenClaim(f.theoryRef)}
                  title="在主张库里看这一条"
                >
                  理论依据：{f.theoryRef}
                </button>
              ) : (
                <span className="dp-theory-miss" data-deep-theory-miss={f.theoryRef}>
                  理论依据：{f.theoryRef}
                  {f.theoryOk ? '' : '（主张库里没有这一条）'}
                </span>
              ))}
          </div>

          {f.ifChanged && <p className="dp-if">什么会改变它：{f.ifChanged}</p>}
          {f.challenge && <p className="dp-challenge">最强反驳：{f.challenge}</p>}
        </article>
      ))}

      {deep.findings.length > 5 && (
        <button
          type="button"
          className="dp-more"
          data-deep-more
          onClick={() => setAll((v) => !v)}
          title={all ? '只显示前五条' : `还有 ${deep.findings.length - 5} 条，展开全部`}
        >
          {all ? '收起，只显示前五条' : `展开全部（${deep.findings.length} 条）`}
        </button>
      )}

      {deep.unlocated.length > 0 && (
        <div className="dp-unlocated" data-deep-unlocated-list>
          <h3 className="dp-sub">落不到原文的候选</h3>
          <p className="dp-caveat">这些没有被丢掉；它们只是没有能对上原文或检查项的位置，所以不混进上面的计数。</p>
          <ul className="dp-unlocated-list">
            {deep.unlocated.map((u, i) => (
              <li key={i}>
                <b>{u.title}</b>
                {u.detail ? `：${u.detail}` : ''}
                {u.why ? <span className="dp-why">（{u.why}）</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
