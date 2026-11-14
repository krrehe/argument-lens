/**
 * 长文覆盖账：把「这份报告碰到了原文的哪几句」按逐字可复算的方式摆出来。
 *
 * 起因是 2026-11-10 一份 6268 字的真模型报告：原文 167 句、31 个自然段，
 * 报告的条目只落在 8 句上，25 段一句都没被碰到；而报告结构（4 前提 / 3 检查）
 * 与 126 字的短文本几乎一样。模型在 scope.partialNote 里定性写了一句
 * 「大量篇幅不评」，界面确实显示了那句——但没有任何一处把量摆出来。
 * 「失败必须可见」在长文本上缺的就是这一格。
 *
 * 三套口径全部复用，不另写一份：
 *   1. 句子 = `rereadOf(d).sentences`（它内部就是 `sentenceBounds`，与「回到原文重读」同源）；
 *   2. 「有没有条目落上去」= 同一份 sentences 的 `quiet`（false 即被钉住）；
 *   3. 段落 = `segmentPassage(passage)` 的候选段，与「切给我看」里的第 N 段逐字是同一段。
 *
 * 三条边界：
 *   - **只在长文本上出现**。短文本的引文覆盖本来就高，摆一条 100% 的账是空面板；
 *     阈值直接取切分条的 `SEGMENT_HINT_CHARS`，不另写一个 800。
 *   - **不判「漏了」**。没被落上的句子可能是转述、铺垫、例子，本来就不该被分析；
 *     本地不知道，也不猜。只数位置，不写判断、不劝、不打分、不排优先级。
 *   - **不落盘、不改判定、不调模型**。它读的是已经写好的报告与原文。
 */
import type { Diagnosis } from '@shared/types';
import { rereadOf } from '@shared/reread';
import { segmentPassage, SEGMENT_HINT_CHARS, type Segment } from '@shared/segment';

/** 段落预览取开头几个字，逐字截取；空白压成空格与切分条的做法一致。 */
export const COVERAGE_PREVIEW_CHARS = 40;

export const COVERAGE_LABEL = {
  title: '长文覆盖账',
  toggle: '逐段看',
  empty: '每个切出来的段里都至少有一句被报告条目落上。',
  colHead: '一句都没被落上的段',
  note:
    '这里只数位置：句子边界与「有没有条目落上去」都用「回到原文重读」那一套，段就是「切给我看」给出的那些段。' +
    '没被落上的句子不等于分析漏了——长文里本就有转述、铺垫、例子；该不该分析，由你判断。' +
    '段落只显示开头几个字，逐字取自原文。本地不改判定、不落盘。',
} as const;

export interface CoverageSegment {
  index: number;
  /** 该段字数，取自切分条 */
  chars: number;
  /** 落在这一段区间里的句子数 */
  sentences: number;
  /** 其中被报告条目钉住的句子数 */
  pinned: number;
  /** 段开头若干字，逐字截取（空白归一） */
  preview: string;
  /** preview 是否被截断 */
  previewTruncated: boolean;
}

export interface CoverageView {
  /** 是否够长到值得摆这条账。界面据此决定完全不渲染。 */
  long: boolean;
  chars: number;
  sentences: number;
  pinned: number;
  quiet: number;
  segmentCount: number;
  /** 一句都没被钉住的段数 */
  untouched: number;
  segments: CoverageSegment[];
  headline: string;
}

/**
 * 把句子归到段：按句子起点落在哪个段的原文区间里。
 * 段是 trim 后的区间，空行与首尾空白不属于任何段——这类句子归到它前面最近的段，
 * 开头的空白则归到第一段，保证每句恰好算进一段（总数守恒由断言守着）。
 */
function segmentIndexOf(start: number, segs: { start: number; end: number }[]): number {
  let fallback = 0;
  for (let i = 0; i < segs.length; i += 1) {
    if (start >= segs[i].start && start < segs[i].end) return i;
    if (start >= segs[i].start) fallback = i;
  }
  return fallback;
}

export function coverageOf(d: Diagnosis): CoverageView {
  const passage = d.passage ?? '';
  const sentences = rereadOf(d).sentences;
  const segs: Segment[] = segmentPassage(passage);
  /*
   * 全空白的原文切不出段，而 sentenceBounds 仍会算一句（它不丢原文字符）。
   * 不补这一段，下面的「每句恰好归一段」就守不住，而界面上看不出任何异常。
   */
  if (!segs.length && sentences.length) {
    segs.push({
      index: 0, start: 0, end: passage.length, text: passage,
      chars: passage.length, kind: 'plain', cue: null, why: '', cutBasis: 'whole',
    });
  }

  const counts = segs.map(() => ({ sentences: 0, pinned: 0 }));
  for (const s of sentences) {
    /*
     * 不能拿 s.start 判归属：sentenceBounds 让每句的 start 接上一句 end，
     * 于是段间那两个换行落在**下一句**的开头，s.start 还停在前一段的末尾。
     * 用它归段会把「第 2 段第一句」算进第 1 段，「哪段没被碰到」整体偏一格。
     * 剥掉前导空白后的 coreStart 才落在句子真正所属的那一段里。
     */
    const lead = s.text.length - s.text.trimStart().length;
    const i = segmentIndexOf(s.start + lead, segs);
    if (!counts[i]) {
      // 原文非空却切不出段（理论上不会发生）：不静默丢句子，挂到第 0 段。
      if (!counts.length) counts.push({ sentences: 0, pinned: 0 });
      counts[0].sentences += 1;
      if (!s.quiet) counts[0].pinned += 1;
      continue;
    }
    counts[i].sentences += 1;
    if (!s.quiet) counts[i].pinned += 1;
  }

  const segments: CoverageSegment[] = segs.map((s, i) => {
    const flat = s.text.replace(/\s+/g, ' ').trim();
    return {
      index: s.index,
      chars: s.chars,
      sentences: counts[i].sentences,
      pinned: counts[i].pinned,
      preview: flat.slice(0, COVERAGE_PREVIEW_CHARS),
      previewTruncated: flat.length > COVERAGE_PREVIEW_CHARS,
    };
  });

  const pinned = sentences.filter((s) => !s.quiet).length;
  const untouched = segments.filter((s) => s.pinned === 0 && s.sentences > 0).length;
  const long = passage.trim().length >= SEGMENT_HINT_CHARS;

  return {
    long,
    chars: passage.length,
    sentences: sentences.length,
    pinned,
    quiet: sentences.length - pinned,
    segmentCount: segments.length,
    untouched,
    segments,
    headline:
      `原文 ${sentences.length} 句，报告条目落在 ${pinned} 句上；` +
      `按切分条切成 ${segments.length} 段，其中 ${untouched} 段一句都没被落上。`,
  };
}
