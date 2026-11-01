import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Diagnosis } from '@shared/types';
import { CLAIM_BY_ID } from '@shared/theory-base';
import {
  BY_TOOL_LABEL,
  GENRE_LABEL,
  TRACE_LABEL,
  attackOrder,
  genreOf,
  normsOf,
  tracesOf,
  type ByTool,
  type Genre,
  type TraceKind,
} from '@shared/academic';

/**
 * 学术分析的断言测试。跑法：npm run check:academic
 *
 * 这一栏的价值全在「分清哪些是本工具查过的、哪些只能你自己查」。
 * 于是它的断言也围绕这条：
 *
 *   1. 三条「查不了」的规范（引用忠实、数据可追、方法匹配）不许被改成「会查」。
 *      改了就变成另一种东西：一个声称核过引用的工具，比一个明说不核的工具有害。
 *   2. 体裁识别不许猜：没有特征的文本必须判 unknown，不许落到最像的那一类。
 *   3. 待核抽取不许静默失效：每类线索都要能从一个真样例里抽出来；
 *      抽不到时的那句话必须是「没抽出」，不能是「没有需要核的」。
 *   4. 反驳顺序不许被改坏：推理规则必须在第一位且是可辩的，
 *      主张与事实必须在最后且难有结果——这个顺序是这一栏唯一的方法论主张。
 *   5. 动态拼接的样式取值必须逐个存在。check:css 按前缀放宽，
 *      具体取值会不会漏网它管不了，这里兜住。
 */

const errors: string[] = [];
const warn = (m: string) => errors.push(m);
let asserts = 0;
const ok = (cond: boolean, msg: string) => {
  asserts += 1;
  if (!cond) warn(msg);
};

/* ─────────── 一 · 体裁 ─────────── */

/** 每类一个真样例。特征取自真实文本，不是为通过而编的。 */
const GENRE_SAMPLES: { genre: Genre; text: string }[] = [
  {
    genre: 'paper',
    text: '摘要：本文认为彩礼的性质不能只看金额。关键词：彩礼；法律。本研究采用问卷法，样本量为 1200 人，回归结果显示 p<0.05。',
  },
  {
    genre: 'review',
    text: '本文综述已有研究的三种进路（张三 2019）（李四 2020）（王五 2021）。学界普遍认为这一分歧尚未解决。',
  },
  { genre: 'monograph', text: '第三章 论证的结构\n本章认为，担保并不总在字面上出现。下一章将处理反驳。' },
  { genre: 'commentary', text: '书评：评《论证的使用》一书。笔者以为作者的第三步推论过快。' },
  { genre: 'policy', text: '政策建议：监管部门应当建立备案制度。实施路径包括三步，成本由地方承担。' },
  { genre: 'popular', text: '研究表明，早睡的人更长寿。科学家发现，这与褪黑素有关。专家表示还需进一步验证。' },
];

for (const s of GENRE_SAMPLES) {
  const r = genreOf(s.text);
  ok(r.genre === s.genre, `体裁识别失败：「${s.text.slice(0, 12)}…」判成 ${r.genre}（${r.label}），应为 ${s.genre}`);
  ok(r.basis.length > 0, `体裁 ${s.genre} 没有给出依据`);
  ok(r.caveat.length >= 20, `体裁 ${s.genre} 的 caveat 太短（${r.caveat.length} 字），该说清这个体裁下怎么打折看`);
}

// 不许猜：一段没有任何体裁特征的口语，必须落到 unknown
const plain = genreOf('今天天气不错，我们出去走走吧。你要是想来的话就给我说一声。');
ok(plain.genre === 'unknown', `无特征文本被猜成了 ${plain.genre}（${plain.label}）——体裁识别不许猜`);
ok(plain.caveat.includes('留空') || plain.caveat.includes('不按'), 'unknown 体裁的 caveat 没写「不套规范」');

// 每一类都要有标签与 caveat，不能有缺
const GENRES = Object.keys(GENRE_LABEL) as Genre[];
ok(GENRES.length === 7, `体裁应有 7 类，实际 ${GENRES.length}`);
for (const g of GENRES) ok((GENRE_LABEL[g] ?? '').length > 0, `体裁 ${g} 没有标签`);

/* ─────────── 二 · 待核抽取 ─────────── */

const RICH = '（张三 2019）与[1]都提到同一结论，转引自李四。样本量为 1200 人，数据显示 43% 的受访者同意。研究表明这一比例在上升。';
const rich = tracesOf(RICH);
const kinds = new Set(rich.map((t) => t.kind));
const WANT: TraceKind[] = ['citation-year', 'citation-number', 'secondhand', 'sample', 'statistic', 'authority'];
for (const k of WANT) {
  ok(kinds.has(k), `待核抽取漏了 ${k}（${TRACE_LABEL[k]}）——「${RICH.slice(0, 16)}…」里明明有`);
}
ok(rich.length <= 14, `待核条目 ${rich.length} 条，超过上限 14——上限失效，报告会被刷屏`);
for (const t of rich) {
  ok(t.snippet.length > 0 && t.snippet.length <= 90, `待核片段长度异常：${t.snippet.length}`);
  ok(t.ask.length >= 8, `待核条目 ${t.kind} 的提问太短，读者不知道该核什么`);
}

/*
 * 顺序必须是原文顺序，不是按类型分组。
 * 这一条有具体来历：分组排过一版，截图里三条「研究转述」挤在一起、
 * 片段各不相同，看着像重复项。分组排序与位置排序在这句上结果不同，
 * 所以这句话能把它测出来。
 */
const ordered = tracesOf('研究表明，43% 的人同意（张三 2019）。');
ok(ordered[0]?.kind === 'authority', `待核条目没按原文位置排：首条是 ${ordered[0]?.kind}，应为 authority（它在最前面）`);
ok(ordered[ordered.length - 1]?.kind === 'citation-year', `末条是 ${ordered[ordered.length - 1]?.kind}，应为 citation-year`);

/*
 * 中文统计表述不止百分号。这条来自一次真实截图核对：
 * 社论原文写着「一本率下降了 6 个百分点」，第一版正则只认 % 与「百分之」，
 * 于是那句唯一的量化依据被漏掉了——空清单比没有清单更坏，
 * 它让读者以为「没有需要核的地方」。
 */
for (const t of ['下降了 6 个百分点', '翻了一倍', '占了三成', '增长 43%']) {
  ok(tracesOf(t).some((x) => x.kind === 'statistic'), `统计表述没抽出来：「${t}」`);
}

// 纯口语里不该抽出一堆假引用
const quiet = tracesOf('你好，欢迎回到逻辑套圈。这一期我们讨论彩礼。');
ok(quiet.length === 0, `纯口语文本抽出了 ${quiet.length} 处待核：${quiet.map((q) => q.snippet).join(' / ')}`);

/* ─────────── 三 · 规范清单 ─────────── */

/** 最小替身：只填这一栏真正读的字段。 */
const stub = {
  passage: RICH,
  checks: [{ id: 'C1', label: '前提是否成立', question: '前提本身成立吗？' }],
  lens: { kind: 'toulmin', warrant: '钱等于购买', backing: '金钱只有交换功能' },
  premises: [{ id: 'P1', text: '男方婚前给女方一笔钱' }],
  conclusion: { text: '要彩礼就是卖女儿' },
} as unknown as Diagnosis;

const norms = normsOf(stub);
ok(norms.length === 8, `规范清单应有 8 条，实际 ${norms.length}`);
const seen = new Set<string>();
for (const n of norms) {
  ok(!seen.has(n.id), `规范 id 重复：${n.id}`);
  seen.add(n.id);
  ok(n.ask.length >= 8, `规范 ${n.id} 的提问太短`);
  ok(n.why.length >= 30, `规范 ${n.id} 的理由太短，读者不会信`);
  ok(['yes', 'partial', 'no'].includes(n.byTool), `规范 ${n.id} 的 byTool 取值非法：${n.byTool}`);
  ok(n.claimIds.length > 0, `规范 ${n.id} 没挂任何理论主张`);
  for (const id of n.claimIds) {
    ok(Boolean(CLAIM_BY_ID[id]), `规范 ${n.id} 挂了不存在的主张 ${id}`);
  }
}

/*
 * 最关键的一条：那三条必须仍然是「查不了」。
 * 如果有人把它们改成 yes 或 partial，报告就会暗示自己核过引用与数据——
 * 而它看不到你引的那篇，也看不到数据集。这条断言是这一栏的底线。
 */
const MUST_BE_NO = ['cite-fidelity', 'data-trace', 'method-fit'];
for (const id of MUST_BE_NO) {
  const n = norms.find((x) => x.id === id);
  ok(Boolean(n), `规范清单里没有 ${id}`);
  ok(n?.byTool === 'no', `${id} 的 byTool 是 ${n?.byTool}，应为 no——这条被改成「会查」就等于声称核过原文`);
}
const noCount = norms.filter((n) => n.byTool === 'no').length;
ok(noCount === 3, `标 no 的有 ${noCount} 条，应为 3 条`);

// covered 字段：能挂上就是字符串，挂不上必须是 null，不许空字符串
for (const n of norms) {
  ok(n.covered === null || n.covered.length > 2, `规范 ${n.id} 的 covered 既不是 null 也不是有效描述：${JSON.stringify(n.covered)}`);
}
// 替身里那条检查项含「前提」，举证责任那条应当认领它
const burden = norms.find((n) => n.id === 'burden');
ok(burden?.covered !== null, '替身里的检查项明显对得上「举证／前提」，却没认领——covered 匹配失效');

for (const k of Object.keys(BY_TOOL_LABEL) as ByTool[]) {
  ok(BY_TOOL_LABEL[k].length > 0, `byTool ${k} 没有标签`);
}

/* ─────────── 四 · 反驳顺序 ─────────── */

const atk = attackOrder(stub);
ok(atk.length === 4, `反驳顺序应有 4 层，实际 ${atk.length}`);
ok(atk[0]?.tier === 'warrant', `第一层是 ${atk[0]?.tier}，应为 warrant——顺序纪律被改坏了`);
ok(atk[0]?.contested === 'high', `推理规则的可辩度是 ${atk[0]?.contested}，应为 high`);
ok(atk[atk.length - 1]?.tier === 'claim', `最后一层是 ${atk[atk.length - 1]?.tier}，应为 claim`);
ok(atk[atk.length - 1]?.contested === 'low', '主张层的可辩度不是 low——这不许改：直接否定主张只是另一种主张');
const groundTier = atk.find((a) => a.tier === 'ground');
ok(groundTier?.contested === 'low', '事实层的可辩度不是 low');
ok(new Set(atk.map((a) => a.tier)).size === 4, '反驳顺序里有重复层');
for (const a of atk) {
  ok(a.target.length > 0, `反驳层 ${a.tier} 没有指到具体位置`);
  ok(a.why.length >= 20, `反驳层 ${a.tier} 没写理由`);
}

/* ─────────── 五 · 样式取值兜底 ─────────── */

/*
 * check:css 对动态拼接按前缀放宽（`ac-by-${x}` 只要存在任一 `ac-by-*` 就算过），
 * 所以某个具体取值被删掉时它不会响。这里逐个点名。
 */
const css = readFileSync(join('src/renderer/src', 'styles-flow.css'), 'utf-8');
const mustHave = [
  '.ac-by-yes',
  '.ac-by-partial',
  '.ac-by-no',
  '.ac-atk-high',
  '.ac-atk-low',
  '.ac-norm.on',
  '.ac-box',
  '.ac-trace',
  '.ac-snip',
  '.ac-kind',
];
for (const sel of mustHave) {
  ok(css.includes(`${sel} `) || css.includes(`${sel}{`) || css.includes(`${sel},`), `样式缺 ${sel}`);
}

/* ─────────── 收尾 ─────────── */

if (asserts < 45) {
  warn(`只跑了 ${asserts} 条断言，低于 45——断言被整批删掉时这里要响`);
}

if (errors.length) {
  console.error(`✗ 学术分析 ${errors.length} 处问题：`);
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log(
  `✓ 学术分析：${asserts} 条断言通过｜体裁 ${GENRES.length} 类｜待核 ${WANT.length} 类线索｜` +
    `规范 ${norms.length} 条（其中 ${noCount} 条本工具查不了）｜反驳顺序 4 层`
);
