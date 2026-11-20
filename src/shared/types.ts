/**
 * 论证镜 · 核心数据契约（v2：透镜无关）
 *
 * 结构分三层：
 *
 *   1. 共享内核 —— 与理论无关的部分。语境坐标、论证重构、认识论标签。
 *      换任何理论，这一段都照做，因为任何理论都要求先把话说清。
 *
 *   2. checks —— 统一成「一组检查项 + 每项的回答」。
 *      这是本应用的架构主张：六副透镜看起来互不相容，
 *      但落到可执行层面，全都能归约成检查表。
 *      差值在「问什么、问多细、答完怎么算」，不在结构。
 *
 *   3. lens —— 每副透镜自己的东西。
 *      型式法的族与型式、PTA 的三特征、图尔敏的六要素、名录的候选。
 *      这一层是不可通约的，所以必须分区存放，不许压成一个字段。
 *
 * 一条铁律：本文件没有「严重程度」「得分」「错误」。
 * 只有「位置」「检查项」「击败类型」「限定语」「可撤回条件」。
 */

import type { TheoryId } from './theories';
import type { Ledger } from './ledger';

export type { TheoryId };

/* ─────────── 基础标量 ─────────── */

/** 认识论标签：判断的根据类型，不是判断的强度 */
export type EpistemicTag =
  | 'known' // 已知：有文献／文本依据
  | 'computed' // 计算：由确定性算法得出
  | 'inferred' // 推论：由机制推出，无直接证据
  | 'general' // 通用：领域常识
  | 'framework' // 框架：符号体系内部自洽，不等于现实
  | 'guess'; // 猜测：没有根据

export type EpistemicTags = readonly EpistemicTag[];

/** 置信度。框架判断与猜测最高只能到 low。 */
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'very-low' | 'undetermined';

export type ConfidenceLevels = readonly ConfidenceLevel[];

/** 原文定位。定位失败必须留痕，不允许静默。 */
export interface Span {
  start: number; // UTF-16 下标
  end: number;
  quote: string;
  quality: 'exact' | 'normalized' | 'fuzzy' | 'failed';
}

/* ─────────── 第一层：语境坐标 ─────────── */

/** 沃尔顿八种对话类型。同一句话在不同对话类型里合法性不同。 */
export type DialogueType =
  | 'persuasion'
  | 'inquiry'
  | 'negotiation'
  | 'deliberation'
  | 'information-seeking'
  | 'eristic'
  | 'mixed'
  | 'unknown';

/** 批判性讨论四阶段。语用辩证透镜靠它定位。 */
export type DiscussionStage = 'confrontation' | 'opening' | 'argumentation' | 'concluding' | 'unknown';

/**
 * 语境每一格的出处。
 *
 * 为什么需要这一层：报告其余部分都能回原文——结论和前提有 quote + span，
 * 名称候选有 condition，连置信度都有 tag。只有语境这几格是裸断言：
 * 「听众是关注升学率的家长与校内决策者」这句话，在原文那四十一个字里
 * 找不到任何支持，却被当成事实写在最上游——ARS 的可接受性判定从听众出发，
 * walton 的批判性问题排布从对话类型出发。上游猜错，下面一律跟着偏，
 * 而报告里没有一处承认这是猜的。
 *
 * 实测：同一段文本分析 98 次，听众出现三种写法，对话类型出现两种，
 * 讨论阶段一直只有一种。稳定不等于正确，只等于它对这个猜测很有信心。
 *
 * 三档直接沿用既有的 EpistemicTag，不另造一套词：
 *   known    = 原文里能指出来的字（basis 必须是连续原文片段）
 *   inferred = 由原文特征推出（basis 写推的是哪个特征）
 *   guess    = 原文没有，为把分析做下去而假定（必须写 ifChanged）
 */
export type ContextSource = 'known' | 'inferred' | 'guess';

export interface ContextGrounding {
  source: ContextSource;
  /** known 时必须是原文里原样找得到的连续片段；其余两档写凭什么。 */
  basis: string;
  /** 仅 guess 需要：这一格换成别的样子，判定会往哪边变。 */
  ifChanged?: string;
  /**
   * 模型说 known，但依据在原文里找不到，被本地降级成 inferred 的痕迹。
   * 留着它，界面才能照实说「它自称引自原文，其实原文没这句」——
   * 静默降级会让人以为模型一直很老实。
   */
  downgraded?: boolean;
}

/**
 * 需要标出处的语境格。`contextGaps` 不在其中——它写的就是「不知道什么」，
 * 再给它标一个出处只会得到「这条猜测本身是猜的」这种废话。
 */
export type ContextField =
  | 'issue'
  | 'speakerPosition'
  | 'opposingPosition'
  | 'dialogueType'
  | 'stage'
  | 'audience'
  | 'audienceKind';

export const CONTEXT_FIELDS: readonly ContextField[] = [
  'issue',
  'speakerPosition',
  'opposingPosition',
  'dialogueType',
  'stage',
  'audience',
  'audienceKind',
];

export interface Context {
  /** 争议之点：到底在争什么。这是所有后续判断的锚点。 */
  issue: string;
  speakerPosition: string;
  /** 可识别的对方立场。没有的话，语用辩证透镜无法适用。 */
  opposingPosition: string | null;
  dialogueType: DialogueType;
  dialogueTypeBasis: string;
  stage: DiscussionStage;
  /** 受众。ARS 透镜里它参与可接受性判定，不是描述性字段。 */
  audience: string;
  /** 受众类型，决定可接受性判断往哪个方向偏 */
  audienceKind: 'general' | 'specialist' | 'adversarial' | 'supportive' | 'unknown';
  contextGaps: string[];
  /**
   * 每一格打哪来的。用 Partial 是有意的：v2.3.0 之前存的报告没有这一层，
   * 读旧档时它是 `{}`，界面照实说「这份存档没标出处」，不伪造也不崩。
   */
  grounding: Partial<Record<ContextField, ContextGrounding>>;
}

/* ─────────── 第二层：重构 ─────────── */

export type ClaimRole = 'premise' | 'intermediate' | 'conclusion';

export interface Acceptability {
  status: 'acceptable' | 'questionable' | 'unacceptable' | 'unknown';
  reason: string;
  /**
   * 对该受众是否可接受。与 status 可以不同，且必须允许不同：
   * 一个客观有据的前提可能对某类受众不可接受（如对不承认统计学的人）。
   * 可接受性不是真值。
   */
  forAudience: string;
  tag: EpistemicTag;
  confidence: ConfidenceLevel;
}

export interface Claim {
  id: string;
  role: ClaimRole;
  /** 规范化陈述：把口语整理成可检验的命题 */
  text: string;
  /**
   * 这条主张在支撑谁（id 列表）。结构图靠它画线。
   * 为空时按最朴素的重构处理：直接支撑结论 C。
   * 它存在的意义是让「思维导图」画的是真的结构，而不是猜出来的结构。
   */
  supports: string[];
  /** 原文逐字引用。显式主张必填。 */
  quote: string | null;
  span: Span | null;
  implicit: boolean;
  /**
   * 隐含前提必填，格式固定：
   * 「若不假定 X，则从 {前提} 推不出 {结论}」
   * 写不出来就不该把它列为隐含前提。
   */
  implicitBasis: string | null;
  /** 举证责任归属。批评 I（前提可疑）在提议者，批评 II（另有反证）在回应者。 */
  burden: 'proponent' | 'respondent' | 'both' | 'unclear';
  acceptability: Acceptability;
}

export interface Conclusion extends Claim {
  /** 结论的模态强度是否过头：把「很可能」说成「必然」是越界 */
  modalOverreach: boolean;
  modalNote: string;
}

/* ─────────── 第三层：检查项（透镜的统一形态） ─────────── */

export type CheckSystem = 'walton-cq' | 'pragma-rule' | 'ars' | 'pta' | 'toulmin' | 'catalog';

/**
 * answer 的语义按透镜不同，但结构只有这四个：
 * - walton-cq：CQ 回答了 → passed；答否 → violated
 * - pragma-rule：规则未被违反 → passed；被违反 → violated
 * - ars：该标准满足 → passed
 * - toulmin：该要素齐备 → passed
 * - pta / catalog：一般不产生检查项
 */
export type CheckAnswer = 'passed' | 'violated' | 'unanswered' | 'not-applicable';

export interface CheckItem {
  /** 该透镜内的编号：CQ2 / R4 / ARS-P1-relevance / T-warrant */
  id: string;
  system: CheckSystem;
  /** 显示名，如「第 4 条 相干规则」「CQ2 领域相关性」 */
  label: string;
  question: string;
  /** 元问题：答否则后续全部免除 */
  meta: boolean;
  answer: CheckAnswer;
  /** 判断依据。给 passed 或 violated 都必须有理由，不许空着。 */
  basis: string;
  /** 这条守着论证的哪一处 */
  guards: string;
  /** 违反后落到名录里的哪一条（可空：相当多违反根本不该被命名） */
  landsOn: string | null;
}

/* ─────────── 范围门：每副透镜都得能说自己不适用 ─────────── */

export interface Scope {
  /** 这副透镜在本文本上是否适用 */
  applicable: boolean;
  /** 不适用的理由。applicable=true 时写「为什么适用」。 */
  reason: string;
  /**
   * 不适用的确切位置：比如语用辩证透镜遇到广告，
   * 不是「文本不好」，而是「说话人不以解决分歧为目标」。这一栏要说清是哪一条前提不成立。
   */
  outOfScopeAt: string | null;
  /** 部分适用时：哪一部分可用，哪一部分不可用 */
  partialNote: string | null;
}

/* ─────────── 击败与结论 ─────────── */

/**
 * 削弱性击败：切断前提与结论的联结，不否定结论。
 * 反驳性击败：直接给出结论为假的理由。
 * 两者不可混。把削弱写成「该论证不成立」是越界。
 */
export type DefeatKind = 'undermining' | 'rebutting' | 'none';

export interface Defeat {
  kind: DefeatKind;
  /** 倒在哪条检查项上 */
  checkId: string | null;
  /** 切断的是哪一步 */
  cuts: string;
  explanation: string;
  tag: EpistemicTag;
  confidence: ConfidenceLevel;
}

/** 归一化后的四档。原生刻度另存，不覆盖。 */
export type VerdictLevel = 'withstands' | 'weakened' | 'fails' | 'undetermined';

/* ─────────── 体系档位 D0–D5（来源：D-01 分档 v2.1） ─────────── */

/** 六档。互斥等级，不是六类文体。判据与顺序见 @shared/grading。 */
export type Grade = 'D0' | 'D1' | 'D2' | 'D3' | 'D4' | 'D5';

/** D5 三道闸门的记录。任一为空即「门槛未记录」，不得算 D5。 */
export interface GradeD5 {
  /** 后果闸门：剥夺追问／伪造证据状态／隐瞒有利反证，指出是哪一种、在哪 */
  consequence: string;
  /** 协同闸门：至少两个手法共同造成，每个单独不足 */
  synergy: string;
  /** 协议闸门：当前对话协议下这确属不该发生 */
  protocol: string;
  /** 反事实移除测试逐项记录：删去某手法后后果是否仍在 */
  removed: string[];
}

/** 一份判档记录。字段与 D-01 4.8 的七项对应（置信度另立字段）。 */
export interface GradeRecord {
  level: Grade;
  /** 触发条款编号，如 "4.4" */
  clause: string;
  /** 缺陷位置：P2／A1／CQ4。D2 及以上必填。 */
  at: string[];
  /** 必要证据 */
  evidence: string;
  /** 共享处置或可执行加固动作 */
  fix: string;
  /** 降级条件：若 X 成立，本判改为 Y。写不出视为本判尚未完成。 */
  downgrade: string;
  /** 仅 D5 有 */
  d5: GradeD5 | null;
}

export interface Verdict {
  /** 本透镜的评级刻度名 */
  scale: string;
  /** 原生取值，用该理论自己的话说 */
  scaleValue: string;
  /** 归一化档位。归一化是有损的，界面必须同时显示原生刻度。 */
  level: VerdictLevel;
  statement: string;
  qualification: string;
  /** 被否证的是论证还是结论。绝大多数情况只能否证前者。 */
  whatIsRefuted: 'argument-only' | 'conclusion' | 'nothing';
  /**
   * 体系档位 D0–D5 与它的记录（知识库「论证分析流程」D-01 v2.1）。
   *
   * 为什么另立一栏而不是把 level 换成六档：level 是四档粗桶（颜色、筛选、
   * 回看台都靠它），六档是体系档位。粗桶是六档的投影，投影写在一处
   * （shared/grading 的 GRADE_BUCKET），界面不再各算一遍。
   *
   * null 有三种情况，界面必须分开说：不给档位的模式、透镜不适用、
   * 以及 2.8.0 之前的旧存档。前两种是正常状态，第三种是「没这个字段」——
   * 不补一个假的 D 档上去，那比空白更误导。
   */
  grade?: GradeRecord | null;
}

/**
 * 评估置信度。三分离的中间那本账：档位评论证质量，它评「这次分析可靠吗」。
 *
 * 为什么不能并进档位：取材不详、版本冲突时该降的是它（D-01 二节）。
 * 把它折进档位，等于拿「没看清」当「论证很差」——同一个数字，两种意思。
 */
export interface ReportConfidence {
  level: ConfidenceLevel;
  why: string;
}

/* ─────────── 修辞审计（D-03） ─────────── */

/** 三诉求的功能位置。记位置，不记词频；不换算分数（D-03 4.2）。 */
export type RhetoricFunction = 'primary' | 'secondary' | 'none';

/** 框架四功能（Entman 1993）：问题界定、归因、道德评价、对策建议。 */
export type FrameHit = 'problem' | 'cause' | 'moral' | 'remedy';

/** 程度夸大三级：与前提承载力相符 / 高一级 / 高两级及以上（D-03 4.4）。 */
export type DegreeLevel = 'match' | 'mild' | 'heavy';

/** 四步测试的结论。untested 表示没跑测试——那是没做完，不是「没问题」。 */
export type SubstituteVerdict = 'substitute' | 'accompany' | 'untested';

/** 定损：替代造成了哪类后果。只写文本可观察的后果，不写心理判断。 */
export type HarmKind = 'fabricated-support' | 'concealed-counter' | 'closed-inquiry';

/** 被替代的理由类型：证据、推论桥、例外说明（D-03 4.6）。 */
export type ReplacedReason = 'evidence' | 'bridge' | 'exception';

/** 被替代成分的类型。故事单列：它既不是 êthos 也不是 pathos。 */
export type SubstituteKind = 'ethos' | 'pathos' | 'story' | 'frame' | 'degree' | 'relay';

/** 传播条件三格：材料可核验程度、纠错入口、转发链位置（D-03 4.5）。 */
export type VerifiableLevel = 'yes' | 'partial' | 'no';
export type CorrectionChannel = 'kept' | 'closed' | 'unclear';

/**
 * 审计表的一行（D-03 4.8 的八列）。
 *
 * 八列是：句位、三诉求功能、框架命中项、程度等级、传播条件三格、
 * 替代测试结论、后果类别、移交或计次说明。这里按八列一一对应，
 * 不为「好看」合并——合并之后第二位分析者就没法只凭句位重跑四步测试。
 */
export interface RhetoricRow {
  /** 句位编号：报告里真实存在的那一句（S1…Sn 或 P1／C） */
  at: string;
  ethos: RhetoricFunction;
  pathos: RhetoricFunction;
  logos: RhetoricFunction;
  /** 框架四功能命中项；空数组表示这一行不涉及框架 */
  frame: FrameHit[];
  degree: DegreeLevel;
  verifiable: VerifiableLevel;
  corrections: CorrectionChannel;
  /** 转发链位置：写依据句位；没有就写「未发现」。不许凭平台印象填 */
  relay: string;
  test: SubstituteVerdict;
  /** 仅 test='substitute' 时非空 */
  harm: HarmKind[];
  /** 移交（给 D-01）或计次说明 */
  note: string;
}

/** 替代链：审计的核心交付物。没有替代链的审计表视为未完成（D-03 4.6）。 */
export interface SubstituteChain {
  kind: SubstituteKind;
  /** 成分所在的句位 */
  at: string;
  /** 被它顶掉的理由类型 */
  replaced: ReplacedReason;
  harm: HarmKind;
  /** 移交位置：写「移交 D-01」或「只记缺陷位置」 */
  handoff: string;
}

export interface RhetoricAudit {
  rows: RhetoricRow[];
  chains: SubstituteChain[];
  /** 与 C-01 结论强度超载重复的处数：同一缺陷只计一次，这里只记账不重复算 */
  overlaps: number;
}


/* ─────────── 修补 ─────────── */

export interface Repair {
  missingPremise: string | null;
  /** 换一副透镜会看到什么。这是透镜切换的实质内容，不是装饰。 */
  alternativeReading: string | null;
  answerable: string[];
  burdenStatus: string;
  repairedForm: string | null;
}

/* ─────────── 命名候选 ─────────── */

/**
 * 谬误名是末端注释，不是核心输出。
 * 每条必须同时带三样东西才允许显示：
 *   condition（使它成为该谬误而非别种的条件）
 *   whenLegitimate（什么情况下其实合法）
 *   riskOfError（这条判断最可能错在哪）
 * 缺任何一样，前端不渲染。
 */
export interface LabelCandidate {
  id: string;
  name: string;
  nameEn: string;
  condition: string;
  whenLegitimate: string;
  riskOfError: string;
  landsOnCheck: string | null;
  tradition: string;
  tag: EpistemicTag;
  confidence: ConfidenceLevel;
  /**
   * 这个名字指的是原文哪一句。
   *
   * 原先没有这一栏，因为名字只当末端注释，注释不必指出位置。查谬误模式把它变成了
   * 主输出，于是缺的这一栏立刻变成要害：用户拿到「这是事后归因」，第一步要问的就是
   * 「我哪句话事后归因了」——答不上来，这条名字对他没有任何用处，只有「你被贴了标签」。
   *
   * 后缀 ? 是为了让 86 份旧存档照旧能读：那时没这一栏，读出来是 undefined，
   * 界面按「未标位置」显示，不回填假引文。新报告在查谬误模式下缺这一栏则会被
   * G11 直接丢掉——旧报告是历史，新报告是承诺，两者不能用一个宽严标准。
   */
  quote?: string | null;
  span?: Span | null;
}

/**
 * 「这里合法」这一栏。
 * 清单法最深的缺陷：四个名字里有一个其实是对方做得对的地方时，
 * 你不改判，因为清单没有「这里合法」这一栏。本应用必须有。
 */
export interface LegitimateMove {
  targetId: string;
  quote: string;
  what: string;
  why: string;
  tag: EpistemicTag;
  confidence: ConfidenceLevel;
}

/* ─────────── 反驳 ─────────── */

export type RefutationStrategy =
  | 'premise-false'
  | 'premise-unsupported'
  | 'missing-premise'
  | 'counterexample'
  | 'distinguo'
  | 'alternative-explanation'
  | 'scheme-mismatch'
  | 'burden-shift'
  /** 只适用于语用辩证：指出程序性规则被违反 */
  | 'procedure-violation';

export interface Refutation {
  id: string;
  targetId: string;
  checkId: string | null;
  strategy: RefutationStrategy;
  claim: string;
  /** 可直接使用的话术，≤120 字 */
  script: string;
  /** 对方最可能的反击。不可省略：没有 steelman 的反驳只是吵架。 */
  steelman: string;
  reply: string;
  evidenceNeeded: string[];
  burdenAfter: 'proponent' | 'respondent';
  tag: EpistemicTag;
  confidence: ConfidenceLevel;
}

/* ─────────── 各透镜专属负载 ─────────── */

export type SchemeFamily = 'pragmatic' | 'causal' | 'source' | 'comparison' | 'mixed' | 'none';

export interface WaltonLens {
  kind: 'walton';
  family: SchemeFamily;
  familyBasis: string;
  schemeId: string;
  schemeName: string;
  skeleton: string;
  /** 族若认错，更可能是哪个。族误认是日常批评最常见的失误。 */
  alternativeFamily: SchemeFamily | null;
  alternativeNote: string;
}

export interface PragmaLens {
  kind: 'pragma';
  /** 说话人是否以解决分歧为目标。这条为假，整副透镜失效。 */
  aimedAtResolution: boolean;
  aimedBasis: string;
  stageBasis: string;
  /** 谁妨碍了分歧解决：提议方／回应方／双方／无法判断 */
  blockedBy: 'proponent' | 'respondent' | 'both' | 'unclear';
}

export interface ArsLens {
  kind: 'ars';
  /** 论证负担的标准：决定「充分」的门槛在哪 */
  burdenStandard: string;
  /** 充分性为什么成立或不成立 */
  sufficiencyNote: string;
  /** 缺口在哪一类位置 */
  gapAt: 'premise' | 'link' | 'missing-premise' | 'none';
}

export type PtaOrder = 'first' | 'second' | 'undetermined';
export type PtaAxis = 'predicate' | 'subject' | 'undetermined';
export type PtaStatementType = 'fact' | 'value' | 'policy' | 'undetermined';

export interface PtaLens {
  kind: 'pta';
  order: PtaOrder;
  axis: PtaAxis;
  premiseType: PtaStatementType;
  conclusionType: PtaStatementType;
  /** 三特征相乘后的型，定位不出写 null，但三特征仍要分开给 */
  ptaType: string | null;
  ptaName: string | null;
  /** 对应沃尔顿型式，可空 */
  waltonId: string | null;
  featureNotes: { order: string; axis: string; statementType: string };
}

export interface ToulminLens {
  kind: 'toulmin';
  grounds: string[];
  /** 担保：凭什么从理由走到主张 */
  warrant: string | null;
  /** 担保是原文说了，还是我们补的。补的必须标 false。 */
  warrantStated: boolean;
  warrantType: 'generalization' | 'causal' | 'definitional' | 'authority' | 'analogy' | 'value' | 'none';
  backing: string | null;
  qualifier: string | null;
  rebuttals: string[];
  /** 跳跃发生在哪两步之间 */
  gapBetween: string;
}

export interface CatalogLens {
  kind: 'copi';
  /** 候选条目，最多三条。这是该透镜的全部输出。 */
  candidates: LabelCandidate[];
  /** 名录法在此处漏掉了什么 */
  whatItMisses: string;
}

export type LensDetail = WaltonLens | PragmaLens | ArsLens | PtaLens | ToulminLens | CatalogLens;

/* ─────────── 自检 ─────────── */

/**
 * EPI 七项量表（来自《评估的僭越》第 4 节）。
 * 产品必须对自己的输出执行同一套标准。
 */
export interface EPIScore {
  P1_source: 0 | 1 | 2;
  P2_context: 0 | 1 | 2;
  P3_position: 0 | 1 | 2;
  P4_withdrawal: 0 | 1 | 2;
  P5_selfApply: 0 | 1 | 2;
  P6_openness: 0 | 1 | 2;
  P7_steelman: 0 | 1 | 2;
  total: number;
  /** 单项否决：P3=0 且 P4=0 即为标签化裁决 */
  vetoed: boolean;
  reading: 'legitimate' | 'overreach' | 'labelling';
  notes: string[];
}

export interface SelfCheck {
  epi: EPIScore;
  ruleAudit: string[];
  unknowns: string[];
  opennessNote: string;
  /** 可推翻条件：什么情况下这份分析应被撤回 */
  withdrawIf: string[];
  /**
   * 换透镜会怎样。必填。
   * 不填这一栏，用户就以为眼前这份分析是唯一的答案。
   */
  underOtherLens: string;
}

/* ─────────── 总和 ─────────── */

/**
 * 五种问法，同一套结构。
 *
 * 分成三类，这条分类是后来才长出来的，但它比「五个模式」更能说明问题：
 *
 *   【判定类】diagnose / redteam —— 会给 verdict 档位
 *     diagnose    这段话站得住吗。给位置、给合法的部分、给修补。
 *     redteam     对手会从哪儿打。只给攻击路线，按杀伤力排序。
 *
 *   【命名类】fallacy —— 不给档位，但给名字
 *     fallacy     这里面有没有教材上叫得出名的毛病。只给位置 + 名字 + 代价，不判整体。
 *
 *   【描述类】reconstruct / interrogate —— 不给档位，不给名字
 *     reconstruct 这段话的结构是什么。只画图，不评价。
 *     interrogate 我该问他什么。只给问题，不下结论。
 *
 * 描述类为什么不判定：一旦先决定「这段话坏」，重构就会把最强读法悄悄换成最弱读法；
 * 提问也同理，判过之后的问题全是诱导性的。这两件事不是理论顾虑，是实测（E）。
 *
 * 命名类为什么不判定而给名字：这是被问得最多的一句（「这段有没有逻辑谬误」），
 * 也是最容易答坏的一句。答坏的唯一方式是凑名字——「这是滑坡」「这是诉诸权威」
 * 听起来专业，用户既不能拿它反驳，也不知道自己有没有冤枉人。
 * 所以这个模式保留名字，但把代价顶到最前面：每条名字必须指得出原文哪一句、
 * 必须说清什么时候其实合法、最可能错在哪、挂在哪一条检查项上；而且**不给整体档位**——
 * 指出一处推理不成立，不等于结论为假（削弱 ≠ 反驳，B）。判整体是诊断模式的事。
 * 「一个名字都没找到」因此是这个模式的正常结果，不是失败。
 *
 * 为什么不是第七副透镜：透镜决定「问什么问题」，模式决定「替谁问、判不判、给不给名字」。
 * 型式库、CQ、十规则在五种模式下是同一套，混进去会破坏六副透镜的不可通约性。
 *
 * 顺序即界面按钮顺序，按「评价性递减」排：诊断（判整体）→ 红队（判可攻击面）
 * → 查谬误（只命名，不判整体）→ 重构（只画结构）→ 提问（只出问句）。
 * 这个顺序不是随便排的：相邻两个模式之间只差一件事，用户来回切的时候
 * 能看出「换掉的是哪一层」，而不是五把互不相干的工具。
 */
export type AnalysisMode = 'diagnose' | 'redteam' | 'fallacy' | 'reconstruct' | 'interrogate';

/** 模式的顺序即界面上按钮的顺序。改这里，界面跟着变，不用改两处。 */
export const ANALYSIS_MODES: readonly AnalysisMode[] = [
  'diagnose',
  'redteam',
  'fallacy',
  'reconstruct',
  'interrogate',
] as const;

export interface ModeMeta {
  /** 按钮上的字 */
  label: string;
  /** 一句话说明这个模式问的是什么 */
  hint: string;
  /** 主按钮上的字 */
  action: string;
  /** 进度条上「范围」阶段的措辞 */
  stageScope: string;
  /** 进度条上「判定」阶段的措辞 */
  stageVerdict: string;
  /** 这个模式给不给判定档位。false 表示运行时会把 level 强制成 undetermined。 */
  givesVerdict: boolean;
  /**
   * 这个模式允不允许给出谬误名。
   *
   * 与 givesVerdict 是两件事，必须分开：查谬误模式**给名字但不给档位**，
   * 重构与提问两样都不给。原先只有 givesVerdict 一个开关，于是「不许命名」
   * 被写成了「不许判定」的附庸——加第五个模式时，那行 `givesVerdict ? labels : []`
   * 会把查谬误模式的主输出整个清空，而报告看起来一切正常。
   *
   * 一个开关管两件事，就会在只需要改一件的时候改错另一件。
   */
  allowsLabels: boolean;
  /**
   * 这个模式的报告里有没有「反驳」这一栏。
   *
   * 它原来只写在渲染层的 `SEC.showRef` 里，于是有两个地方不知道它：全流程账的
   * 「反方最强一击」那一行照样给一个「看这一节」的按钮，点下去什么都没有——
   * 跳转失败最像「软件卡了一下」，人不会想到是那一栏本来就不存在。
   * 所以把它提到这里：一处定义，渲染层与账本读同一个。
   */
  showsRefute: boolean;
  /** 报告顶部横幅的说明；null 表示不显示横幅。 */
  banner: string | null;
}

export const MODE_META: Record<AnalysisMode, ModeMeta> = {
  diagnose: {
    label: '诊断',
    hint: '判断这段话站不站得住。',
    action: '分析',
    stageScope: '定位语境',
    stageVerdict: '判定击败类型与结论档位',
    givesVerdict: true,
    allowsLabels: true,
    showsRefute: true,
    banner: null,
  },
  redteam: {
    label: '红队',
    hint: '同一套型式与问题，换个方向问：他会怎么打你。',
    action: '找攻击点',
    stageScope: '找可攻击的位置',
    stageVerdict: '按杀伤力排序',
    givesVerdict: true,
    allowsLabels: true,
    showsRefute: true,
    banner:
      '红队模式。同一套型式库、同一套关键问题，问的方向反过来：不评价这段话好不好，只找对手最容易打穿的位置。',
  },
  fallacy: {
    label: '查谬误',
    hint: '把可疑的地方对上教材里的名字——每个名字都要指得出原文哪一句，并说清它什么时候其实合法。',
    action: '逐个比对',
    stageScope: '按清单逐条比对',
    stageVerdict: '收口：每条名字都得有位置',
    givesVerdict: false,
    allowsLabels: true,
    showsRefute: false,
    banner:
      '查谬误模式。这一份不判这段话站不站得住——那是诊断模式的事。这里只做一件事：把可疑的位置对上教材里的名字，每条都要指得出原文哪一句、什么情况下其实合法、最可能错在哪。所以「一个都没找到」是正常结果，不是没干活；而「有名字」也不等于「他的结论是错的」。',
  },
  reconstruct: {
    label: '重构',
    hint: '先别判。把这段话拆成结构图，看清它靠什么撑着。',
    action: '画结构',
    stageScope: '拆结构',
    stageVerdict: '收口：检查 supports 闭合',
    givesVerdict: false,
    allowsLabels: false,
    showsRefute: false,
    banner:
      '重构模式。只画结构，不给判定——档位一律是「未定」，这是设计不是省略。因为一旦先判了它坏，重构就会把最强的读法悄悄换成最弱的读法。',
  },
  interrogate: {
    label: '提问',
    hint: '不替你下结论，只给你一串可以直接问出口的问题。',
    action: '准备问题',
    stageScope: '找可以问的角度',
    stageVerdict: '按「答不上来的概率 × 答上来的收益」排序',
    givesVerdict: false,
    allowsLabels: false,
    showsRefute: true,
    banner:
      '提问模式。只给问题，不给判定——档位一律是「未定」。判过之后再问，问出来的都是诱导句；先问，才知道对方手里到底有没有东西。',
  },
};

/**
 * 归一化模式。
 *
 * 为什么要有这个函数，而不是在各处写 `mode === 'redteam' ? 'redteam' : 'diagnose'`：
 * 那种写法在只有两个模式时是对的，加到四个模式后，它会对不认识的模式
 * **静默返回 diagnose**——界面照常出报告，报告顶上写着「诊断」，
 * 而用户以为自己在重构。这种错不会报错，只会让模式这件事白做。
 */
export function normalizeMode(v: unknown): AnalysisMode {
  return typeof v === 'string' && (ANALYSIS_MODES as readonly string[]).includes(v)
    ? (v as AnalysisMode)
    : 'diagnose';
}

export function isAnalysisMode(v: unknown): v is AnalysisMode {
  return typeof v === 'string' && (ANALYSIS_MODES as readonly string[]).includes(v);
}

export interface Diagnosis {
  version: 2;
  /**
   * 报告 id。存档、异议、修订对照三件事都靠它关联。
   * 没有 id 的报告是一张读一次就作废的纸。
   */
  id: string;
  /**
   * 这一份是从哪一份修补来的。null 表示原创。
   * 有它才能回答「改完到底好没好」，那是这个工具唯一能给出的闭环。
   */
  parentId: string | null;
  mode: AnalysisMode;
  /** 本次分析用的是哪副透镜 */
  theory: TheoryId;
  createdAt: number;
  passage: string;

  context: Context;
  /** 透镜适用范围自评。applicable=false 时，checks 必须为空。 */
  scope: Scope;

  conclusion: Conclusion;
  premises: Claim[];
  intermediate: Claim[];

  /** 统一检查表。六副透镜的输出在结构上完全一致。 */
  checks: CheckItem[];

  /** 透镜专属负载 */
  lens: LensDetail;

  defeat: Defeat;
  verdict: Verdict;
  /**
   * 评估置信度。与档位并列，不得互相折算。
   * 旧存档没有这一栏，按「没记」处理，不回填假值。
   */
  confidence?: ReportConfidence;
  /**
   * 修辞审计（知识库「论证分析流程」D-03 v2.1）。
   *
   * 为什么单独一层而不是塞进 verdict：D-03 明写「只查替代，不查有无」，
   * 而且审计结果不改档位、不改命题状态。它是一张可复核的表，不是第二份判定。
   * 旧存档没有这一栏（2.9.0 之前），按「没做审计」处理，不补一张假表。
   */
  rhetoric?: RhetoricAudit | null;
  /**
   * 命题账（知识库「论证分析流程」D-02 v2.1）。
   *
   * 三栏的状态值是模型按 D-02 记的；本地只核记录齐不齐、有没有串账
   * （规范栏写真假、账里出现 D0–D5），不改任何一个状态值。
   * 与档位、置信度、修辞审计四层并列：档位评推理，置信度评这次分析，
   * 修辞审计查替代，命题账记「这条断言按什么标准、处于什么状态」。
   * 旧存档没有这一栏（2.10.0 之前），按「没有记账」处理，不补假值。
   */
  ledger?: Ledger | null;
  repair: Repair;

  /** 命名候选（名录透镜下是主输出，其他透镜下是末端注释，可空） */
  labels: LabelCandidate[];
  legitimateMoves: LegitimateMove[];
  refutations: Refutation[];

  selfCheck: SelfCheck;
  diagnostics: Diagnostic[];

  /**
   * 产出这份报告时用的提示词版本与指纹。
   *
   * 没有它，「这份报告和三个月前那一份能不能对照」就无从回答——
   * 提示词改过之后，两次分析的判定口径可能已经不同，
   * 而界面上两份报告长得一模一样，用户会以为是同一次尺子量的。
   * 旧存档没有这个字段（当时还没有版本化），按「未知版本」处理，不回填假值。
   */
  prompt?: { version: string; fingerprint: string };

  /**
   * 这份报告是「谁」跑出来的：模型名、供应商主机、实际执行的温度。
   *
   * 为什么存这个：同题复跑第一次跑出真数据时，v2.0.0 有一组 8 份报告相差 279 个字段——
   * 而那批存档里没有模型名，也没有温度。于是「模型每次说得不一样」与「当时换了模型或设置」
   * 在这份数据里永远分不开：**差异能被看见，却不能被解释**。
   * 界面上那句话（「存档没记模型名和温度」）当时是对的，但它本该是一个临时状态，不是长期结论。
   *
   * 三条纪律，与用量账本一致：
   *   - 存 host 不存 baseUrl：这份报告可能被导出，不存路径、不存 Key。
   *   - 存**执行时生效的温度**（已被模式上限裁过的那个），不是设置页里填的那个：
   *     真正影响输出的只有前者，存后者会让一份按 0.2 跑出来的报告自称按 0.7 跑的。
   *   - 三项齐全才写。半条记录（有模型名没温度）比没有更误导：读的人会以为温度也是同一个。
   *
   * 旧存档没有这一栏，按「没记」处理，**不回填假值**——补出来的模型名会让一份跑在旧模型上的
   * 报告自称跑在新模型上，比空白更糟。
   *
   * 它也不等于「同一个版本」：供应商什么时候换了权重，这份存档不知道。
   */
  engine?: {
    model: string;
    /** 供应商主机名，不含协议、路径与 Key。 */
    host: string;
    /** 实际执行的温度。 */
    temperature: number;
  };

  /**
   * 模型返回的原文。
   *
   * 为什么存这个：报告是「解析 + 十道裁决」之后的产物，而那条链路会把模型的原始
   * 说法改掉（改编号、合并中间结论、清占位引文、把等级打回去）。存了结果、没存输入，
   * 就永远无法回答一个最要紧的问题——报告变了，是我改坏了，还是模型这次说的不一样？
   * 两个变量同时动，就不是实验。
   *
   * 有这个字段之后，改完代码可以把存档里的原文重新跑一遍解析与裁决，
   * 与存档逐字段比对：差异要么是这次有意改的，要么是新发现的 bug。零成本、几秒钟。
   * 在这之前，唯一的验证方式是重跑一次六分钟、十七万 token 的评测——
   * 而那次评测的模型输出又变了，于是依然分不清。
   *
   * 只存最后一次调用的原文：前面那些是 JSON 格式损坏的重试，`attempts` 记着次数，
   * 它们不影响这份报告的内容，只在「为什么多花了钱」时才需要。
   *
   * 体积约 8 KB/份（现有报告 12 KB）。不新增隐私暴露面——`passage` 早就存了原文全文。
   */
  raw?: {
    text: string;
    /** 一共调用了几次；>1 说明前面有过格式损坏的重试 */
    attempts: number;
  };

  /**
   * 立案（流程文档 A1 取材 / A2 准入）。
   *
   * 为什么这一段必须由人填、也必须随报告存下来：
   * 它是整条流程里唯一**软件无从算起**的一段——「谁说的、哪一版、原文还是转述」
   * 三个问题都不在文本里，而在文本之外。缺了它，后面 B–E 走得再齐，
   * 按流程也只能算「就文论文」：评的是转述、评的是某一版、甚至评的是记者的理解。
   *
   * 存进报告而不是留在界面里，是因为报告会被导出、会被几个月后的人再打开。
   * 一份无法回答「这段话是谁说的」的判决，过三个月连作者自己都读不懂它当时在评什么。
   *
   * 它不参与模型调用（提示词一个字没动），只由主进程在解析完成之后贴上去；
   * 也就是说：**填错它不会污染任何判定，只会让报告对「评的是谁」这件事说错话**。
   * 旧存档没有这一栏，按「没立案」处理，不回填。
   */
  brief?: Brief;
  /**
   * v1.1 第 4 章的分歧账：判定坐标四元组、收束模式、E4 登记册。
   * 同 `brief`：人填、软件只保管，贴在解析与裁决之后，不改报告一个字。
   * 旧存档没有这一栏，按「没登记」处理，不回填、不推断。
   */
  divergence?: Divergence;
}

/* ─────────── 立案（A 阶段，人填，软件只保管） ─────────── */

/** 这段文字是不是原文。`unknown` 是合法答案，而且是最常见的那个。 */
export type BriefSource = 'original' | 'hearsay' | 'unknown';

/**
 * 这段话在做什么（流程文档 §0.2 四类对象路由）。
 *
 * `unknown` 故意留着一个不预设的初值：准入那一步要的是**一个决定**，
 * 而不是软件的默认值。默认成「说理文本」的话，A2 就永远是「做过」，
 * 而实际上谁都没做——那是这一栏最容易变成装饰的方式。
 */
export type BriefObject = 'argument' | 'expression' | 'value' | 'norm-doc' | 'unknown';

export interface Brief {
  /** 谁说的。实名、机构名，或明写「匿名」。空串 = 没答。 */
  speaker: string;
  /** 哪一版（初稿 / 修订 / 转载有删改）。空串 = 没答。 */
  version: string;
  source: BriefSource;
  objectKind: BriefObject;
  at: number;
}

/* ─────────── 分歧与收束（v1.1 第 4 章，人填，软件只保管） ─────────── */

/** §4.1 判定坐标：形式系统。 */
export type FrameFormal = 'classical' | 'inductive' | 'defeasible' | 'none' | 'unknown';
/** §4.1 判据来源。 */
export type FrameCriterion = 'hamblin' | 'ars' | 'rule' | 'scheme-cq' | 'rhetoric' | 'unknown';
/** §4.1 分析维度。 */
export type FrameDimension = 'logic' | 'dialectic' | 'rhetoric' | 'pragmatic' | 'unknown';
/**
 * §4.1 对话协议。文档说「最有用的一格是第四格」：填成「争吵」时，
 * 整套求真标准降级；把学术讨论当「各有立场」处理，同样失格。
 */
export type FrameProtocol =
  | 'persuasion'
  | 'inquiry'
  | 'deliberation'
  | 'court'
  | 'negotiation'
  | 'quarrel'
  | 'unknown';

export interface JudgementFrame {
  formal: FrameFormal;
  criterion: FrameCriterion;
  dimension: FrameDimension;
  protocol: FrameProtocol;
}

/** §4.2 五类分歧源。unknown 是故意留的初值：不预设「这处是标准分歧」。 */
export type DivergenceSource = 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'unknown';
/** §E4 只登记这三类，内容层面「这个词用得怪」不进册。 */
export type DivergenceStake = 'level' | 'handling' | 'ledger' | 'unknown';
/** §4.3 收束三模式。判定顺序不能反：先试收敛，收敛不了才分叉。 */
export type ClosureMode = 'converge' | 'fork' | 'suspend' | 'unknown';

export interface DivergenceEntry {
  /** 拿不准的位置：第几条前提、哪一环、哪一格判据。 */
  at: string;
  source: DivergenceSource;
  stakes: DivergenceStake;
}

/**
 * 一份报告的分歧账。
 *
 * 与立案一样：只在按下「分析」时贴进报告，不参与模型调用，旧存档按「没登记」处理。
 * 软件不判「这处分歧属于 F2 还是 F3」，也不判「收敛条件可不可观察」——
 * 它只数**填没填齐**；判得对不对是评估者的事（§4 全章都是评估者的方法）。
 */
export interface Divergence {
  frame: JudgementFrame;
  closure: ClosureMode;
  /** 分叉时并列几个方案。§4.5 硬规则：≤3，超过回来重做 B1–B2。 */
  branches: number;
  /** §E4 登记册。空数组是合法且正确的：没有那三类犹豫就不该硬凑。 */
  entries: DivergenceEntry[];
  /** 分叉：共同结论（各方案都同意的部分） */
  common: string;
  /** 分叉：差异位置；悬置：不能裁的部分 + 原因 */
  difference: string;
  /** 分叉：收敛条件；收敛：什么会推翻此判；悬置：定案条件 */
  condition: string;
  /** 分叉：各方案判据（原文位置 + 未过的 CQ，每方案一行） */
  basis: string;
  /** 悬置：能裁的部分。§7.5 写明「必须非空；为空则退回重做 A–C」。 */
  decidable: string;
  /** 悬置：举证责任落在哪一方 */
  burden: string;
  at: number;
}

/**
 * 输入区「改了哪几格」的一次改动，不是整份新账。
 *
 * `frame` 允许只给一格：坐标四格是四个下拉，连着选下来时若各自拿一份
 * 渲染时的旧 `value.frame` 展开，后一次会把前一次盖掉（立案卡上吃过一次）。
 * 交给状态层按 `prev.frame` 函数式合并，四格才留得住。
 */
export type DivergencePatch = Omit<Partial<Divergence>, 'frame'> & {
  frame?: Partial<JudgementFrame>;
};

export interface Diagnostic {
  level: 'info' | 'warn' | 'error';
  code: string;
  message: string;
}

/* ─────────── 知识库类型 ─────────── */

export interface SchemeDefinition {
  id: string;
  name: string;
  nameEn: string;
  family: SchemeFamily;
  skeleton: string;
  cues: string[];
  criticalQuestions: {
    id: string;
    question: string;
    meta?: boolean;
    guards: string;
    /**
     * 为什么这一问是「合法的攻击点」，而不是随便加的一道题。
     *
     * 这一栏存在的理由：CQ 与检查表的差别全在这里。检查表问的是
     * 「你想到的这些，人家做了吗」；CQ 问的是「这个型式的担保靠什么成立，
     * 于是哪里必须由提出者负责」。写不出这一问的来源，它就不该出现在库里。
     */
    why: string;
  }[];
  commonMisuse: { form: string; landsOn: string }[];
  inapplicableWhen: string[];
  source: string;
}

export interface FallacyDefinition {
  id: string;
  name: string;
  nameEn: string;
  condition: string;
  definition: string;
  tradition: string;
  whenLegitimate: string[];
  typicalCQ: string | null;
}

/** 语用辩证十规则。语用辩证透镜的检查项直接由它生成。 */
export interface PragmaRule {
  n: number;
  name: string;
  rule: string;
  violates: string;
  /**
   * 这条规则守的是辩论的哪一环。
   *
   * 与型式 CQ 的 why 同一个用途：写不出「它守什么」，它就只是一条禁令，
   * 禁令可以无限加，规则不行。十规则的规范力量来自「不守这一条，
   * 分歧就无法解决」这个论证，不来自 van Eemeren 的署名。
   */
  why: string;
  /**
   * 本工具把它落在哪。写「落在哪个字段」而不是「应当重视」，
   * 是因为文档里说得再好，没落到字段就等于没实现。
   */
  codify: string;
}

/* ─────────── IPC 契约 ─────────── */

export interface LlmSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
}

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; detail?: string };
}

export type AnalysisStage =
  | 'scope'
  | 'reconstructing'
  | 'locating'
  | 'checking'
  | 'verdict'
  | 'refuting'
  | 'self-check'
  | 'done';

export interface ProgressEvent {
  stage: AnalysisStage;
  label: string;
  percent: number;
}

/** 一次分析请求：同一段文本 + 选定透镜 + 问法 */
export interface AnalysisRequest {
  passage: string;
  theory: TheoryId;
  mode: AnalysisMode;
  /** 若这一份是修补后重跑的，记下上一份的 id */
  parentId?: string | null;
}

/* ─────────── 用户异议 ─────────── */

/**
 * 用户说不认同的地方。
 *
 * 这是第三个维度，和另外两个必须分开：
 *   不确定 —— 工具的毛病：模型没把握
 *   有争议 —— 学科的毛病：文献里真没有共识
 *   我不同意 —— 用户的判断：他读过原文、懂这个语境，认为这一条错了
 *
 * 为什么要收：工具承认学科会分歧，却不承认眼前这个人会不同意，
 * 那它只是把「权威」从教科书换成了模型。收下来才有第二个用处——
 * 长期统计能暴露这个工具自己的系统性偏差：哪几条判定最常被反对。
 *
 * 但只能记录，不能改写结论。允许用户改判，等于把「可检验」换成「可商量」，
 * 那是另一种谄媚，和这个工具反对的东西同构。
 */
export type ObjectionField =
  /** 判读：档位与那句结论 */
  | 'verdict'
  /** 击败类型 */
  | 'defeat'
  /** 逐关检查里的某一条 */
  | 'check'
  /** 命名候选 */
  | 'label'
  /** 此处合法 */
  | 'legitimate'
  /** 读者自记：工作台里钉在字段或原文句子上的异议，不是模型写下的判定 */
  | 'anchor';

/**
 * 异议钉在哪一处。
 *
 * 主程序里每处判定自带 field / refId，天然有位置；工作台原先只能写一句
 * 光秃秃的理由，所有异议都落到同一个 `refId:'workbench'` 上，
 * 结果同一份报告里第二条会静默覆盖第一条。这里把「位置」补上。
 *
 * quote 存原文片段而不是只存一个下标：报告可能被删、句子切分规则也可能变，
 * 异议要能脱离报告独立读懂。
 */
export interface ObjectionAnchor {
  kind: 'field' | 'sentence' | 'report';
  /** kind=field 时：报告里的字段路径，如 verdict.statement */
  path?: string;
  /** kind=sentence 时：原文第几句，从 1 开始 */
  sentence?: number;
  /** 给人看的短标签 */
  label: string;
  /** 被钉住那段文字，逐字取自报告 */
  quote: string;
}

export interface Objection {
  /**
   * 跨报告的身份：同一副透镜、同一处、同一段话，
   * 换了 report id 也还是同一条判定。统计要靠它归并。
   */
  key: string;
  /** 在哪一份报告里提的 */
  diagId: string;
  at: number;
  theory: TheoryId;
  field: ObjectionField;
  /** 检查项 id / 命名条目 id / C 或 P1 等 */
  refId: string;
  /** 给人看的标签，如「CQ2 领域相关性」 */
  refLabel: string;
  /** 被反对的那句话，截断保存——报告可能被删，异议要能独立读 */
  excerpt: string;
  /** 理由。可以空着：说「不同意」本身就是信息 */
  reason: string;
  /** 可选：老记录没有这个字段，一律按「未锚定」显示，绝不改写历史 key */
  anchor?: ObjectionAnchor;
}

/** 按判定归并后的统计。用得着它才知道这个工具常年错在哪。 */
export interface ObjectionStat {
  key: string;
  theory: TheoryId;
  field: ObjectionField;
  refId: string;
  refLabel: string;
  excerpt: string;
  anchor?: ObjectionAnchor;
  count: number;
  /** 最近一次的时间 */
  lastAt: number;
  reasons: string[];
}

/* ─────────── 报告存档 ─────────── */

/**
 * 列表用的元数据。全文在磁盘上单独一个文件——
 * 列表页只需要这几项，把几十份报告全读一遍会明显卡。
 */
export interface ReportMeta {
  id: string;
  at: number;
  theory: TheoryId;
  mode: AnalysisMode;
  parentId: string | null;
  chars: number;
  /** 原文开头，用于在列表里认出这是哪一份 */
  excerpt: string;
  level: VerdictLevel;
  /**
   * 未答的检查项数量。列表里最有信息量的一个数字——
   * 它既是「这份报告有多少地方没结论」，也是修订对照要变的那个数。
   */
  open: number;
  cost: number | null;
  bytes: number;
}

/* ─────────── 存档检索（只读） ─────────── */

/**
 * 一处命中落在报告里的哪一类文字上。
 *
 * 只有这七类，是刻意的：它们是本地能稳定取到的字段。模型写的其余部分
 * （自检、诊断、命名候选、反驳）不在其中——不搜它们不是判过轻重，
 * 是本地没有稳定取法，混进来会让「命中」这件事说不清。
 */
export type SearchWhere =
  | 'passage'
  | 'conclusion'
  | 'premise'
  | 'intermediate'
  | 'repair'
  | 'check'
  | 'verdict';

/** 一份报告的检索结果：一条，不是每处各一条——列表里放不下十几段片段。 */
export interface ArchiveFindHit {
  id: string;
  at: number;
  /** 命中总处数。同一段里出现两次算两处，不重叠计数。 */
  count: number;
  /** 命中的类别，按固定顺序（原文在前），不按发现先后 */
  where: SearchWhere[];
  /** 第一处命中前后各留几个字，逐字来自报告（只把连续空白折成一个空格） */
  snippet: string;
  /** 这段片段取自哪一类文字 */
  snippetWhere: SearchWhere;
}

export interface ArchiveFind {
  /** 这一次真的在搜的词（折小写、去重后）。界面对着它加亮，不另算一遍。 */
  terms: string[];
  /** 参与搜索的份数 */
  scanned: number;
  /** 读不出来的份数。它们不在结果里——「没匹配」不能把这几份也算进去。 */
  unreadable: number;
  /** 目录打不开时的原因；null 表示目录读到了 */
  dirError: string | null;
  hits: ArchiveFindHit[];
}

/* ─────────── 存档体检（只读） ─────────── */

/**
 * 一份报告文件为什么读不出来。
 *
 * 分这三种不是术语癖好：文件不存在、文件在但写坏了、文件在也能解析但不是报告，
 * 用户该做的事完全不同（找回备份 / 别再覆盖它 / 换一份打开）。
 * 以前三者都走 `return null`，界面只能说「还没有」，等于替用户做了「数据没丢」的判断。
 */
export type ArchiveIssueKind = 'unreadable' | 'invalid-json' | 'incomplete';

export interface ArchiveIssue {
  /** 只给文件名，不给绝对路径：面板上够认，也不把本机目录结构透给渲染层 */
  file: string;
  kind: ArchiveIssueKind;
  /** 一句人话原因。解析错误只带位置与错误名，不把文件内容整段带进界面 */
  reason: string;
  bytes: number;
}

/** `rebuilt`：本会话读到过损坏，列表通道已从磁盘重建（体检自己从不重建）。 */
export type ArchiveIndexState = 'ok' | 'missing' | 'empty' | 'invalid' | 'rebuilt';

/**
 * 本机存档的一次只读体检。
 *
 * 「只读」是硬约束：看一眼面板不能改写任何文件。索引坏了也不在这里重建——
 * 重建会写 index.json，那是列表通道的事，用户有权知道它发生过但不该被体检顺手做掉。
 */
export interface ArchiveHealth {
  /** 连目录都列不出来。这时任何「0 份」都不可信，界面必须说读不出来 */
  dirError: string | null;
  issues: ArchiveIssue[];
  /** 目录里读得出来的报告数。与索引条目数分开报：两者不一致本身就是线索 */
  healthyFiles: number;
  indexState: ArchiveIndexState;
  indexReason: string | null;
  indexEntries: number;
  /** 索引里有、磁盘上没有：列表上那一行点开是空的 */
  missing: string[];
  /** 磁盘上有、索引里没有：文件还在，只是列表不提它 */
  orphans: string[];
  checkedAt: number;
}

/** 单份报告的探测结果。`archive:get` 保持返回「报告或 null」，原因由这里补。 */
export interface ReportProbe {
  state: 'ok' | 'missing' | ArchiveIssueKind;
  /** 文件名，不含目录 */
  file: string;
  reason: string | null;
}

/* ─────────── 用量与余额 ─────────── */

/**
 * 一次调用留下的账。
 *
 * 三条规矩：
 *   1. 只追加，不改写。历史是可审计的，不是可编辑的。
 *   2. estimated=true 的记录，token 数按本地规则估出来的，界面上必须带「估」字。
 *   3. 单价随记录冻结。改单价只影响以后，不重算过去——
 *      否则用户昨天按 A 模型花的钱，今天会因为填了 B 模型的价格而变样。
 *      当时没填单价（priced=false）的，聚合时按现价回填并另做标注。
 */
export interface UsageRecord {
  id: string;
  at: number;
  /** 失败也留一条：失败率本身是重要信息 */
  ok: boolean;
  theory: TheoryId | null;
  model: string;
  /** 供应商主机名。不存路径、不存 Key——这份文件可能被导出。 */
  host: string;
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
  cost: number;
  /** 记录当时是否填过单价 */
  priced: boolean;
  currency: string;
  priceIn: number;
  priceOut: number;
  ms: number;
  /** 原文长度，用于判断「贵是因为文本长还是因为模型贵」 */
  chars: number;
  /**
   * 这次有多少输入 token 命中了接口的自动前缀缓存。
   *
   * 没有这个字段，「缓存有没有生效」就永远只能靠猜：
   * 改了 system 让它变静态，却看不出省没省下来。
   * 供应商不返回就是 undefined，不填 0——0 是「确实没命中」，性质不同。
   */
  cacheHitTokens?: number;
}

/** 单价。按「每百万 token」填，和供应商价目表的写法一致。 */
export interface Pricing {
  inPerM: number;
  outPerM: number;
  currency: string;
}

/**
 * 余额锚点：某时刻账户里还剩多少钱。
 *
 * 为什么不自动查余额：没有统一接口。DeepSeek 有 /user/balance，
 * OpenAI 没有，各家格式都不一样，多半还要单独授权。
 * 与其做一堆只对一家管用的适配，不如让用户记一笔——
 * 这也是唯一能对上真实账单的办法。
 */
export interface BalanceAnchor {
  at: number;
  amount: number;
  note: string;
}

export interface UsageBucket {
  count: number;
  okCount: number;
  tokens: number;
  cost: number;
}

export interface UsageDay {
  date: string;
  count: number;
  tokens: number;
  cost: number;
}

/**
 * 明细里的一行。
 *
 * 比 UsageRecord 多两个字段，因为**面板上的金额必须和合计用同一个算法**。
 * 只给原始记录的话，渲染层只能拿 `r.cost` 显示：没填单价的那条是 0，
 * 而合计里它是按现价回填过的——于是明细加起来永远对不上上面写的本月花费，
 * 用户会以为账本在骗他。回填的计算留在主进程，这里只带着结果走。
 */
export interface UsageRow extends UsageRecord {
  /** 这一条实际算多少钱（冻结价 → 按模型回填 → 0） */
  effCost: number;
  /** 金额是不是按现价回填出来的 */
  backfilled: boolean;
}

export interface UsageSummary {
  today: UsageBucket;
  month: UsageBucket;
  all: UsageBucket;
  /** 近 14 天，缺的那天补 0 */
  daily: UsageDay[];
  /** 最近 30 条，新的在前 */
  recent: UsageRow[];
  pricing: Pricing;
  hasPricing: boolean;
  balance: {
    anchor: BalanceAnchor | null;
    /** 锚点之后花掉的钱 */
    spentSince: number;
    /** 还剩多少。没记锚点时为 null——不是 0。 */
    remaining: number | null;
    /** 按最近若干次均价推算还能跑几次 */
    runsLeft: number | null;
    avgCostPerRun: number | null;
    /** 均价是用几条记录算出来的 */
    avgBasis: number;
  };
  /** 成功记录里，token 是估出来的比例（0–1）。1 表示全是估的。 */
  estimatedShare: number;
  /** 有没有记录是按现价回填的（当时没填单价） */
  backfilled: number;
  /**
   * 被排除在统计之外的模拟调用条数。
   *
   * 冒烟测试起本地假服务器跑通链路，它返回的 token 是编的固定值。
   * 那些记录留在流水里没有删（账本该可追溯），但不算进任何合计——
   * 否则「本月 197 次」里混着 115 次根本没发生的调用，账本就不再是账本。
   */
  mockExcluded: number;
  /**
   * 现在显示的金额是按什么价算出来的。
   *
   * user  = 用户自己填的单价（最准，按它显示）
   * builtin = 用户没填，用内置参考价估的（量级对，具体数以账单为准）
   * none  = 既没填也没内置价，金额一栏显示「未计价」
   *
   * 分开标出来是因为「¥1.2」和「约 ¥1.2（估算）」对读者的意义不同：
   * 前者是账，后者是估。混在一起就成了假精确。
   */
  pricingSource: 'user' | 'builtin' | 'none';
  /**
   * 最近若干次成功调用里，输入 token 命中前缀缓存的比例（0–1）。没数据为 null。
   *
   * 这个数是提示词工程的体检指标，不是省钱指标：
   * 它掉到接近 0，说明 system 又在每次请求里不同了——那是个会静默烧钱的回归，
   * 而除了这个数字，没有任何地方看得出来。
   */
  cacheHitShare: number | null;
}
