/**
 * 一条命令回答「这份软件离一段提示词有多远」。
 *
 * 只读本机存档、不联网、不写文件、不改报告。它不是评测：只数字面来源与结构，
 * 判不了「判断对不对」，也不回答「人看完会不会用」。那两件事归 eval 与 P2。
 *
 * 口径与第 45 / 46 / 47 轮保持一致，这样历轮的数才可比；另附一列更严的口径，
 * 因为旧口径扫的是整份扁平存档，连 `raw.text` 自己、`prompt`、`diagnostics` 都算成了
 * 「报告里 ≥12 字的字段」（`raw.text` 当然逐字命中自己）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { skeletonOf } from '@shared/skeleton';
import type { Diagnosis } from '@shared/types';

const dir = path.join(process.env.APPDATA || '', 'argument-lens', 'archive');
if (!fs.existsSync(dir)) {
  console.error(`✗ 找不到存档目录：${dir}\n  没有可量的报告时宁可报错，也不拿构造样本假装是使用证据。`);
  process.exit(1);
}
const files = fs.readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'index.json');
if (!files.length) {
  console.error(`✗ 存档目录是空的：${dir}`);
  process.exit(1);
}

const norm = (s: string) => String(s ?? '').replace(/[\s\u3000]/g, '');
/** 身份、时间、指纹、原文本身不是「这软件说了什么」，不计入正文长字段。 */
const SKIP = new Set(['id', 'parentId', 'createdAt', 'passage', 'version', 'fingerprint', 'model', 'host']);
/** 修正口径只数「给人读的判定文字」，外壳（raw / prompt / diagnostics / 原文等）一律不算。 */
const BODY_KEYS = [
  'conclusion', 'premises', 'intermediate', 'checks', 'verdict', 'repair',
  'labels', 'legitimateMoves', 'refutations', 'defeat', 'selfCheck',
];

function walkFields(node: unknown, out: string[], key = ''): void {
  if (typeof node === 'string') {
    if (!SKIP.has(key) && node.length >= 12) out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const x of node) walkFields(x, out, key);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) walkFields(v, out, k);
  }
}

/* 自检：造一份「外壳里带长文本」的假报告，确认修正口径真的把外壳排除了。
 * 踩过一次：存档是扁平的，拿 `d.diagnosis || d` 当「只有正文」，两列数字会一模一样，
 * 而输出看起来完全正常——脚本坏了与口径本来就该一样，长得一样。 */
{
  const probe = {
    raw: { text: '这是一段足够长的模型原文，用来确认外壳不会被当成正文。' },
    conclusion: { text: '这一句是报告里给人读的判定文字，长度也够十二个字。' },
  };
  const all: string[] = [];
  walkFields(probe, all);
  const strict: string[] = [];
  for (const k of BODY_KEYS) walkFields((probe as any)[k], strict, k);
  if (!(all.length >= 2 && strict.length === 1 && strict[0].includes('报告里给人读'))) {
    console.error('✗ 自检失败：修正口径没把外壳排除干净，下面的数字不可信。');
    process.exit(1);
  }
  console.log('自检通过：修正口径不把 raw.text 算作正文。\n');
}

let reports = 0;
let withRaw = 0;
let fields = 0;
let hits = 0;
let strictFields = 0;
let strictHits = 0;
let modelPoints = 0;
let localPoints = 0;
let reportPoints = 0;
let crashed = 0;
const groups = new Set<string>();

for (const f of files) {
  let d: any;
  try {
    d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  } catch {
    continue;
  }
  const r: Diagnosis = d.diagnosis || d;
  if (!r || !r.verdict) continue;
  reports++;
  groups.add(norm(r.passage || '').slice(0, 24) || '(空)');

  if (d.raw && typeof d.raw.text === 'string') {
    withRaw++;
    const raw = norm(d.raw.text);
    const all: string[] = [];
    walkFields(d, all); // 第 45 轮口径：整份存档
    const strict: string[] = [];
    // 存档是扁平的：raw 与报告正文同在顶层，不能拿 `d.diagnosis || d` 当「只有正文」。
    for (const k of BODY_KEYS) walkFields((r as any)[k], strict, k);
    for (const s of all) {
      fields++;
      if (raw.includes(norm(s))) hits++;
    }
    for (const s of strict) {
      strictFields++;
      if (raw.includes(norm(s))) strictHits++;
    }
  }

  /* 判定点口径与第 46 轮一致：下面这些全是模型写的「这处怎样」。 */
  let m = 2; // 评级档位 + 被否证的是谁
  for (const c of [r.conclusion, ...(r.premises || []), ...(r.intermediate || [])].filter(Boolean)) {
    if ((c as any).acceptability) m++;
    if ((c as any).burden) m++;
  }
  for (const k of r.checks || []) if (k && k.answer) m++;
  for (const rf of r.refutations || []) {
    if ((rf as any).confidence) m++;
    if ((rf as any).burdenAfter) m++;
  }
  if (r.conclusion && typeof r.conclusion.modalOverreach === 'boolean') m++;
  modelPoints += m;

  try {
    const sk = skeletonOf(r);
    for (const g of sk.gaps) {
      if (g.from === 'local') localPoints++;
      else reportPoints++;
    }
  } catch (e) {
    crashed++;
    console.log(`  算不出骨架：${f} —— ${String(e)}`);
  }
}

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '量不了（分母为 0）');
console.log(`本机存档 ${reports} 份｜独立文本 ${groups.size} 组｜带模型原文 ${withRaw} 份｜算不出骨架 ${crashed} 份`);
console.log(`来源（第 45 轮口径）：≥12 字字段 ${fields}，逐字来自模型原文 ${hits}（${pct(hits, fields)}）`);
console.log(`来源（只数判定正文 ${BODY_KEYS.length} 个区块）：≥12 字字段 ${strictFields}，逐字来自模型原文 ${strictHits}（${pct(strictHits, strictFields)}）`);
console.log(`判定点：模型给出 ${modelPoints} 处；本地实时算出 ${localPoints} 处，报告自己指认 ${reportPoints} 处`);
console.log(`本地判定占全部判定点 ${pct(localPoints, modelPoints + localPoints)}（${localPoints}/${modelPoints + localPoints}）`);
console.log('');
console.log('边界（读这几行之前不要拿上面的数当结论）：');
console.log('· 这不是评测。字面命中不等于判断对，本地缺口也只是结构，不回答「站不站得住」。');
console.log('· 骨架缺口是显示报告时实时算的，一份也没写进存档；存档里本地判定仍是 0。');
console.log('· 带 raw.text 的报告集中在极少数几组文本上，这个占比不能推广到别的文本。');
console.log('· 真模型评测（P1-2）与真实使用证据（P2）都不在这条命令里，余额为空时跑不了。');
