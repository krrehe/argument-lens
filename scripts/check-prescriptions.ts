/**
 * 处方层断言。
 *
 * 这一层做的是一件很容易做错的事：告诉用户「该动哪一处」。
 * 错法都很安静——
 *   指了一条不存在的检查项：用户去找，找不到，然后不再相信这一栏；
 *   漏掉一条未答：那一处就永远没人管；
 *   判了不适用还给处方：拿不合适的尺子改文本，改出来的是迎合尺子的东西；
 *   同一处既说「补前提」又说「补担保」：两条自相矛盾的建议，等于没建议。
 *
 * 这些在界面上都看不出来——它只是一段比正文更小号的文字。
 * 所以只能在这里逐条钉死。
 *
 * 跑法：npm run check:prescriptions
 */
import { prescriptionsOf } from '@shared/prescriptions';
import type { CheckAnswer, CheckItem, Diagnosis } from '@shared/types';

let passed = 0;
const failed: string[] = [];

function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) {
    passed += 1;
  } else {
    failed.push(detail ? `${label}（${detail}）` : label);
  }
}

/* ── 样本工厂：只填处方层真正读到的字段 ── */

function check(id: string, answer: CheckAnswer, guards: string, label = id): CheckItem {
  return {
    id,
    system: 'walton-cq',
    label,
    question: `${label} 的问题`,
    meta: false,
    answer,
    basis: answer === 'passed' ? '文中写了' : '',
    guards,
    landsOn: null,
  };
}

function diag(patch: Partial<Diagnosis> = {}): Diagnosis {
  const base = {
    version: 2,
    id: 'test',
    parentId: null,
    mode: 'diagnose',
    theory: 'walton',
    createdAt: 0,
    passage: '一段话。',
    context: {
      issue: '争的是什么',
      speakerPosition: '正方',
      opposingPosition: null,
      dialogueType: 'persuasion',
      dialogueTypeBasis: '在说服',
      stage: 'argumentation',
      audience: '一般读者',
      audienceKind: 'general',
      contextGaps: [],
    },
    scope: { applicable: true, reason: '适用', outOfScopeAt: null, partialNote: null },
    conclusion: { id: 'C', role: 'conclusion', text: '结论', quote: null, span: null },
    premises: [],
    intermediate: [],
    checks: [],
    lens: { kind: 'walton', schemeId: 'correlation-causation', schemeName: '相关—因果', candidates: [] },
    defeat: { kind: 'undermining', checkId: 'CQ2', cuts: '切断 CQ2', explanation: '缺一环', tag: 'argued', confidence: 'medium' },
    verdict: {
      scale: '量表',
      scaleValue: '削弱',
      level: 'weakened',
      statement: '被削弱',
      qualification: '',
      whatIsRefuted: 'argument-only',
    },
    repair: { missingPremise: null, alternativeReading: null, answerable: [], burdenStatus: '', repairedForm: null },
    labels: [],
    legitimateMoves: [],
    refutations: [],
    selfCheck: {
      epi: { P1_source: 1, P2_context: 1, P3_position: 1, P4_withdrawal: 1, P5_selfApply: 1, P6_openness: 1, P7_steelman: 1, total: 7, vetoed: false, reading: 'overreach', notes: [] },
      ruleAudit: [],
      unknowns: [],
      opennessNote: '',
      withdrawIf: [],
      underOtherLens: '',
    },
    diagnostics: [],
    prompt: '',
  };
  return { ...base, ...patch } as unknown as Diagnosis;
}

/** 把处方层展平成一串 checkId，用于查覆盖与重复 */
function idsOf(d: Diagnosis): string[] {
  return prescriptionsOf(d)
    .groups.flatMap((g) => g.items.map((i) => i.checkId));
}

/* ── 1. 覆盖：每条未答/没过的检查项，恰好出现一次 ── */

const d1 = diag({
  checks: [
    check('CQ1', 'passed', '相关这一事实本身'),
    check('CQ2', 'unanswered', '从相关跨到因果这一步'),
    check('CQ3', 'violated', '因果解释的排他性'),
  ],
});
const rx1 = prescriptionsOf(d1);
const ids1 = idsOf(d1);
ok(rx1.total === 2, '两条未答/没过 → 两条处方', `实际 ${rx1.total}`);
ok(ids1.length === 2, '展平后的条数与 total 一致', `${ids1.length} vs ${rx1.total}`);
ok(new Set(ids1).size === ids1.length, '同一处不会既说补前提又说补担保', ids1.join(','));
ok(ids1.includes('CQ2') && ids1.includes('CQ3'), '未答与没过都在处方里', ids1.join(','));
ok(!ids1.includes('CQ1'), '过了的那条不进处方', ids1.join(','));

/* ── 2. 验收标准必须指向真实存在的检查项 ── */

const realIds = new Set(d1.checks.map((c) => c.id));
for (const g of rx1.groups) {
  for (const it of g.items) {
    ok(realIds.has(it.checkId), `处方 ${it.checkId} 指向真实检查项`);
    ok(it.accept.includes(it.checkId), `验收标准里写明了是哪一条（${it.checkId}）`, it.accept);
  }
}

/* ── 3. state 与 answer 一致 ── */

const stateOf = new Map<string, string>();
for (const g of rx1.groups) for (const it of g.items) stateOf.set(it.checkId, it.state);
ok(stateOf.get('CQ2') === 'unanswered', '未答的 state 是 unanswered');
ok(stateOf.get('CQ3') === 'violated', '没过的 state 是 violated');

/* ── 4. 确定性：同一份报告跑两次，一字不差 ── */

ok(
  JSON.stringify(prescriptionsOf(d1)) === JSON.stringify(prescriptionsOf(d1)),
  '同一份报告两次推导结果全等（纯函数）'
);

/* ── 5. 空态必须给理由 ── */

const d2 = diag({ checks: [check('CQ1', 'passed', '相关这一事实本身'), check('CQ2', 'passed', '从相关跨到因果这一步')] });
const rx2 = prescriptionsOf(d2);
ok(rx2.groups.length === 0, '全过时没有处方组');
ok(rx2.emptyReason !== null, '全过时必须说明为什么是空的');
ok((rx2.emptyReason ?? '').includes('答上'), '空态说的是「都答上了」，不是一句套话', rx2.emptyReason ?? '');

/* ── 6. 判了不适用：不列处方，且理由必须说清是不适用 ── */

const d3 = diag({
  scope: { applicable: false, reason: '这段是广告，没有以解决分歧为目标', outOfScopeAt: 'P2', partialNote: null },
  checks: [],
});
const rx3 = prescriptionsOf(d3);
ok(rx3.groups.length === 0, '不适用时一条处方都不给');
ok(rx3.total === 0, '不适用时 total 为 0');
ok((rx3.emptyReason ?? '').includes('不适用'), '空态明说是不适用', rx3.emptyReason ?? '');
ok((rx3.emptyReason ?? '').includes('广告'), '空态引用了具体的不适用理由', rx3.emptyReason ?? '');
ok(rx3.missingPremise === null, '不适用时不拿「缺的前提」顶上去');

/* ── 7. 位置归类：T- 前缀自带位置，优先于语义猜测 ── */

const d4 = diag({
  theory: 'toulmin',
  checks: [check('T-warrant', 'unanswered', '担保在场'), check('T-grounds', 'unanswered', '理由在场')],
});
const rx4 = prescriptionsOf(d4);
const siteOf = new Map<string, string>();
for (const g of rx4.groups) for (const it of g.items) siteOf.set(it.checkId, g.site);
ok(siteOf.get('T-warrant') === 'bridge', 'T-warrant 归到桥', String(siteOf.get('T-warrant')));
ok(siteOf.get('T-grounds') === 'ground', 'T-grounds 归到依据', String(siteOf.get('T-grounds')));

/* ── 8. 缺的前提单列，且不被重复计入处方条数 ── */

const d5 = diag({
  checks: [check('CQ1', 'unanswered', '相关这一事实本身')],
  repair: { missingPremise: '早读与其他学习安排之间没有替代关系', alternativeReading: null, answerable: [], burdenStatus: '', repairedForm: null },
});
const rx5 = prescriptionsOf(d5);
ok(rx5.missingPremise !== null, '有缺的前提时单列出来');
ok(rx5.missingPremise?.text === '早读与其他学习安排之间没有替代关系', '单列的是原文那句，不加工');
ok(rx5.total === 1, '缺的前提不重复计入检查项条数', `实际 ${rx5.total}`);

/* ── 9. 不许出现「一定能救回来」这类断言 ── */

/*
 * 处方能说的最多是「这一环现在是空的」。它没有资格保证补上就成立——
 * 前提本身可能是假的，补了支撑也没用。这一条用词表拦住，虽然粗糙，
 * 但比让它慢慢漂回「只要补上这句就没问题了」要好。
 */
const allText = JSON.stringify(prescriptionsOf(d1)) + JSON.stringify(prescriptionsOf(d5));
for (const banned of ['一定能', '必然成立', '保证通过', '就可以证明', '无需担心']) {
  ok(!allText.includes(banned), `处方里不出现「${banned}」`);
}
ok(allText.includes('未答'), '处方里如实使用「未答」这个状态词');

/* ── 10. 描述类模式：不把「结构缺块」说成「不好」 ── */

const d6 = diag({
  mode: 'reconstruct',
  verdict: { scale: '量表', scaleValue: '未定', level: 'undetermined', statement: '只画结构', qualification: '', whatIsRefuted: 'nothing' },
  checks: [check('CQ1', 'unanswered', '相关这一事实本身')],
});
const costText = prescriptionsOf(d6).groups[0]?.items[0]?.cost ?? '';
ok(costText.includes('不给档位') || costText.includes('不构成'), '描述类模式的代价不说成「论证有问题」', costText);
ok(!costText.includes('论证的这一步仍然空着。结论不必因此放弃'), '描述类模式不套用判定类的代价文案', costText);

/* 断言总数兜底：少跑就是静默跳过 */
ok(passed >= 30, '断言总数不少于 30 项', `实际 ${passed}`);

if (failed.length) {
  console.error(`\n✗ 处方层检查失败 ${failed.length} 项（通过 ${passed} 项）`);
  for (const f of failed) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ 处方层检查通过 ${passed} 项`);
