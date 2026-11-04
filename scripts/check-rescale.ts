/**
 * 「换个尺度重读」的断言。
 *
 * 这一屏全部价值押在一个可归因的承诺上：**只换尺度，其余全不变**。
 * 一旦某处开始「顺手也改一点」，差异就说不清是谁造成的，而界面上看起来
 * 仍然只是两句并排的话——不会报错，只会悄悄变成又一份生成好的东西。
 *
 * 所以这里验的是构造性质，不是文案：
 *   1. 原句拼回来逐字等于 passage（含空行与结尾空白）；
 *   2. 每处编辑都记了原文坐标，逆变换能还原整篇；
 *   3. 未被覆盖的字符一个没动，替换结果不参与第二次扫描（禁止连锁）；
 *   4. 没找到 / 被挡住 / 跨句 / 词对无效，都明说，不许静默；
 *   5. 内核输出里没有一句本地新写的判断。
 *
 * 跑法：npm run check:rescale
 */
import { rescaleOf, revertRescale, RESCALE_STATUS_LABEL, RESCALE_INVALID_LABEL, RESCALE_CONFLICT_LABEL, type RescalePair, type RescaleView } from '@shared/rescale';
import { rereadOf } from '@shared/reread';
import { diag } from './fixture-report';

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
const PAIRS: RescalePair[] = [
  { from: '取消早读', to: '取消午休' },
  { from: '一本率', to: '及格率' },
];

/** 收集 view 里的字符串叶子，用来验「没有本地新写的自然语言」。 */
function leaves(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) leaves(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) leaves(x, out);
  return out;
}

/* ── 主样本：只换尺度，其余全不变 ───────────────────────────── */
const V = rescaleOf(PASSAGE, PAIRS);
ok(V.status === 'ok', '主样本状态是 ok');
ok(V.hitCount === 3, '三处命中（取消早读 ×2、一本率 ×1）', `实际 ${V.hitCount}`);
ok(V.sentences.length === 3, '切出三句', `实际 ${V.sentences.length}`);
ok(V.sentences.map((s) => s.original).join('') === PASSAGE, '原句拼回来逐字等于原文');
ok(V.sentences.map((s) => s.rescaled).join('') === V.rescaled, '逐句换尺度拼起来等于整篇换尺度');
ok(revertRescale(V) === PASSAGE, '编辑记录能把替换后的文本逆变换回原文');
ok(
  V.edits.every((e) => PASSAGE.slice(e.start, e.end) === e.from),
  '每处编辑记下的坐标与原文对得上',
);
ok(
  V.edits.every((e, i) => i === 0 || e.start >= V.edits[i - 1].end),
  '编辑区间互不重叠',
);
ok(
  V.edits.every((e) => V.sentences.some((s) => e.start >= s.start && e.end <= s.end)),
  '每处编辑都落在某一句里，没有跨句替换',
);
ok(
  V.unchangedChars === PASSAGE.length - V.edits.reduce((n, e) => n + (e.end - e.start), 0),
  '没被换掉的字数算得对',
);
ok(V.missing.length === 0 && V.conflicts.length === 0 && V.invalid.length === 0, '主样本没有需要明说的例外');
ok(V.rescaled.includes('取消午休') && !V.rescaled.includes('取消早读'), '该换的换了，原文那处不再出现');
ok(V.rescaled.includes('及格率') && !V.rescaled.includes('一本率'), '第二组词也只换它自己');
ok(V.rescaled.includes('应当恢复早读') && V.rescaled.includes('其实去年同期也降过'), '没被点名的句子逐字保留');
ok(JSON.stringify(V.pairs) === JSON.stringify(PAIRS), '词对原样回显，界面能复算');
ok(JSON.stringify(rescaleOf(PASSAGE, PAIRS)) === JSON.stringify(V), '同一输入两次调用逐字节相同');

/* 词对顺序不该影响结果：两组不重叠的词，谁先填都一样。 */
const reversed = rescaleOf(PASSAGE, [
  { from: '一本率', to: '及格率' },
  { from: '取消早读', to: '取消午休' },
]);
ok(reversed.rescaled === V.rescaled && reversed.hitCount === V.hitCount, '词对顺序不影响结果');

/* ── 禁止连锁替换：换出来的字不能再被另一组词吃掉 ─────────────── */
const CHAIN = '甲说乙。';
const chain = rescaleOf(CHAIN, [
  { from: '甲', to: '乙' },
  { from: '乙', to: '丙' },
]);
ok(chain.rescaled === '乙说丙。', '替换结果不参与第二次扫描', `实际 ${chain.rescaled}`);
ok(chain.hitCount === 2, '连锁样本只有原文上的两处命中', `实际 ${chain.hitCount}`);
ok(revertRescale(chain) === CHAIN, '连锁样本也能逆变换回原文');

/* ── 没找到：不许显示一份「看着像换了其实没换」的文本 ─────────── */
const miss = rescaleOf(PASSAGE, [{ from: '根本不存在的词', to: '随便' }]);
ok(miss.status === 'no-hit', '一个都没找到时状态是 no-hit');
ok(miss.missing.includes('根本不存在的词'), '没找到的那个词被点名');
ok(miss.rescaled === PASSAGE, '没找到时整篇文本仍是原文');
ok(miss.sentences.every((s) => s.rescaled === s.original), '没找到时每句都仍是原句');
ok(miss.hitCount === 0 && miss.unchangedChars === PASSAGE.length, '没找到时命中数为 0、原文全未动');
ok(RESCALE_STATUS_LABEL[miss.status].length > 0, 'no-hit 有一句说清为什么不显示');

/* 部分命中、部分没找到：命中照换，没找到的照样点名。 */
const partial = rescaleOf(PASSAGE, [{ from: '一本率', to: '及格率' }, { from: '没有这个词', to: 'X' }]);
ok(partial.status === 'ok' && partial.hitCount === 1, '部分命中仍然照换');
ok(partial.missing.includes('没有这个词') && partial.rescaled.includes('及格率'), '没找到的与换掉的都摆出来');

/* ── 词对无效 ───────────────────────────────────────────────── */
const none = rescaleOf(PASSAGE, []);
ok(none.status === 'empty-pairs' && none.hitCount === 0, '没填词时状态是 empty-pairs');
/* 真应用打开这一屏时是两行空输入框：它必须是「还没填」，不是「填错了两组」。
   端到端第一次跑就因为把两者混为一谈，在用户还没动手时先报了一句「这几组词都没法用」。 */
const blankRows = rescaleOf(PASSAGE, [{ from: '', to: '' }, { from: '', to: '' }]);
ok(blankRows.status === 'empty-pairs', '两行空输入框是「还没填」，不是「填错了两组」');
ok(blankRows.invalid.length === 0 && blankRows.missing.length === 0, '还没填时不报无效、也不报没找到');
ok(RESCALE_STATUS_LABEL[blankRows.status].includes('还没填词'), '还没填时的提示说的是「还没填」');
ok(blankRows.sentences.map((s) => s.original).join('') === PASSAGE, '还没填时原文那一栏照样摆得出原文');
ok(blankRows.rescaled === PASSAGE && blankRows.edits.length === 0, '还没填时一个字都没动');
const bad = rescaleOf(PASSAGE, [{ from: '', to: '甲' }, { from: '乙', to: '' }, { from: '丙', to: '丙' }]);
ok(bad.status === 'all-invalid', '全无效时状态是 all-invalid');
ok(bad.invalid.length === 3, '三种无效各有说法', JSON.stringify(bad.invalid));
ok(bad.rescaled === PASSAGE && bad.edits.length === 0, '全无效时一个字都不换');
const mixed = rescaleOf(PASSAGE, [{ from: '一本率', to: '及格率' }, { from: '', to: 'X' }]);
ok(mixed.status === 'ok' && mixed.hitCount === 1 && mixed.invalid.includes('empty-from'), '有效与无效混着时，无效的仍明说');
ok(Object.keys(RESCALE_INVALID_LABEL).length === 3, '三种无效各有显示用的文案');

/* ── 重叠：被挡住的匹配要说清被谁挡了 ───────────────────────── */
const overlap = rescaleOf(PASSAGE, [
  { from: '取消早读', to: '取消午休' },
  { from: '早读', to: '晚自习' },
]);
ok(overlap.conflicts.some((c) => c.reason === 'overlap' && c.from === '早读' && c.keptBy === '取消早读'), '短词被长词挡住且点名是谁挡的');
ok(overlap.edits.every((e, i) => i === 0 || e.start >= overlap.edits[i - 1].end), '重叠样本里仍没有重复替换同一段');
ok(overlap.rescaled.includes('恢复晚自习'), '不重叠的那处「早读」照换');
ok(revertRescale(overlap) === PASSAGE, '重叠样本也能逆变换回原文');
ok(RESCALE_CONFLICT_LABEL.overlap.length > 0 && RESCALE_CONFLICT_LABEL['cross-sentence'].length > 0, '两类冲突都有显示用的文案');

/* 不同起点的重叠：短词藏在长词中间，被长词覆盖的区间挡住；词对顺序不该影响结果。 */
const overlapRev = rescaleOf(PASSAGE, [
  { from: '早读', to: '晚自习' },
  { from: '取消早读', to: '取消午休' },
]);
ok(overlapRev.rescaled === overlap.rescaled, '不同起点重叠时，词对顺序不影响结果');
ok(overlapRev.conflicts.some((c) => c.keptBy === '取消早读'), '短词被长词覆盖的那几处被点名');

/* 同一起点、一长一短：这里才真正考验「区间长者在前」。
   上面那组短词起点靠后，改坏长度排序照样绿——曾经就是这么得到一条恒真假绿的。 */
const SAME_START = '取消早读之后，一本率下降了。';
const sameStart = rescaleOf(SAME_START, [
  { from: '取消早读', to: '取消午休' },
  { from: '取消', to: '停止' },
]);
const sameStartRev = rescaleOf(SAME_START, [
  { from: '取消', to: '停止' },
  { from: '取消早读', to: '取消午休' },
]);
ok(sameStart.rescaled.startsWith('取消午休'), '同起点时由长词胜出');
ok(sameStartRev.rescaled === sameStart.rescaled, '同起点重叠时，词对顺序不影响结果');
ok(sameStartRev.conflicts.some((c) => c.keptBy === '取消早读'), '同起点由长词胜出，不是先填的那个赢');

/* ── 跨句：宁可不换，也不让并排两栏错位 ─────────────────────── */
const CROSS = '第一句完了。第二句开始。';
const cross = rescaleOf(CROSS, [{ from: '。第二', to: '，于是' }]);
ok(cross.conflicts.some((c) => c.reason === 'cross-sentence'), '跨句的匹配被记下来');
ok(cross.edits.length === 0 && cross.rescaled === CROSS, '跨句的匹配没有被替换');
ok(cross.status === 'no-hit', '只剩跨句匹配时状态是 no-hit');

/* 非空样本：句内替换照做，跨句那处仍被排除。写在只有空编辑的样本上会是恒真断言。 */
const mixedCross = rescaleOf(CROSS, [
  { from: '第一', to: '开头' },
  { from: '。第二', to: '，于是' },
]);
ok(mixedCross.edits.length === 1 && mixedCross.edits[0].from === '第一', '混合跨句样本只留下句内那一处编辑');
ok(
  mixedCross.edits.every((e) => mixedCross.sentences.some((s) => e.start >= s.start && e.end <= s.end)),
  '混合跨句样本里没有落到句外的编辑',
);
ok(mixedCross.conflicts.some((c) => c.reason === 'cross-sentence'), '混合样本里跨句的那处仍被点名');

/* ── 空行与结尾空白：原文里的每个字符都还在 ─────────────────── */
const TRAIL = S1 + '\n\n' + S2 + '  \n  ';
const trail = rescaleOf(TRAIL, PAIRS);
ok(trail.sentences.map((s) => s.original).join('') === TRAIL, '带空行与结尾空白时，原句拼回来仍逐字等于原文');
ok(trail.sentences.map((s) => s.rescaled).join('') === trail.rescaled, '带空行时逐句与整篇仍一致');
ok(revertRescale(trail) === TRAIL, '带空行时也能逆变换回原文');
ok(trail.rescaled.endsWith('  \n  '), '结尾空白没有被吃掉');
const empty = rescaleOf('', PAIRS);
ok(empty.sentences.length === 0 && empty.rescaled === '' && empty.status === 'no-hit', '空原文不崩，也不假装换了');

/* ── 与「回到原文重读」共用一套句子边界，并排才不会错位 ───────── */
const d = diag({ passage: PASSAGE });
const rr = rereadOf(d);
const rs = rescaleOf(d.passage ?? '', PAIRS);
ok(
  JSON.stringify(rr.sentences.map((s) => [s.index, s.start, s.end])) ===
    JSON.stringify(rs.sentences.map((s) => [s.index, s.start, s.end])),
  '两屏的句子边界逐项相同，条目能按句并排',
);

/* ── 内核里没有本地新写的判断 ───────────────────────────────── */
const BAN = ['因此', '所以这里', '说明这', '证明', '不成立', '是错误的', '本地认为', '应该改成'];
const labels = Object.values(RESCALE_STATUS_LABEL).join('') + Object.values(RESCALE_INVALID_LABEL).join('') + Object.values(RESCALE_CONFLICT_LABEL).join('');
ok(BAN.every((w) => !labels.includes(w)), '固定文案里没有替用户下判断的句子');

/* 输出的字符串叶子，只允许来自原文、词对，或固定枚举码。 */
const allowedCodes = new Set([
  'ok', 'no-hit', 'empty-pairs', 'all-invalid',
  'overlap', 'cross-sentence', 'empty-from', 'empty-to', 'same',
]);
function fromSource(s: string, v: RescaleView): boolean {
  if (!s) return true;
  if (allowedCodes.has(s)) return true;
  if (v.passage.includes(s)) return true;
  if (v.pairs.some((p) => p.from === s || p.to === s)) return true;
  /* rescaled 是「原文片段 + to」拼出来的：按编辑记录拆开逐段核对。 */
  if (s === v.rescaled || v.sentences.some((x) => x.rescaled === s)) return true;
  return false;
}
ok(leaves(V).every((s) => fromSource(s, V)), '主样本输出里没有报告/原文/词对之外的字符串叶子');
ok(leaves(miss).every((s) => fromSource(s, miss)), '未命中样本也没有凭空多出来的文字');

/* ── 汇总（verify 只取最后一行，所以汇总必须放最后） ─────────── */
if (failed.length) {
  console.error(`✗ check:rescale 红了 ${failed.length} 处（通过 ${passed} 条）\n`);
  for (const f of failed) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`✓ check:rescale 通过 ${passed} 条｜原文逐字还原、编辑可逆、禁止连锁、例外全明说`);
