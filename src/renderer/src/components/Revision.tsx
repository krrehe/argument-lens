import { useState } from 'react';
import type { RevisionDiff } from '@shared/compare';
import type { CheckAnswer } from '@shared/types';
import { answerText, levelFromText, TREND_LABEL } from '@shared/compare';
import type { CheckDeltaKind } from '@shared/compare';
import { C, Legend } from './Diagram';

/**
 * 修订对照条。
 *
 * 放在报告最上面，因为它回答的是「这次改动值不值」——读者拿到一份新报告，
 * 第一个问题就是这个，而不是「这一份说了什么」。
 *
 * 三条呈现规矩：
 *   1. **不合并成分数。** 只有分项：档位、未答数、明确没过的数、检查项逐条移动。
 *      压成一个百分比就是把六套理论压成一个仪表盘。
 *   2. **不可比要占满整行。** 透镜换了、模式换了、文本改动过大——这三种情况下
 *      「前后对照」这个说法本身不成立，必须先说这个，再谈数字。
 *   3. **好消息和坏消息同时在场。** 「未答的少了」和「明确没过的多了」经常一起出现，
 *      只报前一个就是在替用户高兴。
 */

const TREND_CLASS: Record<string, string> = {
  advanced: 'ok',
  regressed: 'bad',
  flat: 'flat',
  mixed: 'mixed',
  'not-comparable': 'na',
};

const DELTA_TEXT: Record<CheckDeltaKind, string> = {
  resolved: '答上了',
  regressed: '反而没过',
  'still-open': '仍没答',
  shifted: '有移动',
  same: '没动',
};

/**
 * 走向图。
 *
 * 治的是「数字表格看不出方向」。六项数字并排摆着，读者得自己在脑子里
 * 把它们合成一个判断：到底变好了还是变坏了。这张图把每一条检查项的移动
 * 画成一根线——线的斜率就是方向，线的颜色就是好坏。
 *
 * 只画可比的那些。透镜换了、模式换了、文本改动过大时，同一条检查项在两个刻度上
 * 不是同一件事，画一根「从没过到过」的线等于宣布一个不存在的进步。
 */
const KIND_COLOR: Record<CheckDeltaKind, string> = {
  resolved: C.strong,
  regressed: C.invalid,
  'still-open': C.weak,
  shifted: C.accent,
  same: C.lineStrong,
};

const FLOW_ROWS: CheckAnswer[] = ['passed', 'violated', 'unanswered', 'not-applicable'];

export function RevisionFlow({ diff }: { diff: RevisionDiff }) {
  const W = 700;
  const rowH = 44;
  const top = 34;
  const H = top + FLOW_ROWS.length * rowH + 16;
  const xL = 150;
  const xR = 520;
  const yOf = (a: CheckAnswer) => top + FLOW_ROWS.indexOf(a) * rowH + rowH / 2;

  const items = diff.checks;
  if (!items.length) return null;

  return (
    <div className="diagram" style={{ margin: '2px 0 10px' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, height: 'auto', display: 'block', margin: '0 auto' }} role="img" aria-label="修订走向">
        <text x={xL} y={18} fontSize={10.5} fill={C.ink3} textAnchor="middle">
          上一版
        </text>
        <text x={xR} y={18} fontSize={10.5} fill={C.ink3} textAnchor="middle">
          这一版
        </text>

        {FLOW_ROWS.map((a) => {
          const y = yOf(a);
          return (
            <g key={a}>
              <line x1={xL} y1={y} x2={xR} y2={y} stroke={C.line} strokeWidth={1} />
              <text x={xL - 12} y={y + 4} fontSize={10.5} fill={C.ink3} textAnchor="end">
                {answerText(a)}
              </text>
              <text x={xR + 12} y={y + 4} fontSize={10.5} fill={C.ink3}>
                {answerText(a)}
              </text>
            </g>
          );
        })}

        {items.map((c) => {
          const y1 = yOf(c.from);
          const y2 = yOf(c.to);
          const color = KIND_COLOR[c.kind];
          const dx = (xR - xL) * 0.35;
          return (
            <g key={c.id}>
              <path
                d={`M${xL},${y1} C${xL + dx},${y1} ${xR - dx},${y2} ${xR},${y2}`}
                fill="none"
                stroke={color}
                strokeWidth={c.kind === 'same' ? 1.1 : 2}
                strokeDasharray={c.kind === 'same' ? '4 3' : undefined}
                opacity={c.kind === 'same' ? 0.7 : 1}
              />
              <circle cx={xL} cy={y1} r={3} fill={color} />
              <circle cx={xR} cy={y2} r={3.6} fill={color} />
              <text x={xR + 46} y={y2 + 4} fontSize={9.5} fill={C.ink3}>
                {c.id}
              </text>
            </g>
          );
        })}
      </svg>

      <Legend
        items={[
          { kind: 'line', label: '答上了（未答 → 过）', color: C.strong },
          { kind: 'line', label: '反而没过（过 → 没过）', color: C.invalid },
          { kind: 'line', label: '仍没答', color: C.weak },
          { kind: 'dash', label: '没动' },
        ]}
      />
    </div>
  );
}

export function RevisionBar({ diff, onOpenParent }: { diff: RevisionDiff; onOpenParent: () => void }) {
  const [open, setOpen] = useState(false);
  const moved = diff.checks.filter((c) => c.kind !== 'same');

  return (
    <div className={`rv-bar ${TREND_CLASS[diff.trend]}`}>
      <button className="rv-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="rv-k">与上一版对照</span>
        <span className={`rv-trend ${TREND_CLASS[diff.trend]}`}>{TREND_LABEL[diff.trend]}</span>
        <span className="rv-headline">{diff.headline}</span>
        <span className="rv-toggle">{open ? '收起' : '看详情'}</span>
      </button>

      {/*
        不可比的理由放在折叠外面。它一出现，下面所有数字都不该被当成升降——
        收进「看详情」等于让用户先读了错误的结论再去看更正。
      */}
      {!diff.comparable && diff.caveats.length > 0 && (
        <ul className="rv-caveats rv-lead">
          {diff.caveats.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}

      {open && (
        <div className="rv-detail">
          {/*
            走向图放在六项数字之前：数字要读者自己合成方向，图直接把方向画出来。
            不可比时不画——那时候「从没过到过」不代表进步，画了就是宣布一个不存在的好消息。
          */}
          {diff.comparable ? (
            <RevisionFlow diff={diff} />
          ) : (
            <p className="hint" style={{ margin: '6px 0 10px' }}>
              两份不可比，所以不画走向图。同一条检查项在两个刻度上不是同一件事，
              画一根「从没过到过」的线等于宣布一个并不存在的进步。下面这几项数字仍然照实列着，
              但请当成两个位置，不要读成升降。
            </p>
          )}

          <div className="rv-nums">
            <div className="rv-num">
              <span className="k">判读</span>
              <span className="v">
                {levelFromText(diff.levelFrom)} → {levelFromText(diff.levelTo)}
              </span>
            </div>
            <div className="rv-num">
              <span className="k">未答的检查</span>
              <span className="v">
                {diff.openFrom} → {diff.openTo}
              </span>
            </div>
            <div className="rv-num">
              <span className="k">明确没过</span>
              <span className="v">
                {diff.violatedFrom} → {diff.violatedTo}
              </span>
            </div>
            <div className="rv-num">
              <span className="k">碰到的争议</span>
              <span className="v">
                {diff.disputesFrom} → {diff.disputesTo}
              </span>
            </div>
            <div className="rv-num">
              <span className="k">命名候选</span>
              <span className="v">
                {diff.labelsFrom} → {diff.labelsTo}
              </span>
            </div>
            <div className="rv-num">
              <span className="k">字数</span>
              <span className="v">
                {diff.parent.chars} → {diff.child.chars}
              </span>
            </div>
          </div>

          <div className="rv-moved-h">
            {moved.length ? `有 ${moved.length} 条检查项的位置变了` : '检查项一条都没动'}
          </div>
          {moved.length > 0 && (
            <table className="rv-table">
              <tbody>
                {moved.map((c) => (
                  <tr key={c.id} className={c.kind}>
                    <td className="id">{c.id}</td>
                    <td className="lb">{c.label}</td>
                    <td className="mv">
                      {answerText(c.from)} → {answerText(c.to)}
                    </td>
                    <td className={`kd ${c.kind}`}>{DELTA_TEXT[c.kind]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {diff.comparable && diff.caveats.length > 0 && (
            <>
              <div className="rv-moved-h">这次对照不成立的情况</div>
              <ul className="rv-caveats">
                {diff.caveats.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </>
          )}

          <div className="rv-foot">
            <button className="rv-link" onClick={onOpenParent}>
              打开上一版（{new Date(diff.parent.at).toLocaleString('zh-CN')}）
            </button>
            <span className="rv-fine">
              这里的「推进」只按这副透镜自己的刻度算。同一段话换一副透镜，方向可能相反——那不算矛盾。
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
