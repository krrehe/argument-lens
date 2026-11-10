/**
 * 词汇层 · 报告侧真实数据审计。
 *
 * 第 53 轮把「报告侧四项（结论文字 / 前提文字 / 只在结论里 / quiet 句）」记成「未计」，
 * 理由是那三段外部公开摘要没有真模型报告。但那句话只对**学术文本**成立：
 * 本机 103 份存档本身就是真模型产出的报告，而这四个字段读的是报告的字与结构，
 * 跟文本属于哪个学科无关。所以「这一半字段在真实报告上到底是不是空面板」，
 * 不需要余额、不需要模型、不需要使用者给文本，这里就能量。
 *
 * 口径不另写一份：切句、报告文字、quiet 句都照 `FieldTermsBar` 的组装方式
 * （`sentenceBounds` + `rereadOf(d).sentences.filter(s => s.quiet)`），数词用 `fieldTermsOf`。
 *
 * **不进 verify**：它依赖使用者自己的存档目录，换一台机器没有存档就该明说量不了，
 * 而不是假绿。这一点与 `audit:provenance` 相同，且这里的理由真的成立——
 * 不像 `audit:field-samples`（数据固定在仓库里，那条该进 verify）。
 *
 * 三条边界随输出一起打印，别把这份账读成「学术文本上的证据」。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Diagnosis } from '@shared/types';
import { fieldTermsOf } from '@shared/field-terms';
import { rereadOf, sentenceBounds } from '@shared/reread';

let bad = 0;
function must(cond: boolean, label: string, detail = ''): void {
  if (!cond) {
    console.error(`✗ 自检失败：${label}${detail ? `（${detail}）` : ''}`);
    bad += 1;
  }
}

/* 探针词是固定字面串，从本机最常见的那段「取消早读」原文与报告里抄的。
 * 它**不是领域词表**、不是专家给的、不进产品；用途只有一个：探这四个字段
 * 在真实报告上会不会亮。最后一个是对照词，必须一次都不出现，否则
 * 「没出现」那一列永远是空的，整份账看起来会莫名地漂亮。 */
const PROBES = ['早读', '一本率', '成绩', '取消', '错的', '举证责任', '论证', '量子纠缠'] as const;
const CONTROL = '量子纠缠';

/* ───── 自检一：判据本身没坏 ─────
 * 「全部没命中」既可能是事实为零，也可能是切句／数词写坏了。
 * 先造一段已知答案的字，四项报告侧字段各点亮一次，且对照词确实不命中。 */
{
  const passage = '甲词在第一句。第二句有乙词和丙词。第三句又有甲词。';
  const sentences = sentenceBounds(passage);
  const view = fieldTermsOf({
    passage,
    words: ['甲词', '乙词', '丙词', '丁词'],
    conclusion: '甲词与丁词都出现在结论里。',
    premises: ['第二句里有丙词。'],
    sentences,
    quietSentences: [1],
  });
  must(sentences.length === 3, '构造样本切出 3 句', `实得 ${sentences.length}`);
  must(view.rows[0]?.inConclusion === true, '构造样本 inConclusion 点得亮');
  must(view.rows[2]?.inPremises === true, '构造样本 inPremises 点得亮');
  must(view.rows[0]?.onlyInConclusion === true, '构造样本 onlyInConclusion 点得亮');
  must(view.rows[1]?.onQuietOnly === true, '构造样本 onQuietOnly 点得亮');
  must(view.rows[3]?.count === 0, '构造样本对照词不命中');
  must(view.rows[1]?.sentences.join(',') === '1', '构造样本落句按 index', `实得 ${view.rows[1]?.sentences.join(',')}`);
}

/* ───── 自检二：探针词表本身没坏 ───── */
must(PROBES.includes(CONTROL as (typeof PROBES)[number]), '探针词表里真的有对照词');
must(new Set(PROBES).size === PROBES.length, '探针词表没有重复');
must(PROBES.length >= 6, '探针词表至少六个词', `实得 ${PROBES.length}`);

const archive =
  process.env['AL_ARCHIVE'] ||
  join(process.env['APPDATA'] || '', 'argument-lens', 'archive');

if (!existsSync(archive)) {
  console.error(`✗ 存档目录不存在：${archive}`);
  console.error('  这份账依赖本机真实报告；没有存档就该明说量不了，而不是打印一张空表。');
  process.exit(1);
}

const files = readdirSync(archive).filter((f) => f.endsWith('.json') && f !== 'index.json');
must(files.length > 0, '存档目录里至少有报告', `实得 ${files.length}`);

interface Tally {
  pairs: number;
  original: number;
  inConclusion: number;
  inPremises: number;
  onlyInConclusion: number;
  onQuietOnly: number;
  reportsWithConclusion: number;
  reportsWithPremises: number;
  reportsWithOnly: number;
  reportsWithQuietWord: number;
  /** 四个字段里任意一个点亮过的报告份数（并集，不是四项取最大值） */
  reportsWithAny: number;
}
const zero = (): Tally => ({
  pairs: 0,
  original: 0,
  inConclusion: 0,
  inPremises: 0,
  onlyInConclusion: 0,
  onQuietOnly: 0,
  reportsWithConclusion: 0,
  reportsWithPremises: 0,
  reportsWithOnly: 0,
  reportsWithQuietWord: 0,
  reportsWithAny: 0,
});

const total = zero();
/** 按原文逐字分组：同一段字跑一百遍是一百份报告，不是一个样本的一百次验证。 */
const groups = new Map<string, Tally>();
let usable = 0;
let unreadable = 0;
let quietSentenceTotal = 0;
let reportsWithQuietSentence = 0;
let controlHits = 0;
/** 诊断列：词至少有一句落在 quiet 句（不等于界面那一列「全部落句都 quiet」）。 */
let quietOverlap = 0;
/** quiet 句的逐字原文 → 出现次数。用来区分「字段没信号」与「探针词没覆盖那些句子」。 */
const quietSamples = new Map<string, number>();

for (const file of files) {
  let d: Diagnosis;
  try {
    /* 存档是扁平的：raw 与报告正文同在顶层。写 `d.diagnosis || d` 会让
     * 「只扫正文」与「扫整份」两种口径输出一模一样，看着完全正常（第 50 轮栽过）。 */
    d = JSON.parse(readFileSync(join(archive, file), 'utf8')) as Diagnosis;
  } catch {
    unreadable += 1;
    continue;
  }
  const passage = d.passage ?? '';
  if (!passage || !d.conclusion?.text) continue;
  usable += 1;

  let quietSentences: number[];
  try {
    const quiet = rereadOf(d).sentences.filter((s) => s.quiet);
    quietSentences = quiet.map((s) => s.index);
    for (const s of quiet) {
      const raw = s.text;
      quietSamples.set(raw, (quietSamples.get(raw) ?? 0) + 1);
    }
  } catch {
    unreadable += 1;
    continue;
  }
  quietSentenceTotal += quietSentences.length;
  if (quietSentences.length > 0) reportsWithQuietSentence += 1;

  const view = fieldTermsOf({
    passage,
    words: [...PROBES],
    conclusion: d.conclusion.text,
    premises: (d.premises ?? []).map((p) => p.text),
    sentences: sentenceBounds(passage),
    quietSentences,
  });

  const g = groups.get(passage) ?? zero();
  let cHit = false;
  let pHit = false;
  let oHit = false;
  let qHit = false;
  for (const row of view.rows) {
    total.pairs += 1;
    g.pairs += 1;
    if (row.word === CONTROL && row.count > 0) controlHits += 1;
    if (row.count > 0) {
      total.original += 1;
      g.original += 1;
      if (row.sentences.some((i) => quietSentences.includes(i))) quietOverlap += 1;
    }
    if (row.inConclusion) { total.inConclusion += 1; g.inConclusion += 1; cHit = true; }
    if (row.inPremises) { total.inPremises += 1; g.inPremises += 1; pHit = true; }
    if (row.onlyInConclusion) { total.onlyInConclusion += 1; g.onlyInConclusion += 1; oHit = true; }
    if (row.onQuietOnly) { total.onQuietOnly += 1; g.onQuietOnly += 1; qHit = true; }
  }
  if (cHit) { total.reportsWithConclusion += 1; g.reportsWithConclusion += 1; }
  if (pHit) { total.reportsWithPremises += 1; g.reportsWithPremises += 1; }
  if (oHit) { total.reportsWithOnly += 1; g.reportsWithOnly += 1; }
  if (qHit) { total.reportsWithQuietWord += 1; g.reportsWithQuietWord += 1; }
  if (cHit || pHit || oHit || qHit) { total.reportsWithAny += 1; g.reportsWithAny += 1; }
  groups.set(passage, g);
}

must(usable > 0, '至少有一份能读的报告', `实得 ${usable}`);
must(total.original > 0, '探针词在真实原文里至少命中一次（否则先怀疑判据）', `实得 ${total.original}`);
must(controlHits === 0, '对照词在所有报告里一次都没出现', `实得 ${controlHits}`);
must(groups.size >= 1, '至少一组独立文本', `实得 ${groups.size}`);

if (bad > 0) {
  console.error(`\n✗ ${bad} 条自检失败，不打印数字。`);
  process.exit(1);
}

/* ───── 输出区 ───── */
const pct = (n: number, d: number): string => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');
const pad = (s: string, n: number): string => s + ' '.repeat(Math.max(0, n - [...s].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));

console.log('词汇层 · 报告侧真实数据审计（本机存档，不是学术文本）');
console.log(`存档 ${files.length} 份｜可用 ${usable} 份｜读不出来 ${unreadable} 份｜按原文逐字分成 ${groups.size} 组`);
console.log(`探针词 ${PROBES.length} 个（固定字面串，不是领域词表）：${PROBES.join(' / ')}`);
console.log(`其中「${CONTROL}」是对照词，实测命中 ${controlHits} 次。\n`);

console.log(`全部 ${total.pairs} 个「词 × 报告」对：`);
console.log(`  ${pad('原文侧命中（count > 0）', 34)} ${String(total.original).padStart(5)} 对  ${pct(total.original, total.pairs)}`);
console.log(`  ${pad('报告结论文字里有', 34)} ${String(total.inConclusion).padStart(5)} 对  ${pct(total.inConclusion, total.pairs)}`);
console.log(`  ${pad('报告前提文字里有', 34)} ${String(total.inPremises).padStart(5)} 对  ${pct(total.inPremises, total.pairs)}`);
console.log(`  ${pad('只在结论文字里（前提没有）', 34)} ${String(total.onlyInConclusion).padStart(5)} 对  ${pct(total.onlyInConclusion, total.pairs)}`);
console.log(`  ${pad('只落在没有条目落点的句子里', 34)} ${String(total.onQuietOnly).padStart(5)} 对  ${pct(total.onQuietOnly, total.pairs)}`);
console.log(`  ${pad('诊断：至少一句落在 quiet 句', 34)} ${String(quietOverlap).padStart(5)} 对  ${pct(quietOverlap, total.pairs)}`);
console.log(`  ${pad('至少有一项点亮的报告', 34)} ${String(total.reportsWithAny).padStart(5)} 份  ${pct(total.reportsWithAny, usable)}\n`);

console.log(`quiet 句（没有任何报告条目落点）：共 ${quietSentenceTotal} 句，${reportsWithQuietSentence} 份报告里至少有一句。`);
console.log(`按逐字原文去重后是 ${quietSamples.size} 种不同的句子，出现最多的几条（原文切片，不改写）：`);
for (const [text, n] of [...quietSamples.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
  const one = text.replace(/\s+/g, ' ').slice(0, 40);
  console.log(`  ${pad(one, 44)} ${String(n).padStart(3)} 次`);
}
console.log('');

console.log('按独立文本组看（同一段字跑一百遍仍是一组）：');
const ranked = [...groups.entries()].sort((a, b) => b[1].pairs - a[1].pairs);
for (const [text, g] of ranked) {
  const head = text.replace(/\s+/g, '').slice(0, 18);
  console.log(
    `  ${pad(head, 38)} ${String(g.pairs / PROBES.length).padStart(3)} 份｜` +
      `原文 ${String(g.original).padStart(3)}｜结论 ${String(g.inConclusion).padStart(3)}｜` +
      `前提 ${String(g.inPremises).padStart(3)}｜只在结论 ${String(g.onlyInConclusion).padStart(3)}｜quiet ${String(g.onQuietOnly).padStart(3)}`,
  );
}

console.log('\n边界：');
console.log('  1. 这些是本机真实报告，但没有一份是学术文本（上一轮实测学术字面线索 0 份）；');
console.log('     它回答的是「报告侧四项在真报告上会不会亮」，不是「学术文本上会不会亮」。');
console.log('  2. 探针词是审计用的固定字面串，不是领域词表、不是专家给的、不进产品；');
console.log('     词贴这段文本时字段就亮、不贴就灭，所以命中率不是「功能好不好」的评分。');
console.log('     尤其「只落在没有条目落点的句子」高度依赖词表是否覆盖上面那些 quiet 句。');
console.log('  3. 这四项都只是位置事实，不是判定；本地独立判定占比 4.8% 没动。');
console.log('  4. 分组口径是 passage 逐字去重；样本账那种按相似度并组的口径会把改稿并成一组，');
console.log('     所以这里的「几组」与路线图里那几个数不是同一把尺子，别直接比。');
console.log('  5. 实时数以本命令输出为准，不写进文档；换一台机器没有存档就量不了。');
