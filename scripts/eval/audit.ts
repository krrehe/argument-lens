/**
 * 审计：把每条分析结果逐条过机器能判的东西。
 *
 * 分两层，分开报，因为它们的含义完全不同：
 *
 *   不变量 —— 任何一份合格报告都该满足。破了就是 bug，与文本内容无关。
 *   期望值 —— 我在写样本时对这段文本的判断。破了可能是软件错，也可能是我错。
 *             所以这一层只列出来，不直接当结论。
 *
 * 跑法：node scripts/run-eval-audit.mjs
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES, type EvalCase } from './cases';
import { KINDS, KINDS_BY_CASE } from './kinds';
import type { Diagnosis } from '@shared/types';
import { auditReport, PLACEHOLDER_CONCLUSION } from '@shared/report-audit';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, '../.out/eval');

interface Row {
  id: string;
  case: EvalCase;
  d: Diagnosis | null;
  error?: string;
  invariants: string[];
  notes: string[];
  expectations: string[];
  coverage: number;
  uncovered: string[];
}

const STOP = /[。！？；\n]/;

function coverageOf(d: Diagnosis): { ratio: number; uncovered: string[] } {
  const text = d.passage;
  const marks = new Uint8Array(text.length);
  const spans = [d.conclusion as any, ...d.premises, ...d.intermediate].map((c) => c?.span).filter(Boolean);
  for (const s of spans) {
    if (typeof s.start !== 'number' || s.start < 0) continue;
    for (let i = Math.max(0, s.start); i < Math.min(text.length, s.end); i++) marks[i] = 1;
  }
  let hit = 0;
  for (let i = 0; i < text.length; i++) if (marks[i]) hit++;
  // 未覆盖的长句：按句末标点切，去掉空白，只留 ≥14 字的
  const uncovered: string[] = [];
  let cursor = 0;
  for (let i = 0; i < text.length; i++) {
    if (STOP.test(text[i])) {
      const seg = text.slice(cursor, i + 1);
      const start = cursor;
      cursor = i + 1;
      const clean = seg.replace(/\s/g, '');
      if (clean.length < 14) continue;
      let any = false;
      for (let k = start; k < i + 1; k++) if (marks[k]) any = true;
      if (!any) uncovered.push(clean.slice(0, 48));
    }
  }
  const nonSpace = text.replace(/\s/g, '').length;
  return { ratio: nonSpace ? hit / nonSpace : 0, uncovered: uncovered.slice(0, 6) };
}

function audit(c: EvalCase, d: Diagnosis): Row {
  /* 不变量由共享模块给出——生产端与评测端跑的是同一份代码。 */
  const { invariants: inv, gaps, notes: auditNotes } = auditReport(d);
  /* 缺口不算破，但也别让它消失：前缀写「缺口｜」，与真正的提示分开看。 */
  const notes = [...auditNotes, ...gaps.map((g) => `缺口｜${g}`)];
  const exp: string[] = [];
  const claims = [d.conclusion as any, ...d.premises, ...d.intermediate];
  const blob = JSON.stringify(d);

  /* ── 期望值 ── */
  if (c.expect.scopeApplicable !== undefined && d.scope.applicable !== c.expect.scopeApplicable) {
    exp.push(`范围门：期望${c.expect.scopeApplicable ? '适用' : '不适用'}，实得${d.scope.applicable ? '适用' : '不适用'}`);
  }
  if (c.expect.dialogueType && d.context.dialogueType !== c.expect.dialogueType) {
    exp.push(`对话类型：期望 ${c.expect.dialogueType}，实得 ${d.context.dialogueType}`);
  }
  if (c.expect.dialogueTypeAny && !c.expect.dialogueTypeAny.includes(d.context.dialogueType)) {
    exp.push(`对话类型：期望 ${c.expect.dialogueTypeAny.join('/')} 之一，实得 ${d.context.dialogueType}`);
  }
  /*
   * 数主张时不算占位结论。判不适用的文本里，结论栏会填一句
   * 「无结论可重构：文本未提出任何可检验的主张」——那是说明，不是主张。
   * 把它算进去，非论证样本就永远「多出一条主张」，检查器于是天天喊狼来了。
   */
  const n = claims.filter((x) => x?.text?.trim() && !PLACEHOLDER_CONCLUSION.test(x.text)).length;
  if (c.expect.minClaims !== undefined && n < c.expect.minClaims) exp.push(`主张数：期望 ≥${c.expect.minClaims}，实得 ${n}`);
  if (c.expect.maxClaims !== undefined && n > c.expect.maxClaims) exp.push(`主张数：期望 ≤${c.expect.maxClaims}，实得 ${n}`);
  if (c.expect.levelNot?.includes(d.verdict.level)) exp.push(`档位 ${d.verdict.level} 不该出现`);
  if (c.expect.minChecks !== undefined && d.checks.length < c.expect.minChecks) {
    exp.push(`检查项：期望 ≥${c.expect.minChecks}，实得 ${d.checks.length}`);
  }
  if (c.expect.mustCatch?.length && !c.expect.mustCatch.some((k) => blob.includes(k))) {
    exp.push(`一处关键处都没接住（找过：${c.expect.mustCatch.join('/')}）`);
  }
  if (c.expect.mustNotName?.length) {
    const hit = d.labels.filter((l) => c.expect.mustNotName!.some((k) => l.name.includes(k)));
    if (hit.length) exp.push(`不该命名却命名了：${hit.map((l) => l.name).join('、')}`);
  }
  if (c.expect.unknownsNonEmpty && !d.selfCheck.unknowns.filter((x) => x.trim()).length) {
    exp.push('有歧义可拆，但 selfCheck.unknowns 是空的');
  }

  const { ratio, uncovered } = coverageOf(d);
  return { id: c.id, case: c, d, invariants: inv, notes, expectations: exp, coverage: ratio, uncovered };
}

/* ── 汇总 ── */
const files = new Set(readdirSync(dir));
const rows: Row[] = [];
const errors: string[] = [];
let stale = 0;

/*
 * 先看成功产物，再看失败产物。
 * 反过来的话，一次早期失败的 error.json 会一直盖住后来成功的 json——
 * 「这条跑失败了」这个结论就永远撤不掉，而它早已不成立。
 *
 * 反过来也有一个洞：旧的成功产物会盖住**新的**失败。所以两边都在时看时间：
 * 失败比成功新，就把「最近一次重跑失败」写进这一条的提示，并保留这一幕的
 * 旧结果供审计（失败不销毁已有证据，但必须说出来）。
 */
for (const c of CASES) {
  const successPath = resolve(dir, `${c.id}.json`);
  const errorPath = resolve(dir, `${c.id}.error.json`);
  const hasSuccess = files.has(`${c.id}.json`);
  const hasError = files.has(`${c.id}.error.json`);
  if (hasSuccess) {
    const raw = JSON.parse(readFileSync(successPath, 'utf-8'));
    const row = audit(c, raw.diagnosis as Diagnosis);
    if (hasError && statSync(errorPath).mtimeMs > statSync(successPath).mtimeMs) {
      const e = JSON.parse(readFileSync(errorPath, 'utf-8'));
      const at = raw.at ? new Date(raw.at).toISOString().slice(0, 16).replace('T', ' ') : '时间不明';
      row.notes.push(
        `上次重跑失败：${e.code} ${e.error}。这一行审的是更早一次成功的产物（${at}），不是最近一次输出。`
      );
      errors.push(`${c.id}（重跑失败，下面是旧结果）：${e.code} ${e.error}`);
      stale += 1;
    }
    rows.push(row);
    continue;
  }
  if (hasError) {
    const e = JSON.parse(readFileSync(errorPath, 'utf-8'));
    errors.push(`${c.id}: ${e.code} ${e.error}`);
  }
}

const L: string[] = [];
L.push(
  `# 评测审计（${rows.length}/${CASES.length} 条有结果${
    stale ? `；其中 ${stale} 条是更早一次的成功产物，最近一次重跑失败` : ''
  }）`,
  ''
);

L.push('## 一、不变量：破了就是 bug', '');
const withInv = rows.filter((r) => r.invariants.length || r.notes.length);
if (!withInv.length) L.push('全部通过：没有破的不变量，也没有需要提示的重复占位。');
for (const r of withInv) {
  L.push(`**${r.id}**（${r.case.genre}）`);
  for (const x of r.invariants) L.push(`- ${x}`);
  for (const x of r.notes) L.push(`- ${x}`);
  L.push('');
}

L.push('## 二、期望对照：破了不一定是软件错', '');
const withExp = rows.filter((r) => r.expectations.length);
if (!withExp.length) L.push('全部符合写样本时的判断。');
for (const r of withExp) {
  L.push(`**${r.id}**（${r.case.genre}）`);
  for (const x of r.expectations) L.push(`- ${x}`);
  L.push('');
}

L.push('## 三、覆盖度：主张占原文多少', '');
L.push('| 样本 | 覆盖率 | 未覆盖长句 |');
L.push('|---|---|---|');
for (const r of rows) {
  L.push(`| ${r.id} | ${(r.coverage * 100).toFixed(0)}% | ${r.uncovered.length ? r.uncovered[0].slice(0, 30) : '—'} |`);
}
L.push('');

L.push('## 四、分布', '');
const dist = new Map<string, number>();
for (const r of rows) {
  const k = `${r.d?.theory}/${r.d?.mode} → ${r.d?.verdict.level}`;
  dist.set(k, (dist.get(k) ?? 0) + 1);
}
L.push('```');
for (const [k, v] of dist) L.push(`${k}  ×${v}`);
L.push('```');
L.push('');
const checks = rows.map((r) => `${r.id}:${r.d?.checks.length ?? 0}`);
L.push(`检查项数：${checks.join('  ')}`);

/*
 * 成本与耗时。跑评测要花钱，而「花了多少」如果不在报告里，
 * 下次有人问「能不能多跑几条」就只能凭感觉回答。
 */
let pt = 0;
let ct = 0;
let ms = 0;
let cacheHit = 0;
let cachePrompt = 0;
let cacheReported = 0;
for (const c of CASES) {
  if (!files.has(`${c.id}.json`)) continue;
  const raw = JSON.parse(readFileSync(resolve(dir, `${c.id}.json`), 'utf-8'));
  pt += raw.usage?.promptTokens ?? 0;
  ct += raw.usage?.completionTokens ?? 0;
  ms += raw.usage?.ms ?? 0;
  /*
   * 缓存命中率是提示词工程的体检指标：它掉到接近 0，说明 system 又在每次请求里不同了。
   * 这是唯一能验证那件事的场合——用户端只看得到「钱变多了」，看不出为什么。
   * 供应商没报命中数就不进分母：把「没说」算成「没命中」会造出一个假回归。
   */
  if (typeof raw.usage?.cacheHitTokens === 'number') {
    cacheHit += raw.usage.cacheHitTokens;
    cachePrompt += raw.usage.promptTokens ?? 0;
    cacheReported += 1;
  }
}
if (pt) {
  L.push('');
  const cacheNote =
    cacheReported > 0 && cachePrompt > 0
      ? `｜缓存命中 ${Math.round((cacheHit / cachePrompt) * 100)}%（${cacheReported} 条有回报）`
      : '｜缓存命中：接口未回报此字段';
  L.push(
    `用量：输入 ${pt.toLocaleString('en-US')} tokens，输出 ${ct.toLocaleString('en-US')} tokens，累计等待 ${(ms / 1000).toFixed(0)} 秒${cacheNote}。`
  );
}

L.push('', '## 五、语料清单', '', '| 样本 | 体裁 | 透镜/模式 | 毛病类型 | 文本里埋了什么 |', '|---|---|---|---|---|');
for (const c of CASES) {
  const kinds = (KINDS_BY_CASE[c.id] ?? []).map((k) => KINDS[k].name).join('、');
  L.push(`| ${c.id} | ${c.genre} | ${c.theory} / ${c.mode} | ${kinds} | ${c.traps[0]} |`);
}

if (errors.length) {
  L.push('', '## 五、跑失败', '', ...errors.map((e) => `- ${e}`));
}

const report = L.join('\n');
writeFileSync(resolve(dir, 'report.md'), report, 'utf-8');
console.log(report);
