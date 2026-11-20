/**
 * 型式—CQ 对表：十九型的最低问题集，以及「这份报告的检查表有没有把它走完」的本地核对。
 *
 * 来源：知识库「逻辑学」→ 论证分析流程 → 03_检验层：
 *   C-04《型式 CQ 总表：十九型详解》、C-03《逐 CQ：批判性问题的过与不过》、
 *   C-02《型式识别：十九型的选择规则》。
 *
 * 搬进来的只有能搬的部分：
 *
 *   - 十九型每型的 CQ 最低集、一句话判定要点、微型构造示例（1–18 型 [已核准确]，
 *     第 19 型「空转论据／失信原则」是 [本流程自定]——来源层级逐行标明，
 *     不把自定项混进 Walton 型式库的统计里）；
 *   - 「CQ 最低集只能追加、不能删减」这条用法（C-04 4.1、五节）；
 *   - 「未答不算过」与三态读数（C-03 4.2、4.4）：过／不过／未答，
 *     空白写未答，不适用须有协议依据、不计入分母。
 *
 * **本地不判「这一问过没过」。** 与判档、命题账、修辞审计同一条产品边界
 * （docs/产品定位.md）：三态读数由模型按 C-03 登记，本地只核两件事——
 *
 *   1. 这份报告用的型式，在十九型表里是哪一型（或表外）；
 *   2. 那一型的最低集里，哪几问在报告里找得到、哪几问**本库根本没有**、
 *      哪几问库里有而报告没登记。三种缺口分开说，因为它们该由不同的人补：
 *      库缺的问要改库（下一版），报告缺的问要模型补答。
 *
 * 为什么值得单开一层：C-04 说得很直白——「CQ 是下限，不是上限；
 * 追加项须写协议依据，不得临场删项以提高通过率」。而本库的 23 个型式各有自己的
 * CQ 集，从来没和这十九型的最低集对过表。对不上的地方，模型不是「偷懒没问」，
 * 是**它拿到的题目里就没有那一问**——这两种缺席在界面上长得一模一样，
 * 却是完全不同的两件事。把它们分开，是这一层唯一的用处。
 *
 * 表外处理照 C-04 4.2：不能匹配任一型时，不新造第 20 型，写「型式表外」并列追问点。
 * 这里的 `LIB_SCHEME_MAP` 就是那张「表内／表外」的登记簿，逐条写理由。
 */

import type { CheckAnswer, CheckItem, Diagnosis } from './types';

/* ─────────── 十九型 ─────────── */

/** 来源层级。C-04 每行末尾的标注，逐行照搬，不合并。 */
export type SchemeCqSource = 'verified' | 'local';

export const SOURCE_LABEL: Record<SchemeCqSource, string> = {
  verified: '已核准确',
  local: '本流程自定',
};

export interface CanonicalCq {
  /** 表内编号，1 起，按 C-04 的顺序；跨行不复用。 */
  no: number;
  /** 这一问要问什么。措辞取自 C-04，只做断句，不改意思。 */
  ask: string;
  /**
   * 关键 CQ：直接决定该型式能否使用（C-03 二节）。
   * 只在 C-03 明文点名的那三处标真——「关键」升级会改变档位候选（关键未过→D3），
   * 不是本地能临场决定的，所以不自作主张多标。
   */
  key?: boolean;
}

export interface SchemeCqRow {
  /** 1–19。 */
  no: number;
  name: string;
  source: SchemeCqSource;
  /** 一句话判定要点：核对读数有没有跑题，不替代逐条登记。 */
  point: string;
  /** 微型构造示例：只用甲／乙／某公司／某市，不是判据、不是案例。 */
  example: string;
  cqs: CanonicalCq[];
}

/**
 * 十九型。第 19 型是自定项，其余十八型沿用 Walton 型式库方法。
 *
 * 例子全部是构造的（C-04 明写「微型构造示例」），主体只用甲／乙／某公司／某市——
 * 检查脚本会逐行核这一点，因为一个真实机构名会让读者把示例当案例引用。
 */
export const SCHEME_CQ_TABLE: readonly SchemeCqRow[] = [
  {
    no: 1,
    name: '例证',
    source: 'verified',
    point: '个例只能支撑有限结论，代表性与反例先过关。',
    example: '甲说我见过的某公司项目都延期，所以这类项目都会延期。',
    cqs: [
      { no: 1, ask: '样例是否典型？' },
      { no: 2, ask: '数量够不够？' },
      { no: 3, ask: '有无反例？' },
    ],
  },
  {
    no: 2,
    name: '类比',
    source: 'verified',
    point: '相似点须与所推属性相关，致命差异一出现即断。',
    example: '乙说某公司办公楼装这种灯省电，某市住宅也该装。',
    cqs: [
      { no: 1, ask: '相似点是否与结论相关？' },
      { no: 2, ask: '差异是否致命？' },
    ],
  },
  {
    no: 3,
    name: '滑坡',
    source: 'verified',
    point: '链、驱动、阻断三问缺一，型式不成立。',
    example: '甲说某市放宽一处摊位，最终全市管理都会失控。',
    cqs: [
      { no: 1, ask: '序列真实吗？' },
      { no: 2, ask: '每一步的驱动力真实吗？' },
      { no: 3, ask: '有无阻断机制？（未答不算过）', key: true },
    ],
  },
  {
    no: 4,
    name: '后果论证',
    source: 'verified',
    point: '不比较替代方案，就不足以支持必须采取行动。',
    example: '乙说禁用某公司车辆能减少事故，所以应全面禁用。',
    cqs: [
      { no: 1, ask: '后果发生的概率有多大？' },
      { no: 2, ask: '后果有多严重？' },
      { no: 3, ask: '有无更小代价的替代方案？' },
    ],
  },
  {
    no: 5,
    name: '专家意见',
    source: 'verified',
    point: '身份、共识、利益、转述四项缺一不可。',
    example: '甲说某公司顾问讲方案好，所以方案好。',
    cqs: [
      { no: 1, ask: '此人是否在该领域？', key: true },
      { no: 2, ask: '领域内有无共识？' },
      { no: 3, ask: '有无利益冲突？' },
      { no: 4, ask: '其说法是否被引用方准确转述？' },
    ],
  },
  {
    no: 6,
    name: '人身攻击',
    source: 'verified',
    point: '攻击人只有在直接影响证词可信度时才与该主张相关。',
    example: '乙说甲以前判断错过，所以甲这次说法一定错。',
    cqs: [
      {
        no: 1,
        ask: '攻击点是否与主张真值相关？（品格／处境一般不相关；偏向性仅在直接损害证词可信度时相关）',
      },
    ],
  },
  {
    no: 7,
    name: '无知论证',
    source: 'verified',
    point: '未证真不等于为假，先定责任再谈结论。',
    example: '甲说没人证明某公司方案有害，所以它肯定无害。',
    cqs: [
      { no: 1, ask: '举证责任在谁？' },
      { no: 2, ask: '调查是否已穷尽？' },
      { no: 3, ask: '「未证明为真」能否推出「为假」？' },
    ],
  },
  {
    no: 8,
    name: '因果',
    source: 'verified',
    point: '相关不自动是因果，机制与混淆变量必查。',
    example: '乙说某公司入园后某市同类企业减少，所以是它挤垮的。',
    cqs: [
      { no: 1, ask: '相关性成立吗？' },
      { no: 2, ask: '时序对吗？' },
      { no: 3, ask: '有无混淆变量？' },
      { no: 4, ask: '机制是否给出？' },
    ],
  },
  {
    no: 9,
    name: '征兆',
    source: 'verified',
    point: '征兆须有稳定共变，凭印象联想不算。',
    example: '甲说某公司门口排队长，所以它利润高。',
    cqs: [{ no: 1, ask: '该征兆与所指状态的相关强度有多大？' }],
  },
  {
    no: 10,
    name: '实践推理',
    source: 'verified',
    point: '手段须有效，且已排除侵害更小的方案。',
    example: '乙说为保证某市道路畅通，应禁止甲一类车辆全天上路。',
    cqs: [
      { no: 1, ask: '目标是否可欲？' },
      { no: 2, ask: '手段是否有效？' },
      { no: 3, ask: '有无侵害更小的手段？' },
    ],
  },
  {
    no: 11,
    name: '溯因',
    source: 'verified',
    point: '最佳解释须在竞争中胜出，而非唯一被想到的解释。',
    example: '甲说某公司设备停机，只能是维护人员疏忽。',
    cqs: [
      { no: 1, ask: '竞争假说是否被排除？' },
      { no: 2, ask: '解释力与简洁性比较过吗？' },
    ],
  },
  {
    no: 12,
    name: '归类',
    source: 'verified',
    point: '定义先问是否被接受，边界案例须交代。',
    example: '乙说甲的行为属于违规，因为按某公司口径它算违规。',
    cqs: [
      { no: 1, ask: '所用定义是否被接受？' },
      { no: 2, ask: '边界案例如何处理？' },
    ],
  },
  {
    no: 13,
    name: '价值判断',
    source: 'verified',
    point: '判的是证成强度，不判规范命题的真假。',
    example: '甲说某公司可弹性工作，乙所在部门不该弹性工作。',
    cqs: [
      { no: 1, ask: '是否可普遍化？' },
      { no: 2, ask: '是否双重标准？' },
      { no: 3, ask: '是否与其他主张一致？' },
    ],
  },
  {
    no: 14,
    name: '规则适用',
    source: 'verified',
    point: '规则有效与本案适用是两个独立问题。',
    example: '乙说按某市某条规定，某公司必须照办。',
    cqs: [
      { no: 1, ask: '规则本身有效吗？' },
      { no: 2, ask: '本案例是否落入其适用范围？' },
    ],
  },
  {
    no: 15,
    name: '归谬',
    source: 'verified',
    point: '推出荒谬须逻辑必然，且对方也认其为荒谬。',
    example: '甲说若允许乙请假，人人就都不上班，所以不许请假。',
    cqs: [
      { no: 1, ask: '推论是否必然？' },
      { no: 2, ask: '「荒谬」是否被对方也承认？' },
    ],
  },
  {
    no: 16,
    name: '合成／分割',
    source: 'verified',
    point: '整体与部分的属性传递需要桥接理由。',
    example: '乙说某公司每个员工高效，所以整个部门一定高效。',
    cqs: [{ no: 1, ask: '部分属性是否可传递到整体／个体？' }],
  },
  {
    no: 17,
    name: '统计',
    source: 'verified',
    point: '分母与方向错一条，整条统计支持失效。',
    example: '甲说某市事故中甲类占比高，所以甲类事故率高。',
    cqs: [
      { no: 1, ask: '样本代表性够吗？' },
      { no: 2, ask: '基数是否给出？' },
      { no: 3, ask: '条件概率与逆概率是否混淆？', key: true },
    ],
  },
  {
    no: 18,
    name: '两难',
    source: 'verified',
    point: '假两难靠漏掉第三种选项或强加互斥。',
    example: '乙说要么不让某公司进场，要么某市财政破产。',
    cqs: [
      { no: 1, ask: '选项是否穷尽？' },
      { no: 2, ask: '两者是否真不可兼得？' },
    ],
  },
  {
    no: 19,
    name: '空转论据／失信原则',
    source: 'local',
    point: '两头都能用的论据，任何一头的净支持都是零。',
    example: '甲以某公司一贯坚持为由，同时说其方案可靠又说他固执不可取。',
    cqs: [
      {
        no: 1,
        ask: '这个论据能否同时支持正反两个结论？能，则它对结论零支持力，不得计为正向支撑。',
      },
    ],
  },
];

/** 按编号取一行。表外返回 null，不抛错。 */
export function tableRow(no: number | null): SchemeCqRow | null {
  if (no === null) return null;
  return SCHEME_CQ_TABLE.find((r) => r.no === no) ?? null;
}

/* ─────────── 库内型式 → 表内哪一型 ─────────── */

export interface LibCover {
  /** 表内那一问由库内哪一条 CQ 承接。null＝库内没有这一问。 */
  cq: string | null;
  /**
   * cq 非空时写「库内那一问实际问的是什么」；cq 为空时**必须**写清
   * 「库内那几条问的是什么，没有一条问这个」——缺口要能被原文反驳，
   * 不能只写一句「没有」。
   */
  note: string;
}

export interface LibMap {
  /** 表内编号。null＝这一型式在十九型表外。 */
  no: number | null;
  /** 表内写映射依据；表外写为什么不在表内。两种都不许留空。 */
  why: string;
  /** 键是表内那一问的 no。表外为空对象。 */
  covers: Record<string, LibCover>;
}

/**
 * 本库 23 个型式的登记簿。每一条都要么指向表内一行，要么写明表外理由。
 *
 * 这不是「谁更好」的评价，是**逐问对表**：`cq` 只在这一问确实被库内某条问到时才填。
 * 凡是「问的是隔壁那件事」，一律填 null 并在 note 里把库内原话摆出来——
 * 把部分覆盖写成覆盖，读者就再也看不到那个缺口了。
 */
export const LIB_SCHEME_MAP: Record<string, LibMap> = {
  'example-to-generalization': {
    no: 1,
    why: '库内「从例子到概括」就是表内第 1 型例证。',
    covers: {
      '1': { cq: 'CQ2', note: '库内 CQ2 问「这些例子能代表 F 的总体吗」，说的是代表性。' },
      '2': { cq: null, note: '库内四条问属实、代表性、反例、强度；没有一条问数量够不够。' },
      '3': { cq: 'CQ3', note: '库内 CQ3 直接问「有无已知的反例」。' },
    },
  },
  analogy: {
    no: 2,
    why: '库内「类比论证」就是表内第 2 型类比。',
    covers: {
      '1': {
        cq: null,
        note: '库内三条问差异是否破坏相似性、两案中 A 是否都真、有无反例；没有一条问「相似点与所推属性是否相关」。',
      },
      '2': { cq: 'CQ1', note: '库内 CQ1 直接问「两案之间的差异会破坏相似性的力量吗」。' },
    },
  },
  'slippery-slope': {
    no: 3,
    why: '库内「滑坡论证」就是表内第 3 型滑坡。',
    covers: {
      '1': { cq: 'CQ2', note: '库内 CQ2 问「为使序列似真，必须补足哪些中间步骤」，问的是序列。' },
      '2': { cq: 'CQ1', note: '库内 CQ1 问「给了什么干涉建议（为什么停不下来）」，问的是驱动力。' },
      '3': {
        cq: null,
        note: '库内 CQ3 问「整条链上最弱的一环是哪一个」，问的是链上强度，不是有没有阻断机制。',
      },
    },
  },
  'negative-consequences': {
    no: 4,
    why: '库内「消极后果论证」就是表内第 4 型后果论证。',
    covers: {
      '1': { cq: 'CQ1', note: '库内 CQ1 问「该后果发生的机会、似真性有多大」，问的是概率。' },
      '2': { cq: null, note: '库内 CQ1 只问发生机会与似真性，不问后果有多严重。' },
      '3': {
        cq: null,
        note: '库内三条问机会、证据、相反价值后果；没有一条问「有没有更小代价的替代方案」。',
      },
    },
  },
  'expert-opinion': {
    no: 5,
    why: '库内「专家意见」就是表内第 5 型专家意见，且多出两问。',
    covers: {
      '1': { cq: 'CQ2', note: '库内 CQ2 直接问「他确实是该领域的专家吗」。' },
      '2': { cq: 'CQ5', note: '库内 CQ5 问「与其他专家的意见一致吗」，问的是领域内共识。' },
      '3': { cq: 'CQ4', note: '库内 CQ4 问「有无利益冲突、偏见」。' },
      '4': { cq: 'CQ6', note: '库内 CQ6 问原始来源与二手引证核实，覆盖「是否被引用方准确转述」。' },
    },
  },
  'ad-hominem-direct': {
    no: 6,
    why: '库内「针对人身·品性」就是表内第 6 型人身攻击。',
    covers: {
      '1': { cq: 'CQ2', note: '库内 CQ2 问「在这种对话类型里，品性相干吗」，问的是相关性。' },
    },
  },
  'appeal-to-ignorance': {
    no: 7,
    why: '库内「诉诸无知」就是表内第 7 型无知论证。',
    covers: {
      '1': { cq: 'CQ2', note: '库内 CQ2 直接问「哪一方负总体证明责任」。' },
      '2': { cq: 'CQ1', note: '库内 CQ1 问「搜索证据的工作进行了多远」，问的是调查是否穷尽。' },
      '3': {
        cq: null,
        note: '库内 CQ3 问「证明需要多强」，不直接问「未证真能否推出为假」。',
      },
    },
  },
  'correlation-causation': {
    no: 8,
    why: '库内「相关—因果」是表内第 8 型因果的一种写法：从相关推向因果。',
    covers: {
      '1': { cq: 'CQ1', note: '库内 CQ1 直接问「确实存在正相关吗」。' },
      '2': { cq: 'CQ2', note: '库内 CQ2 问「为何不只是同时发生」，覆盖时序与巧合。' },
      '3': { cq: 'CQ3', note: '库内 CQ3 问「有无既引起 A 又引起 B 的第三因素」，问的是混淆变量。' },
      '4': {
        cq: null,
        note: '库内三条问相关、同时发生、第三因素；没有一条问「机制是什么」。',
      },
    },
  },
  'cause-to-effect': {
    no: 8,
    why: '库内「从因到果」是表内第 8 型因果的另一种写法：已有因果概括，推结果。',
    covers: {
      '1': { cq: null, note: '库内这型从因果概括出发，不问两头是否只是相关。' },
      '2': { cq: null, note: '库内这型不问先后顺序，时序在它那里是前提而不是问题。' },
      '3': { cq: 'CQ3', note: '库内 CQ3 问「有无干预或抵消该结果的因素」，覆盖抵消与混淆。' },
      '4': { cq: null, note: '库内 CQ1 问概括有多强、CQ2 问证据够不够；没有一条问机制。' },
    },
  },
  'sign-to-event': {
    no: 9,
    why: '库内「从征兆到事件」就是表内第 9 型征兆。',
    covers: {
      '1': { cq: 'CQ1', note: '库内 CQ1 问「确实存在惯常联系吗」，问的是共变强度。' },
    },
  },
  'practical-basic': {
    no: 10,
    why: '库内「实践推理·基本型」就是表内第 10 型实践推理。',
    covers: {
      '1': {
        cq: null,
        note: '库内五条问冲突目标、替代手段、最有效、可行性、后果；「冲突目标」不等于「目标可欲」。',
      },
      '2': { cq: 'CQ3', note: '库内 CQ3 问「哪个手段最有效」，问的是手段有效性。' },
      '3': {
        cq: null,
        note: '库内 CQ2 问「另有手段能达到 G 吗」，问有没有别的办法，不问那个办法侵害是否更小。',
      },
    },
  },
  'practical-necessary': {
    no: 10,
    why: '库内「实践推理·必要条件型」是表内第 10 型的必要条件写法。',
    covers: {
      '1': {
        cq: null,
        note: '库内五条问另手段、最佳、可能、副作用、冲突目标；没有一条问目标是否可欲。',
      },
      '2': { cq: 'CQ2', note: '库内 CQ2 问「Bₖ 可接受、是最佳的吗」，覆盖手段是否最佳。' },
      '3': {
        cq: null,
        note: '库内 CQ1 问「除 Bₖ 之外另有手段吗」，问有没有，不问侵害大小。',
      },
    },
  },
  abduction: {
    no: 11,
    why: '库内「回溯（最佳说明推论）」就是表内第 11 型溯因。',
    covers: {
      '1': { cq: 'CQ2', note: '库内 CQ2 问「E 比其他假说好多少」，问的是竞争假说。' },
      '2': { cq: null, note: '库内 CQ2 只比「好多少」，不单列简洁性。' },
    },
  },
  'verbal-classification': {
    no: 12,
    why: '库内「语词归类」就是表内第 12 型归类。',
    covers: {
      '1': {
        cq: 'CQ2',
        note: '库内 CQ2 问「归类前提是否仅基于可疑或带偏见的定义」，覆盖定义是否可信。',
      },
      '2': { cq: null, note: '库内两条问相反证据与定义可疑；没有一条问边界案例怎么处理。' },
    },
  },

  /* ── 表外：十九型未收，不套用最低集，也不新造第 20 型 ── */

  'pragmatic-argumentation': {
    no: null,
    why: '实效论辩是语用辩证法的论证型式，十九型按 Walton 型式库方法整理，未收这一型。',
    covers: {},
  },
  'appeal-to-fear': {
    no: null,
    why: '恐惧诉求是情绪诉求，归 D-03 修辞审计，不是可废止推理型式。',
    covers: {},
  },
  'sunk-cost': {
    no: null,
    why: '沉没成本是谬误名，不是型式；十九型表是型式表，不是谬误表。',
    covers: {},
  },
  'position-to-know': {
    no: null,
    why: '知情地位型，十九型未收；最接近第 5 型专家意见，但那一型问专业性，这一型问知情位置。',
    covers: {},
  },
  'tu-quoque': {
    no: null,
    why: '「你也一样」是谬误名；最接近第 6 型人身攻击，但那一型问攻击点与真值是否相关，这一型问言行是否不一。',
    covers: {},
  },
  'popular-opinion': {
    no: null,
    why: '流行意见，十九型未收；它常作谬误处理，不作为独立型式。',
    covers: {},
  },
  'argument-from-commitment': {
    no: null,
    why: '承诺论证，十九型未收；它问的是承诺是否蕴含结论，与第 19 型的双向测试不是一回事。',
    covers: {},
  },
  'argument-from-precedent': {
    no: null,
    why: '先例论证，十九型未收；最接近第 14 型规则适用，但先例的约束力是另一个问题。',
    covers: {},
  },
  'two-wrongs': {
    no: null,
    why: '「两错相抵」是谬误名，不是型式。',
    covers: {},
  },
};

/* ─────────── 报告侧核对 ─────────── */

/** 三态读数。C-03 4.2：空白写未答；不适用须有协议依据、不计入分母。 */
export const ANSWER_LABEL: Record<CheckAnswer, string> = {
  passed: '过',
  violated: '不过',
  unanswered: '未答',
  'not-applicable': '不适用',
};

export interface CqAuditRow {
  cq: CanonicalCq;
  /** 库内承接这一问的 CQ。null＝库内没有这一问。 */
  cover: string | null;
  coverNote: string;
  /** 报告里那一条。null＝报告没有登记（库里有时才有这一种）。 */
  check: CheckItem | null;
  /** 这一行的缺口。空＝库里有、报告也登了。 */
  gap: 'library-gap' | 'report-unlisted' | null;
}

export interface SchemeCqAudit {
  schemeId: string;
  schemeName: string;
  /** 表内那一行。表外／未识别时为 null。 */
  row: SchemeCqRow | null;
  /** 表外或未识别的原因。表内时为 null。 */
  why: string | null;
  rows: CqAuditRow[];
  /** 报告里有、但不在任何一条表内问题上的 CQ（C-04 的「追加项」）。 */
  extra: CheckItem[];
  counts: {
    min: number;
    registered: number;
    libraryGap: number;
    unlisted: number;
    passed: number;
    violated: number;
    unanswered: number;
    na: number;
  };
}

/**
 * 核一份报告的型式—CQ 对表。
 *
 * 只对 walton 透镜有意义：其余五副透镜的检查项是规则与三问，不是型式 CQ。
 * 那些透镜返回 null，界面整块不出现——空面板会被读成「全过了」。
 */
export function auditSchemeCq(d: Diagnosis): SchemeCqAudit | null {
  if (d.lens.kind !== 'walton') return null;

  const { schemeId, schemeName } = d.lens;
  const checks = d.checks.filter((c) => /^CQ/i.test(c.id));
  const count = (pred: (c: CheckItem) => boolean): number => checks.filter(pred).length;

  const empty = {
    min: 0,
    registered: 0,
    libraryGap: 0,
    unlisted: 0,
    passed: count((c) => c.answer === 'passed'),
    violated: count((c) => c.answer === 'violated'),
    unanswered: count((c) => c.answer === 'unanswered'),
    na: count((c) => c.answer === 'not-applicable'),
  };

  if (schemeId === 'none') {
    return {
      schemeId,
      schemeName,
      row: null,
      why: '模型判「未识别型式」。型式没认出来，最低集无从取——这不是「无需过 CQ」。',
      rows: [],
      extra: [],
      counts: empty,
    };
  }

  const map = LIB_SCHEME_MAP[schemeId];
  if (!map) {
    return {
      schemeId,
      schemeName,
      row: null,
      why: `库内没有这个型式 id（${schemeId}），无法对表。`,
      rows: [],
      extra: [],
      counts: empty,
    };
  }

  if (map.no === null) {
    return {
      schemeId,
      schemeName,
      row: null,
      why: map.why,
      rows: [],
      extra: [],
      counts: empty,
    };
  }

  const row = tableRow(map.no);
  if (!row) {
    // 登记簿指向一个不存在的表内编号：这是代码错，不是报告错。宁可说出来。
    return {
      schemeId,
      schemeName,
      row: null,
      why: `登记簿把这一型指向表内第 ${map.no} 型，但表里没有这一型。`,
      rows: [],
      extra: [],
      counts: empty,
    };
  }

  const rows: CqAuditRow[] = row.cqs.map((cq) => {
    const cover = map.covers[String(cq.no)];
    if (!cover) {
      // 登记簿漏了一问。这与「库内没有」不同：那是登记的疏忽，不是库的边界。
      return { cq, cover: null, coverNote: '登记簿没有给这一问写覆盖情况。', check: null, gap: 'library-gap' as const };
    }
    const check = cover.cq ? (checks.find((c) => c.id === cover.cq) ?? null) : null;
    return {
      cq,
      cover: cover.cq,
      coverNote: cover.note,
      check,
      gap: cover.cq === null ? ('library-gap' as const) : check === null ? ('report-unlisted' as const) : null,
    };
  });

  const claimed = new Set(rows.map((r) => r.cover).filter((x): x is string => !!x));
  const extra = checks.filter((c) => !claimed.has(c.id));

  /*
   * 读数只数**最低集里那几问**。
   * 把表外追加项也数进来，卡片底部会出现「登记 3 · 过 1 · 不过 1 · 未答 2」——
   * 四个数加起来比登记数还多，读者会以为表格漏了一行。追加项自己单列。
   */
  const mapped = rows.map((r) => r.check).filter((c): c is CheckItem => c !== null);
  const tally = (a: CheckAnswer): number => mapped.filter((c) => c.answer === a).length;

  return {
    schemeId,
    schemeName,
    row,
    why: null,
    rows,
    extra,
    counts: {
      min: row.cqs.length,
      registered: mapped.length,
      libraryGap: rows.filter((r) => r.gap === 'library-gap').length,
      unlisted: rows.filter((r) => r.gap === 'report-unlisted').length,
      passed: tally('passed'),
      violated: tally('violated'),
      unanswered: tally('unanswered'),
      na: tally('not-applicable'),
    },
  };
}

/** 一句话账。界面的标题行与 Markdown 用同一句，不各写一份。 */
export function cqLine(a: SchemeCqAudit): string {
  if (!a.row) return a.why ?? '无法对表。';
  const parts = [
    `十九型第 ${a.row.no} 型·${a.row.name}`,
    `最低集 ${a.counts.min} 问：登记 ${a.counts.registered}`,
  ];
  if (a.counts.libraryGap) parts.push(`本库没有 ${a.counts.libraryGap}`);
  if (a.counts.unlisted) parts.push(`报告未登记 ${a.counts.unlisted}`);
  return parts.join('｜');
}

/**
 * 边界句。三件事必须同屏，因为这一栏最容易被读成「这段论证没答完」：
 * 表是检索工具不是判定机；本地只按编号对，不判这一问答得对不对；
 * 库内没有的那一问是库的边界，不是模型的错。
 */
export const SCHEME_CQ_BOUNDARY =
  '表是检索工具，不是判定机：查到某一型的 CQ，不等于这段文本就是该型。' +
  '本地按编号对表，不判这一问答得对不对；「本库没有」是库的边界，不是模型漏答。' +
  '表外型式不套用最低集，也不新造第 20 型。';

/** 表外与未识别也不许悄悄消失——它们各自有话说。 */
export const SCHEME_CQ_ISOLATION =
  '这一栏只核「题目问没问全」，不改档位、不改命题真假、不替模型补答。';
