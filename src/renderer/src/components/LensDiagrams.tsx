/**
 * 六副透镜各自的图。
 *
 * 为什么要有这一册：原来六副透镜的产物全是「键：值」两栏文字。
 * 文字能说清每一栏是什么，说不清它们之间怎么接——而「怎么接」恰恰是
 * 每副透镜各自的那套理论真正主张的东西。图尔敏的六个零件是拓扑，
 * ARS 的缺口是一个位置，型式族是一次收窄，PTA 的三特征是一次定位。
 * 这些都画得出来，也只画得出来（文字写不出拓扑）。
 *
 * 三条纪律与结构图同：
 *   1. 每张图都有图例；
 *   2. 数据里没有的关系一律不画——比如 ARS 的 gapAt=premise 只知道
 *      「某个前提」，不指名具体哪一条，图上就写「未指名」，不猜；
 *   3. 图里不放长文。长文归文字栏，图只放位置与关系。
 */
import type { ArsLens, Diagnosis, PtaLens, ToulminLens, WaltonLens } from '@shared/types';
import { C, Legend, wrap } from './Diagram';
import { SchemeFamily } from '@shared/types';

/** 框：标题 + 正文行。所有图共用，保证四张图看起来是一套。 */
function Box({
  x,
  y,
  w,
  h,
  title,
  sub,
  lines,
  tone,
  dashed,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  /** 标题右侧的小字状态，如「推定补出」「缺位」 */
  sub?: string;
  lines: string[];
  tone?: 'normal' | 'muted' | 'warn' | 'bad';
  /** 虚线边框 = 不是原文说出的，是补出来的或空缺的 */
  dashed?: boolean;
}) {
  const fill =
    tone === 'bad'
      ? C.invalidBg
      : tone === 'warn'
        ? C.weakBg
        : tone === 'muted'
          ? C.panel2
          : C.panel;
  const stroke = tone === 'bad' ? C.invalid : tone === 'warn' ? C.weak : dashed ? C.lineStrong : C.line;
  const titleColor = tone === 'bad' ? C.invalid : tone === 'warn' ? C.weak : C.accent;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={6}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.2}
        strokeDasharray={dashed ? '4 3' : undefined}
      />
      <text x={x + 10} y={y + 17} fontSize={11} fontWeight={600} fill={titleColor}>
        {title}
      </text>
      {sub && (
        <text x={x + 10 + title.length * 11 + 6} y={y + 17} fontSize={9.5} fill={C.ink3}>
          {sub}
        </text>
      )}
      {lines.map((ln, i) => (
        <text key={i} x={x + 10} y={y + 34 + i * 15} fontSize={11} fill={tone === 'muted' ? C.ink3 : C.ink2}>
          {ln}
        </text>
      ))}
    </g>
  );
}

/** 向上或向下的短箭头，用于「支援撑担保」「限定/例外打在主张上」 */
function UpArrow({ x, y1, y2, color }: { x: number; y1: number; y2: number; color: string }) {
  const down = y2 > y1;
  const tip = down ? y2 : y2 + 5;
  return (
    <g>
      <defs>
        <marker id={`ua-${x}-${y1}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill={color} />
        </marker>
      </defs>
      <line
        x1={x}
        y1={y1}
        x2={x}
        y2={tip}
        stroke={color}
        strokeWidth={1.2}
        markerEnd={`url(#ua-${x}-${y1})`}
      />
      <text x={x + 5} y={(y1 + y2) / 2 + 3} fontSize={9.5} fill={C.ink3}>
        {down ? '撑住' : '除非'}
      </text>
    </g>
  );
}

/* ═══════════════ 1. 图尔敏六零件布局 ═══════════════ */

const WT_LABEL: Record<string, string> = {
  generalization: '概括',
  causal: '因果',
  definitional: '定义',
  authority: '权威',
  analogy: '类比',
  value: '价值',
  none: '未识别',
};

/**
 * 图尔敏布局。
 *
 * 治的是「六个零件怎么接」。文字版把六个零件列成六行，看不出担保架在
 * 理由与主张之间、支援撑在担保下面、限定与例外打在主张上——而这套拓扑
 * 正是图尔敏那本书的全部主张。
 *
 * 这张图最该让人看见的一件事：**担保常常没说出口**。所以 warrantStated=false
 * 时担保框画成虚线，并标「推定补出」。实线框意味着原文写了，虚线框意味着
 * 是我们替他补的——和这个应用其它地方一样，边框只说来源，不说对错。
 */
export function ToulminLayout({ d, l }: { d: Diagnosis; l: ToulminLens }) {
  const W = 700;
  const H = 296;

  const groundsText = l.grounds.length ? l.grounds.join('；') : '未拆出理由';
  const claimText = d.conclusion?.text ?? '—';

  const gLines = wrap(groundsText, 15, 3);
  const wLines = wrap(l.warrant ?? '（未给出）', 15, 3);
  const cLines = wrap(claimText, 15, 3);

  const boxH = 34 + Math.max(gLines.length, wLines.length, 3) * 15 + 8;
  const mainY = 46;
  const subY = mainY + boxH + 54;

  const gw = 176;
  const gx = 8;
  const wx = 262;
  const cx = 516;

  const backingLines = wrap(l.backing ?? '缺位', 15, 2);
  const qualLines = wrap(l.qualifier ?? '未写', 7, 2);
  const rebLines = wrap(l.rebuttals.length ? l.rebuttals.join('；') : '未写', 7, 2);

  return (
    <div className="diagram">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W * 1.06, height: 'auto', display: 'block', margin: '0 auto' }} role="img" aria-label="图尔敏六零件布局">
        <defs>
          <marker id="t-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill={C.edge} />
          </marker>
        </defs>

        {/* 理由 → 担保 → 主张 */}
        <line x1={gx + gw} y1={mainY + boxH / 2} x2={wx - 2} y2={mainY + boxH / 2} stroke={C.edge} strokeWidth={1.3} markerEnd="url(#t-arrow)" />
        <text x={(gx + gw + wx) / 2} y={mainY + boxH / 2 - 8} fontSize={9.5} fill={C.ink3} textAnchor="middle">
          因为
        </text>
        <line x1={wx + gw} y1={mainY + boxH / 2} x2={cx - 2} y2={mainY + boxH / 2} stroke={C.edge} strokeWidth={1.3} markerEnd="url(#t-arrow)" />
        <text x={(wx + gw + cx) / 2} y={mainY + boxH / 2 - 8} fontSize={9.5} fill={C.ink3} textAnchor="middle">
          所以
        </text>

        <Box x={gx} y={mainY} w={gw} h={boxH} title="理由" sub={`${l.grounds.length} 条`} lines={gLines} />
        <Box
          x={wx}
          y={mainY}
          w={gw}
          h={boxH}
          title="担保"
          sub={l.warrantStated ? '原文所述' : '推定补出'}
          lines={wLines}
          tone={l.warrantStated ? 'normal' : 'warn'}
          dashed={!l.warrantStated}
        />
        <Box x={cx} y={mainY} w={gw} h={boxH} title="主张" lines={cLines} />

        {/* 支援撑在担保下面 */}
        <UpArrow x={wx + gw / 2} y1={subY} y2={mainY + boxH} color={l.backing ? C.edge : C.lineStrong} />
        <Box
          x={wx}
          y={subY}
          w={gw}
          h={62}
          title="支援"
          sub={l.backing ? '' : '缺位'}
          lines={backingLines}
          tone={l.backing ? 'normal' : 'muted'}
          dashed={!l.backing}
        />

        {/* 限定与例外打在主张上 */}
        <UpArrow x={cx + 42} y1={subY} y2={mainY + boxH} color={C.lineStrong} />
        <UpArrow x={cx + 134} y1={subY} y2={mainY + boxH} color={C.lineStrong} />
        <Box
          x={cx}
          y={subY}
          w={84}
          h={62}
          title="限定"
          sub={l.qualifier ? '' : '未写'}
          lines={qualLines}
          tone={l.qualifier ? 'normal' : 'muted'}
          dashed={!l.qualifier}
        />
        <Box
          x={cx + 92}
          y={subY}
          w={84}
          h={62}
          title="例外"
          sub={l.rebuttals.length ? `${l.rebuttals.length} 条` : '未写'}
          lines={rebLines}
          tone={l.rebuttals.length ? 'warn' : 'muted'}
          dashed={!l.rebuttals.length}
        />
      </svg>

      <Legend
        items={[
          { kind: 'dash', label: '虚线框＝原文没说，是推定补出的或空缺的' },
          { kind: 'line', label: '实线框＝原文说出的' },
          { kind: 'dot', label: '担保未说出口是最常见的毛病', color: C.weak },
        ]}
      />
      <p className="hint" style={{ marginTop: 6 }}>
        「因为／所以」这两根箭头之间那格就是担保：它回答「凭什么从这条理由走到那句主张」。
        担保类型：{WT_LABEL[l.warrantType] ?? l.warrantType}
        {l.gapBetween ? `　·　跳跃发生在：${l.gapBetween}` : ''}
      </p>
    </div>
  );
}

/* ═══════════════ 2. ARS 缺口位置 ═══════════════ */

const GAP_LABEL: Record<ArsLens['gapAt'], string> = {
  premise: '某个前提',
  link: '前提与结论之间',
  'missing-premise': '缺一条未说出的前提',
  none: '未发现缺口',
};

/**
 * ARS 缺口位置图。
 *
 * 治的是「该补哪」。三标准（认不认 / 有没有关系 / 够不够）查的是同一段论证的
 * 三处不同地方，缺口在哪一处，补法就完全不同——补前提是找证据，补联结是补担保，
 * 补未说出的前提是把话说明白。文字版只给「缺口位置：前提与结论之间」这一行，
 * 看不出它在这段论证的哪个位置。
 *
 * 一处必须克制：gapAt=premise 时数据只知道「某个前提」，没说是哪一条。
 * 所以这里不点名任何一条前提，只在前提区标一个不确定标记并写明「未指名」。
 * 点错一条比不点更糟——用户会照着错的图去补那条不该补的。
 */
export function ArsGapMap({ d, l }: { d: Diagnosis; l: ArsLens }) {
  const W = 700;
  const H = 250;

  const prem = d.premises;
  const conclText = d.conclusion?.text ?? '—';

  const pw = 150;
  const premX = 8;
  const cw = 168;
  const cx = W - cw - 8;

  const boxH = 34 + 2 * 15 + 8;
  const rowH = boxH + 10;
  const listH = Math.max(1, prem.length) * rowH;
  const topY = 46;
  const H2 = Math.max(H, topY + listH + 70);

  const gapKind = l.gapAt;
  const noGap = gapKind === 'none';

  return (
    <div className="diagram">
      <svg viewBox={`0 0 ${W} ${H2}`} style={{ width: '100%', maxWidth: W * 1.06, height: 'auto', display: 'block', margin: '0 auto' }} role="img" aria-label="ARS 缺口位置">
        <defs>
          <marker id="ars-a" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill={C.edge} />
          </marker>
        </defs>

        <text x={8} y={26} fontSize={11} fontWeight={600} fill={C.accent}>
          前提
        </text>
        <text x={cx} y={26} fontSize={11} fontWeight={600} fill={C.accent}>
          结论
        </text>

        {prem.map((p, i) => {
          const y = topY + i * rowH;
          const lines = wrap(p.text, 13, 2);
          const flagged = gapKind === 'premise';
          return (
            <g key={p.id}>
              <Box
                x={premX}
                y={y}
                w={pw}
                h={boxH}
                title={p.id}
                sub={p.implicit ? '补出' : ''}
                lines={lines}
                tone={flagged ? 'warn' : 'normal'}
                dashed={p.implicit}
              />
              <line
                x1={premX + pw}
                y1={y + boxH / 2}
                x2={cx - 2}
                y2={topY + 20}
                stroke={gapKind === 'link' ? C.invalid : C.edge}
                strokeWidth={gapKind === 'link' ? 1.8 : 1.3}
                strokeDasharray={p.implicit ? '4 3' : undefined}
                markerEnd="url(#ars-a)"
              />
            </g>
          );
        })}

        {/* 缺一条未说出的前提：画成一个空的虚线框，位置在前提之后、联结之前 */}
        {gapKind === 'missing-premise' && (
          <g>
            <Box
              x={premX + pw + 22}
              y={topY}
              w={pw}
              h={boxH}
              title="此处缺一条"
              sub="未说出"
              lines={['原文没有说，', '但论证需要它']}
              tone="bad"
              dashed
            />
          </g>
        )}

        <Box x={cx} y={topY + 20} w={cw} h={boxH} title="C" lines={wrap(conclText, 14, 2)} />

        {/* 缺口标记 */}
        {!noGap && (
          <g>
            <text x={gapKind === 'premise' ? premX : gapKind === 'link' ? 250 : premX + pw + 22} y={topY + listH + 34} fontSize={11} fill={C.invalid}>
              ✕ 缺口在这里：{GAP_LABEL[gapKind]}
              {gapKind === 'premise' ? '（本次未指名是哪一条）' : ''}
            </text>
          </g>
        )}
        {noGap && (
          <text x={premX} y={topY + listH + 34} fontSize={11} fill={C.strong}>
            ✓ 未发现缺口
          </text>
        )}
      </svg>

      <Legend
        items={[
          { kind: 'dash', label: '虚线框＝未说出的或缺位的' },
          { kind: 'cut', label: '红线＝缺口所在的那一处' },
          { kind: 'line', label: '实线＝前提对结论的支撑' },
        ]}
      />
      <p className="hint" style={{ marginTop: 6 }}>
        三标准查的是三处不同地方：这个前提你认不认（可接受性）、它和结论有没有关系（相干性）、
        加起来够不够（充分性）。{l.sufficiencyNote ? `充分性：${l.sufficiencyNote}` : ''}
        {gapKind === 'premise' ? '　本次只判出「某个前提」有问题，没指名是哪一条——不猜，按原文逐条核对。' : ''}
      </p>
    </div>
  );
}

/* ═══════════════ 3. 型式族的收窄路径 ═══════════════ */

const FAMILY_LABEL: Record<SchemeFamily, string> = {
  pragmatic: '实效',
  causal: '因果',
  source: '来源',
  comparison: '比较',
  mixed: '混合',
  none: '未认出',
};

const FAMILY_PLAIN: Record<SchemeFamily, string> = {
  pragmatic: '靠后果说话',
  causal: '前后脚发生',
  source: '某某说的',
  comparison: '拿它去比',
  mixed: '几个族都沾',
  none: '没认出来',
};

/**
 * 型式族的收窄路径。
 *
 * 治的是「为什么认定它是这一类套路」。型式法先归族再落型式，族认错，
 * 后面那几个批判性问题会全部问偏——这是日常批评最常见的失误。
 *
 * 所以这张图画的不是「选了哪个」，是「四扇门里选了哪一扇，以及另一扇
 * 可能是哪一扇」。alternativeFamily 就是这个用途：族误认要留痕，
 * 不能只显示一个自信的结论。
 */
export function WaltonFamilyPath({ l }: { l: WaltonLens }) {
  const W = 700;
  const H = 208;

  const fams: SchemeFamily[] = ['pragmatic', 'causal', 'source', 'comparison'];
  const bw = 122;
  const gap = 22;
  const x0 = (W - (fams.length * bw + (fams.length - 1) * gap)) / 2;
  const doorY = 30;
  const doorH = 74;

  const picked = l.family;
  const alt = l.alternativeFamily;
  const schemeX = 110;
  const schemeW = W - 220;
  const schemeY = 148;
  const schemeH = 46;

  return (
    <div className="diagram">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W * 1.06, height: 'auto', display: 'block', margin: '0 auto' }} role="img" aria-label="型式族收窄路径">
        <defs>
          <marker id="wf-a" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill={C.accent} />
          </marker>
          <marker id="wf-b" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill={C.weak} />
          </marker>
        </defs>

        <text x={8} y={18} fontSize={10.5} fill={C.ink3}>
          四扇门：这段话靠哪一类套路说话
        </text>

        {fams.map((f, i) => {
          const x = x0 + i * (bw + gap);
          const on = f === picked;
          const maybe = f === alt;
          return (
            <g key={f}>
              <rect
                x={x}
                y={doorY}
                width={bw}
                height={doorH}
                rx={6}
                fill={on ? C.accentBg : maybe ? C.weakBg : C.panel2}
                stroke={on ? C.accent : maybe ? C.weak : C.line}
                strokeWidth={on ? 1.8 : 1.2}
                strokeDasharray={maybe ? '4 3' : undefined}
              />
              <text x={x + bw / 2} y={doorY + 26} fontSize={12.5} fontWeight={on ? 600 : 400} fill={on ? C.accent : maybe ? C.weak : C.ink3} textAnchor="middle">
                {FAMILY_LABEL[f]}
              </text>
              <text x={x + bw / 2} y={doorY + 45} fontSize={10} fill={C.ink3} textAnchor="middle">
                {FAMILY_PLAIN[f]}
              </text>
              {on && (
                <text x={x + bw / 2} y={doorY + 64} fontSize={9.5} fill={C.accent} textAnchor="middle">
                  认定为这一族
                </text>
              )}
              {maybe && (
                <text x={x + bw / 2} y={doorY + 64} fontSize={9.5} fill={C.weak} textAnchor="middle">
                  也可能是它
                </text>
              )}
            </g>
          );
        })}

        {/* 收窄：从选中的那扇门落到具体型式 */}
        <line
          x1={W / 2}
          y1={doorY + doorH + 2}
          x2={W / 2}
          y2={schemeY - 4}
          stroke={C.accent}
          strokeWidth={1.4}
          markerEnd="url(#wf-a)"
        />
        <text x={W / 2 + 8} y={doorY + doorH + 22} fontSize={9.5} fill={C.accent}>
          收窄到具体型式
        </text>

        <rect
          x={schemeX}
          y={schemeY}
          width={schemeW}
          height={schemeH}
          rx={6}
          fill={C.panel}
          stroke={l.schemeId === 'none' ? C.lineStrong : C.line}
          strokeWidth={1.2}
          strokeDasharray={l.schemeId === 'none' ? '4 3' : undefined}
        />
        <text x={schemeX + 12} y={schemeY + 19} fontSize={10} fill={C.ink3}>
          型式
        </text>
        <text x={schemeX + 12} y={schemeY + 36} fontSize={11.5} fill={l.schemeId === 'none' ? C.ink3 : C.ink}>
          {l.schemeId === 'none' ? '未识别（写 none 是正常输出）' : `${l.schemeName}（${l.schemeId}）`}
        </text>
      </svg>

      <Legend
        items={[
          { kind: 'dot', label: '认定为这一族', color: C.accent },
          { kind: 'dash', label: '也可能是这一族（族误认要留痕，不许只给一个自信结论）' },
          { kind: 'line', label: '收窄到具体型式' },
        ]}
      />
      <p className="hint" style={{ marginTop: 6 }}>
        {l.familyBasis ? `认族依据：${l.familyBasis}` : ''}
        {alt && l.alternativeNote ? `　·　另一可能：${l.alternativeNote}` : ''}
        {l.skeleton ? `　·　骨架：${l.skeleton}` : ''}
      </p>
    </div>
  );
}

/* ═══════════════ 4. PTA 三特征定位 ═══════════════ */

const ORD_LABEL: Record<string, string> = { first: '一阶', second: '二阶', undetermined: '未定' };
const AX_LABEL: Record<string, string> = { predicate: '谓词论证', subject: '主词论证', undetermined: '未定' };
const TY_LABEL: Record<string, string> = { fact: '事实', value: '价值', policy: '政策', undetermined: '未定' };

/**
 * PTA 三特征定位。
 *
 * 治的是「三个特征怎么合成一个型」。原来三个特征各占一个方盒，看不出它们
 * 是相乘关系、也不知道合出来的型落在哪。
 *
 * 更重要的一点必须画出来：**特征都定了、型名给不出，是合法输出**。
 * 这一栏的价值在于它是「你不同意我的入口」——你可以不同意阶的判定，
 * 而不必先否定整个型名。所以图里给每一步都留了独立的位置，
 * 型名那一格空着就空着，不补一个猜的名字。
 */
export function PtaLocator({ l }: { l: PtaLens }) {
  const W = 700;
  const H = 214;

  const cols: { k: string; v: string; note: string }[] = [
    { k: '阶', v: ORD_LABEL[l.order] ?? l.order, note: l.featureNotes.order },
    { k: '轴', v: AX_LABEL[l.axis] ?? l.axis, note: l.featureNotes.axis },
    {
      k: '陈述类型',
      v: `${TY_LABEL[l.premiseType] ?? l.premiseType} → ${TY_LABEL[l.conclusionType] ?? l.conclusionType}`,
      note: l.featureNotes.statementType,
    },
  ];

  const bw = 168;
  const gap = 26;
  const x0 = (W - (cols.length * bw + (cols.length - 1) * gap)) / 2;
  const y = 34;
  const bh = 92;

  const typeY = y + bh + 44;
  const tw = 300;
  const tx = (W - tw) / 2;

  return (
    <div className="diagram">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W * 1.06, height: 'auto', display: 'block', margin: '0 auto' }} role="img" aria-label="PTA 三特征定位">
        <defs>
          <marker id="pt-a" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill={C.accent} />
          </marker>
        </defs>

        {cols.map((c, i) => {
          const x = x0 + i * (bw + gap);
          return (
            <g key={c.k}>
              <rect x={x} y={y} width={bw} height={bh} rx={6} fill={C.panel} stroke={C.line} strokeWidth={1.2} />
              <text x={x + 12} y={y + 20} fontSize={10.5} fill={C.ink3}>
                {c.k}
              </text>
              <text x={x + 12} y={y + 42} fontSize={12.5} fontWeight={600} fill={C.ink}>
                {c.v}
              </text>
              {c.note &&
                wrap(c.note, 15, 2).map((ln, j) => (
                  <text key={j} x={x + 12} y={y + 62 + j * 14} fontSize={9.5} fill={C.ink3}>
                    {ln}
                  </text>
                ))}
            </g>
          );
        })}

        {/* 三特征相乘 → 型 */}
        <line x1={x0 + bw / 2} y1={y + bh + 2} x2={tx + tw / 2 - 30} y2={typeY - 6} stroke={C.accent} strokeWidth={1.3} markerEnd="url(#pt-a)" />
        <line x1={x0 + bw + gap + bw / 2} y1={y + bh + 2} x2={tx + tw / 2} y2={typeY - 6} stroke={C.accent} strokeWidth={1.3} markerEnd="url(#pt-a)" />
        <line x1={x0 + 2 * (bw + gap) + bw / 2} y1={y + bh + 2} x2={tx + tw / 2 + 30} y2={typeY - 6} stroke={C.accent} strokeWidth={1.3} markerEnd="url(#pt-a)" />
        <text x={W / 2} y={y + bh + 30} fontSize={9.5} fill={C.accent} textAnchor="middle">
          三特征相乘
        </text>

        <rect
          x={tx}
          y={typeY}
          width={tw}
          height={44}
          rx={6}
          fill={l.ptaType ? C.accentBg : C.panel2}
          stroke={l.ptaType ? C.accent : C.lineStrong}
          strokeWidth={1.2}
          strokeDasharray={l.ptaType ? undefined : '4 3'}
        />
        <text x={tx + 12} y={typeY + 18} fontSize={10} fill={C.ink3}>
          型
        </text>
        <text x={tx + 12} y={typeY + 35} fontSize={11.5} fill={l.ptaType ? C.ink : C.ink3}>
          {l.ptaType ? l.ptaName ? `${l.ptaType} · ${l.ptaName}` : l.ptaType : '未给出（合法）'}
        </text>
      </svg>

      <Legend
        items={[
          { kind: 'line', label: '三特征各自独立给，相乘才得型' },
          { kind: 'dash', label: '型名给不出是合法输出：特征定了不等于型定了' },
        ]}
      />
      {l.waltonId && (
        <p className="hint" style={{ marginTop: 6 }}>
          对应沃尔顿型式：{l.waltonId}
        </p>
      )}
    </div>
  );
}
