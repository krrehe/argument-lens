/**
 * 立案：A 阶段那两个只有人答得了的问题。
 *
 * 流程文档（《论证分析全流程 v1.1》，v1.0 起未改）把「A 立案」放在所有判定之前，并且写死一条：
 * A 阶段任何一个环节没做完，不得进入 B。它的三个问题——谁说的、哪一版、
 * 原文还是转述——没有一个能从文本里算出来：文本不会告诉你它是初稿还是删改稿，
 * 也不会告诉你「某某认为」是作者的话还是记者的转述。
 *
 * 所以这一层不做判断，只做三件事：
 *
 *   1. 收（把界面上的几个字收成一个结构，去掉首尾空白，枚举值收敛到合法集）；
 *   2. 数（三问答了几问、缺哪一问）；
 *   3. 说（一句话说清这份报告是在什么前提下评的）。
 *
 * 它**绝不**替人默认。特别是 `objectKind`：准入那一步要的是一个人做出的决定，
 * 默认成「说理文本」的话，A2 就永远是「做过」，而实际上谁都没做——
 * 那是这一栏最省事、也最容易变成装饰的写法。
 *
 * 跑法：npm run check:flow 里前一半就是这一层。
 */
import type { Brief, BriefObject, BriefSource } from './types';

/** 一个字段最多收多少字。不是排版限制，是防「把整段话贴进『谁说的』」那种误用。 */
export const BRIEF_FIELD_MAX = 120;

export const BRIEF_SOURCES: { id: BriefSource; label: string; hint: string }[] = [
  { id: 'original', label: '原文', hint: '你手上就是作者写的那一份（或它的完整转载）' },
  { id: 'hearsay', label: '转述', hint: '媒体「某某认为」、别人引的一句话、二手总结' },
  { id: 'unknown', label: '不清楚', hint: '不确定来源 —— 按流程，这等于三问没答完' },
];

export const BRIEF_OBJECTS: {
  id: BriefObject;
  label: string;
  hint: string;
  /** 这一类对象按 §0.2 该怎么处置；null 表示就是全流程 */
  route: string | null;
}[] = [
  { id: 'argument', label: '说理', hint: '有主张、有理由，可以被要求「凭什么」', route: null },
  {
    id: 'expression',
    label: '情绪',
    hint: '在说感受，不在主张某件事',
    route: '按 §0.2，这一类不开庭、改走承接：它没有可判真假的主张，硬判等于给情绪打分',
  },
  {
    id: 'value',
    label: '价值宣示',
    hint: '「我讨厌这种人」这类：没有事实主张，只有态度',
    route: '按 §0.2，这一类只判证成强度，不判真假；把它当事实争议量，就是伪科学化',
  },
  {
    id: 'norm-doc',
    label: '规范/说明书',
    hint: '合同、条款、操作手册',
    route: '按 §0.2，这一类走要件分析，不走论证分析：它要问的是「有没有约定」，不是「站不站得住」',
  },
  { id: 'unknown', label: '还没定', hint: '没选 = 准入这一步没做', route: null },
];

const SOURCE_IDS = new Set(BRIEF_SOURCES.map((s) => s.id));
const OBJECT_IDS = new Set(BRIEF_OBJECTS.map((o) => o.id));

function text(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, BRIEF_FIELD_MAX);
}

/**
 * 把界面上那几个值收成一个 `Brief`，收不成就有话直说（返回 null）。
 *
 * 什么时候返回 null 而不是「一个空 Brief」：
 *
 *   - 传进来的根本不是对象（旧存档、坏 JSON、别的模块手滑）；
 *   - 四个字段全是空的 —— 那不是「立了案但没填」，是**没立案**。
 *     写一个空结构进报告，流程账会把它当成「做过这一步」，
 *     于是「缺 A1」这条最该被看见的话，被一段空字符串抹掉了。
 *
 * 枚举值不认识时收敛到 `unknown`，不抛错：报告是给人看的，为一个字段值炸掉整次分析
 * 才是真正的不划算。收敛之后 A1/A2 会如实显示「没答」，与用户真的没选是同一种下场——
 * 这正是对的，因为从流程上看它们没有区别。
 */
export function normalizeBrief(input: unknown): Brief | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  const speaker = text(o.speaker);
  const version = text(o.version);
  const source = (typeof o.source === 'string' && SOURCE_IDS.has(o.source as BriefSource)
    ? o.source
    : 'unknown') as BriefSource;
  const objectKind = (typeof o.objectKind === 'string' && OBJECT_IDS.has(o.objectKind as BriefObject)
    ? o.objectKind
    : 'unknown') as BriefObject;
  if (!speaker && !version && source === 'unknown' && objectKind === 'unknown') return null;
  return {
    speaker,
    version,
    source,
    objectKind,
    at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : Date.now(),
  };
}

export interface BriefAnswers {
  speaker: boolean;
  version: boolean;
  source: boolean;
}

/** 三问各答了没有。A1 的判据是「三问全部答清」，所以这里只数，不评分。 */
export function briefAnswered(b: Brief): BriefAnswers {
  return {
    speaker: b.speaker.length > 0,
    version: b.version.length > 0,
    /* 「不清楚」不算答完：文档要的是「原文还是转述」，而「不清楚」正是那一问的答案为空。 */
    source: b.source !== 'unknown',
  };
}

/** 缺哪几问，用文档里的说法。空数组 = 三问答清。 */
export function briefGaps(b: Brief): string[] {
  const a = briefAnswered(b);
  const out: string[] = [];
  if (!a.speaker) out.push('谁说的（实名、机构，或明写「匿名」）');
  if (!a.version) out.push('哪一版（初稿、修订，或「只有这一版」）');
  if (!a.source) out.push('原文还是转述');
  return out;
}

export function sourceLabel(s: BriefSource): string {
  return BRIEF_SOURCES.find((x) => x.id === s)?.label ?? '不清楚';
}

export function objectLabel(o: BriefObject): string {
  return BRIEF_OBJECTS.find((x) => x.id === o)?.label ?? '还没定';
}

/** 这一类对象按 §0.2 该怎么处置。说理文本返回 null（就是全流程）。 */
export function objectRoute(o: BriefObject): string | null {
  return BRIEF_OBJECTS.find((x) => x.id === o)?.route ?? null;
}

/**
 * 一句话：这份报告是在什么前提下评的。
 *
 * 写法上把「谁说的」放最前：它是三问里唯一决定「你评的是不是这个人的话」的那一问。
 */
export function briefLine(b: Brief): string {
  const who = b.speaker || '（没说谁）';
  const ver = b.version || '（没说哪一版）';
  return `${who}｜${ver}｜${sourceLabel(b.source)}｜${objectLabel(b.objectKind)}`;
}

/** 给界面用的一句话：三问缺几问，缺了会怎样。 */
export function briefNote(b: Brief): string {
  const gaps = briefGaps(b);
  if (gaps.length === 0) {
    return b.source === 'hearsay'
      ? '三问答清，但这是转述：按流程，结论只能标「基于转述的评估」，整体信任度降一档。'
      : '三问答清。按 A1 的判据，这一段可以开工。';
  }
  return `还缺 ${gaps.length} 问：${gaps.join(' / ')}。三问没答清时，报告的结论只能算「就文论文」。`;
}

/**
 * 两份立案是不是同一份：只比四问，不比 `at`。
 *
 * 时间戳每敲一个字都会变，比它等于永远「不一样」，那句话就会一直挂着——
 * 一句永远为真的提醒等于没有提醒。
 */
export function sameBrief(a: Brief, b: Brief): boolean {
  return (
    a.speaker === b.speaker &&
    a.version === b.version &&
    a.source === b.source &&
    a.objectKind === b.objectKind
  );
}

/**
 * 「输入区这四问，这份报告还不认」。
 *
 * 只有一种情况要说：**输入区现在有东西，而这份报告里没有它**（或记的是另一份）。
 * 反过来的情况（报告里有、输入区空着）不说——输入区管的是下一次，不是这一次；
 * 那种时候挂一句提醒，只会让人以为自己把报告改坏了。
 *
 * 为什么非要说：立案只在跑的那一刻进报告。填完不重跑，报告一个字都不会变，
 * 而人看到的是「我明明填了」——这是这一栏最容易变成假话的地方。
 */
export function briefPending(reportBrief: Brief | null | undefined, current: Brief | null): boolean {
  if (!current) return false;
  if (!reportBrief) return true;
  return !sameBrief(reportBrief, current);
}
