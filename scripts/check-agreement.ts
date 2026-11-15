/**
 * 「同题复跑」的断言。
 *
 * 这一块的价值全押在一句话上：**存过 103 份报告的人，才答得了「同一段字跑十遍，报告一样吗」**。
 * 一旦它开始评「稳定 / 不可靠」、开始算百分比、开始把没参与比对的份数悄悄略过，
 * 它就退回成又一段替人下判断的文字。
 *
 * 但比「措辞」更容易出错的是**分组**。少分一条，就会把别的东西读成「模型这次说得不一样」：
 *   - 不按指纹分：提示词改过一版，报告当然变；
 *   - 不按模式分：诊断与红队问的不是同一件事；
 *   - 按「相似」而不是「逐字相同」分：同一段话加一句就是另一段话。
 * 最后那条有真样本——本机那 8 份改稿的 dice 是 0.88，样本账会把它们并成一组，
 * 而这里必须分开。所以断言里专门放了一对「相似但不同」的文本。
 *
 * 防恒真写在每处：并列组按时间排是 70,55,50,40,30，按指纹字典序会变成 30,40,50,55,70，
 * 两种顺序在样本上确实不同；打乱后第一条确实不是最近那份；坏参数、空字段、缺字段各有踩得到的样本。
 *
 * 跑法：npm run check:agreement
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  agreementLine,
  agreementOf,
  agreementText,
  MAX_VALUE,
  cellLine,
  spreadLine,
  type AgreementItem,
} from '@shared/agreement';
import { EXCERPT_LEN } from '@shared/excerpt';
import { dice, bigrams, normalizePassage } from '@shared/sameness';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}

const FMT = (at: number): string => String(at);

const SRC = readFileSync(resolve('src/shared/agreement.ts'), 'utf-8');
const LITERALS = [...SRC.matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)].map((m) => m[1] ?? m[2] ?? '').join('\n');

/* ─────────── 样本 ─────────── */

const P = '我们学校去年取消了早读，今年高考一本率下降了六个百分点。这说明取消早读是错的。';
/** 真实存档里那 8 份改稿的样子：同一段话加一句。样本账会把它并进同一组，这里必须分开。 */
const P2 = P + '另外，隔壁两个县情况类似。';

/** 一份形状像真报告的最小对象。字段数固定为 11 条。 */
const R = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  verdict: { level: 'weakened', whatIsRefuted: '取消早读导致一本率下降' },
  context: { issue: '该不该恢复早读' },
  checks: [
    { id: 'c1', answer: 'answered' },
    { id: 'c2', answer: 'answered' },
  ],
  labels: [{ id: 'hasty', name: '轻率概括' }],
  ...over,
});

const it = (id: string, at: number, over: Partial<AgreementItem> = {}): AgreementItem => ({
  id,
  at,
  mode: 'diagnose',
  theory: 'walton',
  version: '2.5.0',
  fingerprint: 'fpA',
  passage: P,
  report: R(),
  ...over,
});

const FIXTURE: AgreementItem[] = [
  it('a1', 100),
  it('a2', 90),
  it('a3', 80),
  /* 同一指纹、同一模式，文本加了一句：必须自成一组，否则「改了原文」会被读成「模型抖了」 */
  it('a4', 70, { passage: P2 }),
  it('a5', 60, { passage: P2 }),
  /* 一处真差异：同指纹同文本，结论被改了一个说法 */
  it('b1', 55, { fingerprint: 'yy', mode: 'redteam' }),
  it('b2', 54, { fingerprint: 'yy', mode: 'redteam', report: R({ verdict: { level: 'weakened', whatIsRefuted: '另一个说法' } }) }),
  /* 同一指纹、同一文本，只换了模式：不能并进上面那组 */
  it('b3', 20, { fingerprint: 'yy', mode: 'reconstruct' }),
  /* 同一指纹、同一文本，只换了透镜：也不能并 */
  it('c1', 10, { fingerprint: 'fpA', theory: 'ars' }),
  /* 只差身份字段（id / createdAt）——这些不该被算成差异 */
  it('f1', 50, { fingerprint: 'xx', report: R({ id: 'f1', createdAt: 50 }) }),
  it('f2', 49, { fingerprint: 'xx', report: R({ id: 'f2', createdAt: 49 }) }),
  /* 旧存档缺字段：labels 那一栏整个不存在，三条路径都要算作差异 */
  it('g1', 40, { fingerprint: 'ww' }),
  it('g2', 39, { fingerprint: 'ww', report: (() => { const r = R(); delete (r as Record<string, unknown>).labels; return r; })() }),
  /* 数组长度变化：十条检查变成八条那种事，长度自己也要是一条路径 */
  it('h1', 30, { fingerprint: 'vv' }),
  it('h2', 29, { fingerprint: 'vv', report: R({ checks: [{ id: 'c1', answer: 'answered' }] }) }),
  /* 没有指纹的旧报告：不参与比对，但要被数出来 */
  it('d1', 5, { fingerprint: null, version: null }),
  it('d2', 4, { fingerprint: null, version: null }),
  /* 空原文 */
  it('e1', 3, { fingerprint: 'fpE', passage: '   ' }),
];

/** 同一份数据打乱了顺序：第一条不是最近那份。 */
const SHUFFLED: AgreementItem[] = [...FIXTURE].reverse();

const V = agreementOf(FIXTURE);
const W = agreementOf(SHUFFLED);

/*
 * 结构守卫：下面几十条断言都建立在这五组各自存在上。
 * 分组一旦把不同输入并成一组，某些组会整个消失，而后续断言会在 undefined 上崩掉——
 * 「判据脚本崩掉」与「判据失效」长得一样，读日志的人分不清是代码坏了还是样本坏了。
 * 所以这里先点名缺了哪几组并停下，不带着一个崩掉的脚本往下跑。
 */
const NEED = ['fpA', 'yy', 'xx', 'ww', 'vv'];
const absent = NEED.filter((fp) => !V.repeat.some((c) => c.fingerprint === fp));
if (absent.length) {
  console.error(`
check:agreement 失败：样本里应有的组不在了（${absent.join(',')}）——分组把不同输入并成了一组。`);
  process.exit(1);
}

/* ─────────── 分组：四件事同时相同才算同一个输入 ─────────── */

ok(V.reports === 17, '读得出来且有原文的报告 17 份', String(V.reports));
ok(V.blanks === 1, '空原文 1 份，单独数出来', String(V.blanks));
ok(V.noVersion === 2, '没有指纹的旧报告 2 份，不参与比对但被数出来', String(V.noVersion));
ok(V.repeat.length === 6, '跑过不止一次的 6 组', String(V.repeat.length));
ok(V.singles === 2, '只跑过一次的 2 组（换了模式的那份、换了透镜的那份）', String(V.singles));
ok(V.identical === 3 && V.spread === 3, '3 组每次都一样、3 组变过', `${V.identical}/${V.spread}`);
ok(V.maxReports === 3, '最多的一组 3 份', String(V.maxReports));

/** 这条是这一块的命门：先证明两份文本「相似」，再证明它们没有被并成一组。 */
const d = dice(bigrams(normalizePassage(P)), bigrams(normalizePassage(P2)));
ok(d >= 0.85, '样本里那两段文本确实「相似」（足够让样本账并组）', d.toFixed(3));
ok(!/NEAR_SAME|dice\(|bigrams/.test(SRC), '内核不沿用相似度阈值：按相似分就会把这 8 份改稿并成一组');
/* 摘录只看前 28 字，两段原文的开头一模一样——所以这里按字数分，不按摘录分。
   按摘录分的话，这条断言会在「已经并成一组」时也通过（两组的摘录本来就相同）。 */
ok(
  !V.repeat.some((c) => c.ids.includes('a1') && c.ids.includes('a4')),
  '原文与加了一句的改稿没有落在同一组（按字数或摘录分都会判错，这里直接看 id）',
);
ok(
  V.repeat.some((c) => c.chars === normalizePassage(P2).length && c.reports === 2),
  '那两段的字数与改稿一致（说明分的是文本，不是摘录）',
);
ok(V.repeat.some((c) => c.fingerprint === 'fpA' && c.reports === 2), '加了一句的那两份自己成一组（指纹相同也不例外）');
ok(!V.repeat.some((c) => c.reports === 5 && c.fingerprint === 'fpA'), '原文 3 份与改稿 2 份没有并成 5 份一组');
ok(V.repeat.every((c) => new Set(c.ids).size === c.ids.length), '同一份报告不会同时出现在两处');

/* ─────────── 字段：身份与输入不算差异 ─────────── */

const byFp = (fp: string) => V.repeat.find((c) => c.fingerprint === fp)!;
const A = byFp('fpA');
const X = byFp('xx');
ok(A.fields === 11, '一份报告能摊出 11 条可比字段（身份与输入已排除）', String(A.fields));
ok(A.same === 11 && A.spreads.length === 0, '三份完全一样：11 条字段都一样，没有一处差异');
ok(X.spreads.length === 0, '只差 id / createdAt 时不算差异（否则每份报告都「不一样」）');
ok(X.fields === 11, '身份字段没有被算进字段总数，数字才可比', String(X.fields));

/*
 * 人填的两份账（A 立案 / v1.1 分歧账）是**输入**，不是模型产物。
 * 用户第二遍才补填分歧账时把它算进差异，界面会说「16 处不一样」，
 * 读的人只会以为是模型抖了——包内自检真撞上过：那些差异全是 divergence.*，
 * 连 at 时间戳都算了一处。与 passage / mode 同一条口径，排除。
 */
const HUMAN = agreementOf([
  it('u1', 48, { fingerprint: 'u' }),
  it('u2', 47, {
    fingerprint: 'u',
    report: R({
      brief: { speaker: '校办', version: '第二版', source: 'original', objectKind: 'argument', at: 1 },
      divergence: {
        frame: { formal: 'classical', criterion: 'scheme-cq', dimension: 'dialectic', protocol: 'inquiry' },
        closure: 'fork', branches: 2, entries: [], common: '', difference: '',
        condition: '给出出处只剩宽读', basis: '两读各自未过的 CQ', decidable: '', burden: '', at: 2,
      },
    }),
  }),
]);
const U = HUMAN.repeat.find((c) => c.fingerprint === 'u')!;
ok(U.fields === 11, '第二遍才补填立案与分歧账：可比字段数不变（人填的账不进分母）', String(U.fields));
ok(U.spreads.length === 0, '第二遍才补填立案与分歧账：一处「模型差异」都不多报', String(U.spreads.length));
ok(
  LITERALS.split('\n').includes('brief') && LITERALS.split('\n').includes('divergence'),
  '排除名单里写着两份人填的账（不是靠 flatten 那一层顺手跳过）'
);

const B = byFp('yy');
ok(B.spreads.length === 1, '只改了一个说法：只报一处差异', String(B.spreads.length));
ok(B.spreads[0].path === 'verdict.whatIsRefuted', '差异有名字，不是一个笼统的「不一样」', B.spreads[0].path);
ok(B.spreads[0].values.length === 2, '这一处有两种取值', String(B.spreads[0].values.length));
ok(
  B.spreads[0].values.map((v) => v.count).join(',') === '1,1',
  '两种取值各出现一次（2 份报告、2 种说法）',
  B.spreads[0].values.map((v) => `${v.count}×${v.text}`).join(' | '),
);

const G = byFp('ww');
ok(G.spreads.length === 3, '整栏缺失时报三条路径，不是一条「缺字段」', String(G.spreads.length));
ok(G.spreads.every((s) => s.values.some((v) => v.text === '（无此字段）')), '缺失的取值明写「无此字段」，不是空串');
const H = byFp('vv');
ok(H.spreads.some((s) => s.path === 'checks.length'), '「两条检查变一条」长度本身就是一条路径');
ok(H.spreads.length === 3, '长度 1 条 + 少掉那一项的 2 个字段', H.spreads.map((s) => s.path).join(','));

/* 类型也要分：'3' 与 3 不是同一个值 */
const TYPED = agreementOf([
  it('t1', 3, { fingerprint: 'tt', report: R({ n: 3 }) }),
  it('t2', 2, { fingerprint: 'tt', report: R({ n: '3' }) }),
]);
ok(TYPED.repeat[0].spreads.some((s) => s.path === 'n'), "数字 3 与字符串 '3' 判为不同");

/* ─────────── 顺序与确定性 ─────────── */

ok(SHUFFLED[0].at !== 100, '打乱后第一条确实不是最近那份（这条本身不能恒真）', String(SHUFFLED[0].at));
ok(
  SHUFFLED.map((x) => x.id).join(',') !== FIXTURE.map((x) => x.id).join(','),
  '打乱前后 id 顺序确实不同',
);
ok(JSON.stringify(W) === JSON.stringify(V), '输入顺序打乱，整份视图逐字节相同');
ok(JSON.stringify(agreementOf(FIXTURE)) === JSON.stringify(V), '同一输入两次调用逐字节相同');
ok(A.ids.join(',') === 'a1,a2,a3', '组内 id 按时间降序留着，不合并、不丢', A.ids.join(','));
ok(A.index === 1, '份数最多的排第一');
/* 后五组都是 2 份。按最近时间排是 70,55,50,40,30；按指纹字典序排会变成 30,40,50,55,70。
   两种顺序在样本上确实不同，所以「按时间排」这条不是恒真。 */
ok(V.repeat.map((c) => c.at).join(',') === '100,70,55,50,40,30', '并列时按最近时间排', V.repeat.map((c) => c.at).join(','));
ok(
  [...V.repeat].sort((x, y) => x.fingerprint.localeCompare(y.fingerprint)).map((c) => c.at).join(',') !==
    '100,70,55,50,40,30',
  '样本里「按时间」与「按指纹」的顺序确实不同（上一条才不会白绿）',
);
ok(V.repeat.map((c) => c.index).join(',') === '1,2,3,4,5,6', '组号从 1 起，连续');

/* ─────────── 文案：只数事实 ─────────── */

const LINE = agreementLine(V) ?? '';
ok(LINE.includes('跑过不止一次的有 6 组'), '总述说出组数', LINE);
ok(LINE.includes('3 组每次报告完全一样'), '总述说出几组每次都一样');
ok(LINE.includes('3 组变过'), '总述说出几组变过');
ok(LINE.includes('最多的一组跑了 3 遍'), '总述说出最大的那组跑了多少遍');
ok(LINE.includes('11 个字段每次都一样'), '总述把字段数说出来，不靠形容词');
ok(LINE.includes('2 份旧报告没记提示词版本，没有放进来比'), '没参与比对的份数在总述里可见，不能悄悄丢');
ok(LINE.includes('1 份原文是空的'), '空原文在总述里可见');
ok(!/建议|应该|应当|稳定|可靠|质量|结论|证明|因此|所以|值得|太少了/.test(LINE), '总述不评稳定、不劝人多跑');

const CELL = cellLine(A, FMT);
ok(CELL.startsWith('第 1 组 · 3 份 · v2.5.0 · 模式 diagnose · 11 个字段每次都一样'), '明细行由模板、数字与原话拼成', CELL);
ok(CELL.includes('最近一次 100'), '最近一次的时间用调用方给的格式，不自己造');
ok(CELL.includes(A.excerpt) && A.excerpt.length === EXCERPT_LEN, '原文摘录逐字来自原文');
ok(!CELL.includes('…') || A.truncated, '没截断的原文不补省略号');

const BAD = { ...A, version: null, fingerprint: 'nover', spreads: [{ path: 'x', values: [{ text: 'a', count: 1 }, { text: 'b', count: 1 }] }], same: 10, fields: 11 };
ok(cellLine(BAD as typeof A, FMT).includes('版本未知'), '没有版本时写「版本未知」，不拼出一个空版本号');
ok(cellLine(BAD as typeof A, FMT).includes('11 个字段里有 10 个每次都一样，1 个变过'), '有差异时报「几个里几个一样」');

const SL = spreadLine(B.spreads[0]);
ok(SL.startsWith('verdict.whatIsRefuted：'), '差异行以路径开头', SL);
ok(SL.includes('1 次「取消早读导致一本率下降」'), '取值与次数逐字写出', SL);

/* 长值截断：数据里不带省略号，长度另给 */
const LONG = agreementOf([
  it('l1', 2, { fingerprint: 'll', report: R({ v: 'x'.repeat(MAX_VALUE + 40) }) }),
  it('l2', 1, { fingerprint: 'll', report: R({ v: 'y' }) }),
]);
const LV = LONG.repeat[0].spreads.find((s) => s.path === 'v')!;
ok(LV.values.some((v) => v.text.length === MAX_VALUE && v.len === MAX_VALUE + 40), '超长取值截到上限并记下原长');
ok(!LV.values.some((v) => v.text.includes('…')), '数据里不造一个不属于原文的省略号');

/* ─────────── 导出 ─────────── */

const TXT = agreementText(V, FMT);
const spreadCount = V.repeat.reduce((n, c) => n + c.spreads.length, 0);
ok(TXT.startsWith(LINE), '导出第一行就是界面那一行，不另写一套说法');
ok(
  TXT.split('\n').length === 2 + V.repeat.length + spreadCount + 1 + 2,
  '导出行数 = 总述 + 空行 + 每组一行 + 每处差异一行 + 只跑一次那句 + 两句边界',
  String(TXT.split('\n').length),
);
ok(V.repeat.every((c) => TXT.includes(cellLine(c, FMT))), '每一组在导出里逐字出现');
ok(V.repeat.every((c) => c.spreads.every((s) => TXT.includes(spreadLine(s)))), '每一处差异在导出里逐字出现');
ok(TXT.includes('另有 2 组只跑过一次，没有列出来：跑一遍看不出会不会一样。'), '只跑一次的组在导出里有一句交代');
ok(
  TXT.includes('早期存档没有这一栏') && TXT.includes('同一个模型名不等于同一个版本'),
  '导出写明这一栏能读到多远（旧存档没记 + 模型名不等于版本）：不写明，数字会被读成它证明不了的结论',
);
ok(!/建议|应该|稳定|可靠|结论|证明|因此|所以/.test(TXT), '导出里没有一句本地新写的判断');

/** 扣掉原文、模板与每一行由数据拼出来的文字，剩下不该再有一个汉字。 */
let stripped = TXT;
for (const c of V.repeat) stripped = stripped.split(cellLine(c, FMT)).join('');
for (const c of V.repeat) for (const s of c.spreads) stripped = stripped.split(spreadLine(s)).join('');
for (const w of [
  '同一版提示词、同一段字、同一个模式，跑过不止一次的有',
  '组：',
  '另有',
  '组只跑过一次，没有列出来：跑一遍看不出会不会一样。',
  '报告里记了跑它的模型、供应商主机与生效温度的是新存档；早期存档没有这一栏，明细里写「没记模型」。',
  '同一个模型名不等于同一个版本，供应商什么时候换权重，这份存档不知道；没记模型的组，差别分不开「模型每次说得不一样」与「当时换了模型或设置」。',
  '本机 ',
  '份报告没记模型（旧存档没有这一栏）',
  '组里不止一个模型，那些差异不能都算作「同一个模型重复自己」',
  '没记模型',
  '模型 ',
  '，另有 ',
  ' 份没记',
  '（换过）',
  '，温度 ',
  '，供应商 ',
  '组每次报告完全一样',
  '组变过',
  '；',
  '最多的一组跑了',
  '遍，',
  '个字段里有',
  '个每次都一样',
  '个字段每次都一样',
  '另：',
  '份旧报告没记提示词版本，没有放进来比',
  '份原文是空的',
  '个报告文件读不出来，没有计入',
  '。',
  '，',
]) {
  stripped = stripped.replaceAll(w, '');
}
ok(!/[\u4e00-\u9fa5]/.test(stripped), '扣掉原话与固定模板后，导出里不剩一个本地新写的汉字', stripped.slice(0, 80));

/* ─────────── 空、坏参数、只跑一次 ─────────── */

ok(agreementLine(agreementOf([])) === null, '空存档什么也不说，不编一句「0 组」');
ok(
  (agreementLine(agreementOf([], 3)) ?? '').includes('本机还没有读得出来的报告'),
  '只有坏文件时说清是读不出来，而不是「还没有报告」',
);
const ONE = agreementOf([it('one', 1)]);
ok(
  (agreementLine(ONE) ?? '').includes('还没有哪一段字用同一版提示词、同一个模式跑过两遍'),
  '只有一份时说「看不出」，不冒充结论',
);
ok(agreementText(ONE, FMT).includes('另有 1 组只跑过一次'), '只有一份时导出也说清只有一组');
const BADF = agreementOf(FIXTURE, 2);
ok(BADF.badFiles === 2 && (agreementLine(BADF) ?? '').includes('2 个报告文件读不出来'), '坏文件数原样带上，并在总述里可见');
ok(agreementOf(FIXTURE, -1).badFiles === 0 && agreementOf(FIXTURE, 2.9).badFiles === 2, '坏参数不产生负数或小数');
ok(
  agreementOf([...FIXTURE, { id: 'oops', at: 1, passage: 42 as unknown as string } as AgreementItem]).reports === 17,
  '形状不对的记录不进比对，也不毁掉整份视图',
);

/* 一份报告只剩身份与输入：没有可比字段时不能说「每次都一样」 */
const EMPTY_REPORTS = agreementOf([
  { id: 'z1', at: 2, mode: 'diagnose', theory: 'walton', version: '2.5.0', fingerprint: 'ee', passage: P, report: {} },
  { id: 'z2', at: 1, mode: 'diagnose', theory: 'walton', version: '2.5.0', fingerprint: 'ee', passage: P, report: {} },
]);
ok(EMPTY_REPORTS.uncomparable === 1, '没有可比的字段时单独计数', String(EMPTY_REPORTS.uncomparable));
ok(EMPTY_REPORTS.identical === 0, '没有可比字段的那组不算进「每次都一样」——没比过不能说一样');
ok((agreementLine(EMPTY_REPORTS) ?? '').includes('里面没有可比的字段'), '这种情况下总述说的是「没有可比的字段」');
ok((agreementLine(EMPTY_REPORTS) ?? '').includes('1 组里没有可比的字段'), '旁注里也说清是哪一组');

/* ─────────── 顶层不许有结论字段 ─────────── */

const BANNED_KEYS = ['score', 'verdict', 'level', 'pass', 'passed', 'conclusion', 'summary', 'result', 'satisfied', 'quality', 'stability'];
ok(
  BANNED_KEYS.every((k) => !(k in (V as unknown as Record<string, unknown>))),
  '顶层没有一个字段能拿来当结论',
);
ok(!/from ['"]electron['"]|node:fs|node:path/.test(SRC), '内核不碰 electron、不读磁盘');
ok(
  !/建议|应该|应当|试试|不妨|最好|值得|稳定|可靠|质量|评分|得分|判定|太少/.test(LITERALS),
  '源码的字符串字面量里没有一句劝告或评价（注释不算）',
);

/* ─────────── 接线：内核算得对，不等于界面用的是它 ─────────── */

const ARCHIVE = readFileSync(resolve('src/main/archive.ts'), 'utf-8');
ok(/fingerprint:\s*d\.prompt\?\.fingerprint\s*\?\?\s*null/.test(ARCHIVE), '主进程真的取了指纹（取不到给 null，不给空串）');
ok(/version:\s*d\.prompt\?\.version\s*\?\?\s*null/.test(ARCHIVE), '主进程真的取了版本');
ok(/delete\s+report\.raw/.test(ARCHIVE), '模型原文没有跟着报告进比对');
ok(/scan\.diagnoses\.map/.test(ARCHIVE), '报告来源是同一次目录扫描，不另写一个循环');

const MAIN = readFileSync(resolve('src/main/index.ts'), 'utf-8');
ok(/ipcMain\.handle\('archive:agreement'/.test(MAIN), 'IPC 通道存在');
ok(/agreementOf\(scan\.items,\s*scan\.badFiles\)/.test(MAIN), 'IPC 里真的调用了内核，并把坏文件数一起传进去');

const BAR = readFileSync(resolve('src/renderer/src/components/AgreementBar.tsx'), 'utf-8');
ok(/=\s*agreementLine\(view\)/.test(BAR), '界面用的是内核那一行，不是自己拼一段说法');
ok(/value=\{agreementText\(view,\s*fmt\)\}/.test(BAR), '复制的纯文本也来自内核');
ok(/另 有|另有 \{c\.spreads\.length - SHOW_SPREADS\} 处变过/.test(BAR), '界面上截断差异时明说还有几处（不静默丢）');
ok(
  /data-agreement-caveat/.test(BAR) && /早期存档没有这一栏/.test(BAR) && /不等于同一个版本/.test(BAR),
  '界面把这一栏能读到多远说出来（旧存档没记 + 模型名不等于版本）',
);

const APP = readFileSync(resolve('src/renderer/src/App.tsx'), 'utf-8');
const atFolio = APP.indexOf('<PortfolioBar');
const atAgree = APP.indexOf('<AgreementBar');
ok(atFolio >= 0 && atAgree > atFolio, '同题复跑紧接在样本账之后（先说几组文字，再说组里一样不一样）');
ok(/\.agreement\(\)/.test(APP), '界面真的去取了这份数据');

const MOCK = readFileSync(resolve('src/renderer/src/mock.tsx'), 'utf-8');
ok(/QS\.get\('agreement'\)/.test(MOCK), '预览页有截图入口 ?agreement=1');

/* ─────────── 汇总 ─────────── */

if (failed.length) {
  console.error(`\ncheck:agreement 失败 ${failed.length} 条：`);
  for (const f of failed) console.error(`  ✗ ${f}`);
  console.error(`\n通过 ${passed} 条。`);
  process.exit(1);
}
console.log(`✓ check:agreement 通过 ${passed} 条｜分四件事、差异有名字、不写判断`);
