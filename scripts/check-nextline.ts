/**
 * 「看完报告之后，你下一句想说什么」的断言。
 *
 * 这一块的全部价值押在一句话上：**这句话是人说的，一个字都不许被软件改写或重新分类。**
 * 所以这里验的不是文案好不好看，而是：
 *   1. 原话逐字存下——只去首尾空白，中间的空格、标点、语气词一个不动；
 *   2. 差一个字就是两句（「所以呢」与「所以呢？」不合并），合并要判断，判断不归这一层；
 *   3. 输入顺序打乱，整份账逐字节不变；同一时刻按 id 定序（样本第一条故意不是最近那份）；
 *   4. 空记录不进明细、不算「一句」、也不影响时间跨度；
 *   5. 读不出来的行、形状不对的记录都单独数出来，不静默吞掉；
 *   6. 导出里除了固定模板、时间与用户原话，不剩一个本地新写的汉字；
 *   7. 顶层没有 score / verdict / level，没有一句劝告。
 *
 * 防恒真写在每处：主样本本身就不是时间有序的（去掉排序立刻红），
 * 打乱前后 id 顺序确实不同，最大次数 5 与组数 1 刻意不相等。
 *
 * 跑法：npm run check:nextline
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  NEXT_LINE_MAX,
  nextLineHead,
  nextLineIssue,
  nextLineRow,
  nextLineText,
  nextLinesOf,
  parseNextLineRecord,
  type NextLineRecord,
} from '@shared/nextline';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}

/** 时间格式化交给调用方；这里用纯数字，好在后面把「本地新写的汉字」一条条扣干净。 */
const FMT = (at: number): string => String(at);

function rec(id: string, at: number, text: string, diagId = 'd1', theory = 'toulmin'): NextLineRecord {
  return { id, at, text, diagId, passageHead: '原文开头几个字', theory };
}

/**
 * 主样本，**故意不是时间有序的**：第一个是 n9（与 n1 同一时刻、id 更大）。
 * 「去掉排序」这个变异只有在这种样本上才会红；按时间排好再喂进来，等于没写断言。
 */
const FIXTURE: NextLineRecord[] = [
  rec('n9', 9000, '所以呢？'),
  rec('n1', 9000, '所以呢'),
  rec('n3', 8000, '这话说得太满，去年我们学校也取消过早读，成绩没降'),
  rec('n2', 8500, '所以呢'),
  rec('n7', 4000, '   '),
  rec('n5', 6000, '所以呢'),
  rec('n8', 4000, '所以呢'),
  rec('n6', 5000, '所以呢'),
];

/** 同一份数据，顺序再打乱一次：这次第一条连 9000 都不是。 */
const SHUFFLED: NextLineRecord[] = [
  FIXTURE[5],
  FIXTURE[0],
  FIXTURE[7],
  FIXTURE[2],
  FIXTURE[4],
  FIXTURE[1],
  FIXTURE[6],
  FIXTURE[3],
];

const V = nextLinesOf(FIXTURE);
const W = nextLinesOf(SHUFFLED);

/* ── 数目：最大次数(5) 与组数(1) 刻意不相等，写错字段的变异才不会白绿 ── */
ok(V.total === 8, '记录 8 条', String(V.total));
ok(V.usable === 7, '说得出来的 7 句', String(V.usable));
ok(V.blanks === 1, '空白 1 条，单独数出来', String(V.blanks));
ok(V.groups.length === 1, '只有一组逐字相同', String(V.groups.length));
ok(V.groups[0].count === 5, '那一组出现 5 次', String(V.groups[0].count));
ok(V.topCount === 5, '最多的一句出现 5 次', String(V.topCount));
ok(V.topCount !== V.groups.length, '样本里最大次数与组数不同，写错字段的变异才不会白绿');
ok(V.lines.length + V.blanks === V.total, '明细条数加空白条数正好等于记录总数');
ok(V.firstAt === 4000 && V.lastAt === 9000, '最早 / 最晚只按说得出来的句子算', `${V.firstAt}/${V.lastAt}`);

/* ── 顺序：主样本本身无序，乱序输入结果必须逐字节相同 ── */
ok(FIXTURE[0].at === 9000 && FIXTURE[0].id === 'n9', '样本第一条确实是 n9（不是时间最近的那条里的第一条）');
ok(
  V.lines.map((r) => r.id).join(',') === 'n1,n9,n2,n3,n5,n6,n8',
  '明细按时间降序；同一时刻按 id 升序（n1 在 n9 前，而不是按输入顺序）',
  V.lines.map((r) => r.id).join(','),
);
ok(SHUFFLED[0].at !== 9000, '打乱后第一条确实不是最近那份（这条本身不能恒真）');
ok(SHUFFLED.map((r) => r.id).join(',') !== FIXTURE.map((r) => r.id).join(','), '打乱前后 id 顺序确实不同');
ok(JSON.stringify(W) === JSON.stringify(V), '输入顺序打乱，整份账逐字节相同');
ok(JSON.stringify(nextLinesOf(FIXTURE)) === JSON.stringify(V), '同一输入两次调用逐字节相同');

/* ── 逐字：只去首尾空白，差一个字就是两句 ── */
ok(V.lines.some((r) => r.text === '所以呢？'), '「所以呢？」原样留着，没被并进「所以呢」');
ok(!V.groups.some((g) => g.text === '所以呢？'), '它也不构成重复组（并了就会多一句）');
const TRIM = nextLinesOf([rec('t1', 2, '所以呢 '), rec('t2', 1, ' 所以呢')]);
ok(TRIM.lines.length === 2 && TRIM.lines[0].text === '所以呢', '首尾空白被去掉，存的是原话本身');
ok(TRIM.groups.length === 1 && TRIM.groups[0].count === 2, '去掉首尾空白之后逐字相同，算同一句');
const INNER = nextLinesOf([rec('i1', 2, '所以 呢'), rec('i2', 1, '所以呢')]);
ok(INNER.lines.length === 2 && INNER.lines[0].text === '所以 呢', '中间的空格一个字都不动');
ok(INNER.groups.length === 0, '中间多一个空格就是另一句，不做「规范化」');
ok(
  nextLinesOf([rec('a', 2, '同一句话'), rec('b', 1, '同一句话')]).lines.length === 2,
  '同一句话记两次就是两条，不去重（去重会把「手抖点两下」藏起来）',
);

/* ── 空记录：不算一句、不进明细、不影响时间跨度 ── */
ok(!V.lines.some((r) => r.id === 'n7'), '空白记录不进明细');
ok(nextLinesOf([rec('z', 1, ' \n ')]).usable === 0, '只有空白记录时一句都没有');
const ALLBLANK = nextLinesOf([rec('z1', 7, '  '), rec('z2', 3, '')]);
ok(ALLBLANK.firstAt === null && ALLBLANK.lastAt === null, '一句都没有时时间跨度是 null，不拿 0 冒充');
const BLANKAFTER = nextLinesOf([rec('a', 9, '一句'), rec('b', 1, '  ')]);
ok(BLANKAFTER.firstAt === 9 && BLANKAFTER.lastAt === 9, '空白记录不参与时间跨度');
ok((nextLineHead(BLANKAFTER, FMT) ?? '').includes('有 1 条是空的'), '空白条数在界面上可见');

/* ── 坏记录：形状不对也计进坏数，不让一条坏数据毁掉整份账 ── */
ok(nextLinesOf(FIXTURE, 2).badLines === 2, '传入的坏行数原样记下，不被修正成好看的值');
ok(nextLinesOf(FIXTURE, -1).badLines === 0 && nextLinesOf(FIXTURE, 2.9).badLines === 2, '坏参数不产生负数或小数');
ok(
  nextLinesOf([...FIXTURE, { id: 'bad', at: 3, text: 42 } as unknown as NextLineRecord]).badLines === 1,
  '形状不对的记录也计进坏数',
);
ok(parseNextLineRecord(null) === null && parseNextLineRecord({}) === null, '认不出来的行返回 null，交给坏行计数');
ok(parseNextLineRecord({ id: '', at: 1, text: 'x', diagId: 'd' }) === null, '空 id 不认');
ok(parseNextLineRecord({ id: 'a', at: Number.NaN, text: 'x', diagId: 'd' }) === null, 'NaN 时间不认');
ok(parseNextLineRecord({ id: 'a', at: 1, text: 1, diagId: 'd' }) === null, '非字符串的原话不认');
ok(parseNextLineRecord({ id: 'a', at: 1, text: 'x', diagId: 'd' })?.passageHead === '', '缺字段的补空串，不编内容');
ok(
  parseNextLineRecord({ id: 'a', at: 1, text: 'x', diagId: 'd', passageHead: '开头', theory: 't' })?.theory === 't',
  '透镜原样带回',
);

/* ── 记之前先问一句：空的不记、超长的也不记（不静默截断） ── */
ok(nextLineIssue('') !== null, '空的不记');
ok(nextLineIssue('   ') !== null, '只有空白的也不记');
ok(nextLineIssue(42) !== null, '非字符串不记');
ok(nextLineIssue('所以呢') === null, '一句正常的话可以记');
ok(nextLineIssue('字'.repeat(NEXT_LINE_MAX)) === null, '正好到上限可以记');
ok(nextLineIssue('字'.repeat(NEXT_LINE_MAX + 1)) !== null, '超过上限不记');
ok(
  (nextLineIssue('字'.repeat(NEXT_LINE_MAX + 1)) ?? '').includes(`超过 ${NEXT_LINE_MAX} 字`),
  '拒绝的理由说清是哪条线，不是一句「太长」',
);
ok(
  (nextLineIssue('字'.repeat(NEXT_LINE_MAX + 1)) ?? '').includes(String(NEXT_LINE_MAX + 1)) === false,
  '拒绝时回报的是上限，不是用户实际写了多少（两件事不能说混）',
);

/* ── 只说数目，不评价 ── */
const HEAD = nextLineHead(V, FMT) ?? '';
ok(HEAD.includes('本机记了 7 句「看完报告之后说的话」'), '主句只陈述数目', HEAD);
ok(HEAD.includes('其中 1 组、共 5 句是逐字相同的；出现最多的一句有 5 次'), '重复的组数与最高次数各带单位', HEAD);
ok(HEAD.includes('时间从 4000 到 9000'), '时间跨度用调用方给的格式');
ok(HEAD.includes('有 1 条是空的，没有算进来'), '空白没有被静默吞掉');
ok(!/建议|应该|应当|不妨|最好|太少|太短|空泛|质量/.test(HEAD), '界面上不劝、不评价');
ok(nextLineHead(nextLinesOf([]), FMT) === null, '一条都没有时什么都不说，不编一句「0 句」');
ok(
  (nextLineHead(nextLinesOf([], 3), FMT) ?? '').includes('另有 3 条读不出来，没有计入'),
  '只有坏行时也说清是读不出来',
);
const ONE = nextLinesOf([rec('one', 5, '一句')]);
ok((nextLineHead(ONE, FMT) ?? '').includes('时间从') === false, '只有一句时不显示时间跨度');
ok(!HEAD.includes('undefined') && !HEAD.includes('NaN'), '不把空值拼进句子');
ok(!/score|verdict|level|summary|conclusion/.test(JSON.stringify(V)), '顶层没有能拿来当结论的字段');
for (const k of ['score', 'verdict', 'level', 'pass', 'conclusion', 'quality']) {
  ok(!(k in (V as unknown as Record<string, unknown>)), `顶层没有 ${k} 字段`);
}

/* ── 导出：逐字、无总结、每个汉字都有来处 ── */
const TXT = nextLineText(V, FMT);
ok(TXT.split('\n').length === 2 + V.usable, '导出只有一行总述、一个空行和每句一行，没有结尾总结');
ok(TXT.startsWith(HEAD), '导出的第一行就是界面上那一行，不另写一套说法');
ok(V.lines.every((r) => TXT.includes(r.text)), '每一句在导出里逐字出现');
ok(nextLineRow(V.lines[0], 1, FMT) === '1. 9000 · 所以呢', '明细行只由模板、时间、原话拼成');
ok(nextLineText(nextLinesOf([]), FMT).split('\n').length === 2, '空清单不带任何一行明细');
ok(nextLineText(V, FMT).includes('undefined') === false && nextLineText(V, FMT).includes('[object') === false, '不把对象拼进文本');

/** 把用户原话与固定模板词全部扣掉，剩下不该再有一个汉字。 */
let stripped = TXT;
for (const r of V.lines) stripped = stripped.split(r.text).join('');
for (const w of [
  /* 长词先扣：先扣「有」会把「没有算进来」拆成残留的汉字。 */
  '看完报告之后说的话', '本机还没有记下任何一句', '是逐字相同的', '出现最多的一句有',
  '没有算进来', '没有计入', '另有', '条读不出来', '条是空的', '时间从', '本机记了',
  '组、共', '其中', '次', '句', '有', '到', '另',
  '。', '；', '，', '、', '「', '」', ' ',
]) {
  stripped = stripped.split(w).join('');
}
stripped = stripped.replace(/[0-9.]/g, '').replace(/·/g, '').replace(/\n/g, '');
ok(!/[\u4e00-\u9fa5]/.test(stripped), '扣掉原话与固定模板后，导出里不剩一个本地新写的汉字', stripped.slice(0, 80));

/* ── 内核守则：不碰 electron、不读报告类型、字面量里没有劝告 ── */
const SRC = readFileSync(resolve('src/shared/nextline.ts'), 'utf-8');
const LITERALS = [...SRC.matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)].map((m) => m[1] ?? m[2] ?? '').join('\n');
ok(!/from ['"]electron['"]|from ['"]@shared\/types['"]/.test(SRC), '内核不碰 electron、不读报告类型');
ok(!/suggest|advice|recommend/i.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '')), '内核里没有一句劝告性的标识符');
ok(
  !/建议|应该|应当|试试|不妨|最好|结论|证明|因此|质量|评分|得分|判定|太少|换一段/.test(LITERALS),
  '源码的字符串字面量里没有一句劝告或判断（注释不算，注释是给维护者看的）',
);

/*
 * 纯函数守得住「怎么显示」，守不住主进程有没有真的按原话存、有没有把失败抛出来。
 *
 * 这里三条都盯**调用点**，不盯名字：第一版写成 /appendJsonl/ 与 /nextLineIssue/，
 * 结果 import 那一行就满足了它们——把调用换成整份重写、换成另一套校验，照样全绿。
 * 反证第一次跑就把这两条抓了出来。名字出现在文件里，和它被用来做事，是两件事。
 */
const MAIN = readFileSync(resolve('src/main/nextlines.ts'), 'utf-8');
ok(/nextLineIssue\(\s*input/.test(MAIN), '主进程在调用点上用同一个校验函数，不在两处各写一套上限');
ok(/appendJsonl\(nextLinesFile\(\)/.test(MAIN), '新增一条在调用点上是追加，不是整份重写（整份重写会覆盖并发的另一笔）');
ok(/rewriteJsonlRaw\(nextLinesFile\(\)/.test(MAIN), '删除按原样的行重写，读不出来的行不被顺手抹掉');
ok(/throw new Error\(issue\)/.test(MAIN), '校验不过就抛，不静默返回一份「看起来记上了」的账');
ok(!/catch\s*\([^)]*\)\s*\{\s*\}/.test(MAIN), '主进程里没有空 catch（写失败不许在这里消失）');

/* ── 汇总（verify 只取最后一行，所以汇总必须放最后） ─────────── */
if (failed.length) {
  console.error(`✗ check:nextline 红了 ${failed.length} 处（通过 ${passed} 条）\n`);
  for (const f of failed) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`✓ check:nextline 通过 ${passed} 条｜原话逐字、差一字不合并、顺序无关、例外可见、不写判断`);
