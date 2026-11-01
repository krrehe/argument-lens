/**
 * 生成一份「查谬误模式」的示例导出件，落盘供人工通读。
 *
 * 导出件是给用户带走的成品，也是唯一一份会被陌生人从头读到尾的产物。
 * 断言只管「该有的字段在不在」，读不出「读起来像不像人话」——
 * 所以这里把它写出来，由人去读上一遍。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { reportToMarkdown } from '@shared/report-markdown';
import { THEORY_BY_ID } from '@shared/theories';
import type { Diagnosis } from '@shared/types';

const PASSAGE =
  '我们学校去年取消了早读，今年高考一本率下降了 6 个百分点，' +
  '可见取消早读是成绩下滑的原因，必须马上恢复。' +
  '很多家长也支持恢复早读，可见早读肯定有益。' +
  '反对恢复早读的人，大概自己也不想早起吧。';

const d: Diagnosis = {
  id: 'sample-fallacy',
  createdAt: Date.now(),
  mode: 'fallacy',
  theory: 'walton',
  theoryName: THEORY_BY_ID.walton.name,
  text: PASSAGE,
  textLength: PASSAGE.length,
  model: 'deepseek-chat',
  prompt: { version: '2.5.0', fingerprint: '6b001e32a384', coreFingerprint: '6eee91463e74' },
  usage: null,
  context: {
    issue: '要不要恢复早读',
    speakerPosition: '主张立刻恢复早读',
    opposingPosition: '认为早读与成绩下滑之间没有建立因果',
    dialogueType: 'persuasion',
    dialogueTypeBasis: '文本连续使用「可见」「必须」推进结论，且直接提出行动要求',
    stage: 'argumentation',
    audience: '学校管理层与家长',
    audienceKind: 'supportive',
    contextGaps: ['没有给出取消早读前后的其他变量（师资、生源、试题难度）'],
  },
  scope: { applicable: true, reason: '文本在做因果推断，型式法可评', outOfScopeAt: null, partialNote: null },
  conclusion: {
    id: 'C',
    role: 'conclusion',
    text: '应当恢复早读',
    quote: '必须马上恢复',
    implicit: false,
    implicitBasis: null,
    burden: 'proponent',
    acceptability: {
      status: 'questionable',
      reason: '结论的模态超出了前提能担保的范围',
      forAudience: 'questionable',
      tag: 'inferred',
      confidence: 'low',
    },
    modalOverreach: true,
    modalNote: '前提只支持「值得研究」，文本写成了「必须」',
  },
  premises: [
    {
      id: 'P1',
      role: 'premise',
      text: '取消早读之后，一本率下降了 6 个百分点',
      quote: '去年取消了早读，今年高考一本率下降了 6 个百分点',
      supports: ['C'],
      implicit: false,
      implicitBasis: null,
      burden: 'proponent',
      acceptability: {
        status: 'acceptable',
        reason: '这是可核查的统计陈述',
        forAudience: 'acceptable',
        tag: 'known',
        confidence: 'medium',
      },
    },
    {
      id: 'P2',
      role: 'premise',
      text: '多数家长支持恢复早读',
      quote: '很多家长也支持恢复早读',
      supports: ['C'],
      implicit: false,
      implicitBasis: null,
      burden: 'proponent',
      acceptability: {
        status: 'acceptable',
        reason: '作为「家长的态度」这一事实可接受',
        forAudience: 'acceptable',
        tag: 'known',
        confidence: 'medium',
      },
    },
  ],
  intermediate: [],
  checks: [
    {
      id: 'CQ1',
      system: 'walton-cq',
      label: 'CQ1 相关性事实',
      question: '确实存在正相关吗？',
      meta: false,
      answer: 'passed',
      basis: '文本给出了两个变量的取值变化',
      guards: '相关性事实',
      landsOn: null,
    },
    {
      id: 'CQ2',
      system: 'walton-cq',
      label: 'CQ2 因果方向',
      question: '为何不只是同时发生？',
      meta: false,
      answer: 'unanswered',
      basis: '文中没有交代为什么不是巧合、也没有给出机制',
      guards: '因果方向',
      landsOn: 'post-hoc',
    },
    {
      id: 'CQ3',
      system: 'walton-cq',
      label: 'CQ3 共同原因',
      question: '有无既引起 A 又引起 B 的第三因素？',
      meta: false,
      answer: 'unanswered',
      basis: '未排除师资、生源、试题难度等共同原因',
      guards: '共同原因',
      landsOn: 'post-hoc',
    },
  ],
  lens: {
    kind: 'walton',
    family: 'causal',
    familyBasis: '从前提到结论靠的是因果担保',
    schemeId: 'correlation-causation',
    schemeName: '相关—因果',
    skeleton: 'P1（A 与 B 共变） ∴ C（A 引起 B）',
    alternativeFamily: null,
    alternativeNote: null,
  },
  defeat: { kind: 'none', checkId: null, cuts: null, explanation: '本模式不判定', tag: 'known', confidence: 'high' },
  verdict: {
    scale: '型式强度：抗 CQ 的能力',
    scaleValue: '本模式不评级',
    level: 'undetermined',
    statement: '本模式不给判定档位，只指出位置与名字',
    qualification: '换一副透镜，这些名字可能换成别的',
    whatIsRefuted: 'nothing',
  },
  repair: {
    missingPremise: '需要一句说明「为什么不是第三因素造成的」',
    alternativeReading: '用语用辩证的十规则看，这更像「把讨论前提当成了既定事实」',
    answerable: ['CQ2', 'CQ3'],
    burdenStatus: '主张方',
    repairedForm: null,
  },
  labels: [
    {
      id: 'post-hoc',
      name: '事后归因',
      nameEn: 'Post Hoc Ergo Propter Hoc',
      quote: '去年取消了早读，今年高考一本率下降了 6 个百分点',
      span: { start: 0, end: 30, quality: 'exact' },
      condition: '仅凭两件事一先一后就断言因果，既没给机制，也没排除其他原因',
      whenLegitimate: '当两件事之间的机制已被独立确认、且第三因素已被排除时，先后关系可以作为佐证',
      riskOfError: '最可能错在把同时发生的两件事当成因果；这一年里师资、生源、试题难度的变化都没有交代',
      landsOnCheck: 'CQ2',
      tradition: '非形式逻辑',
      tag: 'inferred',
      confidence: 'medium',
    },
    {
      id: 'ad-populum',
      name: '诉诸众人',
      nameEn: 'Argumentum ad Populum',
      quote: '很多家长也支持恢复早读，可见早读肯定有益',
      span: { start: 30, end: 52, quality: 'exact' },
      condition: '拿「多少人这么想」当「什么为真」的证据',
      whenLegitimate: '当问题本身就是「大家怎么想」时，民意就是答案，不是谬误',
      riskOfError: '最可能错在家长的支持可能出于作息便利而非对效果的判断',
      landsOnCheck: 'CQ3',
      tradition: '非形式逻辑',
      tag: 'inferred',
      confidence: 'low',
    },
  ],
  legitimateMoves: [
    {
      targetId: 'P1',
      quote: '去年取消了早读，今年高考一本率下降了 6 个百分点',
      what: '这是一句可核查的统计陈述',
      why: '陈述本身没有问题；出问题的是从它到结论的那一步',
      tag: 'known',
      confidence: 'high',
    },
    {
      targetId: 'P2',
      quote: '反对恢复早读的人，大概自己也不想早起吧',
      what: '它把对方的动机摆了出来，但没有用动机替代论证',
      why: '这一句本身不构成对主张的支撑，却也没把讨论带偏；真正的问题不在这里',
      tag: 'inferred',
      confidence: 'low',
    },
  ],
  refutations: [],
  selfCheck: {
    epi: {
      P1_source: 2,
      P2_context: 1,
      P3_position: 2,
      P4_withdrawal: 2,
      P5_selfApply: 1,
      P6_openness: 2,
      P7_steelman: 1,
      total: 11,
      vetoed: false,
      reading: 'legitimate',
      notes: [],
    },
    ruleAudit: [],
    unknowns: ['没有交代这一年里师资与生源的变化，所以共同原因这一条无从判断'],
    opennessNote: '名录是开放的，索引之外的名字一律不给',
    withdrawIf: ['若校方能给出这一年的其他变量数据，这份分析应当撤回'],
    underOtherLens: '换名录透镜看，「事后归因」仍是这个名字；换语用辩证看，这里会被判成「把未证成的前提当既定事实」。',
  },
  /*
   * 这条留痕是这份示例最该被读到的一处：它演示 G11 真的丢过一条。
   *
   * 名字是查谬误模式的主输出，而「丢弃」是这个模式最常见的结果之一。
   * 丢而不写，读者看到的是「找到 2 条」，不知道本来有 3 条、也不知道第 3 条为什么不算。
   */
  diagnostics: [
    {
      level: 'warn',
      code: 'LABEL_NO_LOCATION',
      message:
        '「稻草人」没有给出原文引文，已不显示。查谬误模式下，说不清是原文哪一句的名字只是贴标签。',
    },
  ],
  raw: { text: '{}', attempts: 1 },
};

/*
 * 编译产物落在 scripts/.out/ 下，所以这里要再上一级才是 scripts/。
 * 少一级会静默建出 scripts/scripts/.out/ 这个目录——文件照样写成功，
 * 只是没人找得到它。
 */
const OUT = resolve(import.meta.dirname, '../../scripts/.out');
mkdirSync(OUT, { recursive: true });
const md = reportToMarkdown(d);
writeFileSync(resolve(OUT, '示例-查谬误导出件.md'), md, 'utf-8');
console.log(md);
