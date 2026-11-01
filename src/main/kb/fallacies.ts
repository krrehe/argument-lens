import type { FallacyDefinition } from '@shared/types';

/**
 * 谬误库
 *
 * 出处：武宏志《非形式逻辑导论》附录B「谬误速查与判据表」，
 * 兼取卡亨（Copi/Kahane 传统）、约翰逊—布莱尔（RSA）、卢默、伍兹（18 帮）、科恩等进路。
 *
 * 三条硬口径：
 * 1. condition 是命名的门槛。写不出「使它成为该谬误而非别种的条件」，就不许给名字。
 * 2. whenLegitimate 不是免责声明，是这个条目最有用的一半。多数「谬误指控」死在这里。
 * 3. 汉森统计 23 种文献：「无效性条件」只占 9%。谬误不是「无效论证」的同义词。
 */

export const FALLACIES: FallacyDefinition[] = [
  {
    id: 'ad-hominem',
    name: '针对人身',
    nameEn: 'ad hominem',
    definition: '攻击对方的品性、处境或言行不一，以代替对其论证的反驳。',
    condition: '要成立，须同时满足：所攻击的属性与结论真假不相干；且该攻击被用来替代对论证本身的评估。',
    tradition: '卡亨 / 卢默 F2.1.3',
    whenLegitimate: [
      '质疑利益相关（「他卖课」）在「他是否在推销」上是正当的理由加权，不是谬误。',
      '证人可信性、竞选论辩中，品性是相干因素。',
      '即便相干，也只能得出「降低可信力」，不能推出「结论为假」。',
    ],
    typicalCQ: '品性在此对话类型中相干吗',
  },
  {
    id: 'straw-man',
    name: '稻草人',
    nameEn: 'straw man',
    definition: '把对方立场歪曲成更弱、更极端的版本，再攻击这个版本。',
    condition: '要成立，须指出歪曲发生在哪一个词上：对方说 A，被改写成 A′，而 A′ 比 A 强且更易攻。',
    tradition: '卡亨 / 科恩（误解）',
    whenLegitimate: [
      '把模糊表述澄清成一个明确命题，不是稻草人——澄清与歪曲的区别在于是否可对照原话。',
      '指出对方未言明的逻辑后果，不等于歪曲其立场。',
    ],
    typicalCQ: '引述忠实度',
  },
  {
    id: 'false-dilemma',
    name: '虚假二难',
    nameEn: 'false dilemma',
    definition: '只给两个选项，抹去其他可能，且二者并非穷尽。',
    condition: '要成立，须能补出第三个真正可行的选项，而不只是名义上的第三种说法。',
    tradition: '卡亨',
    whenLegitimate: [
      '当选项确实穷尽（如「要么承认要么否认」，排中律适用）时，不是谬误。',
      '为讨论方便而暂时限定两种情形，且已声明，不构成谬误。',
    ],
    typicalCQ: '另有手段吗',
  },
  {
    id: 'slippery-slope',
    name: '滑坡',
    nameEn: 'slippery slope',
    definition: '无充分证据却假定链条光滑，从第一步直接推出灾难性结局。',
    condition: '要成立，须指出链条上某一环缺少支撑，或指出存在制度性阻断使链条无法延续。',
    tradition: '卡亨 / 沃尔顿',
    whenLegitimate: [
      '链条每一环都有独立证据支持时，是合法的因果预测，不是滑坡。',
      '若能指出具体的、已发生的先例作为链条的实证，强度显著上升。',
    ],
    typicalCQ: '为使序列似真须补哪些步骤',
  },
  {
    id: 'begging-question',
    name: '乞题',
    nameEn: 'petitio principii / begging the question',
    definition: '以结论本身或其等价物作为前提。',
    condition: '要成立，须证明该前提无法在不预设结论的情况下独立获得支持。',
    tradition: '卡亨 / 卢默 F3',
    whenLegitimate: [
      '前提与结论表述相近，但前提可独立举证时，不是乞题。',
      '在探究的初始阶段把待证命题作为工作假设，不等于论证中乞题。',
    ],
    typicalCQ: '前提可接受吗',
  },
  {
    id: 'circular-reasoning',
    name: '循环论证',
    nameEn: 'circular argument',
    definition: '前提的成立依赖结论，形成闭环。',
    condition: '要成立，须画出依赖环：A 支撑 B，B 又支撑 A，且环上没有外部支撑点。',
    tradition: '汉布林 / 卢默',
    whenLegitimate: [
      '相互支撑的两个命题若各自有独立证据，是融贯而非循环。',
      '定义层面的相互关联（如「权利」与「义务」）不是论证循环。',
    ],
    typicalCQ: '前提可接受吗',
  },
  {
    id: 'hasty-generalization',
    name: '仓促概括',
    nameEn: 'hasty generalization',
    definition: '证据与结论相干，但数量或质量不足以担保该概括。',
    condition: '要成立，须说明该语境要求的证据门槛是多少，而实际给了多少。',
    tradition: '卡亨 / 约翰逊-布莱尔（充分性失败）',
    whenLegitimate: [
      '结论本身带限定（「在我接触的范围内」「初步来看」）时，门槛相应降低。',
      '存在理论支撑使小样本具备代表性时，不必然仓促。',
    ],
    typicalCQ: '概括够强吗',
  },
  {
    id: 'anecdotal-evidence',
    name: '轶事证据',
    nameEn: 'anecdotal evidence',
    definition: '以个别经历或个案代替系统性证据。',
    condition: '要成立，须说明该结论所需的证据类型是统计性的，而所给的是个案。',
    tradition: '卡亨（小样本）',
    whenLegitimate: [
      '结论本身就是关于个案的（「我那次确实如此」）时，个案是恰当证据。',
      '个案用于反驳全称命题（「从来没有例外」）时，一个反例就足够。',
    ],
    typicalCQ: '所引证据足以担保该概括吗',
  },
  {
    id: 'false-cause',
    name: '虚假原因',
    nameEn: 'false cause',
    definition: '把不是原因的因素当作原因。',
    condition: '要成立，须指出真正的因果路径，或指出该因素在机制上不产生该结果。',
    tradition: '卡亨 / 科恩',
    whenLegitimate: [
      '因果机制不明但有稳定干预实验支持时，不能因「讲不出机制」判为虚假原因。',
    ],
    typicalCQ: '有无干预或抵消该结果的因素',
  },
  {
    id: 'post-hoc',
    name: '以先后为因果',
    nameEn: 'post hoc ergo propter hoc',
    definition: '仅因 B 发生在 A 之后，就断定 A 导致 B。',
    condition: '要成立，须指出时序之外没有任何独立证据支持因果，且存在更合理的替代解释。',
    tradition: '科恩 / 卢默 F2.3',
    whenLegitimate: [
      '有时序且有机制、有剂量反应关系、有对照时，时序是合法证据之一。',
    ],
    typicalCQ: '为何不只是同时发生',
  },
  {
    id: 'correlation-as-cause',
    name: '把相关当因果',
    nameEn: 'cum hoc ergo propter hoc',
    definition: '由 A 与 B 相关，直接断定 A 引起 B。',
    condition: '要成立，须指出存在共同原因，或因果方向可能相反。',
    tradition: '卡亨（可疑原因）',
    whenLegitimate: [
      '有随机对照试验或自然实验支持时，相关足以支撑因果。',
    ],
    typicalCQ: '有无既引起 A 又引起 B 的第三因素',
  },
  {
    id: 'equivocation',
    name: '语词歧义',
    nameEn: 'equivocation',
    definition: '同一词项在论证的两处意义不同，使推理表面成立。',
    condition: '要成立，须定位意义转换发生在哪一处，并说明两处意义不同。',
    tradition: '卡亨 / 帕沃斯',
    whenLegitimate: [
      '一词多义但论证中始终使用同一义项时，不是歧义。',
      '有意做双关修辞而不承担论证功能时，不构成论证谬误。',
    ],
    typicalCQ: '结论模态过头吗',
  },
  {
    id: 'amphiboly',
    name: '句法歧义',
    nameEn: 'amphiboly / syntactic ambiguity',
    definition: '由句子结构而非词义产生的歧义，导致结论被误读。',
    condition: '要成立，须给出两种句法解析，并说明其中一种使论证不成立。',
    tradition: '伍兹 / 科恩',
    whenLegitimate: [
      '上下文已消除歧义时，不构成谬误。',
    ],
    typicalCQ: null,
  },
  {
    id: 'composition',
    name: '组合谬误',
    nameEn: 'composition',
    definition: '由部分具有某性质，推出整体也具有该性质。',
    condition: '要成立，须说明该属性不可传递到整体（如「每块砖很轻」不推出「整堆砖很轻」）。',
    tradition: '卡亨',
    whenLegitimate: [
      '该属性确实可传递时（如「每个零件是金属的」→「整机是金属的」），不是谬误。',
    ],
    typicalCQ: null,
  },
  {
    id: 'division',
    name: '分解谬误',
    nameEn: 'division',
    definition: '由整体具有某性质，推出其每个部分也具有该性质。',
    condition: '要成立，须说明该属性不可分配到部分。',
    tradition: '卡亨',
    whenLegitimate: [
      '属性可分配时（如「这台机器重 50 公斤」不适用，但「这个班全是男生」→「班上每个人是男生」适用）不是谬误。',
    ],
    typicalCQ: null,
  },
  {
    id: 'ad-verecundiam',
    name: '诉诸权威',
    nameEn: 'ad verecundiam',
    definition: '以权威之名代替理由。',
    condition: '要成立，须指出六条 CQ 中哪一条未获回答：跨领域、来源不明、引述失真、有利益冲突、专家有分歧、无证据基础。',
    tradition: '卡亨 / 沃尔顿',
    whenLegitimate: [
      '领域相关、无利益冲突、代表共识、引述忠实时，引用专家是正当的证据，不是谬误。',
      '把这种情形判为「诉诸权威」本身是最常见的误判。',
    ],
    typicalCQ: '他确实是该领域的专家吗',
  },
  {
    id: 'ad-populum',
    name: '诉诸公众',
    nameEn: 'argumentum ad populum',
    definition: '以流行或多数人的看法代替理由。',
    condition: '要成立，须说明该命题的真假不取决于流行度，而论证仅以流行度为据。',
    tradition: '卡亨 / 科恩',
    whenLegitimate: [
      '议题属于惯例、趣味、约定时，多数意见可以是相干理由。',
      '在民主决策中，多数同意是决策正当性来源（但非真假依据）。',
    ],
    typicalCQ: '即便普遍接受，有无怀疑它为真的理由',
  },
  {
    id: 'ad-baculum',
    name: '诉诸强力',
    nameEn: 'ad baculum',
    definition: '以不利后果或威胁代替理由。',
    condition: '要成立，须说明该威胁被当作论据使用，而非仅仅陈述后果。',
    tradition: '科恩 / 帕沃斯',
    whenLegitimate: [
      '谈判中陈述「若不接受则有后果」是合法信息，不是谬误。',
      '帕沃斯认为赤裸的威胁坏得显眼，根本不构成「看似有效」的论证，因此不算谬误。',
    ],
    typicalCQ: '威胁相干吗',
  },
  {
    id: 'ad-misericordiam',
    name: '诉诸怜悯',
    nameEn: 'ad misericordiam',
    definition: '以同情或可怜处境代替理由。',
    condition: '要成立，须说明同情与该结论的成立之间没有推理关系。',
    tradition: '伍兹（18 帮）/ 卢默',
    whenLegitimate: [
      '在量刑、救助资格等本质上需要考虑处境的裁决中，处境是相干理由。',
    ],
    typicalCQ: '前提是否担保结论',
  },
  {
    id: 'ad-ignorantiam',
    name: '诉诸无知',
    nameEn: 'ad ignorantiam',
    definition: '以「无法证明其假」当作其真（或以「无法证明其真」当作其假）的证明。',
    condition: '要成立，须说明该领域的举证责任本在主张方，且「未发现」不蕴含「不存在」。',
    tradition: '卡亨 / 沃尔顿',
    whenLegitimate: [
      '在穷尽性搜索后（如已彻底排查），「未发现」可以是弱证据，但须说明搜索范围。',
      '法庭上的无罪推定不是诉诸无知，是举证责任的制度安排。',
    ],
    typicalCQ: '搜索证据进行得多远',
  },
  {
    id: 'two-wrongs',
    name: '两个错误等于一个正确',
    nameEn: 'two wrongs make a right',
    definition: '以他人也犯了同样的错，来为自身行为辩护。',
    condition: '要成立，须说明对方的过错不能使己方主张在规范上成立。',
    tradition: '卡亨',
    whenLegitimate: [
      '用于质疑「为何只惩罚我」的一致性问题（选择性执法）时，是相干的反驳。',
    ],
    typicalCQ: null,
  },
  {
    id: 'tu-quoque',
    name: '你也一样',
    nameEn: 'tu quoque',
    definition: '以对方言行矛盾代替对其论证的反驳。',
    condition: '要成立，须说明对方的言行不一与其论证的真假无关。',
    tradition: '科恩 / 卢默',
    whenLegitimate: [
      '在论辩中揭露对方的不一致承诺，可正当降低其可信力（环境型针对人身）。',
      '用于指出伪善时说教资格，是修辞而非论证反驳。',
    ],
    typicalCQ: '不一致可否经对话解释',
  },
  {
    id: 'red-herring',
    name: '红鲱',
    nameEn: 'red herring',
    definition: '引入一个相干性伪装的新话题，转移争议焦点。',
    condition: '要成立，须指明原争点是什么、新话题是什么、两者为何不相干。',
    tradition: '约翰逊-布莱尔 / 科恩',
    whenLegitimate: [
      '新话题若是原争点的必要背景（如预算约束之于政策可行性），不是转移。',
    ],
    typicalCQ: '前提与结论相干吗',
  },
  {
    id: 'ignoratio-elenchi',
    name: '对反驳的无知（证明的不是待证之点）',
    nameEn: 'ignoratio elenchi',
    definition: '论证所证明的并非待证命题。',
    condition: '要成立，须重写「待证之点」，再比对实际被证明的命题。',
    tradition: '科恩 / 沃尔顿',
    whenLegitimate: [
      '若双方对「待证之点」本身有分歧，先要澄清争点，此时不宜直接判谬误。',
    ],
    typicalCQ: '结论是否被推出',
  },
  {
    id: 'suppressed-qualification',
    name: '忽视限制',
    nameEn: 'suppressed qualification',
    definition: '略去结论成立所必需的限定条件，使结论显得比实际更强。',
    condition: '要成立，须指出被略去的限定词，并说明补回后结论强度显著下降。',
    tradition: '伍兹（18 帮）',
    whenLegitimate: [
      '限定在上下文别处已交代时，不算略去。',
    ],
    typicalCQ: '结论模态过头吗',
  },
  {
    id: 'biased-statistics',
    name: '偏颇统计',
    nameEn: 'biased statistics',
    definition: '统计取样或口径系统性偏向一方。',
    condition: '要成立，须指出抽样框架或口径的具体偏差方向。',
    tradition: '伍兹（18 帮）',
    whenLegitimate: [
      '样本有偏但结论只声称在该样本内成立时，不构成谬误。',
    ],
    typicalCQ: '所引证据足以担保该概括吗',
  },
  {
    id: 'gamblers-fallacy',
    name: '赌徒谬误',
    nameEn: "gambler's fallacy",
    definition: '认为独立事件会因既往结果而产生「补偿」倾向。',
    condition: '要成立，须说明该事件序列确为独立同分布。',
    tradition: '卡亨',
    whenLegitimate: [
      '事件不独立时（如无放回抽样），既往结果确实改变概率，不是谬误。',
    ],
    typicalCQ: null,
  },
  {
    id: 'false-analogy',
    name: '错误类比',
    nameEn: 'weak analogy',
    definition: '相似性不足以支撑结论，却以之类推。',
    condition: '要成立，须指出一处与结论直接相关的差异，且该差异削弱了类推。',
    tradition: '新修辞学 / 卢默 F2.1.2',
    whenLegitimate: [
      '任何两案都有差异。指出差异本身不构成反驳，须证明该差异与结论相关。',
      '类比用于启发理解而非承担证明责任时，不构成论证谬误。',
    ],
    typicalCQ: '差异会破坏相似性的力量吗',
  },
  {
    id: 'poisoning-the-well',
    name: '井中投毒',
    nameEn: 'poisoning the well',
    definition: '预先败坏对方信誉，使其后续发言不被听取。',
    condition: '要成立，须说明该贬损发生在其论证之前，且意在使论证免于被听。',
    tradition: '科恩',
    whenLegitimate: [
      '事先披露已核实的利益冲突，是正当的信息提供。',
    ],
    typicalCQ: '品性断言证据良好吗',
  },
  {
    id: 'affirming-consequent',
    name: '肯定后件',
    nameEn: 'affirming the consequent',
    definition: '由「若 P 则 Q」与「Q」推出「P」。',
    condition: '要成立，须构造使 Q 真而 P 假的模型（即存在其他途径导致 Q）。',
    tradition: '卡亨 / 形式谬误',
    whenLegitimate: [
      '在回溯推理中，由 Q 推出 P 作为最佳说明是合法的（但结论只能是「似真」，不是「必然」）。',
    ],
    typicalCQ: null,
  },
  {
    id: 'denying-antecedent',
    name: '否定前件',
    nameEn: 'denying the antecedent',
    definition: '由「若 P 则 Q」与「非 P」推出「非 Q」。',
    condition: '要成立，须构造使 P 假而 Q 真的模型。',
    tradition: '卡亨 / 形式谬误',
    whenLegitimate: [
      '当「若 P 则 Q」表达的是必要条件关系而非充分条件时，否定前件可能成立——问题在条件句被误读。',
    ],
    typicalCQ: null,
  },
  {
    id: 'false-criticism-of-fallacy',
    name: '错误的谬误批评',
    nameEn: 'false criticism of fallacy',
    definition: '无据指控他人犯错，批评者自身反成谬误。',
    condition: '要成立，须说明被指控者其实有改变主意或坚持的理性基础，指控方未给出该基础缺失的证据。',
    tradition: '卡亨',
    whenLegitimate: [
      '这是本应用最该常用的一条：当分析结果想给出谬误名时，先自查是否属于此类。',
    ],
    typicalCQ: null,
  },
  {
    id: 'burden-shifting',
    name: '转移举证责任',
    nameEn: 'shifting the burden of proof',
    definition: '把本应由自己承担的举证义务推给对方。',
    condition: '要成立，须说明该主张的总体举证责任本在主张方，且其以「你证明不了我错」脱身。',
    tradition: '语用-辩证 / 沃尔顿',
    whenLegitimate: [
      '当对方提出了一个需要支撑的反对意见时，要求其给出理由是正当的。',
      '批评 II（另有反证）的责任本就在回应者一侧，要求其举证不算转移。',
    ],
    typicalCQ: '哪一方负总体证明责任',
  },
  {
    id: 'many-questions',
    name: '复杂问题（多问）',
    nameEn: 'many questions / complex question',
    definition: '一个问题预设了多个答案，逼对方在不接受预设的情况下作答。',
    condition: '要成立，须拆出该问题所预设的命题，并说明该预设本身待证。',
    tradition: '汉布林 / 辛迪卡',
    whenLegitimate: [
      '预设已由先前对话确立时，不构成谬误。',
    ],
    typicalCQ: null,
  },
  {
    id: 'subjectivism',
    name: '主观主义',
    nameEn: 'subjectivism',
    definition: '以「我觉得」代替可公共检验的理由。',
    condition: '要成立，须说明该议题本可公共检验，而论证仅以个人感受为据。',
    tradition: '科恩',
    whenLegitimate: [
      '议题本身是个人偏好（口味、审美取向）时，「我觉得」是恰当理由。',
    ],
    typicalCQ: null,
  },
  {
    id: 'obscurantism',
    name: '蒙昧主义',
    nameEn: 'obscurantism',
    definition: '故意含混，使人无法追问。',
    condition: '要成立，须指出具体哪一处术语无法被要求澄清，且该含混支撑了结论。',
    tradition: '科恩',
    whenLegitimate: [
      '术语专业但可被定义、可被追问时，不是蒙昧主义。',
      '人文社科中的必要复杂性与故意含混不同：区别在于能否被要求澄清。',
    ],
    typicalCQ: null,
  },
  /*
   * 下面三条是评测跑出来的缺口（2026-11）。
   *
   * 原名录有 36 条，偏重「结构类」谬误（哪些推理形式不对），
   * 缺了整整一类「来源类」：靠来历、年岁、新旧来定真假。
   * 这类在真实文本里极常见——伪科普、传统养生、技术选型都在用——
   * 而名录里没有对应条目时，模型只能把它们硬塞进相邻的条目：
   * 「古人云」被塞进诉诸权威，「西方人不懂五谷」被塞进针对人身。
   * 名字错得不算离谱，但读者照着这个名字去找反击点，会找错方向。
   */
  {
    id: 'appeal-to-tradition',
    name: '诉诸传统',
    nameEn: 'appeal to tradition',
    definition: '以「历来如此」「古人云」「我们一直这么做」作为主张成立的理由。',
    condition:
      '要成立，须说明所引的惯例本身不能为该主张提供规范或经验支持，且惯例就是论证的主要支撑——不是背景交代。',
    tradition: '卡亨 / 沃尔顿',
    whenLegitimate: [
      '问题是「现行做法是什么」这类事实问题时，引惯例是恰当证据。',
      '惯例可以作为「至今未出现反例」的弱经验证据，但须把这一点说出来，并接受反例推翻。',
      '在保守主义论证里，「改变需要理由」是一条可辩护的程序原则；但那要求论证者把原则说出来，而不是把惯例本身当结论的依据。',
    ],
    typicalCQ: null,
  },
  {
    id: 'genetic-fallacy',
    name: '起源谬误',
    nameEn: 'genetic fallacy',
    definition: '以主张的来历（谁说的、从哪儿传来的、怎么产生的）判定其真假，而不是判定其内容是否成立。',
    condition:
      '要成立，须说明所攻击的来历与该主张的真假无关。若来历关系到可信度（利益冲突、专业资质、转述失真），那是可信度评估，不是起源谬误——这两者常被混为一谈。',
    tradition: '卡亨 / 汉森',
    whenLegitimate: [
      '来历确实影响可信度时（利益冲突、无资质、经多次转述），质疑来历是相干的。',
      '概念史与思想史研究里，追溯来历是理解的一部分，本身不构成判定。',
    ],
    typicalCQ: null,
  },
  {
    id: 'appeal-to-novelty',
    name: '诉诸新潮',
    nameEn: 'appeal to novelty',
    definition: '以「最新」「刚出的」「旧方法早被淘汰了」作为主张成立的理由。',
    condition: '要成立，须说明新旧本身与该主张的真假无关，而论证的主要支撑就是「新」。',
    tradition: '卡亨',
    whenLegitimate: [
      '技术选型里「仍在维护」「社区活跃」可以是相关理由，但那说的是维护状态，不是新旧。',
      '若旧方法确有已知缺陷，指出缺陷是关于缺陷的论证，不是诉诸新潮。',
    ],
    typicalCQ: null,
  },
];

export const FALLACIES_BY_ID = new Map(FALLACIES.map((f) => [f.id, f]));
