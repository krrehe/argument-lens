/**
 * 长文本专题的事实账：在**本机真实存档**上复算长文覆盖账的界面口径。
 *
 * 为什么需要这条命令：专题文档与路线图里写的那几个数字（167 句 / 8 句 / 25 段）
 * 如果没有能重跑的地方，就变成「文档比软件更自信」。这里复用界面同一个
 * `coverageOf` / `segmentPassage` / `sentenceBounds`，一个口径，不另算一份。
 *
 * 不进 `verify`：它依赖使用者自己的存档，换台机器没有长文本就该明说量不了，
 * 不能为了绿而造一个恒真的样本。`AL_ARCHIVE_DIR` 可以指定别的存档目录，
 * 供反证在临时目录里自包含地跑（默认仍是本机 userData/archive）。
 *
 * 只数字面位置，不判「该不该覆盖」、不评分、不劝；命令自带硬自检，失败真实退出 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Diagnosis } from '@shared/types';
import { coverageOf } from '@shared/coverage';
import { SEGMENT_HINT_CHARS, segmentPassage } from '@shared/segment';
import { sentenceBounds } from '@shared/reread';

const DEFAULT_DIR = path.join(process.env.APPDATA ?? '', 'argument-lens', 'archive');
const DIR = process.env.AL_ARCHIVE_DIR ?? DEFAULT_DIR;

let bad = 0;
function must(cond: boolean, label: string): void {
  if (!cond) {
    bad += 1;
    console.error(`✗ 自检失败：${label}`);
  }
}
const pct = (a: number, b: number): string => (b ? `${(a / b * 100).toFixed(1)}%` : '—');

/* ─────────── 自检一 · 构造样本：判据本身没坏 ─────────── */
{
  const para = (n: number): string =>
    [1, 2, 3].map((m) => `这是第${n}段第${m}句话，说明一件事情。`).join('');
  const LONG = Array.from({ length: 20 }, (_, i) => para(i + 1)).join('\n\n');
  const at = LONG.indexOf('这是第1段第2句话');
  const d = {
    passage: LONG,
    conclusion: {
      id: 'c0', text: '结论', quote: '',
      span: { start: at, end: at + '这是第1段第2句话'.length, quote: '', quality: 'exact' },
    },
    premises: [], intermediate: [], labels: [], legitimateMoves: [],
  } as unknown as Diagnosis;
  const v = coverageOf(d);
  must(v.long === true, '构造的长文本被判为长文本');
  must(v.segments.reduce((n, s) => n + s.sentences, 0) === v.sentences, '构造样本每句恰好归一段');
  must(v.pinned === 1 && v.untouched === 19, '构造样本既有被钉住的段也有没被钉住的段');
  must(sentenceBounds(LONG).map((s) => s.text).join('').replace(/\s/g, '') === LONG.replace(/\s/g, ''), '句子逐字拼回原文');
  must(segmentPassage(LONG).every((s, i, a) => i === 0 || s.start > a[i - 1].end), '段区间不重叠');
}

/* ─────────── 自检二 · 阈值两侧 ─────────── */
{
  const bare = (n: number) => ({
    passage: '甲'.repeat(n),
    /* rereadOf 一定读 conclusion.id；少这一行脚本会抛 TypeError，
       看起来和「判据失效」一模一样，所以裸样本也得是完整形状。 */
    conclusion: { id: 'c0', text: '结论', quote: '', span: null },
    premises: [], intermediate: [], labels: [], legitimateMoves: [],
  } as unknown as Diagnosis);
  must(coverageOf(bare(SEGMENT_HINT_CHARS - 1)).long === false, '短于阈值不摆账');
  must(coverageOf(bare(SEGMENT_HINT_CHARS)).long === true, '达到阈值才摆账');
}

if (bad) {
  console.error(`\n${bad} 条自检失败，下面的数字不可信。`);
  process.exit(1);
}

/* ─────────── 读存档 ─────────── */
interface Row { file: string; d: Diagnosis }
const rows: Row[] = [];
let unreadable = 0;
if (!fs.existsSync(DIR)) {
  console.log(`没有存档目录（${DIR}），量不了。换台机器没有这些报告是正常的，不假装量出了数字。`);
  process.exit(2);
}
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json') && x !== 'index.json')) {
  try {
    rows.push({ file: f, d: JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) as Diagnosis });
  } catch {
    unreadable += 1;
  }
}
if (!rows.length) {
  console.log(`存档目录里没有报告（${DIR}），量不了。`);
  process.exit(2);
}

const longs = rows.filter((r) => (r.d.passage ?? '').trim().length >= SEGMENT_HINT_CHARS);
const shorts = rows.filter((r) => (r.d.passage ?? '').trim().length > 0 && (r.d.passage ?? '').trim().length < 200);

console.log(`\n长文本专题账（${DIR}）`);
console.log(`  报告 ${rows.length} 份，读不出来 ${unreadable} 份；逐字独立原文 ${new Set(rows.map((r) => r.d.passage ?? '')).size} 组`);
console.log(`  长文本（≥${SEGMENT_HINT_CHARS} 字）${longs.length} 份，短文本（<200 字）${shorts.length} 份\n`);

if (longs.length === 0) {
  console.log('本机没有长文本报告，覆盖账在真长文本上的样子量不了。');
  console.log('这不是断言失败，是缺数据；换一台有长文本存档的机器再跑。');
  process.exit(2);
}

/* ─────────── 短文本基线（汇总，不逐份刷屏） ─────────── */
const shortViews = shorts.map((r) => coverageOf(r.d));
const sSent = shortViews.reduce((n, v) => n + v.sentences, 0);
const sPinned = shortViews.reduce((n, v) => n + v.pinned, 0);
console.log(`【短文本基线】${shorts.length} 份，共 ${sSent} 句，被条目落上 ${sPinned} 句（${pct(sPinned, sSent)}）`);
console.log(`  平均原文 ${(shorts.reduce((n, r) => n + (r.d.passage ?? '').length, 0) / Math.max(1, shorts.length)).toFixed(1)} 字；` +
  `平均前提 ${(shorts.reduce((n, r) => n + ((r.d as any).premises ?? []).length, 0) / Math.max(1, shorts.length)).toFixed(1)} 条\n`);

/* ─────────── 长文本逐份 ─────────── */
for (const r of longs) {
  const v = coverageOf(r.d);
  const segs = segmentPassage(r.d.passage ?? '');
  const hard = segs.filter((s) => s.cutBasis === 'length').length;
  const d = r.d as any;
  must(v.segments.reduce((n, s) => n + s.sentences, 0) === v.sentences, `${r.file}：各段句数之和 = 总句数`);
  must(v.segments.reduce((n, s) => n + s.pinned, 0) === v.pinned, `${r.file}：各段钉住之和 = 钉住总数`);
  must(segs.every((s) => (r.d.passage ?? '').slice(s.start, s.end) === s.text), `${r.file}：段区间逐字切得出来`);

  console.log(`【长文本 ${r.file}】`);
  console.log(`  原文 ${v.chars} 字 / ${v.sentences} 句 / ${v.segmentCount} 段`);
  console.log(`  报告结构：前提 ${(d.premises ?? []).length}、中间 ${(d.intermediate ?? []).length}、检查 ${(d.checks ?? []).length}、反驳 ${(d.refutations ?? []).length}、命名 ${(d.labels ?? []).length}`);
  console.log(`  ${v.headline}`);
  console.log(`  被落上 ${pct(v.pinned, v.sentences)}，没被落上 ${v.quiet} 句；未碰段 ${v.untouched} / ${v.segmentCount}（${pct(v.untouched, v.segmentCount)}）`);
  console.log(`  切分条：${segs.length} 段，其中按字数硬切 ${hard} 处${hard === 0 ? '（每个切点都有依据）' : ''}`);
  console.log(`  未碰段编号：${v.segments.filter((s) => s.pinned === 0 && s.sentences > 0).map((s) => s.index + 1).join(', ') || '—'}\n`);
}

if (bad) {
  console.error(`${bad} 条自检失败，上面的数字不可信。`);
  process.exit(1);
}

console.log('【边界】');
console.log('  1. 这些数字来自本机存档，换一台机器会变；实时数以本命令输出为准，不写死在文档里。');
console.log('  2. 「被条目落上」用「回到原文重读」的 quiet 口径，「段」用「切给我看」的候选段，');
console.log('     与界面完全同源；只数有位置的条目（结论／前提／中间结论／谬误名／合法招）。');
console.log('     检查项的 basis 是自由文字、本地定位不到句子，不计入——所以这个数偏窄。');
console.log('  3. 没被落上的句子可能是转述、铺垫或例子，也可能是没被接住的推理。');
console.log('     本地分不出来，所以既不替你排除，也不替你判定；本命令不改判定、不落盘。');
console.log('  4. 短文本基线是同一批存档里的其它报告，不是随机对照组；');
console.log('     本机存档高度集中在少数几段文字上，别把「平均」读成「典型用户」。');
