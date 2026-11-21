/*
 * 文档页头部（Notion Showcase 那张图的骨架）。
 *
 * 这不是新功能：面包屑、封面、emoji、大标题、meta 胶囊只是把「这份报告是谁」
 * 的信息换成文档页的呈现方式。字段全部来自调用方已有的数据——透镜名、字数、
 * 判定档位——不新增任何业务数据，也不编造 Created/Version 这类没有的东西：
 * 没有的字段就不显示，宁可少一行也不编。
 */
import type { ReactNode } from 'react';

export interface DocHeadProps {
  /** 面包屑，最后一项是当前位置。 */
  crumbs: string[];
  /** emoj：文档页的视觉锚点，一个字符。 */
  emoji?: string;
  /** 大标题。 */
  title: string;
  /** 一句话副标题。 */
  subtitle?: string;
  /** meta 行右侧的胶囊，通常是判定档位。 */
  status?: string;
  /** meta 行的其他字段（透镜 / 字数 / 时间等），逐条 shallow 文本。 */
  meta?: string[];
  /** 封面下方、标题上方可选的 Callout（例如「这份报告判的是哪一段」）。 */
  callout?: ReactNode;
}

export function DocHead({ crumbs, emoji = '📄', title, subtitle, status, meta = [], callout }: DocHeadProps) {
  return (
    <header className="doc-page">
      <nav className="doc-crumbs" aria-label="位置">
        {crumbs.map((c, i) => (
          <span key={i} className="crumb-wrap">
            {i > 0 && <span className="sep" aria-hidden="true">/</span>}
            <span className={`crumb ${i === crumbs.length - 1 ? 'here' : ''}`}>{c}</span>
          </span>
        ))}
      </nav>

      <div className="doc-cover" aria-hidden="true" />

      <div className="doc-inner">
        <div className="doc-emoji" aria-hidden="true">{emoji}</div>

        <div className="doc-head">
          <h1 className="doc-title">{title}</h1>
          {subtitle && <p className="doc-subtitle">{subtitle}</p>}

          <div className="doc-meta">
            {status && <span className="doc-pill">{status}</span>}
            {meta.map((m, i) => (
              <span className="mi" key={i}>
                {i > 0 && <span className="dot" aria-hidden="true">·</span>}
                <b>{m}</b>
              </span>
            ))}
          </div>

          {callout && (
            <aside className="doc-callout">
              <span className="ci" aria-hidden="true">💡</span>
              <div>{callout}</div>
            </aside>
          )}
        </div>
      </div>
    </header>
  );
}
