import { useMemo, useState } from 'react';
import { CONDITION_MARK_LABEL, CONDITION_PROBLEM_LABEL, conditionsOf, conditionsText, type ConditionInput, type ConditionMark } from '@shared/conditions';

/**
 * 「自己列成立条件」：三个重读动作里唯一**完全不显示报告文字**的一屏。
 *
 * 前两屏把报告里指着某一句的条目搬回原文旁边，读者先看见的仍然是软件写下的话。
 * 这里刻意不渲染报告：一旦报告在旁边，人就会先读它，再拿自己的话去迁就它。
 * 于是这一屏只有三样东西——原文、你自己写的条件、你自己点的那句原文。
 *
 * 软件只做四件可复算的事：切句（与另两屏同一套边界）、按坐标把引文挂到条件上、
 * 把还没被问到的句子摆出来、把整张清单拼成纯文本。**不判、不打分、不排优先级、不落盘。**
 * 三态按钮是人的标记，不是软件给出的结论；点「原文给了」不会让界面说这一条成立。
 */
export function ConditionScreen({
  passage,
  initialItems,
  onBack,
}: {
  passage: string;
  initialItems?: ConditionInput[];
  onBack: () => void;
}) {
  const [items, setItems] = useState<ConditionInput[]>(() =>
    initialItems?.length
      ? initialItems.map((x, i) => ({ ...x, id: x.id || `c${i}` }))
      : [
          { id: 'c1', text: '', mark: 'unknown' as ConditionMark, sentence: null },
          { id: 'c2', text: '', mark: 'unknown' as ConditionMark, sentence: null },
          { id: 'c3', text: '', mark: 'unknown' as ConditionMark, sentence: null },
        ],
  );
  const cv = useMemo(() => conditionsOf(passage, items), [passage, items]);
  const take = useMemo(() => conditionsText(cv), [cv]);
  const patch = (i: number, p: Partial<ConditionInput>) =>
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));

  return (
    <div className="rr-screen" data-conditions>
      <div className="rr-head">
        <button className="rr-back" data-conditions-back onClick={onBack}>
          ← 回报告
        </button>
        <h2>自己列成立条件</h2>
        <p className="rr-lead">
          要让这段话的结论站住，得先满足什么？先自己写下来，再回原文逐句找它给没给。
          软件不替你列条件，也不替你判哪一条满没满足。
        </p>
        <p className="rr-lead2">
          主区只有原文和你自己写的东西，不显示报告里的任何一句话（左边那栏还是应用本来的样子）。
          三态是你自己的标记；同一句可以挂好几条；点了句子却没写、或点了不存在的句子，都逐条说出来。
          原文是这份报告当时分析的那段文字。
        </p>
      </div>

      <div className="rr-stat" data-conditions-stat>
        写了 {cv.counts.written} 条 · 标了 {cv.counts.marked} 条 · {cv.counts.linked} 条挂到了原文 · 问到{' '}
        {cv.counts.askedSentences} 句（共 {cv.sentences.length} 句） · 还有 {cv.unasked.length} 句没被问到
      </div>

      <div className="cl-items" data-conditions-items>
        {items.map((it, i) => {
          const r = cv.rows[i];
          return (
            <div className="cl-item" data-conditions-item key={it.id}>
              <div className="cl-item-head">
                <span className="cl-num">第 {i + 1} 条</span>
                <button
                  className="cl-del"
                  onClick={() => setItems((xs) => (xs.length > 1 ? xs.filter((_, j) => j !== i) : xs))}
                  disabled={items.length <= 1}
                >
                  去掉
                </button>
              </div>
              <textarea
                className="cl-write"
                data-conditions-textarea
                aria-label={`第 ${i + 1} 条成立条件`}
                placeholder="写一句你自己的问法，例如：得先排除别的原因吗"
                rows={2}
                value={it.text}
                onChange={(e) => patch(i, { text: e.target.value })}
              />
              <div className="cl-controls">
                <div className="cl-marks">
                  {(['unknown', 'yes', 'no'] as ConditionMark[]).map((m) => (
                    <button
                      className={`cl-mark${it.mark === m ? ' cl-mark-on' : ''}`}
                      data-conditions-mark={m}
                      key={m}
                      onClick={() => patch(i, { mark: m })}
                    >
                      {CONDITION_MARK_LABEL[m]}
                    </button>
                  ))}
                </div>
                <select
                  className="cl-pick"
                  data-conditions-pick
                  aria-label={`第 ${i + 1} 条挂在原文哪一句`}
                  value={it.sentence === null ? '' : String(it.sentence)}
                  onChange={(e) => patch(i, { sentence: e.target.value === '' ? null : Number(e.target.value) })}
                >
                  <option value="">不挂原文句子</option>
                  {cv.sentences.map((s) => (
                    <option key={s.index} value={s.index}>
                      挂到第 {s.index + 1} 句
                    </option>
                  ))}
                </select>
              </div>
              {r?.quote !== null && r?.quote !== undefined && (
                <div className="cl-quote" data-conditions-quote>
                  <span className="rr-kind">原文第 {(r.sentence ?? 0) + 1} 句</span>
                  <span className="cl-quote-text">{r.quote}</span>
                </div>
              )}
              {r?.problem && (
                <div className="cl-problem" data-conditions-problem>
                  {CONDITION_PROBLEM_LABEL[r.problem]}
                </div>
              )}
            </div>
          );
        })}
        <button
          className="cl-add"
          onClick={() =>
            setItems((xs) => [...xs, { id: `c${Date.now()}-${xs.length}`, text: '', mark: 'unknown', sentence: null }])
          }
        >
          加一条
        </button>
      </div>

      <h3 className="cl-sect">原文（逐字，一个字没改）</h3>
      <div className="rr-list" data-conditions-passage>
        {cv.sentences.map((s) => {
          const asked = cv.asked.includes(s.index);
          return (
            <div className={`rr-s${asked ? '' : ' rr-s-quiet'}`} data-conditions-sentence key={s.index}>
              <div className="rr-s-head">
                <span className="rr-n">第 {s.index + 1} 句</span>
                {asked ? (
                  <span className="cl-s-asked">有条件问到它</span>
                ) : (
                  <span className="rr-none" data-conditions-unasked>
                    还没有哪条条件问到这一句
                  </span>
                )}
              </div>
              <div className="rr-text">{s.text}</div>
            </div>
          );
        })}
      </div>

      {cv.unasked.length > 0 && (
        <div className="cl-unasked" data-conditions-unasked-list>
          <b>还有 {cv.unasked.length} 句没被问到</b>
          <span>只是「还没人问」，不是说这几句不重要。</span>
          <span>{cv.unasked.map((i) => `第 ${i + 1} 句`).join('、')}</span>
        </div>
      )}

      <div className="cl-take">
        <div className="cl-take-head">
          <b>带走这张清单</b>
          <span>这一屏不存盘，关掉就没了。要留就点一下下面这段字，自己复制走。</span>
        </div>
        <textarea
          className="cl-text"
          data-conditions-take
          readOnly
          value={take}
          onFocus={(e) => e.currentTarget.select()}
        />
      </div>

      <p className="rs-boundary">
        这里只做字面上的对位：不做同义匹配，不替你找「意思差不多的那一句」，也不把几个标记合成一个结论。
        不落盘，所以没有写文件失败这回事；代价是关掉就没了，界面上写明了。
      </p>
      <button className="rr-back rr-back-bottom" data-conditions-back onClick={onBack}>
        写完了，回报告
      </button>
    </div>
  );
}

