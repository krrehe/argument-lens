import type { SchemeDefinition } from '@shared/types';

/**
 * 论证型式库 · 沃尔顿四族
 *
 * 出处：
 *   - 武宏志、周建武、唐坚《非形式逻辑导论》第 10—12 章（书内 p433–562），
 *     经《非形式逻辑导论_附录A_论证型式与批判性问题速查卡》整理；
 *   - 标 `Walton 2008` 的条目取自 Walton, Reed & Macagno, *Argumentation Schemes*
 *     的型式库（ch. 9–10），中文骨架按本应用的四族体系改写，未逐条对应原书页码——
 *     这一句是刻意写的：没有页码就是没有页码，不能拿「Walton 说的」当页码用。
 *
 * 三条必须守住的口径（同书「使用纪律」）：
 * 1. 型式不是标签，是「骨架 + 驳回清单」。每一个 CQ 都是该论证的一个潜在击败者。
 * 2. 型式被判出 ≠ 结论为假。只能说它未答某条 CQ。
 * 3. 削弱 ≠ 反驳。CQ 多数是削弱性击败，写成「结论为假」是越界。
 *
 * 每条 CQ 都带 `why`：这一问凭什么算合法攻击点。
 * 判据是「担保靠什么成立」——担保所依赖的那一环，提出者就得负责。
 * 写不出 why 的 CQ 是检查表上的空格，不是型式的一部分，应当删掉。
 */
const SRC = '武宏志《非形式逻辑导论》';

export const SCHEMES: SchemeDefinition[] = [
  /* ═══════════ 实效族 pragmatic ═══════════ */
  {
    id: 'practical-basic',
    name: '实践推理·基本型',
    nameEn: 'practical reasoning (basic)',
    family: 'pragmatic',
    skeleton: '有目标 G；做 A 是达 G 的手段 → 我（们）应做 A',
    cues: ['应该', '应当', '必须', '为了', '才能', '否则', '唯有', '别无他法', '代价', '成本', '划得来'],
    criticalQuestions: [
      {
        id: 'CQ1',
        meta: true,
        question: '是否存在与之冲突的目标？',
        guards: '目标本身的优先性',
        why: '结论是「该做」，而「该做」永远相对于某个目标。目标之间若有冲突，选 A 就没有规范力量——这一问先于手段是否有效。',
      },
      {
        id: 'CQ2',
        question: '另有手段能达到 G 吗？',
        guards: '手段的排他性',
        why: '结论断言的是「应做 A」，不是「A 能达 G」。能达 G 的手段不止一个时，A 的可选性没有被建立。',
      },
      {
        id: 'CQ3',
        question: '哪个手段最有效？',
        guards: '效率比较',
        why: '实践推理的担保是「以最小代价达 G」。不比代价，等于没做这条推理该做的事。',
      },
      {
        id: 'CQ4',
        question: '实践上可行吗？',
        guards: '可行性',
        why: '「该做」蕴含「能做」。做不到的事，其手段地位是空的。',
      },
      {
        id: 'CQ5',
        question: '有何种后果须一并考虑？',
        guards: '副作用',
        why: '达 G 的同时会改变其他目标的实现条件。只算收益不算副作用，是把目标集偷偷缩小了。',
      },
    ],
    commonMisuse: [
      { form: '只比一个方案就断言「最佳」，不问其他手段与冲突目标', landsOn: '虚假二难 / 不充分论证' },
      { form: '语境是经验陈述却套用实效论辩', landsOn: '实效论辩元问题答否（后问全免）' },
    ],
    inapplicableWhen: [
      '元问题：此语境用实效论证恰当吗。若当前争的是事实真假而非该做什么，实效族整体不适用，答否则后续 CQ 全部免除。',
    ],
    source: `${SRC} p539–540`,
  },
  {
    id: 'practical-necessary',
    name: '实践推理·必要条件型',
    nameEn: 'practical reasoning (necessary condition)',
    family: 'pragmatic',
    skeleton:
      '目标产生 A；B₁…Bₙ 中某者对 A 必要；选 Bₖ；无不可改变者阻止；副作用可接受 → 必须产生 Bₖ',
    cues: ['前提是', '必须先', '缺了就不行', '非……不可', '唯一办法'],
    criticalQuestions: [
      {
        id: 'CQ1',
        question: '除 Bₖ 之外另有手段吗？',
        guards: '必要性判断',
        why: '整条推理的力量全在「必要」二字上。另有手段，必要性前提即为假——这不是削弱，是前提被推翻。',
      },
      {
        id: 'CQ2',
        question: 'Bₖ 可接受、是最佳的吗？',
        guards: '可接受性与比较',
        why: '「必须做」要求在所有可行手段里选中的这个不至于坏到不该做。必要性只解决了「有没有别的路」，没解决「这条路值不值得走」。',
      },
      {
        id: 'CQ3',
        question: '做 Bₖ 在实践上可能吗？',
        guards: '可行性',
        why: '必要条件若在实践中无法满足，结论「必须产生 Bₖ」就变成一个无法执行的指令。',
      },
      {
        id: 'CQ4',
        question: '有无否定性副作用？',
        guards: '副作用',
        why: '必要条件型的结论往往很硬（非此不可），副作用若大到抵消目标，硬结论反而更危险。',
      },
      {
        id: 'CQ5',
        meta: true,
        question: '有无冲突目标？',
        guards: '目标优先性',
        why: '「必要」只相对于当前目标成立。存在更高优先的目标时，这条必要性不构成行动理由。',
      },
    ],
    commonMisuse: [
      { form: '把「常见手段」说成「必要条件」', landsOn: '虚假二难 / 不充分论证' },
    ],
    inapplicableWhen: ['争点不是行动选择而是事实判断时。'],
    source: `${SRC} p540–541`,
  },
  {
    id: 'negative-consequences',
    name: '消极后果论证',
    nameEn: 'argument from negative consequences',
    family: 'pragmatic',
    skeleton: '若 A 被做，则坏后果很可能出现 → A 不应被做',
    cues: ['会导致', '后果', '一旦', '到时候', '不堪设想', '毁掉', '风险太大'],
    criticalQuestions: [
      {
        id: 'CQ1',
        question: '该后果发生的机会、似真性有多大？',
        guards: '后果发生概率',
        why: '结论「不应做 A」的分量取决于后果的实际可能性。概率未定时，结论只能到「有风险」，不能到「不应」。',
      },
      {
        id: 'CQ2',
        question: '有何证据支持「若 A 则此后果」？',
        guards: '因果联结',
        why: '这条推理的担保是因果联结。联结本身若无据，后果再可怕也与 A 无关。',
      },
      {
        id: 'CQ3',
        question: '有无与之相反的价值后果？',
        guards: '正负权衡',
        why: '「不应做」是权衡结论，只列一边的账不构成权衡。',
      },
    ],
    commonMisuse: [
      { form: '只描述后果的可怕，不给发生概率', landsOn: '诉求恐怖 / 滑坡' },
      { form: '把「可能」写成「将会」', landsOn: '结论模态过头' },
    ],
    inapplicableWhen: ['结论本身是评价性的、不涉及后果时。'],
    source: `${SRC} p542`,
  },
  {
    id: 'pragmatic-argumentation',
    name: '实效论辩',
    nameEn: 'pragmatic argumentation',
    family: 'pragmatic',
    skeleton: 'X 合意，因为 X 导致 Y 且 Y 合意（隐含：若 X 导致 Y 且 Y 合意，则 X 合意）',
    cues: ['有用', '有效', '好处是', '能带来', '划算', '值得'],
    criticalQuestions: [
      {
        id: 'CQ0',
        meta: true,
        question: '此语境用实效论辩恰当吗？',
        guards: '型式适用性',
        why: '实效论辩把「好不好」化归为「有没有用」。当争点本身就是价值（该不该、公不公）时，这个化归是范畴错误，而非论证不充分。',
      },
      {
        id: 'CQ1',
        question: 'Y 本身合意吗？',
        guards: '目的的可接受性',
        why: '手段的正当性来自目的的正当性。目的未获辩护时，整条推理只是把问题往后推了一步。',
      },
      {
        id: 'CQ2',
        question: 'X 确实导致 Y 吗？',
        guards: '因果联结',
        why: '这条推理的担保是因果。联结不成立，「有用」这一评价就落空了。',
      },
    ],
    commonMisuse: [
      { form: '只证明有用，未证明目的本身值得', landsOn: '不充分论证' },
    ],
    inapplicableWhen: ['元问题答否（论点纯属经验陈述）时，后续 CQ 全部免除。'],
    source: `${SRC} p543`,
  },
  {
    id: 'appeal-to-fear',
    name: '恐惧诉求',
    nameEn: 'argument from threat / appeal to fear (ad baculum)',
    family: 'pragmatic',
    skeleton: '若不做 A，将有坏结果 B；B 极坏 → 必须做 A',
    cues: ['否则就', '你将失去', '后果自负', '别怪我不客气', '到时候哭都来不及', '再不做就完了'],
    criticalQuestions: [
      {
        id: 'CQ1',
        question: '所说的坏结果确实会发生吗？',
        guards: '威胁的现实性',
        why: '威胁的全部力量在「会发生」。如果它只是说话人的意愿而非事实走向，这条推理就退化成人身胁迫。',
      },
      {
        id: 'CQ2',
        question: '做 A 真的能避免 B 吗？',
        guards: '手段的有效性',
        why: '这是实效推理：A 必须是避 B 的手段。手段与结果无因果时，服从威胁换不来安全。',
      },
      {
        id: 'CQ3',
        question: '威胁是说话人自己造成的吗？',
        guards: '威胁来源',
        why: '若 B 由说话人制造，那么「做 A」实际是向胁迫让步，而不是避害——两者的规范地位完全不同。',
      },
      {
        id: 'CQ4',
        meta: true,
        question: '这种对话类型里，以坏结果施压是正当的吗？',
        guards: '对话类型的相干性',
        why: '谈判、劳资协商里明示后果是正常的；学术探究、司法说理里则是规则违反（语用辩证第 1 条自由规则）。同一句话换个场合就换性质。',
      },
    ],
    commonMisuse: [
      { form: '只在威胁上做文章，不回答「A 是否真能避害」', landsOn: '诉诸恐惧' },
      { form: '把说话人的报复意愿说成客观必然', landsOn: '诉诸恐惧 / 诉诸人身（情境型）' },
    ],
    inapplicableWhen: [
      '对方确实掌握决定权、且明示后果属于程序正义的一部分时（如法官告知刑罚），不构成谬误。判「诉诸恐惧」前必须先过 CQ4。',
    ],
    source: 'Walton 2008（appeal to fear / ad baculum）；语用辩证第 1 条自由规则的适用边界见 SEP, Informal Logic',
  },
  {
    id: 'sunk-cost',
    name: '沉没成本',
    nameEn: 'argument from waste / sunk cost',
    family: 'pragmatic',
    skeleton: '已为 A 投入大量资源；放弃则投入白费 → 应继续 A',
    cues: ['已经投了这么多', '不能半途而废', '前面都白干了', '都到这一步了', '回不了头'],
    criticalQuestions: [
      {
        id: 'CQ1',
        question: '已投入的资源确实无法回收吗？',
        guards: '沉没性',
        why: '只有沉没的成本才不该进入决策。若投入可回收、可转用，它仍是相干理由——这一问决定了整条推理成不成立。',
      },
      {
        id: 'CQ2',
        question: '过去的投入能改变 A 未来的收益吗？',
        guards: '相关性的方向',
        why: '决策只看未来的边际收益。过去的花费不改变未来的账，这是沉没成本论证的核心错误所在。',
      },
      {
        id: 'CQ3',
        question: '除了「不白费」，还有别的理由继续吗？',
        guards: '独立理由的存在',
        why: '若另有独立理由，结论可能对，但这条推理仍然无效——对的结论配错的理由，是最容易被沿用下去的错误。',
      },
    ],
    commonMisuse: [
      { form: '把「不甘心」包装成「坚持」', landsOn: '沉没成本谬误' },
      { form: '用「都到这一步了」代替对未来的判断', landsOn: '沉没成本谬误 / 不充分论证' },
    ],
    inapplicableWhen: [
      '承诺与信誉本身是未来收益时（退出会损害可信度），过去的行为确实进入未来的账，此时不构成谬误。',
    ],
    source: 'Walton 2008（argument from waste）',
  },

  /* ═══════════ 因果族 causal ═══════════ */
  {
    id: 'cause-to-effect',
    name: '从因到果',
    nameEn: 'argument from cause to effect',
    family: 'causal',
    skeleton: '一般地若 A 则 B；此情形 A → 此情形 B',
    cues: ['导致', '引起', '造成', '使得', '所以会', '因此必然'],
    criticalQuestions: [
      {
        id: 'CQ1',
        question: '该因果概括有多强？',
        guards: '概括强度',
        why: '整条推理架在这条概括上。概括若只是「有时」，结论就不能是「必然」——这一问先定模态，再谈真假。',
      },
      {
        id: 'CQ2',
        question: '所引证据足以担保该概括吗？',
        guards: '证据充分性',
        why: '概括本身也是断言，也需要支撑。用个案撑普遍概括，是把结论当前提。',
      },
      {
        id: 'CQ3',
        question: '有无干预或抵消该结果的因素？',
        guards: '干扰变量',
        why: '因果概括是可废止的：它成立的前提是「其他条件均同」。这一问检验的正是这个未说出的前提。',
      },
    ],
    commonMisuse: [
      { form: '以单一个案支撑普遍因果概括', landsOn: '仓促结论 / 可疑原因' },
      { form: '忽略抵消因素', landsOn: '忽视限制' },
    ],
    inapplicableWhen: ['相关性证据不足，只能谈相关不能谈因果时。'],
    source: `${SRC} p545`,
  },
  {
    id: 'correlation-causation',
    name: '相关—因果',
    nameEn: 'argument from correlation to cause',
    family: 'causal',
    skeleton: 'A 与 B 正相关 → A 引起 B',
    cues: ['与此相关', '同时发生', '数据显示', '越……越……', '伴随'],
    criticalQuestions: [
      {
        id: 'CQ1',
        question: '确实存在正相关吗？',
        guards: '相关性事实',
        why: '相关性是这条推理唯一的事实基础。基础若不实，后面一切讨论没有对象。',
      },
      {
        id: 'CQ2',
        question: '为何不只是同时发生？',
        guards: '因果方向',
        why: '相关本身不含方向。没有时序或机制证据时，「A 引起 B」与「B 引起 A」证据地位相同。',
      },
      {
        id: 'CQ3',
        question: '有无既引起 A 又引起 B 的第三因素？',
        guards: '共同原因',
        why: '共同原因是相关—因果最常见的失效方式。不排查它就断言因果，等于默认了「无第三因素」这个未说出的前提。',
      },
    ],
    commonMisuse: [
      { form: '把相关直接当因果', landsOn: '非因为因 / 虚假原因' },
      { form: '不排查共同原因', landsOn: '可疑原因' },
    ],
    inapplicableWhen: ['仅有横断面数据、无时序信息时，因果方向无法确定。'],
    source: `${SRC} p545–546`,
  },
  {
    id: 'abduction',
    name: '回溯（最佳说明推论）',
    nameEn: 'abductive argument',
    family: 'causal',
    skeleton: 'F 为事实集；E 是 F 的满意说明；迄今无别的说明如 E 满意 → E 作为假说似真',
    cues: ['最可能的解释是', '只能解释为', '合理的解释', '否则无法说明'],
    criticalQuestions: [
      {
        id: 'CQ1',
        question: 'E 本身有多满意？',
        guards: '说明力',
        why: '回溯的担保是「说明力」，不是有效性。按演绎标准衡量它（如指其「肯定后件」）是拿错尺子——这是演绎沙文主义的典型现场。',
      },
      {
        id: 'CQ2',
        question: 'E 比其他假说好多少？',
        guards: '比较优势',
        why: '「最佳」是比出来的。没有比较对象，「最佳」只是一个未兑现的断言。',
      },
      {
        id: 'CQ3',
        question: '搜索走了多远、有多彻底？',
        guards: '替代假说的穷尽度',
        why: '结论里的「迄今无别的说明」是一条关于搜索行为的断言，它必须由提出者负责——搜得不深，这句话就是假的。',
      },
      {
        id: 'CQ4',
        question: '是否宜继续查下去？',
        guards: '结论的暂定性质',
        why: '回溯结论天然是暂定的。这一问守的是模态：写成「已证明」就把可废止的结论说成了终局。',
      },
    ],
    commonMisuse: [
      { form: '未比较其他假说即断言「唯一解释」', landsOn: '虚假二难 / 不充分论证' },
      { form: '把「目前最佳」写成「已证明」', landsOn: '结论模态过头' },
    ],
    inapplicableWhen: ['已存在同等或更优的竞争说明时，回溯不成立。'],
    source: `${SRC} p546–547`,
  },
  {
    id: 'slippery-slope',
    name: '滑坡论证',
    nameEn: 'slippery slope',
    family: 'causal',
    skeleton: '初看似应做的 A₀；做 A₀ 将经 A₁…Aₙ 致 Aₙ；Aₙ 灾难性 → A₀ 不应做',
    cues: ['一旦', '下一步就是', '开了这个口子', '接着就会', '最终将', '迟早'],
    criticalQuestions: [
      {
        id: 'CQ1',
        question: '在 A₀ 与 A₁ 之间，给了什么干涉建议（为什么停不下来）？',
        guards: '链条起点',
        why: '滑坡的核心断言是「刹不住」。说不出为什么刹不住，第一步就没有迈出去的理由。',
      },
      {
        id: 'CQ2',
        question: '为使序列似真，必须补足哪些中间步骤？',
        guards: '链条完整性',
        why: '缺环的链条不是链条。补环的责任在提出者，因为这些环节正是他省略掉的隐含前提。',
      },
      {
        id: 'CQ3',
        question: '整条链上最弱的一环是哪一个？',
        guards: '链条强度',
        why: '链条强度等于最弱环。这一问把「笼统否定」改造成「定点打击」——只攻一环是全链唯一的合法打法。',
      },
    ],
    commonMisuse: [
      { form: '不补中间环节，直接从第一步跳到灾难结局', landsOn: '滑坡' },
      { form: '不指出最弱联结，笼统说「会一路滑下去」', landsOn: '不充分论证' },
      { form: '把「可能」说成「必然」', landsOn: '结论模态过头' },
    ],
    inapplicableWhen: [
      '链条中间环节有制度性阻断（有刹车机制）时，滑坡不成立。',
      '只能攻最弱一环，不能笼统否定整条链。',
    ],
    source: `${SRC} p548–549`,
  },
  {
    id: 'sign-to-event',
    name: '从征兆到事件',
    nameEn: 'argument from sign',
    family: 'causal',
    skeleton: 'A 在眼前成立（征兆）；B 通常伴随 A → B 成立（或曾发生）',
    cues: ['说明', '可见', '迹象表明', '从……看', '明显是', '一看就知道'],
    criticalQuestions: [
      {
        id: 'CQ1',
        question: '这个征兆与所推事件之间，确实存在惯常联系吗？',
        guards: '征兆关系的成立',
        why: '征兆推理的担保是「A 通常伴随 B」。这条惯常联系若只是印象，整条推理没有支点。',
      },
      {
        id: 'CQ2',
        question: '有无其他事件同样能产生这个征兆？',
        guards: '征兆的非唯一性',
        why: '征兆是多对一的：同一个迹象可能由多种原因造成。不排除其他来源，就不能反推。',
      },
      {
        id: 'CQ3',
        question: '还有别的、指向同一结论的征兆吗？',
        guards: '征兆的汇聚度',
        why: '单个征兆只能给出弱结论。多个独立征兆汇合才提高可信度——这一问决定结论能到哪一档模态。',
      },
    ],
    commonMisuse: [
      { form: '由单一迹象断言事件发生', landsOn: '仓促结论' },
      { form: '把「像」直接当「是」', landsOn: '可疑原因' },
    ],
    inapplicableWhen: [
      '征兆与事件之间存在定义性联系（不是因果而是构成）时，应改为语词归类，而不是征兆推理。',
    ],
    source: 'Walton 2008（argument from sign）',
  },
  {
    id: 'example-to-generalization',
    name: '从例子到概括',
    nameEn: 'argument from example / inductive generalization',
    family: 'causal',
    skeleton: 'a₁…aₙ 是 F 且都是 G → 一般地，F 都是 G',
    cues: ['我发现', '我认识的人', '有个例子', '据统计', '身边都是', '无一例外'],
    criticalQuestions: [
      {
        id: 'CQ1',
        question: '所举例子本身属实吗？',
        guards: '例子的真实性',
        why: '概括的全部证据就是这些例子。例子不实，样本量为零，而结论照旧被说了出来。',
      },
      {
        id: 'CQ2',
        question: '这些例子能代表 F 的总体吗？',
        guards: '样本代表性',
        why: '归纳税的三件事：样本量、抽样方式、是否有选择偏差。这一问守的是抽样的合法性，不是例子多少。',
      },
      {
        id: 'CQ3',
        question: '有无已知的反例？',
        guards: '反例的排除',
        why: '「一般地」允许例外，但反例若集中在某个子类，概括就得加上限定条件——这是把结论改对，而不是把它驳倒。',
      },
      {
        id: 'CQ4',
        question: '结论的强度与样本匹配吗？',
        guards: '结论的模态',
        why: '三个人的观察撑不起「所有」。这一问不判真假，判的是「一般地／多数／所有」这些词有没有超额。',
      },
    ],
    commonMisuse: [
      { form: '以身边几例断言普遍规律', landsOn: '仓促概括 / 以偏概全' },
      { form: '忽略已知反例继续维持全称结论', landsOn: '仓促概括 / 隐瞒证据' },
    ],
    inapplicableWhen: [
      '结论本身只是「存在这样的例子」（特称），此时不需要概括，这条型式不适用。',
    ],
    source: 'Walton 2008（argument from example）；归纳评估的三问见 SEP, Argument and Argumentation §2.2',
  },

  /* ═══════════ 信息源族 source-based ═══════════ */
  {
    id: 'expert-opinion',
    name: '专家意见',
    nameEn: 'argument from expert opinion',
    family: 'source',
    skeleton: 'E 是 D 领域专家；E 断定（D 内）A 真（假）→ A 可似真地当作真（假）',
    cues: ['专家', '研究表明', '教授说', '权威', '业内认为', '据……透露', '诺贝尔奖得主'],
    criticalQuestions: [
      {
        id: 'CQ1',
        question: '专家来源本身如何可信？',
        guards: '来源可及性',
        why: '证言的担保链从「我能识别出这是谁」开始。来源不可核实时，后面五问都无处落地。',
      },
      {
        id: 'CQ2',
        question: '他确实是该领域的专家吗？',
        guards: '领域相关性',
        why: '专家的权威是领域内的。跨出领域，他的断言与普通人无异——这一问守的是权威的边界。',
      },
      {
        id: 'CQ3',
        question: '他所断定的确实意味着 A 吗？',
        guards: '引述忠实度',
        why: '从「他说了 P」到「A 成立」中间有一次转述。转述失真时，被驳倒的是转述者，不是专家。',
      },
      {
        id: 'CQ4',
        question: '他本人可靠吗（有无利益冲突、偏见）？',
        guards: '可信性',
        why: '证言的担保来自说话者本人，所以说话者的动机与偏见是这条链上的一环，可以被质疑。',
      },
      {
        id: 'CQ5',
        question: '与其他专家的意见一致吗？',
        guards: '共识度',
        why: '科学共同体的分布本身就是证据。孤例与共识的证据地位不同，这一问要求把分布写出来。',
      },
      {
        id: 'CQ6',
        question: '其判断基于证据吗（原始来源？二手引证核实否？关键信息遗漏否？）',
        guards: '证据基础',
        why: '专家意见的最终担保仍是证据。权威不能替代证据，只能代替「我暂时无法亲自检验」。',
      },
    ],
    commonMisuse: [
      { form: '跨领域引证（物理学家的政治判断）', landsOn: '诉诸权威（错置权威）' },
      { form: '二手引证未核实', landsOn: '诉诸权威' },
      { form: '专家间有分歧仍独断', landsOn: '诉诸权威 / 隐瞒证据' },
      { form: '以「据专家……」掩盖未具名来源', landsOn: '诉诸权威' },
    ],
    inapplicableWhen: [
      '领域相关、无利益冲突、代表共识时，引用专家不构成谬误。把这种情形判为「诉诸权威」本身就是误判。',
      '注意区分「降低可信度的正当理由」与「因身份扣分」：前者指利益冲突、专业不对口、转述失真这些具体条件；后者指性别、出身、口音、职业等身份特征。只有前者是这条论证的缺陷。',
    ],
    source: `${SRC} p550–551；身份与可信度的区分见 Fricker, Epistemic Injustice (2007), p.28`,
  },
  {
    id: 'position-to-know',
    name: '知情地位',
    nameEn: 'argument from position to know',
    family: 'source',
    skeleton: 'α 处于知道 A 真假的地位；α 断定 A 真（假）→ A 真（假）',
    cues: ['我当时在场', '我亲眼', '内部人士', '亲自经历', '我做过'],
    criticalQuestions: [
      {
        id: 'CQ1',
        question: 'α 确实处于知道该事的地位吗？',
        guards: '知情条件',
        why: '整条推理的担保是「他在那个位置，所以他知道」。位置不成立，证言就只是转述或猜测。',
      },
      {
        id: 'CQ2',
        question: 'α 诚实可信吗？',
        guards: '诚实性',
        why: '知情只保证「能知道」，不保证「会说真话」。两者是独立的失效点。',
      },
      {
        id: 'CQ3',
        question: 'α 确实断定了 A 吗？',
        guards: '引述准确性',
        why: '从「他说过」到「他断定了 A」之间有一次解释。这一步出错时，被驳倒的是解释者。',
      },
    ],
    commonMisuse: [
      { form: '把「有渠道接触」当成「掌握实情」', landsOn: '诉诸权威' },
    ],
    inapplicableWhen: ['该事属于可公共检验的领域、无需知情地位时。'],
    source: `${SRC} p549–550`,
  },
  {
    id: 'ad-hominem-direct',
    name: '针对人身·品性',
    nameEn: 'direct ad hominem (abusive)',
    family: 'source',
    skeleton: 'α 是有坏品性的人 → α 的论证不应被接受',
    cues: ['你算什么东西', '就你这人品', '他什么货色', '骗子说的话', '劣迹斑斑'],
    criticalQuestions: [
      {
        id: 'CQ1',
        question: '关于品性的断言证据充分吗？',
        guards: '品性断言的事实基础',
        why: '品性断言本身也是一个断言，也要证据。无据的品性指责，连「可信度降低」这一步都走不到。',
      },
      {
        id: 'CQ2',
        meta: true,
        question: '在这种对话类型里，品性相干吗？',
        guards: '相干性',
        why: '品性是否相干取决于语境：证人可信性、竞选、谈判里相干；科学探究、政策论证里不相干。这是元问题，答否则后面全免。',
      },
      {
        id: 'CQ3',
        question: '是绝对拒斥，还是仅降低可信力？',
        guards: '结论强度',
        why: '即便品性相干，它能得到的上限也只是「此人的话要打折」，推不出「他的话为假」，更推不出「他的结论为假」。',
      },
      {
        id: 'CQ4',
        meta: true,
        question: '降低可信度的理由，针对的是这条证言的具体条件，还是说话者的身份？',
        guards: '证言不正义的边界',
        why: 'Fricker 的证言不正义：因身份偏见而扣可信度，缺陷在听者而不在论证。具体条件（利益冲突、专业不对口、转述失真）可质疑；身份特征（性别、出身、口音、职业）不可。这一问把「可批评的推理」与「不可接受的偏见」分开——判错这一问，软件自己就在制造偏见。',
      },
    ],
    commonMisuse: [
      { form: '在品性不相干的对话里用品性', landsOn: '针对人身' },
      { form: '由「降低可信力」越级断言「结论为假」', landsOn: '针对人身（越界）' },
      { form: '因说话者的身份而非其理由降低可信度', landsOn: '不是论证缺陷，是证言不正义（听者的错）' },
    ],
    inapplicableWhen: [
      '品性在科学探究中不相干，在竞选论辩、证人可信性判断中相干。',
      '即便相干，针对人身族「一律只能得降低可信力」，不能推出结论为假。',
      '若降低可信度的唯一依据是身份特征，则本型式不成立：这里没有论证缺陷，只有听者偏见。',
    ],
    source: `${SRC} p556–557；证言不正义见 Fricker (2007), p.28「identity-prejudicial credibility deficit」`,
  },
  {
    id: 'tu-quoque',
    name: '你也一样',
    nameEn: 'ad hominem circumstantial / tu quoque',
    family: 'source',
    skeleton: 'α 自己也没做到所主张的事 → α 的主张不可接受',
    cues: ['你自己不也', '你有什么资格说', '你还不是一样', '先管好你自己'],
    criticalQuestions: [
      {
        id: 'CQ1',
        question: 'α 确实做了（或主张了）与之矛盾的事吗？',
        guards: '不一致的事实',
        why: '这一问先检验指控本身的事实基础。不一致若不存在，整条推理没有对象。',
      },
      {
        id: 'CQ2',
        question: '这种不一致与当前主张的真假有关吗？',
        guards: '相干性',
        why: '主张的真假不取决于提出者是否践行。除非争的正是「他有无资格」，否则这是把话题从命题转到人。',
      },
      {
        id: 'CQ3',
        question: '它是否掩盖了原本要回答的问题？',
        guards: '话题的转移',
        why: '「你也一样」的实效在于换话题。指出这一点，是把讨论拉回原问题——这是本型式唯一站得住的用法，属于指出程序违规，不是反驳结论。',
      },
    ],
    commonMisuse: [
      { form: '以对方的虚伪代替对其主张的回应', landsOn: '你也一样 / 针对人身' },
      { form: '在「资格」确实相干的场合（如道德说教者自身行为）误判为谬误', landsOn: '（反方向的误判）' },
    ],
    inapplicableWhen: [
      '当争论点正是「谁有资格说」时（如举报者自身亦涉案），不一致是相干的。',
    ],
    source: 'Walton 2008（ad hominem: circumstantial / tu quoque）',
  },
  {
    id: 'appeal-to-ignorance',
    name: '诉诸无知',
    nameEn: 'argument from ignorance',
    family: 'source',
    skeleton: '若 A 真则 A 会被知道为真；A 不被知道为真 → A（假设性地）是假的',
    cues: ['没人能证明', '你拿不出证据', '至今没有发现', '科学也没法解释', '查不到'],
    criticalQuestions: [
      {
        id: 'CQ1',
        question: '搜索证据的工作进行了多远？',
        guards: '搜索充分性',
        why: '这条推理的隐含前提是「该找的都找过了」。搜索若浅，「没找到」不构成任何证据。',
      },
      {
        id: 'CQ2',
        question: '哪一方负总体证明责任？',
        guards: '举证分配',
        why: '「没证据」只在举证方身上才算失败。责任分配没定，这条推理连攻击对象都没有。',
      },
      {
        id: 'CQ3',
        question: '证明需要多强？',
        guards: '证明标准',
        why: '证明标准决定「找到多少算找到」。标准未定时，「没找到」这句话没有确定含义。',
      },
    ],
    commonMisuse: [
      { form: '把「未被知道为真」直接当作假', landsOn: '诉诸无知' },
      { form: '不问谁负总体证明责任', landsOn: '转移举证责任' },
    ],
    inapplicableWhen: [
      '当一方本应负举证责任却以「你证明不了我错」脱身时，问题在举证责任错置，而不在无知型式本身。',
    ],
    source: `${SRC} p554–555`,
  },
  {
    id: 'popular-opinion',
    name: '流行意见',
    nameEn: 'argument from popular opinion',
    family: 'source',
    skeleton: 'A 被普遍当作真接受 → 存在有利于 A 的假设',
    cues: ['大家都', '众所周知', '多数人认为', '民意', '网上都说', '常识'],
    criticalQuestions: [
      {
        id: 'CQ1',
        question: '有何证据支持「被普遍接受」？',
        guards: '流行度的事实基础',
        why: '这条推理的第一个前提是一条经验断言。「大家都」若无据，整条推理从第一步就空了。',
      },
      {
        id: 'CQ2',
        question: '即便普遍接受，有无怀疑它为真的理由？',
        guards: '真值与流行度的分离',
        why: '流行度只给出「值得考虑」，不给出「为真」。这一问守的正是这两者之间的那道界线。',
      },
    ],
    commonMisuse: [
      { form: '以流行代替理由', landsOn: '诉诸公众' },
      { form: '以群体行为代替论证', landsOn: '诉诸公众 / 惯例' },
    ],
    inapplicableWhen: ['议题属于趣味、惯例、约定俗成时，流行度可以是相干理由。'],
    source: `${SRC} p553–554`,
  },
  {
    id: 'argument-from-commitment',
    name: '承诺论证',
    nameEn: 'argument from commitment',
    family: 'source',
    skeleton: 'α 已承诺 P；P 蕴含（或要求）Q → α 应接受 Q',
    cues: ['你刚才还说', '你自己承认过', '按你的说法', '你一向主张'],
    criticalQuestions: [
      {
        id: 'CQ1',
        question: 'α 确实作出过该承诺吗？',
        guards: '承诺的事实',
        why: '这条推理的全部依据是「他说过」。事实不成立，后面的蕴含讨论没有意义。',
      },
      {
        id: 'CQ2',
        question: '该承诺确实蕴含 Q 吗？',
        guards: '蕴含关系',
        why: '从承诺到 Q 是一次推理，不是一次引用。蕴含不成立时，被反驳的是这条推理，不是 α。',
      },
      {
        id: 'CQ3',
        meta: true,
        question: '此语境允许改变立场吗？',
        guards: '立场变更的正当性',
        why: '探究与说服允许改主意，承诺的约束力弱；谈判与法律承诺里则强。不分辨语境，会把「学习」判成「自相矛盾」。',
      },
    ],
    commonMisuse: [
      { form: '把对方的一时表述当成终身承诺', landsOn: '稻草人 / 承诺论证误用' },
      { form: '揪住前后表述差异，不回应实质主张', landsOn: '你也一样 / 转移话题' },
    ],
    inapplicableWhen: ['对方已明示撤回或修正立场时，旧的承诺不再构成约束。'],
    source: 'Walton 2008（argument from commitment）',
  },

  /* ═══════════ 比较族 comparison ═══════════ */
  {
    id: 'analogy',
    name: '类比论证',
    nameEn: 'argument from analogy',
    family: 'comparison',
    skeleton: '一般地 C 类似 C₂；A 在 C 中真（假）→ A 在 C₂ 中真（假）',
    cues: ['就像', '如同', '好比', '和……一样', '相当于', '无异于'],
    criticalQuestions: [
      {
        id: 'CQ1',
        question: '两案之间的差异会破坏相似性的力量吗？',
        guards: '差异的相关性',
        why: '类比的担保是「相似点在相干维度上」。差异若不落在相干维度，它不构成反驳；落上了，相似性就失效。',
      },
      {
        id: 'CQ2',
        question: 'A 在 C 中确实真（假）吗？',
        guards: '源案例的事实',
        why: '源案例是这条推理的前提。前提本身错了，类比再工整也推不出东西。',
      },
      {
        id: 'CQ3',
        question: '有无 C₃ 同样相似、而 A 在其中为假的案例？',
        guards: '反类比',
        why: '反类比是类比推理特有的检验：它不否定相似性，而是否定「相似性能决定结论」。',
      },
    ],
    commonMisuse: [
      { form: '只举相似点，不问差异是否影响相似性判断', landsOn: '弱类比 / 错误类比' },
      { form: '拿不重要的差异当反例', landsOn: '（反方向的误判）' },
    ],
    inapplicableWhen: [
      '判据不是「有没有差异」，而是「这种差异是否影响对相似性的判断」。任何两案都有差异，指出差异本身不构成反驳。',
    ],
    source: `${SRC} p558–560`,
  },
  {
    id: 'argument-from-precedent',
    name: '先例论证',
    nameEn: 'argument from precedent',
    family: 'comparison',
    skeleton: '过去对 C 案的处理是 D；今案 C′ 与 C 相似 → 今案也应作 D 处理',
    cues: ['以前都是这么办的', '有先例', '照惯例', '上次也是', '历来解决为'],
    criticalQuestions: [
      {
        id: 'CQ1',
        question: '先例与今案在相干特征上相似吗？',
        guards: '相似性的相干维度',
        why: '先例的约束力来自「同类同判」。相似点若不落在判决理由所依赖的特征上，援引先例只是形式上的模仿。',
      },
      {
        id: 'CQ2',
        question: '先例本身的处理是正当的吗？',
        guards: '先例的正确性',
        why: '先例也可能错。援引一个错判，等于把错误放大——这一问是「依例」与「依理」之间的分岔。',
      },
      {
        id: 'CQ3',
        meta: true,
        question: '本领域承认先例的约束力吗？',
        guards: '领域的规范地位',
        why: '普通法里先例有规范力量，科学研究里没有。不分辨领域，会把「惯例」误当「理由」。',
      },
    ],
    commonMisuse: [
      { form: '只举相似，不谈今案的关键差异', landsOn: '弱类比 / 诉诸惯例' },
      { form: '以「一直都这样」代替规范辩护', landsOn: '诉诸惯例 / 诉诸公众' },
    ],
    inapplicableWhen: [
      '本领域不承认先例约束（如基础科学研究、原创性论证）时，过去的做法只能是参考，不构成理由。',
    ],
    source: 'Walton 2008（argument from precedent）',
  },
  {
    id: 'two-wrongs',
    name: '两错相抵',
    nameEn: 'argument from two wrongs',
    family: 'comparison',
    skeleton: '对方也做了错事 B′ → 我方做 B 不算错（或不应被追究）',
    cues: ['他们不也', '凭什么只说我', '大家都这样', '比起他们我们算好的'],
    criticalQuestions: [
      {
        id: 'CQ1',
        question: '两件事在相干维度上确实可比吗？',
        guards: '可比性',
        why: '相抵需要同一把尺子。规模、性质、对象不同的两件事，不可比时「相抵」无从谈起。',
      },
      {
        id: 'CQ2',
        question: '对方的错误能否改变我方行为的性质？',
        guards: '规范地位的可转移性',
        why: '这是整条推理的核心断言：错误具有「传染性」。在义务论意义上它通常不成立，在报复、威慑等制度语境里可能成立。',
      },
      {
        id: 'CQ3',
        meta: true,
        question: '此语境允许以他人之错为自己开脱吗？',
        guards: '对话类型',
        why: '道德批评里不允许（两错不成一对）；国际关系、竞技、市场博弈里部分允许（对等反制）。语境判错，结论必错。',
      },
    ],
    commonMisuse: [
      { form: '以他人的错误回避对自己行为的说明', landsOn: '两错相抵 / 转移话题' },
      { form: '把「别人更糟」当成「我不糟」', landsOn: '两错相抵' },
    ],
    inapplicableWhen: ['争论点是「是否违反同一规则」时，他人是否也违反不改变我方是否违反。'],
    source: 'Walton 2008（argument from two wrongs）',
  },
  {
    id: 'verbal-classification',
    name: '语词归类',
    nameEn: 'verbal classification argument',
    family: 'comparison',
    skeleton: 'α 有特性 F；凡有 F 者可归类为有 G → α 有 G',
    cues: ['这属于', '本质上就是', '说白了就是', '按定义', '算得上'],
    criticalQuestions: [
      {
        id: 'CQ1',
        question: '有无相反证据使该归类存疑？',
        guards: '归类的边界',
        why: '归类的担保是定义的适用条件。存在反例时，要么定义太宽，要么归类太急——两者都要由提出者处理。',
      },
      {
        id: 'CQ2',
        question: '归类前提是否仅基于可疑或带偏见的定义？',
        guards: '定义的中立性',
        why: '定义不是中立的：把「抗议」定义为「暴乱」，结论就被定义决定了。这一问守的是「定义之争不能靠定义解决」。',
      },
    ],
    commonMisuse: [
      { form: '用一个本身可疑的定义支撑归类', landsOn: '语词歧义 / 偷换概念' },
      { form: '在定义之争上直接下结论', landsOn: '乞题' },
    ],
    inapplicableWhen: ['争议本身就是定义之争时，不能预设定义。'],
    source: `${SRC} p561`,
  },
];

export const SCHEMES_BY_ID = new Map(SCHEMES.map((s) => [s.id, s]));

export const FAMILY_LABEL: Record<string, string> = {
  pragmatic: '实效族',
  causal: '因果族',
  source: '信息源族',
  comparison: '比较族',
  mixed: '跨族',
  none: '未识别',
};

export const FAMILY_CUE: Record<string, string> = {
  pragmatic: '结论是行动指令，担保是「这么做才／就能换来那个结果」',
  causal: '结论是事实或事件，担保是可废止的因果概括加「无干预变量」',
  source: '结论的担保不在事实本身，而在「某个处于知情地位的人说了它」',
  comparison: '结论靠两个案子之间的相似或差异撑起',
};
