/**
 * 口气复核：拿原文那一句，核报告那一句。
 *
 * 为什么要有这一层：
 *
 * 报告里 `conclusion.modalOverreach` / `modalNote` 这两个字段是**模型自己判**的，
 * 而它在界面上一处都没显示过（2026-11-08 实测：整个 `src/renderer` 里只有假数据提到它）。
 * 也就是说模型判了「结论口气越界」，用户一个字也看不到。
 *
 * 这一层做的是另一件事：**不信那个字段，本地从两头各读一遍字面**。
 *
 *   原文那句（quote，逐字来自 passage）
 *   报告那句（text，模型整理后的规范化陈述）
 *
 * 两句话比三样东西：软化词、硬化词、因果/推论词。任一处对不上就列出来，
 * 并附上两边的原话——**由人自己核，不由软件下结论**。
 *
 * 三条约束：
 *   1. **不改报告。** 这里只读，不动 `Diagnosis` 的一个字段。
 *   2. **只在字面有证据时说话。** 读不到就说「本地判不了」，不猜语义。
 *      一个到处报越界的检查器会让人连真的越界也不信。
 *   3. **不与模型争执谁对。** 模型说越界、本地没找到，也照实说——
 *      本地只看字面，「看不出来」不等于「没有」。
 */

import type { Diagnosis } from './types';
import { sentenceBounds } from './reread';

/* ─────────── 词表 ─────────── */

/**
 * 软化词：原文这么说，报告不该把这句话写成断言。
 * 注意「不一定」与「一定」重叠——取词必须先长后短，否则「不一定」会被读成「一定」。
 */
const HEDGES = [
  '不一定',
  '可能',
  '也许',
  '或许',
  '大概',
  '未必',
  '似乎',
  '恐怕',
  '有待',
  '尚未',
  '说不准',
  '不排除',
];

/** 硬化词：报告里出现、原文没有，就是报告说得比原文硬。 */
const HARD = ['一定', '必然', '肯定', '绝对', '毫无疑问', '无疑', '只能', '唯一', '完全是', '显然'];

/** 因果与推论词：把「同时发生」写成「因此」，是另一种方向上的一步。 */
const CAUSAL = ['说明', '证明', '导致', '造成', '因为', '所以', '因此', '使得', '意味着'];

/** 只表示并存、不表示因果。原文用它们时，报告换成因果词就是多走了一步。 */
const COOCCUR = ['同时', '同期', '随后', '之后', '伴随', '与此同时', '恰好'];

/* ─────────── 读词 ─────────── */

export interface Hit {
  word: string;
  at: number;
}

/**
 * 在一段话里找出命中的词。**长词优先**，命中区间不再被短词复用——
 * 「不一定」里那三个字都属于它，不算「一定」。
 *
 * `occupied` 让调用方把「已经被别的词表占住的位置」传进来。四张表必须共用
 * 一份占位记录，否则分开扫的时候「不一定」在 HEDGES 里是软化词、
 * 在 HARD 里又会命中「一定」——同一句话被读成两个相反的口气。
 */
export function hitsOf(text: string, words: string[], occupied?: boolean[]): Hit[] {
  const sorted = [...words].sort((a, b) => b.length - a.length);
  const taken = occupied ?? new Array<boolean>(text.length).fill(false);
  const out: Hit[] = [];
  for (const w of sorted) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(w, from);
      if (at < 0) break;
      let free = true;
      for (let i = at; i < at + w.length; i++) if (taken[i]) free = false;
      if (free) {
        for (let i = at; i < at + w.length; i++) taken[i] = true;
        out.push({ word: w, at });
      }
      from = at + 1;
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

export interface ReadAll {
  hedges: Hit[];
  hard: Hit[];
  causal: Hit[];
  cooccur: Hit[];
}

/**
 * 四张表共用一份占位记录扫一遍。
 * **跨类别的判断必须走这里**；单独拿 `hitsOf(文本, HARD)` 会把
 * 「不一定」里的「一定」也读成硬化词。
 */
export function readAll(text: string): ReadAll {
  const taken = new Array<boolean>(text.length).fill(false);
  return {
    hedges: hitsOf(text, HEDGES, taken),
    hard: hitsOf(text, HARD, taken),
    causal: hitsOf(text, CAUSAL, taken),
    cooccur: hitsOf(text, COOCCUR, taken),
  };
}

/* ─────────── 差在哪 ─────────── */

export type DifferenceKind = 'hedge-dropped' | 'hardened' | 'causal-added' | 'causal-dropped';

export interface Difference {
  kind: DifferenceKind;
  /** 原文里那个词（没有则为 null） */
  source: string | null;
  /** 报告里那个词（没有则为 null） */
  claim: string | null;
  /** 给人看的一句话：只描述两边的字面差别，不判对错 */
  note: string;
}

export type ToneVerdict = 'consistent' | 'differs' | 'no-source' | 'same-text';

export interface ToneAudit {
  /** 原文那句（逐字） */
  sourceText: string | null;
  /** 原文那句从哪来：报告给的 quote / 自己从全文找的句子 / 找不到 */
  from: 'quote' | 'passage' | 'none';
  /** 报告那句（规范化陈述） */
  claimText: string;
  diffs: Difference[];
  verdict: ToneVerdict;
  /** 报告自己的判断（模型写的字段） */
  reported: boolean;
  /** 报告给的理由 */
  reportedNote: string;
  /** 总述一句话。verdict 为 differs 时点名几处；否则说明为什么没比 */
  note: string;
}

/**
 * 找句子用的停用字。
 *
 * 第一版按「共享字符数」找，结果任何两句话都相似——「完全无关的一段话」与
 * 「关于火星殖民的判断」共享「的」「一」，分数永远大于 0，于是「找不到原文那句」
 * 这条路径一次都走不到，`no-source` 变成了死代码（check:modal 抓到的）。
 * 停用字只用于**找句子**，不参与口气判断。
 */
const STOP = new Set('的了是在有和与就都而及个一'.split(''));

function significant(text: string): Set<string> {
  const out = new Set<string>();
  for (const ch of text) {
    if (STOP.has(ch)) continue;
    if (/[\u4e00-\u9fa5A-Za-z0-9]/.test(ch)) out.add(ch);
  }
  return out;
}

/**
 * 结论那句话的字有多少比例在那句原文里出现过。
 * 分母是**结论的字**，所以「短结论碰到长句子」不会虚高。
 * 阈值 0.5：一半以上的字都对不上，那句就不是它在原文里的出处。
 */
const MIN_OVERLAP = 0.5;

function overlapRatio(claim: string, sentence: string): number {
  const a = significant(claim);
  if (!a.size) return 0;
  const b = significant(sentence);
  let n = 0;
  for (const ch of a) if (b.has(ch)) n++;
  return n / a.size;
}

/**
 * 找结论对应的原文那句。
 * 报告给了 quote 就用 quote——它是逐字引用，比任何匹配都可靠。
 * 没给（隐含结论）时退回全文：取重合比例最高的那一句，并标明这是找来的，不是给的。
 */
export function sourceSentence(d: Pick<Diagnosis, 'passage' | 'conclusion'>): {
  text: string | null;
  from: 'quote' | 'passage' | 'none';
} {
  const q = d.conclusion.quote?.trim();
  if (q) return { text: q, from: 'quote' };
  const claim = d.conclusion.text ?? '';
  if (!claim.trim()) return { text: null, from: 'none' };
  const sentences = sentenceBounds(d.passage ?? '');
  let best: { text: string; score: number } | null = null;
  for (const s of sentences) {
    const score = overlapRatio(claim, s.text);
    if (!best || score > best.score) best = { text: s.text.trim(), score };
  }
  return best && best.score >= MIN_OVERLAP ? { text: best.text, from: 'passage' } : { text: null, from: 'none' };
}

/**
 * 核一遍。纯函数：同一份报告永远得到同一个结果。
 */
export function toneAudit(d: Pick<Diagnosis, 'passage' | 'conclusion'>): ToneAudit {
  const { text: src, from } = sourceSentence(d);
  const claim = (d.conclusion.text ?? '').trim();
  const reported = d.conclusion.modalOverreach === true;
  const reportedNote = (d.conclusion.modalNote ?? '').trim();

  const base: ToneAudit = {
    sourceText: src,
    from,
    claimText: claim,
    diffs: [],
    verdict: 'no-source',
    reported,
    reportedNote,
    note: '',
  };

  if (!src) {
    return { ...base, note: '报告没给结论的原文引文，本地也没在原文里找到对应的一句——这一栏比不了。' };
  }
  if (!claim) {
    return { ...base, note: '报告没写结论的规范化陈述——这一栏比不了。' };
  }
  if (src.replace(/\s+/g, '') === claim.replace(/\s+/g, '')) {
    return { ...base, verdict: 'same-text', note: '报告那句话与原文逐字相同，没有改写，也就没有口气可核。' };
  }

  const diffs: Difference[] = [];

  const srcRead = readAll(src);
  const claimRead = readAll(claim);

  // 1) 原文有软化词，报告里一个都没有
  if (srcRead.hedges.length && !claimRead.hedges.length) {
    diffs.push({
      kind: 'hedge-dropped',
      source: srcRead.hedges[0].word,
      claim: null,
      note: `原文用的是「${srcRead.hedges[0].word}」，报告那句里没有软化词。`,
    });
  }

  // 2) 报告有硬化词，原文里没有
  if (claimRead.hard.length && !srcRead.hard.length) {
    diffs.push({
      kind: 'hardened',
      source: null,
      claim: claimRead.hard[0].word,
      note: `报告那句里出现了「${claimRead.hard[0].word}」，原文那句里没有这个强度的词。`,
    });
  }

  // 3) 原文只写并存，报告写成因果
  if (srcRead.cooccur.length && claimRead.causal.length && !srcRead.causal.length) {
    diffs.push({
      kind: 'causal-added',
      source: srcRead.cooccur[0].word,
      claim: claimRead.causal[0].word,
      note: `原文说的是「${srcRead.cooccur[0].word}」，报告那句用「${claimRead.causal[0].word}」把它接成了因果。`,
    });
  }

  // 4) 原文是推论口气，报告写成了直接断言
  if (srcRead.causal.length && !claimRead.causal.length) {
    diffs.push({
      kind: 'causal-dropped',
      source: srcRead.causal[0].word,
      claim: null,
      note: `原文那句用「${srcRead.causal[0].word}」标记这是一步推论，报告把它写成了直接断言。`,
    });
  }

  if (!diffs.length) {
    return {
      ...base,
      verdict: 'consistent',
      note: '本地把两句话的字面读了一遍：软化词、硬化词、因果词都对得上，没找到口气上的差别。',
    };
  }
  return {
    ...base,
    diffs,
    verdict: 'differs',
    note: `本地在两句话的字面上读到 ${diffs.length} 处差别。两边原话都在上面，自己核。`,
  };
}

/**
 * 报告自评与本地复核摆在一起，四种组合各有说法。
 * 这一句必须出现在界面上——否则读者会以为两者之中有一个是错的，而这里只陈述两边各看到了什么。
 */
export function crossNote(a: ToneAudit): string {
  const reported = a.reported;
  const local = a.verdict === 'differs';
  if (a.verdict === 'no-source' || a.verdict === 'same-text') {
    return reported
      ? '报告说结论的口气越界了，本地这一栏没比成（见上），所以核不了这一条自评。'
      : '本地这一栏没比成（见上），报告也没说越界——两边都没有说法。';
  }
  if (reported && local)
    return '报告说越界，本地也在字面上读到了差别。两边未必指同一处——报告的理由与本地读到的词在上面各写各的，自己比。';
  if (reported && !local)
    return '报告说越界，本地在字面上没读到差别——本地只看字面，看不出来不等于没有。';
  if (!reported && local) return '本地在字面上读到差别，报告没说越界——两边的判断不一致，以原文为准。';
  return '报告没说越界，本地也没在字面上读到差别——两边一致。';
}

/** 词表导出给断言用：改表的人要知道哪些词在管这件事。 */
export const WORD_LISTS = { HEDGES, HARD, CAUSAL, COOCCUR } as const;
