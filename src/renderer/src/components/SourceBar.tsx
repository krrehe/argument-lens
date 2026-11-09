import { useMemo, useState } from 'react';
import type { Diagnosis } from '@shared/types';
import { provenanceOf, SOURCE_LABEL } from '@shared/provenance';

/**
 * 报告最上面的一条来源账。
 *
 * 它不分析、不评价、不给建议：只把「模型给出的判断有几处」与「本地复算的
 * 有哪几类、各几处」摆出来。文字全部来自 `@shared/provenance`，这里不另写一句，
 * 免得界面与那条可复算的口径慢慢说成两件事。
 *
 * 默认只占两行；清单要点开才出现——默认展开等于替人决定先读什么。
 * 这一块不是判定，也不落盘，关掉就没了。
 */
export function SourceBar({ d }: { d: Diagnosis }) {
  const [open, setOpen] = useState(false);
  const p = useMemo(() => provenanceOf(d), [d]);

  return (
    <div className="src-bar" data-source-bar>
      <div className="src-head">
        <span className="src-tag" data-source-model-count={p.modelPoints}>
          {SOURCE_LABEL.model} {p.modelPoints} 处
        </span>
        <button className="src-toggle" data-source-toggle onClick={() => setOpen((v) => !v)}>
          {SOURCE_LABEL.local} {p.localPoints} 处 · {open ? '收起' : '展开'}
        </button>
      </div>
      <div className="src-headline" data-source-headline>{p.headline}</div>
      {open && (
        <div className="src-list" data-source-list>
          {p.localRows.map((r) => (
            <div className="src-row" data-source-row={r.key} key={r.key}>
              <span className="src-from">{SOURCE_LABEL[r.from]}</span>
              <span className="src-label">{r.label}</span>
              <span className="src-count">{r.count} 处</span>
            </div>
          ))}
          <div className="src-note" data-source-note>{p.note}</div>
        </div>
      )}
    </div>
  );
}
