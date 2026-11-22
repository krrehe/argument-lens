/**
 * 「挑图」的断言：这份报告能画哪几张、这次显示哪几张。
 *
 * 为什么值得单开一条检查：这一层管的是**哪些图出现在报告里**。
 * 它出错的三种方式，每一种都不会报错：
 *   1. 画不出的图被静默过滤 → 读者分不清「这份没有反驳」与「这个功能坏了」；
 *   2. 存的选择被当成垃圾重置 → 用户每次打开都得重关一遍，最后干脆不关了；
 *   3. 用户全关之后被「好心」恢复默认 → 他做的选择被推翻，而界面看起来完全正常。
 *
 * 防恒真写在样本里，不写在注释里：
 *   - 「倒序输入变正序」配一份正序输入，两串结果必须不同——否则这条在「压根没排序」时也绿；
 *   - 「分母是可画的张数」配一份无反驳报告与一份有反驳报告，两个分母必须不同；
 *   - 「全关不恢复默认」配一份默认选择，两者结果必须不同。
 *
 * 跑法：npm run check:views
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeDiagnosis } from '../src/main/analyze';
import type { CheckItem, Claim, Conclusion, Diagnosis, Refutation, Scope } from '@shared/types';
import {
  DEFAULT_VIEWS,
  VIEW_ORDER,
  normalizeViews,
  sanitizeViews,
  specOf,
  viewCountLine,
  viewStateText,
  viewsOf,
  type ViewId,
  type ViewSpec,
} from '@shared/views';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}

const SRC = (p: string) => readFileSync(resolve(p), 'utf-8');
const DIAG = SRC('src/renderer/src/components/Diagnosis.tsx');
const BAR = SRC('src/renderer/src/components/ViewBar.tsx');
const OV = SRC('src/renderer/src/components/Overview.tsx');
const MORE = SRC('src/renderer/src/components/DiagramMore.tsx');

/* ─────────── 样本 ─────────── */

const P = '我们学校去年取消了早读，今年高考一本率下降了六个百分点。这说明取消早读是错的。';

const ACC = { status: 'acceptable' as const, reason: '' };
const claim = (id: string, role: Claim['role'], text: string, supports: string[] = []): Claim => ({
  id,
  role,
  text,
  supports,
  quote: null,
  span: null,
  implicit: false,
  implicitBasis: null,
  burden: 'proponent',
  acceptability: ACC,
});
const conclusion = (id: string, text: string): Conclusion => ({
  ...claim(id, 'conclusion', text),
  modalOverreach: false,
  modalNote: '',
});
const ref = (id: string, targetId: string, strategy: Refutation['strategy'], checkId: string | null = null): Refutation => ({
  id,
  targetId,
  checkId,
  strategy,
  claim: '这一条打的是某个位置',
  script: '话术',
  steelman: '对方会回',
  reply: '我方接法',
  evidenceNeeded: [],
  burdenAfter: 'proponent',
  tag: 'inferred',
  confidence: 'medium',
});
const item = (id: string): CheckItem => ({
  id,
  system: 'walton-cq',
  label: `第 ${id} 条`,
  question: '这一关问什么',
  meta: false,
  answer: 'answered',
  basis: '依据',
  guards: '守着某处',
  landsOn: null,
});

const base = normalizeDiagnosis({}, P, 'walton', { mode: 'diagnose', id: 'v1', createdAt: 1 });

/** 一份「什么都画得出」的报告：拿去当对照组，任何过滤都不该在这里发生。 */
const FULL: Diagnosis = {
  ...base,
  premises: [claim('P1', 'premise', '去年取消了早读', ['C']), claim('P2', 'premise', '今年一本率下降六点', ['C'])],
  conclusion: conclusion('C', '取消早读是错的'),
  checks: [item('CQ1'), item('CQ2')],
  scope: { applicable: true, reason: '是论证', outOfScopeAt: null, partialNote: null } as Scope,
  refutations: [ref('R1', 'P1', 'premise-unsupported'), ref('R2', 'C', 'alternative-explanation', 'CQ1')],
  repair: {
    missingPremise: '若取消早读，则一本率会下降',
    alternativeReading: null,
    answerable: ['同期有没有别的教学安排变动'],
    burdenStatus: '在提议者',
    repairedForm: 'P1；P2；若取消早读则一本率下降 ∴ C',
  },
};

/** 只差「没有前提」：结构图画不出，其余都画得出。 */
const NO_CLAIMS: Diagnosis = { ...FULL, premises: [], intermediate: [] };

/** 只差「透镜判了不适用」：逐关检查画不出。 */
const OUT_SCOPE: Diagnosis = { ...FULL, scope: { ...FULL.scope, applicable: false, reason: '这段不是论证' } };

/** 只差「没有反驳」：反驳落点画不出。 */
const NO_REF: Diagnosis = { ...FULL, refutations: [] };

/** 只差「没给补法」：修补对照画不出。 */
const NO_REPAIR: Diagnosis = { ...FULL, repair: { ...FULL.repair, missingPremise: null, repairedForm: null } };

/** 只给了「补完的写法」、没给缺失前提：仍算画得出（两个字段任一）。 */
const ONLY_FORM: Diagnosis = { ...FULL, repair: { ...FULL.repair, missingPremise: null } };

const V_FULL = viewsOf(FULL);

/* ─────────── 一、画得出哪几张 ─────────── */

ok(V_FULL.length === 5, '五张图一律列出来（画不出的不走静默过滤）', `实际 ${V_FULL.length}`);
ok(
  V_FULL.map((v) => v.id).join(',') === VIEW_ORDER.join(','),
  '清单顺序固定为 VIEW_ORDER，不随点数变',
  V_FULL.map((v) => v.id).join(','),
);
ok(V_FULL.every((v) => v.blocked === null), '这份样本五张全画得出（对照组：过滤不该在这里发生）');
/* 上面那条只能在「对照组完整」时验五种齐全；「画不出的也照样列出来」得在没有数据的样本上验，
   否则过滤实现照样绿（全可画时过滤等于没过滤）。 */
ok(viewsOf(NO_REF).length === 5, '没有反驳的报告里清单仍是五项（画不出的不被吞掉）', String(viewsOf(NO_REF).length));
ok(viewsOf(NO_CLAIMS).length === 5, '没有前提的报告里清单仍是五项', String(viewsOf(NO_CLAIMS).length));
ok(
  viewsOf(NO_REF).some((v) => v.id === 'refute' && typeof v.blocked === 'string'),
  '没有反驳时那一项仍在清单里，只是标了原因（不是消失）',
);
ok(
  specOf(V_FULL, 'structure')?.blocked === null,
  '有前提时结构图可画（与「没有前提时画不出」成对——只验一头，结构图恒不可画也会绿）',
);

/*
 * 守卫：下面的断言都建立在「对照组五张全可画」上。
 * 对照组一旦破了，会有十几条断言连带变红（分母从 5 变 4、计数行对不上…），
 * 读日志的人看到一片红，反而看不见真正坏掉的那一条。
 * 「判据脚本崩掉」与「判据失效」长得一样，这一行是为了让它们长得不一样。
 */
const broken = V_FULL.filter((v) => v.blocked !== null).map((v) => `${v.id}（${v.blocked}）`);
if (broken.length) {
  console.error(`
check:views 失败：对照组不成立——「什么都画得出」的样本里这几张被标成画不出：${broken.join('；')}`);
  process.exit(1);
}

const vNoClaims = viewsOf(NO_CLAIMS);
/*
 * 判「画不出」必须写成「原因是一个字符串」，不能写「不等于 null」：
 * 后者在图整个被过滤掉（清单里没有这一项）时也成立——那正好是这一层最坏的坏法。
 * 反证时验证过：把 blocked 改成过滤返回值，`!== null` 的写法全绿。
 */
ok(
  typeof specOf(vNoClaims, 'structure')?.blocked === 'string',
  '没有前提时结构图标为画不出',
  String(specOf(vNoClaims, 'structure')?.blocked),
);
ok(
  (specOf(vNoClaims, 'structure')?.blocked ?? '').includes('没有拆出可用的前提'),
  '画不出的原因写的是「没有前提」，不是「出错了」',
);
ok(specOf(vNoClaims, 'verdict')?.blocked === null, '没有前提时判读刻度照样画得出（判不了也是一条结论）');

const vOut = viewsOf(OUT_SCOPE);
ok(typeof specOf(vOut, 'checks')?.blocked === 'string', '透镜判不适用时逐关检查标为画不出');
ok((specOf(vOut, 'checks')?.blocked ?? '').includes('不适用'), '原因写明「不适用」，不是「没数据」');

/* 适用了、但确实没有检查项：与「不适用」必须分开说。 */
const vNoChecks = viewsOf({ ...FULL, checks: [] });
ok(typeof specOf(vNoChecks, 'checks')?.blocked === 'string', '适用但没有检查项时也标画不出');
ok(
  (specOf(vNoChecks, 'checks')?.blocked ?? '').includes('没有检查项'),
  '「没有检查项」与「不适用」是两句不同的话',
  String(specOf(vNoChecks, 'checks')?.blocked),
);
ok(
  (specOf(vNoChecks, 'checks')?.blocked ?? '') !== (specOf(vOut, 'checks')?.blocked ?? ''),
  '两种画不出的原因确实不同（不是同一句套话）',
);

const vNoRef = viewsOf(NO_REF);
ok(typeof specOf(vNoRef, 'refute')?.blocked === 'string', '没有反驳时反驳落点标为画不出');
ok((specOf(vNoRef, 'refute')?.blocked ?? '').includes('没有生成反驳'), '原因写明「没有生成反驳」');

const vNoRepair = viewsOf(NO_REPAIR);
ok(typeof specOf(vNoRepair, 'repair')?.blocked === 'string', '既无缺失前提又无补完写法时修补对照标为画不出');
ok(
  specOf(viewsOf(ONLY_FORM), 'repair')?.blocked === null,
  '只有「补完的写法」也能画（两个字段任一即可）',
);

/* ─────────── 二、存的选择怎么落地 ─────────── */

ok(DEFAULT_VIEWS.length === 3, '默认三张', DEFAULT_VIEWS.join(','));
ok(
  DEFAULT_VIEWS.every((id) => (VIEW_ORDER as string[]).includes(id)),
  '默认三张都在合法清单里',
);
ok(sanitizeViews(null).join(',') === DEFAULT_VIEWS.join(','), '没存过 → 默认三张');
ok(sanitizeViews('不是数组').join(',') === DEFAULT_VIEWS.join(','), '存了个非数组 → 默认三张');
ok(sanitizeViews({ 0: 'structure' }).join(',') === DEFAULT_VIEWS.join(','), '存了个对象 → 默认三张');
ok(sanitizeViews(['structure', '瞎写的']).join(',') === 'structure', '未知 id 被丢掉，已知的留下');
/*
 * 去重没有单独一条断言：输出永远按 VIEW_ORDER 过滤，而 VIEW_ORDER 里每个 id 只出现一次，
 * 所以「重复的只留一个」在任何能过下面这条的实现下都恒真。
 * 反证时验证过：把 `new Set` 换成 `includes` 仍然全绿。恒真的断言比没有断言更糟——
 * 它让人以为守住了。唯一性与顺序是同一个机制，只守一次。
 */
/* 倒序输入：不排序的实现会原样吐回，这条才红。正序样本放在下面当对照。 */
ok(
  sanitizeViews(['repair', 'verdict', 'structure']).join(',') === 'structure,verdict,repair',
  '倒序输入 → 正序输出（顺序不随点击顺序变）',
  sanitizeViews(['repair', 'verdict', 'structure']).join(','),
);
ok(
  sanitizeViews(['structure', 'verdict', 'repair']).join(',') === 'structure,verdict,repair',
  '对照：正序输入与倒序输入结果相同（上一条比的不是两种不同集合）',
);
ok(
  sanitizeViews(['repair', 'verdict', 'structure']).join(',') !==
    ['repair', 'verdict', 'structure'].join(','),
  '样本里「输入顺序」与「输出顺序」确实不同（上一条才不会白绿）',
);
ok(sanitizeViews([]).length === 0, '空数组原样保留：全关是用户的选择，不是「没存过」');
ok(
  sanitizeViews(['refute', 'nope']).includes('refute'),
  '存的是意图：这次画不出/不合法的过滤不改记忆（refute 留着）',
);

/* ─────────── 三、这次实际显示哪几张 ─────────── */

ok(
  normalizeViews(['structure', 'refute', 'repair'], V_FULL).join(',') === 'structure,refute,repair',
  '全画得出时，用户要几张给几张',
);
ok(
  normalizeViews(['structure', 'refute', 'repair'], vNoRef).join(',') === 'structure,repair',
  '这次画不出的那张不进显示（但记忆里仍留着）',
  normalizeViews(['structure', 'refute', 'repair'], vNoRef).join(','),
);
ok(
  normalizeViews(['structure', 'refute', 'repair'], vNoRef).join(',') !==
    normalizeViews(['structure', 'refute', 'repair'], V_FULL).join(','),
  '样本里「有反驳」与「没反驳」的结果确实不同（上一条才不会白绿）',
);
ok(normalizeViews(null, V_FULL).join(',') === DEFAULT_VIEWS.join(','), '没存过 → 默认三张（且都在可画范围内）');
ok(normalizeViews([], V_FULL).length === 0, '全关 → 一张都不显示（不替用户恢复默认）');
ok(
  normalizeViews([], V_FULL).length !== normalizeViews(null, V_FULL).length,
  '样本里「全关」与「没存过」结果确实不同（上一条才不会白绿）',
);
/* 乱序入参：用已排好序的 ['structure','refute'] 测「有没有就地排序」，
   排序与不排序的结果一模一样，这条会白绿。 */
const input = ['repair', 'structure'];
const before = [...input];
normalizeViews(input, vNoRef);
ok(input.join(',') === before.join(','), 'normalizeViews 不修改传进来的数组', input.join(','));
ok(before.join(',') !== VIEW_ORDER.filter((x) => before.includes(x)).join(','), '样本入参确实不是已排序的（上一条才踩得到）');

/* ─────────── 四、文案 ─────────── */

const lineFull = viewCountLine(V_FULL, ['structure', 'checks', 'verdict']);
ok(lineFull.startsWith('图 3/5'), '五张全可画时分母是 5', lineFull);
ok(lineFull.includes('结构图') && lineFull.includes('逐关检查'), '计数行点名显示的是哪几张', lineFull);

const lineNoRef = viewCountLine(vNoRef, ['structure', 'checks', 'verdict']);
ok(lineNoRef.startsWith('图 3/4'), '没有反驳时分母是 4，不是固定的 5', lineNoRef);
ok(lineNoRef !== lineFull, '样本里两种分母确实不同（上一条才不会白绿）');

const lineOff = viewCountLine(V_FULL, []);
ok(lineOff.startsWith('图 0/5'), '全关时写 0/N', lineOff);
ok(lineOff.includes('文字照常'), '全关时说清报告仍可读，不制造「坏了」的印象', lineOff);

/*
 * 「一张都画不出」这个分支在真报告上走不到：判读刻度永远画得出（判不了也是一条结论）。
 * 但它仍然是函数的契约——传一份全被标为画不出的清单进来就该走这条路。
 * 所以这里直接造清单，不拿 viewsOf 的结果凑：拿真报告凑，这条断言会红，
 * 而修法不该是把它删掉，是承认这个分支只对调用方成立。
 */
const ALL_BLOCKED: ViewSpec[] = VIEW_ORDER.map((id) => ({ id, name: id, what: '', where: '', blocked: '画不出' }));
const lineNone = viewCountLine(ALL_BLOCKED, DEFAULT_VIEWS);
ok(lineNone.includes('没有画得出来的图'), '一张都画不出时单独一句话', lineNone);
ok(
  viewsOf({ ...FULL, premises: [], scope: { ...FULL.scope, applicable: false } }).some((v) => v.blocked === null),
  '真报告至少有一张画得出（判读刻度）——所以上一句只对调用方成立，不在成品里出现',
);

/* 清单里没有这张时不许抛——抛了与「断言失效」长得一样，读日志的人分不清。
   所以这里给一个可读的替代值，让失败落成一条红。 */
const stateOf = (views: ViewSpec[], id: ViewId, on: ViewId[]): string => {
  const spec = specOf(views, id);
  return spec ? viewStateText(spec, on) : '（清单里没有这张图）';
};
ok(stateOf(V_FULL, 'structure', ['structure']) === '显示中', '开着的那张写「显示中」');
ok(stateOf(V_FULL, 'structure', []) === '已关掉', '关着的那张写「已关掉」');
ok(
  stateOf(vNoRef, 'refute', []) === specOf(vNoRef, 'refute')?.blocked,
  '画不出的那张写原因，不写「已关掉」',
  stateOf(vNoRef, 'refute', []),
);
ok(
  /没有生成反驳/.test(stateOf(vNoRef, 'refute', [])),
  '画不出的原因原样出现在状态里（不是一句「不可用」）',
);

const ALL_TEXT = [lineFull, lineNoRef, lineOff, lineNone, stateOf(vNoRef, 'refute', [])].join(' ');
ok(!/建议|应该|推荐|最好|务必/.test(ALL_TEXT), '这些文案不劝、不替人决定', ALL_TEXT);

/* ─────────── 五、接线：界面真的用上了这一层 ─────────── */

ok(/<ViewBar[\s\S]*?views=\{views\}/.test(DIAG), '报告里真的挂了挑图条（不是只在 shared 里写了函数）');
ok(
  DIAG.indexOf('<QuickRead') < DIAG.indexOf('<ViewBar'),
  '挑图条在「四句话」之后（读者决定深看哪一层的位置）',
  `QuickRead@${DIAG.indexOf('<QuickRead')} ViewBar@${DIAG.indexOf('<ViewBar')}`,
);
ok((DIAG.match(/<Gated /g) ?? []).length >= 4 && /data-view-gate="structure"/.test(OV), '五张图都过了闸门（结构图在首屏模块里，另四张在正文）', String((DIAG.match(/<Gated /g) ?? []).length));
ok(
  /data-view-off=\{id\}/.test(DIAG),
  '关掉的图有一行占位（不是整栏消失——目录还指着它）',
);
/*
 * 结构图那张关掉时的占位是手写的（它在 Overview 里，不走 Gated），
 * 所以必须单独守一次：少了 `data-view-off` 这个记号，界面照常显示一句人话，
 * 而挑图那一栏与打包自检再也认不出「是哪一张被关了」——上一版就是只写了人话。
 * 同一处还要守「画不出来」与「自己关掉」是两支：前者不给「打开」按钮。
 */
ok(
  /data-view-off="structure"/.test(OV) && /data-view-off-open="structure"/.test(OV),
  '结构图关掉时的占位带着记号与「打开这张图」按钮（只写一句人话，外面认不出是哪一张）',
);
ok(
  /structureBlocked \? \(/.test(OV) && OV.indexOf('structureBlocked ?') < OV.indexOf('data-view-off="structure"'),
  '「画不出来」与「自己关掉」分成两支：前者把原因摆出来，不给打开按钮',
);
ok(/localStorage\.setItem\(STORE_KEY/.test(BAR), '选择写进本机存储（下次打开还是这次的选法）');
ok(/sanitizeViews\(readStoredViews\(\)\)/.test(DIAG), '读回来的存储先过 sanitizeViews（被手改坏也不白屏）');
ok(/normalizeViews\(wanted, views\)/.test(DIAG), '显示用的是「意图 ∩ 这次画得出」，不是意图本身');
ok(!/views\s*=\s*\[/.test(DIAG), '报告里没有写死一份图的清单（清单来自 viewsOf）');

/* 两张新图必须真的画东西，而不是空壳。 */
ok(/export function RefuteMap/.test(MORE), '反驳落点图存在');
ok(/export function RepairMap/.test(MORE), '修补对照图存在');
ok(/d\.refutations\.length/.test(MORE) || /targetsOf\(d\)/.test(MORE), '反驳落点用的是报告里的真实反驳');
ok(/missingPremise/.test(MORE), '修补对照画的是报告里给的那句缺失前提');
ok(
  /条只打到某一处依据、没指是哪一关/.test(MORE),
  '反驳没有挂到关卡这件事写在那句统计里（空心的那些不在少数，不能画成实心）',
);

/* ─────────── 结果 ─────────── */

if (failed.length) {
  console.error(`\ncheck:views 失败 ${failed.length} 条：`);
  for (const f of failed) console.error(`  ✗ ${f}`);
  console.error(`\n通过 ${passed} 条。`);
  process.exit(1);
}
console.log(`check:views 通过 ${passed} 条`);
