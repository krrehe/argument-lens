import type { Diagnosis } from '@shared/types';
import { verdictTrail } from '@shared/verdict-trail';

/**
 * 「为什么在这一格」。
 *
 * 判读栏原来只有指针和结论，中间那一步是空的：读者看到「在这里」，却看不到
 * **凭什么在这儿、凭什么是这一格而不是隔壁**。这一步一旦补上，报告就从
 * 「一个结论」变成一次示范——读者能学会自己问那几关，那才是这份东西可迁移的部分。
 *
 * 所以这里刻意分成两半：
 *   上：事实链（问了几关 → 钉住它的是哪一关 → 按定义 → 所以是这一格）
 *   下：三格对照（同一段话落在另外两格会是什么意思）
 * 上半是这次的分析，下半是这个方法。下半比上半更重要，因为上半只能读一次。
 */
export function VerdictWhy({ d, onGotoCheck }: { d: Diagnosis; onGotoCheck: (id: string) => void }) {
  const { steps, ladder, note, forced } = verdictTrail(d);
  const undetermined = d.verdict.level === 'undetermined';

  return (
    <div className="vwhy">
      <div className="vwhy-head">
        <span className="vh-t">为什么在这一格</span>
        <span className="vh-s">
          {undetermined
            ? '这一档不是量出来的，是由规则排除出来的——下面是排到这儿的那一步'
            : '判读不是算出来的：把这副尺子的问题一关一关问过去，答案自己会落到某一格'}
        </span>
      </div>

      <ol className="vtrail">
        {steps.map((s, i) => (
          <li key={s.k} className={`vstep ${s.tone} ${s.checkId ? 'linked' : ''}`}>
            <span className="vs-n">{i + 1}</span>
            <span className="vs-main">
              <span className="vs-head">{s.head}</span>
              <span className="vs-body">{s.body}</span>
            </span>
            {s.checkId && (
              <button className="vs-go" onClick={() => onGotoCheck(s.checkId as string)}>
                看这一关 →
              </button>
            )}
          </li>
        ))}
      </ol>

      {note && <p className="vwhy-note">{note}</p>}

      <div className="vladder">
        <div className="vl-cap">
          <span className="vl-lead">
            {!undetermined && <span className="vl-n">3</span>}
            <b>{undetermined ? '这一步到此为止' : `所以落在「${ladder.find((l) => l.current)?.label ?? ''}」这一格`}</b>
          </span>
          <span className="vl-sub">
            {undetermined
              ? '这三格是量出来的三种下场。「判不了」不在其中——它是这把尺子量不了，不是量出的结果，混进去等于把「没量」说成一个刻度'
              : '同一段话落在另外两格会是什么意思。一档的意思，只有在和邻居比的时候才清楚'}
          </span>
        </div>
        <div className="vl-row">
          {ladder.map((l) => (
            <div key={l.level} className={`vl-cell ${l.level} ${l.current ? 'now' : ''}`}>
              <span className="vl-name">
                {l.label}
                {l.current && <i className="vl-here">本次</i>}
              </span>
              <span className="vl-mean">{l.meaning || '这副尺子没写这一档的解释'}</span>
            </div>
          ))}
        </div>
      </div>

      {forced && (
        <div className="vforced">
          <b>程序改过这一档</b>
          <span className="vf-code">{forced.code}</span>
          {forced.message}
        </div>
      )}
    </div>
  );
}
