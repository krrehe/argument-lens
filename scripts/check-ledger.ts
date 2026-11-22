/**
 * 命题账（D-02）的断言。
 *
 * 这一层要防的错，与判档、修辞审计同源但落点不同：
 *
 *   1. 栏位名与状态值对不上 D-02。三栏一旦本地另造一套名字，A-03 的路由结果
 *      就接不进这张账；状态值越栏（规范栏写「已证真」）不是措辞问题，是串账。
 *   2. 「不判」被当成账外的沉默。只写「此处不判」而不写理由、责任、回栏条件，
 *      等于给一个判决免掉证成义务——D-02 4.5 明写这算漏记。
 *   3. 本地越权。状态值是模型的判决；本地只按用词归栏，归得不一样时登记分歧，
 *      不静默改账。账里出现 D0–D5 就是串账，出现置信度就是拿取材问题改命题状态。
 *
 * 反证另做（scripts/.out/prove-ledger.mjs）：改源码逐组看红。
 *
 * 跑法：npm run check:ledger
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Claim, Diagnosis } from '@shared/types';
import {
  COLUMN_LABEL,
  COLUMN_STATUSES,
  FACT_STATE_LABEL,
  LEDGER_BOUNDARY,
  LEDGER_COLUMNS,
  LEDGER_ISOLATION,
  REASON_LABEL,
  STATUS_LABEL,
  auditLedger,
  ledgerComplete,
  ledgerExpected,
  ledgerLine,
  promptHasLedger,
  rowLine,
  type FactState,
  type FallacyScreen,
  type Ledger,
  type LedgerColumn,
  type LedgerRow,
  type LedgerStatus,
  type NoJudgeReason,
} from '@shared/ledger';
import { DECID_LABEL, DECID_ORDER } from '@shared/propositions';
import { PROMPT_VERSION, PROMPT_VERSION_NOTE, SHARED_SCHEMA, buildPrompt } from '../src/main/prompt';
import { versionAtLeast } from '@shared/version';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}
const src = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');

/* ─────────── 一 · 词表：三栏与各自的封闭状态值 ─────────── */

ok(LEDGER_COLUMNS.length === 3, '三栏，不多不少（A-03 4.1）', String(LEDGER_COLUMNS.length));
ok(
  LEDGER_COLUMNS.join('|') === 'fact-decidable|fact-undecidable|norm-undecidable',
  '三栏的顺序与名字照抄 D-02',
  LEDGER_COLUMNS.join('|'),
);
ok(
  LEDGER_COLUMNS.every((c) => COLUMN_LABEL[c].length >= 5),
  '每栏都有中文名',
);
ok(COLUMN_LABEL['fact-undecidable'] === '事实·不可裁', '「不可裁」没被写成「证据不足」——它是材料状态，不是命题性质');
ok(COLUMN_STATUSES['fact-decidable'].join('|') === 'true|false|open', '事实·可裁三值：已证真／已证伪／未决');
ok(COLUMN_STATUSES['fact-undecidable'].join('|') === 'undecidable', '事实·不可裁只有一个状态值');
ok(
  COLUMN_STATUSES['norm-undecidable'].join('|') === 'strong|weak|unjustified',
  '规范栏三值：证成强／弱／未证成（不写真假）',
  COLUMN_STATUSES['norm-undecidable'].join('|'),
);
ok(
  !(COLUMN_STATUSES['norm-undecidable'] as readonly string[]).some((s) => s === 'true' || s === 'false'),
  '规范栏里没有真／假这两个值',
);
ok(Object.keys(REASON_LABEL).length === 3, '不判的理由类型三类（材料／价值前提／协议）');
ok(REASON_LABEL.protocol.includes('协议'), '「协议不允许裁定」写的是对话协议，不是作者态度');
ok(Object.keys(FACT_STATE_LABEL).join('|') === 'verified|checkable|unavailable', '事实前提状态三值', Object.keys(FACT_STATE_LABEL).join('|'));

/* 两册不得各造一套栏位名称（A-03 五节）。本地归栏直接取 D-02 的键。 */
ok(DECID_ORDER.join('|') === LEDGER_COLUMNS.join('|'), '本地归栏的顺序与命题账三栏完全一致');
ok(
  DECID_ORDER.every((k) => DECID_LABEL[k] === COLUMN_LABEL[k]),
  '两处的中文名一字不差（否则报告与账会对不上号）',
);

/* ─────────── 二 · 样本 ─────────── */

function claim(id: string, text: string, role: Claim['role'] = 'premise'): Claim {
  return {
    id,
    role,
    text,
    supports: ['C'],
    quote: null,
    span: null,
    implicit: false,
    implicitBasis: null,
    burden: 'proponent',
    acceptability: { status: 'questionable', reason: '', forAudience: '', tag: 'known', confidence: 'medium' },
  };
}

function row(o: Partial<LedgerRow> & { at: string; column: LedgerColumn; status: LedgerStatus }): LedgerRow {
  return {
    basis: '依据：原文第一句与校内统计表',
    reentry: '',
    av: '',
    factState: null,
    conditional: '',
    noJudge: null,
    ...o,
  };
}

const screen = (o: Partial<FallacyScreen> & { direction: FallacyScreen['direction'] }): FallacyScreen => ({
  found: false,
  at: '全文',
  note: '没有出现明说版本；隐性版本（「这种说法站不住」）也逐句查过',
  ...o,
});

const NO_JUDGE = { reason: 'material' as NoJudgeReason, burden: 'proponent' as Claim['burden'], reviewer: '第二分析者' };

/** 一份记全了的账：三条命题，一栏一条，规范栏带条件式结论。 */
const full: Ledger = {
  rows: [
    row({ at: 'C', column: 'norm-undecidable', status: 'strong', av: '补出：凡使死亡率上升的措施都应当撤回', factState: 'verified' as FactState, conditional: '若接受该价值前提，且死亡率数据已核验，则结论得到证成' }),
    row({ at: 'P1', column: 'fact-decidable', status: 'true', basis: '引用：市疾控 2024 年报表第 3 页' }),
    row({ at: 'P2', column: 'fact-undecidable', status: 'undecidable', basis: '缺同期对照校数据', reentry: '取得对照校同期数据即回栏', noJudge: NO_JUDGE }),
  ],
  fallacies: [
    screen({ direction: 'forward' }),
    screen({ direction: 'reverse', note: '没发现；隐性版本「事实就是这样」也查过，末句是规范主张，不算' }),
  ],
};

function fake(opts: {
  ledger?: Ledger | null;
  mode?: Diagnosis['mode'];
  theory?: Diagnosis['theory'];
  applicable?: boolean;
  claims?: Claim[];
}): Diagnosis {
  const claims = opts.claims ?? [claim('P1', '甲'), claim('P2', '乙')];
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
    conclusion: claim('C', '应当撤回该措施', 'conclusion'),
    premises: claims,
    intermediate: [],
    checks: [],
    verdict: { level: 'weakened', grade: null, scale: '', scaleValue: '', statement: '', qualification: '', whatIsRefuted: 'argument-only' },
    ledger: opts.ledger === undefined ? full : opts.ledger,
  } as unknown as Diagnosis;
}

const kinds = (d: Diagnosis) => auditLedger(d).map((g) => g.kind);
const blocks = (d: Diagnosis) => auditLedger(d).filter((g) => g.severity === 'block').map((g) => g.kind);

ok(blocks(fake({})).length === 0, '记全了的账没有 block 级缺口', blocks(fake({})).join(','));
ok(ledgerComplete(fake({})), 'ledgerComplete 与「没有 block」同一口径');
ok(ledgerExpected(fake({})), '诊断模式该有命题账');
ok(ledgerExpected(fake({ theory: 'ars' })), '换透镜也照样要记账');
ok(!ledgerExpected(fake({ mode: 'reconstruct' })), '重构模式不走到裁决层，不需要账');
ok(!ledgerExpected(fake({ theory: 'copi' })), '名录透镜不判论证结构，不需要账');
ok(!ledgerExpected(fake({ applicable: false })), '透镜不适用时不记账');

/* ─────────── 三 · 账与报告对不对得上 ─────────── */

const missing: Ledger = { ...full, rows: full.rows.filter((r) => r.at !== 'P2') };
ok(blocks(fake({ ledger: missing })).includes('missing-row'), '有命题没上账 → block（第二位分析者无法只凭账页重填）');
ok(kinds(fake({ ledger: missing })).includes('missing-row'), '缺行点名到具体编号');

const orphan: Ledger = { ...full, rows: [...full.rows, row({ at: 'P9', column: 'fact-decidable', status: 'open' })] };
ok(kinds(fake({ ledger: orphan })).includes('orphan-row'), '账上有一行指向报告里不存在的编号 → warn');

const dupSame: Ledger = { ...full, rows: [...full.rows, row({ at: 'P1', column: 'fact-decidable', status: 'open' })] };
ok(kinds(fake({ ledger: dupSame })).includes('duplicate-row'), '同一命题同栏记两次 → warn（多余，不是串账）');

const twoCols: Ledger = {
  ...full,
  rows: [...full.rows.filter((r) => r.at !== 'P1'), row({ at: 'P1', column: 'fact-decidable', status: 'true' }), row({ at: 'P1', column: 'norm-undecidable', status: 'weak', av: '补出：该数据足以推出规范结论', factState: 'checkable', conditional: '若接受该桥接，则结论得到弱证成' })],
};
ok(blocks(fake({ ledger: twoCols })).includes('two-columns'), '同一条命题同时落在两栏 → block（三栏物理隔离）');

ok(kinds(fake({ ledger: null })).includes('no-ledger'), '没有账 → warn（旧存档照实说没有）');
ok(!blocks(fake({ ledger: null })).includes('no-ledger'), '没有账不是 block——旧存档不该被当成错误');
ok(blocks(fake({ ledger: { rows: [], fallacies: full.fallacies } })).includes('empty-ledger'), '空账 → block');
ok(blocks(fake({ ledger: full, mode: 'reconstruct' })).includes('ledger-on-nongrading-mode'), '不裁决的模式里出现账 → block（该置空）');

/* 没有命题的报告不需要账 */
const noClaims = fake({ ledger: null });
noClaims.premises = [];
delete (noClaims as { conclusion?: Claim }).conclusion;
ok(!kinds(noClaims).includes('no-ledger'), '一条命题都没有的报告，不因缺账被点名');

/* ─────────── 四 · 状态值越栏就是串账 ─────────── */

const normTrue: Ledger = {
  ...full,
  rows: [row({ at: 'C', column: 'norm-undecidable', status: 'true' as never, av: '补出：应当撤回', factState: 'verified', conditional: '若接受该前提，则结论得到证成' }), ...full.rows.filter((r) => r.at !== 'C')],
};
ok(blocks(fake({ ledger: normTrue })).includes('status-not-in-column'), '规范栏写「已证真」→ block');
const factStrong: Ledger = {
  ...full,
  rows: [...full.rows.filter((r) => r.at !== 'P1'), row({ at: 'P1', column: 'fact-decidable', status: 'strong' as never })],
};
ok(blocks(fake({ ledger: factStrong })).includes('status-not-in-column'), '事实栏写「证成强」→ block');
ok(blocks(fake({ ledger: factStrong })).some((k) => k === 'status-not-in-column'), '越栏的状态值不会被折算成合法值');

/* ─────────── 五 · 规范栏：A_v、事实前提、条件式结论 ─────────── */

const noAv: Ledger = { ...full, rows: full.rows.map((r) => (r.at === 'C' ? { ...r, av: '' } : r)) };
ok(blocks(fake({ ledger: noAv })).includes('av-missing'), '规范栏没写价值前提 → block');
const vagueAv: Ledger = { ...full, rows: full.rows.map((r) => (r.at === 'C' ? { ...r, av: '在通常价值下' } : r)) };
ok(blocks(fake({ ledger: vagueAv })).includes('av-missing'), '价值前提写成「在通常价值下」→ block（等于没写）');
const noState: Ledger = { ...full, rows: full.rows.map((r) => (r.at === 'C' ? { ...r, factState: null } : r)) };
ok(blocks(fake({ ledger: noState })).includes('fact-state-missing'), '规范栏没写事实前提状态 → block');
const noCond: Ledger = { ...full, rows: full.rows.map((r) => (r.at === 'C' ? { ...r, conditional: '' } : r)) };
ok(blocks(fake({ ledger: noCond })).includes('conditional-missing'), '规范栏没写条件式结论 → block');
const flatCond: Ledger = { ...full, rows: full.rows.map((r) => (r.at === 'C' ? { ...r, conditional: '因此应当撤回该措施。' } : r)) };
ok(kinds(fake({ ledger: flatCond })).includes('conditional-not-conditional'), '条件式结论里没有条件词 → warn（它读起来仍是无条件判决）');
const truthLeak: Ledger = {
  ...full,
  rows: full.rows.map((r) => (r.at === 'C' ? { ...r, basis: '该价值前提为假，所以结论不成立' } : r)),
};
ok(blocks(fake({ ledger: truthLeak })).includes('truth-in-norm-column'), '规范栏里出现真假判决 → block');

/* ─────────── 六 · 不判也是判决 ─────────── */

const noRecord: Ledger = { ...full, rows: full.rows.map((r) => (r.at === 'P2' ? { ...r, noJudge: null } : r)) };
ok(blocks(fake({ ledger: noRecord })).includes('no-judge-record'), '不可裁却没写不判七项 → block');
const noReentry: Ledger = { ...full, rows: full.rows.map((r) => (r.at === 'P2' ? { ...r, reentry: '' } : r)) };
ok(blocks(fake({ ledger: noReentry })).includes('reentry-missing'), '不可裁却没写定案条件 → block（长期滞留不是谨慎）');
const badReason: Ledger = {
  ...full,
  rows: full.rows.map((r) => (r.at === 'P2' ? { ...r, noJudge: { ...NO_JUDGE, reason: 'other' as never } } : r)),
};
ok(blocks(fake({ ledger: badReason })).includes('reason-missing'), '理由类型不在三类里 → block');
const unclearBurden: Ledger = {
  ...full,
  rows: full.rows.map((r) => (r.at === 'P2' ? { ...r, noJudge: { ...NO_JUDGE, burden: 'unclear' as const } } : r)),
};
ok(kinds(fake({ ledger: unclearBurden })).includes('burden-unclear'), '举证责任未分配 → warn（不判成了把义务丢给对方）');
const noReviewer: Ledger = {
  ...full,
  rows: full.rows.map((r) => (r.at === 'P2' ? { ...r, noJudge: { ...NO_JUDGE, reviewer: '' } } : r)),
};
ok(kinds(fake({ ledger: noReviewer })).includes('reviewer-missing'), '不判记录没写复核人 → warn');
const judgedWithRecord: Ledger = {
  ...full,
  rows: full.rows.map((r) => (r.at === 'P1' ? { ...r, noJudge: NO_JUDGE } : r)),
};
ok(kinds(fake({ ledger: judgedWithRecord })).includes('no-judge-on-judged'), '判了却仍挂不判记录 → warn（多半是照着模板抄的）');

/* ─────────── 七 · 四层各记各的账 ─────────── */

const gradeLeak: Ledger = { ...full, rows: full.rows.map((r) => (r.at === 'P1' ? { ...r, basis: '依据 D2，关键前提未获辩护' } : r)) };
ok(blocks(fake({ ledger: gradeLeak })).includes('grade-in-ledger'), '账页上出现 D0–D5 → block（串账，D-02 4.8）');
const confLeak: Ledger = { ...full, rows: full.rows.map((r) => (r.at === 'P1' ? { ...r, basis: '取材不全，置信度低' } : r)) };
ok(kinds(fake({ ledger: confLeak })).includes('confidence-in-ledger'), '账页上出现置信度 → warn（取材问题不改命题状态）');
const rhetoricLeak: Ledger = { ...full, rows: full.rows.map((r) => (r.at === 'P1' ? { ...r, basis: '作者语气煽情，所以这条不可信' } : r)) };
ok(kinds(fake({ ledger: rhetoricLeak })).includes('rhetoric-in-ledger'), '事实栏拿修辞评语当状态理由 → warn');

/* 归栏分歧：本地按用词归的栏与账上不同，登记成一条，不静默改账 */
const disagree: Ledger = {
  ...full,
  rows: [...full.rows.filter((r) => r.at !== 'P2'), row({ at: 'P2', column: 'norm-undecidable', status: 'weak', av: '补出：该事实足以推出规范结论', factState: 'checkable', conditional: '若接受该桥接，则结论得到弱证成' })],
};
ok(kinds(fake({ ledger: disagree })).includes('column-disagreement'), '本地归事实、账上归规范 → warn（登记分歧）');
const before = JSON.stringify(disagree);
auditLedger(fake({ ledger: disagree }));
ok(JSON.stringify(disagree) === before, '核账不改账（状态值一个字都不动）');

/* ─────────── 八 · 双向谬误筛查 ─────────── */

const oneWay: Ledger = { ...full, fallacies: [screen({ direction: 'forward' })] };
ok(blocks(fake({ ledger: oneWay })).includes('fallacy-screen-missing'), '只查正向 → block（只禁一边就是双标）');
const noScreen: Ledger = { ...full, fallacies: [] };
ok(blocks(fake({ ledger: noScreen })).includes('fallacy-screen-missing'), '两个方向都没查 → block');
const thinNote: Ledger = { ...full, fallacies: [screen({ direction: 'forward', note: '无' }), screen({ direction: 'reverse' })] };
ok(kinds(fake({ ledger: thinNote })).includes('fallacy-note-missing'), '筛查行没写处置 → warn');
const reverseBlind: Ledger = { ...full, fallacies: [screen({ direction: 'forward' }), screen({ direction: 'reverse', note: '没有发现' })] };
ok(kinds(fake({ ledger: reverseBlind })).includes('fallacy-implicit-unchecked'), '反向没提隐性版本 → warn');
const reverseFound: Ledger = {
  ...full,
  fallacies: [screen({ direction: 'forward' }), screen({ direction: 'reverse', found: true, at: 'P3 之后', note: '「结论已被证实」→ 改法：结论另记，推理按 D-01 重判' })],
};
ok(!kinds(fake({ ledger: reverseFound })).includes('fallacy-implicit-unchecked'), '发现了反向谬误，就不要求再写隐性版本');

/* ─────────── 九 · 一句话记录 ─────────── */

const line = ledgerLine(full);
ok(/共 3 条/.test(line), '总述带条数', line);
ok(/可裁 1/.test(line) && /不可裁 1/.test(line) && /规范 1/.test(line), '总述按三栏分列', line);
ok(/不判 1/.test(line), '总述点数「没判」的条数——它们也是判决', line);
ok(/两个方向的谬误谬误筛查均未发现/.test(line), '没发现时也要明确写「查过了」', line);
const foundLine = ledgerLine({ ...full, fallacies: [screen({ direction: 'forward', found: true, at: 'P2 之后' }), screen({ direction: 'reverse' })] });
ok(/谬误谬误 1 处/.test(foundLine), '发现时点数', foundLine);
ok(/A_v/.test(rowLine(full.rows[0])) && /条件式/.test(rowLine(full.rows[0])), '规范栏那一行带 A_v 与条件式', rowLine(full.rows[0]));
ok(/缺同期对照/.test(rowLine(full.rows[2])), '不可裁那一行带「缺什么」', rowLine(full.rows[2]));

/* ─────────── 十 · 提示词与版本 ─────────── */

ok(versionAtLeast(PROMPT_VERSION, '2.10.0'), '提示词版本不低于 2.10.0（命题账那一版）', PROMPT_VERSION);
ok(PROMPT_VERSION_NOTE[0].startsWith(PROMPT_VERSION), '版本注记第一条写的是当前版本号', PROMPT_VERSION_NOTE[0].slice(0, 16));
ok(SHARED_SCHEMA.includes('"ledger"'), 'schema 里有 ledger 块');
const schemaBlock = SHARED_SCHEMA.slice(SHARED_SCHEMA.indexOf('"ledger"')).split('"repair"')[0];
for (const f of ['at', 'column', 'status', 'basis', 'reentry', 'av', 'factState', 'conditional', 'noJudge']) {
  ok(schemaBlock.includes(`"${f}"`), `schema 的账行带 ${f}`);
}
ok(schemaBlock.includes('"fallacies"'), 'schema 带双向筛查');
ok(schemaBlock.includes('material|value-premise|protocol'), 'schema 把理由类型列成三值，不许写「其他」');

const walton = buildPrompt('walton', 'diagnose').userTemplate;
ok(promptHasLedger('2.10.0'), '2.10.0 有命题账');
ok(promptHasLedger('2.11.0'), '2.11.0 也有（按数字比版本，不是写等号）');
ok(!promptHasLedger('2.9.0'), '2.9.0 没有这一层');
ok(!promptHasLedger(undefined), '没记版本按「没有」处理');
ok(/命题账（D-02）/.test(walton), '诊断模式的提示词里真的有这一条');
ok(/不判/.test(walton) && /reentry/.test(walton), '提示词里写清「不判也是判决」与定案条件');
ok(/只写「此处不判」是漏记/.test(walton), '提示词明写：只写「此处不判」算漏记，不算中立');
ok(!/命题账（D-02）/.test(buildPrompt('walton', 'reconstruct').userTemplate), '重构模式不要求记账');
ok(/ledger 写 null/.test(buildPrompt('walton', 'reconstruct').userTemplate), '不记账的模式明写「写 null」，不是留白');

/* ─────────── 十一 · 界面接线 ─────────── */

const diagTsx = src('src/renderer/src/components/Diagnosis.tsx');
ok(/<PropositionLedger v=\{props\} gaps=\{ledgerGaps\} \/>/.test(diagTsx), '报告主体里真的渲染了命题账（不是只有 import）');
ok(/auditLedger\(d\)/.test(diagTsx), '账的缺口在报告层核一次，组件不自己判');

const comp = src('src/renderer/src/components/PropositionLedger.tsx');
ok(/STATUS_LABEL\[g\.status\]/.test(comp), '卡片显示账上的状态值');
ok(/FACT_STATE_LABEL/.test(comp) && /A_v/.test(comp), '规范栏露出价值前提与事实前提状态');
ok(/REASON_LABEL\[g\.noJudge\.reason\]/.test(comp), '不判七项在界面上能看到理由');
ok(/data-dir=\{f\.direction\}/.test(comp), '两个方向的筛查各占一行');
ok(/data-gaps=\{blocks\.length\}/.test(comp), '缺口在卡片里点名');
ok(/LEDGER_ISOLATION|LEDGER_BOUNDARY/.test(comp), '两本账的隔离声明与「不判也是判决」都写在界面上');
ok(LEDGER_ISOLATION.includes('不许接一句') && LEDGER_BOUNDARY.includes('漏记'), '两句常量的意思与 D-02 一致');
ok(/这份报告只按用词归了栏/.test(comp), '旧存档照实说「没记账」，不补假值');

/* ─────────── 收口 ─────────── */

if (failed.length) {
  for (const f of failed) console.error(`✗ ${f}`);
  console.error(`\n✗ 命题账（D-02）${failed.length} 条没过（共 ${passed + failed.length} 条）`);
  process.exit(1);
}
console.log(
  `✓ 命题账（D-02）：${passed} 条全部通过｜三栏封闭状态值、不判七项、双向谬误筛查、四层各记各的账、归栏分歧不静默`,
);
