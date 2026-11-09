/**
 * 「骨架缺口」的断言：本地第一次对报告本身说「这里接不上」。
 *
 * 这一层输出的是**判定**，不是描述——每个字都会被当成「软件指出来的问题」读。
 * 它没有抛异常的失败方式，全是「说了句看起来对的话」：
 *   1. 把 `unanswered` 说成「模型没答」。它在提示词里的意思是「文中无从判断」，
 *      是模型对文本的判断（这一环原文没交代），不是漏答——说错就把一份指认说成一份疏漏。
 *   2. 把「明说不适用」混进「已答」或「没答」（三个意思，数字一样时看不出来）
 *   3. 把「0 条」写成一句话（没有检查表 ≠ 检查表答了 0 条）
 *   4. 缺口清零时说「没问题」（那是本地做不到的事）
 *   5. 两种来源（本地算的 / 报告自己说的）混成一类
 *
 * 防恒真写在样本里：
 *   - 「不适用 ≠ 有答案」配一份全 not-applicable 的样本
 *   - 「不拿 0 条凑」配一份没有原文、没有检查表的样本
 *   - 「顺序」配一份同时有环和漏读的样本（环必须在前），而不是只有一种缺口
 *
 * 跑法：npm run check:skeleton
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeDiagnosis } from '../src/main/analyze';
import type { CheckItem, Claim, Conclusion, Diagnosis, Scope, Span } from '@shared/types';
import { GAP_FROM_LABEL, GAP_ORDER, STEP_MARKERS, findCycles, skeletonOf } from '@shared/skeleton';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}

/* ─────────── 样本 ─────────── */

const ACC = { status: 'acceptable' as const, reason: '' };

const spanAt = (passage: string, q: string): Span => {
  const start = passage.indexOf(q);
  if (start < 0) throw new Error(`样本自己错了：「${q}」不在原文里`);
  return { start, end: start + q.length, quote: q, quality: 'exact' };
};

const claim = (id: string, role: Claim['role'], text: string, supports: string[], span: Span | null): Claim => ({
  id,
  role,
  text,
  supports,
  quote: span ? span.quote : null,
  span,
  implicit: false,
  implicitBasis: null,
  burden: 'proponent',
  acceptability: ACC,
});

const concl = (text: string, span: Span | null): Conclusion => ({
  ...claim('C', 'conclusion', text, [], span),
  modalOverreach: false,
  modalNote: '',
});

const item = (id: string, answer: CheckItem['answer']): CheckItem => ({
  id,
  system: 'walton-cq',
  label: `第 ${id} 条`,
  question: '这一关问什么',
  meta: false,
  answer,
  basis: '依据',
  guards: '守着某处',
  landsOn: null,
});

const IN_SCOPE: Scope = { applicable: true, reason: '是论证', outOfScopeAt: null, partialNote: null };

/** 四句原文，前两句各有主张钉上去，后两句没人碰。检查表 3 条：1 通过、1 文中没交代、1 不适用。 */
const P4 = '甲句一。乙句二。丙句三。丁句四。';
const QUIET2: Diagnosis = {
  ...normalizeDiagnosis({}, P4, 'walton', { mode: 'diagnose', id: 'q2', createdAt: 1000 }),
  scope: IN_SCOPE,
  premises: [claim('P1', 'premise', '甲句一', ['C'], spanAt(P4, '甲句一。')), claim('P2', 'premise', '乙句二', ['C'], spanAt(P4, '乙句二。'))],
  conclusion: concl('所以这段话说得通', null),
  checks: [item('CQ1', 'passed'), item('CQ2', 'unanswered'), item('CQ3', 'not-applicable')],
};

/** 每句都有人碰、检查表全部通过、无环、有前提 —— 缺口应当清零。 */
const P3 = '甲句一。乙句二。丙句三。';
const CLEAN: Diagnosis = {
  ...normalizeDiagnosis({}, P3, 'walton', { mode: 'diagnose', id: 'cl', createdAt: 1000 }),
  scope: IN_SCOPE,
  premises: [claim('P1', 'premise', '甲句一', ['C'], spanAt(P3, '甲句一。')), claim('P2', 'premise', '乙句二', ['C'], spanAt(P3, '乙句二。'))],
  conclusion: concl('丙句三', spanAt(P3, '丙句三。')),
  checks: [item('CQ1', 'passed'), item('CQ2', 'passed'), item('CQ3', 'passed')],
};

/** 六条检查项：2 通过、1 违反、2 文中没交代、1 不适用。四档齐全。 */
const FOUR_WAYS: Diagnosis = {
  ...CLEAN,
  id: 'fw',
  checks: [
    item('CQ1', 'passed'),
    item('CQ2', 'passed'),
    item('CQ3', 'violated'),
    item('CQ4', 'unanswered'),
    item('CQ5', 'unanswered'),
    item('CQ6', 'not-applicable'),
  ],
};

/** 六条里两条「文中没交代」：这是 Hollow 那一档的正样本。 */
/** 全部「文中没交代」：说成「每一条都说这一环没交代」。 */
const ALL_HOLLOW: Diagnosis = {
  ...CLEAN,
  id: 'ah',
  checks: [item('CQ1', 'unanswered'), item('CQ2', 'unanswered')],
};

/** 全部「明说不适用」：这不是「有答案」。 */
const ALL_NA: Diagnosis = {
  ...CLEAN,
  id: 'na',
  checks: [item('CQ1', 'not-applicable'), item('CQ2', 'not-applicable')],
};

/** 透镜自己说不适用：检查表按约定为空。 */
const OFF: Diagnosis = {
  ...CLEAN,
  id: 'off',
  scope: { applicable: false, reason: '这不是在解决分歧，是在做广告', outOfScopeAt: '「限时三折」', partialNote: null },
  checks: [],
};

/**
 * 说不适用，却还是把检查表填上了。
 *
 * 上面那份 OFF 的检查表是空的，什么数都是 0，
 * 于是「scope-conflict 才报、不报 hollow」这条断言在实现被改坏时也会绿（第 37 轮的坑）。
 */
const OFF_TABLE: Diagnosis = {
  ...CLEAN,
  id: 'offt',
  scope: { applicable: false, reason: '这不是在解决分歧，是在做广告', outOfScopeAt: '「限时三折」', partialNote: null },
  checks: [item('CQ1', 'passed'), item('CQ2', 'unanswered'), item('CQ3', 'unanswered')],
};

/** 循环支撑：P1 → P2 → P1。 */
const CYCLE: Diagnosis = {
  ...CLEAN,
  id: 'cy',
  premises: [
    claim('P1', 'premise', '甲句一', ['P2'], spanAt(P3, '甲句一。')),
    claim('P2', 'premise', '乙句二', ['P1'], spanAt(P3, '乙句二。')),
  ],
};

/** 一条前提都没列。 */
const NO_PREM: Diagnosis = {
  ...CLEAN,
  id: 'np',
  premises: [],
  conclusion: concl('丙句三', spanAt(P3, '丙句三。')),
};

/** 同时有环和漏读：用来守缺口顺序（环必须排在漏读前面）。 */
const CYCLE_AND_QUIET: Diagnosis = {
  ...QUIET2,
  id: 'cq',
  premises: [
    claim('P1', 'premise', '甲句一', ['P2'], spanAt(P4, '甲句一。')),
    claim('P2', 'premise', '乙句二', ['P1'], spanAt(P4, '乙句二。')),
  ],
};

/** 不适用 + 没前提 + 漏读：三个缺口同时出现，「不适用排最前」才不是废话。 */
const OFF_MULTI: Diagnosis = {
  ...QUIET2,
  id: 'offm',
  scope: { applicable: false, reason: '这段不是在论证', outOfScopeAt: null, partialNote: null },
  premises: [],
  checks: [],
};

/** 既没有原文，也没有检查表。 */
const EMPTY: Diagnosis = {
  ...CLEAN,
  id: 'empty',
  passage: '',
  premises: [],
  conclusion: concl('', null),
  checks: [],
  scope: IN_SCOPE,
};

const gapKinds = (d: Diagnosis): string[] => skeletonOf(d).gaps.map((g) => g.kind);
const gapOf = (d: Diagnosis, kind: string) => skeletonOf(d).gaps.find((g) => g.kind === kind);

/* ─────────── 环 ─────────── */

const claimsOf = (d: Diagnosis): Claim[] => [d.conclusion, ...d.premises, ...d.intermediate];

ok(findCycles(claimsOf(CLEAN)).length === 0, '无环的图返回空', JSON.stringify(findCycles(claimsOf(CLEAN))));

const cyc = findCycles(claimsOf(CYCLE));
ok(cyc.length === 1, '两个前提互指 → 一个环', JSON.stringify(cyc));
ok(cyc[0] && cyc[0].join(' → ') === 'P1 → P2 → P1', '环写成一个闭合路径，首尾同 id', JSON.stringify(cyc[0]));

const self: Claim[] = [claim('A', 'premise', 'a', ['A'], null)];
const selfCyc = findCycles(self);
ok(selfCyc.length === 1 && selfCyc[0].join(' → ') === 'A → A', '自指也算环', JSON.stringify(selfCyc));

const two: Claim[] = [
  claim('A', 'premise', 'a', ['B'], null),
  claim('B', 'premise', 'b', ['A'], null),
  claim('X', 'intermediate', 'x', ['Y'], null),
  claim('Y', 'intermediate', 'y', ['X'], null),
];
ok(findCycles(two).length === 2, '两个互不相干的环要都报出来', JSON.stringify(findCycles(two)));

const diamond: Claim[] = [
  claim('A', 'premise', 'a', ['B'], null),
  claim('B', 'premise', 'b', ['C'], null),
  claim('P2', 'premise', 'p2', ['C'], null),
  concl('c', null),
];
ok(findCycles(diamond).length === 0, '菱形（A→B→C 与 P2→C）不是环', JSON.stringify(findCycles(diamond)));

ok(
  JSON.stringify(findCycles(claimsOf(CYCLE))) === JSON.stringify(findCycles(claimsOf(CYCLE))),
  '同一份报告跑两次，环的写法必须一样'
);

/* ─────────── 漏读 ─────────── */

const q2 = skeletonOf(QUIET2);
ok(q2.count.sentences === 4, '原文切成 4 句', String(q2.count.sentences));
ok(q2.count.quiet === 2, '后两句没人碰 → 2 句', String(q2.count.quiet));
ok(
  gapOf(QUIET2, 'quiet-sentences')?.note === '原文 4 句，有 2 句没有任何一条主张、命名或「此处合法」落到上面。',
  '漏读那句逐字对得上',
  gapOf(QUIET2, 'quiet-sentences')?.note ?? '（没有这一条缺口）'
);
ok(gapOf(QUIET2, 'quiet-sentences')?.at.join('|') === '丙句三。|丁句四。', '把没碰的句子列出来，不是只给个数字', JSON.stringify(gapOf(QUIET2, 'quiet-sentences')?.at));
ok(gapOf(QUIET2, 'quiet-sentences')?.from === 'local', '漏读是本地数的', String(gapOf(QUIET2, 'quiet-sentences')?.from));

/* 句子多的时候只列前三句：不是「全都列」也不是「一个不列」。 */
const P6 = '一句。二句。三句。四句。五句。';
const five: Diagnosis = {
  ...normalizeDiagnosis({}, P6, 'walton', { mode: 'diagnose', id: 'f5', createdAt: 1000 }),
  scope: IN_SCOPE,
  premises: [claim('P1', 'premise', '一句', ['C'], spanAt(P6, '一句。'))],
  conclusion: concl('一句话', null),
  checks: [item('CQ1', 'passed')],
};
const f5 = skeletonOf(five);
ok(f5.count.sentences === 5 && f5.count.quiet === 4, '5 句碰 1 句 → 漏 4 句', JSON.stringify(f5.count));
ok(gapOf(five, 'quiet-sentences')?.at.length === 3, '列前 3 句就够了，不刷一屏', JSON.stringify(gapOf(five, 'quiet-sentences')?.at));

ok(!gapKinds(CLEAN).includes('quiet-sentences'), '每句都有人碰 → 不报漏读', JSON.stringify(gapKinds(CLEAN)));

/* ─────────── 检查表四档 ─────────── */

const fw = skeletonOf(FOUR_WAYS);
ok(fw.count.checks === 6, '检查表 6 条', String(fw.count.checks));
ok(fw.count.passed === 2, '通过 2 条', JSON.stringify(fw.count));
ok(fw.count.violated === 1, '指出违反 1 条', String(fw.count.violated));
ok(fw.count.hollow === 2, '文中没交代 2 条', String(fw.count.hollow));
ok(fw.count.notApplicable === 1, '明说不适用 1 条', String(fw.count.notApplicable));

const hw = gapOf(FOUR_WAYS, 'hollow-checks');
ok(
  hw?.note === '检查表 6 条里，2 条报告说「文中没交代这一环」——这是它在指认这几处是空的，不是漏答。',
  '「文中没交代」那句逐字对得上',
  hw?.note ?? '（没有这一条缺口）'
);
ok(hw?.from === 'report', '这一条是报告自己说的，不是本地数的', String(hw?.from));
ok(hw?.at.join('|') === '第 CQ4 条|第 CQ5 条', 'label 里已有编号时不再拼一次 id', JSON.stringify(hw?.at));

/*
 * 这一轮最重要的断言：整块不许再把「文中没交代」写成「没答」。
 * 那个词把模型的判断说成模型的疏漏，而界面上同一栏还写着「不是漏答」——
 * 两处说法打架时，用户不知道该信哪个。
 */
ok(!(hw?.note ?? '').includes('没答'), 'hollow 那条不许说「没答」', hw?.note ?? '');
ok(!fw.line.includes('没答'), '总述里不许出现「没答」', fw.line);
ok(!fw.facts.some((f) => f.value.includes('没答')), '事实行里不许出现「没答」', JSON.stringify(fw.facts));
ok(!q2.line.includes('没答') && !q2.line.includes('未答'), '单条 hollow 时也不许说「没答 / 未答」', q2.line);

ok(
  fw.facts.find((f) => f.label === '检查表')?.value === '6 条：通过 2、违反 1、文中没交代 2、不适用 1',
  '四档并列写在同一行，不合并',
  JSON.stringify(fw.facts.find((f) => f.label === '检查表'))
);
ok(!fw.facts.some((f) => f.label === '原文句子'), '事实行不重复总述里已经说过的句数', JSON.stringify(fw.facts));

/** label 里没有编号：这时才把 id 补上，否则读者不知道指的是哪一条。 */
const BARE_LABEL: Diagnosis = {
  ...FOUR_WAYS,
  id: 'bl',
  checks: [{ ...item('CQ7', 'unanswered'), label: '共识前提存不存在' }],
};
ok(
  gapOf(BARE_LABEL, 'hollow-checks')?.at[0] === 'CQ7 共识前提存不存在',
  'label 里没有编号时补上编号',
  JSON.stringify(gapOf(BARE_LABEL, 'hollow-checks')?.at)
);

/* 全部「文中没交代」：说法要变，不能还写「N 条里 M 条」。 */
ok(
  gapOf(ALL_HOLLOW, 'hollow-checks')?.note ===
    '检查表 2 条，每一条报告都说「文中没交代这一环」——整条推理的担保一环都没落地。',
  '全部没交代时换一种说法',
  gapOf(ALL_HOLLOW, 'hollow-checks')?.note ?? '（没有这一条缺口）'
);

/* 「明说不适用」既不是「有答案」，也不是「文中没交代」。 */
const na = skeletonOf(ALL_NA);
ok(na.count.notApplicable === 2, '不适用 2 条照样数出来', String(na.count.notApplicable));
ok(na.count.hollow === 0, '全是不适用时，文中没交代必须是 0', JSON.stringify(na.count));
ok(!gapKinds(ALL_NA).includes('hollow-checks'), '全是不适用 → 不许报「文中没交代」', JSON.stringify(gapKinds(ALL_NA)));
ok(na.line === '原文 3 句，0 句没碰；检查表 2 条，全部标为不适用。', '全部不适用时总述不把它算成答案', na.line);

/* ─────────── 范围门 ─────────── */

const off = skeletonOf(OFF);
ok(off.gaps[0]?.kind === 'off-scope', '不适用排在最前面', JSON.stringify(gapKinds(OFF)));
ok(off.gaps[0]?.from === 'report', '不适用是报告自己说的', String(off.gaps[0]?.from));
ok(off.gaps[0]?.note.includes('这不是在解决分歧，是在做广告'), '把透镜自己写的理由原样带出来');
ok(off.gaps[0]?.at[0] === '「限时三折」', '把「在哪不适用」也带出来');
ok(!gapKinds(OFF).includes('hollow-checks'), '空检查表不报「文中没交代」', JSON.stringify(gapKinds(OFF)));

/* 说不适用却填了检查表：这是自相矛盾。 */
const oft = skeletonOf(OFF_TABLE);
ok(gapKinds(OFF_TABLE).includes('scope-conflict'), '说不适用却填了检查表 → 报自相矛盾', JSON.stringify(gapKinds(OFF_TABLE)));
ok(!gapKinds(OFF_TABLE).includes('hollow-checks'), '透镜不适用时，不把填了的检查表算成「文中没交代」', JSON.stringify(gapKinds(OFF_TABLE)));
ok(
  gapOf(OFF_TABLE, 'scope-conflict')?.note === '透镜说不适用于这段文字，检查表却填了 3 条——这两件事不能同时成立。',
  '自相矛盾那句逐字对得上',
  gapOf(OFF_TABLE, 'scope-conflict')?.note ?? '（没有这一条缺口）'
);
ok(gapOf(OFF_TABLE, 'scope-conflict')?.from === 'local', '自相矛盾是本地发现的', String(gapOf(OFF_TABLE, 'scope-conflict')?.from));
ok(gapOf(OFF_TABLE, 'scope-conflict')?.at.length === 3, '把填了的那几条列出来', JSON.stringify(gapOf(OFF_TABLE, 'scope-conflict')?.at));
ok(!gapKinds(OFF).includes('scope-conflict'), '检查表是空的时候不报自相矛盾', JSON.stringify(gapKinds(OFF)));

/* ─────────── 没列前提 ─────────── */

ok(gapKinds(NO_PREM).includes('no-premises'), '一条前提都没列 → 要报', JSON.stringify(gapKinds(NO_PREM)));
ok(gapOf(NO_PREM, 'no-premises')?.from === 'local', '没前提是本地数的', String(gapOf(NO_PREM, 'no-premises')?.from));
ok(!gapKinds(CLEAN).includes('no-premises'), '列了前提 → 不报', JSON.stringify(gapKinds(CLEAN)));

/* ─────────── 缺口顺序 ─────────── */

const order = gapKinds(CYCLE_AND_QUIET);
ok(order.includes('cycle') && order.includes('quiet-sentences'), '样本本身要同时有两个缺口', JSON.stringify(order));
ok(order.indexOf('cycle') < order.indexOf('quiet-sentences'), '结构塌陷排在漏读前面', JSON.stringify(order));
ok(
  GAP_ORDER.join(',') === 'off-scope,scope-conflict,no-premises,cycle,quiet-sentences,hollow-checks',
  '缺口顺序表本身没被改乱',
  GAP_ORDER.join(',')
);
ok(
  gapKinds(OFF_MULTI).join(',') === 'off-scope,no-premises,quiet-sentences',
  '不适用排在另外两个缺口前面（样本里确实有另外两个）',
  JSON.stringify(gapKinds(OFF_MULTI))
);

/* ─────────── 来源标签 ─────────── */

ok(GAP_FROM_LABEL.local === '本地数的', '本地那一侧的标签没写错', GAP_FROM_LABEL.local);
ok(GAP_FROM_LABEL.report === '报告自己说的', '报告那一侧的标签没写错', GAP_FROM_LABEL.report);

/* ─────────── 清零时不许说「没问题」 ─────────── */

const cl = skeletonOf(CLEAN);
ok(cl.gaps.length === 0, '全齐的样本不应有缺口', JSON.stringify(cl.gaps));
ok(
  cl.clearNote ===
    '按这几项查，没找到缺口：每句原文都有条目落上去、支撑关系不成环、前提列了、检查表里没有报告说「文中没交代」的条目。这只说明骨架接上了，不代表判断对——判断对不对，本地核不了。',
  '缺口清零时逐字说清「只是骨架接上了」',
  cl.clearNote ?? '（null）'
);
ok(cl.clearNote !== null && cl.clearNote.indexOf('没问题') < 0, '不许写「没问题」');
ok(cl.gaps.length > 0 ? cl.clearNote === null : true, '有缺口时不给清零说法', String(cl.clearNote));

/*
 * 全部标「不适用」时也会走到清零，但那不是「检查表都答了」。
 * 第一版 clearNote 把四项写死，在 CLEAN（全通过）上一点看不出问题，
 * 换一份全不适用的报告就成了假话。措辞不实比排版错难发现，所以要单独一份样本。
 */
const naClear = skeletonOf(ALL_NA).clearNote ?? '';
ok(naClear.indexOf('检查表都答了') < 0, '全部标为不适用时，清零说明不许说「检查表都答了」', naClear);
ok(naClear.indexOf('没有报告说「文中没交代」') >= 0, '全部标为不适用时，清零说明照实说这一档是空的', naClear);

/* ─────────── 总述 ─────────── */

ok(cl.line === '原文 3 句，0 句没碰；检查表 3 条：通过 3、违反 0。', '总述逐字对得上', cl.line);
ok(q2.line === '原文 4 句，2 句没碰；检查表 3 条，其中 1 条报告说「文中没交代」。', '有缺口时总述也照数', q2.line);

/* 没有检查表时，不许写「检查表 0 条」。 */
const noChecks: Diagnosis = { ...CLEAN, id: 'nc', checks: [] };
const nc = skeletonOf(noChecks);
ok(nc.line === '原文 3 句，0 句没碰。', '没有检查表就不提检查表', nc.line);
ok(nc.line.indexOf('检查表') < 0, '「0 条」不是一句话', nc.line);

/* 什么都没有时，说清没有可核的东西，而不是一堆 0。 */
const em = skeletonOf(EMPTY);
ok(em.line === '这份报告里既没有原文句子，也没有检查表——本地没有可核的东西。', '空报告要说清没得核', em.line);
ok(em.line.indexOf('0 条') < 0, '空报告的总述里不许冒出 0', em.line);

/* ─────────── 并列事实 ─────────── */

const PMARK = '一，因为二，所以三，因此四。';
const marked: Diagnosis = {
  ...normalizeDiagnosis({}, PMARK, 'walton', { mode: 'diagnose', id: 'mk', createdAt: 1000 }),
  scope: IN_SCOPE,
  premises: [claim('P1', 'premise', '一', ['C'], spanAt(PMARK, '一，因为二，所以三，因此四。'))],
  conclusion: concl('一', null),
  checks: [item('CQ1', 'passed')],
};
const mk = skeletonOf(marked);
ok(mk.count.marks === 2, '「因为」不算推理连接词，「所以 / 因此」算 2 处', String(mk.count.marks));
const markFact = mk.facts.find((f) => f.label === '原文推理连接词');
ok(markFact?.value === '2 处（与连线数不一一对应）', '连接词那一行必须带上「不一一对应」', JSON.stringify(markFact));
ok(mk.gaps.length === 0, '连接词只进并列事实、不生成缺口：这一份没有缺口', JSON.stringify(mk.gaps));
ok(mk.count.edges === 1, '连线数来自 supports，不是从连接词推的', String(mk.count.edges));
ok(STEP_MARKERS.includes('所以') && !(STEP_MARKERS as readonly string[]).includes('因为'), '词表里没有「因为」——它标原因，不标推理步');

/* ─────────── 不崩 ─────────── */

let threw = '';
try {
  skeletonOf(normalizeDiagnosis({}, '', 'walton', { mode: 'diagnose', id: 'z', createdAt: 0 }));
} catch (e) {
  threw = String(e);
}
ok(threw === '', '一份全空的报告不许抛异常', threw);

let threw2 = '';
try {
  const junk = { ...CLEAN, checks: undefined as unknown as CheckItem[], premises: undefined as unknown as Claim[] };
  skeletonOf(junk);
} catch (e) {
  threw2 = String(e);
}
ok(threw2 === '', '字段整个缺失时也不许崩', threw2);

/* ─────────── 只读 ─────────── */

const FRESH: Diagnosis = JSON.parse(JSON.stringify(FOUR_WAYS));
const before = JSON.stringify(FRESH);
skeletonOf(FRESH);
ok(JSON.stringify(FRESH) === before, '核一遍不改报告里的任何一个字段');

/* ─────────── 界面必须跟上这一层 ─────────── */

/*
 * 纯函数层把 `unanswered` 的语义改对了（「文中无从判断」，不是模型漏答），
 * 但界面上那句说明是**另一份文本**：它写错时上面 73 条照常全绿。
 * `GapFrom` 也一样——导出了、标签文字有断言守着，界面不渲染，
 * 用户就分不出哪些是本地新产出的判定、哪些只是报告里本来写着的话。
 * 守调用点，不守「名字在文件里出现过」（第 40 轮的坑）。
 */
const CARD = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/Diagnosis.tsx'), 'utf8');
const cardStart = CARD.indexOf('function SkeletonCard(');
const cardEnd = CARD.indexOf('function ToneCard(', cardStart);
const CARD_BODY = cardStart >= 0 && cardEnd > cardStart ? CARD.slice(cardStart, cardEnd) : '';

ok(CARD_BODY.length > 0, '找得到 SkeletonCard 这一块');
ok(!/没答|未答/.test(CARD_BODY), '界面说明里不许把「文中没交代」写成「没答」');
ok(/GAP_FROM_LABEL\[g\.from\]/.test(CARD_BODY), '界面必须真的渲染每条缺口的来源');
ok(/data-skeleton-from=\{g\.from\}/.test(CARD_BODY), 'DOM 上也要带上来源，端到端才核得到');
ok(/data-skeleton-line=\{sk\.gaps\.length\}/.test(CARD_BODY), '总述那一行的探针还在');

/* ─────────── 输出 ─────────── */

const total = passed + failed.length;
if (failed.length) {
  console.log(`\n骨架缺口：${passed}/${total} 通过，${failed.length} 条失败\n`);
  for (const f of failed) console.log(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`\n骨架缺口：${total} 条全部通过\n`);
}
