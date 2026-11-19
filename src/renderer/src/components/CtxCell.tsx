import type { ReactNode } from 'react';
import type { ContextField, ContextGrounding } from '@shared/types';
import { SOURCE_LABEL } from '@shared/context-use';

/**
 * 语境的一格。
 *
 * 三件事写在同一格里，顺序是「这格读不读 → 值是什么 → 凭什么」：
 *   1. 徽章：原文／推出／假定／没标。没有它，读者只能猜这是从原文抄的还是编的；
 *   2. 「读」标记：本透镜的判定是否真的用这一格（依赖表在 @shared/context-use）。
 *      七格里常常只有两三格进判定，其余是给人看的地图——不标出来，
 *      读者会把「受众判错了」当成会影响图尔明布局结论的事；
 *   3. 依据与 ifChanged：非 known 的格才写。known 的依据就是原文本身，
 *      在值里已经看得见，再抄一遍只是把一屏字变长。
 *
 * 从 Diagnosis.tsx 拆出来，是为了不把巨石再撑大——那里的组件数有冻结线，
 * 只允许继续拆，不允许继续往里塞。
 */
export function CtxCell({
  field,
  name,
  value,
  g,
  used,
}: {
  field: ContextField;
  name: ReactNode;
  value: ReactNode;
  g?: ContextGrounding;
  used: boolean;
}) {
  const src = g?.source ?? 'unmarked';
  return (
    <div data-ctx-field={field}>
      <div className="k">
        {name}
        <span
          className={`ctxbadge s-${src}${g?.downgraded ? ' down' : ''}`}
          title={
            g?.downgraded
              ? '它自称引自原文，但原文里找不到这句——已按「推出」处理'
              : src === 'known'
                ? '能从原文里指出这个说法'
                : src === 'inferred'
                  ? '由原文的某些特征推出来的'
                  : src === 'guess'
                    ? '原文没写，为把分析做下去而假定'
                    : '这一格没有标出处'
          }
        >
          {SOURCE_LABEL[src]}
        </span>
        {used && (
          <span className="ctxused" title="本透镜的判定读这一格；其余几格只是给人看的地图">
            读
          </span>
        )}
      </div>
      <div className="v">{value}</div>
      {src !== 'known' && g?.basis && <div className="ctx-basis">凭什么：{g.basis}</div>}
      {g?.ifChanged && <div className="ctx-if">换成别的样子：{g.ifChanged}</div>}
    </div>
  );
}
