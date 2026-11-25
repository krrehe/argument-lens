/**
 * 校准集：病例、盲标与评分。
 *
 * 它只回答一件事：模型/软件的判断，和独立人类标注差多少。
 * 不测「跑不跑得通」（smoke 管），也不测「报告顺不顺」（人读管）。
 *
 * 三条边界：
 *   1. 金标是人的判断，不是真理；分歧打平就记争议，不硬选一个。
 *   2. 不同透镜的分数不合并。刻度不同，平均会把「不可通约」抹掉。
 *   3. 缺失单独计数，不当作答错，也不悄悄跳过。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CASES_DIR = join(ROOT, 'calibration/cases');
const LABELS_DIR = join(ROOT, 'calibration/labels');
const PREDICTIONS_DIR = join(ROOT, 'calibration/predictions');

const VERDICTS = ['withstands', 'weakened', 'fails', 'undetermined'] as const;
type Verdict = (typeof VERDICTS)[number];
const CHECK_ANSWERS = ['passed', 'unanswered', 'violated', 'na'] as const;
type CheckAnswer = (typeof CHECK_ANSWERS)[number];
const LENSES = ['walton', 'pragma', 'ars', 'pta', 'toulmin', 'copi'] as const;
const MODES = ['diagnose', 'deep', 'redteam', 'fallacy', 'reconstruct', 'interrogate'] as const;

interface CalibrationCase {
  id: string;
  status: 'draft' | 'ready';
  passage: string;
  lens: string;
  mode: string;
  /** 默认 true；查谬误/重构/提问等不给档位的模式写 false。 */
  verdict_expected?: boolean;
  checks: { id: string; question: string }[];
  notes?: string;
}

interface Label {
  caseId: string;
  annotator: string;
  itemId: string;
  answer: string;
  confidence: number | null;
  note: string;
}

interface Prediction {
  caseId: string;
  source: string;
  verdict: Verdict;
  checks: Record<string, CheckAnswer>;
}

interface Gold {
  value: string | null;
  counts: Record<string, number>;
  n: number;
  agreement: number;
  disputed: boolean;
}

interface IaaPair {
  a: string;
  b: string;
  items: number;
  percent: number;
  kappa: number;
}

interface Iaa {
  annotators: string[];
  pairs: IaaPair[];
  meanPercent: number | null;
  meanKappa: number | null;
}

interface ItemScore {
  n: number;
  correct: number;
  missing: number;
  answered: number;
  accuracy: number;
  macroF1: number;
  confusion: Record<string, Record<string, number>>;
}

interface SourceScore {
  source: string;
  cases: number;
  verdict: ItemScore;
  checks: ItemScore;
  missing: number;
  byLens: { lens: string; cases: number; verdictAccuracy: number; checkAccuracy: number; missing: number }[];
}

interface Report {
  cases: CalibrationCase[];
  readyCases: number;
  labels: Label[];
  iaa: Iaa;
  goldItems: number;
  disputedItems: number;
  sources: SourceScore[];
}

/* ── CSV：只支持逗号、双引号、换行与 BOM 这几种真实会遇到的情况 ── */

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(path: string, rows: (string | number | null)[][]): void {
  writeFileSync(path, `${rows.map((r) => r.map(csvCell).join(',')).join('\n')}\n`, 'utf-8');
}

/* ── 读病例 ── */

function loadCases(): CalibrationCase[] {
  if (!existsSync(CASES_DIR)) throw new Error(`没有病例目录：${CASES_DIR}`);
  const files = readdirSync(CASES_DIR).filter((f) => f.endsWith('.json')).sort();
  const out: CalibrationCase[] = [];
  const ids = new Set<string>();
  for (const f of files) {
    const c = JSON.parse(readFileSync(join(CASES_DIR, f), 'utf-8')) as CalibrationCase;
    if (!c.id || !/^cal-\d{4}$/.test(c.id)) throw new Error(`${f}: id 必须形如 cal-0001`);
    if (ids.has(c.id)) throw new Error(`${f}: id 重复：${c.id}`);
    ids.add(c.id);
    if (c.status !== 'draft' && c.status !== 'ready') throw new Error(`${f}: status 只能是 draft 或 ready`);
    if (!LENSES.includes(c.lens as (typeof LENSES)[number])) throw new Error(`${f}: 未知透镜 ${c.lens}`);
    if (!MODES.includes(c.mode as (typeof MODES)[number])) throw new Error(`${f}: 未知模式 ${c.mode}`);
    if (c.verdict_expected !== undefined && typeof c.verdict_expected !== 'boolean') {
      throw new Error(`${f}: verdict_expected 必须是布尔值`);
    }
    if (!c.passage || c.passage.trim().length < 20) throw new Error(`${f}: passage 太短`);
    if (!Array.isArray(c.checks) || c.checks.length === 0) throw new Error(`${f}: 至少要有一道检查问题`);
    const itemIds = new Set<string>();
    for (const q of c.checks) {
      if (!q.id || q.id === 'verdict') throw new Error(`${f}: 检查问题 id 不能为空或叫 verdict`);
      if (itemIds.has(q.id)) throw new Error(`${f}: 检查问题 id 重复：${q.id}`);
      itemIds.add(q.id);
      if (!q.question || q.question.trim().length < 4) throw new Error(`${f}: ${q.id} 的问题太短`);
    }
    out.push(c);
  }
  return out;
}

/* ── 读盲标 ── */

function loadLabels(): Label[] {
  if (!existsSync(LABELS_DIR)) return [];
  const files = readdirSync(LABELS_DIR).filter((f) => f.endsWith('.csv') && f !== 'template.csv').sort();
  const out: Label[] = [];
  for (const f of files) {
    const rows = parseCsv(readFileSync(join(LABELS_DIR, f), 'utf-8'));
    if (rows.length < 2) continue;
    const head = rows[0].map((x) => x.trim());
    const at = (name: string): number => head.indexOf(name);
    for (const col of ['case_id', 'annotator', 'item_id', 'answer']) {
      if (at(col) < 0) throw new Error(`${f}: 缺少列 ${col}`);
    }
    for (const r of rows.slice(1)) {
      const caseId = (r[at('case_id')] ?? '').trim();
      const annotator = (r[at('annotator')] ?? '').trim();
      const itemId = (r[at('item_id')] ?? '').trim();
      const answer = (r[at('answer')] ?? '').trim();
      /* 模板行（annotator / answer 为空）不是标注，跳过。 */
      if (!annotator || !answer) continue;
      const confidenceRaw = head.includes('confidence') ? Number(r[at('confidence')] ?? '') : NaN;
      const confidence = Number.isFinite(confidenceRaw) ? confidenceRaw : null;
      if (confidence !== null && (!Number.isInteger(confidence) || confidence < 1 || confidence > 5)) {
        throw new Error(`${f}: ${caseId}/${itemId} 的 confidence 必须是 1–5 的整数`);
      }
      out.push({
        caseId,
        annotator,
        itemId,
        answer,
        confidence,
        note: head.includes('note') ? (r[at('note')] ?? '').trim() : '',
      });
    }
  }
  return out;
}

/* ── 读预测 ── */

interface RawPrediction {
  case_id: string;
  source: string;
  verdict: Verdict;
  checks?: Record<string, CheckAnswer>;
}

function loadPredictions(): Prediction[] {
  if (!existsSync(PREDICTIONS_DIR)) return [];
  const files = readdirSync(PREDICTIONS_DIR).filter((f) => f.endsWith('.json')).sort();
  const out: Prediction[] = [];
  for (const f of files) {
    const raw = JSON.parse(readFileSync(join(PREDICTIONS_DIR, f), 'utf-8')) as RawPrediction | RawPrediction[];
    const list = Array.isArray(raw) ? raw : [raw];
    for (const p of list) {
      if (!p.case_id || !p.source) throw new Error(`${f}: 预测缺少 case_id 或 source`);
      if (!VERDICTS.includes(p.verdict)) throw new Error(`${f}: ${p.case_id} 的 verdict 不合法`);
      for (const [id, ans] of Object.entries(p.checks ?? {})) {
        if (!CHECK_ANSWERS.includes(ans)) throw new Error(`${f}: ${p.case_id} 的 ${id} 答案不合法`);
      }
      out.push({
        caseId: p.case_id,
        source: p.source,
        verdict: p.verdict,
        checks: p.checks ?? {},
      });
    }
  }
  return out;
}

/* ── 金标：多数票；打平记争议，不硬选 ── */

function buildGold(cases: CalibrationCase[], labels: Label[]): Map<string, Map<string, Gold>> {
  const checks = new Map(cases.map((c) => [c.id, new Set(c.checks.map((q) => q.id))]));
  const buckets = new Map<string, Map<string, string[]>>();
  for (const l of labels) {
    const allowed = checks.get(l.caseId);
    if (!allowed) throw new Error(`标注指向不存在的病例：${l.caseId}`);
    const valid =
      l.itemId === 'verdict' ? VERDICTS.includes(l.answer as Verdict) : allowed.has(l.itemId) && CHECK_ANSWERS.includes(l.answer as CheckAnswer);
    if (!valid) throw new Error(`标注 ${l.caseId}/${l.itemId} 的答案不合法：${l.answer}`);
    if (!buckets.has(l.caseId)) buckets.set(l.caseId, new Map());
    const caseMap = buckets.get(l.caseId)!;
    if (!caseMap.has(l.itemId)) caseMap.set(l.itemId, []);
    caseMap.get(l.itemId)!.push(l.answer);
  }
  const gold = new Map<string, Map<string, Gold>>();
  for (const [caseId, items] of buckets) {
    const caseGold = new Map<string, Gold>();
    for (const [itemId, answers] of items) {
      const counts: Record<string, number> = {};
      for (const a of answers) counts[a] = (counts[a] ?? 0) + 1;
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const top = sorted[0];
      const disputed = sorted.length > 1 && sorted[1][1] === top[1];
      caseGold.set(itemId, {
        value: disputed ? null : top[0],
        counts,
        n: answers.length,
        agreement: top[1] / answers.length,
        disputed,
      });
    }
    gold.set(caseId, caseGold);
  }
  return gold;
}

/* ── 标注者一致性 ── */

function kappa(a: string[], b: string[]): number {
  const n = a.length;
  if (!n) return 0;
  let same = 0;
  const ca: Record<string, number> = {};
  const cb: Record<string, number> = {};
  for (let i = 0; i < n; i += 1) {
    if (a[i] === b[i]) same += 1;
    ca[a[i]] = (ca[a[i]] ?? 0) + 1;
    cb[b[i]] = (cb[b[i]] ?? 0) + 1;
  }
  const po = same / n;
  let pe = 0;
  for (const k of new Set([...Object.keys(ca), ...Object.keys(cb)])) {
    pe += ((ca[k] ?? 0) / n) * ((cb[k] ?? 0) / n);
  }
  return pe === 1 ? (po === 1 ? 1 : 0) : (po - pe) / (1 - pe);
}

function computeIaa(labels: Label[]): Iaa {
  const byAnnotator = new Map<string, Map<string, string>>();
  for (const l of labels) {
    if (!byAnnotator.has(l.annotator)) byAnnotator.set(l.annotator, new Map());
    byAnnotator.get(l.annotator)!.set(`${l.caseId}\u0000${l.itemId}`, l.answer);
  }
  const annotators = [...byAnnotator.keys()].sort();
  const pairs: IaaPair[] = [];
  for (let i = 0; i < annotators.length; i += 1) {
    for (let j = i + 1; j < annotators.length; j += 1) {
      const a = byAnnotator.get(annotators[i])!;
      const b = byAnnotator.get(annotators[j])!;
      const keys = [...a.keys()].filter((k) => b.has(k));
      if (!keys.length) continue;
      const va = keys.map((k) => a.get(k)!);
      const vb = keys.map((k) => b.get(k)!);
      const percent = va.filter((x, idx) => x === vb[idx]).length / keys.length;
      pairs.push({ a: annotators[i], b: annotators[j], items: keys.length, percent, kappa: kappa(va, vb) });
    }
  }
  const total = pairs.reduce((n, p) => n + p.items, 0);
  return {
    annotators,
    pairs,
    meanPercent: total ? pairs.reduce((n, p) => n + p.percent * p.items, 0) / total : null,
    meanKappa: total ? pairs.reduce((n, p) => n + p.kappa * p.items, 0) / total : null,
  };
}

/* ── 评分 ── */

function emptyScore(): ItemScore {
  return { n: 0, correct: 0, missing: 0, answered: 0, accuracy: 0, macroF1: 0, confusion: {} };
}

function addItem(score: ItemScore, gold: string | null, pred: string | undefined): void {
  if (gold === null) return;
  score.n += 1;
  if (pred === undefined) {
    score.missing += 1;
    return;
  }
  score.answered += 1;
  score.confusion[gold] ??= {};
  score.confusion[gold][pred] = (score.confusion[gold][pred] ?? 0) + 1;
  if (pred === gold) score.correct += 1;
}

function finalizeScore(score: ItemScore): void {
  score.accuracy = score.n ? score.correct / score.n : 0;
  const labels = new Set<string>();
  for (const [g, row] of Object.entries(score.confusion)) {
    labels.add(g);
    for (const p of Object.keys(row)) labels.add(p);
  }
  let sum = 0;
  let used = 0;
  for (const label of labels) {
    const tp = score.confusion[label]?.[label] ?? 0;
    const fp = Object.entries(score.confusion).reduce((n, [g, row]) => n + (g === label ? 0 : (row[label] ?? 0)), 0);
    const fn = Object.entries(score.confusion[label] ?? {}).reduce((n, [p, c]) => n + (p === label ? 0 : c), 0);
    if (tp + fp + fn === 0) continue;
    const p = tp + fp ? tp / (tp + fp) : 0;
    const r = tp + fn ? tp / (tp + fn) : 0;
    sum += p + r ? (2 * p * r) / (p + r) : 0;
    used += 1;
  }
  score.macroF1 = used ? sum / used : 0;
}

function evaluate(
  cases: CalibrationCase[],
  labels: Label[],
  predictions: Prediction[],
  includeDraft: boolean
): Report {
  const gold = buildGold(cases, labels);
  const sources = [...new Set(predictions.map((p) => p.source))].sort();
  const scoredCases = cases.filter((c) => includeDraft || c.status === 'ready');
  const sourceScores: SourceScore[] = [];

  for (const source of sources) {
    const preds = new Map<string, Prediction>();
    for (const p of predictions) if (p.source === source) preds.set(p.caseId, p);
    const verdictScore = emptyScore();
    const checkScore = emptyScore();
    const lensMap = new Map<string, { cases: number; v: ItemScore; c: ItemScore; missing: number }>();

    for (const c of scoredCases) {
      const caseGold = gold.get(c.id);
      if (!caseGold) continue;
      const pred = preds.get(c.id);
      const lens = lensMap.get(c.lens) ?? { cases: 0, v: emptyScore(), c: emptyScore(), missing: 0 };
      lens.cases += 1;

      const verdictGold = caseGold.get('verdict');
      addItem(verdictScore, verdictGold?.value ?? null, pred?.verdict);
      addItem(lens.v, verdictGold?.value ?? null, pred?.verdict);
      if (verdictGold?.value !== null && verdictGold?.value !== undefined && !pred?.verdict) {
        lens.missing += 1;
      }

      for (const q of c.checks) {
        const g = caseGold.get(q.id);
        addItem(checkScore, g?.value ?? null, pred?.checks[q.id]);
        addItem(lens.c, g?.value ?? null, pred?.checks[q.id]);
        if (g?.value !== null && g?.value !== undefined && !pred?.checks[q.id]) lens.missing += 1;
      }
      lensMap.set(c.lens, lens);
    }

    finalizeScore(verdictScore);
    finalizeScore(checkScore);
    for (const v of lensMap.values()) {
      finalizeScore(v.v);
      finalizeScore(v.c);
    }
    sourceScores.push({
      source,
      cases: scoredCases.filter((c) => gold.has(c.id)).length,
      verdict: verdictScore,
      checks: checkScore,
      missing: verdictScore.missing + checkScore.missing,
      byLens: [...lensMap.entries()]
        .map(([lens, v]) => ({
          lens,
          cases: v.cases,
          verdictAccuracy: v.v.accuracy,
          checkAccuracy: v.c.accuracy,
          missing: v.missing,
        }))
        .sort((a, b) => a.lens.localeCompare(b.lens)),
    });
  }

  let goldItems = 0;
  let disputedItems = 0;
  for (const items of gold.values()) {
    for (const g of items.values()) {
      goldItems += 1;
      if (g.disputed) disputedItems += 1;
    }
  }

  return {
    cases,
    readyCases: cases.filter((c) => c.status === 'ready').length,
    labels,
    iaa: computeIaa(labels),
    goldItems,
    disputedItems,
    sources: sourceScores,
  };
}

/* ── 输出 ── */

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function printReport(r: Report): void {
  console.log(
    `\n校准集：ready 病例 ${r.readyCases} / 全部 ${r.cases.length}｜标注者 ${r.iaa.annotators.length}｜标注条目 ${r.labels.length}`
  );
  if (r.iaa.meanPercent === null) {
    console.log('标注一致性：不足两位标注者的共同条目，暂不可算。');
  } else {
    console.log(
      `标注一致性：原始 ${pct(r.iaa.meanPercent)}｜平均 kappa ${
        r.iaa.meanKappa === null ? '—' : r.iaa.meanKappa.toFixed(2)
      }（按共同条目加权）`
    );
  }
  console.log(`金标：${r.goldItems} 条，其中争议（多数票打平）${r.disputedItems} 条`);
  if (!r.sources.length) {
    console.log('\n还没有预测。把软件或基线的结果写进 calibration/predictions/。');
    return;
  }
  console.log('\n来源                       病例  档位准确率  检查准确率  缺失');
  for (const s of r.sources) {
    console.log(
      `${s.source.padEnd(26)} ${String(s.cases).padStart(4)}  ${pct(s.verdict.accuracy).padStart(9)}  ${pct(
        s.checks.accuracy
      ).padStart(9)}  ${String(s.missing).padStart(4)}`
    );
  }
  for (const s of r.sources) {
    console.log(`\n${s.source} 按透镜：`);
    for (const l of s.byLens) {
      console.log(
        `  ${l.lens.padEnd(8)} 病例 ${String(l.cases).padStart(2)}｜档位 ${pct(l.verdictAccuracy)}｜检查 ${pct(
          l.checkAccuracy
        )}｜缺失 ${l.missing}`
      );
    }
  }
}

/* ── 盲标表 ── */

function writeTemplate(outPath: string, annotator = ''): void {
  const cases = loadCases();
  const rows: (string | number | null)[][] = [['case_id', 'annotator', 'item_id', 'answer', 'confidence', 'note']];
  for (const c of cases) {
    if (c.verdict_expected !== false) rows.push([c.id, annotator, 'verdict', '', '', '']);
    for (const q of c.checks) rows.push([c.id, annotator, q.id, '', '', '']);
  }
  mkdirSync(join(ROOT, 'calibration/labels'), { recursive: true });
  writeCsv(outPath, rows);
  console.log(`盲标表已生成：${outPath}（${cases.length} 个病例，${rows.length - 1} 行）`);
}

/* ── 自检：合成数据，验评分器本身 ── */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`自检失败：${msg}`);
}

function close(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

function selfTest(): void {
  const schema = JSON.parse(readFileSync(join(ROOT, 'calibration/schema.json'), 'utf-8')) as {
    definitions?: Record<string, unknown>;
  };
  assert(!!schema.definitions?.case && !!schema.definitions?.labelRow && !!schema.definitions?.prediction, 'schema.json 三类定义不齐');

  const cases: CalibrationCase[] = [
    {
      id: 'cal-0001',
      status: 'ready',
      passage: '甲'.repeat(20),
      lens: 'walton',
      mode: 'diagnose',
      checks: [
        { id: 'CQ1', question: '问题一' },
        { id: 'CQ2', question: '问题二' },
      ],
    },
    {
      id: 'cal-0002',
      status: 'ready',
      passage: '乙'.repeat(20),
      lens: 'toulmin',
      mode: 'diagnose',
      checks: [
        { id: 'T1', question: '问题一' },
        { id: 'T2', question: '问题二' },
      ],
    },
  ];
  const rows: [string, string, string, string][] = [
    ['cal-0001', 'A', 'verdict', 'weakened'],
    ['cal-0001', 'B', 'verdict', 'weakened'],
    ['cal-0001', 'A', 'CQ1', 'passed'],
    ['cal-0001', 'B', 'CQ1', 'passed'],
    ['cal-0001', 'A', 'CQ2', 'unanswered'],
    ['cal-0001', 'B', 'CQ2', 'violated'],
    ['cal-0002', 'A', 'verdict', 'fails'],
    ['cal-0002', 'B', 'verdict', 'fails'],
    ['cal-0002', 'A', 'T1', 'passed'],
    ['cal-0002', 'B', 'T1', 'passed'],
    ['cal-0002', 'A', 'T2', 'passed'],
    ['cal-0002', 'B', 'T2', 'passed'],
  ];
  const labels: Label[] = rows.map(([caseId, annotator, itemId, answer]) => ({
    caseId,
    annotator,
    itemId,
    answer,
    confidence: null,
    note: '',
  }));
  const predictions: Prediction[] = [
    {
      caseId: 'cal-0001',
      source: 'perfect',
      verdict: 'weakened',
      checks: { CQ1: 'passed', CQ2: 'unanswered' },
    },
    {
      caseId: 'cal-0002',
      source: 'perfect',
      verdict: 'fails',
      checks: { T1: 'passed', T2: 'passed' },
    },
    {
      caseId: 'cal-0001',
      source: 'half',
      verdict: 'fails',
      checks: { CQ1: 'passed', CQ2: 'unanswered' },
    },
    {
      caseId: 'cal-0002',
      source: 'half',
      verdict: 'fails',
      checks: { T1: 'passed', T2: 'violated' },
    },
  ];
  const r = evaluate(cases, labels, predictions, false);
  assert(close(r.iaa.meanPercent ?? -1, 5 / 6), `一致率应为 5/6，实得 ${r.iaa.meanPercent}`);
  assert(close(r.iaa.meanKappa ?? -1, 0.76), `kappa 应为 0.76，实得 ${r.iaa.meanKappa}`);
  assert(r.disputedItems === 1, `争议条目应为 1，实得 ${r.disputedItems}`);
  const perfect = r.sources.find((s) => s.source === 'perfect')!;
  assert(close(perfect.verdict.accuracy, 1), 'perfect 的档位准确率应为 1');
  assert(close(perfect.checks.accuracy, 1), 'perfect 的检查准确率应为 1');
  const half = r.sources.find((s) => s.source === 'half')!;
  assert(close(half.verdict.accuracy, 0.5), `half 的档位准确率应为 0.5，实得 ${half.verdict.accuracy}`);
  assert(close(half.checks.accuracy, 2 / 3), `half 的检查准确率应为 2/3，实得 ${half.checks.accuracy}`);
  assert(half.missing === 0, 'half 没有缺失');
  assert(perfect.cases === 2, 'perfect 应覆盖 2 个病例');
  console.log('✓ 校准评分自检通过：一致率、kappa、争议、准确率与缺失计数都对得上');
}

/* ── CLI ── */

const cmd = process.argv[2] ?? 'score';
const flags = process.argv.slice(3);
const includeDraft = flags.includes('--include-draft');
const asJson = flags.includes('--json');
const outFlag = flags.find((x) => x.startsWith('--out='));
const outPath = outFlag ? outFlag.slice('--out='.length) : join(LABELS_DIR, 'template.csv');
const annotatorFlag = flags.find((x) => x.startsWith('--annotator='));
const annotator = annotatorFlag ? annotatorFlag.slice('--annotator='.length).trim() : '';

try {
  if (cmd === 'template') {
    writeTemplate(outPath, annotator);
  } else if (cmd === 'self-test') {
    selfTest();
  } else if (cmd === 'score') {
    const cases = loadCases();
    const labels = loadLabels();
    const predictions = loadPredictions();
    const report = evaluate(cases, labels, predictions, includeDraft);
    /*
     * --json 只给汇总，不给原文、标注者名字与备注。
     * 校准表可能含未公开材料；把原始行打进终端，很容易被顺手贴进 issue。
     */
    if (asJson) {
      console.log(
        JSON.stringify(
          {
            readyCases: report.readyCases,
            cases: report.cases.length,
            labels: report.labels.length,
            iaa: report.iaa,
            goldItems: report.goldItems,
            disputedItems: report.disputedItems,
            sources: report.sources,
          },
          null,
          2
        )
      );
    } else {
      printReport(report);
    }
  } else {
    console.error(`未知命令：${cmd}\n用法：template | score [--include-draft] [--json] | self-test`);
    process.exit(1);
  }
} catch (err) {
  console.error(`校准集失败：${(err as Error).message}`);
  process.exit(1);
}
