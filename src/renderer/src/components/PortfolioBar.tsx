import { useState } from 'react';
import { groupLine, portfolioLine, portfolioText, type PortfolioView } from '@shared/portfolio';

/**
 * 样本账。真应用读本地存档，预览页喂固定假数据，两边是同一个组件。
 *
 * 这一栏是整份报告里唯一一处「字全部不来自模型」的地方：它只数这台机器上
 * 存过几段文字。所以这里不写评价、不给分、不排优先级、不劝人换文本——
 * 连「明细」都是用户按了才展开，默认不占地方。
 *
 * 两种不显示：还没读到（首帧不闪一个 0）、空存档（不编一句「0 组」）。
 * 目录打不开时只显示错误，不显示数字——那份数字不完整，摆出来就是假话。
 */
export function PortfolioBar({
  view,
  dirError,
  fmt,
  initialOpen = false,
}: {
  view: PortfolioView | null;
  dirError?: string | null;
  fmt: (at: number) => string;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);

  if (dirError) {
    return (
      <div className="pf-bar" data-portfolio-bar data-portfolio-error="1">
        <p className="pf-err" data-portfolio-error>
          存档目录读不出来：{dirError}。数目没有显示，因为它们不完整。
        </p>
      </div>
    );
  }
  if (!view) return null;
  const line = portfolioLine(view, fmt);
  if (line === null) return null;

  return (
    <div className="pf-bar" data-portfolio-bar data-portfolio-groups={view.groups}>
      <div className="pf-head">
        <p className="pf-line" data-portfolio-line>
          {line}
        </p>
        <button className="pf-toggle" data-portfolio-open onClick={() => setOpen((o) => !o)}>
          {open ? '收起明细' : '看明细'}
        </button>
      </div>
      {open && (
        <div className="pf-detail" data-portfolio-detail>
          <p className="pf-why">
            逐字相同、或字面重合达到「几乎同一段」的原文归一组；原文为空、文件读不出来的都单独数在总述里。
            这一栏不评价够不够，也不替你选下一段文字。
          </p>
          <ol className="pf-list" data-portfolio-list>
            {view.buckets.map((g) => (
              <li key={g.index} data-portfolio-group>
                {groupLine(g, fmt)}
              </li>
            ))}
          </ol>
          <p className="pf-why">下面这段是纯文本，可以直接复制走；它和上面的每一行逐字相同。</p>
          <textarea
            className="pf-text"
            data-portfolio-text
            readOnly
            rows={Math.min(12, 3 + view.buckets.length)}
            value={portfolioText(view, fmt)}
          />
        </div>
      )}
    </div>
  );
}
