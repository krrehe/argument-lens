import { sentenceBounds } from './reread';

/**
 * 自己列成立条件：条件由人写、依据由人点回原文，本地只做可复算的对位。
 *
 * 这一屏是三个「重读」里第一个**完全不显示报告文字**的屏。前两屏把报告里的条目
 * 搬回原文旁边，读者先看见的仍然是软件写下的话；这一屏刻意不放报告，否则人又会
 * 先去读报告，再拿自己的话去迁就它。
 *
 * 为什么值得做：知识库《哲学，有用嘛？》里那一招是「要让这句话成立，得先满足什么」
 * ——把看着天经地义的结论拆成几条能逐条去问的条件。力量来自**条件是自己列的**。
 * 一旦软件替人列出、或替人判断「这条满没满足」，它就退回成又一份生成好的东西。
 *
 * 所以这一层的边界比前两屏更硬：
 *   1. 不 import Diagnosis，不读报告的任何字段，屏幕上不出现报告里的一个字；
 *   2. 原文是原样切片，逐句拼回来 === passage（含空行与结尾空白）；
 *   3. 输出的字符串叶子只允许来自原文、用户写的条件，或固定枚举码；
 *   4. 只数事实（写了几条、标了几条、几条挂到了原文），**不合成结论、不给分、不判成立**；
 *   5. 不落盘。这一屏是一次阅读动作，关掉就没了；界面上要写明，要留就自己复制走。
 *
 * 坐标系沿用 Span 的 UTF-16 下标，切句复用 reread 的 sentenceBounds——
 * 三屏共用一套切法，并排时才不会在标点上错位。
 */

/** 三态都由用户点。'yes' / 'no' 是**人的标记**，不是软件的判定。 */
export type ConditionMark = 'unknown' | 'yes' | 'no';

/**
 * 例外必须说出来，不许静默丢掉。
 * 空行本身不算错（两行空输入框是「还没开始填」，不是「填错了」）；
 * 只有「点了句子却还没写条件」才需要点名，否则那一句会被算成「问过了」。
 */
export type ConditionProblem = 'blank' | 'sentence-out-of-range';

export interface ConditionInput {
  id: string;
  /** 用户写的条件，原样保留，不 trim、不改写。 */
  text: string;
  mark: ConditionMark;
  /** 用户点选的原文句子下标；null = 还没点。 */
  sentence: number | null;
}

export interface ConditionRow {
  id: string;
  text: string;
  mark: ConditionMark;
  sentence: number | null;
  /** 那一句的原样切片。没点、或点到的句子不存在时为 null。 */
  quote: string | null;
  quoteStart: number;
  quoteEnd: number;
  problem: ConditionProblem | null;
  /** 这一行写下了字（纯空白不算）。 */
  written: boolean;
}

export interface ConditionView {
  passage: string;
  sentences: { index: number; start: number; end: number; text: string }[];
  rows: ConditionRow[];
  /** 被至少一条写好的条件点到的句子下标，去重、升序。同一句可以挂好几条。 */
  asked: number[];
  /** 一条写好的条件都没点到的句子下标。 */
  unasked: number[];
  /** 只数事实。没有 score / verdict / level，界面也不许拿它们合成一句话。 */
  counts: { written: number; marked: number; linked: number; askedSentences: number };
}

/** 显示用的固定文案。放在内核里，好让断言逐条扫「有没有替用户下判断」。 */
export const CONDITION_MARK_LABEL: Record<ConditionMark, string> = {
  unknown: '还没想好',
  yes: '原文给了',
  no: '原文没给',
};

export const CONDITION_PROBLEM_LABEL: Record<ConditionProblem, string> = {
  blank: '挂了句子，但条件还没写',
  'sentence-out-of-range': '点的那一句在原文里不存在',
};

function normalizeMark(m: unknown): ConditionMark {
  return m === 'yes' || m === 'no' ? m : 'unknown';
}

export function conditionsOf(passage: string, inputs: ConditionInput[]): ConditionView {
  const text = passage ?? '';
  const sentences = sentenceBounds(text).map((s) => ({ ...s }));

  const rows: ConditionRow[] = inputs.map((raw) => {
    const rowText = raw.text ?? '';
    const written = rowText.trim().length > 0;
    const sentence = typeof raw.sentence === 'number' ? raw.sentence : null;
    const base: ConditionRow = {
      id: raw.id,
      text: rowText,
      mark: normalizeMark(raw.mark),
      sentence,
      quote: null,
      quoteStart: -1,
      quoteEnd: -1,
      problem: null,
      written,
    };
    if (sentence === null) return base;
    /* 越界、小数、NaN 都明说：静默丢掉会让人以为这一条已经挂上了。 */
    const hit = Number.isInteger(sentence) ? sentences[sentence] : undefined;
    if (!hit) return { ...base, problem: 'sentence-out-of-range' };
    return {
      ...base,
      quote: hit.text,
      quoteStart: hit.start,
      quoteEnd: hit.end,
      /* 点了句子却没写出条件：这一句不能算「被问到」。 */
      problem: written ? null : 'blank',
    };
  });

  /* 只有「写了字 + 真的挂上一句」才算问到。空行挂的句子不计入，否则统计会虚高。 */
  const asked = [
    ...new Set(rows.filter((r) => r.written && r.quote !== null).map((r) => r.sentence as number)),
  ].sort((a, b) => a - b);
  const askedSet = new Set(asked);
  const unasked = sentences.map((s) => s.index).filter((i) => !askedSet.has(i));

  return {
    passage: text,
    sentences,
    rows,
    asked,
    unasked,
    counts: {
      written: rows.filter((r) => r.written).length,
      marked: rows.filter((r) => r.written && r.mark !== 'unknown').length,
      linked: rows.filter((r) => r.written && r.quote !== null).length,
      askedSentences: asked.length,
    },
  };
}

/**
 * 带走用的纯文本。
 *
 * 不写盘、不调 IPC、不弹保存框：一个只读 textarea 让用户自己 Ctrl+C。
 * 写盘就得处理「磁盘满 / 目录不可写」，而那一条失败必须可见（P0-4）；
 * 这一屏没有非做不可的写，就不开这条通道。
 *
 * 文本里每一句原文、每一条条件都逐字来自输入；固定标签只是骨架。
 */
export function conditionsText(view: ConditionView): string {
  const lines: string[] = ['我列的成立条件', '', '原文：'];
  for (const s of view.sentences) lines.push(`第 ${s.index + 1} 句：${s.text}`);
  lines.push('', '我的条件：');
  for (const [i, r] of view.rows.filter((x) => x.written).entries()) {
    lines.push(`${i + 1}. [${CONDITION_MARK_LABEL[r.mark]}] ${r.text}`);
    if (r.quote !== null && r.sentence !== null) {
      lines.push(`   原文第 ${r.sentence + 1} 句：${r.quote}`);
    }
  }
  lines.push('');
  lines.push(
    `还没被任何条件问到的句子：${view.unasked.length ? view.unasked.map((i) => `第 ${i + 1} 句`).join('、') : '没有'}`,
  );
  return lines.join('\n');
}
