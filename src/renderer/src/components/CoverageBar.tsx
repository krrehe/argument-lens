import { useMemo, useState } from 'react';
import type { Diagnosis } from '@shared/types';
import { coverageOf, COVERAGE_LABEL } from '@shared/coverage';

/**
 * 长文覆盖账：报告主体里的第二条「事实条」。
 *
 * 与来源账（SourceBar）并列但口径不同：来源账说「判断是谁写的」，这一条说
 * 「原文哪些句子被报告条目落上了」。两者不合并，也不互相解释。
 *
 * 只在长文本上渲染。短文本的引文覆盖本来就高，摆一条 100% 的账是空面板——
 * 不是「这一栏在短文本上没内容」，而是「这一栏根本不该出现」。
 *
 * 文字全部取自 `@shared/coverage`，这里不另写一句抬头或边界；
 * 不劝、不打分、不排优先级、不落盘，也不改判定。
 */
export function CoverageBar({ d }: { d: Diagnosis }) {
  const [open, setOpen] = useState(false);
  const v = useMemo(() => coverageOf(d), [d]);

  if (!v.long) return null;

  const rows = v.segments.filter((s) => s.pinned === 0 && s.sentences > 0);

  return (
    <div
      className="cv-bar"
      data-coverage="1"
      data-coverage-sentences={v.sentences}
      data-coverage-pinned={v.pinned}
      data-coverage-segments={v.segmentCount}
      data-coverage-untouched={v.untouched}
    >
      <div className="cv-head">
        <span className="cv-tag">{COVERAGE_LABEL.title}</span>
        <span className="cv-headline" data-coverage-headline>{v.headline}</span>
        <button
          className="cv-toggle"
          data-coverage-toggle=""
          aria-expanded={open}
          onClick={() => setOpen((x) => !x)}
        >
          {COVERAGE_LABEL.toggle} · {open ? '收起' : '展开'}
        </button>
      </div>

      {open && (
        <div className="cv-list" data-coverage-list="1">
          <div className="cv-colhead">
            {COVERAGE_LABEL.colHead}（{rows.length} 段）
          </div>
          {rows.length === 0 && <div className="cv-empty">{COVERAGE_LABEL.empty}</div>}
          {rows.length > 0 && (
            <div className="cv-scroll">
              {rows.map((r) => (
                <div className="cv-row" data-coverage-row={r.index} key={r.index}>
                  <span className="cv-n">第 {r.index + 1} 段</span>
                  <span className="cv-meta">{r.chars} 字 · {r.sentences} 句</span>
                  <span className="cv-preview">
                    {r.preview}{r.previewTruncated ? '…' : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="cv-note" data-coverage-note="1">{COVERAGE_LABEL.note}</div>
        </div>
      )}
    </div>
  );
}
