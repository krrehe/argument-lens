/**
 * 语境九格到底被哪些判断读走。
 *
 * 为什么要有这一层：上一轮给七格标了出处（known／inferred／guess），解决了
 * 「这一格是不是原文说的」。但它没回答下一个问题——**这一格错了，会错到哪儿去**。
 * 报告里语境一栏原来写着「后面所有判断都锚在这上面」，这句话一半是假的：
 *
 *   图尔敏：只看主张—理由—担保的骨架，七格一个都不读。
 *   PTA：只看阶、轴、陈述类型，七格一个都不读。
 *   名录对照：不做判定，只给名字，七格一个都不读。
 *
 * 三副透镜（六副里的一半）根本不读语境，而它们的结果页照样摆着这块「语境坐标」，
 * 标题上还写着「后面所有判断都锚在这上面」。这不是文案小毛病：读者会以为
 * 「对话类型判错了」这件事会影响图尔敏布局的结论，于是去质疑一个根本不存在的依赖。
 *
 * 另外三副确实读，而且读的是不同的格：
 *
 *   walton：对话类型（同一招式在谈判里合法、在说服里是谬误）+ 阶段（CQ 之前先辨阶段）。
 *   pragma：对话类型（这到底是不是在解决分歧——整副适用性的门槛）+ 阶段（违反要落到哪一阶段）
 *           + 对方立场（没有对方，靠「对手方」的规则无从违反）。
 *   ars：受众 + 受众类型（可接受性是对该受众可接受，类型决定门槛往哪边偏）。
 *
 * 每一条依赖都必须指得出出处，而且出处是能核的：要么是 `theory-base.ts` 里一条
 * 理论条目（id 形如 T4-02），要么是这副透镜 `procedure` 里的原话。
 * `check:context-use` 逐条核对这两件事——id 存在、条目确实管这副透镜、原文确实在。
 * 少了这道核对，这张表就会变成「我觉得它读了」，而那种表比没有更糟：
 * 它会让人以为依赖关系已经被核过。
 *
 * 这一层不改判定、不改提示词产物、不落盘。它只回答两件事：
 *   1. 这副透镜读哪几格（`CONTEXT_USE`）；
 *   2. 这几格在手上这份报告里站不站得住（`contextLoadOf`）。
 */
import { MODE_META } from './types';
import type { ContextField, ContextSource, Diagnosis, TheoryId } from './types';

/** 语境格的中文名。界面与命令行都从这里取，不在两处各写一遍。 */
export const CONTEXT_FIELD_LABEL: Record<ContextField, string> = {
  issue: '争议之点',
  speakerPosition: '说话者立场',
  opposingPosition: '对方立场',
  dialogueType: '对话类型',
  stage: '阶段',
  audience: '受众',
  audienceKind: '受众类型',
};

/** 受众类型的取值中文。这一格原来在报告里根本不显示，而它正是偏置可接受性的那一格。 */
export const AUDIENCE_KIND_LABEL: Record<string, string> = {
  general: '一般听众',
  specialist: '专业同行',
  adversarial: '对立听众',
  supportive: '支持听众',
  unknown: '判不出',
};

/**
 * 一条依赖的出处。两种，都是可核的：
 *   claim：theory-base 里的条目 id。检查会核三件事——条目存在、条目真的管这副透镜、
 *          条目正文（claim+decides）确实谈到这一格。谈到的判据是 `quote`：给了就逐字查，
 *          没给就查字段关键词。不给 quote 又不含关键词，这条依赖就不可核。
 *   procedure：这副透镜 procedure 里的原话。检查核这段字是否逐字出现。
 *
 * 不走「大意提到」：那种核不出来，等于没核。
 */
export type ContextUseEvidence =
  | { kind: 'claim'; id: string; quote?: string }
  | { kind: 'procedure'; text: string };

export interface ContextUse {
  field: ContextField;
  /** 这一格进了哪一步判断。一句话，具体到「哪条规则／哪个档位」。 */
  why: string;
  evidence: ContextUseEvidence;
}

/**
 * 六副透镜各自的依赖表。空数组是**有结论的**，不是没填：
 * 它说的是「这副透镜的判定一步都不读语境」，界面据此改口径，不摆一句假的锚点。
 */
export const CONTEXT_USE: Record<TheoryId, readonly ContextUse[]> = {
  walton: [
    {
      field: 'dialogueType',
      why: '同一招式在不同对话类型下结论不同，类型判错，合法性跟着错',
      evidence: { kind: 'claim', id: 'T4-02' },
    },
    {
      field: 'stage',
      why: '逐条问 CQ 之前要先辨对话类型与阶段',
      evidence: { kind: 'procedure', text: '辨对话类型与阶段' },
    },
  ],
  pragma: [
    {
      field: 'dialogueType',
      why: '这段话语是否以解决分歧为目标，是整副透镜的适用门槛',
      evidence: { kind: 'claim', id: 'T4-01', quote: '以解决分歧为目标' },
    },
    {
      field: 'stage',
      why: '每条违反都要落到某一阶段，阶段空着规则就落不下去',
      evidence: { kind: 'procedure', text: '定位阶段：冲突／开场／论证／结论' },
    },
    {
      field: 'opposingPosition',
      why: '没有可识别的对方，靠「对手方」才成立的规则无从违反',
      evidence: { kind: 'claim', id: 'T4-05' },
    },
  ],
  ars: [
    {
      field: 'audience',
      why: '可接受性是「对该受众可接受」，不是客观为真',
      evidence: { kind: 'claim', id: 'T4-03' },
    },
    {
      field: 'audienceKind',
      why: '受众类型决定可接受性的偏置方向：对立受众门槛天然更高',
      evidence: { kind: 'claim', id: 'T4-07' },
    },
  ],
  pta: [],
  toulmin: [],
  copi: [],
};

/** 不读语境的透镜，各自说明为什么。这句会直接显示在结果页上。 */
export const CONTEXT_UNUSED_WHY: Partial<Record<TheoryId, string>> = {
  pta: 'PTA 只看阶、轴、陈述类型三个结构特征，谁在什么场合说这段话，一步都不进判定。',
  toulmin: '图尔明布局只看主张—理由—担保这副骨架，语境七格一个都不进判定。',
  copi: '名录对照不做判定，只把这段话对上教材条目；语境不参与任何一步。',
};

/**
 * 一格语境的来路。`unmarked` 不是第四档，是「没有标注」——
 * 旧存档没有 grounding 这一层，分不出来路。把它混进三档里任何一档都是编。
 */
export type LoadSource = ContextSource | 'unmarked';

export interface ContextLoadItem {
  field: ContextField;
  label: string;
  /** 报告里写的值（枚举已转成中文）。空值时是空串。 */
  value: string;
  /** 原始取值，检查与调试用。 */
  raw: string;
  source: LoadSource;
  /** 模型说 known 却被本地降级——它自称引自原文，原文没这句。 */
  downgraded: boolean;
  /** 这一格判不出来（unknown 或空）。 */
  unset: boolean;
  /** 这格换成别的样子会怎样。guess 必写，inferred 在 2.7.0 起也要求写。 */
  ifChanged?: string;
  why: string;
  /**
   * 判定能不能站在这格上。
   *   weak：guess／降级过的 known／判不出来——这三类都不算「原文说的」。
   *   未标注的格也 weak，但只在整份报告都没有任何标注时才这样说（见 summary/caveat）。
   */
  weak: boolean;
}

export interface ContextLoad {
  /** 这副透镜读的格，按 CONTEXT_USE 的顺序。 */
  used: ContextLoadItem[];
  /** 不读语境时的原因；读语境时为 null。 */
  unusedWhy: string | null;
  /** 读的格里，能从原文指出的有几格。 */
  solid: number;
  /** 站不住的格（假定／降级／判不出／没标）。 */
  weak: ContextLoadItem[];
  /** 整份报告一格标注都没有（旧存档）。 */
  unmarkedAll: boolean;
  /** 结果页那一句：读哪几格、各是什么来路。 */
  summary: string;
  /**
   * 判定区那一句。没有站不住的格时为 null——地基稳就不必多说一句。
   * 不写「建议」，不替模型打包票，也不把「假定」说成「错误」。
   */
  caveat: string | null;
}

/** 对话类型的中文。报告页与回看台共用这一份。 */
export const DIALOGUE_TYPE_LABEL: Record<string, string> = {
  persuasion: '说服',
  inquiry: '探究',
  negotiation: '谈判',
  deliberation: '审议',
  'information-seeking': '求信息',
  eristic: '争胜',
  mixed: '混合',
  unknown: '判不出',
};

/** 阶段的中文。原先这三行写在 Diagnosis.tsx 里，报告页与回看台各一份。 */
export const STAGE_LABEL: Record<string, string> = {
  confrontation: '冲突阶段',
  opening: '开场阶段',
  argumentation: '论证阶段',
  concluding: '结论阶段',
  unknown: '阶段不明',
};

/** 取值 → 中文。枚举格的翻译在这里做，界面不重复一遍。 */
function displayValue(field: ContextField, raw: string): string {
  if (field === 'audienceKind') return AUDIENCE_KIND_LABEL[raw] ?? raw;
  if (field === 'dialogueType') return DIALOGUE_TYPE_LABEL[raw] ?? raw;
  if (field === 'stage') return STAGE_LABEL[raw] ?? raw;
  return raw;
}

function rawValueOf(d: Diagnosis, field: ContextField): string {
  const c = d.context as unknown as Record<string, unknown>;
  const v = c[field];
  if (v == null) return '';
  return String(v);
}

const ENUM_UNSET = new Set(['unknown', '']);

function isUnset(field: ContextField, raw: string): boolean {
  if (field === 'issue' || field === 'speakerPosition' || field === 'audience' || field === 'opposingPosition') {
    return raw.trim() === '';
  }
  return ENUM_UNSET.has(raw);
}

/**
 * 一份报告的语境载荷。
 *
 * 只读 `d.context`，不读模型别处的自由文字——依赖关系由 CONTEXT_USE 定，
 * 不由模型自述。让模型自己说「这条判定依赖对话类型」，它会把它写成一句漂亮话，
 * 而那句话既不可核也不可复算。
 */
export function contextLoadOf(d: Diagnosis): ContextLoad {
  const uses = CONTEXT_USE[d.theory] ?? [];
  const g = (d.context.grounding ?? {}) as Partial<
    Record<ContextField, { source: ContextSource; basis: string; ifChanged?: string; downgraded?: boolean }>
  >;

  const allMarked = Object.keys(g).length > 0;

  const used: ContextLoadItem[] = uses.map((u) => {
    const raw = rawValueOf(d, u.field);
    const gr = g[u.field];
    const source: LoadSource = gr?.source ?? 'unmarked';
    const unset = isUnset(u.field, raw);
    const downgraded = !!gr?.downgraded;
    return {
      field: u.field,
      label: CONTEXT_FIELD_LABEL[u.field],
      value: displayValue(u.field, raw) || '—',
      raw,
      source,
      downgraded,
      unset,
      ifChanged: gr?.ifChanged,
      why: u.why,
      weak: unset || downgraded || source === 'guess' || source === 'unmarked',
    };
  });

  const solid = used.filter((i) => !i.weak && i.source === 'known').length;
  const weak = used.filter((i) => i.weak);
  const unmarkedAll = used.length > 0 && used.every((i) => i.source === 'unmarked');

  const unusedWhy = uses.length === 0 ? (CONTEXT_UNUSED_WHY[d.theory] ?? '这副透镜的判定不读语境。') : null;

  const summary = unusedWhy
    ? unusedWhy
    : `读的是${used.map((i) => `「${i.label}」`).join('')}：${tallyText(used)}。`;

  return { used, unusedWhy, solid, weak, unmarkedAll, summary, caveat: caveatOf(d, used, weak, unmarkedAll) };
}

function tallyText(used: ContextLoadItem[]): string {
  const by = (pred: (i: ContextLoadItem) => boolean) => used.filter(pred).length;
  const parts: string[] = [];
  const known = by((i) => i.source === 'known' && !i.downgraded);
  const inferred = by((i) => i.source === 'inferred' || (i.source === 'known' && i.downgraded));
  const guess = by((i) => i.source === 'guess');
  const unmarked = by((i) => i.source === 'unmarked');
  const unset = by((i) => i.unset);
  if (known) parts.push(`${known} 格能从原文指出`);
  if (inferred) parts.push(`${inferred} 格是推的`);
  if (guess) parts.push(`${guess} 格是假定`);
  if (unmarked) parts.push(`${unmarked} 格没标出处`);
  if (unset) parts.push(`${unset} 格判不出来`);
  return parts.join('，') || '七格都没填';
}

function clauseOf(i: ContextLoadItem): string {
  if (i.unset) return `「${i.label}」判不出来`;
  if (i.downgraded) return `「${i.label}」标了原文却找不着`;
  if (i.source === 'guess') return `「${i.label}」是假定`;
  if (i.source === 'unmarked') return `「${i.label}」没标出处`;
  return `「${i.label}」只是推的`;
}

/**
 * 判定区那一句。
 *
 * 三种情形，口径不同，不许合并：
 *   1. 整份报告一格标注都没有（旧存档）：说「分不出来路」，不说「假定」——
 *      那是往旧档上补一个它没做过的承诺；
 *   2. 无档位的模式（重构／提问／查谬误）：说「这份分析」，不说「这条判定」，
 *      否则等于把「不判」说成判了；
 *   3. 有档位且确有站不住的格：说清是哪几格、换成别的样子会怎样。
 */
function caveatOf(
  d: Diagnosis,
  used: ContextLoadItem[],
  weak: ContextLoadItem[],
  unmarkedAll: boolean,
): string | null {
  if (used.length === 0) return null;
  if (weak.length === 0) return null;

  const givesVerdict = !!MODE_META[d.mode]?.givesVerdict && d.verdict.level !== 'undetermined';
  const subject = givesVerdict ? '这条判定' : '这份分析';

  if (unmarkedAll) {
    return `${subject}要读 ${used.length} 格语境（${used.map((i) => i.label).join('、')}），而这份存档一格出处都没标——分不出哪几格是原文说的。`;
  }

  const tail = givesVerdict ? '这几格换成别的样子，档位可能跟着变。' : '这几格换成别的样子，上面的结论可能跟着变。';
  return `${subject}要读 ${used.length} 格语境，其中 ${weak.length} 格站不住：${weak.map(clauseOf).join('、')}。${tail}`;
}

/** 语境整块是否值得渲染。读的格全都能从原文指出、且不读语境的透镜也要给理由，所以它几乎总是 true。 */
export function contextLoadNeedsUi(load: ContextLoad): boolean {
  return load.used.length === 0 || load.weak.length > 0 || load.solid > 0;
}

/** 来源徽章的中文。界面与检查共用，三档不各写一套。 */
export const SOURCE_LABEL: Record<LoadSource, string> = {
  known: '原文',
  inferred: '推出',
  guess: '假定',
  unmarked: '没标',
};
