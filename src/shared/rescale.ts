import { sentenceBounds } from './reread';

/**
 * 换个尺度重读：把用户给的一组词，在**原文**上做字面替换，其余一个字不动。
 *
 * 为什么是「工具」而不是「又一段解释」：
 *   知识库里《哲学，有用嘛？》那一招是「通过简化问题的情境，保留问题的逻辑结构，
 *   让那些在复杂问题中不容易察觉的推理缺陷变得清晰可见」。它的力量来自
 *   **只换尺度、其余全不变**——差异才可归因。这里把这件事做成用户能自己发起的操作：
 *   词由用户填，替换由本地按区间做，结果留下可逐字复算的编辑记录。
 *   软件不写一句「所以这一步不成立」，判断权始终在人手里。
 *
 * 三条硬约束：
 *   1. 原文逐字保留（original 拼回来 === passage，含空行与结尾换行）。
 *   2. 不做语义理解、不做同义扩展、不替换替换结果（禁止连锁替换）。
 *   3. 所有失败都可见：没找到、被别的词挡住、跨了句子、词对本身无效，都明说。
 *
 * 坐标系沿用 Span 的 UTF-16 下标，切句复用 reread 的 sentenceBounds。
 */

export interface RescalePair {
  from: string;
  to: string;
}

export type RescaleStatus = 'empty-pairs' | 'all-invalid' | 'no-hit' | 'ok';
export type RescaleInvalid = 'empty-from' | 'empty-to' | 'same';
export type RescaleConflict = 'overlap' | 'cross-sentence';

/** 一处替换。坐标是**原文**上的全局下标；to 不会再被扫描，所以不可能连锁。 */
export interface RescaleEdit {
  start: number;
  end: number;
  from: string;
  to: string;
  pair: number;
}

export interface RescaleSentence {
  index: number;
  start: number;
  end: number;
  /** passage 的原样切片，不 trim。 */
  original: string;
  /** 只把落在本句里的 edits 应用上去；跨句的匹配一律不替换（见 conflicts）。 */
  rescaled: string;
  /** 落在本句里的编辑，坐标仍是全局，便于与整篇的 edits 对照。 */
  edits: RescaleEdit[];
}

export interface RescaleConflictItem {
  from: string;
  start: number;
  reason: RescaleConflict;
  /** 被谁挡住了；跨句时为空串。 */
  keptBy: string;
}

export interface RescaleView {
  status: RescaleStatus;
  passage: string;
  /** 原样回显，界面与断言都能复算。 */
  pairs: RescalePair[];
  sentences: RescaleSentence[];
  edits: RescaleEdit[];
  /** 整篇替换后的文本，由 edits 构造，不另走一遍字符串 replace。 */
  rescaled: string;
  /** 一个都没找到的 from。 */
  missing: string[];
  conflicts: RescaleConflictItem[];
  invalid: RescaleInvalid[];
  hitCount: number;
  /** 原文里没被换掉的字数（被覆盖的原字符数不计入）。 */
  unchangedChars: number;
}

interface RankedPair extends RescalePair {
  index: number;
}

function collect(passage: string, pairs: RescalePair[], active: boolean) {
  const invalid: RescaleInvalid[] = [];
  /*
   * 两行空输入框是「还没开始填」，不是「填错了两组」。
   * 端到端第一次跑就露出了这句带责备的文案；没填过任何字时不收集无效原因。
   */
  if (active) {
    for (const p of pairs) {
      if (!p.from.length) invalid.push('empty-from');
      else if (!p.to.length) invalid.push('empty-to');
      else if (p.from === p.to) invalid.push('same');
    }
  }
  const valid: RankedPair[] = active
    ? pairs
        .map((p, index) => ({ ...p, index }))
        .filter((p) => p.from.length > 0 && p.to.length > 0 && p.from !== p.to)
    : [];

  /* 收集顺序按用户填的来。同一起点上谁胜出，由下面 raw.sort 的「区间长者在前」决定，
     不在这里排长度——曾经把排序写在这儿，注释说它管长词优先，实际改坏它行为一点不变。 */
  const ranked = valid;
  const raw: RescaleEdit[] = [];
  const missing: string[] = [];
  for (const p of ranked) {
    let n = 0;
    let cursor = 0;
    for (;;) {
      const at = passage.indexOf(p.from, cursor);
      if (at < 0) break;
      raw.push({ start: at, end: at + p.from.length, from: p.from, to: p.to, pair: p.index });
      n += 1;
      cursor = at + p.from.length;
    }
    if (!n) missing.push(p.from);
  }

  /* 同一起点长词在前；重叠区间只保留先被接受的那一个，其余明说被挡住。 */
  raw.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start) || a.pair - b.pair);
  const accepted: RescaleEdit[] = [];
  const conflicts: RescaleConflictItem[] = [];
  let lastEnd = -1;
  let keptBy = '';
  for (const m of raw) {
    if (m.start < lastEnd) {
      conflicts.push({ from: m.from, start: m.start, reason: 'overlap', keptBy });
      continue;
    }
    accepted.push(m);
    lastEnd = m.end;
    keptBy = m.from;
  }
  return { valid, accepted, conflicts, missing, invalid };
}

/** 把 edits 应用到 [from,to) 这段原文上；edits 的坐标是全局的。 */
function render(passage: string, from: number, to: number, edits: RescaleEdit[]): string {
  let out = '';
  let cursor = from;
  for (const e of edits) {
    if (e.start < from || e.end > to) continue;
    out += passage.slice(cursor, e.start) + e.to;
    cursor = e.end;
  }
  return out + passage.slice(cursor, to);
}

export function rescaleOf(passage: string, pairs: RescalePair[]): RescaleView {
  const text = passage ?? '';
  const copy = pairs.map((p) => ({ from: p.from ?? '', to: p.to ?? '' }));
  const anyFilled = copy.some((p) => p.from.length > 0 || p.to.length > 0);
  const { valid, accepted, conflicts, missing, invalid } = collect(text, copy, anyFilled);
  const bounds = sentenceBounds(text);

  /*
   * 跨句的匹配一律不替换：把「第 1 句末尾 + 第 2 句开头」一起换掉，
   * 并排两栏就会错位，而错位看起来只是排版有点怪。宁可不换，也要说清为什么。
   */
  const edits: RescaleEdit[] = [];
  for (const e of accepted) {
    const inside = bounds.some((b) => e.start >= b.start && e.end <= b.end);
    if (inside) edits.push(e);
    else conflicts.push({ from: e.from, start: e.start, reason: 'cross-sentence', keptBy: '' });
  }
  conflicts.sort((a, b) => a.start - b.start || a.from.localeCompare(b.from));

  const rescaled = render(text, 0, text.length, edits);
  const sentences: RescaleSentence[] = bounds.map((b) => ({
    index: b.index,
    start: b.start,
    end: b.end,
    original: b.text,
    rescaled: render(text, b.start, b.end, edits),
    edits: edits.filter((e) => e.start >= b.start && e.end <= b.end),
  }));

  const covered = edits.reduce((n, e) => n + (e.end - e.start), 0);
  const status: RescaleStatus = !anyFilled
    ? 'empty-pairs'
    : !valid.length
      ? 'all-invalid'
      : !edits.length
        ? 'no-hit'
        : 'ok';

  return {
    status,
    passage: text,
    pairs: copy,
    sentences,
    edits,
    rescaled,
    missing: [...new Set(missing)],
    conflicts,
    invalid: [...new Set(invalid)],
    hitCount: edits.length,
    unchangedChars: text.length - covered,
  };
}

/**
 * 逆变换：拿替换后的文本与编辑记录还原原文。
 * 这是「可复算」的正面证据——断言用它验 === passage，界面不必再实现一遍。
 */
export function revertRescale(view: RescaleView): string {
  let out = '';
  let cursor = 0;
  let delta = 0;
  for (const e of view.edits) {
    const newStart = e.start + delta;
    const newEnd = newStart + e.to.length;
    out += view.rescaled.slice(cursor, newStart) + e.from;
    cursor = newEnd;
    delta += e.to.length - (e.end - e.start);
  }
  return out + view.rescaled.slice(cursor);
}

export const RESCALE_STATUS_LABEL: Record<RescaleStatus, string> = {
  'empty-pairs': '还没填词。填一组「把什么 → 换成什么」，再看同一段话怎么变。',
  'all-invalid': '这几组词都没法用（左边空着、右边空着、或两边一样）。',
  'no-hit': '原文里一个都没找到。换过的文本不会显示，免得看着像换了其实没换。',
  ok: '',
};

export const RESCALE_INVALID_LABEL: Record<RescaleInvalid, string> = {
  'empty-from': '有一组左边是空的',
  'empty-to': '有一组右边是空的',
  same: '有一组左右相同',
};

export const RESCALE_CONFLICT_LABEL: Record<RescaleConflict, string> = {
  overlap: '与另一处替换重叠，没有换',
  'cross-sentence': '跨了句子边界，没有换',
};
