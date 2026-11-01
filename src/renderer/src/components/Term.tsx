import { createContext, useContext, type ReactNode } from 'react';
import { GLOSSARY, GLOSSARY_GROUPS } from '../glossary';

/**
 * 「说人话」开关的全局状态。
 *
 * 为什么用开关而不是直接把术语全换掉：术语不是装饰，它是这套分析的骨架。
 * 去掉术语，六副透镜就分不清谁是谁了。所以做法是——默认说人话，术语仍然在，
 * 只是每个术语旁边都欠着读者一句解释，开关只决定这句解释现在出不出现。
 */
export const PlainCtx = createContext(true);
export const usePlain = () => useContext(PlainCtx);

/** 术语。悬停出解释；解释里不再出现别的术语。 */
export function Term({ k, children }: { k: string; children?: ReactNode }) {
  const g = GLOSSARY[k];
  const label = children ?? g?.term ?? '';
  if (!g) return <>{label}</>;
  const tip = `${g.term}：${g.plain}${g.more ? `\n\n${g.more}` : ''}${g.eg ? `\n\n例：${g.eg}` : ''}`;
  return (
    <span className="term" tabIndex={0} title={tip}>
      {label}
    </span>
  );
}

/** 术语表。不是一个可有可无的帮助页——它是「通俗」这条要求的兑现方式。 */
export function GlossaryDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="mask" onClick={onClose}>
      <div className="dialog glossary" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">术语表：每个词都配了一句人话</div>
        <div className="dialog-body gloss-body">
          <p className="hint" style={{ marginBottom: 4 }}>
            看结果时卡在哪个词，回来查一下就行。不用背——这里每个词在正文里都有同样的悬停解释。
          </p>
          {GLOSSARY_GROUPS.map((g) => (
            <div key={g.name} className="gloss-group">
              <div className="gg-name">{g.name}</div>
              {g.items.map((it) => (
                <div key={it.k} className="gg-item">
                  <div className="gg-line">
                    <span className="gg-term">{it.term}</span>
                    <span className="gg-plain">{it.plain}</span>
                  </div>
                  {it.more && <div className="gg-more">{it.more}</div>}
                  {it.eg && <div className="gg-eg">例：{it.eg}</div>}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="dialog-foot">
          <button className="ghost-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
