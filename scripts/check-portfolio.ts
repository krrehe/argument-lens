/**
 * 「样本账」的断言。
 *
 * 这一块全部价值押在一句话上：**裸提示词不可能知道你跑过几段不同的文字**。
 * 一旦它开始劝人「该换一段了」、开始给样本打分、开始把读不出来的文件悄悄略过，
 * 它就退回成又一份替人下判断的文字，而这正是这一轮要躲开的东西。
 *
 * 所以这里验的是构造性质，不是文案好不好看：
 *   1. 输入顺序打乱，账逐字节不变；每组的代表仍是时间最近那份（防目录顺序当事实）；
 *   2. 逐字相同 / 加一句的改稿归一组，不同文本分开，短文本只认逐字相同；
 *   3. 摘录逐字来自原文，未被覆盖的字符一个不少；
 *   4. 读不出来的文件、空原文、时间跨度都单独数出来，不静默跳过；
 *   5. 顶层没有 score / verdict / level；导出里没有一句本地新写的汉字判断；
 *   6. 确定性、行数、空存档、坏参数，各有能踩到的样本。
 *
 * 防恒真写在每处：排序样本的第一条故意不是最近那份，最大组份数故意不等于组数，
 * 打乱前后的 id 顺序确实不同。写在天然有序样本上的断言等于没写。
 *
 * 跑法：npm run check:portfolio
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EXCERPT_LEN,
  groupLine,
  portfolioLine,
  portfolioOf,
  portfolioText,
  type PortfolioView,
} from '@shared/portfolio';
import { normalizePassage, type PriorPassage } from '@shared/sameness';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}

/** 时间格式化交给调用方；这里用纯数字，好在后面把「本地新写的汉字」一条条扣干净。 */
const FMT = (at: number): string => String(at);

/** 内核源码也当输入读：有几条约束只有扫源码才守得住（不碰 electron、不另定阈值、不写劝告）。 */
const SRC = readFileSync(resolve('src/shared/portfolio.ts'), 'utf-8');
const LITERALS = [...SRC.matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)].map((m) => m[1] ?? m[2] ?? '').join('\n');

const BASE =
  '我们学校去年取消了早读，今年高考一本率下降了六个百分点。这说明取消早读是错的。' +
  '学校应该恢复早读，并且把它写进作息制度里，让每个班都执行。';
/** 真实存档里那 8 份改稿的样子：同一段话加一句。 */
const LIGHT = BASE + '另外，隔壁两个县情况类似。';
const OTHER =
  '市面上的护肝片大多把排毒两个字印在包装正面，包装上却没写排的是什么、拿什么量。' +
  '客服给的回答是很多人吃了精神好，这跟肝有没有变好是两件事。';
const SHORT_A = '你行你上';
const SHORT_B = '你行你上啊';

/** 按时间降序写，但断言不依赖这个顺序：下面另有打乱的同一份数据。 */
const FIXTURE: PriorPassage[] = [
  { id: 'a1', at: 9000, passage: BASE },
  { id: 'a2', at: 8000, passage: BASE },
  { id: 'a3', at: 7000, passage: BASE },
  { id: 'a4', at: 6000, passage: LIGHT },
  { id: 'b1', at: 5000, passage: OTHER },
  { id: 's1', at: 4000, passage: SHORT_A },
  { id: 'z1', at: 2000, passage: '   ' },
];
/**
 * 同一份数据，顺序真的打乱了：第一条不是时间最近那份。
 * 「去掉排序」这个变异只有在这份样本上才会红。
 */
const SHUFFLED: PriorPassage[] = [FIXTURE[3], FIXTURE[6], FIXTURE[1], FIXTURE[4], FIXTURE[0], FIXTURE[5], FIXTURE[2]];

const V = portfolioOf(FIXTURE);
const W = portfolioOf(SHUFFLED);

/* ── 数目：故意让 largest(4) ≠ groups(3)，否则「写错字段」的变异会白绿 ── */
ok(V.reports === 7, '读得出来的报告 7 份', String(V.reports));
ok(V.blanks === 1, '空原文 1 份，单独数出来', String(V.blanks));
ok(V.groups === 3, '分成 3 组', String(V.groups));
ok(V.largest === 4, '最大的那组 4 份（逐字 3 份 + 加一句的改稿 1 份）', String(V.largest));
ok(V.singletons === 2, '只跑过一次的 2 组', String(V.singletons));
ok(V.largest !== V.groups, '样本里最大组份数与组数不同，写错字段的变异才不会白绿');
ok(
  V.buckets.reduce((n, g) => n + g.size, 0) + V.blanks === V.reports,
  '每组的份数加起来加空原文，正好等于报告总数',
);
ok(V.firstAt === 2000 && V.lastAt === 9000, '最早 / 最晚时间取的是真实边界', `${V.firstAt}/${V.lastAt}`);
ok(V.badFiles === 0, '没有坏文件时就是 0，不编一个出来');

/* ── 分组口径：沿用 sameness，不另造一套 ── */
ok(V.buckets[0].ids.join(',') === 'a1,a2,a3,a4', '同组四份按时间降序留着，不合并、不丢', V.buckets[0].ids.join(','));
ok(V.buckets[0].at === 9000, '代表句是这一组最近的那份', String(V.buckets[0].at));
ok(V.buckets[1].excerpt === normalizePassage(OTHER).slice(0, EXCERPT_LEN), '另一组认得出来是哪段文字');
ok(
  portfolioOf([
    { id: 'x1', at: 2, passage: SHORT_A },
    { id: 'x2', at: 1, passage: SHORT_B },
  ]).groups === 2,
  '两句短文本只差一个字，不靠几个二元组算相似度（守卫真的会被踩到）',
);
ok(
  portfolioOf([
    { id: 'x1', at: 2, passage: SHORT_A },
    { id: 'x2', at: 1, passage: SHORT_A },
  ]).groups === 1,
  '逐字相同的短文本仍然归一',
);
ok(/NEAR_SAME/.test(SRC) && !/=\s*0\.\d+\s*;/.test(SRC), '分组阈值直接取自 sameness，不在这一层另定一个数');

/* ── 顺序无关：这两条要一起看，缺一条就是恒真 ── */
ok(SHUFFLED[0].at !== 9000, '打乱后第一条确实不是最近那份（这条本身不能恒真）');
ok(SHUFFLED.map((p) => p.id).join(',') !== FIXTURE.map((p) => p.id).join(','), '打乱前后 id 顺序确实不同');
ok(JSON.stringify(W) === JSON.stringify(V), '输入顺序打乱，整份账逐字节相同');
ok(W.buckets[0].at === 9000, '打乱后代表句仍是 9000 那份，不是目录里第一份', String(W.buckets[0].at));
ok(
  JSON.stringify(portfolioOf(FIXTURE)) === JSON.stringify(V),
  '同一输入两次调用逐字节相同',
);

/* ── 摘录：逐字来自原文，不改写、不概括 ── */
ok(V.buckets.every((g) => g.excerpt.length <= EXCERPT_LEN), '摘录不越过约定长度');
ok(
  V.buckets[0].excerpt === normalizePassage(BASE).slice(0, EXCERPT_LEN),
  '摘录逐字等于代表文本的前若干字',
);
ok(normalizePassage(BASE).startsWith(V.buckets[0].excerpt), '摘录是原文前缀，不是摘要');
ok(V.buckets[0].truncated === true && V.buckets[2].truncated === false, '长文本标明被截断，短文本不标');
ok(V.buckets[0].chars === normalizePassage(BASE).length, '代表文本字数按规范化后的原文算');
ok(V.buckets.map((g) => g.index).join(',') === '1,2,3', '组号从 1 起，按最近时间排，不按份数排');
ok(V.buckets[0].index === 1 && V.buckets[0].size === 4, '最大那组排第一只是因为时间最近，不是因为份数多');

/* ── 只数事实，不给结论 ── */
const LINE = portfolioLine(V, FMT) ?? '';
ok(LINE.includes('本机 7 份报告，落在 3 组不同的文字上'), '主句只陈述数目', LINE);
ok(LINE.includes('最多的那组 4 份，只跑过一次的有 2 组'), '数字各自带上单位，不靠位置猜', LINE);
ok(LINE.includes('时间从 2000 到 9000'), '时间跨度用调用方给的格式');
ok(LINE.includes('1 份原文是空的，没有参与分组'), '空原文没有被静默吞掉');
ok(!LINE.includes('建议') && !LINE.includes('应该') && !LINE.includes('换一段'), '不劝人换文本');

const WITH_BAD = portfolioOf(FIXTURE, 2);
ok(WITH_BAD.badFiles === 2, '传入的坏文件数原样记下，不被修正成好看的值');
ok((portfolioLine(WITH_BAD, FMT) ?? '').includes('另有 2 个报告文件读不出来，没有计入'), '坏文件在账上可见');
ok(portfolioOf([], 3).badFiles === 3, '一份报告都没有时，坏文件数照样在');
ok(portfolioLine(portfolioOf([]), FMT) === null, '空存档什么也不说，不编一句「0 组」');
ok((portfolioLine(portfolioOf([], 3), FMT) ?? '').includes('本机还没有读得出来的报告'), '只有坏文件时说清是读不出来');
ok(portfolioOf(FIXTURE, -1).badFiles === 0 && portfolioOf(FIXTURE, 2.9).badFiles === 2, '坏参数不产生负数或小数');
ok(
  portfolioOf([...FIXTURE, { id: 'oops', at: 1, passage: 42 as unknown as string }]).badFiles === 1,
  '形状不对的记录也计入坏数，不让一行坏数据毁掉整份账',
);

const BANNED_KEYS = ['score', 'verdict', 'level', 'pass', 'passed', 'conclusion', 'summary', 'result', 'satisfied', 'quality'];
ok(
  BANNED_KEYS.every((k) => !(k in (V as unknown as Record<string, unknown>))),
  '顶层没有一个字段能拿来当结论',
);
ok(!/from ['"]electron['"]|from ['"]@shared\/types['"]/.test(SRC), '内核不碰 electron、不读报告类型');
/* 纯函数守得住 badFiles 怎么显示，守不住主进程有没有真的把它数出来。 */
const ARCHIVE = readFileSync(resolve('src/main/archive.ts'), 'utf-8');
ok(/badFiles\s*\+=\s*1/.test(ARCHIVE), '读不出来的报告文件在主进程里被计数，不是 continue 就过去');
ok(/dirError:\s*\(err as Error\)/.test(ARCHIVE), '连目录都打不开时把原因回出去，不是回填 null');
ok(
  !/建议|应该|应当|试试|不妨|最好|结论|证明|因此|所以|质量|评分|得分|判定|太少|换一段/.test(LITERALS),
  '源码的字符串字面量里没有一句劝告或判断（注释不算，注释是给维护者看的）',
);

/* ── 导出：逐字、无总结、每个汉字都有来处 ── */
const TXT = portfolioText(V, FMT);
ok(TXT.split('\n').length === 2 + V.buckets.length, '导出只有一行总述、一个空行和每组一行，没有结尾总结');
ok(TXT.startsWith(LINE), '导出的第一行就是界面上那一行，不另写一套说法');
ok(V.buckets.every((g) => TXT.includes(groupLine(g, FMT))), '每一组在导出里逐字出现');
ok(V.buckets.every((g) => TXT.includes(g.excerpt)), '原文摘录在导出里逐字出现');
ok(groupLine(V.buckets[0], FMT) === `第 1 组 · 4 份 · 最近一次 9000 · ${V.buckets[0].excerpt}…`, '明细行只由模板、时间、摘录拼成');
ok(
  !/因此|所以|综上|建议|应该|结论|证明/.test(TXT),
  '导出文本里没有一句本地新下的判断',
);
/** 把原文摘录与固定模板词全部扣掉，剩下不该再有一个汉字。 */
let stripped = TXT;
for (const g of V.buckets) stripped = stripped.split(g.excerpt).join('');
for (const w of [
  /* 长词必须先扣：先扣单字「有」会把「没有参与分组」拆成残留的汉字。 */
  '本机还没有读得出来的报告', '组不同的文字上', '最多的那组', '只跑过一次的有',
  '份原文是空的', '没有参与分组', '个报告文件读不出来', '没有计入',
  '时间从', '落在', '本机', '份报告', '最近一次', '第', '另', '到', '组', '份', '有',
]) {
  stripped = stripped.split(w).join('');
}
ok(!/[\u4e00-\u9fa5]/.test(stripped), '扣掉原文与固定模板后，导出里不剩一个本地新写的汉字', stripped.slice(0, 80));

/* ── 空清单 / 边界 ── */
const EMPTY: PortfolioView = portfolioOf([]);
ok(portfolioText(EMPTY, FMT).split('\n').length === 2, '空清单不带一组明细');
ok(portfolioText(EMPTY, FMT).includes('本机还没有读得出来的报告'), '空清单说清是空的');
ok(!portfolioLine(V, FMT)?.includes('undefined') && !portfolioLine(V, FMT)?.includes('NaN'), '不把空值拼进句子');
ok(
  portfolioLine(portfolioOf([{ id: 'one', at: 5, passage: BASE }]), FMT)?.includes('时间从') === false,
  '只有一份时不显示时间跨度（同一时刻说「从…到…」比不说更假）',
);

/* ── 汇总（verify 只取最后一行，所以汇总必须放最后） ─────────── */
if (failed.length) {
  console.error(`✗ check:portfolio 红了 ${failed.length} 处（通过 ${passed} 条）\n`);
  for (const f of failed) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`✓ check:portfolio 通过 ${passed} 条｜顺序无关、摘录逐字、例外可见、不写判断`);
