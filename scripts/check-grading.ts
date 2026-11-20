/**
 * 判档（D0–D5）的断言。
 *
 * 这一层要防的错有三种，性质不同：
 *
 *   1. 表本身错位。六档的名字、触发条款、四档投影任意一处与 D-01 对不上，
 *      读者按编号去复核会跳到错误的判据上——比没有编号更糟。
 *   2. 记录不齐却照样渲染成判决。D-01 第九节：档位必须挂原文位置、未过的 CQ、
 *      降级条件，「缺一不算判决，只算感觉」。所以「缺缺陷位置」「缺降级条件」
 *      「D5 缺闸门」必须是 block 级，界面必须说出来。
 *   3. 本地越权判档。产品定位是「判断由模型写出，本地只核结构与越界」
 *      （docs/产品定位.md）。所以界面组件里不许出现「按检查项算档位」的代码。
 *
 * 文案好不好不在这里管；这里管的是「编号对不对、缺口说没说、本地有没有越权」。
 * 反证另做（scripts/.out/prove-grading.mjs）：改源码逐组看红。
 *
 * 跑法：npm run check:grading
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CheckAnswer, CheckItem, Diagnosis, Grade, GradeRecord } from '@shared/types';
import {
  CONFIDENCE_LABEL,
  GRADE_BOUNDARY,
  GRADE_BUCKET,
  GRADE_CLAUSE,
  GRADE_LABEL,
  GRADE_PROMPT_VERSION,
  GRADES,
  auditGrade,
  gradeExpected,
  gradeLine,
  promptHasGrade,
} from '@shared/grading';
import { versionAtLeast } from '@shared/version';
import { PROMPT_VERSION, PROMPT_VERSION_NOTE, SHARED_SCHEMA, buildPrompt } from '../src/main/prompt';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}
const src = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf-8');

/* ─────────── 一 · 六档表 ─────────── */

ok(GRADES.length === 6, '六档，不多不少', String(GRADES.length));
ok(GRADES.join(',') === 'D0,D1,D2,D3,D4,D5', '档位顺序是 D0→D5，不是按严重度倒着写', GRADES.join(','));

const EXPECT_LABEL: Record<Grade, string> = {
  D0: '无缺陷',
  D1: '可加固',
  D2: '支持不足',
  D3: '型式误用',
  D4: '结构性失效',
  D5: '操纵',
};
for (const g of GRADES) {
  ok(GRADE_LABEL[g] === EXPECT_LABEL[g], `${g} 的中文名与 D-01 二节一致`, GRADE_LABEL[g]);
}

const EXPECT_CLAUSE: Record<Grade, string> = {
  D0: '4.3',
  D1: '4.3',
  D2: '4.4',
  D3: '4.4',
  D4: '4.5',
  D5: '4.6',
};
for (const g of GRADES) {
  ok(GRADE_CLAUSE[g] === EXPECT_CLAUSE[g], `${g} 的触发条款指向 D-01 第四节对应小节`, GRADE_CLAUSE[g]);
}

/* 四档投影：六档是主，四档是粗桶。投影必须单调，不能把 D3 藏进「站得住」。 */
ok(GRADE_BUCKET.D0 === 'withstands' && GRADE_BUCKET.D1 === 'withstands', 'D0／D1 投影为「站得住」');
ok(GRADE_BUCKET.D2 === 'weakened' && GRADE_BUCKET.D3 === 'weakened', 'D2／D3 投影为「削弱」');
ok(GRADE_BUCKET.D4 === 'fails' && GRADE_BUCKET.D5 === 'fails', 'D4／D5 投影为「不成」');
ok(
  GRADES.every((g) => !!GRADE_BUCKET[g]),
  '六档每一档都有投影，没有漏掉的那一档',
  GRADES.filter((g) => !GRADE_BUCKET[g]).join(','),
);
ok(
  GRADES.map((g) => GRADE_BUCKET[g]).join(',') ===
    'withstands,withstands,weakened,weakened,fails,fails',
  '投影随档位单调，不出现「更重的档掉回更轻的桶」',
);

/* ─────────── 二 · 记录核对 ─────────── */

function check(id: string, answer: CheckAnswer): CheckItem {
  return {
    id,
    system: 'walton-cq',
    label: id,
    question: '',
    meta: false,
    answer,
    basis: '',
    guards: '',
    landsOn: null,
  } as CheckItem;
}

function record(over: Partial<GradeRecord> & { level: Grade }): GradeRecord {
  return {
    clause: GRADE_CLAUSE[over.level],
    at: [],
    evidence: '证据',
    fix: '处置',
    downgrade: '若 X 成立，本判改为 D0',
    d5: null,
    ...over,
  };
}

function fake(opts: {
  mode?: Diagnosis['mode'];
  theory?: Diagnosis['theory'];
  applicable?: boolean;
  grade?: GradeRecord | null;
  answers?: CheckAnswer[];
  confidence?: Diagnosis['confidence'];
}): Diagnosis {
  const answers = opts.answers ?? ['passed', 'violated'];
  return {
    version: 2,
    id: 'x',
    parentId: null,
    mode: opts.mode ?? 'diagnose',
    theory: opts.theory ?? 'walton',
    createdAt: 0,
    passage: 'p',
    context: {},
    scope: { applicable: opts.applicable ?? true, reason: '', outOfScopeAt: null, partialNote: null },
    conclusion: { id: 'C' },
    premises: [{ id: 'P1' }, { id: 'P2' }],
    intermediate: [],
    checks: answers.map((a, i) => check(`CQ${i + 1}`, a)),
    verdict: { level: 'weakened', grade: opts.grade ?? null, scale: '', scaleValue: '', statement: '', qualification: '', whatIsRefuted: 'argument-only' },
    confidence: opts.confidence,
  } as unknown as Diagnosis;
}

const kinds = (d: Diagnosis) => auditGrade(d).map((x) => x.kind);
const blocks = (d: Diagnosis) => auditGrade(d).filter((x) => x.severity === 'block').map((x) => x.kind);

/* 完整记录 */
const full = fake({ grade: record({ level: 'D2', at: ['P2', 'CQ2'] }), confidence: { level: 'medium', why: 'x' } });
ok(blocks(full).length === 0, '完整的 D2 记录没有 block 级缺口', blocks(full).join(','));
ok(!kinds(full).includes('confidence-missing'), '带置信度时不报「缺置信度」');

/* 缺缺陷位置——D-01：D2 及以上必须写 P／A／CQ 编号 */
ok(blocks(fake({ grade: record({ level: 'D2' }), confidence: { level: 'high', why: 'x' } })).includes('at-missing'), 'D2 没写缺陷位置 → block', blocks(fake({ grade: record({ level: 'D2' }) })).join(','));
ok(!blocks(fake({ grade: record({ level: 'D0' }), confidence: { level: 'high', why: 'x' }, answers: ['passed'] })).includes('at-missing'), 'D0 不需要缺陷位置');

/* 缺降级条件——D-01 4.8：写不出视为本判尚未完成 */
ok(
  blocks(fake({ grade: record({ level: 'D4', at: ['P1'], downgrade: '' }), confidence: { level: 'high', why: 'x' } })).includes('downgrade-missing'),
  '缺降级条件 → block（这一份还不算判决）',
);

/* D5 三道闸门 */
const d5NoGates = record({ level: 'D5', at: ['P1', 'CQ2'] });
ok(blocks(fake({ grade: d5NoGates, confidence: { level: 'high', why: 'x' } })).includes('d5-gates-missing'), 'D5 没有三闸门记录 → block');

const d5Partial = record({
  level: 'D5',
  at: ['P1'],
  d5: { consequence: '追问被改写成已答', synergy: '', protocol: '信息寻求型对话', removed: ['删 a 仍出现', '删 b 即消失'] },
});
ok(blocks(fake({ grade: d5Partial, confidence: { level: 'high', why: 'x' } })).includes('d5-gates-missing'), 'D5 三道闸门缺一道 → block');

const d5NoRemoved = record({
  level: 'D5',
  at: ['P1'],
  d5: { consequence: '追问被改写成已答', synergy: '两个手法合起来才造成', protocol: '信息寻求型', removed: [] },
});
ok(
  blocks(fake({ grade: d5NoRemoved, confidence: { level: 'high', why: 'x' } })).includes('d5-without-synergy-record'),
  'D5 没有反事实移除测试的记录 → block（协同没被验证过）',
);

/* 只记一条也算没验证：协同要「各自单独不足」，删一个手法还剩一个，
   那只能证明其中一个不必要，证明不了两个合起来才够。反证第 7 组就是靠这一条咬住的。 */
const d5OneRemoved = record({
  level: 'D5',
  at: ['P1'],
  d5: { consequence: '追问被改写成已答', synergy: '两个手法合起来才造成', protocol: '信息寻求型', removed: ['删去权威背书，后果仍在'] },
});
ok(
  blocks(fake({ grade: d5OneRemoved, confidence: { level: 'high', why: 'x' } })).includes('d5-without-synergy-record'),
  'D5 只记一条反事实移除 → block（单独一条证明不了协同）',
);

const d5Full = record({
  level: 'D5',
  at: ['P1', 'CQ2'],
  d5: {
    consequence: '追问被改写成「已有明确答复」，读者失去追问入口',
    synergy: '权威背书与改写追问合起来才造成；单独任一不足以封口',
    protocol: '信息寻求型对话，追问本应开放',
    removed: ['删去权威背书，改写追问仍在，剥夺仍出现 → 背书非必要', '删去改写，仅剩背书，读者仍可追问 → 改写必要'],
  },
});
ok(blocks(fake({ grade: d5Full, confidence: { level: 'high', why: 'x' } })).length === 0, 'D5 三闸门与反事实记录齐全 → 无 block', blocks(fake({ grade: d5Full })).join(','));

/* 指向不存在的编号、重复计同一处缺陷 */
ok(
  kinds(fake({ grade: record({ level: 'D2', at: ['P9'] }), confidence: { level: 'high', why: 'x' } })).includes('at-unknown'),
  '缺陷位置指向不存在的 P9 → warn（不是 block：位置写了，只是写错了）',
);
ok(
  kinds(fake({ grade: record({ level: 'D2', at: ['P2', 'P2'] }), confidence: { level: 'high', why: 'x' } })).includes('at-duplicate'),
  '同一处缺陷记了两次 → warn（同一缺陷只计一次）',
);
ok(
  !kinds(fake({ grade: record({ level: 'D2', at: ['P2（关键前提）'] }), confidence: { level: 'high', why: 'x' } })).includes('at-unknown'),
  '编号带括注（P2（关键前提））仍认得出来',
);

/* D0／D1 与 violated 检查项矛盾 */
ok(
  kinds(fake({ grade: record({ level: 'D0' }), confidence: { level: 'high', why: 'x' }, answers: ['passed', 'violated'] })).includes('shallow-grade-with-violation'),
  'D0 却有 violated 的检查项 → warn（记录与自身矛盾）',
);
ok(
  !kinds(fake({ grade: record({ level: 'D0' }), confidence: { level: 'high', why: 'x' }, answers: ['passed', 'passed'] })).includes('shallow-grade-with-violation'),
  'D0 且全过时不报矛盾',
);

/* C-03 4.4「未答不算过」：空白与不过同计，D0／D1 却留一格空白也是记录与自身矛盾 */
ok(
  kinds(fake({ grade: record({ level: 'D1' }), confidence: { level: 'high', why: 'x' }, answers: ['passed', 'unanswered'] })).includes('shallow-grade-with-unanswered'),
  'D1 却有未答的检查项 → warn（未答不算过）',
);
ok(
  !kinds(fake({ grade: record({ level: 'D1' }), confidence: { level: 'high', why: 'x' }, answers: ['passed', 'not-applicable'] })).includes('shallow-grade-with-unanswered'),
  '不适用项不进分母，D1 不受影响',
);
ok(
  !kinds(fake({ grade: record({ level: 'D2' }), confidence: { level: 'high', why: 'x' }, answers: ['passed', 'unanswered'] })).includes('shallow-grade-with-unanswered'),
  'D2 允许未答（C-03 4.7：支持力下降），不误报',
);

/* 条款对不上 */
ok(
  kinds(fake({ grade: record({ level: 'D3', clause: '4.5' }), confidence: { level: 'high', why: 'x' } })).includes('clause-mismatch'),
  'D3 写成 4.5 → warn（编号指错了判据）',
);
ok(
  kinds(fake({ grade: record({ level: 'D3', clause: '' }), confidence: { level: 'high', why: 'x' } })).includes('clause-missing'),
  '没写条款编号 → warn',
);

/* 该不该有 D 档 */
ok(kinds(fake({ grade: null })).includes('no-grade'), '诊断模式没有 D 档 → warn（不是 block：旧档本来就没有）');
ok(auditGrade(fake({ mode: 'reconstruct', grade: null })).length === 0, '重构模式没有 D 档 → 不报缺口（本来就不评级）');
ok(
  blocks(fake({ mode: 'reconstruct', grade: record({ level: 'D2', at: ['P1'] }) })).includes('grade-on-nongrading-mode'),
  '重构模式出现 D 档 → block（模式不评级）',
);
ok(!gradeExpected(fake({ theory: 'copi' })), '名录透镜不该有 D 档');
ok(!gradeExpected(fake({ applicable: false })), '透镜不适用时不该有 D 档');

/* 缺置信度 */
ok(kinds(fake({ grade: record({ level: 'D2', at: ['P1'] }) })).includes('confidence-missing'), '有档位却没有评估置信度 → warn（三分离要求另立字段）');

/* ─────────── 三 · 文案与边界 ─────────── */

ok(/谬误谬误/.test(GRADE_BOUNDARY), '边界句写明「由档位推结论为假是谬误谬误」');
ok(/门槛/.test(GRADE_BOUNDARY), '边界句写明 D5 是门槛不是刻度');
const line = gradeLine(record({ level: 'D3', at: ['CQ2'], fix: '换型式', downgrade: '若补出例外则改 D1' }));
ok(/D3 型式误用/.test(line) && /触发 4\.4/.test(line), '一句话记录带档位与条款', line);
ok(/缺陷 CQ2/.test(line) && /降级：若补出例外则改 D1/.test(line), '一句话记录带缺陷位置与降级条件', line);
ok(Object.keys(CONFIDENCE_LABEL).length === 5, '置信度五档都有中文名');

/* 版本判定：2.9.0 也有 D 档，不能被当成旧档 */
ok(promptHasGrade('2.8.0'), '2.8.0 起有 D 档');
ok(!promptHasGrade('2.7.0'), '2.7.0 没有 D 档');
ok(promptHasGrade('2.9.0'), '2.9.0 不能被当成旧档（版本比较不能写成等号）');
ok(promptHasGrade('2.10.0'), '2.10.0 按数字比较，不是按字符串');
ok(!promptHasGrade(undefined), '没记版本按「没有」处理');

/* ─────────── 四 · 提示词 ─────────── */

/*
 * 版本断言用「不低于」，不写等号：判档这一层从 2.8.0 起在，
 * 后来加修辞审计把版本推到 2.9.0——写死等号会让每加一层就红一次，
 * 而红的原因与判档无关。
 */
ok(versionAtLeast(PROMPT_VERSION, '2.8.0'), '提示词版本不低于 2.8.0（判档那一层在）', PROMPT_VERSION);
ok(PROMPT_VERSION_NOTE.some((n) => n.startsWith('2.8.0')), '版本注记里留着 2.8.0 那一行（判档为什么加）');
ok(GRADE_PROMPT_VERSION === '2.8.0', '共享层的「从哪版起有 D 档」与提示词版本一致');
ok(/"grade"/.test(SHARED_SCHEMA) && /D0\|D1\|D2\|D3\|D4\|D5/.test(SHARED_SCHEMA), 'schema 里有 grade 与六档');
ok(/"confidence"/.test(SHARED_SCHEMA), 'schema 里有独立的 confidence');
ok(/downgrade/.test(SHARED_SCHEMA), 'schema 要求写降级条件');
ok(/consequence|synergy|protocol/.test(SHARED_SCHEMA), 'schema 里有 D5 三闸门');

const diagUser = buildPrompt('walton', 'diagnose').userTemplate;
ok(/D5→D4→D3→D2→D1→D0/.test(diagUser), '诊断模式的提示词写明判档顺序');
ok(/同一处缺陷只记一次/.test(diagUser), '提示词写明同一缺陷只计一次');
ok(/三处小毛病相加不是 D5/.test(diagUser), '提示词写明 D5 不凑数');
ok(/confidence/.test(diagUser), '提示词要求另写置信度');
const recUser = buildPrompt('walton', 'reconstruct').userTemplate;
ok(/本模式不评级/.test(recUser), '不评级的模式明写 grade 写 null');
ok(!/D5→D4→D3→D2→D1→D0/.test(recUser), '不评级的模式不塞判档顺序（塞了会诱导它顺手判一档）');

/* ─────────── 五 · 接线 ─────────── */

const analyze = src('src/main/analyze.ts');
ok(/GRADE_BUCKET/.test(analyze), 'analyze 用共享投影重算四档，不各算一遍');
ok(/GRADE_STRIPPED/.test(analyze), '模式不评级／范围门把 D 档置空时留痕');
ok(/GRADE_LEVEL_SYNCED/.test(analyze), '四档与 D 档不一致时留痕');
ok(/GRADE_OVERRUN/.test(analyze), 'D0／D1 却写「结论被否证」时纠正（谬误谬误）');
ok(/auditGrade\(report\)/.test(analyze), '报告建好后跑一次判档记录核对');
ok(/GRADE_INCOMPLETE/.test(analyze) && /GRADE_NOTE/.test(analyze), 'block 与 warn 两级缺口分开记');

const diag = src('src/renderer/src/components/Diagnosis.tsx');
ok(/<GradeCard d=\{d\} \/>/.test(diag), '报告页渲染判档记录卡');

const card = src('src/renderer/src/components/GradeCard.tsx');
ok(/auditGrade\(d\)/.test(card), '卡片用共享核对，不自己写一套');
ok(/data-grade=\{g\.level\}/.test(card), '卡片带 data-grade，端到端能探到档位');
ok(/data-grade-gates/.test(card), 'D5 三闸门有独立探针');
ok(/GRADE_BOUNDARY/.test(card), '卡片带边界句（档位不蕴含结论真假）');
ok(!/answer\s*===\s*'violated'/.test(card), '卡片不按检查项自己算档位（本地不越权判定）');
ok(!/level:\s*'D[0-5]'/.test(card), '卡片里没有写死的档位');

const ov = src('src/renderer/src/components/Overview.tsx');
ok(/GRADE_LABEL/.test(ov) && /auditGrade/.test(ov), '速览档位优先写 D 档，并标出记录不全');

const mock = src('src/renderer/src/mock-data.ts');
ok(/level: 'D2'/.test(mock) && /clause: '4\.4'/.test(mock), '预览数据带一条完整 D2 记录（截图与预览能看到形状）');
ok(/confidence:/.test(mock), '预览数据带评估置信度');

/* ─────────── 收口 ─────────── */

if (failed.length) {
  console.error(`✗ 判档检查：${failed.length} 条不通过（共 ${passed + failed.length} 条）`);
  for (const f of failed) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`✓ 判档检查：${passed} 条全部通过`);
