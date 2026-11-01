/**
 * 长文本的论证切分。
 *
 * 这不是「理解」，是「切开」。区别必须说清，因为两者的可信度完全不同：
 *
 *   理解：知道第一段在论证什么、第二段在反驳谁。
 *   切开：只看空行、句号，以及「所以」「另外」这些连接词落在哪。
 *
 * 为什么仍然要做：这个工具的判定单元是一段论证，而人贴进来的往往是一整篇社论。
 * 整篇送进去只有两种下场——模型诚实地判「这不是单一论证」于是 checks 被清空，
 * 或者模型硬压成一条主论证于是报告过度简化。两种都是失效，而失效发生在
 * 第一次使用最自然的那次操作上。
 *
 * 因此这里给出的是**候选**，不是结论。界面必须让用户看见「我是这么切的」，
 * 并且允许他不接受——切分权留在用户手里，与这个工具不替人做判断的立场一致。
 *
 * 三条自我约束：
 *   1. 不调模型。切分不该花钱，也不该等 20 秒。
 *   2. 每个切点都要能说出依据（见 CutBasis）。说不出依据的切分要标出来，
 *      因为「按长度均分」和「按结论指示词切」的可信度差着一整个量级。
 *   3. 切错了必须看得出来。所以每段都带 kind / why，而不是一个干净的分段列表——
 *      后者会显得比它实际更懂。
 */

export type SegmentKind =
  /** 有结论指示词，像一条完整推理 */
  | 'argument'
  /** 没有指示词，按段落切开，可能仍是论证 */
  | 'plain'
  /** 问句、口号、过渡句，本身不是论证 */
  | 'aside';

/**
 * 这一段是怎么切出来的。排序即可信度：
 * blank 最可信（作者自己划的），length 最不可信（纯粹按字数）。
 */
export type CutBasis =
  /** 空行。作者划的段界 */
  | 'blank'
  /** 单换行，且上一行以句末标点结尾 */
  | 'wrap'
  /** 结论指示词之后 */
  | 'cue'
  /** 长度到了，没有语义依据 */
  | 'length'
  /** 原文只有一段，没切 */
  | 'whole';

export interface Segment {
  index: number;
  /** 在原文中的 UTF-16 区间。切分后要能还原位置。 */
  start: number;
  end: number;
  text: string;
  chars: number;
  kind: SegmentKind;
  /** 命中的结论指示词，没有则 null */
  cue: string | null;
  /** 一句人话：为什么这一段单独成段 */
  why: string;
  cutBasis: CutBasis;
}

interface RawBlock {
  start: number;
  end: number;
  text: string;
  cutBasis: CutBasis;
}

/** 结论指示词。长的排前面，避免「由此可见」只匹配到「可见」。 */
const CONCLUSION_CUES = [
  '由此可见',
  '由此可知',
  '正因为如此',
  '正因如此',
  '这说明',
  '足以说明',
  '足以证明',
  '所以说',
  '概言之',
  '总而言之',
  '综上',
  '总之',
  '因此',
  '所以',
  '可见',
  '故而',
  '从而',
].sort((a, b) => b.length - a.length);

/** 这些词出现，通常意味着「另一条论证开始了」，而不是继续前一条 */
const NEW_TOPIC_CUES = ['另外', '此外', '再说', '其次', '再者', '另一方面', '还有一点', '顺便', '顺带'];

/** 超过这个长度就提示切分。800 字已足够容纳三四条独立论证。 */
export const SEGMENT_HINT_CHARS = 800;

/** 单块超过这个长度，一定要再切。下面两种手段依次尝试。 */
const LONG_BLOCK = 700;

/** 累积到这个长度、且当前句带结论指示词，就在这里断——一段刚好是「理由…所以结论」。 */
const MIN_BEFORE_CUE_CUT = 260;

/** 不含句末标点的行尾，说明这一行是被硬折开的半句话 */
const HARD_WRAP_TAIL = /[。！？；：…」』）】"'!?;]$/;

function findCue(text: string): string | null {
  for (const cue of CONCLUSION_CUES) {
    if (text.includes(cue)) return cue;
  }
  return null;
}

function hasCue(text: string): boolean {
  return findCue(text) !== null;
}

/** 按正则切开并保留偏移。String.split 会丢偏移，而偏移是后面还原位置的唯一依据。 */
function splitByRegex(src: string, re: RegExp, basis: CutBasis): RawBlock[] {
  const out: RawBlock[] = [];
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = r.exec(src))) {
    if (m.index > last) out.push({ start: last, end: m.index, text: src.slice(last, m.index), cutBasis: basis });
    last = m.index + m[0].length;
    if (m[0].length === 0) r.lastIndex += 1;
  }
  if (last < src.length) out.push({ start: last, end: src.length, text: src.slice(last), cutBasis: basis });
  return out;
}

function splitBlocks(src: string): RawBlock[] {
  if (/\n\s*\n/.test(src)) {
    // 有空行：空行是作者自己划的段界，最可信，直接用
    return splitByRegex(src, /\n\s*\n\s*/g, 'blank');
  }
  if (src.includes('\n')) {
    /*
     * 只有单换行。这里有个真实的坑：中文长文经常每 40 字硬折一行，
     * 那种换行不是段界。判据是看上一行结尾有没有句末标点——
     * 没有，就说明这一行是被折开的半句话，不该按它切。
     */
    const lines = splitByRegex(src, /\n+/g, 'wrap');
    const out: RawBlock[] = [];
    let cur: RawBlock | null = null;
    for (const ln of lines) {
      if (!cur) {
        cur = { ...ln };
      } else {
        const softWrap = !HARD_WRAP_TAIL.test(cur.text.trimEnd());
        if (softWrap) {
          cur.end = ln.end;
          cur.text = `${cur.text}\n${ln.text}`;
        } else {
          out.push(cur);
          cur = { ...ln };
        }
      }
    }
    if (cur) out.push(cur);
    return out;
  }
  return [{ start: 0, end: src.length, text: src, cutBasis: 'whole' }];
}

/**
 * 超长块按句子切开。
 *
 * 断点优先落在带结论指示词的句子之后——那样一段刚好是「理由…所以结论」，
 * 而不是在推理中间拦腰截断。找不到指示词时，退到按长度切，并把 cutBasis
 * 标成 length，让界面能说「这一段是硬切的，请核对」。
 */
function splitLong(b: RawBlock): RawBlock[] {
  const sentences = splitByRegex(b.text, /(?<=[。！？；])|(?<=\n)/g, 'cue').filter((s) => s.text.trim());
  const out: RawBlock[] = [];
  let cur: RawBlock | null = null;
  let curBasis: CutBasis = b.cutBasis;

  const flush = (basis: CutBasis) => {
    if (!cur) return;
    out.push({ ...cur, cutBasis: basis });
    cur = null;
  };

  for (const s of sentences) {
    if (!cur) {
      cur = { start: b.start + s.start, end: b.start + s.end, text: s.text, cutBasis: b.cutBasis };
      curBasis = b.cutBasis;
    } else {
      cur.end = b.start + s.end;
      cur.text += s.text;
    }
    if (cur.text.length >= MIN_BEFORE_CUE_CUT && hasCue(s.text)) {
      flush('cue');
      continue;
    }
    if (cur.text.length >= LONG_BLOCK) {
      // 到这儿还没等到指示词，只能硬切。依据要如实标出来。
      const before = curBasis;
      flush(before === 'whole' || before === 'blank' || before === 'wrap' ? 'length' : before);
    }
  }
  flush(curBasis);
  return out;
}

/**
 * 过短的块并入前一块。一行的「他说：」不该单独成为一段候选。
 *
 * 但**带结论指示词的短段不合并**：一个 22 字的「很多家长也支持，可见这是对的」
 * 本身就是一条完整推理，合并它等于把两条论证缝成一条。
 */
function mergeShort(blocks: RawBlock[]): RawBlock[] {
  const out: RawBlock[] = [];
  for (const b of blocks) {
    const t = b.text.trim();
    const prev = out[out.length - 1];
    const tooShort = t.length < 24 && !hasCue(t);
    if (prev && tooShort) {
      prev.end = b.end;
      prev.text = `${prev.text.trimEnd()}\n${b.text}`;
      continue;
    }
    out.push({ ...b });
  }
  return out;
}

function classify(text: string): { kind: SegmentKind; cue: string | null; why: string } {
  const cue = findCue(text);
  const t = text.trim();
  const newTopic = NEW_TOPIC_CUES.find((c) => t.startsWith(c));

  if (cue) {
    return {
      kind: 'argument',
      cue,
      why: newTopic
        ? `以「${newTopic}」开头另起一条，里面有「${cue}」，是一条独立的推理`
        : `含「${cue}」，前面铺理由、后面下结论，自成一条推理`,
    };
  }
  // 阈值压到 28：一个 30 字的「王校长说……学生就该早起读书」是论证，
  // 拿 60 字当门槛会把它划进「不像论证」，那是在替用户预先判定。
  if (/[？?]\s*$/.test(t) || t.length < 28) {
    return {
      kind: 'aside',
      cue: null,
      why: '像一个问句、口号或过渡句，本身没有给出理由，单独分析多半会得到空报告',
    };
  }
  return {
    kind: 'plain',
    cue: null,
    why: newTopic
      ? `以「${newTopic}」开头，像另起一条，但没有结论指示词——可能是论证，也可能不是`
      : '按段落切开，没有结论指示词。它可能是论证，也可能只是一段陈述',
  };
}

/**
 * 主入口。返回的每一段都可直接送去分析。
 * 只有一段时返回长度 1 的数组——调用方按需决定要不要显示切分条。
 */
export function segmentPassage(text: string): Segment[] {
  const src = text.replace(/\r\n/g, '\n');
  if (!src.trim()) return [];

  const blocks = mergeShort(
    splitBlocks(src).flatMap((b) => (b.text.trim().length > LONG_BLOCK ? splitLong(b) : [b]))
  );

  return blocks
    .filter((b) => b.text.trim())
    .map((b, i) => {
      const trimmed = b.text.trim();
      const { kind, cue, why } = classify(trimmed);
      // 去掉首尾空白后的实际区间：送进分析的是 trimmed，偏移要跟着走
      const lead = b.text.length - b.text.trimStart().length;
      const start = b.start + lead;
      return {
        index: i,
        start,
        end: start + trimmed.length,
        text: trimmed,
        chars: trimmed.length,
        kind,
        cue,
        why,
        cutBasis: b.cutBasis,
      };
    });
}

/** 值不值得提示切分。不是「必须切」，是「你可以切」。 */
export function worthSegmenting(text: string): boolean {
  if (text.trim().length < SEGMENT_HINT_CHARS) return false;
  return segmentPassage(text).filter((s) => s.kind !== 'aside').length >= 2;
}

/**
 * 给切分条用的一句总结。带数字，因为「有几段」本身就是决定要不要切的依据。
 * 按字数硬切的数量必须单独报——不报，用户会以为每个切点都有依据。
 */
export function describeSegments(segs: Segment[]): string {
  const arg = segs.filter((s) => s.kind === 'argument').length;
  const aside = segs.filter((s) => s.kind === 'aside').length;
  const hard = segs.filter((s) => s.cutBasis === 'length').length;
  const parts = [segs.length > 1 ? `切出 ${segs.length} 段` : '只有一段'];
  if (arg) parts.push(`${arg} 段自带结论`);
  if (aside) parts.push(`${aside} 段不像论证`);
  if (hard) parts.push(`${hard} 处按字数硬切，没有语义依据`);
  return parts.join('，');
}

/** 这个切点有没有语义依据。界面据此决定要不要给警示色。 */
export function cutIsGrounded(basis: CutBasis): boolean {
  return basis === 'blank' || basis === 'wrap' || basis === 'cue' || basis === 'whole';
}
