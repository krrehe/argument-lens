/**
 * 断口定位。
 *
 * 模型给的 defeat.cuts 是一句话（「切断 P1 与 C 之间的因果联结」），里面通常带主张编号。
 * 扫出这些编号，就知道该在哪根线上开个口子。
 *
 * 关键在「几个编号」：
 *   两个 → 只切这两者之间那根线（「P1 与 C 之间」就是 P1→C，不是所有通向 C 的线）
 *   一个 → 切它出去的所有线
 *   零个 → 不画断口，只在图下写一句「没能落到具体连线」
 * 画错一根线比不画更糟：用户会照着错的图去改论证。
 */
function tokenIndex(text: string, id: string): number {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?<![A-Za-z0-9])${esc}(?![0-9])`).exec(text);
  return m ? m.index : -1;
}

function findCutEdges(d: Diagnosis): Set<string> {
  const out = new Set<string>();
  if (d.defeat.kind === 'none') return out;
  const text = `${d.defeat.cuts} ${d.defeat.explanation}`;
  const claims = [d.conclusion, ...d.premises, ...d.intermediate];
  const found = claims
    .map((c) => ({ id: c.id, i: tokenIndex(text, c.id) }))
    .filter((x) => x.i >= 0)
    .sort((a, b) => a.i - b.i);

  if (found.length >= 2) {
    const [a, b] = found;
    out.add(`${a.id}->${b.id}`);
    out.add(`${b.id}->${a.id}`);
    return out;
  }
  if (found.length === 1) {
    const c = claims.find((x) => x.id === found[0].id);
    for (const t of c?.supports ?? []) out.add(`${c!.id}->${t}`);
  }
  return out;
}

import { useMemo } from 'react';
import type { CheckItem, Claim, Diagnosis, VerdictLevel } from '@shared/types';
import { LEVEL_LABEL, THEORIES, type TheoryId } from '@shared/theories';

/**
 * 可视化层。
 *
 * 为什么要有这一层：这个应用原来的主力是表格和长句——每一句都准确，但读者要先学会
 * 「前提」「担保」「批判性问题」这些词，才看得懂它说得好不好。这是把理解成本推给用户。
 *
 * 四个图各解决一个具体的「看不懂」：
 *   StructureMap  看不懂「他在论证什么」→ 一张从左到右的树，线就是「凭什么」
 *   VerdictGauge  看不懂「所以到底算不算站得住」→ 一把三档的尺子，一根指针
 *   CheckStrip    看不懂「检查表那么多行在说什么」→ 一排关卡，绿红黄
 *   LensMap       看不懂「为什么要换透镜」→ 一张地形图，六副各占一个位置
 *
 * 图不与文字重复，图负责「一眼看出关系」，文字负责「为什么」。
 * 每张图下面都有读图说明——没有图例的图只是装饰。
 */

/*
 * SVG 的呈现属性（fill= / stroke=）不认 var(--x)，只能内联 hex，所以这张表是
 * styles.css :root 的影子。影子会走样——原来它一直是旧的暖色，主界面换成
 * 苹果色板之后，图里还是土黄与墨绿。check:ui-rules 现在会比对这两处：
 * 表里任一项与 :root 对应变量不一致就红，不靠人记得同步。
 */
export const C = {
  ink: '#37352f',
  ink2: '#4a473f',
  ink3: '#5f5c55',
  line: '#e9e7e4',
  lineStrong: '#d6d2c9',
  edge: '#a8a39a',
  accent: '#1668a0',
  accentBg: '#efedea',
  strong: '#2f6b4f',
  strongBg: '#efedea',
  weak: '#7d5510',
  weakBg: '#efedea',
  invalid: '#a82e26',
  invalidBg: '#efedea',
  panel: '#ffffff',
  panel2: '#f7f6f3',
};

const ACC_COLOR: Record<Claim['acceptability']['status'], string> = {
  acceptable: C.strong,
  questionable: C.weak,
  unacceptable: C.invalid,
  unknown: C.ink3,
};

const ACC_SHORT: Record<Claim['acceptability']['status'], string> = {
  acceptable: '可接受',
  questionable: '可疑',
  unacceptable: '不可接受',
  unknown: '未评',
};

/* ═══════ 文字度量 ═══════ */

/** 中文按 1 个宽度单位算，西文按 0.55。够用了——这是排版，不是测字。 */
const unitOf = (ch: string) => (/[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.55);

/**
 * 断行。
 *
 * budget 是按「中文字宽」计的：中文 1、西文 0.55。两条中文排版的硬规矩：
 *   收尾标点不许出现在行首（」，。、；：？！）——遇到就把上一行最后一个字让给它。
 * 这两条不影响正确性，但影响「这软件是不是认真做过」的第一印象。
 */
const CLOSERS = '」』）〉》。，、；：？！%';

export function wrap(text: string, budget: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = '';
  let w = 0;
  let dropped = false;
  for (const ch of text) {
    const cw = unitOf(ch);
    if (w + cw > budget) {
      if (CLOSERS.includes(ch) && lines.length + 1 <= maxLines) {
        // 收尾标点跟着上一行走，宁可让这一行多一个字
        cur += ch;
        lines.push(cur);
        cur = '';
        w = 0;
        if (lines.length === maxLines) {
          dropped = true;
          break;
        }
        continue;
      }
      lines.push(cur);
      cur = '';
      w = 0;
      if (lines.length === maxLines) {
        dropped = true;
        break;
      }
    }
    cur += ch;
    w += cw;
  }
  if (!dropped && cur) lines.push(cur);
  if (dropped && lines.length) lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, -1)}…`;
  return lines;
}

/* ═══════ 1. 结构图（思维导图） ═══════ */

const NODE_W = 250;
const LINE_H = 17;
const HEAD_H = 34;
const ROW_GAP = 14;
const TOP_PAD = 12;

interface Box {
  claim: Claim;
  x: number;
  y: number;
  h: number;
  lines: string[];
}

export function StructureMap({
  d,
  sel,
  onPick,
}: {
  d: Diagnosis;
  sel: string | null;
  onPick: (id: string | null) => void;
}) {
  const legitIds = useMemo(() => new Set(d.legitimateMoves.map((m) => m.targetId)), [d.legitimateMoves]);
  const cutEdges = useMemo(() => findCutEdges(d), [d]);

  const layout = useMemo(() => {
    const hasMid = d.intermediate.length > 0;
    const gap = hasMid ? 66 : 130;
    const cols = hasMid ? 3 : 2;
    const width = cols * NODE_W + (cols - 1) * gap;
    const xOf = (i: number) => i * (NODE_W + gap);
    const conclCol = cols - 1;

    const box = (c: Claim, x: number): Box => {
      const lines = wrap(c.text, 18, 3);
      const h = HEAD_H + lines.length * LINE_H + 9;
      return { claim: c, x, y: 0, h, lines };
    };

    const prem = d.premises.map((c) => box(c, xOf(0)));
    const mid = d.intermediate.map((c) => box(c, xOf(1)));
    const concl = box(d.conclusion, xOf(conclCol));

    const stackH = (list: Box[]) => list.reduce((s, b) => s + b.h, 0) + Math.max(0, list.length - 1) * ROW_GAP;

    const BOTTOM_PAD = 20;
    const H = Math.max(250, stackH(prem) + TOP_PAD + BOTTOM_PAD, stackH(mid) + TOP_PAD + BOTTOM_PAD);

    const place = (list: Box[]) => {
      let y = (H - stackH(list)) / 2;
      for (const b of list) {
        b.y = y;
        y += b.h + ROW_GAP;
      }
    };
    place(prem);
    place(mid);
    concl.y = (H - concl.h) / 2;

    const all = [...prem, ...mid, concl];
    const byId = new Map(all.map((b) => [b.claim.id, b]));

    type Edge = { key: string; d: string; src: string; dst: string; implicit: boolean; cut: boolean; mid: [number, number] };
    const edges: Edge[] = [];
    for (const b of all) {
      for (const t of b.claim.supports) {
        const dst = byId.get(t);
        if (!dst) continue;
        const x1 = b.x + NODE_W;
        const y1 = b.y + b.h / 2;
        const x2 = dst.x - 7;
        const y2 = dst.y + dst.h / 2;
        const dx = Math.max(34, (x2 - x1) * 0.5);
        const mx = 0.125 * x1 + 0.375 * (x1 + dx) + 0.375 * (x2 - dx) + 0.125 * x2;
        const my = 0.25 * y1 + 0.75 * y2;
        edges.push({
          key: `${b.claim.id}->${t}`,
          d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`,
          src: b.claim.id,
          dst: t,
          implicit: b.claim.implicit,
          cut: cutEdges.has(`${b.claim.id}->${t}`),
          mid: [mx, my],
        });
      }
    }

    return { width, height: H, boxes: all, edges, hasMid };
  }, [d, cutEdges]);

  if (!d.premises.length && !d.intermediate.length) {
    return (
      <p className="hint">
        这段文本里没有拆出可用的前提，所以画不出结构图。这通常意味着它不是论证——叙事、抒情、口号、纯提问都可能长这样。
        这本身就是一条结论：没有前提可拆，也就没有论证可评。
      </p>
    );
  }

  const W = layout.width;

  return (
    <div className="diagram">
      <svg
        viewBox={`0 0 ${W} ${layout.height}`}
        style={{ width: '100%', maxWidth: W * 1.12, height: 'auto', display: 'block', margin: '0 auto' }}
        role="img"
        aria-label="论证结构图"
      >
        <defs>
          <marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill={C.edge} />
          </marker>
          <marker id="ah-impl" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill={C.weak} />
          </marker>
          <marker id="ah-cut" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill={C.invalid} />
          </marker>
        </defs>

        {layout.edges.map((e) => (
          <g key={e.key}>
            <path
              d={e.d}
              fill="none"
              stroke={e.cut ? C.invalid : e.implicit ? C.weak : C.edge}
              strokeWidth={e.cut ? 1.8 : 1.3}
              strokeDasharray={e.cut ? '5 4' : e.implicit ? '4 4' : undefined}
              markerEnd={e.cut ? 'url(#ah-cut)' : e.implicit ? 'url(#ah-impl)' : 'url(#ah)'}
              opacity={0.95}
            />
            {e.cut && (
              <g stroke={C.invalid} strokeWidth="2" strokeLinecap="round">
                <line x1={e.mid[0] - 5} y1={e.mid[1] - 5} x2={e.mid[0] + 5} y2={e.mid[1] + 5} />
                <line x1={e.mid[0] - 5} y1={e.mid[1] + 5} x2={e.mid[0] + 5} y2={e.mid[1] - 5} />
              </g>
            )}
          </g>
        ))}

        {layout.boxes.map((b) => {
          const c = b.claim;
          const color = ACC_COLOR[c.acceptability.status];
          const on = sel === c.id;
          const isConcl = c.role === 'conclusion';
          return (
            <g
              key={c.id}
              className="map-node"
              style={{ cursor: 'pointer' }}
              onClick={() => onPick(on ? null : c.id)}
            >
              <title>{`${c.id}｜${c.text}\n可接受性：${ACC_SHORT[c.acceptability.status]}${
                c.implicit ? '\n（推定：原文没说出口）' : ''
              }`}</title>
              {on && <rect x={b.x - 3} y={b.y - 3} width={NODE_W + 6} height={b.h + 6} rx="9" fill="none" stroke={C.accent} strokeWidth="2" />}
              <rect
                x={b.x}
                y={b.y}
                width={NODE_W}
                height={b.h}
                rx="7"
                fill={isConcl ? '#ffffff' : C.panel2}
                stroke={c.implicit ? C.weak : C.lineStrong}
                strokeWidth={c.implicit ? 1.1 : 1}
                strokeDasharray={c.implicit ? '4 3' : undefined}
              />
              <rect x={b.x} y={b.y} width="3" height={b.h} fill={color} rx="1.5" />
              <text x={b.x + 12} y={b.y + 17} fontSize="10" fontFamily="var(--mono)" fill={color} fontWeight="600">
                {c.id}
                {c.implicit ? ' · 推定' : ''}
                {legitIds.has(c.id) ? ' ✓' : ''}
              </text>
              <text x={b.x + NODE_W - 10} y={b.y + 17} fontSize="9.5" textAnchor="end" fill={color}>
                {ACC_SHORT[c.acceptability.status]}
              </text>
              {b.lines.map((ln, i) => (
                <text
                  key={i}
                  x={b.x + 12}
                  y={b.y + HEAD_H + i * LINE_H}
                  fontSize="12"
                  fill={isConcl ? C.ink : C.ink2}
                  fontWeight={isConcl ? 600 : 400}
                >
                  {ln}
                </text>
              ))}
            </g>
          );
        })}

        <text x={2} y={layout.height - 2} fontSize="9" fill={C.lineStrong}>
          ← 他摆出的依据
        </text>
        <text x={W - 2} y={layout.height - 2} fontSize="9" textAnchor="end" fill={C.lineStrong}>
          他要你信的那句 →
        </text>
      </svg>

      <Legend
        items={[
          { kind: 'line', label: '原文说出的支撑' },
          { kind: 'dash', label: '推定（他没说出口）', color: C.weak },
          { kind: 'cut', label: '被击败的那一步', color: C.invalid },
          { kind: 'dot', label: '可接受', color: C.strong },
          { kind: 'dot', label: '可疑', color: C.weak },
          { kind: 'dot', label: '不可接受', color: C.invalid },
        ]}
      />
      <p className="diagram-note">
        读法：从左往右，就是「他凭什么」走向「他要你信什么」。点任一格，上面的原文和下面那一条会一起高亮。
        左边那道色条说的是这条依据<b>听众认不认</b>，不是它客观真假；框画成虚线表示这句话原文没说、是替他补出来的。
        线上打红叉，就是判定这一步接不上。
        {cutEdges.size === 0 && d.defeat.kind !== 'none' && ' 本次击败位置未能对应到具体连线，所以图上没画断口。'}
      </p>
    </div>
  );
}

/* ═══════ 图例 ═══════ */

export function Legend({
  items,
}: {
  /** ring = 空心圆。图里出现「实心 / 空心」两种填充时，图例必须跟着有两种形状，
      拿虚线段去解释方块，读的人对不上号。 */
  items: { kind: 'line' | 'dash' | 'cut' | 'dot' | 'ring'; label: string; color?: string }[];
}) {
  return (
    <div className="legend">
      {items.map((it, i) => (
        <span key={i} className="legend-item">
          {it.kind === 'dot' ? (
            <i className="l-dot" style={{ background: it.color ?? C.ink3 }} />
          ) : it.kind === 'ring' ? (
            <i className="l-ring" style={{ borderColor: it.color ?? C.ink3 }} />
          ) : it.kind === 'cut' ? (
            <i className="l-cut">×</i>
          ) : (
            <i className={it.kind === 'dash' ? 'l-dash' : 'l-line'} style={it.color ? { borderColor: it.color } : undefined} />
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}

/* ═══════ 2. 判读刻度尺 ═══════ */

export function VerdictGauge({
  level,
  scaleValue,
  scale,
  whatIsRefuted,
}: {
  level: VerdictLevel;
  scaleValue: string;
  scale: string;
  whatIsRefuted: 'argument-only' | 'conclusion' | 'nothing';
}) {
  const W = 660;
  const barY = 44;
  const barH = 12;
  const segW = (W - 40) / 3;
  const idx = level === 'withstands' ? 0 : level === 'weakened' ? 1 : level === 'fails' ? 2 : -1;
  const undetermined = level === 'undetermined';

  const seg = [
    { label: LEVEL_LABEL.withstands, color: C.strong, bg: C.strongBg },
    { label: LEVEL_LABEL.weakened, color: C.weak, bg: C.weakBg },
    { label: LEVEL_LABEL.fails, color: C.invalid, bg: C.invalidBg },
  ];

  return (
    <div className="gauge">
      <svg viewBox={`0 0 ${W} 92`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="判读刻度">
        {undetermined ? (
          <>
            <rect x="20" y={barY} width={W - 40} height={barH} rx="8" fill={C.panel2} stroke={C.line} strokeDasharray="4 3" />
            <text x={W / 2} y={barY - 8} fontSize="11" textAnchor="middle" fill={C.ink3}>
              判不了
            </text>
            <text x={W / 2} y={barY + barH + 20} fontSize="11.5" textAnchor="middle" fill={C.ink2}>
              这副尺子在这段文本上不适用，或者给出的信息不足以量
            </text>
          </>
        ) : (
          <>
            {seg.map((s, i) => (
              <g key={s.label}>
                <rect
                  x={20 + i * segW}
                  y={barY}
                  width={segW - 2}
                  height={barH}
                  rx="6"
                  fill={i === idx ? s.color : s.bg}
                  opacity={i === idx ? 1 : 0.9}
                />
                <text
                  x={20 + i * segW + segW / 2}
                  y={barY + barH + 17}
                  fontSize="11.5"
                  textAnchor="middle"
                  fill={i === idx ? s.color : C.ink3}
                  fontWeight={i === idx ? 600 : 400}
                >
                  {s.label}
                </text>
              </g>
            ))}
            <path
              d={`M${20 + idx * segW + segW / 2},${barY - 3} l-6,-9 l12,0 z`}
              fill={seg[idx].color}
            />
            <text x={20 + idx * segW + segW / 2} y={barY - 16} fontSize="10.5" textAnchor="middle" fill={seg[idx].color} fontWeight="600">
              在这里
            </text>
            <text x="20" y="14" fontSize="10" fill={C.ink3}>
              论证站得住
            </text>
            <text x={W - 20} y="14" fontSize="10" textAnchor="end" fill={C.ink3}>
              论证倒了
            </text>
          </>
        )}
      </svg>
      <div className="gauge-foot">
        <span className="pill">{scale}</span>
        {/*
          判不了的时候，原生刻度值与「伤到论证还是结论」一律不显示。
          它们描述的是一个已经被撤销的判定：一边写「判不了」，一边挂着
          「CQ2 未答，属削弱性击败」，等于同一行里自己跟自己打架。
          撤掉判定就要把它的话一并撤掉，只留刻度名——那把尺子叫什么，仍然有用。
        */}
        {!undetermined && scaleValue && <span className="pill">{scaleValue}</span>}
        {!undetermined && (
          <span className={`pill ${whatIsRefuted === 'argument-only' ? 'ok' : whatIsRefuted === 'conclusion' ? 'bad' : ''}`}>
            {whatIsRefuted === 'argument-only'
              ? '只伤到论证，没否定结论'
              : whatIsRefuted === 'conclusion'
                ? '伤到了结论本身'
                : '什么都没否定'}
          </span>
        )}
      </div>
    </div>
  );
}

/* ═══════ 3. 检查跑道 ═══════ */

const ANSWER_ICON: Record<CheckItem['answer'], string> = {
  passed: '✓',
  violated: '✕',
  unanswered: '?',
  'not-applicable': '–',
};

export function CheckStrip({
  checks,
  sel,
  onPick,
  defeatId,
}: {
  checks: CheckItem[];
  sel: string | null;
  onPick: (id: string | null) => void;
  /**
   * 倒在哪一关（defeat.checkId）。
   *
   * 为什么要传进来：跑道和判读原来是分开的两栏，读者得自己把「判读说被削弱」
   * 和「第二关没过」接起来。而这个因果是数据里明写着的——defeat.checkId
   * 就指着那一关。不画出来，等于让读者去做程序本来能做的一步。
   */
  defeatId?: string | null;
}) {
  if (!checks.length) return null;
  const tally = {
    passed: checks.filter((c) => c.answer === 'passed').length,
    violated: checks.filter((c) => c.answer === 'violated').length,
    unanswered: checks.filter((c) => c.answer === 'unanswered').length,
    na: checks.filter((c) => c.answer === 'not-applicable').length,
  };

  /* 元问题（meta）：答否则后续全部免除，所以它是排在前面的闸门，不是并列的一关。 */
  const hasMeta = checks.some((c) => c.meta);

  return (
    <div className="strip-wrap">
      <div className="strip">
        {checks.map((c) => {
          const key = `#${c.id}`;
          const on = sel === key;
          const down = !!defeatId && c.id === defeatId;
          return (
            <button
              key={c.id}
              className={`strip-item ${c.answer} ${on ? 'on' : ''} ${c.meta ? 'meta' : ''} ${down ? 'down' : ''}`}
              onClick={() => onPick(on ? null : key)}
              title={
                `${c.label}\n${c.basis || '（未写依据）'}` +
                (c.meta ? '\n\n元问题：答否的话后面的关卡全部免除。' : '') +
                (down ? '\n\n整份判定就倒在这一关上。' : '')
              }
            >
              {c.meta && <span className="si-gate">闸</span>}
              <span className="si-icon">{ANSWER_ICON[c.answer]}</span>
              <span className="si-id">{c.id}</span>
              <span className="si-label">{c.label.replace(/^[A-Za-z0-9-]+\s*/, '') || c.label}</span>
              {down && <span className="si-down">倒在这关</span>}
            </button>
          );
        })}
      </div>
      <div className="strip-sum">
        <span>
          共 {checks.length} 关：
          <b style={{ color: C.strong }}>过 {tally.passed}</b>
          <i>/</i>
          <b style={{ color: C.invalid }}>没过 {tally.violated}</b>
          <i>/</i>
          <b style={{ color: C.weak }}>没答 {tally.unanswered}</b>
          {tally.na > 0 && (
            <>
              <i>/</i>
              <b style={{ color: C.ink3 }}>不适用 {tally.na}</b>
            </>
          )}
        </span>
        {defeatId ? (
          <span className="strip-dies">
            判定倒在这一关：
            <b>{defeatId}</b>
            {checks.find((c) => c.id === defeatId)?.meta ? '（它同时是元问题）' : ''}
          </span>
        ) : (
          <span className="hint" style={{ fontStyle: 'normal' }}>
            {hasMeta
              ? '带「闸」的是元问题：答否的话后面几关全部免除，不必再看。点任一关 → 下面的表定位到那一行'
              : '点任一关 → 下面的表定位到那一行'}
          </span>
        )}
      </div>
    </div>
  );
}

/* ═══════ 4. 六透镜地形图 ═══════ */

export function LensMap({
  current,
  onPick,
}: {
  current: TheoryId;
  onPick: (id: TheoryId) => void;
}) {
  const x0 = 26;
  const x1 = 314;
  const y0 = 172;
  const y1 = 14;
  const px = (v: number) => x0 + v * (x1 - x0);
  const py = (v: number) => y0 - v * (y0 - y1);

  return (
    <div className="lens-map">
      <svg viewBox="0 0 340 212" style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="六透镜地形图">
        <rect x={x0} y={y1} width={x1 - x0} height={y0 - y1} fill={C.panel2} stroke={C.line} rx="6" />
        {/* 中线：四个格子的分界，暗示「同类」而不需要四个格子标签 */}
        <line x1={(x0 + x1) / 2} y1={y1} x2={(x0 + x1) / 2} y2={y0} stroke={C.line} strokeDasharray="3 4" />
        <line x1={x0} y1={(y0 + y1) / 2} x2={x1} y2={(y0 + y1) / 2} stroke={C.line} strokeDasharray="3 4" />

        {THEORIES.map((t) => {
          const on = t.id === current;
          const cx = px(t.map.x);
          const cy = py(t.map.y);
          const right = t.map.x < 0.62;
          return (
            <g key={t.id} style={{ cursor: 'pointer' }} onClick={() => onPick(t.id)}>
              <title>{`${t.name}
${t.mapNote}`}</title>
              {on && <circle cx={cx} cy={cy} r="8.5" fill="none" stroke={C.accent} strokeWidth="1.2" />}
              <circle cx={cx} cy={cy} r="4" fill={on ? C.accent : C.panel} stroke={C.accent} strokeWidth="1.4" />
              <text
                x={right ? cx + 10 : cx - 10}
                y={cy + 3.5}
                fontSize="10"
                textAnchor={right ? 'start' : 'end'}
                fill={on ? C.accent : C.ink2}
                fontWeight={on ? 600 : 400}
              >
                {t.tiny}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="lm-axes">
        <span>
          横：只管这一段话 <b>→</b> 管整场讨论
        </span>
        <span>
          纵：下 给你看结构 <b>↑</b> 上 给你个名字
        </span>
      </div>
      <p className="diagram-note">
        六个不是同质的选项。点圆点换过去——换的是尺子，不是精度。
      </p>
    </div>
  );
}
