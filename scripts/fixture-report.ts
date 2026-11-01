/**
 * 构造样本工厂。
 *
 * `check:prescriptions` 与 `check:report` 都要造报告来验证「检查器本身是否有效」，
 * 而两份脚本各写一个工厂，迟早会出现「一边加了字段、另一边没加」——
 * 那时两边跑的是不同的样本，断言全绿也说明不了什么。
 *
 * 所以工厂只此一份。它不追求字段齐全，只追求**能让被检查的那几处真的出现**：
 * 想测「两条前提指向同一句」，就得让 span.start 相等；想测「悬空引用」，
 * 就得让 cuts 里写一个不存在的编号。
 */
import type {
  CheckAnswer,
  CheckItem,
  Claim,
  Diagnosis,
  LabelCandidate,
  Refutation,
} from '@shared/types';

export function checkItem(id: string, answer: CheckAnswer, guards: string, label = id): CheckItem {
  return {
    id,
    system: 'walton-cq',
    label,
    question: `${label} 的问题`,
    meta: false,
    answer,
    basis: answer === 'passed' ? '文中写了' : '',
    guards,
    landsOn: null,
  };
}

export function claim(id: string, role: Claim['role'], text: string, start = 0): Claim {
  const span = { start, end: start + text.length, quote: text, quality: 'exact' as const };
  return {
    id,
    role,
    text,
    supports: [],
    quote: text,
    span,
    implicit: false,
    implicitBasis: null,
    burden: 'proponent',
    acceptability: { status: 'acceptable', reason: '样本', forAudience: '样本', tag: 'argued', confidence: 'medium' },
  };
}

export function refutation(id: string, targetId: string, patch: Partial<Refutation> = {}): Refutation {  return {
    id,
    targetId,
    checkId: null,
    strategy: 'premise-unsupported',
    claim: `${id} 的说法`,
    script: '',
    steelman: '对方可能答：……',
    reply: '',
    evidenceNeeded: [],
    burdenAfter: 'proponent',
    tag: 'argued',
    confidence: 'medium',
    ...patch,
  };
}

/**
 * 一条命名候选。
 *
 * 默认带 quote 与 span——因为查谬误模式生成的命名一定带位置（G11 保证），
 * 样本要是缺了这一栏，测出来的就不是「检查器能不能抓住坏报告」，
 * 而是「样本自己是不是坏的」。
 */
export function labelItem(patch: Partial<LabelCandidate> = {}): LabelCandidate {
  const quote = patch.quote === undefined ? '取消早读之后一本率下降' : patch.quote;
  return {
    id: 'post-hoc',
    name: '事后归因',
    nameEn: 'Post Hoc Ergo Propter Hoc',
    quote,
    span: quote ? { start: 0, end: quote.length, quote, quality: 'exact' as const } : null,
    condition: '仅凭时间先后断言因果，未排除其他原因',
    whenLegitimate: '机制已知且排除了主要干扰变量时，由先后推因果是正当的',
    riskOfError: '把「证据不足」当成「推理错误」',
    landsOnCheck: 'CQ2',
    tradition: 'walton',
    tag: 'framework',
    confidence: 'medium',
    ...patch,
  };
}

export function diag(patch: Partial<Diagnosis> = {}): Diagnosis {
  const base = {
    version: 2,
    id: 'test',
    parentId: null,
    mode: 'diagnose',
    theory: 'walton',
    createdAt: 0,
    passage: '取消早读之后一本率下降。',
    context: {
      issue: '取消早读是不是错的',
      speakerPosition: '应当恢复早读',
      opposingPosition: null,
      dialogueType: 'persuasion',
      dialogueTypeBasis: '在说服读者',
      stage: 'argumentation',
      audience: '一般读者',
      audienceKind: 'general',
      contextGaps: [],
    },
    scope: { applicable: true, reason: '适用', outOfScopeAt: null, partialNote: null },
    conclusion: claim('C', 'conclusion', '取消早读是错的', 0),
    premises: [],
    intermediate: [],
    checks: [],
    lens: { kind: 'walton', schemeId: 'correlation-causation', schemeName: '相关—因果', candidates: [] },
    defeat: {
      kind: 'undermining',
      checkId: 'CQ2',
      cuts: '切断 P1 与 C 之间的因果联结',
      explanation: '缺一环',
      tag: 'argued',
      confidence: 'medium',
    },
    verdict: {
      scale: '量表',
      scaleValue: '削弱',
      level: 'weakened',
      statement: '被削弱',
      qualification: '',
      whatIsRefuted: 'argument-only',
    },
    repair: { missingPremise: null, alternativeReading: null, answerable: [], burdenStatus: '', repairedForm: null },
    labels: [],
    legitimateMoves: [],
    refutations: [],
    selfCheck: {
      epi: {
        P1_source: 1,
        P2_context: 1,
        P3_position: 1,
        P4_withdrawal: 1,
        P5_selfApply: 1,
        P6_openness: 1,
        P7_steelman: 1,
        total: 7,
        vetoed: false,
        reading: 'overreach',
        notes: [],
      },
      ruleAudit: [],
      unknowns: [],
      opennessNote: '',
      withdrawIf: [],
      underOtherLens: '',
    },
    diagnostics: [],
    prompt: '',
  };
  return { ...base, ...patch } as unknown as Diagnosis;
}
