/**
 * 逐字比：原话那一句 vs 报告整理出来的那一句。
 *
 * 为什么要有这一层：
 *
 * 报告里 `Claim.text`（规范化陈述）不是原文，是模型把 `Claim.quote`（原话）
 * 整理成的可检验命题。2026-11-09 实测本机 103 份存档：407 条主张里
 * **406 条的这两句话不一样**，其中 308 条能读出连续的字面改动
 * （例如原话「这说明取消早读是错的」→ 这一句「取消早读是错的，应当恢复早读」）。
 * 这一步改写此前在界面上完全不可见：两行并排放着，读的人自己得去对。
 *
 * 这里做的只有一件事：**把两句话逐字比一遍，把对不上的连续片段列出来**。
 * 它是贴着每一条主张显示的，不是报告外面另开一栏。
 *
 * 四条约束：
 *   1. **不改报告。** 只读 `quote` / `text`，不动 `Diagnosis` 的任何字段。
 *   2. **不下判断。** 不评价改写对不对、不判口气越界、不说「应当」如何。
 *      输出里只有字数与逐字片段；说「对不上」不等于说「改错了」。
 *   3. **比不出来就明说。** 没引文、两句话逐字相同、只差单个字、
 *      超过本地上限——四种各有各的说法，不静默给一张空表。
 *   4. **片段逐字来自输入。** 不截断、不改写、不加前缀；唯一处理是比之前
 *      去掉空白（中文里的空格不该把同一句话切成两段）。
 */

import type { Claim } from './types';

/** 本地逐字比的长度上限。超过就明说没比，不悄悄按前 400 字算。 */
export const REWRITE_MAX_CHARS = 400;

/** 连续片段至少几个非标点字才值得列出来。 */
const MIN_FRAGMENT = 2;

/** 只用来判断片段「有没有内容」；片段本身仍按原样显示。 */
const PUNCT = /[\s\u3000，。、；：？！「」『』""''（）()《〈〉》<>,.?!;:'"\[\]【】—…·-]/g;

/** 片段首尾的标点不列——「，应当恢复早读」读起来不像一处改动。剥完仍是原话的连续子串。 */
const isPunct = (ch: string): boolean =>
  /[\s\u3000，。、；：？！「」『』""''（）()《〈〉》<>,.?!;:'"\[\]【】—…·-]/.test(ch);
const trimEdges = (s: string): string => {
  let a = 0;
  let b = s.length;
  while (a < b && isPunct(s[a])) a++;
  while (b > a && isPunct(s[b - 1])) b--;
  return s.slice(a, b);
};

export type RewriteKind = 'fragments' | 'one-char' | 'too-long';

export interface RewriteDiff {
  /** 原话（去空白后，逐字来自 claim.quote） */
  quote: string;
  /** 整理后那一句（去空白后，逐字来自 claim.text） */
  text: string;
  /** 原话去掉空白后的字数 */
  quoteChars: number;
  /** 这一句去掉空白后的字数 */
  textChars: number;
  /** 原话里有、这一句没接上的连续片段 */
  gone: string[];
  /** 这一句里、原话对不上的连续片段 */
  added: string[];
  kind: RewriteKind;
  /** 一行总述，带单位 */
  line: string;
  /** 片段明细；没有片段时是 null */
  detail: string | null;
}

const strip = (s: string): string => s.replace(/[\s\u3000]/g, '');

/**
 * 最长公共子序列 → 把两句的差异拆成连续的「原话没接上」与「这一句对不上」片段。
 * 用 LCS 而不是按下标对齐：一句话在中间插了几个字，后面的字不该全被算成改动。
 */
function diffFragments(a: string, b: string): { gone: string[]; added: string[] } {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rawGone: string[] = [];
  const rawAdded: string[] = [];
  let i = 0;
  let j = 0;
  let g = '';
  let d = '';
  const flush = (): void => {
    if (g) rawGone.push(g);
    if (d) rawAdded.push(d);
    g = '';
    d = '';
  };
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      flush();
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      g += a[i++];
    } else {
      d += b[j++];
    }
  }
  g += a.slice(i);
  d += b.slice(j);
  flush();
  /* 只有标点、或只剩一个字的片段不列：那是噪声，不是一处改动。 */
  const keep = (s: string): boolean => s.replace(PUNCT, '').length >= MIN_FRAGMENT;
  return {
    gone: rawGone.map(trimEdges).filter(keep),
    added: rawAdded.map(trimEdges).filter(keep),
  };
}

/**
 * 核一条主张。以下三种返回 null，界面就整行不显示（也不写「0 处」）：
 *   没有引文（隐含前提）、两句逐字相同、任一句为空。
 */
export function rewriteOf(claim: Pick<Claim, 'quote' | 'text'>): RewriteDiff | null {
  const quote = strip(String(claim.quote ?? ''));
  const text = strip(String(claim.text ?? ''));
  if (!quote || !text || quote === text) return null;

  if (quote.length > REWRITE_MAX_CHARS || text.length > REWRITE_MAX_CHARS) {
    return {
      quote,
      text,
      quoteChars: quote.length,
      textChars: text.length,
      gone: [],
      added: [],
      kind: 'too-long',
      line: `本地没比完：原话 ${quote.length} 字、这一句 ${text.length} 字，超过本地逐字比上限 ${REWRITE_MAX_CHARS} 字。`,
      detail: null,
    };
  }

  const { gone, added } = diffFragments(quote, text);
  if (!gone.length && !added.length) {
    return {
      quote,
      text,
      quoteChars: quote.length,
      textChars: text.length,
      gone,
      added,
      kind: 'one-char',
      line: `本地逐字比：原话 ${quote.length} 字、这一句 ${text.length} 字；只差单个字，读不出连续的片段。`,
      detail: null,
    };
  }

  const parts: string[] = [];
  if (gone.length) parts.push(`原话里有、这一句没接上：${gone.map((s) => `「${s}」`).join('　')}`);
  if (added.length) parts.push(`这一句里、原话对不上：${added.map((s) => `「${s}」`).join('　')}`);
  return {
    quote,
    text,
    quoteChars: quote.length,
    textChars: text.length,
    gone,
    added,
    kind: 'fragments',
    line: `本地逐字比：原话 ${quote.length} 字、这一句 ${text.length} 字；${gone.length} 段没接上、${added.length} 段对不上。`,
    detail: parts.join('；'),
  };
}

/** 界面上那一小块的说明。单独导出，好让断言能逐字守住「这里不写判断」。 */
export const REWRITE_NOTE = '只比字面，不判改写对不对；这两句都是报告自己写下的。';

/**
 * 一句话说清这份报告里被整理过多少条。只数事实，不挑「哪一条最值得看」——
 * 挑一条就是给一个优先级，那是判断，本地不做。
 */
export function rewriteSummary(claims: readonly Pick<Claim, 'quote' | 'text'>[]): string | null {
  const diffs = claims.map(rewriteOf).filter((x): x is RewriteDiff => x !== null);
  if (!diffs.length) return null;
  const withFragments = diffs.filter((d) => d.kind === 'fragments').length;
  const notCompared = diffs.filter((d) => d.kind === 'too-long').length;
  const tail = notCompared ? `，其中 ${notCompared} 条本地没比完` : '';
  return `${claims.length} 条主张里，${diffs.length} 条被整理成另一句话；${withFragments} 条读得出连续的改动${tail}。`;
}
