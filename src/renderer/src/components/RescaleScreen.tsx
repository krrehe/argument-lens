import { useMemo, useState } from 'react';
import { type Diagnosis } from '@shared/types';
import { REREAD_KIND_LABEL, rereadOf } from '@shared/reread';
import { RESCALE_CONFLICT_LABEL, RESCALE_INVALID_LABEL, RESCALE_STATUS_LABEL, rescaleOf, type RescalePair } from '@shared/rescale';

/**
 * 「换个尺度重读」：用户给词，本地换，两栏并排。
 *
 * 与「回到原文」共用一套句子边界，所以报告里指着某一句的条目能按句挂到旁边。
 * 这一屏同样不写判断：原句是 passage 的原样切片，换过的一栏只由用户给的词
 * 与原文剩余的字拼成（内核 @shared/rescale 有断言守着可逆性），条目逐字引自报告。
 *
 * 词由用户填，是刻意的：软件一旦预设「这段话该把什么换成什么」，
 * 就又替人做了一次判断，这里也就退回成一份生成好的东西。
 */
export function RescaleScreen({
  d,
  initialPairs,
  onBack,
}: {
  d: Diagnosis;
  initialPairs?: RescalePair[];
  onBack: () => void;
}) {
  const [pairs, setPairs] = useState<RescalePair[]>(() =>
    initialPairs?.length
      ? initialPairs.map((p) => ({ from: p.from, to: p.to }))
      : [{ from: '', to: '' }, { from: '', to: '' }],
  );
  const scaled = useMemo(() => rescaleOf(d.passage ?? '', pairs), [d.passage, pairs]);
  const rr = useMemo(() => rereadOf(d), [d]);
  const edit = (i: number, key: keyof RescalePair, value: string) =>
    setPairs((ps) => ps.map((p, j) => (j === i ? { ...p, [key]: value } : p)));
  /* 没命中时不显示「换过」那一栏：摆一句和原文一模一样的话，看着像换过其实没换。 */
  const showChanged = scaled.status === 'ok';

  return (
    <div className="rs-screen" data-rescale>
      <div className="rs-head">
        <button className="rr-back" data-rescale-back onClick={onBack}>
          ← 回报告
        </button>
        <h2>换个尺度读</h2>
        <p className="rs-lead">
          只换你填的那几个词，其余一个字不动。情境变小了，推理还是原来那副骨架——
          换过之后每句话还读不读得通，由你自己看。
        </p>
        <p className="rs-lead2">
          用的是这份报告当时分析的原文，不是输入框里现在的字。下面挂着的条目是报告里写下的原话，
          没有跟着替换；这里也不替你判断换过之后谁对谁错。
        </p>
      </div>

      <div className="rs-pairs" data-rescale-pairs>
        {pairs.map((p, i) => (
          <div className="rs-pair" key={i}>
            <input
              className="rs-input"
              data-rescale-from
              aria-label={`第 ${i + 1} 组：原文里的词`}
              placeholder="原文里的词，例如 早读"
              value={p.from}
              onChange={(e) => edit(i, 'from', e.target.value)}
            />
            <span className="rs-arrow">→</span>
            <input
              className="rs-input"
              data-rescale-to
              aria-label={`第 ${i + 1} 组：换成什么`}
              placeholder="换成什么，例如 午休"
              value={p.to}
              onChange={(e) => edit(i, 'to', e.target.value)}
            />
            <button
              className="rs-del"
              onClick={() => setPairs((ps) => (ps.length > 1 ? ps.filter((_, j) => j !== i) : ps))}
              disabled={pairs.length <= 1}
            >
              去掉
            </button>
          </div>
        ))}
        <button className="rs-add" onClick={() => setPairs((ps) => [...ps, { from: '', to: '' }])}>
          加一组
        </button>
      </div>

      <div className="rs-stat" data-rescale-stat>
        {showChanged
          ? `替换 ${scaled.hitCount} 处 · 其余 ${scaled.unchangedChars} 字未动 · 共 ${scaled.sentences.length} 句`
          : RESCALE_STATUS_LABEL[scaled.status]}
        {scaled.invalid.length > 0 && ` · ${scaled.invalid.map((x) => RESCALE_INVALID_LABEL[x]).join('、')}`}
        {scaled.missing.length > 0 && ` · 没找到：${scaled.missing.join('、')}`}
        {scaled.conflicts.length > 0 && ` · ${scaled.conflicts.length} 处没有换`}
      </div>

      {scaled.conflicts.length > 0 && (
        <div className="rs-notice" data-rescale-conflicts>
          <b>{scaled.conflicts.length} 处没有换</b>
          <ul>
            {scaled.conflicts.map((c, i) => (
              <li key={i}>
                「{c.from}」在第 {c.start + 1} 字：{RESCALE_CONFLICT_LABEL[c.reason]}
                {c.keptBy && `（由「${c.keptBy}」占了这一处）`}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rs-list">
        {scaled.sentences.map((s) => {
          const refs = rr.sentences[s.index]?.refs ?? [];
          return (
            <div className="rs-s" data-rescale-sentence key={s.index}>
              <div className="rs-s-head">
                <span className="rs-n">第 {s.index + 1} 句</span>
                <span className="rs-hits">{s.edits.length ? `换了 ${s.edits.length} 处` : '这一句没有换'}</span>
              </div>
              <div className="rs-row">
                <span className="rs-tag">原文</span>
                <div className="rs-original" data-rescale-original>{s.original}</div>
              </div>
              {showChanged && (
                <div className="rs-row rs-row-changed">
                  <span className="rs-tag">换过</span>
                  <div className="rs-changed" data-rescale-changed>{s.rescaled}</div>
                </div>
              )}
              {refs.length > 0 && (
                <div className="rs-refs">
                  {refs.map((r, i) => (
                    <div className={`rs-ref rr-ref-${r.kind}`} data-rescale-ref key={`${r.kind}-${r.id}-${i}`}>
                      <span className="rr-kind">{REREAD_KIND_LABEL[r.kind]}</span>
                      <span className="rr-id">{r.id}</span>
                      <span className="rr-body">{r.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="rs-boundary">
        这里只做字面替换：不做同义扩展，不猜哪个词是「主体」，也不替换换出来的字。
        同一个词在别处可能是另一个意思——那要你自己读原文。
      </p>
      <button className="rr-back rr-back-bottom" data-rescale-back onClick={onBack}>
        读完了，回报告
      </button>
    </div>
  );
}

