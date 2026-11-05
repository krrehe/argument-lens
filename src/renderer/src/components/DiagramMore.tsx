/**
 * 另外两张图：反驳落点、修补对照。
 *
 * 为什么是这两张：正文里有 282 条反驳、103 份修补，全是文字。
 * 文字说得清「这一条打的是什么」，说不清两件只有图能说的事——
 *   1. **火力集中在哪一处**：九条反驳打在三处，还是九条全打在结论上；
 *   2. **补上哪一句才接得上**：现在这条链断在哪、补完之后长什么样。
 *
 * 两条纪律与既有图一致：
 *   - 数据里没有的关系一律不画。184 条反驳没有挂到具体关卡，
 *     图上就只画到「哪一处依据」，不画一条指向关卡的假线；
 *   - 图里不放长文。长句归文字栏，图只放位置、条数与关系。
 */
import type { Claim, Diagnosis, Refutation, RefutationStrategy } from '@shared/types';
import { C, Legend, wrap } from './Diagram';

/* ═══════ 3. 反驳落点 ═══════ */

/**
 * 策略分四类。
 *
 * 这是把 `strategy` 字段按它字面说的意思归堆，**不是**按强弱排序：
 * 「打依据」不比「换一种解释」狠，四种只是位置不同。图上用颜色分开，
 * 是为了看出「这一处的反驳是同一个打法反复打，还是四种打法都上了」。
 */
type Stratum = 'premise' | 'inference' | 'alternative' | 'procedure';

const STRATUM: Record<RefutationStrategy, Stratum> = {
  'premise-false': 'premise',
  'premise-unsupported': 'premise',
  'missing-premise': 'inference',
  'scheme-mismatch': 'inference',
  counterexample: 'alternative',
  distinguo: 'alternative',
  'alternative-explanation': 'alternative',
  'burden-shift': 'procedure',
  'procedure-violation': 'procedure',
};

const STRATUM_LABEL: Record<Stratum, string> = {
  premise: '打依据',
  inference: '打推理',
  alternative: '换一种解释',
  procedure: '打程序',
};

const STRATUM_COLOR: Record<Stratum, string> = {
  premise: C.invalid,
  inference: C.weak,
  alternative: C.accent,
  procedure: C.ink3,
};

const STRATUM_ORDER: Stratum[] = ['premise', 'inference', 'alternative', 'procedure'];

const R_BOX_W = 226;
const R_SLOT = 22;
const R_SLOT_GAP = 7;
const R_PER_ROW = 10;
const R_ROW_PAD = 10;
const R_TITLE_H = 22;

interface Target {
  /** 指向的 claim；未指名时为 null。 */
  claim: Claim | null;
  /** 找不到时原样留着的 id。 */
  rawId: string;
  refs: Refutation[];
}

/**
 * 按「打在哪一处」分组。
 *
 * 顺序按 claims 的既有顺序（结论、依据、中间步）走，不按条数排：
 * 按条数排会让每次分析的顺序都变，读者无法在两份报告之间对照同一处。
 */
function targetsOf(d: Diagnosis): Target[] {
  const claims = [d.conclusion, ...d.premises, ...d.intermediate];
  const byId = new Map(claims.map((c) => [c.id, c]));
  const buckets = new Map<string, Refutation[]>();
  for (const r of d.refutations) {
    const list = buckets.get(r.targetId);
    if (list) list.push(r);
    else buckets.set(r.targetId, [r]);
  }

  const out: Target[] = [];
  for (const c of claims) {
    const refs = buckets.get(c.id);
    if (refs?.length) {
      out.push({ claim: c, rawId: c.id, refs });
      buckets.delete(c.id);
    }
  }
  /* 指向不存在的 claim：不并进任何一处，也不丢——单独一行说明它对不上号。
     本机 282 条里没有这种情况，但「没有」不该靠运气，得靠这一行说出来。 */
  for (const [rawId, refs] of buckets) out.push({ claim: null, rawId, refs });
  return out;
}

export function RefuteMap({ d }: { d: Diagnosis }) {
  const targets = targetsOf(d);
  if (targets.length === 0) {
    return (
      <p className="hint">
        这份报告没有生成反驳，所以没有可画的落点。不是画不出——是没有数据。
      </p>
    );
  }

  const rows = targets.map((t) => {
    const lines = t.claim ? wrap(t.claim.text, 13, 2) : ['（指向的编号在报告里找不到）'];
    const head = t.claim
      ? `${t.rawId}${t.rawId === d.conclusion.id ? ' · 结论' : ''}`
      : `${t.rawId} · 未对上号`;
    const boxH = 20 + lines.length * 15 + 4;
    const slots = Math.min(t.refs.length, R_PER_ROW);
    const wrappedRows = Math.ceil(t.refs.length / R_PER_ROW);
    const h = Math.max(boxH, wrappedRows * (R_SLOT + 5)) + R_ROW_PAD;
    return { t, lines, head, boxH, slots, wrappedRows, h };
  });

  const H = R_TITLE_H + rows.reduce((s, r) => s + r.h, 0) + 8;
  const W = 660;

  const withCheck = d.refutations.filter((r) => r.checkId).length;
  const orphan = d.refutations.length - withCheck;

  return (
    <div className="diagram">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="反驳落点">
        <defs>
          <marker id="rm-ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill={C.edge} />
          </marker>
        </defs>

        <text x="0" y="13" fontSize="11" fill={C.ink3}>
          按「打在哪一处」分组 · 每一格是一条反驳，格子里的数字是这一处的第几条
        </text>

        {rows.map((row, ri) => {
          const y = R_TITLE_H + rows.slice(0, ri).reduce((s, r) => s + r.h, 0);
          const isConcl = row.t.claim?.id === d.conclusion.id;
          const stroke = isConcl ? C.accent : C.lineStrong;
          const fill = isConcl ? C.accentBg : C.panel;
          return (
            <g key={row.t.rawId + ri}>
              <rect x="0" y={y} width={R_BOX_W} height={row.boxH} rx="5" fill={fill} stroke={stroke} />
              <text x="9" y={y + 14} fontSize="10" fill={C.ink3} fontFamily="ui-monospace, monospace">
                {row.head}
              </text>
              {row.lines.map((ln, i) => (
                <text key={i} x="9" y={y + 29 + i * 15} fontSize="11" fill={C.ink}>
                  {ln}
                </text>
              ))}

              {row.t.refs.map((r, i) => {
                const col = i % R_PER_ROW;
                const line = Math.floor(i / R_PER_ROW);
                const cx = R_BOX_W + 12 + col * (R_SLOT + R_SLOT_GAP);
                const cy = y + 4 + line * (R_SLOT + 5);
                const color = STRATUM_COLOR[STRATUM[r.strategy] ?? 'procedure'];
                /* 实心 = 这条反驳挂到了具体关卡；空心 = 只打到这一处。
                   本机 282 条里 184 条是空心的——图上必须看得出来，
                   否则读者会以为每条反驳都能指到某一关。 */
                return (
                  <g key={r.id}>
                    <title>
                      {`${r.id} · ${STRATUM_LABEL[STRATUM[r.strategy] ?? 'procedure']}${
                        r.checkId ? ` · 挂到 ${r.checkId}` : ' · 没挂到具体关卡'
                      }`}
                    </title>
                    <rect
                      x={cx}
                      y={cy}
                      width={R_SLOT}
                      height={R_SLOT}
                      rx="3"
                      fill={r.checkId ? color : C.panel}
                      stroke={color}
                      strokeWidth={r.checkId ? 0 : 1.4}
                    />
                    <text x={cx + R_SLOT / 2} y={cy + 14} fontSize="8.5" textAnchor="middle" fill={r.checkId ? '#fff' : color}>
                      {i + 1}
                    </text>
                  </g>
                );
              })}
              {/*
                行末写条数：只打了一条的行，右边会空出九个格位，看起来像「这里本该有九条」。
                数字把空白解释掉——空是数据如此，不是图画漏了。
              */}
              {row.t.refs.length > R_PER_ROW ? (
                <text x={R_BOX_W + 12} y={y + row.boxH + 11} fontSize="9" fill={C.ink3}>
                  {`一行只画 ${R_PER_ROW} 条，这一处共 ${row.t.refs.length} 条`}
                </text>
              ) : (
                <text
                  x={R_BOX_W + 12 + row.t.refs.length * (R_SLOT + R_SLOT_GAP) + 2}
                  y={y + 4 + 15}
                  fontSize="9.5"
                  fill={C.ink3}
                >
                  {`${row.t.refs.length} 条`}
                </text>
              )}
            </g>
          );
        })}

      </svg>

      <Legend
        items={[
          ...STRATUM_ORDER.map((s) => ({ kind: 'dot' as const, label: STRATUM_LABEL[s], color: STRATUM_COLOR[s] })),
          { kind: 'dot', label: '实心：挂到了具体关卡', color: C.ink3 },
          { kind: 'ring', label: '空心：只打到这一处', color: C.ink3 },
        ]}
      />

      <p className="diagram-note">
        共 {d.refutations.length} 条反驳，打在 {targets.length} 处；其中 {withCheck} 条挂到了具体关卡
        {orphan > 0 ? `，${orphan} 条只打到某一处依据、没指是哪一关` : ''}。
        颜色只按打法分类，不分强弱——「打依据」不比「换一种解释」更狠，它们打的是不同位置。
      </p>
    </div>
  );
}

/* ═══════ 4. 修补对照 ═══════ */

const P_BOX_W = 268;
const P_LINE_H = 15;
/* 断口留够高度：两截线各 12px + 中间 14px 空隙。gap 太小的话，读者看到的是
   一个悬空的 ×，不是一条本该连上却断了的线。 */
const P_GAP = 46;

function claimLines(c: Claim, budget: number): string[] {
  return wrap(c.text, budget, 2);
}

/**
 * 修补前后对照。
 *
 * 左：现在的链——依据堆着，最后一步接不上（断在两截线之间）
 * 右：补上缺的那一句之后——虚线框是**补出来的**，不是原文说的
 *
 * 右半只在有 `missingPremise` 时画。没有补法也是一种结论（可能补不上，
 * 也可能这不是个能补的论证），那时只画左边并写明，不画一个空框假装有。
 */
export function RepairMap({ d }: { d: Diagnosis }) {
  const premiseList = d.premises.slice(0, 3);
  const more = d.premises.length - premiseList.length;
  const missing = d.repair.missingPremise;

  const leftBoxes = premiseList.map((c) => {
    const lines = claimLines(c, 16);
    return { id: c.id, lines, h: 20 + lines.length * P_LINE_H };
  });
  const conclLines = claimLines(d.conclusion, 16);
  const conclH = 20 + conclLines.length * P_LINE_H;

  const leftStack = leftBoxes.reduce((s, b) => s + b.h + 8, 0) + (more > 0 ? 18 : 0);
  const leftH = leftStack + P_GAP + conclH;

  const missLines = missing ? wrap(missing, 16, 3) : [];
  const missH = 22 + missLines.length * P_LINE_H;

  const rightH = missing ? Math.max(24 + leftStack + P_GAP, 24 + missH + 26) + conclH : 0;
  const H = Math.max(leftH, rightH) + 58;
  const W = 660;
  const RX = 340;

  return (
    <div className="diagram">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="修补对照">
        <defs>
          <marker id="pm-ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill={C.edge} />
          </marker>
        </defs>

        <text x="0" y="13" fontSize="11" fill={C.ink3}>
          现在这条链
        </text>
        {missing && (
          <text x={RX} y="13" fontSize="11" fill={C.ink3}>
            补上缺的那一句之后
          </text>
        )}

        {leftBoxes.map((b, i) => {
          const y = 24 + leftBoxes.slice(0, i).reduce((s, x) => s + x.h + 8, 0);
          return (
            <g key={b.id}>
              <rect x="0" y={y} width={P_BOX_W} height={b.h} rx="5" fill={C.panel} stroke={C.lineStrong} />
              <text x="8" y={y + 13} fontSize="9.5" fill={C.ink3} fontFamily="ui-monospace, monospace">
                {b.id}
              </text>
              {b.lines.map((ln, k) => (
                <text key={k} x="8" y={y + 27 + k * P_LINE_H} fontSize="11" fill={C.ink}>
                  {ln}
                </text>
              ))}
            </g>
          );
        })}
        {more > 0 && (
          <text x="4" y={24 + leftStack - 4} fontSize="9.5" fill={C.ink3}>
            {`另 ${more} 条依据没有画出来（图只放关系，条数写在文字栏）`}
          </text>
        )}

        {/* 断口：两截线 + 中间一个 ×。不是装饰——它标的就是「这一步接不上」。 */}
        {(() => {
          const y1 = 24 + leftStack + 4;
          const y2 = y1 + P_GAP - 4;
          const mid = (y1 + y2) / 2;
          const cx = P_BOX_W / 2;
          return (
            <g>
              {/* 两截线：上面那截接住最后一条依据，下面那截接住结论，中间空出来放 ×。 */}
              <line x1={cx} y1={y1} x2={cx} y2={mid - 8} stroke={C.invalid} strokeWidth="1.4" />
              <line x1={cx} y1={mid + 8} x2={cx} y2={y2} stroke={C.invalid} strokeWidth="1.4" />
              <text x={cx + 7} y={mid + 4} fontSize="13" fill={C.invalid}>
                ×
              </text>
              <text x={cx + 21} y={mid + 4} fontSize="10" fill={C.invalid}>
                这一步接不上
              </text>
            </g>
          );
        })()}

        {(() => {
          const y = 24 + leftStack + P_GAP;
          return (
            <g>
              <rect x="0" y={y} width={P_BOX_W} height={conclH} rx="5" fill={C.accentBg} stroke={C.accent} />
              <text x="8" y={y + 13} fontSize="9.5" fill={C.ink3} fontFamily="ui-monospace, monospace">
                {d.conclusion.id} · 结论
              </text>
              {conclLines.map((ln, k) => (
                <text key={k} x="8" y={y + 27 + k * P_LINE_H} fontSize="11" fill={C.ink}>
                  {ln}
                </text>
              ))}
            </g>
          );
        })()}

        {missing && (
          <>
            <rect x={RX} y="24" width={P_BOX_W} height={missH} rx="5" fill={C.weakBg} stroke={C.weak} strokeDasharray="5 3" />
            <text x={RX + 8} y="38" fontSize="9.5" fill={C.weak}>
              补出来的前提 · 原文没有这一句
            </text>
            {missLines.map((ln, k) => (
              <text key={k} x={RX + 8} y={52 + k * P_LINE_H} fontSize="11" fill={C.ink}>
                {ln}
              </text>
            ))}

            {(() => {
              /*
               * 右列的结论框与左列对齐：两边写着「同一个结论」，
               * 高度错开会被读成两个不同的结论。补出来的前提若特别长，
               * 就退回「接着往下画」——宁可错开，也不让箭头指反。
               */
              const y = Math.max(24 + leftStack + P_GAP, 24 + missH + 26);
              return (
                <g>
                  <line
                    x1={RX + P_BOX_W / 2}
                    y1={24 + missH + 4}
                    x2={RX + P_BOX_W / 2}
                    y2={y - 8}
                    stroke={C.edge}
                    strokeWidth="1.2"
                    markerEnd="url(#pm-ah)"
                  />
                  <rect x={RX} y={y} width={P_BOX_W} height={conclH} rx="5" fill={C.accentBg} stroke={C.accent} />
                  <text x={RX + 8} y={y + 13} fontSize="9.5" fill={C.ink3} fontFamily="ui-monospace, monospace">
                    {d.conclusion.id} · 同一个结论
                  </text>
                  {conclLines.map((ln, k) => (
                    <text key={k} x={RX + 8} y={y + 27 + k * P_LINE_H} fontSize="11" fill={C.ink}>
                      {ln}
                    </text>
                  ))}
                </g>
              );
            })()}
          </>
        )}
      </svg>

      <Legend
        items={[
          { kind: 'line', label: '报告里已有的' },
          { kind: 'dash', label: '补出来的，不是原文说的' },
          { kind: 'cut', label: '这一步接不上' },
        ]}
      />

      {d.repair.repairedForm ? (
        <div className="repair-form">
          <span className="k">补完的写法</span>
          <span className="v">{d.repair.repairedForm}</span>
        </div>
      ) : (
        <p className="diagram-note">这份报告没给补完的写法。少这一条不是漏了——补不上，也是一种结论。</p>
      )}

      <p className="diagram-note">
        右边是<b>按补法重写的写法</b>，不是重新分析的结果：补上之后到底站不站得住，要拿这段新文本再跑一次才知道。
        图上不画那个结果，画了就等于替你认定它成立。
      </p>
    </div>
  );
}
