import type { Diagnosis, LabelCandidate, LegitimateMove, Claim, Span } from './types';
import { mapSentences } from './fallacy-map';

/**
 * 回到原文重读：把报告里「指着原文某一句」的条目，按句子重新摆一遍。
 *
 * 这一屏为什么必须是纯函数、且不许写一个字的判断：
 *   实测真实存档里，报告 ≥12 字的文字有 97.4% 逐字来自模型返回的那段 JSON，
 *   本地只贡献了下标、名录统一与按模式删栏。再让模型（或本地）生成一段「解释」，
 *   得到的仍然是「一份生成好的东西」，而不是一个能让人自己看懂原文的动作。
 *   所以这里只做搬运：原文一字不改，条目文字逐字引自报告，位置由下标算。
 *
 * 效果来自「重新摆」本身：同一句上可能同时挂着一条命名和一条「此处合法」，
 *   两条都留着，不合并、不下结论；也可能有一句谁都没提。
 *   这些都是报告里本来就有的事实，只是按报告顺序读时看不见。
 *
 * 坐标系沿用 Span 的 UTF-16 下标，不换算。切句复用 fallacy-map 的 mapSentences，
 *   不再另造一套切法——两套切法迟早会在某个标点上给出不同的句子。
 */

export type RereadKind = 'claim' | 'label' | 'legit';

/**
 * 为什么没能指回原文。
 * 「没位置」绝不当成「没有发现」静默丢掉：那会让这一屏看起来比报告更确定。
 */
export type UnplacedReason =
  | 'no-span'
  | 'span-failed'
  | 'span-out-of-range'
  | 'no-quote'
  | 'quote-not-found'
  | 'quote-ambiguous'
  | 'no-sentence';

export interface RereadRef {
  kind: RereadKind;
  id: string;
  /** 报告里已经写下的一句，逐字引用。本地不新写任何判断文字。 */
  text: string;
  /** 它是靠原文里哪几个字定位的（同样来自报告）。 */
  quote: string | null;
  /** 与所在句子有交集的下标，供断言核对「没挂错句」。 */
  start: number;
  end: number;
}

export interface RereadSentence {
  index: number;
  start: number;
  end: number;
  /** passage 的原样切片，不 trim、不改写——拼回来必须逐字等于原文。 */
  text: string;
  refs: RereadRef[];
  /** 这一句没有任何条目指到它。 */
  quiet: boolean;
}

export interface RereadUnplaced {
  kind: RereadKind;
  id: string;
  reason: UnplacedReason;
}

export interface RereadView {
  sentences: RereadSentence[];
  unplaced: RereadUnplaced[];
  /** 挂到句子上的条目次数（跨句引用会在多句各记一次）。 */
  refCount: number;
  quietCount: number;
}

interface Candidate {
  kind: RereadKind;
  id: string;
  text: string;
  quote: string | null;
  span: { start: number; end: number } | null;
  reason: UnplacedReason | null;
}

/** 一条带 Span 的条目：quality=failed 是模型自己承认没对上原文，不能拿来钉句子。 */
function bySpan(
  kind: RereadKind,
  id: string,
  text: string,
  span: Span | null | undefined,
  passageLen: number,
): Candidate {
  if (!span) return { kind, id, text, quote: null, span: null, reason: 'no-span' };
  if (span.quality === 'failed') {
    return { kind, id, text, quote: span.quote || null, span: null, reason: 'span-failed' };
  }
  if (!(span.start >= 0 && span.end > span.start && span.end <= passageLen)) {
    return { kind, id, text, quote: span.quote || null, span: null, reason: 'span-out-of-range' };
  }
  return {
    kind,
    id,
    text,
    quote: span.quote || null,
    span: { start: span.start, end: span.end },
    reason: null,
  };
}

/**
 * 「此处合法」没有 span 字段，只有逐字引文。
 * 只在引文于原文中恰好出现一次时定位：猜最近的一句、或取第一次出现，
 * 都会让用户拿着错的句子去核对——落点图早就为这条吃过亏。
 */
function byQuote(kind: RereadKind, id: string, text: string, raw: string | undefined, passage: string): Candidate {
  const q = (raw ?? '').trim();
  const quote = q || null;
  if (!q) return { kind, id, text, quote, span: null, reason: 'no-quote' };
  const first = passage.indexOf(q);
  if (first < 0) return { kind, id, text, quote, span: null, reason: 'quote-not-found' };
  if (passage.indexOf(q, first + 1) >= 0) {
    return { kind, id, text, quote, span: null, reason: 'quote-ambiguous' };
  }
  return { kind, id, text, quote, span: { start: first, end: first + q.length }, reason: null };
}

/** 句子边界：复用 mapSentences 的 end，但 start 一律接上一句的 end。 */
function sentenceBounds(passage: string): { start: number; end: number; text: string; index: number }[] {
  const ends = mapSentences(passage).map((s) => s.end);
  /*
   * mapSentences 会把空句（连续换行）直接丢掉，也不收尾部空白。
   * 那些字符仍是原文，不能在这里消失——把最后一句的 end 扩到 passage.length，
   * 每句的 start 接上一句 end，丢掉的空白自然归到后一句的开头。
   * 于是「逐句拼回来 === 原文」对空行、结尾换行都成立。
   */
  const out: { start: number; end: number; text: string; index: number }[] = [];
  if (!ends.length) {
    if (passage.length) out.push({ index: 0, start: 0, end: passage.length, text: passage });
    return out;
  }
  let cursor = 0;
  ends.forEach((rawEnd, i) => {
    const end = i === ends.length - 1 ? passage.length : rawEnd;
    out.push({ index: i, start: cursor, end, text: passage.slice(cursor, end) });
    cursor = end;
  });
  return out;
}

export function rereadOf(d: Diagnosis): RereadView {
  const passage = d.passage ?? '';
  const sentences = sentenceBounds(passage).map((s) => ({ ...s, refs: [] as RereadRef[], quiet: true }));

  const claims: Claim[] = [d.conclusion, ...(d.premises ?? []), ...(d.intermediate ?? [])];
  const labels: LabelCandidate[] = d.labels ?? [];
  const legits: LegitimateMove[] = d.legitimateMoves ?? [];

  const candidates: Candidate[] = [
    ...claims.map((c) => bySpan('claim', c.id, c.text, c.span, passage.length)),
    ...labels.map((l) => bySpan('label', l.id, l.name, l.span, passage.length)),
    ...legits.map((m) => byQuote('legit', m.targetId, m.what, m.quote, passage)),
  ];

  const unplaced: RereadUnplaced[] = [];
  for (const c of candidates) {
    if (c.reason || !c.span) {
      unplaced.push({ kind: c.kind, id: c.id, reason: c.reason ?? 'no-span' });
      continue;
    }
    const hit = sentences.filter((s) => c.span!.start < s.end && s.start < c.span!.end);
    if (!hit.length) {
      unplaced.push({ kind: c.kind, id: c.id, reason: 'no-sentence' });
      continue;
    }
    for (const s of hit) {
      s.refs.push({
        kind: c.kind,
        id: c.id,
        text: c.text,
        quote: c.quote,
        start: c.span.start,
        end: c.span.end,
      });
    }
  }

  let refCount = 0;
  let quietCount = 0;
  for (const s of sentences) {
    s.quiet = s.refs.length === 0;
    refCount += s.refs.length;
    if (s.quiet) quietCount++;
  }
  /* 逐字来自报告的检查需要稳定顺序：同一输入两次调用必须给出同一个结果。 */
  unplaced.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));

  return { sentences, unplaced, refCount, quietCount };
}

export const REREAD_KIND_LABEL: Record<RereadKind, string> = {
  claim: '主张',
  label: '命名',
  legit: '此处合法',
};

export const UNPLACED_LABEL: Record<UnplacedReason, string> = {
  'no-span': '没有标位置',
  'span-failed': '位置没对上原文',
  'span-out-of-range': '位置越出原文',
  'no-quote': '没有引文',
  'quote-not-found': '引文在原文里找不到',
  'quote-ambiguous': '引文在原文里出现不止一次',
  'no-sentence': '没落到任何一句',
};
