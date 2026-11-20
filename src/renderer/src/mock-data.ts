import type { Diagnosis, Span } from '@shared/types';

const PASSAGE = `我们学校去年取消了早读，今年高考一本率下降了 6 个百分点。这说明取消早读是错的。
王校长在一份公开材料里说，早读能提高记忆效率，学生就该早起读书。
如果连早读都保证不了，将来上课、自习、考试还能保证什么？`;

/**
 * 仅用于界面预览的假数据。
 *
 * 它的作用是把界面从「分析跑通」里解耦出来：没有 API Key 时也能看见
 * 一份完整的诊断长什么样。所有字段都按真实契约填，不走捷径——
 * 一旦契约改动，这里会跟着类型检查报错，等于一份免费的契约测试。
 */

/** 定位用 indexOf 现算，避免手数下标出错。引文必须原样出现在原文里，否则报 -1，问题会立刻暴露。 */
const at = (quote: string): Span => {
  const i = PASSAGE.indexOf(quote);
  return { start: i, end: i < 0 ? -1 : i + quote.length, quote, quality: i < 0 ? 'failed' : 'exact' };
};

export const MOCK: Diagnosis = {
  version: 2,
  // 固定 id 而不是现生成：预览页每次刷新都是同一份报告，异议标记才不会飘
  id: 'mock-preview',
  parentId: null,
  mode: 'diagnose',
  theory: 'walton',
  createdAt: Date.now(),
  passage: PASSAGE,
  context: {
    issue: '取消早读是否导致了升学率下降，以及是否应当恢复早读',
    speakerPosition: '反对取消早读，主张恢复',
    opposingPosition: '学校管理方（取消早读的决定者），其理由未在文本中给出',
    dialogueType: 'mixed',
    dialogueTypeBasis: '文本面向读者而非对手，末尾用反问施压，兼具说服与争吵特征',
    stage: 'argumentation',
    audience: '家长与校方',
    audienceKind: 'general',
    contextGaps: ['取消早读前后其他变量（生源、师资、命题难度）未知', '6 个百分点来自哪份统计、是否可比未知'],
    /*
     * 这份样张刻意把三档都摆出来：一个真能指出原文，两个是猜的。
     * 界面预览要能看见「猜的那两格长什么样」，否则新加的标记只在声称原文时
     * 才出现过，看起来像全都验过了——那正是这套标记要防的假象。
     */
    grounding: {
      issue: {
        source: 'inferred',
        basis: '由「这说明取消早读是错的」与前后文反推争议点',
      },
      speakerPosition: {
        source: 'known',
        basis: '这说明取消早读是错的',
      },
      opposingPosition: {
        source: 'guess',
        basis: '文本只说「取消早读」，没交代是谁决定的、理由是什么',
        ifChanged: '若这段是校方内部复盘，对面立场就是「取消是对的」，型式判断要换到成本—收益一侧',
      },
      dialogueType: {
        source: 'inferred',
        basis: '面向读者陈述并给出理由，末尾用反问施压',
      },
      stage: {
        source: 'guess',
        basis: '单段文本看不出讨论走到哪一步',
        ifChanged: '若处于交锋初段，追问「有无参照校」还太早，应先要求交代争议点',
      },
      audience: {
        source: 'guess',
        basis: '原文没有称呼、没有署名，也没有出现的读者',
        ifChanged: '若听众换成校务会，「家长支持」这条不再是理由；若发在家长群，它反而是最强的一条',
      },
      audienceKind: {
        source: 'guess',
        basis: '随上一格',
        ifChanged: '若听众是专业评审，可接受性门槛整体抬高，三条前提都要补出处',
      },
    },
  },
  scope: {
    applicable: true,
    reason: '文本给出了明确结论与三条支撑，其中两条可归入惯用型式',
    outOfScopeAt: null,
    partialNote: '第三句是修辞反问，不承担推理，未纳入型式分析',
  },
  conclusion: {
    id: 'C',
    role: 'conclusion',
    text: '取消早读是错误决定',
    supports: [],
    quote: '这说明取消早读是错的',
    span: at('这说明取消早读是错的'),
    implicit: false,
    implicitBasis: null,
    burden: 'proponent',
    acceptability: {
      status: 'questionable',
      reason: '结论是一个政策评价，需要比单一年度数据更强的支撑',
      forAudience: '对看重升学率的家长可接受；对关注睡眠与健康的家长不可接受',
      tag: 'inferred',
      confidence: 'medium',
    },
    modalOverreach: true,
    modalNote: '从「同期下降」直接跳到「是错的」，把相关性当成了唯一原因',
  },
  premises: [
    {
      id: 'P1',
      role: 'premise',
      text: '去年取消早读，今年一本率下降 6 个百分点',
      supports: ['C'],
      quote: '我们学校去年取消了早读，今年高考一本率下降了 6 个百分点',
      span: at('我们学校去年取消了早读，今年高考一本率下降了 6 个百分点'),
      implicit: false,
      implicitBasis: null,
      burden: 'proponent',
      acceptability: {
        status: 'acceptable',
        reason: '这是校内可查的事实陈述，若有统计口径则成立',
        forAudience: '对本校家长可接受',
        tag: 'known',
        confidence: 'medium',
      },
    },
    {
      id: 'P2',
      role: 'premise',
      text: '若不假定「一本率下降由取消早读引起」，则从 P1 推不出 C',
      supports: ['C'],
      quote: null,
      span: null,
      implicit: true,
      implicitBasis: '若不假定一本率下降由取消早读引起，则从「两件事先后发生」推不出「取消早读是错的」',
      burden: 'proponent',
      acceptability: {
        status: 'questionable',
        reason: '时间相邻不等于因果；同期还可能有生源、师资、命题难度等变化',
        forAudience: '对熟悉统计的读者不可接受',
        tag: 'inferred',
        confidence: 'high',
      },
    },
    {
      id: 'P3',
      role: 'premise',
      text: '王校长说早读能提高记忆效率',
      supports: ['C'],
      quote: '王校长在一份公开材料里说，早读能提高记忆效率，学生就该早起读书',
      span: at('王校长在一份公开材料里说，早读能提高记忆效率，学生就该早起读书'),
      implicit: false,
      implicitBasis: null,
      burden: 'proponent',
      acceptability: {
        status: 'questionable',
        reason: '校长是管理者，其对记忆效率的判断不属于专业领域内的研究结论',
        forAudience: '对校方立场认同者可接受',
        tag: 'general',
        confidence: 'medium',
      },
    },
  ],
  intermediate: [],
  checks: [
    {
      id: 'CQ1',
      system: 'walton-cq',
      label: 'CQ1 确有正相关吗',
      question: '确实存在正相关吗？',
      meta: false,
      answer: 'passed',
      basis: '文本给出了两项时间上相邻的事实：取消早读在前，一本率下降在后',
      guards: '相关性事实',
      landsOn: null,
    },
    {
      id: 'CQ2',
      system: 'walton-cq',
      label: 'CQ2 为何不只是同时发生',
      question: '为何不只是同时发生？',
      meta: false,
      /*
       * 这里原来是 violated，而同一份数据里三处文案都写着「CQ2 未答」。
       * 预览页只显示文案，所以这个矛盾一直没露出来；判读的推导链把「事实」
       * 摆到「说法」旁边之后，它一眼就是错的。假数据也是数据，得对得上。
       */
      answer: 'unanswered',
      basis: '文中未给出任何排除第三因素的理由，6 个百分点的变化同时可能来自生源或命题难度',
      guards: '因果方向',
      landsOn: null,
    },
    {
      id: 'CQ3',
      system: 'walton-cq',
      label: 'CQ3 有无共同原因',
      question: '有无既引起 A 又引起 B 的第三因素？',
      meta: false,
      answer: 'unanswered',
      basis: '文本完全没有提及是否存在其他变量，属未答而非已排除',
      guards: '共同原因',
      landsOn: null,
    },
    {
      id: 'CQ4',
      system: 'walton-cq',
      label: 'CQ4 领域相关性',
      question: '他确实是该领域的专家吗？',
      meta: false,
      answer: 'violated',
      basis: '校长是学校管理者，其关于记忆效率的表述未给出来源，可能是转述常识判断',
      guards: '领域相关性',
      landsOn: null,
    },
  ],
  lens: {
    kind: 'walton',
    family: 'causal',
    familyBasis: '从「取消早读」走到「一本率下降」，靠的是因果担保',
    schemeId: 'correlation-causation',
    schemeName: '相关—因果',
    skeleton: 'P1 取消早读与一本率下降同时发生 ∴ C 取消早读导致了下降，因而取消是错的',
    alternativeFamily: 'source',
    alternativeNote: '第三句引校长意见，若把它当主要支撑，则主型式应为知情地位；但结论的直接支撑仍是时间相邻',
  },
  defeat: {
    kind: 'undermining',
    checkId: 'CQ2',
    cuts: '切断 P1 与 C 之间的因果联结',
    explanation: 'CQ2 未答意味着「同时发生」未被提升为「因果」。这一处断了，结论失去支撑，但结论本身未必为假。',
    tag: 'inferred',
    confidence: 'high',
  },
  verdict: {
    scale: '型式强度：抗 CQ 的能力',
    scaleValue: 'CQ2 未答，属削弱性击败',
    level: 'weakened',
    statement: '在目前给出的证据下，这个论证的因果一跳未被支撑，结论因此未被确立——但也不能据此认为应当恢复早读。',
    qualification: '若能给出取消前后其他变量的对照（如生源、师资、命题难度），结论的可信度会改变',
    whatIsRefuted: 'argument-only',
    /*
     * 演示数据带一条完整的 D2 记录：预览页与截图要能看出「记录齐全」长什么样。
     * 这不是真实评测结果，只是形状示例（与报告里其余演示内容同一性质）。
     */
    grade: {
      level: 'D2',
      clause: '4.4',
      at: ['P2', 'CQ2'],
      evidence: 'P2 把「同期一本率下降」直接接到「早读取消」，两件事之间没有排除第三因素；CQ2 未答。',
      fix: '补出排除第三因素的对照，或把结论从「应恢复早读」降为「值得重新评估早读安排」。',
      downgrade: '若给出同期生源、师资、命题难度的对照且方向一致，本判改为 D0。',
      d5: null,
    },
  },
  confidence: {
    level: 'medium',
    why: '原文完整、版本明确；但受众与讨论阶段只能从措辞推断，没有明写。',
  },
  /*
   * 修辞审计的演示数据（D-03 八列）。
   *
   * 刻意做成「一处替代 + 一处伴随 + 一处程度放大」，让预览页能同时看到三种形状：
   * 替代成立要挂链、伴随不记缺陷、与结论强度超载同一处只计一次。
   * 链只有一条，所以 handoff 写「只记缺陷位置」——D-03 4.7：单个手法不移交 D5。
   */
  rhetoric: {
    rows: [
      {
        at: 'P1',
        ethos: 'none',
        pathos: 'none',
        logos: 'primary',
        frame: [],
        degree: 'match',
        verifiable: 'partial',
        corrections: 'unclear',
        relay: '未发现',
        test: 'accompany',
        harm: [],
        note: '数据本身就是理由，不涉及替代',
      },
      {
        at: 'P2',
        ethos: 'secondary',
        pathos: 'none',
        logos: 'primary',
        frame: ['cause'],
        degree: 'match',
        verifiable: 'partial',
        corrections: 'unclear',
        relay: '未发现',
        test: 'accompany',
        harm: [],
        note: '把下降归因到早读取消，是论证要走的那一步，不是替代',
      },
      {
        at: 'C',
        ethos: 'primary',
        pathos: 'secondary',
        logos: 'none',
        frame: ['moral'],
        degree: 'heavy',
        verifiable: 'no',
        corrections: 'closed',
        relay: '未发现',
        test: 'substitute',
        harm: ['fabricated-support'],
        note: '同一缺陷的修辞侧面：与结论强度超载是同一处，只计一次',
      },
    ],
    chains: [
      {
        kind: 'ethos',
        at: 'C',
        replaced: 'bridge',
        harm: 'fabricated-support',
        handoff: '只记缺陷位置',
      },
    ],
    overlaps: 1,
  },
  repair: {
    missingPremise: '同期除早读外，没有其他足以解释一本率下降 6 个百分点的因素',
    alternativeReading: '换 ARS 三标准看，同一处会变成「相关性成立但充分性不足」；换语用辩证看，则会先判本透镜不适用，因为文本未以解决分歧为目标',
    answerable: ['CQ1'],
    burdenStatus: '仍在提议方：主张恢复早读的一方需要补出排除第三因素的证据',
    repairedForm:
      'P1 取消早读前后，生源与师资无显著变化；P2 同期一本率下降 6 个百分点；∴ C 取消早读很可能是一个原因（尚不足以支持「是错的」）',
  },
  labels: [
    {
      id: 'post-hoc',
      name: '事后归因',
      nameEn: 'Post Hoc Ergo Propter Hoc',
      condition: '把时间上先后发生的两件事判为因果，且未排除其他解释',
      whenLegitimate: '当事先已有机制说明、且时间间隔与作用路径合理时，先后可作辅助证据',
      riskOfError: '文本只给了一年数据，也可能作者另有未写出的机制论证，此时纳入的不只是时间相邻',
      landsOnCheck: 'CQ2',
      tradition: 'Copi 系',
      tag: 'inferred',
      confidence: 'medium',
      // 预览页要走真定位链路：落点图按 span 画格子，没有 span 就只显示引文块
      quote: '我们学校去年取消了早读，今年高考一本率下降了 6 个百分点',
      span: at('我们学校去年取消了早读，今年高考一本率下降了 6 个百分点'),
    },
  ],
  legitimateMoves: [
    {
      targetId: 'P1',
      quote: '我们学校去年取消了早读，今年高考一本率下降了 6 个百分点',
      what: '给出可核查的事实与具体数字，而不是只说「成绩变差了」',
      why: '这一步本身没有问题：它把主张建立在可检验的数据上，而不是态度上。可疑的是从这一步到结论的那一跳，不是这一步。',
      tag: 'known',
      confidence: 'high',
    },
  ],
  refutations: [
    {
      id: 'R1',
      targetId: 'P1',
      checkId: 'CQ2',
      strategy: 'alternative-explanation',
      claim: '同时发生不等于因果，同期还有别的变量',
      script:
        '取消早读和一本率下降是同一年发生的，但这一年学校的生源、师资、当年命题难度也都在变。要说是早读的原因，得先把这些排掉。',
      steelman: '对方会说：生源师资每年都在变，但只有取消早读这一年出现了 6 个百分点的落差，这本身就是证据。',
      reply: '那就把前几年的数据一并列出来。若只有这一年异常，才谈得上指向；若本来就在波动，6 个点不构成拐点。',
      evidenceNeeded: ['近五年一本率与生源质量数据', '同期师资变动记录'],
      burdenAfter: 'proponent',
      tag: 'inferred',
      confidence: 'high',
    },
    {
      id: 'R2',
      targetId: 'P3',
      checkId: 'CQ4',
      strategy: 'premise-unsupported',
      claim: '校长的判断不属于该问题的专业结论',
      script:
        '校长说早读能提高记忆效率，但这是他作为管理者的表态，还是引用了具体研究？如果是前者，这条只能算一种立场。',
      steelman: '对方会说：校长长期在教學一线，经验判断也有价值，不必是研究者才能谈记忆。',
      reply: '经验判断可以作为线索，但它撑不起「因此应当恢复」这种政策结论。要么给出研究或对照数据，要么把它降为待检验的假设。',
      evidenceNeeded: ['校长表述的原始出处与依据'],
      burdenAfter: 'proponent',
      tag: 'general',
      confidence: 'medium',
    },
  ],
  selfCheck: {
    epi: {
      P1_source: 2,
      P2_context: 2,
      P3_position: 2,
      P4_withdrawal: 2,
      P5_selfApply: 1,
      P6_openness: 2,
      P7_steelman: 2,
      total: 13,
      vetoed: false,
      reading: 'legitimate',
      notes: ['自我适用一项扣分：本分析同样依赖「因果需要排除第三因素」这一常识，未给出文献出处'],
    },
    ruleAudit: ['未把「相关—因果」型式本身当成罪名，只指出 CQ2 未答'],
    unknowns: ['6 个百分点来自哪份统计、口径是否可比', '取消早读的具体执行方式（是否只是推迟到校时间）'],
    // 不写「库中 N 个」：N 会随库扩充而变，写死的数字迟早与事实不符。
    // 而且这个字段要说的本来不是数量，是「名录不封闭，认不出是正常的」。
    opennessNote: '本次用到的型式在库里已有收录；若文本实际属于未收录的型式，本分析的型式定位需重做。',
    withdrawIf: [
      '若作者在其他地方给出了排除第三因素的论证，CQ2 的判定需要改',
      '若「一本率」指的是特定批次而非全体，6 个百分点的解读会变',
    ],
    underOtherLens:
      '换语用辩证透镜：本文本没有可识别的对手立场，会判为不适用；换图尔敏：会指出从数据到结论缺一条「凡同期下降皆由该校策引起」的担保；换名录透镜：会给出事后归因与诉诸权威两个候选，并附各自的误判风险。',
  },
  diagnostics: [
    {
      level: 'info',
      code: 'NO_LEGITIMATE_FOUND',
      message: '示例数据：第三条反问句未纳入型式分析，因为它不承担推理。',
    },
  ],
};

/*
 * 其余五副透镜的预览数据。
 *
 * 为什么要各造一份：六副透镜的产物栏现在是图，而图只有当那副透镜真的被选中时
 * 才画得出来。假模型每次只返回 walton 那一版，端到端冒烟验不到另外五张图——
 * 它们会一直存在于仓库里却从没被人眼看过，这是最容易藏错的状态。
 *
 * 做法是把 MOCK 整份深拷贝，只换 theory 与 lens（外加 checks 的 system 与 id，
 * 否则检查项会挂着 CQ 编号却显示在图尔敏栏里，看着像 bug）。
 * 这样六份共享同一段原文与同一套结论——同一段话六副透镜判出不同的东西，
 * 本来就是这个工具要展示的事，预览数据更该一致。
 */

function withLens(lens: Diagnosis['lens'], patch: Partial<Diagnosis> = {}): Diagnosis {
  const d: Diagnosis = JSON.parse(JSON.stringify(MOCK));
  d.lens = lens;
  return { ...d, ...patch };
}

export const MOCK_TOULMIN = withLens(
  {
    kind: 'toulmin',
    grounds: ['去年取消早读', '今年一本率下降 6 个百分点'],
    warrant: '凡同期下降皆由该校这一政策引起',
    warrantStated: false,
    warrantType: 'causal',
    backing: null,
    qualifier: null,
    rebuttals: ['若同期生源或师资发生显著变化，此担保不成立'],
    gapBetween: '理由与主张之间：从数据走到归因缺一条担保',
  },
  {
    theory: 'toulmin',
    checks: [
      {
        id: 'T-grounds',
        system: 'toulmin',
        label: '理由',
        question: '他摆出的事实站得住吗',
        meta: false,
        answer: 'passed',
        basis: '两条理由都是原文给出的数据，未发现出处问题',
        guards: '论证的起点',
        landsOn: null,
      },
      {
        id: 'T-warrant',
        system: 'toulmin',
        label: '担保',
        question: '凭什么从这些理由走到那句主张',
        meta: true,
        answer: 'violated',
        basis: '原文没有写出担保，推定出的是「凡同期下降皆由该校政策引起」，这条担保本身不成立',
        guards: '理由到主张的那一跃',
        landsOn: 'false-cause',
      },
      {
        id: 'T-backing',
        system: 'toulmin',
        label: '支援',
        question: '担保有没有靠山',
        meta: false,
        answer: 'unanswered',
        basis: '担保是推定补出的，谈不上支援',
        guards: '担保的稳固程度',
        landsOn: null,
      },
      {
        id: 'T-qualifier',
        system: 'toulmin',
        label: '限定',
        question: '话说得多满',
        meta: false,
        answer: 'violated',
        basis: '结论写成「取消早读是错的」，没有任何限定',
        guards: '主张的强度',
        landsOn: null,
      },
    ],
  }
);

export const MOCK_ARS = withLens(
  {
    kind: 'ars',
    burdenStandard: '日常讨论：给出足以让对方接受的理由即可，不要求排除一切替代解释',
    sufficiencyNote: '相关性与排除第三因素两件事，作者只做了前者',
    gapAt: 'missing-premise',
  },
  {
    theory: 'ars',
    checks: [
      {
        id: 'ARS-P1-acceptability',
        system: 'ars',
        label: '可接受性',
        question: '这个前提你能接受吗',
        meta: false,
        answer: 'passed',
        basis: '一本率下降是公开数据，未被质疑',
        guards: '前提本身',
        landsOn: null,
      },
      {
        id: 'ARS-P1-relevance',
        system: 'ars',
        label: '相干性',
        question: '它跟结论有关系吗',
        meta: false,
        answer: 'passed',
        basis: '时间相邻与因果主张确实相关',
        guards: '前提到结论的连接',
        landsOn: null,
      },
      {
        id: 'ARS-ARG-sufficiency',
        system: 'ars',
        label: '充分性',
        question: '加起来够不够',
        meta: true,
        answer: 'violated',
        basis: '未排除生源、师资、命题难度等同期变量，不足以支撑「取消早读是错的」',
        guards: '整个论证的分量',
        landsOn: null,
      },
    ],
  }
);

export const MOCK_PTA = withLens(
  {
    kind: 'pta',
    order: 'first',
    axis: 'predicate',
    premiseType: 'fact',
    conclusionType: 'value',
    ptaType: null,
    ptaName: null,
    waltonId: 'correlation-causation',
    featureNotes: {
      order: '结论不是关于某个论证的论证，是一阶',
      axis: '谓语「是错的」落在结论主词上',
      statementType: '前提讲事实，结论讲价值：从事实走到价值需要一条担保',
    },
  },
  {
    theory: 'pta',
    checks: [
      {
        id: 'PTA-order',
        system: 'pta',
        label: '阶',
        question: '它是在论证另一个论证吗',
        meta: false,
        answer: 'passed',
        basis: '结论直接关于早读政策，不是关于某个论证',
        guards: '层级',
        landsOn: null,
      },
      {
        id: 'PTA-axis',
        system: 'pta',
        label: '轴',
        question: '谓语落在主词上，还是主词落在谓语上',
        meta: false,
        answer: 'passed',
        basis: '「是错的」这一谓语归于「取消早读」这一主词',
        guards: '主谓方向',
        landsOn: null,
      },
      {
        id: 'PTA-type',
        system: 'pta',
        label: '陈述类型',
        question: '前提与结论各是事实、价值还是政策',
        meta: true,
        answer: 'violated',
        basis: '前提是事实（一本率下降），结论是价值（取消早读是错的），中间缺一条从事实到价值的担保',
        guards: '跨越类型那一跃',
        landsOn: 'is-ought',
      },
    ],
  }
);

/** 预览页按 ?lens= 取对应的那份。 */
export const MOCK_BY_THEORY: Record<string, Diagnosis> = {
  walton: MOCK,
  toulmin: MOCK_TOULMIN,
  ars: MOCK_ARS,
  pta: MOCK_PTA,
};
