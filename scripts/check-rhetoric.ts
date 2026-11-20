/**
 * 修辞审计（D-03）的断言。
 *
 * 这一层要防的错有三种，性质不同：
 *
 *   1. 词表错位。三诉求、框架四功能、程度三级、后果三类——任何一处与 D-03 对不上，
 *      读的人按这一格去复核会跑到别的判据上。而这一层的全部价值就在「可复核」。
 *   2. 表做了一半却像做完了。D-03 第五节把过关判据写成四条（四项填完、每个可疑成分
 *      都跑了四步、替代成立必有链、链上四项齐全）。缺哪条都要点名——尤其「没跑测试」，
 *      它最容易被写成「伴随」：那是把「没做」写成「做过且没问题」。
 *   3. 本地越权判定。审计结果不改档位、不改命题真假。所以卡片里不许出现
 *      「按三诉求算一处替代」这类代码，替换与否只认模型写下的那一格。
 *
 * 文案好不好不在这里管；这里管的是「词表对不对、缺口说没说、本地有没有越权」。
 * 反证另做（scripts/.out/prove-rhetoric.mjs）：改源码逐组看红。
 *
 * 跑法：npm run check:rhetoric
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Diagnosis, RhetoricAudit, RhetoricRow, SubstituteChain } from '@shared/types';
import {
  CORRECTION_LABEL,
  DEGREE_LABEL,
  FRAME_LABEL,
  FUNC_LABEL,
  HARM_LABEL,
  KIND_LABEL,
  REPLACED_LABEL,
  RHETORIC_BOUNDARY,
  RHETORIC_COLUMNS,
  RHETORIC_ISOLATION,
  RHETORIC_ITEMS,
  SUBSTITUTE_LABEL,
  VERIFIABLE_LABEL,
  auditLine,
  auditRhetoric,
  chainLine,
  promptHasRhetoric,
  rhetoricExpected,
} from '@shared/rhetoric';
import { versionAtLeast } from '@shared/version';
import { promptHasGrade } from '@shared/grading';
import { PROMPT_VERSION, PROMPT_VERSION_NOTE, SHARED_SCHEMA, buildPrompt } from '../src/main/prompt';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}
const src = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf-8');

/* ─────────── 一 · 词表 ─────────── */

ok(RHETORIC_COLUMNS.length === 8, '审计表八列，不多不少（D-03 4.8）', String(RHETORIC_COLUMNS.length));
ok(
  RHETORIC_COLUMNS.join('|') === '句位|三诉求功能|框架四功能|程度|传播条件|替代测试|后果|移交／计次',
  '八列顺序与 D-03 4.8 一致',
  RHETORIC_COLUMNS.join('|'),
);
ok(RHETORIC_ITEMS.length === 4, '四项审计：三诉求／框架／程度／传播', RHETORIC_ITEMS.join('、'));
ok(
  RHETORIC_ITEMS.join('、') === '三诉求配比、框架预设、程度夸大、传播条件',
  '四项的名字与 D-03 4.2–4.5 一致',
  RHETORIC_ITEMS.join('、'),
);

ok(Object.keys(FUNC_LABEL).length === 3, '三诉求只记三个功能位（主／辅／无）');
ok(FUNC_LABEL.primary === '主' && FUNC_LABEL.secondary === '辅' && FUNC_LABEL.none === '无', '功能位的三个值是人话，不是英文');
ok(
  Object.keys(FRAME_LABEL).join(',') === 'problem,cause,moral,remedy',
  '框架四功能按 Entman 的四项排（问题界定／归因／道德评价／对策建议）',
  Object.keys(FRAME_LABEL).join(','),
);
ok(FRAME_LABEL.remedy === '对策建议' && FRAME_LABEL.moral === '道德评价', '框架的后两项不是「解决办法」「价值观」这类改写');
ok(DEGREE_LABEL.mild === '轻度放大' && DEGREE_LABEL.heavy === '重度放大', '程度三级里两级是「放大」，不是「严重」');
ok(Object.keys(HARM_LABEL).length === 3, '定损只有三类后果', Object.keys(HARM_LABEL).join(','));
ok(
  HARM_LABEL['fabricated-support'] === '伪造支持' &&
    HARM_LABEL['concealed-counter'] === '隐瞒反证' &&
    HARM_LABEL['closed-inquiry'] === '剥夺追问',
  '三类后果与 D-03 4.6 定损一节逐字一致',
);
ok(REPLACED_LABEL.evidence === '证据' && REPLACED_LABEL.bridge === '推论桥' && REPLACED_LABEL.exception === '例外说明', '被替代的理由分三类，与 D-03 二节一致');
ok(Object.keys(KIND_LABEL).length === 6 && KIND_LABEL.story === '故事', '被替代成分含「故事」一类（它既不是品格也不是情绪）');
ok(Object.keys(SUBSTITUTE_LABEL).length === 3, '四步测试三值：替代／伴随／没跑');
ok(SUBSTITUTE_LABEL.untested === '没跑测试', '「没跑」是一个独立的结论，不是伴随');
ok(Object.keys(VERIFIABLE_LABEL).length === 3 && Object.keys(CORRECTION_LABEL).length === 3, '传播条件两格各三值');

/* ─────────── 二 · 记录核对 ─────────── */

function row(over: Partial<RhetoricRow> & { at: string }): RhetoricRow {
  return {
    ethos: 'none',
    pathos: 'primary',
    logos: 'none',
    frame: [],
    degree: 'match',
    verifiable: 'partial',
    corrections: 'unclear',
    relay: '未发现',
    test: 'substitute',
    harm: ['fabricated-support'],
    note: '',
    ...over,
  };
}

function chain(over: Partial<SubstituteChain> & { at: string }): SubstituteChain {
  return { kind: 'pathos', replaced: 'evidence', harm: 'fabricated-support', handoff: '只记缺陷位置', ...over };
}

function fake(opts: {
  mode?: Diagnosis['mode'];
  theory?: Diagnosis['theory'];
  applicable?: boolean;
  audit?: RhetoricAudit | null;
  overreach?: boolean;
}): Diagnosis {
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
    conclusion: { id: 'C', modalOverreach: opts.overreach ?? false },
    premises: [{ id: 'P1' }, { id: 'P2' }],
    intermediate: [],
    checks: [],
    verdict: { level: 'weakened', grade: null, scale: '', scaleValue: '', statement: '', qualification: '', whatIsRefuted: 'argument-only' },
    rhetoric: opts.audit ?? null,
  } as unknown as Diagnosis;
}

const kinds = (d: Diagnosis) => auditRhetoric(d).map((x) => x.kind);
const blocks = (d: Diagnosis) => auditRhetoric(d).filter((x) => x.severity === 'block').map((x) => x.kind);

const full: RhetoricAudit = {
  rows: [
    row({ at: 'P1', pathos: 'none', logos: 'primary', test: 'accompany', harm: [] }),
    row({ at: 'S4', note: '移交 D-01' }),
    row({ at: 'S6', note: '移交 D-01' }),
    row({ at: 'S5', test: 'accompany', harm: [] }),
  ],
  chains: [chain({ at: 'S4', handoff: '移交 D-01' }), chain({ at: 'S6', kind: 'frame', handoff: '移交 D-01' })],
  overlaps: 1,
};
ok(blocks(fake({ audit: full })).length === 0, '完整的审计表没有 block 级缺口', blocks(fake({ audit: full })).join(','));
ok(rhetoricExpected(fake({ audit: full })), '诊断模式该有审计表');

/* 缺链 */
const noChain: RhetoricAudit = { rows: [row({ at: 'S4' })], chains: [], overlaps: 0 };
ok(blocks(fake({ audit: noChain })).includes('chain-missing'), '判了替代成立却没有替代链 → block（表视为未完成）');

/* 链缺项 */
const badChain: RhetoricAudit = { rows: [row({ at: 'S4' })], chains: [chain({ at: 'S4', replaced: '' as never })], overlaps: 0 };
ok(blocks(fake({ audit: badChain })).includes('chain-incomplete'), '替代链缺「被顶掉的理由类型」→ block');

/* 链指向不在表里的句位 */
const strayChain: RhetoricAudit = { rows: [row({ at: 'S4' })], chains: [chain({ at: 'S9' })], overlaps: 0 };
ok(blocks(fake({ audit: strayChain })).includes('chain-without-row'), '替代链指向的句位不在表里 → block');

/* 句位编号要指得到原文（复核标准是「只凭编号重跑四步」） */
const outOfRange: RhetoricAudit = { rows: [row({ at: 'S9' })], chains: [chain({ at: 'S9' })], overlaps: 1 };
ok(kinds(fake({ audit: outOfRange })).includes('at-out-of-range'), '句位 S9 指不到原文（样本只有一句）→ warn');
const inRange: RhetoricAudit = {
  rows: [row({ at: 'S1', pathos: 'none', logos: 'primary', test: 'accompany', harm: [] })],
  chains: [],
  overlaps: 1,
};
ok(!kinds(fake({ audit: inRange })).includes('at-out-of-range'), '句位 S1 在原文里 → 不报');

/* 伴随却写后果 */
const accompanyHarm: RhetoricAudit = { rows: [row({ at: 'S5', test: 'accompany', harm: ['closed-inquiry'] })], chains: [], overlaps: 0 };
ok(blocks(fake({ audit: accompanyHarm })).includes('harm-without-substitute'), '判了伴随却写定损 → block（伴随不记缺陷）');

/* 替代却没写后果 */
const subNoHarm: RhetoricAudit = { rows: [row({ at: 'S4', harm: [] })], chains: [chain({ at: 'S4' })], overlaps: 0 };
ok(blocks(fake({ audit: subNoHarm })).includes('substitute-without-harm'), '判了替代成立却没有定损 → block');

/* 没跑测试 */
const untested: RhetoricAudit = { rows: [row({ at: 'S4', test: 'untested', harm: [] })], chains: [], overlaps: 1 };
ok(blocks(fake({ audit: untested })).includes('row-untested'), '四步测试写着「没跑」→ block（没跑不等于没问题）');

/* 单手法移交 */
const oneHandoff: RhetoricAudit = { rows: [row({ at: 'S4', note: '移交 D-01' })], chains: [chain({ at: 'S4', handoff: '移交 D-01' })], overlaps: 0 };
ok(blocks(fake({ audit: oneHandoff })).includes('handoff-single-move'), '只有一条链却写「移交 D5」→ block（单点修辞不是操纵）');

const twoHandoffs: RhetoricAudit = {
  rows: [row({ at: 'S4' }), row({ at: 'S6' })],
  chains: [chain({ at: 'S4', handoff: '移交 D-01' }), chain({ at: 'S6', kind: 'frame', handoff: '移交 D-01' })],
  overlaps: 0,
};
ok(!blocks(fake({ audit: twoHandoffs })).includes('handoff-single-move'), '两条链才写移交 → 不报单手法');

/* 重复记同一处 */
const dup: RhetoricAudit = {
  rows: [row({ at: 'S4' })],
  chains: [chain({ at: 'S4' }), chain({ at: 'S4' })],
  overlaps: 0,
};
ok(kinds(fake({ audit: dup })).includes('chain-duplicate'), '同一句位同一类成分记两条链 → warn（同一处只计一次）');

/* 空行 */
const emptyRow: RhetoricAudit = {
  rows: [row({ at: 'S2', pathos: 'none', test: 'accompany', harm: [] })],
  chains: [],
  overlaps: 1,
};
ok(kinds(fake({ audit: emptyRow })).includes('empty-row'), '八列全空的一行 → warn（它审计的对象不存在）');

/* 文风评语 */
const styleWord: RhetoricAudit = {
  rows: [row({ at: 'S4', note: '语言偏激，不够客观' })],
  chains: [chain({ at: 'S4' })],
  overlaps: 1,
};
ok(kinds(fake({ audit: styleWord })).includes('style-words'), 'note 写成文风评语 → warn（没有句位与链，不是审计）');

/* 配比分数 */
const frac: RhetoricAudit = {
  rows: [row({ at: 'S4', note: '配比 6:3:1，情绪偏重' })],
  chains: [chain({ at: 'S4' })],
  overlaps: 1,
};
ok(kinds(fake({ audit: frac })).includes('fraction'), '写配比分数 → warn（不换算分数、不设最优配比）');

/* 转发链写成因果 */
const causal: RhetoricAudit = {
  rows: [row({ at: 'S4', relay: '这条消息必然误导了大量读者' })],
  chains: [chain({ at: 'S4' })],
  overlaps: 1,
};
ok(kinds(fake({ audit: causal })).includes('relay-as-causal'), '转发链写成因果断定 → warn（那是支撑不是因果证明）');

/* 与结论强度超载去重 */
const heavyNoDeclare: RhetoricAudit = {
  rows: [row({ at: 'S4', degree: 'heavy' })],
  chains: [chain({ at: 'S4' })],
  overlaps: 0,
};
ok(
  kinds(fake({ audit: heavyNoDeclare, overreach: true })).includes('overlap-undeclared'),
  '有重度放大且报告里也有强度超载，却没说「同一缺陷」→ warn',
);
const heavyDeclared: RhetoricAudit = {
  rows: [row({ at: 'S4', degree: 'heavy', note: '同一缺陷的修辞侧面' })],
  chains: [chain({ at: 'S4' })],
  overlaps: 0,
};
ok(
  !kinds(fake({ audit: heavyDeclared, overreach: true })).includes('overlap-undeclared'),
  '写了「同一缺陷的修辞侧面」→ 不报（同一处只计一次）',
);

/* 该不该有审计表 */
ok(kinds(fake({ audit: null })).includes('no-audit'), '诊断模式没有审计表 → warn（不是 block：旧档本来就没有）');
ok(auditRhetoric(fake({ mode: 'reconstruct', audit: null })).length === 0, '重构模式没有审计表 → 不报缺口（走不到裁决层）');
ok(
  blocks(fake({ mode: 'reconstruct', audit: full })).includes('audit-on-nongrading-mode'),
  '重构模式出现审计表 → block（模式定义）',
);
ok(!rhetoricExpected(fake({ theory: 'copi' })), '名录透镜不该有审计表');
ok(!rhetoricExpected(fake({ applicable: false })), '透镜不适用时不该有审计表');

/* ─────────── 三 · 文案与边界 ─────────── */

ok(/不改档位/.test(RHETORIC_BOUNDARY), '边界句写明「不改档位」');
ok(/不改命题真假/.test(RHETORIC_BOUNDARY), '边界句写明「不改命题真假」');
ok(/谬误谬误|不等于它说的事实为假/.test(RHETORIC_BOUNDARY), '边界句把「修辞可疑≠事实为假」写出来');
ok(RHETORIC_ISOLATION === '本表未改动任何事实或规范命题状态。', '隔离声明逐字是 D-03 4.8 那一句', RHETORIC_ISOLATION);

const line = auditLine(full);
ok(/4 行/.test(line) && /替代成立 2 处/.test(line), '一句话概括带行数与替代处数', line);
ok(/移交 2 条/.test(line), '概括里带移交条数（单手法不移交，所以这个数只会 ≥2）', line);
ok(/与强度超载重合 1 处/.test(line), '概括里带上去重处数（同一缺陷只计一次）', line);

const cl = chainLine(chain({ at: 'S4', kind: 'ethos' }));
ok(/品格/.test(cl) && /S4/.test(cl) && /顶掉「证据」/.test(cl) && /伪造支持/.test(cl), '一条替代链写出成分／句位／被顶掉的理由／后果', cl);

/* ─────────── 四 · 版本判定 ─────────── */

ok(promptHasRhetoric('2.9.0'), '2.9.0 起有审计表');
ok(!promptHasRhetoric('2.8.0'), '2.8.0 没有审计表');
ok(promptHasRhetoric('2.10.0'), '2.10.0 不能被当成旧档（按数字比较，不是字符串）');
ok(promptHasRhetoric('3.0.0'), '3.0.0 有审计表');
ok(!promptHasRhetoric(undefined), '没记版本按「没有」处理');
ok(
  promptHasGrade('2.10.0') && promptHasRhetoric('2.10.0') && versionAtLeast('2.10.0', '2.9.0'),
  '版本比较是共用的一份（shared/version），判档与审计不各写一遍',
);
ok(versionAtLeast('2.9', '2.9.0'), '两段版本号与三段能比（2.9 视作 2.9.0）');

/* ─────────── 五 · 提示词 ─────────── */

ok(PROMPT_VERSION === '2.9.0', '提示词版本已递增到 2.9.0', PROMPT_VERSION);
ok(PROMPT_VERSION_NOTE[0].startsWith('2.9.0'), '版本注记第一条写的是 2.9.0');
ok(/"rhetoric"/.test(SHARED_SCHEMA), 'schema 里有 rhetoric');
ok(/"chains"/.test(SHARED_SCHEMA) && /"replaced"/.test(SHARED_SCHEMA) && /"handoff"/.test(SHARED_SCHEMA), 'schema 要求写替代链与移交位置');
ok(/substitute\|accompany\|untested/.test(SHARED_SCHEMA), 'schema 把「没跑测试」写成一个可写的值，而不是省略');

const diagUser = buildPrompt('walton', 'diagnose').userTemplate;
ok(/查替代，不查有无/.test(diagUser), '诊断模式提示词写明「查替代不查有无」');
ok(/定点/.test(diagUser) && /移除/.test(diagUser) && /判链/.test(diagUser) && /定损/.test(diagUser), '四步测试在提示词里逐条写出');
ok(/不换算分数/.test(diagUser) && /不设最优配比/.test(diagUser), '提示词禁止把配比换算成分数');
ok(/只记缺陷位置/.test(diagUser), '提示词写明单手法不移交（写「只记缺陷位置」）');
ok(/不写文风评语/.test(diagUser), '提示词禁止文风点评');

const recUser = buildPrompt('walton', 'reconstruct').userTemplate;
ok(/不走到裁决层/.test(recUser), '不评级的模式明写不做审计');
ok(!/查替代，不查有无/.test(recUser), '不评级的模式不塞四步测试（塞了会诱导它顺手判一处替代）');

/* ─────────── 六 · 接线 ─────────── */

const analyze = src('src/main/analyze.ts');
ok(/RHETORIC_STRIPPED/.test(analyze), '模式不评级／范围门把审计表置空时留痕');
ok(/auditRhetoric\(report\)/.test(analyze), '报告建好后跑一次审计核对');
ok(/RHETORIC_INCOMPLETE/.test(analyze) && /RHETORIC_NOTE/.test(analyze), 'block 与 warn 两级缺口分开记');
ok(/test: pick\(o\.test, TEST_VALUES, 'untested'/.test(analyze), '没写测试结论时缺省是「没跑」，不是「伴随」');
ok(/RHETORIC_UNKNOWN_VALUE/.test(analyze), '词表外的取值留痕，不悄悄折算');

const diag = src('src/renderer/src/components/Diagnosis.tsx');
ok(/<RhetoricCard d=\{d\} \/>/.test(diag), '报告页渲染修辞审计卡');
ok(/sec-rhetoric/.test(diag), '审计卡挂在自己的区块上（能被索引与跳转）');

const card = src('src/renderer/src/components/RhetoricCard.tsx');
ok(/auditRhetoric\(d\)/.test(card), '卡片用共享核对，不自己写一套');
ok(/data-rhetoric-row/.test(card) && /data-rhetoric-chain/.test(card), '卡片带行与链的探针，端到端能数');
ok(/RHETORIC_ISOLATION/.test(card) && /RHETORIC_BOUNDARY/.test(card), '卡片带隔离声明与边界句');
ok(!/test:\s*'substitute'/.test(card), '卡片不替模型判「替代成立」');
ok(!/logos\s*===\s*'none'/.test(card), '卡片不按三诉求自己推一处替代');

const ov = src('src/renderer/src/components/Overview.tsx');
ok(/sec-rhetoric/.test(ov), '速览索引里有这一栏（有表才给格）');

const mock = src('src/renderer/src/mock-data.ts');
ok(/rhetoric:\s*\{/.test(mock) && /chains:\s*\[/.test(mock), '预览数据带一张审计表与一条替代链');
ok(/overlaps:\s*1/.test(mock), '预览数据带一处「与强度超载重合」（只计一次的形状）');

/* ─────────── 收口 ─────────── */

if (failed.length) {
  console.error(`✗ 修辞审计检查：${failed.length} 条不通过（共 ${passed + failed.length} 条）`);
  for (const f of failed) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`✓ 修辞审计检查：${passed} 条全部通过`);
