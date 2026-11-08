/**
 * 报告 → 一张能交给画布工具的图（节点 + 线 + 坐标）。
 *
 * 为什么要有这个：报告里已经有「谁支撑谁」「哪条反驳打在哪一处」，但这些关系
 * 只活在这个窗口里，而且是固定的三栏。画布工具（Project Graph）的价值不在判定，
 * 在**可以自己摆**——同一条论证线，有人要按原文顺序排，有人要按立场排，
 * 有人要把反驳挪到旁边写自己的批注。这里做的是把结构交出去，不是把结论交出去。
 *
 * 三条约束，`check:prg` 逐条守着：
 *
 *   1. **节点上没有一个新写的字。** 每个节点的文本必须能在报告里找到逐字相同的一处
 *      （主张的 text、反驳的 claim、修补的 missingPremise）。不截断、不润色、
 *      不加「前提 ·」这类前缀——角色靠位置和颜色表达，不靠改字。
 *   2. **不新算判定。** 只把已经落盘的 supports / targetId / missingPremise 摆成线。
 *      导出件与界面显示不同的结构，比不导出更糟。
 *   3. **坐标只保证「一开始不叠在一起」，不保证好看。** 画布工具自己会重新排版
 *      （它有 auto_layout_dag），我们交出去的是一张还没摆过的草稿。
 */
import type { Diagnosis } from './types';
import { THEORY_BY_ID } from './theories';

/** 节点在图上扮演的角色。只用来上色与分栏，不进节点文本。 */
export type PrgRole = 'conclusion' | 'premise' | 'intermediate' | 'refutation' | 'gap';

export interface PrgNode {
  /** 报告里的 id：P1 / C / R2 …。连线两端用它对应。 */
  key: string;
  /** 逐字来自报告，一个字都不改。 */
  text: string;
  role: PrgRole;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 报告里的颜色值（r,g,b 0–255，a 0–1），与画布工具一致。 */
  color: [number, number, number, number];
}

export interface PrgEdge {
  from: string;
  to: string;
}

export interface PrgGraph {
  nodes: PrgNode[];
  edges: PrgEdge[];
  /**
   * 交出去的过程中丢掉了什么。**这几个数必须在界面上说出来**：
   * 静默丢掉一条反驳，用户会以为报告里本来就没有它。
   */
  stats: {
    /** 连不上任何节点的反驳（targetId 指向不存在的主张）。 */
    dangling: number;
    /** 文本为空、没有可写的字，因此没画出来的条目。 */
    empty: number;
  };
}

/** 四列。留白够大是因为画布工具会按内容重新量高度，行距太紧就会叠在一起。 */
const COL = { premise: -760, intermediate: -380, conclusion: 0, refutation: 380 } as const;
const ROW = 210;
const W = 320;
const H = 64;

/**
 * 颜色只分角色，不分好坏。
 *
 * 这里没有红／绿：红绿在这套界面里意味着「站得住／站不住」，而图上每一个节点
 * 都是报告里的一个陈述，没有一个是判定。角色色是底色很浅的四种，
 * 目的是让人一眼分得出「这是被反驳的那一句」和「这是反驳」。
 */
const COLOR: Record<PrgRole, [number, number, number, number]> = {
  conclusion: [226, 238, 255, 1],
  premise: [244, 244, 245, 1],
  intermediate: [236, 243, 236, 1],
  refutation: [255, 238, 230, 1],
  gap: [255, 248, 214, 1],
};

/** 一列里竖直居中排开；索引来自数组顺序，所以同一份报告每次导出的坐标完全一样。 */
function stack(i: number, n: number): number {
  return Math.round((i - (n - 1) / 2) * ROW);
}

function node(key: string, text: string, role: PrgRole, x: number, y: number): PrgNode {
  return { key, text, role, x: Math.round(x), y: Math.round(y), w: W, h: H, color: COLOR[role] };
}

/**
 * 把报告摊成一张图。
 *
 * supports 为空时按最朴素的重构处理——直接支撑结论 C。这条规则与结构图
 * （`components/Diagram.tsx`）和 Argdown 导出（`@shared/argdown`）必须一致：
 * 同一份报告在界面有线、在导出件里没线，读的人会以为结构变了。
 */
export function graphOf(d: Diagnosis): PrgGraph {
  const nodes: PrgNode[] = [];
  const edges: PrgEdge[] = [];
  let dangling = 0;
  let empty = 0;

  const push = (n: PrgNode): boolean => {
    if (!n.text.trim()) {
      empty += 1;
      return false;
    }
    nodes.push(n);
    return true;
  };

  const prem = d.premises ?? [];
  const mid = d.intermediate ?? [];
  const refs = d.refutations ?? [];
  const gapText = d.repair?.missingPremise ?? null;

  push(node(d.conclusion.id, d.conclusion.text, 'conclusion', COL.conclusion, 0));
  prem.forEach((c, i) => push(node(c.id, c.text, 'premise', COL.premise, stack(i, prem.length))));
  mid.forEach((c, i) => push(node(c.id, c.text, 'intermediate', COL.intermediate, stack(i, mid.length))));
  refs.forEach((r, i) => push(node(r.id, r.claim, 'refutation', COL.refutation, stack(i, refs.length))));

  /*
   * 缺口（补出来的那一句）不是原文里的话，所以颜色与位置都跟前提不同：
   * 放在前提列的顶上，底色偏黄。它进的是画布，不是原文——这一点靠颜色提示，
   * 不靠往文本里加「（补充）」三个字。
   */
  if (gapText) push(node('missing-premise', gapText, 'gap', COL.premise, stack(-1, prem.length) - ROW * 0.2));

  const known = new Set(nodes.map((n) => n.key));

  for (const c of [...prem, ...mid]) {
    if (!known.has(c.id)) continue;
    const targets = (c.supports ?? []).filter((t) => known.has(t));
    if (targets.length === 0) {
      if (known.has(d.conclusion.id)) edges.push({ from: c.id, to: d.conclusion.id });
      continue;
    }
    for (const t of targets) edges.push({ from: c.id, to: t });
  }

  for (const r of refs) {
    if (!known.has(r.id)) continue;
    if (known.has(r.targetId)) edges.push({ from: r.id, to: r.targetId });
    else dangling += 1;
  }

  if (gapText && known.has('missing-premise') && known.has(d.conclusion.id)) {
    edges.push({ from: 'missing-premise', to: d.conclusion.id });
  }

  return { nodes, edges, stats: { dangling, empty } };
}

/** 界面上那一行字：交出去了几个、丢了几条。空的时候也要说话。 */
export function graphSummary(g: PrgGraph): string {
  const base = `${g.nodes.length} 个节点、${g.edges.length} 条连线`;
  const lost: string[] = [];
  if (g.stats.dangling > 0) lost.push(`${g.stats.dangling} 条反驳没指到主张（目标不在报告里）`);
  if (g.stats.empty > 0) lost.push(`${g.stats.empty} 条文字为空`);
  return lost.length ? `${base}；${lost.join('，')}没有画出来` : base;
}

/** 导出的文件名。与 Markdown / Argdown 一样带透镜与时间，几份并排放时认得出是同一段的哪一次。 */
export function prgFileName(d: Diagnosis): string {
  const t = THEORY_BY_ID[d.theory];
  const s = new Date(d.createdAt)
    .toLocaleString('zh-CN', { hour12: false })
    .replace(/[/:\s]/g, '-')
    .replace(/-+/g, '-');
  return `论证镜-${t.short ?? t.name}-${s}.prg`;
}
