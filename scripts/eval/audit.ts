/**
 * 审计：把十二条分析结果逐条过机器能判的东西。
 *
 * 分两层，分开报，因为它们的含义完全不同：
 *
 *   不变量 —— 任何一份合格报告都该满足。破了就是 bug，与文本内容无关。
 *   期望值 —— 我在写样本时对这段文本的判断。破了可能是软件错，也可能是我错。
 *             所以这一层只列出来，不直接当结论。
 *
 * 跑法：node scripts/run-eval-audit.mjs
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES, type EvalCase } from './cases';
import type { Diagnosis } from '@shared/types';

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
  const inv: string[] = [];
  const notes: string[] = [];
  const exp: string[] = [];
  const claims = [d.conclusion as any, ...d.premises, ...d.intermediate];
  const ids = new Set(claims.map((x) => x?.id).filter(Boolean));
  const blob = JSON.stringify(d);

  /* ── 不变量 ── */
  if (!d.conclusion?.text?.trim()) inv.push('结论为空');

  const failed = claims.filter((x) => x?.span && x.span.quality === 'failed' && !x.implicit);
  const quoteDiag = d.diagnostics.filter((x) => x.code === 'QUOTE_NOT_FOUND').length;
  if (failed.length) inv.push(`${failed.length} 条显式主张的引文在原文里找不到（另 ${quoteDiag} 条已降级留痕）`);

  /*
   * 同一句被两条主张引用，分两种情形，混在一起报会制造假警报：
   *
   *   结论与依据共用一句：合法。权威型式的结论本来就是「那句话可被接受」，
   *   条件型的结论也常常就写在前提那一句里。这类只作提示。
   *   依据与依据（或依据与中间结论）共用一句：真问题——结构图上多出一级，
   *   读者会以为结论被两级撑住。中间结论那种由 G9 合并，剩下的在这里报。
   */
  {
    const seenSpan = new Map<number, { id: string; role: string; text: string }>();
    for (const c of claims) {
      const k = c?.span?.start;
      if (typeof k !== 'number' || k < 0 || c.span?.quality === 'failed') continue;
      const prev = seenSpan.get(k);
      if (!prev) {
        seenSpan.set(k, { id: c.id, role: c.role, text: c.text });
        continue;
      }
      const line = `${prev.id}（${prev.role}）与 ${c.id}（${c.role}）指向同一句：${prev.text.slice(0, 18)}`;
      if (prev.role === 'conclusion' || c.role === 'conclusion') notes.push(`提示｜${line}`);
      else inv.push(`重复占位｜${line}`);
    }
  }

  /*
   * 同一句既当依据又当中间结论，是结构图上的假步骤：
   * 图上多出一级，读者以为结论被两级支撑，实际只有一句原话。
   * 结论与依据同占一句不在此列——权威型式的结论本来就是「那句话可被接受」，
   * 它和「某人说了那句话」指向同一处是结构使然，不是错。
   */
  for (const p of d.premises) {
    for (const m of d.intermediate) {
      if (p.span?.start === m.span?.start && p.span?.quality !== 'failed') {
        inv.push(`「${p.text.slice(0, 18)}」既被当作依据 ${p.id}，又被当作中间结论 ${m.id}——同一句话被算成两步`);
      }
    }
  }

  /*
  * 只抓「占位结论还挂着原文引文」，不是所有不适用文本。
  * 判了不适用、但确实抽出了一条真结论（比如社论）是合法的：
  * 那说明这副透镜不适用，而文本本身有主张——两件事可以同时为真。
  * 我要抓的是另一种：结论栏写着「无结论可规范化」，却仍指向原文某一联，
  * 界面上就会出现「结论：无结论…「没有人说话。」」这种自相矛盾的呈现。
  */
  const placeholder = /^无结论|^（未能|^未提出|^文本未/.test(d.conclusion?.text ?? '');
  if (!d.scope.applicable && placeholder && d.conclusion?.quote && d.conclusion.span?.quality !== 'failed') {
    inv.push(`结论栏是占位文字（「${d.conclusion.text.slice(0, 14)}」），却仍挂着原文引文「${d.conclusion.quote.slice(0, 14)}」`);
  }

  for (const k of d.checks) {
    if ((k.answer === 'passed' || k.answer === 'violated') && !k.basis.trim()) {
      inv.push(`检查项 ${k.id} 给了「${k.answer}」却没有依据`);
    }
  }
  if (new Set(d.checks.map((k) => k.id)).size < d.checks.length) inv.push('检查项 id 重复');

  if (!d.scope.applicable) {
    if (d.checks.length) inv.push('判了不适用却仍有检查项');
    if (d.verdict.level !== 'undetermined') inv.push(`判了不适用却给了档位 ${d.verdict.level}`);
  }

  if (!['diagnose', 'redteam'].includes(d.mode) && d.verdict.level !== 'undetermined') {
    inv.push(`描述类模式给了档位 ${d.verdict.level}`);
  }
  if (d.theory === 'copi' && d.verdict.level !== 'undetermined') inv.push(`名录透镜给了档位 ${d.verdict.level}`);

  // 悬空引用：正文里提到的 P3 / I1 之类，必须真有
  const mentioned = new Set((d.defeat.cuts + ' ' + d.repair.missingPremise + ' ' + d.verdict.statement).match(/\b[PIM]\d+\b/g) ?? []);
  const dangling = [...mentioned].filter((x) => !ids.has(x));
  if (dangling.length) inv.push(`正文引用了不存在的主张编号 ${dangling.join('、')}`);

  for (const r of d.refutations) {
    if (!r.steelman?.trim()) inv.push(`反驳 ${r.id} 没有写对方最可能的反击`);
    if (!r.evidenceNeeded?.length) inv.push(`反驳 ${r.id} 没写需要什么证据`);
    if (r.targetId && !ids.has(r.targetId)) inv.push(`反驳 ${r.id} 指向不存在的 ${r.targetId}`);
  }
  for (const l of d.labels) {
    if (!l.condition?.trim() || !l.whenLegitimate?.trim() || !l.riskOfError?.trim()) {
      inv.push(`命名「${l.name}」缺门槛字段`);
    }
  }
  for (const m of d.legitimateMoves) {
    if (m.targetId && !ids.has(m.targetId)) inv.push(`「此处合法」指向不存在的 ${m.targetId}`);
  }
  if (!d.context.issue.trim() || d.context.issue.startsWith('（未能')) inv.push('争议之点没识别出来');
  if (d.scope.applicable && !d.context.dialogueTypeBasis.trim()) inv.push('对话类型没给依据');

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
  const placeholderRe = /^无结论|^（未能|^未提出|^文本未/;
  const n = claims.filter((x) => x?.text?.trim() && !placeholderRe.test(x.text)).length;
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

/*
 * 先看成功产物，再看失败产物。
 * 反过来的话，一次早期失败的 error.json 会一直盖住后来成功的 json——
 * 「这条跑失败了」这个结论就永远撤不掉，而它早已不成立。
 */
for (const c of CASES) {
  if (files.has(`${c.id}.json`)) {
    const raw = JSON.parse(readFileSync(resolve(dir, `${c.id}.json`), 'utf-8'));
    rows.push(audit(c, raw.diagnosis as Diagnosis));
    continue;
  }
  if (files.has(`${c.id}.error.json`)) {
    const e = JSON.parse(readFileSync(resolve(dir, `${c.id}.error.json`), 'utf-8'));
    errors.push(`${c.id}: ${e.code} ${e.error}`);
  }
}

const L: string[] = [];
L.push(`# 评测审计（${rows.length}/${CASES.length} 条有结果）`, '');

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

L.push('', '## 五、语料清单', '', '| 样本 | 体裁 | 透镜/模式 | 文本里埋了什么 |', '|---|---|---|---|');
for (const c of CASES) {
  L.push(`| ${c.id} | ${c.genre} | ${c.theory} / ${c.mode} | ${c.traps[0]} |`);
}

if (errors.length) {
  L.push('', '## 五、跑失败', '', ...errors.map((e) => `- ${e}`));
}

const report = L.join('\n');
writeFileSync(resolve(dir, 'report.md'), report, 'utf-8');
console.log(report);
