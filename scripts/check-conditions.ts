/**
 * 「自己列成立条件」的断言。
 *
 * 这一屏全部价值押在一个方向：**条件、依据、结论都在人手里**。
 * 一旦内核开始替人写一句话、替人排优先级、或把几个勾选合成一个结论，
 * 它就退回成「又一份生成好的东西」，而界面上看起来仍然只是一张清单。
 *
 * 所以这里验的是构造性质，不是文案：
 *   1. 原文逐句拼回来逐字等于 passage（含空行与结尾空白）；
 *   2. 每条挂上去的引文都带原文坐标，切片能对上那一句；
 *   3. 输出的字符串叶子只来自原文 / 用户写的字 / 固定枚举码，没有本地新写的判断；
 *   4. 只数事实，不给结论：顶层没有 score / verdict / level，源码不 import 报告类型；
 *   5. 空行是「还没填」，点了却不写、点越界、原文没有句子，都明说，不静默；
 *   6. 同一句可以挂好几条、行的顺序不重排、没被问到的句子逐句列出。
 *
 * 跑法：npm run check:conditions
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  conditionsOf,
  conditionsText,
  CONDITION_MARK_LABEL,
  CONDITION_PROBLEM_LABEL,
  type ConditionInput,
  type ConditionView,
} from '@shared/conditions';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}

const S1 = '我们学校去年取消早读，今年一本率下降了 6 个百分点。';
const S2 = '所以取消早读是错的，应当恢复早读。';
const S3 = '其实去年同期也降过。';
const PASSAGE = S1 + S2 + S3;

const INPUTS: ConditionInput[] = [
  { id: 'c1', text: '得先排除别的因素', mark: 'yes', sentence: 0 },
  { id: 'c2', text: '去年和今年只差早读这一件事', mark: 'no', sentence: 0 },
  { id: 'c3', text: '样本得够多', mark: 'unknown', sentence: 2 },
  { id: 'c4', text: '', mark: 'unknown', sentence: null },
];
const V = conditionsOf(PASSAGE, INPUTS);

/* ── 原文与坐标 ─────────────────────────────────────────────── */
ok(V.sentences.map((s) => s.text).join('') === PASSAGE, '逐句拼回来逐字等于原文');
ok(V.sentences.length === 3, '切出三句', `实际 ${V.sentences.length}`);
ok(V.passage === PASSAGE, '原文原样回显');
ok(
  V.rows.every((r) => r.quote === null || (r.quote === PASSAGE.slice(r.quoteStart, r.quoteEnd) && r.quoteEnd > r.quoteStart)),
  '每条引文都能按记下的坐标从原文切出来',
);
ok(
  V.rows.every((r) => r.sentence === null || r.quote === null || r.quote === V.sentences[r.sentence]?.text),
  '每条引文逐字等于它点的那一句',
);
ok(V.rows[0]?.quote === S1 && V.rows[2]?.quote === S3, '第 1 条挂第 1 句、第 3 条挂第 3 句');
ok(V.rows[1]?.quote === V.rows[0]?.quote, '同一句挂了两条，两条都留着，不合并');
ok(JSON.stringify(V.rows.map((r) => r.id)) === JSON.stringify(INPUTS.map((i) => i.id)), '行的顺序不重排，不替人排优先级');
ok(V.rows[0]?.text === INPUTS[0]?.text && V.rows[2]?.text === INPUTS[2]?.text, '用户写的条件原样保留');

/* ── 只数事实，不给结论 ─────────────────────────────────────── */
ok(JSON.stringify(V.asked) === '[0,2]', '被问到的句子去重且升序', JSON.stringify(V.asked));
ok(JSON.stringify(V.unasked) === '[1]', '没被问到的那一句逐句列出', JSON.stringify(V.unasked));
ok(
  V.counts.written === 3 && V.counts.marked === 2 && V.counts.linked === 3 && V.counts.askedSentences === 2,
  '写 3 条 / 标 2 条 / 挂 3 条 / 问到 2 句',
  JSON.stringify(V.counts),
);
const BANNED_KEYS = ['score', 'verdict', 'level', 'pass', 'passed', 'conclusion', 'summary', 'result', 'satisfied'];
ok(
  Object.keys(V).every((k) => !BANNED_KEYS.includes(k)),
  '顶层没有任何「结论」字段',
  Object.keys(V).join(','),
);
ok(
  Object.keys(V.counts).every((k) => !BANNED_KEYS.includes(k)),
  '统计里也没有藏着一个总分',
);
ok(JSON.stringify(conditionsOf(PASSAGE, INPUTS)) === JSON.stringify(V), '同一输入两次调用逐字节相同');
/* 「升序」这条断言写在天然升序的样本上会恒真：按 0、0、2 填，不排序也照样是 [0,2]。
   必须拿倒着填的输入踩一次，才知道排序真的在跑。 */
/* id 也故意乱序：否则「不重排」写在天然按字母排好的样本上同样是恒真。 */
const REVERSED: ConditionInput[] = [
  { id: 'z', text: '样本得够多', mark: 'unknown', sentence: 2 },
  { id: 'a', text: '得先排除别的因素', mark: 'yes', sentence: 0 },
  { id: 'm', text: '去年和今年只差早读', mark: 'no', sentence: 0 },
];
const rv = conditionsOf(PASSAGE, REVERSED);
ok(JSON.stringify(rv.asked) === '[0,2]', '倒着填时「问到」仍是升序且去重', JSON.stringify(rv.asked));
ok(JSON.stringify(rv.rows.map((r) => r.id)) === '["z","a","m"]', '倒着填时行的顺序照样不重排');

/* ── 输出的字符串叶子：只许来自原文 / 用户 / 固定枚举码 ─────── */
function leaves(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) leaves(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) leaves(x, out);
  return out;
}
const enumCodes = new Set([
  'unknown', 'yes', 'no',
  'blank', 'sentence-out-of-range',
  ...Object.keys(CONDITION_MARK_LABEL),
  ...Object.keys(CONDITION_PROBLEM_LABEL),
]);
function fromSource(s: string, v: ConditionView, inputs: ConditionInput[]): boolean {
  if (!s) return true;
  if (enumCodes.has(s)) return true;
  if (inputs.some((i) => i.id === s || i.text === s)) return true;
  /* 引文与句子都是原文的原样切片。 */
  if (v.passage.includes(s)) return true;
  return false;
}
ok(leaves(V).every((s) => fromSource(s, V, INPUTS)), '主样本输出里没有原文/用户/枚举码之外的字符串叶子');
const emptyView = conditionsOf(PASSAGE, []);
ok(leaves(emptyView).every((s) => fromSource(s, emptyView, [])), '空清单也没有凭空多出来的文字');

/* ── 内核里没有本地新写的判断，也不读报告 ───────────────────── */
const SRC = readFileSync(resolve(process.cwd(), 'src/shared/conditions.ts'), 'utf8');
const BAN = ['因此', '所以这里', '说明这', '证明', '不成立', '是错误的', '本地认为', '应该改成', '结论是', '站得住'];
const fixed = [
  ...Object.values(CONDITION_MARK_LABEL),
  ...Object.values(CONDITION_PROBLEM_LABEL),
].join('');
ok(BAN.every((w) => !fixed.includes(w)), '固定文案里没有替用户下判断的句子');
ok(Object.keys(CONDITION_MARK_LABEL).length === 3, '三态各有文案');
ok(Object.keys(CONDITION_PROBLEM_LABEL).length === 2, '两类例外各有文案');
ok(!/from ['"]\.\/types['"]|from ['"]@shared\/types['"]|Diagnosis/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), '内核不 import 报告类型，屏幕上不会出现报告里的字');
ok(!/\b(score|verdict|level|satisfied|passRate)\b/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), '源码里没有悄悄合成一个分数');

/* ── 空行、越界、点了不写：全都明说 ─────────────────────────── */
ok(V.rows[3]?.problem === null && V.rows[3]?.written === false && V.rows[3]?.quote === null, '两行空输入框是「还没填」，不是「填错了」');
const blankLinked = conditionsOf(PASSAGE, [{ id: 'b', text: '   ', mark: 'unknown', sentence: 1 }]);
ok(blankLinked.rows[0]?.problem === 'blank', '点了句子却没写条件，明说');
ok(blankLinked.asked.length === 0 && blankLinked.unasked.length === 3, '没写出问题的那一行不算「问到了」', JSON.stringify(blankLinked.asked));
ok(CONDITION_PROBLEM_LABEL.blank.length > 0, '「点了却没写」有显示用的文案');

const outOfRange = conditionsOf(PASSAGE, [{ id: 'o', text: '得有对照', mark: 'yes', sentence: 99 }]);
ok(outOfRange.rows[0]?.problem === 'sentence-out-of-range' && outOfRange.rows[0]?.quote === null, '越界的句子被点名，不静默丢掉');
ok(outOfRange.asked.length === 0 && outOfRange.counts.linked === 0, '越界不计入「问到」');
ok(CONDITION_PROBLEM_LABEL['sentence-out-of-range'].length > 0, '越界有显示用的文案');
for (const bad of [-1, 0.5, Number.NaN]) {
  const r = conditionsOf(PASSAGE, [{ id: 'x', text: '得有对照', mark: 'yes', sentence: bad }]);
  ok(r.rows[0]?.problem === 'sentence-out-of-range', `非法下标 ${bad} 也被挡住并明说`);
}
ok(conditionsOf(PASSAGE, [{ id: 'n', text: '得有对照', mark: 'nonsense' as never, sentence: 0 }]).rows[0]?.mark === 'unknown', '不认识的标记归为「还没想好」，不猜一个');

const noPassage = conditionsOf('', [{ id: 'e', text: '得有对照', mark: 'yes', sentence: 0 }]);
ok(noPassage.sentences.length === 0 && noPassage.rows[0]?.problem === 'sentence-out-of-range', '空原文不崩，也说明点的句子不存在');
ok(noPassage.unasked.length === 0 && noPassage.counts.linked === 0, '空原文不假装问到了哪一句');
const none = conditionsOf(PASSAGE, []);
ok(none.counts.written === 0 && none.asked.length === 0 && none.unasked.length === 3, '一条都没写时，三句都算「还没问到」');
ok(none.sentences.map((s) => s.text).join('') === PASSAGE, '一条都没写时原文照样逐字摆出来');

/* ── 空行与结尾空白：每个字符都还在 ─────────────────────────── */
const TRAIL = S1 + '\n\n' + S2 + '  \n  ';
const trail = conditionsOf(TRAIL, [{ id: 't', text: '得有对照', mark: 'yes', sentence: 1 }]);
ok(trail.sentences.map((s) => s.text).join('') === TRAIL, '带空行与结尾空白时逐字拼回仍等于原文');
ok(trail.rows[0]?.quote === trail.sentences[1]?.text, '挂到第 2 句时连它前面的空行一起带出来');
ok(trail.rows[0]?.quote === TRAIL.slice(trail.rows[0]!.quoteStart, trail.rows[0]!.quoteEnd), '带空行时坐标仍切得出原样引文');
ok(trail.sentences[trail.sentences.length - 1]?.text.endsWith('  \n  '), '结尾空白没有被吃掉');

/* ── 带走用的纯文本：条件与原句都逐字在，且不多出判断 ───────── */
const TXT = conditionsText(V);
ok(TXT.includes(S1) && TXT.includes(S2) && TXT.includes(S3), '导出的文本里三句原文逐字都在');
for (const i of INPUTS.filter((x) => x.text)) ok(TXT.includes(i.text), `导出的文本里有用户写的「${i.text}」`);
ok(TXT.includes(CONDITION_MARK_LABEL.yes) && TXT.includes(CONDITION_MARK_LABEL.no), '两处用户自己的标记都带走了');
ok(TXT.includes('原文第 1 句') && TXT.includes('原文第 3 句'), '挂到的句子编号写进去了');
ok(TXT.includes('第 2 句') && /还没被任何条件问到的句子：第 2 句/.test(TXT), '没被问到的那一句被点名，不是悄悄消失');
/* 原文第二句自带「所以」，不能拿整篇文本去搜判定词——那样验的是原文，不是模板。
   只留下骨架行（去掉含原句或含用户条件的那些行），再看骨架有没有替人下结论。 */
const skeleton = TXT.split('\n').filter(
  (l) => !INPUTS.some((i) => i.text && l.includes(i.text)) && !V.sentences.some((s) => l.includes(s.text)),
);
ok(
  skeleton.every((l) => !['因此', '所以', '不成立', '证明', '说明这'].some((w) => l.includes(w))),
  '导出文本的骨架里没有一句替人下的结论',
);
const txtEmpty = conditionsText(none);
ok(txtEmpty.includes('第 1 句') && txtEmpty.includes('第 3 句'), '空清单也带得走原文');
ok(conditionsText(trail).includes('  \n  '), '导出文本不吞结尾空白');

/* ── 汇总（verify 只取最后一行，所以汇总必须放最后） ─────────── */
if (failed.length) {
  console.error(`✗ check:conditions 红了 ${failed.length} 处（通过 ${passed} 条）\n`);
  for (const f of failed) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`✓ check:conditions 通过 ${passed} 条｜原文逐字还原、对位可复算、不写判断、不给结论`);
