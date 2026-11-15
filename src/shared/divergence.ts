/**
 * 分歧与收束：《论证分析全流程 v1.1》第 4 章、E4 与 §7.4 / §7.5。
 *
 * v1.1 的一句话是「判不出唯一答案时，不许假装判得出；也不许用『多元』逃掉该判的那部分」。
 * 落到这个软件上，最诚实的做法不是让本地层替模型吐出两套答案——软件压根不产生判定，
 * 那样才是「假装判得出」。能做的是三件：
 *
 *   1. **给分歧一个固定位置**（F 段、E4 登记、判定坐标四元组），不再散落成「感觉哪里不对」；
 *   2. **只数填没填齐**：四格坐标、F1–F5、收束模式、矩阵尾部三行、悬置三件套。
 *      不判「这处分歧属于 F2 还是 F3」，也不判「收敛条件可不可观察」——那是评估者的活；
 *   3. **把文档里的硬规矩原样写在旁边**（并列 ≤3、四条禁止、反假阳性 13–15 条），
 *      让人在填的时候看得见，而不是等六个月后读报告时才发现当时漏了什么。
 *
 * 与 `@shared/brief` 同构：收（把界面上的值收成结构）、数（缺哪几格）、说（一句话概括）。
 * 四元组四格全是 `unknown` 时不写空结构——写一个空壳进报告，流程账会把 F 段当成「做过」。
 *
 * 跑法：npm run check:divergence
 */
import type {
  ClosureMode,
  Divergence,
  DivergenceEntry,
  DivergenceSource,
  DivergenceStake,
  FrameCriterion,
  FrameDimension,
  FrameFormal,
  FrameProtocol,
  JudgementFrame,
} from './types';

/** 一个文本格最多收多少字。防「把整段报告贴进『收敛条件』」。 */
export const DIVERGENCE_FIELD_MAX = 160;
/** 登记册最多几条。§E4 只登记三类，超过八条基本是把心虚也塞进来了。 */
export const DIVERGENCE_ENTRY_MAX = 8;
/** §4.5 硬规则：并列数 ≤ 3。超过三个方案，回来重做 B1–B2。 */
export const BRANCH_MAX = 3;
/** 允许输入的并列数上限：故意留到 9，好让「超过 3」这件事能被数出来、而不是被截断成 3。 */
export const BRANCH_INPUT_MAX = 9;

/* ─────────── §4.1 判定坐标四元组 ─────────── */

export const FRAME_FORMAL: { id: FrameFormal; label: string; decides: string }[] = [
  { id: 'classical', label: '经典演绎', decides: '什么叫「无效」：形式保真' },
  { id: 'inductive', label: '归纳', decides: '什么叫「无效」：样本与强度' },
  { id: 'defeasible', label: '可废止', decides: '什么叫「无效」：例外与反证' },
  { id: 'none', label: '无', decides: '不预设形式系统，只按清单与 CQ 核' },
  { id: 'unknown', label: '还没定', decides: '四格填不出，等于不写法律依据就判决' },
];

export const FRAME_CRITERION: { id: FrameCriterion; label: string; decides: string }[] = [
  { id: 'hamblin', label: 'Hamblin 式清单', decides: '什么叫「缺陷」：标准处理里的条目' },
  { id: 'ars', label: 'ARS 三问', decides: '可接受 / 相关 / 充分' },
  { id: 'rule', label: '规则违反', decides: '语用辩证十规则' },
  { id: 'scheme-cq', label: '型式–CQ', decides: '先认型式，再逐条过它的批判性问题' },
  { id: 'rhetoric', label: '修辞配比', decides: '查替代，不查有无' },
  { id: 'unknown', label: '还没定', decides: '判据来源没声明，缺陷就说不清适用条件' },
];

export const FRAME_DIMENSION: { id: FrameDimension; label: string; decides: string }[] = [
  { id: 'logic', label: '逻辑', decides: '查前提与结论的支撑关系' },
  { id: 'dialectic', label: '辩证', decides: '查谁该举证、哪种攻击合法' },
  { id: 'rhetoric', label: '修辞', decides: '查诉求配比、框架与传播条件' },
  { id: 'pragmatic', label: '语用', decides: '查这一次言语行为在做什么' },
  { id: 'unknown', label: '还没定', decides: '三个视角不可互相替代，不声明就会串账' },
];

export const FRAME_PROTOCOL: { id: FrameProtocol; label: string; decides: string }[] = [
  { id: 'persuasion', label: '说服', decides: '提出立场者承担举证责任' },
  { id: 'inquiry', label: '探究', decides: '求真到底，不许拿「各有立场」收场' },
  { id: 'deliberation', label: '审议', decides: '比较方案与代价' },
  { id: 'court', label: '法庭', decides: '按举证标准定案，证据不足判「未决」' },
  { id: 'negotiation', label: '谈判', decides: '以可接受的让步为准' },
  { id: 'quarrel', label: '争吵', decides: '整套求真标准降级：要求骂战承担举证责任，是分析者的错' },
  { id: 'unknown', label: '还没定', decides: '第四格最有用：它决定谁该举证、哪种攻击合法' },
];

/* ─────────── §4.2 五类分歧源 ─────────── */

export const DIVERGENCE_SOURCES: {
  id: DivergenceSource;
  label: string;
  symptom: string;
  /** 文档的一句话判据：F1/F2/F4 是评估者的活，F3/F5 是对象的性质。 */
  side: '评估者的活' | '对象的性质' | '';
  handling: string;
}[] = [
  {
    id: 'F1',
    label: '材料',
    symptom: '版本不同 / 转述 / 上下文截断，双方引的不是同一句话',
    side: '评估者的活',
    handling: '双版本并判，结论标「材料未定」；补原文即可消除',
  },
  {
    id: 'F2',
    label: '重构',
    symptom: '隐含前提补法不同、枢纽选哪一个，同一段档位跨两档',
    side: '评估者的活',
    handling: '宽读 / 严读双版本并行，靠最弱补全收窄',
  },
  {
    id: 'F3',
    label: '标准',
    symptom: '判据来源或分析维度不同（学派、型式识别、层级）',
    side: '对象的性质',
    handling: '不可消除，只能声明：四元组 + 各派判词 + 共识核',
  },
  {
    id: 'F4',
    label: '证据',
    symptom: '证据不足或证据对立，各有各的量级',
    side: '评估者的活',
    handling: '判「未决」+ 举证责任 + 定案条件',
  },
  {
    id: 'F5',
    label: '价值·框架',
    symptom: '规范冲突 / 概念切割不同（「税」还是「负担」）',
    side: '对象的性质',
    handling: '不可消除：只判证成强度、框架遮蔽了什么',
  },
  { id: 'unknown', label: '还没归类', symptom: '', side: '', handling: '没归类 = 分歧没落到某一层' },
];

/* ─────────── §4.3 收束三模式 ─────────── */

export const CLOSURE_MODES: { id: ClosureMode; label: string; trigger: string; output: string }[] = [
  {
    id: 'converge',
    label: '收敛 · 单判',
    trigger: '只剩一种读法过得了 C1 三问',
    output: '标准判决（§7.2）',
  },
  {
    id: 'fork',
    label: '分叉 · 多方案',
    trigger: '≥2 种读法各自过自身标准，且互斥',
    output: '多方案矩阵（§7.4），并列 ≤3',
  },
  {
    id: 'suspend',
    label: '悬置 · 分歧报告',
    trigger: '连「该用哪套标准」都定不了，或证据低于本语境举证标准',
    output: '分歧报告（§7.5）：必须写能裁的部分',
  },
  { id: 'unknown', label: '还没定', trigger: '', output: '判定顺序不能反：先试收敛，收敛不了才分叉' },
];

/** §E4 只登记这三类。内容层面「这个词用得怪」不进册。 */
export const DIVERGENCE_STAKES: { id: DivergenceStake; label: string; hint: string }[] = [
  { id: 'level', label: '影响档位', hint: '同一处两读，档位跨两档' },
  { id: 'handling', label: '影响处置', hint: '一端加固、一端换型式' },
  { id: 'ledger', label: '影响命题账', hint: '同一证据两向支持' },
  { id: 'unknown', label: '还没定', hint: '登记表是给分歧用的，不是给心虚用的' },
];

/** §4.5 并列四条禁止。写在旁边，不替人判有没有违反。 */
export const FORK_BANS = [
  '等权并列：一方明显更弱，缺判据的那一方不配进矩阵',
  '档位稀释：D5 不许写成「也可以看作 D3」；涉及诚信的判定不参与并列',
  '假互斥：把「补一句即消」（D1）和「结构失效」（D4）并列为两说，是分析没做完',
  '不可裁伪装：事实·可裁栏里不许出现「两种说法都对」，只许写「证据不足，未决」',
];

/** §4.6 档位区间四条（同时满足才允许写 D2–D3）。 */
export const RANGE_RULES = [
  '分歧源在 F2 或 F3；F1 材料没看清，不许给区间',
  '区间宽度恰为 1 档',
  '两端判据都写出，不是取中间值',
  '两端处置相同（都落在「加证据 / 降强度」）；处置不同必须分方案',
];

/** §6 反假阳性 v1.1 新增三条。 */
export const V11_CAVEATS = [
  '有分歧 ≠ 有缺陷：分歧属于工具差异时，不得计为文本的错',
  '出多方案 ≠ 更严谨：没有收敛条件的并列，只是不敢判',
  '两说并存 ≠ 都对：「各自范围内成立」说的是适用范围，不是客观上两个都真',
];

/* ─────────── 收 / 数 / 说 ─────────── */

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim().slice(0, DIVERGENCE_FIELD_MAX) : '';
}

function oneOf<T extends string>(v: unknown, ids: readonly T[], fallback: T): T {
  return typeof v === 'string' && ids.includes(v as T) ? (v as T) : fallback;
}

const FORMAL_IDS = FRAME_FORMAL.map((x) => x.id);
const CRITERION_IDS = FRAME_CRITERION.map((x) => x.id);
const DIMENSION_IDS = FRAME_DIMENSION.map((x) => x.id);
const PROTOCOL_IDS = FRAME_PROTOCOL.map((x) => x.id);
const SOURCE_IDS = DIVERGENCE_SOURCES.map((x) => x.id);
const STAKE_IDS = DIVERGENCE_STAKES.map((x) => x.id);
const CLOSURE_IDS = CLOSURE_MODES.map((x) => x.id);

export function normalizeFrame(input: unknown): JudgementFrame {
  const o = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  return {
    formal: oneOf(o.formal, FORMAL_IDS, 'unknown'),
    criterion: oneOf(o.criterion, CRITERION_IDS, 'unknown'),
    dimension: oneOf(o.dimension, DIMENSION_IDS, 'unknown'),
    protocol: oneOf(o.protocol, PROTOCOL_IDS, 'unknown'),
  };
}

export function normalizeEntry(input: unknown): DivergenceEntry | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  const at = text(o.at);
  const source = oneOf(o.source, SOURCE_IDS, 'unknown');
  const stakes = oneOf(o.stakes, STAKE_IDS, 'unknown');
  /*
   * 三个都空的一行**要留着**：那是刚点过「＋ 加一条」、还没填的一行。
   * 过滤掉它，用户点了按钮界面纹丝不动，比留一行待填更像坏了。
   * 代价是 `divergenceGaps` 会如实报它缺位置 / 缺 F 类 / 缺影响——正是对的：
   * 一行空的登记本来就该被看见，而不是被悄悄丢掉。
   */
  return { at, source, stakes };
}

/**
 * 收成分歧账。全空返回 null，理由见文件头：写了空壳，流程账会把 F 段当成做过。
 *
 * 枚举收敛到 `unknown` 不抛错，与立案卡同一条规矩：报告是给人看的，
 * 为旧存档里一个不认识的字段值炸掉整次分析不划算。
 */
export function normalizeDivergence(input: unknown): Divergence | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  const frame = normalizeFrame(o.frame);
  const closure = oneOf(o.closure, CLOSURE_IDS, 'unknown');
  const entries = (Array.isArray(o.entries) ? o.entries : [])
    .slice(0, DIVERGENCE_ENTRY_MAX)
    .map(normalizeEntry)
    .filter((x): x is DivergenceEntry => x !== null);
  const branches = typeof o.branches === 'number' && Number.isFinite(o.branches)
    ? Math.max(0, Math.min(BRANCH_INPUT_MAX, Math.round(o.branches)))
    : 0;
  const common = text(o.common);
  const difference = text(o.difference);
  const condition = text(o.condition);
  const basis = text(o.basis);
  const decidable = text(o.decidable);
  const burden = text(o.burden);

  const blank =
    frame.formal === 'unknown' &&
    frame.criterion === 'unknown' &&
    frame.dimension === 'unknown' &&
    frame.protocol === 'unknown' &&
    closure === 'unknown' &&
    entries.length === 0 &&
    branches === 0 &&
    !common && !difference && !condition && !basis && !decidable && !burden;
  if (blank) return null;

  return {
    frame,
    closure,
    branches,
    entries,
    common,
    difference,
    condition,
    basis,
    decidable,
    burden,
    at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : Date.now(),
  };
}

/** 四元组四格缺哪几格。用 §4.1 的四个名字，不用内部字段名。 */
export function frameGaps(f: JudgementFrame): string[] {
  const out: string[] = [];
  if (f.formal === 'unknown') out.push('形式系统');
  if (f.criterion === 'unknown') out.push('判据来源');
  if (f.dimension === 'unknown') out.push('分析维度');
  if (f.protocol === 'unknown') out.push('对话协议');
  return out;
}

/**
 * 只数「填没填齐」，不判填得对不对。
 *
 * 三条容易写错的边界，这里都按 v1.1 收住了：
 *   - **登记册为空不算缺**：§E4 明说只登记三类，「把所有犹豫都塞进登记表」才是常见错。
 *     只有已经声明分叉 / 悬置、却一条都没登记时才说——那时是「在哪儿分歧」没落下来。
 *   - **收敛 / 分叉 / 悬置各要求不同的字段**：拿一套通用清单去量三种模式，
 *     会让收敛报告被要求交「举证责任」，那不是严格，是串账。
 *   - **并列数超 3 说清楚后果**：回来重做 B1–B2，不是继续列第四个方案。
 */
export function divergenceGaps(d: Divergence): string[] {
  const out: string[] = [];
  const fg = frameGaps(d.frame);
  if (fg.length) out.push(`判定坐标还缺 ${fg.length} 格：${fg.join(' / ')}（§4.1：四格填不出，等于不写法律依据就判决）`);

  if (d.closure === 'unknown') {
    out.push('收束模式没声明（§4.3：先试收敛，收敛不了才分叉；上来就分叉是把「没做完」包装成「很复杂」）');
  }

  d.entries.forEach((e, i) => {
    const tag = `登记 ${i + 1}`;
    if (!e.at) out.push(`${tag} 没写位置（第几条前提 / 哪一环 / 哪一格判据）`);
    if (e.source === 'unknown') out.push(`${tag} 没定位到 F1–F5（§4.2：分歧必须落在某一层）`);
    if (e.stakes === 'unknown') out.push(`${tag} 没写它影响档位、处置还是命题账（§E4 只登记这三类）`);
  });

  if (d.closure === 'fork' || d.closure === 'suspend') {
    if (!d.entries.length) out.push('声明了分歧却一条都没登记：分歧落在哪儿没写下来（§1：当场记一笔，到 D 之后统一收口）');
  }

  if (d.closure === 'fork') {
    if (d.branches < 2) out.push('分叉至少两个互斥方案；只写一个是单判，不是分叉');
    if (d.branches > BRANCH_MAX) out.push(`并列 ${d.branches} 个方案，超过 §4.5 的 ≤3：回来重做 B1–B2，不是继续列`);
    if (!d.basis) out.push('缺各方案判据（每方案一行：原文位置 + 未过的 CQ；§4.5 准入第一条）');
    if (!d.common) out.push('缺【共同结论】：没有它，等于没判');
    if (!d.difference) out.push('缺【差异位置】：没有它，不知道在争什么');
    if (!d.condition) out.push('缺【收敛条件】：没有它，永远不会收敛（§4.4：X、Y 必须可观察）');
  }

  if (d.closure === 'suspend') {
    if (!d.decidable) out.push('缺【能裁的部分】：§7.5 写明这一格必须非空，为空则退回重做 A–C');
    if (!d.difference) out.push('缺【不能裁的部分】及原因（价值不由论证裁定 / 证据低于举证标准）');
    if (!d.condition) out.push('缺【定案条件】：需要什么证据、让步或定义澄清才能定');
    if (!d.burden) out.push('缺【举证责任】落在哪一方');
  }

  if (d.closure === 'converge' && !d.condition) {
    out.push('缺「什么会推翻此判」（§7.1 第四行「疑」／§9：写不出降级条件的判定只是感觉）');
  }

  return out;
}

/** 按模式给的那几句硬规矩。它们不是缺口，是填的时候该看见的话。 */
export function divergenceCaveats(d: Divergence): string[] {
  const out: string[] = [];
  if (d.closure === 'fork') {
    out.push('判定顺序不能反：先试过收敛，收敛不了才分叉（§4.3）');
    out.push(...FORK_BANS.map((s) => `并列禁止：${s}`));
    out.push('矩阵尾部三行缺一行，这份多方案就是废的（§4.4）');
    out.push(...RANGE_RULES.map((s) => `若改写成档位区间，须同时满足：${s}`));
  }
  if (d.closure === 'suspend') {
    out.push('悬置不是弃权：争在哪一层、哪部分仍能裁、还需要什么才能定案，三样都要写（§4.3）');
    out.push('「无法判断」用多了会变成懒惰：每个「未决」都要写定案条件（§12 第 7 条）');
  }
  out.push(...V11_CAVEATS);
  return out;
}

export function frameLine(f: JudgementFrame): string {
  const pick = <T extends { id: string; label: string }>(list: T[], id: string) =>
    list.find((x) => x.id === id)?.label ?? '还没定';
  return `${pick(FRAME_FORMAL, f.formal)}／${pick(FRAME_CRITERION, f.criterion)}／${pick(FRAME_DIMENSION, f.dimension)}／${pick(FRAME_PROTOCOL, f.protocol)}`;
}

export function closureLabel(c: ClosureMode): string {
  return CLOSURE_MODES.find((x) => x.id === c)?.label ?? '还没定';
}

export function sourceLabel(s: DivergenceSource): string {
  const x = DIVERGENCE_SOURCES.find((y) => y.id === s);
  if (!x || x.id === 'unknown') return '没归类';
  return `${x.id} ${x.label}`;
}

export function stakeLabel(s: DivergenceStake): string {
  return DIVERGENCE_STAKES.find((x) => x.id === s)?.label ?? '还没定';
}

/** 抬头的一行摘要：坐标 / 收束 / 登记几处。 */
export function divergenceLine(d: Divergence): string {
  const parts = [`坐标：${frameLine(d.frame)}`, `收束：${closureLabel(d.closure)}`];
  if (d.closure === 'fork' && d.branches > 0) parts.push(`并列 ${d.branches} 个方案`);
  parts.push(d.entries.length ? `登记 ${d.entries.length} 处（${d.entries.map((e) => sourceLabel(e.source)).join('、')}）` : '没有登记分歧');
  return parts.join('｜');
}

/** 给界面用的一句话。缺什么、缺了会怎样；一样都不缺就说「没登记」也是合法结果。 */
export function divergenceNote(d: Divergence): string {
  const gaps = divergenceGaps(d);
  if (gaps.length) return `还缺 ${gaps.length} 格：${gaps[0]}${gaps.length > 1 ? `，另有 ${gaps.length - 1} 处` : ''}。`;
  if (d.closure === 'converge' && !d.entries.length) return '四格齐、收束为单判、没有要登记的分歧。按 §4.3，先试收敛是对的。';
  return '该填的都填了。这些是「填齐了」，不是「判对了」——归类与收敛条件准不准，本地算不出来。';
}

/** 两份分歧账是不是同一份：只比内容，不比 at（时间戳每敲一个字都变）。 */
export function sameDivergence(a: Divergence, b: Divergence): boolean {
  return JSON.stringify({ ...a, at: 0 }) === JSON.stringify({ ...b, at: 0 });
}

/** 「输入区填了，这份报告还不认」——同 briefPending，提示填完要再跑一次。 */
export function divergencePending(report: Divergence | null | undefined, current: Divergence | null): boolean {
  if (!current) return false;
  if (!report) return true;
  return !sameDivergence(report, current);
}
