import { REREAD_KIND_LABEL, UNPLACED_LABEL, type RereadView } from '@shared/reread';

/**
 * 「回到原文重读」是一整屏，不是报告末尾又添的一个板块。
 *
 * 这一屏不写判断：句子是 passage 的原样切片，条目文字逐字引自报告，
 * 位置由 span / 唯一引文算出来（内核在 @shared/reread，有断言守着）。
 * 变化只发生在读者身上——原来按栏目分开读的东西，现在按句子聚到一起：
 * 同一句上「被点了名」和「此处合法」挨着摆，某一句谁都没提，也明说出来。
 */
export function RereadScreen({ view, onBack }: { view: RereadView; onBack: () => void }) {
  const mapped = view.sentences.length - view.quietCount;
  return (
    <div className="rr-screen" data-reread>
      <div className="rr-head">
        <button className="rr-back" data-reread-back onClick={onBack}>
          ← 回报告
        </button>
        <h2>回到原文</h2>
        <p className="rr-lead">原文没有变化。这里只把报告里已经写下的、指着某一句的条目，搬回那一句旁边。</p>
        <p className="rr-lead2">
          同一句上若同时挂着「命名」和「此处合法」，两条都留着——报告里本来就有这两句话，
          只是分开摆着时看不出来。
        </p>
      </div>

      <div className="rr-stat" data-reread-stat>
        共 {view.sentences.length} 句 · {mapped} 句有条目指着 · {view.quietCount} 句没人提
        {view.unplaced.length > 0 && ` · 另有 ${view.unplaced.length} 条没能指回位置`}
      </div>

      <div className="rr-list">
        {view.sentences.map((s) => (
          <div className={`rr-s${s.quiet ? ' rr-s-quiet' : ''}`} data-reread-sentence key={s.index}>
            <div className="rr-s-head">
              <span className="rr-n">第 {s.index + 1} 句</span>
              {s.quiet && (
                <span className="rr-none" data-reread-quiet>
                  这一句，报告里没有哪一条指到它
                </span>
              )}
            </div>
            <div className="rr-text">{s.text}</div>
            {s.refs.length > 0 && (
              <div className="rr-refs">
                {s.refs.map((r, i) => (
                  <div className={`rr-ref rr-ref-${r.kind}`} data-reread-ref key={`${r.kind}-${r.id}-${i}`}>
                    <span className="rr-kind">{REREAD_KIND_LABEL[r.kind]}</span>
                    <span className="rr-id">{r.id}</span>
                    <span className="rr-body">{r.text}</span>
                    {r.quote && <span className="rr-quote">原文：{r.quote}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {view.unplaced.length > 0 && (
        <div className="rr-unplaced" data-reread-unplaced>
          <b>另有 {view.unplaced.length} 条没能指回原文位置</b>
          <span>没位置不等于没有发现；逐条留在这里，不替它们猜一句。</span>
          <ul>
            {view.unplaced.map((u, i) => (
              <li key={i}>
                <span className="rr-kind">{REREAD_KIND_LABEL[u.kind]}</span>
                <span className="rr-id">{u.id}</span>
                <span>{UNPLACED_LABEL[u.reason]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button className="rr-back rr-back-bottom" data-reread-back onClick={onBack}>
        读完了，回报告
      </button>
    </div>
  );
}

