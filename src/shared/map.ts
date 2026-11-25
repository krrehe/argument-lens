/**
 * 全屏论证地图的数据层（纯函数）。
 *
 * 这一层只回答一件事：**报告里已经写下的字和关系，能不能摆到一张图上。**
 * 它不判断哪一处更重要、不挑「最值得看」的节点、不把检查项的答复再算一遍。
 *
 * 三条硬边界（与产品定位一致）：
 *   1. 节点文字逐字来自报告字段，不在本地加「结论：」「最要紧：」这类前缀；
 *   2. 连线只画报告写过的关系（supports / 反驳的 targetId / 改法的 fixes），
 *      报告没写的线不补——空 supports 不默认接到结论上；
 *   3. 落点不存在就不画，并把「谁的哪条线没画」说出来，不静默丢。
 *
 * 版面是简化版的分层布局（参考 ELK / Sugiyama 的前两步）：从结论沿 supports
 * 反向 BFS 得深度，深度 0 在最右，越往左越远；同层按报告原有顺序排。
 * 不做断环与减交叉——结构由报告负责，图只照抄。
 */

import type { CheckItem, Diagnosis, Refutation, RevisionPath } from './types';

export type MapNodeKind = 'conclusion' | 'premise' | 'intermediate' | 'check' | 'refutation' | 'revision';
export type MapEdgeKind = 'support' | 'attack' | 'repair';

export interface MapNode {
  kind: MapNodeKind;
  /** 报告里的编号：C / P1 / M1 / CQ2 / R1 / V1。 */
  id: string;
  /** 界面上那一类节点的名字（结论 / 前提 / 检查 / 反驳 / 改法）。 */
  label: string;
  /** 逐字来自报告字段，不加前缀后缀。 */
  text: string;
  /** 仅检查节点：报告给的答复。 */
  status?: CheckItem['answer'];
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapEdge {
  from: string;
  to: string;
  kind: MapEdgeKind;
}

export interface ArgumentMap {
  nodes: MapNode[];
  edges: MapEdge[];
  /** 落点不存在、连线画不出来时逐条说明。 */
  problems: string[];
  width: number;
  height: number;
}

/** 节点正文每行按 18 个中文字宽折行。组件用同一个数，免得算高与画字两套。 */
export const MAP_TEXT_BUDGET = 18;
/** 节点正文最多三行；超出的部分靠详情面板看全文，图里不静默截断而不说。 */
export const MAP_MAX_LINES = 3;
/** 节点版式：标题区高、行高、正文首行基线。组件与估高共用，不各写一份。 */
export const MAP_HEAD_H = 26;
export const MAP_LINE_H = 16;
export const MAP_BODY_TOP = MAP_HEAD_H + 12;

/** 界面与导出共用的一句话。口径只留一处。 */
export const MAP_NOTE =
  '这张图只读：节点上的字逐字来自报告，位置只表示排版，不表示轻重；连线只画报告写下的支撑、打向与改向，没画出来的地方就是报告没写。';

/* ─────────── 版面常量 ─────────── */

const NODE_W = 240;
const BODY_PAD = 10;
const PAD = 32;
const COL_GAP = 64;
const ROW_GAP = 18;
const BAND_GAP = 52;
const BAND_LABEL_H = 22;
const BAND_ROW_GAP = 16;

/** 与 Diagram.tsx 的 wrap() 同一套宽度单位：中文 1、西文 0.55。这里只用来估高。 */
function units(text: string): number {
  let n = 0;
  for (const ch of text) n += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.55;
  return n;
}

function linesOf(text: string): number {
  const n = units(text);
  if (n <= 0) return 1;
  return Math.min(MAP_MAX_LINES, Math.max(1, Math.ceil(n / MAP_TEXT_BUDGET)));
}

function heightOf(text: string): number {
  return MAP_HEAD_H + linesOf(text) * MAP_LINE_H + BODY_PAD;
}

function textOf(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/* ─────────── 节点 ─────────── */

function claimNode(kind: MapNodeKind, label: string, id: string, text: string): MapNode {
  const t = text || id;
  return { kind, id, label, text: t, x: 0, y: 0, w: NODE_W, h: heightOf(t) };
}

function checkNode(c: CheckItem): MapNode {
  const t = textOf(c.label) || textOf(c.question) || c.id;
  return { kind: 'check', id: c.id, label: '检查', text: t, status: c.answer, x: 0, y: 0, w: NODE_W, h: heightOf(t) };
}

function refuteNode(r: Refutation): MapNode {
  const t = textOf(r.claim) || r.id;
  return { kind: 'refutation', id: r.id, label: '反驳', text: t, x: 0, y: 0, w: NODE_W, h: heightOf(t) };
}

function revisionNode(v: RevisionPath, i: number): MapNode {
  const id = `V${i + 1}`;
  const t = textOf(v.change) || textOf(v.kind) || id;
  return { kind: 'revision', id, label: '改法', text: t, x: 0, y: 0, w: NODE_W, h: heightOf(t) };
}

/* ─────────── 主函数 ─────────── */

export function buildMap(d: Diagnosis): ArgumentMap {
  const problems: string[] = [];
  const nodes: MapNode[] = [];
  const seen = new Set<string>();

  const add = (n: MapNode): void => {
    if (seen.has(n.id)) {
      problems.push(`编号「${n.id}」出现了两次，后一处没画`);
      return;
    }
    seen.add(n.id);
    nodes.push(n);
  };

  add(claimNode('conclusion', '结论', d.conclusion.id, d.conclusion.text));
  for (const p of d.premises) add(claimNode('premise', '前提', p.id, p.text));
  for (const m of d.intermediate) add(claimNode('intermediate', '中间结论', m.id, m.text));
  for (const c of d.checks) add(checkNode(c));
  for (const r of d.refutations) add(refuteNode(r));
  const revisions = d.revisions ?? [];
  revisions.forEach((v, i) => add(revisionNode(v, i)));

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const claimList = [d.conclusion, ...d.premises, ...d.intermediate];
  const claimIds = new Set(claimList.map((c) => c.id));

  /* ── 深度：从结论沿 supports 反向 BFS ── */

  const parents = new Map<string, string[]>();
  for (const c of claimList) {
    for (const t of c.supports ?? []) {
      if (t === c.id || !claimIds.has(t)) continue;
      const list = parents.get(t) ?? [];
      list.push(c.id);
      parents.set(t, list);
    }
  }
  const depth = new Map<string, number>([[d.conclusion.id, 0]]);
  const queue: string[] = [d.conclusion.id];
  while (queue.length) {
    const t = queue.shift()!;
    const dt = depth.get(t)!;
    for (const src of parents.get(t) ?? []) {
      if (depth.has(src)) continue;
      depth.set(src, dt + 1);
      queue.push(src);
    }
  }
  const maxDepth = Math.max(0, ...[...depth.values()]);
  const loose = claimList.filter((c) => !depth.has(c.id));
  const leftmost = loose.length ? maxDepth + 1 : maxDepth;
  const cols = leftmost + 1;

  /* ── 画布尺寸 ── */

  const claimsRight = PAD + cols * NODE_W + (cols - 1) * COL_GAP;
  const checks = nodes.filter((n) => n.kind === 'check');
  const refs = nodes.filter((n) => n.kind === 'refutation');
  const revs = nodes.filter((n) => n.kind === 'revision');
  const checkX = claimsRight + COL_GAP;
  const width = (checks.length ? checkX + NODE_W : claimsRight) + PAD;

  const perRow = Math.max(1, Math.min(3, Math.floor((width - 2 * PAD + BAND_ROW_GAP) / (NODE_W + BAND_ROW_GAP))));

  /* ── 反驳横带（上方） ── */

  let refBandH = 0;
  if (refs.length) {
    for (let i = 0; i < refs.length; i += perRow) {
      const row = refs.slice(i, i + perRow);
      refBandH += Math.max(...row.map((n) => n.h)) + BAND_ROW_GAP;
    }
    refBandH += BAND_LABEL_H;
  }

  const bodyY = PAD + refBandH + (refs.length ? BAND_GAP : 0);
  const stackH = (list: MapNode[]): number =>
    list.reduce((s, n) => s + n.h, 0) + Math.max(0, list.length - 1) * ROW_GAP;
  const claimsStack = new Map<number, MapNode[]>();
  for (const c of claimList) {
    const n = byId.get(c.id);
    if (!n) continue;
    const dep = depth.get(c.id) ?? leftmost;
    const list = claimsStack.get(dep) ?? [];
    list.push(n);
    claimsStack.set(dep, list);
  }
  const claimsH = Math.max(1, ...[...claimsStack.values()].map(stackH));
  const checksH = stackH(checks);
  const bodyH = Math.max(claimsH, checksH, byId.get(d.conclusion.id)?.h ?? 0);

  /* ── 落位：主张列 ── */

  for (const [dep, list] of claimsStack) {
    const x = PAD + (leftmost - dep) * (NODE_W + COL_GAP);
    let y = bodyY + (bodyH - stackH(list)) / 2;
    for (const n of list) {
      n.x = x;
      n.y = y;
      y += n.h + ROW_GAP;
    }
  }
  {
    const x = checkX;
    let y = bodyY + (bodyH - checksH) / 2;
    for (const n of checks) {
      n.x = x;
      n.y = y;
      y += n.h + ROW_GAP;
    }
  }

  /* ── 落位：反驳横带 ── */

  if (refs.length) {
    let y = PAD + BAND_LABEL_H;
    for (let i = 0; i < refs.length; i += perRow) {
      const row = refs.slice(i, i + perRow);
      const rowH = Math.max(...row.map((n) => n.h));
      const rowW = row.length * NODE_W + (row.length - 1) * BAND_ROW_GAP;
      let x = PAD + (width - 2 * PAD - rowW) / 2;
      for (const n of row) {
        n.x = x;
        n.y = y + (rowH - n.h) / 2;
        x += NODE_W + BAND_ROW_GAP;
      }
      y += rowH + BAND_ROW_GAP;
    }
  }

  /* ── 落位：改法横带（下方，带分组标签） ── */

  let revBandH = 0;
  if (revs.length) {
    revBandH = BAND_LABEL_H;
    for (let i = 0; i < revs.length; i += perRow) {
      const row = revs.slice(i, i + perRow);
      revBandH += Math.max(...row.map((n) => n.h)) + BAND_ROW_GAP;
    }
  }
  const height = bodyY + bodyH + (revs.length ? BAND_GAP + revBandH : 0) + PAD;

  if (revs.length) {
    let y = bodyY + bodyH + BAND_GAP + BAND_LABEL_H;
    for (let i = 0; i < revs.length; i += perRow) {
      const row = revs.slice(i, i + perRow);
      const rowH = Math.max(...row.map((n) => n.h));
      const rowW = row.length * NODE_W + (row.length - 1) * BAND_ROW_GAP;
      let x = PAD + (width - 2 * PAD - rowW) / 2;
      for (const n of row) {
        n.x = x;
        n.y = y + (rowH - n.h) / 2;
        x += NODE_W + BAND_ROW_GAP;
      }
      y += rowH + BAND_ROW_GAP;
    }
  }

  /* ── 连线：只画报告写下的关系 ── */

  const edges: MapEdge[] = [];
  const edgeKeys = new Set<string>();
  const link = (from: string, to: string, kind: MapEdgeKind): void => {
    const key = `${kind}:${from}->${to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ from, to, kind });
  };

  for (const c of claimList) {
    for (const t of c.supports ?? []) {
      if (t === c.id) {
        problems.push(`支撑线 ${c.id} 指向自己，这条线没画`);
        continue;
      }
      if (!byId.has(t)) {
        problems.push(`支撑线 ${c.id} → ${t}：报告里没有「${t}」这个位置，这条线没画`);
        continue;
      }
      link(c.id, t, 'support');
    }
  }

  for (const r of d.refutations) {
    if (!byId.has(r.targetId)) {
      problems.push(`反驳 ${r.id} 打向「${r.targetId}」：报告里没有这个位置，这条线没画`);
      continue;
    }
    link(r.id, r.targetId, 'attack');
  }

  if (d.defeat.kind !== 'none' && d.defeat.checkId) {
    if (!byId.has(d.defeat.checkId)) {
      problems.push(`击败落点「${d.defeat.checkId}」：报告里没有这条检查，这条线没画`);
    } else {
      link(d.defeat.checkId, d.conclusion.id, 'attack');
    }
  }

  revisions.forEach((v, i) => {
    const from = `V${i + 1}`;
    for (const fix of v.fixes ?? []) {
      if (!byId.has(fix)) {
        problems.push(`改法 ${from} 要修的「${fix}」：报告里没有这个位置，这条线没画`);
        continue;
      }
      link(from, fix, 'repair');
    }
  });

  return { nodes, edges, problems, width, height };
}
