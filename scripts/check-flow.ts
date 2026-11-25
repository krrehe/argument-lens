/**
 * 全流程账：二十步（v1.1 新增 F 段与 E4），做没做。
 *
 * 这一关守的不是「多了一栏」，是七种会让这一栏变成装饰的坏法：
 *
 *   1. 拿标准档的尺子量速判——一份 128 字的短文本被要求交出修辞审计与自审四问，
 *      于是每份报告都「缺 7 步」，读者看两次就不看了；
 *   2. 反过来，速判档就拿它当挡箭牌——明明做了的步骤被写成「这一档不走」，
 *      把做过的活也一起抹掉（所以判据是「先看证据，再看档位」）；
 *   3. 只看档位不看顺序——A 阶段没做完就给了档位，这是文档 §1 写死的失格，
 *      不能混在「二十格里缺一格」里说；
 *   4. 「没做」与「做不到」不分——本地没有依据的步骤（修辞审计三项）写「没做」，
 *      读者会以为再跑一次就能有；
 *   5. 只写状态不写证据——读者只能信这块板子，没法反驳；
 *   6. 立案三问被软件默认成「已答」——A2 于是永远显示「做过」，而谁都没做；
 *   7. 把「做了」说成「做对了」——状态是本地数出来的，判得准不准本地算不出来。
 *
 * 防恒真：样本里**故意**造出「快档/标准档」「有立案/没立案」「证据与档位相反」
 * 「顺序违规/不违规」四组对照。去掉档位分级、去掉顺序检查、把证据优先级反过来，
 * 对应断言立刻红。
 *
 * 跑法：npm run check:flow
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MODE_META, type Brief, type CheckItem, type Claim, type Diagnosis, type Divergence } from '@shared/types';
import { MOCK } from '../src/renderer/src/mock-data';
import {
  BRIEF_FIELD_MAX,
  briefAnswered,
  briefGaps,
  briefLine,
  briefNote,
  briefPending,
  normalizeBrief,
  objectRoute,
} from '@shared/brief';
import { flowOf, shapeOf } from '@shared/flow';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}
const src = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');

/* ─────────── 样本 ─────────── */

function cl(
  id: string,
  text: string,
  o: { supports?: string[]; implicit?: boolean; role?: Claim['role']; span?: boolean } = {}
): Claim {
  const role = o.role ?? 'premise';
  return {
    id,
    role,
    text,
    supports: o.supports ?? ['C'],
    quote: text,
    span: o.span === false ? null : { start: 0, end: 4, quote: text, quality: 'exact' },
    implicit: o.implicit ?? false,
    implicitBasis: o.implicit ? '若不假定 X，则从这条推不出 C' : null,
    burden: 'proponent',
    acceptability: {
      status: 'acceptable',
      reason: '样本',
      forAudience: '样本受众',
      tag: 'inferred',
      confidence: 'medium',
    },
  };
}

function cq(id: string, answer: CheckItem['answer']): CheckItem {
  return {
    id,
    system: 'walton-cq',
    label: `${id} 样本问题`,
    question: '样本问题？',
    meta: false,
    answer,
    basis: '样本依据',
    guards: '样本',
    landsOn: null,
  };
}

function ars(id: string, answer: CheckItem['answer']): CheckItem {
  return { ...cq(id, answer), system: 'ars', label: `${id} 样本` };
}

const FULL_BRIEF: Brief = {
  speaker: '城南小学校办',
  version: '2026-11 第一版',
  source: 'original',
  objectKind: 'argument',
  at: 1700000000000,
};

/** 短文本、单主张、没立案 —— 速判档。 */
const TINY: Diagnosis = {
  ...MOCK,
  id: 'tiny',
  passage: '取消早读以后，一本率掉了六个百分点。所以应当恢复早读。',
  brief: undefined,
  conclusion: { ...MOCK.conclusion, text: '应当恢复早读', supports: [] },
  premises: [cl('P1', '取消早读后一本率下降')],
  intermediate: [],
  checks: [cq('CQ1', 'passed')],
  refutations: [],
  repair: { ...MOCK.repair, missingPremise: null, repairedForm: null },
  selfCheck: { ...MOCK.selfCheck, withdrawIf: [], unknowns: [], underOtherLens: '' },
};

/** 六百字、多主张、有立案 —— 标准档。 */
const FULL: Diagnosis = {
  ...TINY,
  id: 'full',
  passage: '早'.repeat(600),
  brief: FULL_BRIEF,
  premises: [
    cl('P1', '取消早读后一本率下降'),
    cl('P2', '同期没有其他解释'),
    cl('P3', '家长反映作息变化', { implicit: true }),
    cl('P4', '该校历年一本率稳定', { supports: ['P1'] }),
  ],
  intermediate: [],
  checks: [cq('CQ1', 'passed'), cq('CQ2', 'unanswered'), cq('CQ3', 'violated')],
  refutations: [
    {
      ...MOCK.refutations[0],
      id: 'R1',
      targetId: 'P1',
      steelman: '对方会说：落差只有这一年出现。',
    },
  ],
  repair: { ...MOCK.repair, missingPremise: null, repairedForm: '若不假定同期无其他因素，则推不出结论' },
  selfCheck: MOCK.selfCheck,
};

/** ARS 透镜、登记为情绪 —— C1 做了、C2 做不了、A2 该拦。 */
const ARS: Diagnosis = {
  ...FULL,
  id: 'ars',
  theory: 'ars',
  lens: { kind: 'ars', burdenStandard: '样本', sufficiencyNote: '样本', gapAt: 'link' },
  checks: [ars('ARS-A', 'passed'), ars('ARS-R', 'passed'), ars('ARS-S', 'violated')],
  brief: { ...FULL_BRIEF, objectKind: 'expression' },
};

/** 一条前提都没有 —— B1/B3/B4/D2 该一起空。 */
const BARE: Diagnosis = {
  ...TINY,
  id: 'bare',
  premises: [],
  intermediate: [],
  checks: [],
};

/* ─────────── 一 · 立案：收得住，也拒绝装作收过 ─────────── */

ok(normalizeBrief(null) === null, '没传东西 → 不立案（不写空结构）');
ok(normalizeBrief(undefined) === null, 'undefined → 不立案');
ok(normalizeBrief('speaker') === null, '字符串不是立案');
ok(normalizeBrief([1, 2]) === null, '数组不是立案');
ok(normalizeBrief({}) === null, '四个字段全空 → 不立案（空结构会被当成「做过」）');
ok(normalizeBrief({ speaker: '   ', version: '', source: 'unknown', objectKind: 'unknown' }) === null, '全是空白 → 不立案');

const b1 = normalizeBrief({ speaker: '  张三 ', version: '', source: 'original', objectKind: 'argument' });
ok(b1 !== null && b1.speaker === '张三', '首尾空白剥掉');
ok(b1 !== null && b1.version === '', '没填的那一问照样是空（不补默认值）');
const b2 = normalizeBrief({ speaker: '张三', source: 'nonsense', objectKind: 'nonsense' });
ok(b2 !== null && b2.source === 'unknown' && b2.objectKind === 'unknown', '认不出的枚举收敛到 unknown，不抛错');
ok(normalizeBrief({ speaker: '张三' })?.objectKind === 'unknown', '只填了「谁说的」不默认成「说理文本」（A2 要的是人做的决定）');
ok(normalizeBrief({ speaker: '张三' })?.source === 'unknown', '只填了「谁说的」不默认成「原文」（第 3 问没答就是没答）');
const b3 = normalizeBrief({ speaker: '长'.repeat(BRIEF_FIELD_MAX + 50) });
ok(b3 !== null && b3.speaker.length === BRIEF_FIELD_MAX, `超长字段截到 ${BRIEF_FIELD_MAX}（防把整段话贴进「谁说的」）`);
const b4 = normalizeBrief({ speaker: '张三', at: Number.NaN });
ok(b4 !== null && typeof b4.at === 'number' && Number.isFinite(b4.at), '坏时间戳补成当下，不写 NaN');

ok(!briefAnswered(FULL_BRIEF).source === false, '原文算答了「第 3 问」');
ok(briefAnswered({ ...FULL_BRIEF, source: 'unknown' }).source === false, '「不清楚」不算答完第 3 问（它正是那一问的空答案）');
ok(briefGaps(FULL_BRIEF).length === 0, '三问齐全 → 不缺');
ok(briefGaps({ ...FULL_BRIEF, version: '' }).length === 1, '缺一问答一问');
ok(briefGaps({ ...FULL_BRIEF, version: '', source: 'unknown' }).length === 2, '缺两问答两问');
ok(objectRoute('argument') === null, '说理文本 → 就是全流程，不额外说明');
ok(objectRoute('expression') !== null, '情绪倾诉 → 有处置说明（不开庭）');
ok(objectRoute('value') !== null, '价值宣示 → 有处置说明（只判证成强度）');
ok(objectRoute('norm-doc') !== null, '规范文本 → 有处置说明（走要件分析）');
ok(briefLine(FULL_BRIEF).includes('城南小学校办') && briefLine(FULL_BRIEF).includes('原文'), '一句话里带谁说的与原文还是转述');
ok(briefLine({ ...FULL_BRIEF, speaker: '' }).includes('（没说谁）'), '没填谁说的就明写没说');
ok(briefNote(FULL_BRIEF).includes('三问答清'), '三问齐全时说的是「可以开工」');
ok(briefNote({ ...FULL_BRIEF, source: 'hearsay' }).includes('降一档'), '转述时说的是「信任度降一档」');
ok(briefNote({ ...FULL_BRIEF, version: '' }).includes('还缺 1 问'), '缺一问答「还缺 1 问」');

/* ─────────── 二 · B3 结构：链 / 合流 / 单线 / 读不出 ─────────── */

const sConf = shapeOf(FULL);
ok(sConf.kind === 'confluence', '三条各自直接指向结论 → 合流', sConf.kind);
ok(sConf.line.includes('合流') && sConf.line.includes('单点'), '合流的说明里带「不能因单点缺陷宣布整体失效」');
const sChain = shapeOf({ ...FULL, premises: [cl('P1', 'a'), cl('P2', 'b', { supports: ['P1'] })] });
ok(sChain.kind === 'chain', '一条直接到结论、另一条要经过它 → 链式', sChain.kind);
ok(sChain.line.includes('断一环'), '链式的说明里带「断一环全塌」');
const sSingle = shapeOf({ ...FULL, premises: [cl('P1', 'a')] });
ok(sSingle.kind === 'single', '只有一条前提 → 单线', sSingle.kind);
const sNone = shapeOf(BARE);
ok(sNone.kind === 'none', '一条前提都没有 → 结构读不出', sNone.kind);
const sDangling = shapeOf({ ...FULL, premises: [cl('P1', 'a', { supports: ['PX'] })] });
ok(sDangling.kind === 'none' && sDangling.via === 1, '指向不存在的主张 → 读不出，但记下它确实指了别处', `${sDangling.kind}/${sDangling.via}`);

/* ─────────── 三 · 档位：先看证据，再看这一档要不要它 ─────────── */

const fTiny = flowOf(TINY);
ok(fTiny.depth === 'quick', '短文本单主张 → 速判档', fTiny.depth);
ok(fTiny.depthLabel === '速判', '档位名照文档');
const fFull = flowOf(FULL);
ok(fFull.depth === 'standard', '六百字 → 标准档', fFull.depth);
ok(flowOf({ ...FULL, passage: '早'.repeat(3000) }).depth === 'audit', '三千字 → 全场审计档');
ok(flowOf({ ...FULL, intermediate: [cl('M1', 'm1', { role: 'intermediate' }), cl('M2', 'm2', { role: 'intermediate' })] }).depth === 'audit', '三个独立主张 → 全场审计档（§0.1 的「≥3 个主张」）');

ok(fTiny.rows.length === 20, 'v1.1 一共二十步（F 段三步 + E4）', String(fTiny.rows.length));
ok(fTiny.rows.map((r) => r.id).join(',') === 'A1,A2,A3,B1,B2,B3,B4,C1,C2,C3,D1,D2,D3,F-a,F-b,F-c,E1,E2,E3,E4', '顺序就是 v1.1 §1 的顺序（F 在 D 之后 E 之前）', fTiny.rows.map((r) => r.id).join(','));
ok(fTiny.rows[0].group === 'A' && fTiny.rows[19].group === 'E', '分组落位');
ok(fTiny.rows[13].group === 'F' && fTiny.rows[16].group === 'E', 'F 段三步排在 D 之后、E 之前（不是按字母序排最后）');
ok(Object.values(fTiny.counts).reduce((a, b) => a + b, 0) === 20, '四态相加等于总步数');

const tinyC1 = fTiny.rows.find((r) => r.id === 'C1');
ok(tinyC1?.status === 'na', '速判档没做 C1 → 「这一档不走」，不是「缺」', tinyC1?.status);
ok((tinyC1?.note ?? '').includes('速判'), '写明了为什么这一档不走它');
ok(fTiny.rows.find((r) => r.id === 'D3')?.status === 'na', '速判档也不要求修辞审计（否则每份短文本都缺 7 步）');

/*
 * 证据优先：同一步在速判档里「有」的时候，状态必须是做了，不是「这一档不走」。
 * 这一条是防「拿档位当挡箭牌」——做过的活被档位一句话抹掉，比不做更冤。
 */
const tinyRepair: Diagnosis = { ...TINY, repair: { ...TINY.repair, repairedForm: '改写成：若不同期比较，则不能说因果' } };
ok(flowOf(tinyRepair).rows.find((r) => r.id === 'E2')?.status === 'ok', '速判档里真给了加固版 → 仍算做了（档位不抹掉做过的事）');

/*
 * v1.1 同一条边界，换到 F 段再验一次：§0.1 说速判「默认收束＝单判、不走 F 段」，
 * 但那说的是**没登记时**不拿多方案矩阵去为难一份 128 字的短报告；
 * 人真填了判定坐标与收敛条件，档位就不能把做过的四格抹成「这一档不走」。
 * 真机跑道上这条曾写反过（拿 quick 去要求 na），两边一起钉死。
 */
const FULL_DIVERGENCE: Divergence = {
  frame: { formal: 'classical', criterion: 'scheme-cq', dimension: 'dialectic', protocol: 'inquiry' },
  closure: 'fork',
  branches: 2,
  entries: [{ at: 'B2 补 A：宽读与严读', source: 'F2', stakes: 'level' }],
  common: '两读都同意：支撑不足',
  difference: '补出的 A 与选中的型式',
  condition: '给出原始出处只剩宽读；只给二手转述只剩严读',
  basis: '宽读：第 3 句 + 未过 CQ；严读：第 3 句 + 未过 CQ',
  decidable: '',
  burden: '',
  at: 1,
};
const tinyFork = flowOf({ ...TINY, divergence: FULL_DIVERGENCE });
const fIds = ['F-a', 'F-b', 'F-c', 'E4'];
ok(
  fIds.every((id) => tinyFork.rows.find((r) => r.id === id)?.status === 'ok'),
  '速判档里真登记了分歧账 → F 三步与 E4 仍算做了（默认不抹掉人填的）',
  fIds.map((id) => `${id}:${tinyFork.rows.find((r) => r.id === id)?.status}`).join(',')
);
ok(
  fIds.every((id) => fTiny.rows.find((r) => r.id === id)?.status === 'na'),
  '速判档没登记时 F 三步与 E4 是「这一档不走」，不是「缺」',
  fIds.map((id) => `${id}:${fTiny.rows.find((r) => r.id === id)?.status}`).join(',')
);

/* 标准档：同样的 C1 就没做，于是是缺。 */
ok(fFull.rows.find((r) => r.id === 'C1')?.status === 'gap', '标准档没做 C1 → 缺', fFull.rows.find((r) => r.id === 'C1')?.status);

/* ─────────── 四 · 每一步的证据：有就写有，没有就写没有 ─────────── */

const row = (v: ReturnType<typeof flowOf>, id: string) => v.rows.find((r) => r.id === id);

ok(row(fFull, 'A1')?.status === 'ok', '完整立案 → A1 做了');
ok((row(fFull, 'A1')?.saw ?? '').includes('三问答清'), 'A1 写明三问答清');
ok(row(flowOf({ ...FULL, brief: { ...FULL_BRIEF, version: '' } }), 'A1')?.status === 'partial', '少一问 → A1 只做了一半');
ok(row(fFull, 'A2')?.status === 'ok' && (row(fFull, 'A2')?.saw ?? '').includes('说理'), 'A2 登记为说理 → 做了');
const fExpr = flowOf(ARS);
ok(row(fExpr, 'A2')?.status === 'ok' && (row(fExpr, 'A2')?.note ?? '').includes('越界'), '登记为情绪但仍给了判定 → 做了，且点名这是越界的那一侧');
ok(row(flowOf(TINY), 'A2')?.status === 'gap', '没登记 → A2 是缺');

ok(row(fFull, 'B1')?.status === 'ok', '四条前提且都有落点 → B1 做了');
ok(row(flowOf({ ...FULL, premises: [cl('P1', 'a', { span: false })] }), 'B1')?.status === 'partial', '有一条没落点 → B1 一半');
ok(row(flowOf(BARE), 'B1')?.status === 'gap', '一条前提都没有 → B1 是缺');

ok(row(fFull, 'B2')?.status === 'ok', '有补出的前提 → B2 做了');
ok(row(flowOf({ ...FULL, premises: FULL.premises.map((p) => ({ ...p, implicit: false, implicitBasis: null })) }), 'B2')?.status === 'gap', '没补任何前提 → B2 是缺（并说明「可能不需要」）');
ok((row(flowOf({ ...FULL, premises: FULL.premises.map((p) => ({ ...p, implicit: false })) }), 'B2')?.note ?? '').includes('不需要补'), '缺的时候不武断：说可能确实不需要');
ok(row(flowOf({ ...FULL, premises: FULL.premises.map((p) => ({ ...p, implicit: false, implicitBasis: null })), repair: { ...FULL.repair, missingPremise: '缺一条中介' } }), 'B2')?.status === 'partial', '只在修补里指出缺前提 → B2 一半（指出缺什么与补出它是两步）');

ok(row(fFull, 'B3')?.status === 'ok' && (row(fFull, 'B3')?.saw ?? '').includes('合流'), 'B3 用的是本地读出的结构');
ok(row(flowOf({ ...BARE, passage: '早'.repeat(600) }), 'B3')?.status === 'gap', '没有前提 → B3 是缺');

ok(row(fFull, 'B4')?.status === 'ok', '有前提 → 枢纽这一栏有候选');
ok(row(flowOf(BARE), 'B4')?.status === 'gap', '没有前提 → 枢纽是缺');

ok(row(fExpr, 'C1')?.status === 'ok', 'ARS 三问答完 → C1 做了');
ok(row(flowOf({ ...ARS, checks: [ars('ARS-A', 'passed'), ars('ARS-R', 'unanswered')] }), 'C1')?.status === 'partial', '三问有一条没答 → C1 一半');
ok(row(fFull, 'C2')?.status === 'ok' && (row(fFull, 'C2')?.saw ?? '').includes('型式'), '型式透镜 → C2 做了');
ok(row(fExpr, 'C2')?.status === 'gap', 'ARS 透镜没有型式 → C2 是缺');
ok((row(fExpr, 'C2')?.next ?? '').includes('型式'), '缺的时候给出具体下一步（换哪副透镜）');
ok(row(fFull, 'C3')?.status === 'partial', 'CQ 有「文中没交代」→ C3 一半');
ok(row(flowOf({ ...FULL, checks: [cq('CQ1', 'passed'), cq('CQ2', 'violated')] }), 'C3')?.status === 'ok', 'CQ 全部答了 → C3 做了');
ok(row(flowOf({ ...FULL, checks: [] }), 'C3')?.status === 'gap', '没有 CQ → C3 是缺');

ok(row(fFull, 'D1')?.status === 'ok', '诊断模式给了档位 → D1 做了');
ok(row(flowOf({ ...FULL, mode: 'reconstruct' }), 'D1')?.status === 'na', '重构模式本来不给档位 → D1 是「这一档不走」');
ok(row(flowOf({ ...FULL, verdict: { ...FULL.verdict, level: 'undetermined' } }), 'D1')?.status === 'partial', '档位停在「无法判断」→ 一半（合法，但要说清为什么）');
ok((row(fFull, 'D1')?.note ?? '').includes('D0–D5'), 'D1 明说文档的六档与本软件四档不是一套刻度');

ok(row(fFull, 'D2')?.status === 'ok', '命题账有分栏 → D2 做了');

const d3 = row(fFull, 'D3');
ok(d3?.status === 'partial', '修辞审计只有「程度夸大」本地核得动 → 一半', d3?.status);
ok((d3?.note ?? '').includes('三诉求') && (d3?.note ?? '').includes('传播条件'), 'D3 点名缺的是哪三项（不是一句「没做」）');

ok(row(fFull, 'E1')?.status === 'partial', '有反驳但不等于「最强一击」→ 一半');
ok((row(fFull, 'E1')?.note ?? '').includes('最强一击'), 'E1 说清差在哪一层');
ok(row(flowOf({ ...FULL, refutations: [] }), 'E1')?.status === 'gap', '没有反驳 → E1 是缺');

ok(row(fFull, 'E2')?.status === 'ok' && (row(fFull, 'E2')?.saw ?? '').includes('加固版'), '给了加固版 → E2 做了');
ok(row(flowOf({ ...FULL, repair: { ...FULL.repair, repairedForm: null } }), 'E2')?.status === 'gap', '没给加固版 → E2 是缺');

ok(row(fFull, 'E3')?.status === 'partial', '自审有可推翻条件 → 一半（第 3 问没人答）');
ok((row(fFull, 'E3')?.note ?? '').includes('第 3 问') || (row(fFull, 'E3')?.note ?? '').includes('第四问'), 'E3 点名缺的是那一问');
ok(row(flowOf({ ...FULL, selfCheck: { ...FULL.selfCheck, withdrawIf: [], unknowns: [], underOtherLens: '' } }), 'E3')?.status === 'gap', '自审全空 → E3 是缺');

/* ─────────── 五 · 顺序：A 没做完就进了 B，要单独说 ─────────── */

const fNoBrief = flowOf({ ...FULL, brief: undefined });
ok(fNoBrief.breach !== null, '没立案却给了档位 → 顺序违规');
ok((fNoBrief.breach ?? '').includes('判在立案之前'), '违规那句话点名「判在立案之前」');
ok((fNoBrief.breach ?? '').includes('A1'), '点名是 A 的哪一步没做');
ok((fNoBrief.breach ?? '').includes('降一档') || (fNoBrief.breach ?? '').includes('低一档'), '说清后果：结论只能算基于转述、信任度降一档');

ok(flowOf(FULL).breach === null, '三问答清 → 没有顺序违规');
/* 速判档不走 A1，不能拿它算失格；但 A2 在速判档里是必须的。 */
ok(flowOf({ ...TINY, brief: { ...FULL_BRIEF } }).breach === null, '速判档 + 三问答清 → 不违规（A1 本来不在这一档）');
ok(flowOf(TINY).breach !== null, '速判档也需要 A2 准入，没登记就是违规');

/* 只走到 A 就停的报告不算「抢跑」：后面一步都没走，谈不上顺序。 */
const onlyA: Diagnosis = {
  ...TINY,
  mode: 'reconstruct',
  theory: 'ars',
  lens: { kind: 'ars', burdenStandard: '样本', sufficiencyNote: '样本', gapAt: 'none' },
  premises: [],
  checks: [],
  refutations: [],
  verdict: { ...TINY.verdict, level: 'undetermined' },
};
ok(flowOf(onlyA).breach === null, '后面一步都没走 → 不说「抢跑」');

/* ─────────── 六 · 总述与fine print：数出来的，不是评出来的 ─────────── */

ok(fFull.line.includes('标准') && fFull.line.includes('20 步'), '总述带档位与步数', fFull.line);
ok(fFull.line.includes(String(fFull.counts.ok)), '总述里的「走了 N 步」与计数一致');
ok(fFull.fine.includes('做没做'), '边界说明写明只数做没做');
ok(fFull.fine.includes('算不出来'), '边界说明写明不判做得对不对（判得准不准本地算不出来）');
ok(!/score|总分|及格|百分比/.test(src('src/shared/flow.ts')), '纯函数里没有分数、总分、及格线');
ok(fFull.fine.includes('分流'), '明说「分流」在这一版里判不了（不假装判了）');
const fAudit = flowOf({ ...FULL, passage: '早'.repeat(3000) });
ok(fAudit.fine.includes('台账') && !fAudit.rows.some((r) => r.id === 'T'), '全场审计档提一句台账，但不虚设第十七格');

const once = JSON.stringify(flowOf(FULL));
ok(once === JSON.stringify(flowOf(FULL)), '同一份报告算两次结果一致（纯函数）');
const snapshot = JSON.stringify(FULL);
flowOf(FULL);
ok(JSON.stringify(FULL) === snapshot, 'flowOf 不改报告一个字段');

ok(!JSON.stringify(fFull).includes('"score"'), '输出里没有 score 字段');

/* ─────────── 七 · 接线：界面上真看得见、导出件里真带得走 ─────────── */

const diagTsx = src('src/renderer/src/components/Diagnosis.tsx');
const ovTsx = src('src/renderer/src/components/Overview.tsx');
const appTsx = src('src/renderer/src/App.tsx');
const mkTsx = src('src/renderer/src/mock.tsx');
const mdTs = src('src/shared/report-markdown.ts');
const preloadTs = src('src/preload/index.ts');
const mainTs = src('src/main/index.ts');
const analyzeTs = src('src/main/analyze.ts');
const briefTsx = src('src/renderer/src/components/BriefCard.tsx');

ok(diagTsx.includes('id="sec-flow"'), '报告里有这一节');
ok(diagTsx.includes('<FlowLedger v={flow} />'), '这一节真的渲染了组件');
ok(diagTsx.indexOf('id="sec-repair"') < diagTsx.indexOf('id="sec-flow"'), '放在附录：修补之后（先看结论与补法，再核对流程是否跳过）');
ok(diagTsx.includes('id="sec-selfcheck"'), '自检有落点（E3 的「看这一节」点得过去）');
ok(/flowOf\(d\)/.test(diagTsx), '界面用的是同一份纯函数');

ok(/id: 'sec-flow'/.test(ovTsx), '「跳到」条里有这一格');
ok(diagTsx.includes('id="sec-flow"'), '这一格的落点存在（不是死入口）');

ok(mdTs.includes('## 全流程走了哪几步'), '导出件里有这一节');
ok(/flowOf\(d\)/.test(mdTs), '导出件调的是同一份纯函数');
ok(mdTs.indexOf('## 全流程走了哪几步') < mdTs.indexOf('## 判定'), '导出件里它也在判定之前');
ok(mdTs.includes('立案：'), '导出件抬头带立案那一行');
ok(mdTs.includes('没有记录谁说的'), '没立案时导出件明写，而不是留空');

ok(/text === passage\.trim\(\) \? brief : null/.test(appTsx), '只有「跑的就是框里这段字」时才带上立案');
ok(/setBrief\(\(b\) => \(b \? null : b\)\)/.test(appTsx) && /\[passage\]/.test(appTsx), '原文一改，立案作废');
ok(briefTsx.includes('data-brief-field="speaker"') && briefTsx.includes('data-brief-field="version"'), '两个输入框带探针属性');
ok(briefTsx.includes('data-brief-source=') && briefTsx.includes('data-brief-object='), '两组选择带探针属性');

ok(/ipcRenderer\.invoke\('analysis:run'[\s\S]{0,140}brief/.test(preloadTs), 'preload 把立案传过去');
ok(/brief\?: unknown/.test(mainTs) && /brief, divergence \}/.test(mainTs), '主进程收下立案与分歧账');
ok(/normalizeBrief\(opts\.brief\)/.test(analyzeTs), '主进程用同一个收口函数');
ok(
  analyzeTs.indexOf('diagnosis.raw = {') < analyzeTs.indexOf('normalizeBrief(opts.brief)'),
  '立案贴在解析与裁决之后（它不参与任何判定）'
);
ok(/data-flow-line/.test(src('src/renderer/src/components/FlowLedger.tsx')), '总述那一句带探针属性');
ok(/data-flow-row=\$\{?r\.id\}?/.test(src('src/renderer/src/components/FlowLedger.tsx')) || /data-flow-row=\{r\.id\}/.test(src('src/renderer/src/components/FlowLedger.tsx')), '每一步带编号探针');
ok(/data-status=\{r\.status\}/.test(src('src/renderer/src/components/FlowLedger.tsx')), '每一步带状态探针');
ok(/\?brief=/.test(mkTsx) || /get\('brief'\)/.test(mkTsx), '预览页有 ?brief= 入口（两种状态都拍得到）');


/* ─────────── 八 · 这一步点得过去，填了也算数 ─────────── */

/*
 * 这一组守的不是「有没有这一栏」，而是「这一栏说的话能不能兑现」。两种不兑现：
 *   ① 账本说「在输入区填立案」，而输入区在另一块屏上——没有入口，那句话只是事后评语；
 *   ② 按了「看这一节」，那一栏这一份报告里根本没有（反驳按模式开关、命题账与枢纽按数据）——
 *      跳转失败最像「软件卡了一下」，人不会想到是那一栏不存在。
 * 还有第三种，是这一组最要紧的：**填了不算数**。立案只在跑的那一刻进报告，
 * 填完不重跑，报告一个字都不会变，而人的记忆里是「我明明填了」。
 */
const fA1 = fFull.rows.find((r) => r.id === 'A1')!;
const fA2 = fFull.rows.find((r) => r.id === 'A2')!;
const fD1 = fFull.rows.find((r) => r.id === 'D1')!;
ok(fA1.at === 'brief-card' && fA2.at === 'brief-card', 'A 那两步指向输入区的立案卡', `${fA1.at}/${fA2.at}`);
ok(fA1.goLabel === '去填立案' && fA2.goLabel === '去填立案', '按钮写「去填立案」，不写「看这一节」', fA1.goLabel);
ok(fD1.goLabel === '看这一节' && fD1.at === 'sec-verdict', '其余各步仍然指向报告里的栏', `${fD1.at}/${fD1.goLabel}`);

const ledgerTs = src('src/renderer/src/components/FlowLedger.tsx');
ok(/getElementById\(r\.at\)/.test(ledgerTs), '落点在不在，挂载后当场看一眼');
ok(/here\[r\.at\] \? r\.at : null/.test(ledgerTs), '不在就不给按钮（不留点了没反应的入口）');
ok(/dispatchEvent\(new CustomEvent\('al:brief'\)\)/.test(ledgerTs), '立案卡走 al:brief，不走报告里的 al:unfold');

const bfTsx = src('src/renderer/src/components/BriefCard.tsx');
ok(/id="brief-card"/.test(bfTsx), '立案卡有固定 id（账本的落点指它）');
ok(/data-brief-pend="1"/.test(bfTsx), '「填了还没生效」那一句有探针');
ok(/再跑一次/.test(bfTsx), '那一句说的是「再跑一次」，不是「已更新」');

const appTs = src('src/renderer/src/App.tsx');
ok(/addEventListener\('al:brief'/.test(appTs) && /setBriefOpen\(true\)/.test(appTs), '收到 al:brief 就展开并滚过去');
ok(/pending=\{briefPending\(diag\?\.brief, brief\)\}/.test(appTs), '报告里那份立案与输入区这份比过才提醒');
ok(/open=\{briefOpen\}/.test(appTs) && /onToggle=/.test(appTs), '展开状态归 App 管（账本要能打开它）');

const bA: Brief = { speaker: '张三', version: '初稿', source: 'original', objectKind: 'argument', at: 1 };
ok(briefPending(null, bA) === true, '报告里没有立案，而输入区填了 → 要提醒');
ok(briefPending(bA, null) === false, '报告里有、输入区空着 → 不提醒（输入区管的是下一次）');
ok(briefPending(bA, { ...bA }) === false, '同一份 → 不说话');
ok(briefPending(bA, { ...bA, speaker: '李四' }) === true, '改了一个字就是另一份 → 要提醒');
ok(briefPending({ ...bA, at: 999 }, bA) === false, '时间戳不算差别（比它等于永远不一样）');

/* 反驳栏的开关只能有一个定义处：两处各写一份，加第六个模式时必然只改一处。 */
const diagTs = src('src/renderer/src/components/Diagnosis.tsx');
ok(!/showRef/.test(diagTs), '渲染层不再自己写 showRef');
ok(/MODE_META\[d\.mode\]\.showsRefute/.test(diagTs), '反驳栏读 MODE_META 那一个开关');
const typesTs = src('src/shared/types.ts');
ok(/showsRefute: boolean;/.test(typesTs), '开关定义在 ModeMeta 里');
ok((typesTs.match(/showsRefute: (true|false),/g) || []).length === 6, '六个模式各有一个取值');
ok(
  MODE_META.fallacy.showsRefute === false && MODE_META.reconstruct.showsRefute === false,
  '这两个模式不给反驳栏：E1 的落点因此不存在，账本也不再给按钮',
);
ok(MODE_META.diagnose.showsRefute === true && MODE_META.deep.showsRefute === true && MODE_META.interrogate.showsRefute === true, '另外四个模式仍然有反驳栏');

/* ─────────── 收口 ─────────── */

if (failed.length) {
  console.error(`\n✗ 全流程账：${failed.length} 条没过\n`);
  for (const f of failed) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`✓ 全流程账：${passed} 条`);
