/**
 * 枢纽前提：这一段压在谁身上，而谁正是要被争的那件事。
 *
 * 这一关守的不是「多了一栏」，是六种会让这一栏变成装饰的坏法：
 *
 *   1. 不承重的也被算成枢纽——争点离结论八丈远，争赢了判定也不动，
 *      而读者会照着这个排名去吵；
 *   2. 承重只看「有没有支撑」，不看「有没有替补」——三条并列撑着一个结论时，
 *      任何一条都不算必经，把它们都写成「承重墙」是把纸糊的墙当成砖墙；
 *   3. 争点信号只数条数不分类——两条反驳打在同一处算两分，一处没答上算零分，
 *      于是「吵得凶的」压过「真正没被建立的」；
 *   4. 信号不写来源——只给一句「这一条可疑」，读者无从反驳，那一栏就成了判决；
 *   5. 顺手把承重与争点加权成一个总分——那就是又长出一把尺子；
 *   6. 结论自己进候选——一份报告里最像「承重」的当然是结论，把它排在第一位，
 *      整栏就成了废话。
 *
 * 防恒真：样本里**故意**造出「必经但无争」「有争但不承重」「循环」「连不上结论」
 * 四种情形。去掉 entries 的必经判定、去掉 supports 的正向闭包、去掉
 * 同种信号只算一次的去重，对应断言立刻红。
 *
 * 跑法：npm run check:pivot
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Claim, ConfidenceLevel, Diagnosis } from '@shared/types';
import { pivotOf } from '@shared/pivot';
import { MOCK, MOCK_PTA } from '../src/renderer/src/mock-data';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}
const src = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');

/* ─────────── 一 · 样本 ─────────── */

function cl(
  id: string,
  text: string,
  o: {
    supports?: string[];
    status?: Claim['acceptability']['status'];
    conf?: ConfidenceLevel;
    implicit?: boolean;
    role?: Claim['role'];
  } = {}
): Claim {
  return {
    id,
    role: o.role ?? 'premise',
    text,
    supports: o.supports ?? ['C'],
    quote: null,
    span: null,
    implicit: o.implicit ?? false,
    implicitBasis: o.implicit ? '若不假定 X，则从这条推不出 C' : null,
    burden: 'proponent',
    acceptability: {
      status: o.status ?? 'acceptable',
      reason: o.status === 'acceptable' ? '' : '测试样本：这一条有人不同意',
      forAudience: '测试受众',
      tag: 'inferred',
      confidence: o.conf ?? 'medium',
    },
  };
}

/**
 * 用假报告做底，只换命题。
 *
 * 基底里**清空 refutations**：样张自带两条反驳，不清掉的话，
 * 每条断言都在替样张验，而不是替被测的那条规则验。
 */
function diag(premises: Claim[], intermediate: Claim[] = [], conclusionText = '取消早读是错误决定'): Diagnosis {
  const d = JSON.parse(JSON.stringify(MOCK)) as Diagnosis;
  d.premises = premises;
  d.intermediate = intermediate;
  d.refutations = [];
  d.conclusion.text = conclusionText;
  return d;
}

/* ─────────── 二 · 承重：结论到底经不经过它 ─────────── */

const chain = pivotOf(
  diag([cl('P1', '去年取消早读'), cl('P2', '今年一本率下降')], [cl('I1', '两件事有因果关系', { supports: ['C'], role: 'intermediate' })])
);

/* 这份样本里没有 I1 的支撑者（P1/P2 都直接撑 C），所以 I1 是孤的；改一份有的。 */
const chained = pivotOf(
  diag(
    [cl('P1', '去年取消早读', { supports: ['I1'] }), cl('P2', '今年一本率下降')],
    [cl('I1', '两件事有因果关系', { supports: ['C'], role: 'intermediate' })]
  )
);

const byId = (v: ReturnType<typeof pivotOf>, id: string) => v.rows.find((r) => r.id === id);

ok(!chain.rows.some((r) => r.id === 'I1'), '没有支撑者的中间结论：连不上结论，不进候选');
ok(byId(chained, 'P1')?.steps === 2, '经过中间结论才到结论的前提：记 2 步，不是 1 步');
ok(byId(chained, 'P1')?.substitutes === 0, '某一步只有它一个支撑者：替补数为 0（这是必经）');

const soleOnly = pivotOf(diag([cl('P1', '去年取消早读', { supports: ['I1'] })], [cl('I1', '有因果', { supports: ['C'], role: 'intermediate' })]));
ok(soleOnly.top?.kind === 'sole', '必经而没人质疑：归「孤柱」，不归枢纽', String(soleOnly.top?.kind));
ok(/一道门/.test(String(soleOnly.headline)), '孤柱有自己的一句话（整段只经过它一道门），不借用枢纽那句', String(soleOnly.headline));
ok(!/争点。/.test(String(soleOnly.headline)), '孤柱不被说成「本身是争点」——它恰恰没人争');

/* 老报告兼容：supports 为空按最朴素的重构处理，直接支撑结论 */
const legacy = pivotOf(diag([cl('P1', '去年取消早读', { supports: [] })]));
ok(byId(legacy, 'P1')?.steps === 1, 'supports 为空的老报告：按「直接支撑结论」兜底，不当成连不上');

/* 连不上结论的：即使被争，也不许排在承重的前面 */
const orphan = pivotOf(
  diag(
    [cl('P9', '一条被挂在断路中间结论上的话', { supports: ['I2'], status: 'unacceptable' })],
    [cl('I2', '一条连不到结论的中间结论', { supports: ['NOPE'], role: 'intermediate' })]
  )
);
ok(byId(orphan, 'P9')?.steps === null, '连不上结论的前提：步数为空，不是编一个 1');
ok(byId(orphan, 'P9')?.kind === 'noisy', '连不上结论但被争：归「白吵」，不归枢纽', String(byId(orphan, 'P9')?.kind));
ok(orphan.top?.kind === 'noisy' && orphan.headline === null, '只有白吵时不编主句（没有枢纽就不假装有）', String(orphan.headline));
ok(/改不了判定/.test(orphan.rows[0]?.why ?? ''), '白吵那一行必须说清「争赢也改不了判定」');

/* ─────────── 三 · 争点信号：五路，各自带来源 ─────────── */

const sig = (c: Claim, concl = '取消早读是错误决定') => pivotOf(diag([c], [], concl)).rows[0]?.signals ?? [];

ok(sig(cl('P1', '去年取消早读', { status: 'questionable' })).some((s) => s.kind === 'acceptability'), '可接受性可疑：算一条争点信号');
ok(sig(cl('P1', '去年取消早读', { status: 'unacceptable' })).some((s) => s.kind === 'acceptability'), '不可接受也算');
ok(sig(cl('P1', '去年取消早读', { conf: 'low' })).some((s) => s.kind === 'confidence'), '置信「低」：算一条');
ok(sig(cl('P1', '去年取消早读', { conf: 'undetermined' })).some((s) => s.kind === 'confidence'), '置信「未定」也算');
ok(sig(cl('P1', '去年取消早读', { implicit: true })).some((s) => s.kind === 'implicit'), '补出来的前提：算一条（认不认这一句本身就是争点）');
ok(sig(cl('P1', '取消早读是错误决定')).some((s) => s.kind === 'circular'), '把结论原样当前提：报「字面重合」，指向循环');
ok(
  sig(cl('P1', '取消早读是错误决定'))
    .find((s) => s.kind === 'circular')
    ?.text.includes('字面'),
  '循环那条信号写明它是按字面算的，不冒充语义判断'
);
ok(
  sig(cl('P1', '去年取消早读')).every((s) => !/^$/.test(s.text)) && sig(cl('P1', '去年取消早读')).length === 0,
  '干净的命题：一条信号都不编'
);

/* 反驳：两条打在同一处，只算一种 */
const withd = diag([cl('P1', '去年取消早读')]);
withd.refutations = [
  ...JSON.parse(JSON.stringify(MOCK.refutations.filter((r) => r.targetId === 'P1'))),
  ...JSON.parse(JSON.stringify(MOCK.refutations.filter((r) => r.targetId === 'P1'))),
].map((r: { targetId: string }, i: number) => ({ ...r, targetId: 'P1', id: `R${i}` }));
const refSig = pivotOf(withd).rows[0]?.signals ?? [];
const refCount = refSig.filter((s) => s.kind === 'refutation').length;
ok(refCount === 1, '同一处有两条反驳：只算一种信号（不按条数刷分）', String(refCount));
ok(/2 条反驳/.test(refSig.find((s) => s.kind === 'refutation')?.text ?? ''), '但条数要写出来：两条不是没说');

/* ─────────── 四 · 排序：必经 → 信号种类 → 报告顺序 ─────────── */

const order = pivotOf(
  diag(
    [
      cl('P1', '必经的那一条', { supports: ['I1'], status: 'questionable' }),
      cl('P2', '有替补也被人争的那一条', { status: 'questionable', conf: 'low' }),
    ],
    [cl('I1', '中间结论', { supports: ['C'], role: 'intermediate' })]
  )
);
ok(order.rows[0]?.id === 'P1', '必经的排在「有替补的」前面（哪怕对方信号更多）', order.rows.map((r) => r.id).join(','));
ok(order.rows[0]?.badge === '枢纽', '排第一的承重争点才叫「枢纽」');
ok(order.rows.slice(1).every((r) => r.badge !== '枢纽'), '其余同类只叫「争点」——三条都叫枢纽等于没排');

const shuffled = pivotOf(
  diag(
    [
      cl('P3', '第三种说法', { status: 'questionable', conf: 'low', implicit: true }),
      cl('P1', '第一种说法', { status: 'questionable' }),
    ]
  )
);
const shuffled2 = pivotOf(
  diag(
    [cl('P1', '第一种说法', { status: 'questionable' }), cl('P3', '第三种说法', { status: 'questionable', conf: 'low', implicit: true })]
  )
);
ok(
  shuffled.rows.map((r) => r.id).join(',') === shuffled2.rows.map((r) => r.id).join(','),
  '输入顺序打乱，排名不变（信号多的在前，报告顺序只做同分兜底）',
  `${shuffled.rows.map((r) => r.id)} vs ${shuffled2.rows.map((r) => r.id)}`
);
ok(shuffled.rows[0]?.id === 'P3', '信号种类多的排在前面', shuffled.rows.map((r) => r.id).join(','));

/* ─────────── 五 · 不许长出新尺子、结论不许进候选 ─────────── */

const REAL = pivotOf(MOCK);
ok(!REAL.rows.some((r) => r.id === 'C'), '结论自己不进候选（最像「承重」的当然是结论，那正是不能选它的理由）');
ok(!/^C$/.test(REAL.top?.id ?? ''), '排第一的不是结论');
ok(REAL.top?.id === 'P2', '样张的枢纽是那条补出来的因果前提，不是被反驳最多的 P1', String(REAL.top?.id));
ok(/补出来|争点信号/.test(REAL.rows[0]?.why ?? ''), '排第一的那条写清凭什么排第一');
ok(/P2/.test(String(REAL.headline)) && /当前提用/.test(String(REAL.headline)), '主句说的是「把 P2 当前提用，而它本身是争点」');

const pta = pivotOf(MOCK_PTA);
ok(pta.rows.length > 0, '换一副透镜（实践论证）这一栏照常工作');

const empty = pivotOf(diag([]));
ok(empty.rows.length === 0 && empty.headline === null, '一条命题都没有：不渲染任何行，也不编主句');
ok(/没有可推敲的命题/.test(empty.line), '空账的总述说的是「没有」，不装成「都没问题」');

const pitch = src('src/shared/pivot.ts');
ok(!/\bscore\b|\bweight\b|\brating\b|\bpoints\b/i.test(pitch.replace(/\/\*[\s\S]*?\*\//g, '')), '内核里没有分数、权重、评分');
ok(!/sum\s*\+?=|reduce\(/.test(pitch), '没有把几个信号加起来的求和（加权就是新尺子）');
ok(/没有权重，也没有总分/.test(pitch), '排序规则里明写「没有权重、没有总分」，并随界面与导出一起给出去');

/* ─────────── 六 · 界面与导出 ─────────── */

const diagTsx = src('src/renderer/src/components/Diagnosis.tsx');
const card = src('src/renderer/src/components/PivotCard.tsx');

ok(/<PivotCard v=\{pivot\} \/>/.test(diagTsx), '报告主体里真的渲染了这一栏（不是只有 import）');
ok(/pivot\.rows\.length > 0/.test(diagTsx), '没有可推敲的命题时整块不出现');
ok(
  diagTsx.indexOf('id="sec-pivot"') < diagTsx.indexOf('id="sec-checks"') &&
    diagTsx.indexOf('id="sec-pivot"') < diagTsx.indexOf('id="sec-verdict"'),
  '位置在检查与判读之前（先知道压在哪一句，再问过不过关、算到哪一档）'
);
ok(/data-pivot=/.test(card), '每一条在界面上带自己的 id（好让异议与检索落得住）');
ok(/pvt-head/.test(card) && /headline/.test(card), '主句单独占一行，不混进卡片里');
ok(/orderNote/.test(card), '排序规则印在界面上（「为什么它在第一」不能是黑箱）');
ok(/落盘的支撑关系/.test(card), '界面自认短处：结构是模型写的，结构错这一栏就跟着错');
ok(/这一栏不说「所以这条是假的」/.test(card), '界面写明它只摆事实、不代判');
ok(/data-pivot-next/.test(card), '「先去核哪一条」在界面上有位置');

/*
 * 类名不许和别处撞车。
 *
 * 这一条是被真事逼出来的：这一栏最初叫 `.pv-*`，而 `.pv` 早就被「原文核对」
 * 用了（`.pv{display:block}`）。两个定义同时生效，`check:css` 是绿的——
 * 它只查「有没有定义」，不查「定义了几次」。症状是行距消失、左侧标记竖着居中，
 * 只有肉眼看截图才发现。撞名不会报错，只会让版式悄悄变掉。
 */
const cssFiles = readdirSync(resolve(process.cwd(), 'src/renderer/src')).filter((f) => f.endsWith('.css'));
const defIn = new Map<string, string[]>();
for (const f of cssFiles) {
  const text = src(`src/renderer/src/${f}`).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of text.matchAll(/\.(pvt[\w-]*)/g)) {
    const name = m[1];
    const list = defIn.get(name) ?? [];
    if (!list.includes(f)) list.push(f);
    defIn.set(name, list);
  }
}
const clashed = [...defIn].filter(([, files]) => files.length > 1);
ok(clashed.length === 0, '这一栏的类名在样式表里只定义一次（撞名不报错，只会让版式悄悄变掉）', clashed.map(([n, f]) => `${n}:${f.join('+')}`).join(' '));
ok((defIn.get('pvt') ?? []).length === 1, '根类名 .pvt 只在一个样式表里定义', JSON.stringify(defIn.get('pvt')));

/* 组件里用到的每一个 pvt 类，样式里都得有——改类名忘了改样式，界面上是「裸的」。 */
const used = new Set([...card.matchAll(/pvt[\w-]*/g)].map((m) => m[0]));
const missing = [...used].filter((n) => !defIn.has(n));
ok(missing.length === 0, 'PivotCard 里用到的类名全部有样式（改类名不丢样式）', missing.join(' '));

const md = src('src/shared/report-markdown.ts');
ok(/## 这一段压在谁身上/.test(md), '导出的 .md 里有这一栏（与界面同一处推导）');
ok(/pivot\.headline/.test(md) && /pivot\.orderNote/.test(md), '导出件里同时带主句与排序规则');

/* ─────────── 收口 ─────────── */

if (failed.length) {
  for (const f of failed) console.error(`✗ ${f}`);
  console.error(`\n✗ 枢纽前提 ${failed.length} 条没过（共 ${passed + failed.length} 条）`);
  process.exit(1);
}
console.log(
  `✓ 枢纽前提：${passed} 条全部通过｜只认已落盘的支撑与争点、必经与替补分得开、同种信号不刷分、结论不进候选、不给分`
);
