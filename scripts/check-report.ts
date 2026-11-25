/**
 * 报告自检的两件事。
 *
 * 一、检查器本身有效吗。
 *     每条不变量都得能被一份**故意造坏**的报告触发；一份正常的报告必须零报警。
 *     后半句比前半句重要：一个对好报告也喊狼来了的检查器，用两周就会被无视，
 *     然后它抓到的真问题也跟着一起被无视。
 *
 * 二、手上这些真实报告现在是什么状态。
 *     这一部分只打印，不断言。旧报告是用当时的代码生成的，
 *     破了说明当时的代码有问题——那是历史，不是本次构建的错。
 *     但数字要看得见：如果新报告也在破，那就得回来查。
 *
 * 跑法：npm run check:report
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditReport } from '@shared/report-audit';
import { collectDeepFindings } from '@shared/deep-archive';
import { crossLensOf } from '@shared/cross-lens';
import type { AgreementItem } from '@shared/agreement';
import { PROMPT_BASELINE } from '@shared/prompt-history';
import { selfAuditOf } from '@shared/self-audit';
import type { Diagnosis } from '@shared/types';
import { checkItem, claim, diag, deepFinding, labelItem, refutation } from './fixture-report';

let passed = 0;
const failed: string[] = [];

function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}

/** 断言不变量里出现了某段字样。抓的是「规则有没有响」，不是措辞。 */
function has(d: Diagnosis, needle: string): boolean {
  return auditReport(d).invariants.some((x) => x.includes(needle));
}

/** 断言缺口里出现了某段字样。 */
function hasGap(d: Diagnosis, needle: string): boolean {
  return auditReport(d).gaps.some((x) => x.includes(needle));
}

const NOTHING_REFUTED = { scale: '量表', scaleValue: '', level: 'weakened' as const, statement: '', qualification: '', whatIsRefuted: 'argument-only' as const };
const PLACEHOLDER = '无结论可规范化：文本未提出任何可检验的主张';

/* ── 一 · 好报告必须零报警 ── */

const good = diag({
  premises: [claim('P1', 'premise', '取消早读之后一本率下降', 40)],
  checks: [checkItem('CQ1', 'passed', '相关这一事实本身'), checkItem('CQ2', 'unanswered', '从相关跨到因果这一步')],
  refutations: [refutation('R1', 'P1')],
});
{
  const a = auditReport(good);
  ok(a.invariants.length === 0, '结构完好的报告零报警', a.invariants.join(' / '));
  ok(a.gaps.length === 0, '结构完好的报告零缺口', a.gaps.join(' / '));
}

/* ── 二 · 每条不变量都能被触发 ── */

ok(has(diag({ conclusion: { ...good.conclusion, text: '  ' } }), '结论为空'), '结论为空 → 报');

ok(
  has(
    diag({
      premises: [claim('P1', 'premise', '一句话', 40)],
      defeat: { kind: 'undermining', checkId: 'CQ2', cuts: '切断 P9 与 C', explanation: '', tag: 'argued', confidence: 'medium' },
    }),
    '不存在的主张编号 P9'
  ),
  '正文引用不存在的 P9 → 报'
);

ok(
  has(diag({ premises: [claim('P1', 'premise', '同一句', 40), claim('P2', 'premise', '同一句', 40)] }), '重复占位'),
  '两条前提指向同一句 → 报'
);

ok(
  has(diag({ checks: [{ ...checkItem('CQ1', 'passed', '相关', 'CQ1 相关性'), basis: '' }] }), '却没有依据'),
  '给了 passed 却没依据 → 报'
);

ok(
  has(
    diag({
      scope: { applicable: false, reason: '这段是广告', outOfScopeAt: null, partialNote: null },
      checks: [checkItem('CQ1', 'passed', '相关')],
    }),
    '判了不适用却仍有检查项'
  ),
  '判不适用却还有检查项 → 报'
);

ok(
  has(
    diag({
      scope: { applicable: false, reason: '不适用', outOfScopeAt: null, partialNote: null },
      verdict: NOTHING_REFUTED,
    }),
    '判了不适用却给了档位'
  ),
  '判不适用却给了档位 → 报'
);

ok(has(diag({ mode: 'reconstruct', verdict: NOTHING_REFUTED }), '模式给了档位'), '描述类模式给了档位 → 报');

/*
 * 命名门控与档位门控是两件事。
 *
 * 这两条一起验，因为它们在代码里挨着，而搞混的后果方向相反：
 * 漏掉前一条 → 重构报告带着一堆名字，变成伪装成结构图的判决书；
 * 漏掉后一条 → 查谬误报告的主输出被当成矛盾，每次都被报成「自相矛盾」，
 * 于是这条检查教会用户忽略报警。
 */
const NO_VERDICT = { ...NOTHING_REFUTED, level: 'undetermined' as const, whatIsRefuted: 'nothing' as const };
/*
 * 谬误模式的底样：不打倒任何一条、不指认落点。
 *
 * defeat 必须一起换成 none：默认样本的 cuts 写着「切断 P1 与 C」，
 * 而这份样本没有 P1——那条悬空引用会先开一枪，把要测的东西盖住。
 */
const FALLACY_BASE = {
  mode: 'fallacy' as const,
  verdict: NO_VERDICT,
  defeat: { kind: 'none' as const, checkId: null, cuts: '', explanation: '', tag: 'inferred' as const, confidence: 'undetermined' as const },
};
{
  const a = auditReport(diag({ ...FALLACY_BASE, labels: [labelItem()] }));
  ok(a.invariants.length === 0, '谬误模式下带位置的命名不算矛盾', a.invariants.join(' / '));
}
ok(
  has(diag({ ...FALLACY_BASE, labels: [labelItem({ quote: null, span: null })] }), 'G11 未生效'),
  '谬误模式的命名没有原文位置 → 报'
);
ok(
  has(diag({ mode: 'reconstruct', verdict: NO_VERDICT, labels: [labelItem()] }), '命名候选'),
  '不命名的模式却带着命名 → 报'
);

ok(has(diag({ refutations: [refutation('R1', 'P7')] }), '指向不存在的 P7'), '反驳指向不存在的主张 → 报');

/* ── 深查账本：只核形状，不判发现真假 ── */
ok(
  !has(diag({ mode: 'deep', deep: { findings: [deepFinding()], unlocated: [] } }), '深查'),
  '深查：账本齐全时不报'
);
ok(
  has(
    diag({
      mode: 'deep',
      deep: { findings: [deepFinding({ challenge: '', status: 'confirmed' })], unlocated: [] },
    }),
    '最强反驳'
  ),
  '深查：标了站住却没写最强反驳 → 报'
);
ok(
  hasGap(
    diag({
      mode: 'deep',
      deep: { findings: [deepFinding({ targetOk: false, quoteOk: false })], unlocated: [] },
    }),
    '没有能回到原文'
  ),
  '深查：落点与引文都指不到 → 记缺口'
);
ok(
  hasGap(
    diag({ mode: 'deep', deep: { findings: [deepFinding({ theoryOk: false })], unlocated: [] } }),
    '理论依据'
  ),
  '深查：理论依据对不上 → 记缺口'
);
ok(
  has(
    diag({
      mode: 'deep',
      deep: { findings: [deepFinding(), deepFinding()], unlocated: [] },
    }),
    'id 重复'
  ),
  '深查：id 重复 → 报'
);
ok(
  hasGap(diag({ mode: 'deep', deep: { findings: [], unlocated: [] } }), '没有产出'),
  '深查：空账本 → 记缺口'
);

/*
 * 反驳与「此处合法」的落点可以是一条检查项，不只是主张。
 * 真实评测里 T-warrant / CQ5 这类检查项被模型当成落点，界面用
 * `locationLabel` 与论证地图都能解析到；审计若只认主张，就会把
 * 真实存在的检查项报成悬空引用——这正是「假警报训练人忽略报警」。
 */
ok(
  !has(
    diag({
      checks: [checkItem('CQ1', 'passed', '相关这一事实本身')],
      refutations: [refutation('R1', 'CQ1')],
    }),
    '指向不存在的'
  ),
  '反驳指向真实检查项 → 不报'
);

ok(
  !has(
    diag({
      checks: [checkItem('CQ1', 'passed', '相关这一事实本身')],
      legitimateMoves: [
        {
          targetId: 'CQ1',
          quote: '取消早读之后一本率下降',
          what: '把相关当成因果这一步被文本自己限定了',
          why: '作者紧接着写了「也可能有别的因素」，没有把相关说成因果',
          tag: 'inferred',
          confidence: 'medium',
        },
      ],
    }),
    '指向不存在的'
  ),
  '「此处合法」指向真实检查项 → 不报'
);

ok(
  has(
    diag({
      conclusion: { ...claim('C', 'conclusion', PLACEHOLDER, 0), quote: '取消早读之后一本率下降', span: null },
    }),
    '占位文字'
  ),
  '占位结论挂着引文 → 报'
);

ok(
  has(
    diag({
      conclusion: { ...claim('C', 'conclusion', PLACEHOLDER, 0), quote: null, span: null },
      scope: { applicable: true, reason: '适用', outOfScopeAt: null, partialNote: null },
      verdict: NOTHING_REFUTED,
    }),
    'G10 未生效'
  ),
  '判适用却抽不出结论、档位照旧 → 报'
);

ok(has(diag({ context: { ...good.context, issue: '（未能确定争议之点）' } }), '争议之点'), '争议之点没识别出来 → 报');

/* ── 三 · 缺口不算破 ── */

{
  const a = auditReport(diag({ refutations: [refutation('R1', 'C', { steelman: '' })] }));
  ok(a.gaps.some((g) => g.includes('对方最可能的反击')), '反驳没写 steelman → 记缺口');
  ok(!a.invariants.some((i) => i.includes('反击')), '反驳没写 steelman 不算结构矛盾');
}

/*
 * evidenceNeeded 为空是合法的（指出推不出来不需要新证据），
 * 这里钉一条，防止将来有人「顺手」把它加回去。
 */
{
  const a = auditReport(diag({ refutations: [refutation('R1', 'C', { evidenceNeeded: [] })] }));
  ok(!a.gaps.some((g) => g.includes('证据')), '没写要什么证据不算缺口');
  ok(!a.invariants.some((i) => i.includes('证据')), '没写要什么证据不算矛盾');
}

/* ── 二·五 · 深查发现库：只汇总、不重判 ── */

{
  const a = diag({
    id: 'a',
    createdAt: 10,
    mode: 'deep',
    passage: '  第一段   原文  ',
    deep: {
      findings: [deepFinding({ id: 'D1', status: 'confirmed' })],
      unlocated: [{ title: '候选', detail: '细节', why: '指不到' }],
    },
  });
  const b = diag({
    id: 'b',
    createdAt: 20,
    mode: 'deep',
    passage: '第二段',
    deep: {
      findings: [deepFinding({ id: 'D2', kind: 'scope', status: 'weakened', title: '第二条' })],
      unlocated: [],
    },
  });
  const v = collectDeepFindings([a, b, diag({ id: 'c' })]);

  ok(v.reports === 2, '发现库只数有深查账本的报告');
  ok(v.total === 2, '发现库汇总全部发现');
  ok(v.items[0].reportId === 'b' && v.items[0].findingId === 'D2', '发现库按报告时间从新到旧');
  ok(v.unlocated === 1, '发现库把落不到原文的候选单独计数');
  ok(v.byStatus.confirmed === 1 && v.byStatus.weakened === 1, '发现库按终态计数');
  ok(v.byKind['cq-gap'] === 1 && v.byKind.scope === 1, '发现库按类型计数');
  ok(v.items[1].passageHead === '第一段 原文', '发现库的原文开头折叠空白');

  /*
   * 反复出现按「报告份数」算，不按发现条数：同一份报告写三条同类型，
   * 只说明那一份漏得多；两份报告各有一条，才叫反复出现。
   */
  const d = diag({
    id: 'd',
    createdAt: 30,
    deep: { findings: [deepFinding({ id: 'D3' })], unlocated: [] },
  });
  const repeat = collectDeepFindings([a, b, d]);
  ok(repeat.byKindReports['cq-gap'] === 2, '同一类型出现在两份报告里 → 记两份');
  ok(repeat.byKindReports['scope'] === 1, '只出现一份的类型不虚报重复');
  ok(repeat.repeats[0]?.kind === 'cq-gap' && repeat.repeats[0]?.reports === 2, '反复出现按报告份数排序，只列 ≥2 份的类型');
}

/* ── 二·六 · 自省：只汇总四类来源，不另判一遍 ── */

{
  const base = diag();
  const withSelf = diag({
    selfCheck: { ...base.selfCheck, unknowns: ['不知道机制那一环'], withdrawIf: ['如果原文给出机制'] },
  });
  const a = selfAuditOf(withSelf);
  ok(
    a.items.some((x) => x.source === 'model' && x.kind === 'unknown' && x.text.includes('机制')),
    '自省把模型写的「不知道」原样摆出'
  );
  ok(a.items.some((x) => x.source === 'model' && x.kind === 'withdraw'), '自省把模型写的撤回条件原样摆出');
  ok(!a.items.some((x) => x.kind === 'no-withdraw'), '模型写了自省条件 → 不补「没写」');

  const silent = selfAuditOf(diag({ selfCheck: { ...base.selfCheck, unknowns: [], withdrawIf: [] } }));
  ok(silent.items.some((x) => x.kind === 'no-withdraw'), '模型没写撤回条件 → 自省照实说没写');

  const broken = diag({ conclusion: { ...base.conclusion, text: '  ' } });
  const b = selfAuditOf(broken);
  ok(
    auditReport(broken).invariants.length > 0 && b.items.some((x) => x.source === 'local' && x.kind === 'invariant'),
    '自省把本地数的结构矛盾摆出来'
  );

  const gap = diag({ refutations: [refutation('R1', 'C', { steelman: '' })] });
  const c = selfAuditOf(gap);
  ok(
    auditReport(gap).gaps.length > 0 && c.items.some((x) => x.source === 'local' && x.kind === 'gap'),
    '自省把本地数的缺口摆出来'
  );

  const deep = diag({
    mode: 'deep',
    verdict: { ...base.verdict, level: 'withstands' },
    deep: {
      findings: [deepFinding({ id: 'D1', status: 'weakened' }), deepFinding({ id: 'D2', status: 'rejected' })],
      unlocated: [{ title: '指不到原文的候选', detail: '细节', why: '引文没落点' }],
    },
  });
  const e = selfAuditOf(deep);
  ok(e.items.some((x) => x.source === 'deep' && x.kind === 'unlocated'), '自省把落不到原文的候选摆出来');
  ok(
    e.items.some((x) => x.kind === 'weakened') && e.items.some((x) => x.kind === 'rejected'),
    '自省把被削弱与被推翻分开摆'
  );
  ok(e.items.some((x) => x.kind === 'tension'), '全部发现被削弱/推翻而判读仍站住 → 自省指出两层并列');

  ok(
    selfAuditOf(base).items.some((x) => x.source === 'provenance' && x.kind === 'version'),
    '报告没记版本 → 自省把版本不可复核摆出来'
  );

  /*
   * 版本与指纹都对得上时不能再报一条：自省只报本地能证实的脱节，
   * 否则每份新报告都会多一条「版本问题」，读者很快就不看了。
   */
  const same = diag({
    mode: 'deep',
    prompt: { version: PROMPT_BASELINE.version, fingerprint: PROMPT_BASELINE.fingerprints['walton.deep'] },
  });
  ok(
    !selfAuditOf(same).items.some((x) => x.source === 'provenance'),
    '版本与指纹都对得上 → 不自造一条版本问题'
  );

  const f = selfAuditOf(deep);
  ok(f.items.length === f.model + f.local + f.deep + f.provenance, '自省的分来源计数与条目数一致');
  ok(JSON.stringify(selfAuditOf(deep)) === JSON.stringify(selfAuditOf(deep)), '同一份报告两次自省结果全等');
}

/* ── 二·七 · 同一段 · 多镜：只并列，不投票 ── */

{
  const passage = '  同一段   文字 ';
  const mk = (
    id: string,
    theory: string,
    at: number,
    patch: Partial<Diagnosis> = {},
    mode = 'diagnose'
  ): AgreementItem => ({
    id,
    at,
    mode,
    theory,
    version: '3.2.0',
    fingerprint: 'fp',
    passage,
    report: diag({ theory: theory as Diagnosis['theory'], ...patch }),
  });
  const waltonOld = mk('w1', 'walton', 10, {
    overall: {
      summary: '',
      strongest: null,
      weakest: { at: 'P1', what: '旧的一处', why: '' },
      ifOneChange: null,
    },
  });
  const waltonNew = mk('w2', 'walton', 20, {
    overall: {
      summary: '',
      strongest: null,
      weakest: { at: 'C', what: '新的一处', why: '' },
      ifOneChange: null,
    },
  });
  const toulmin = mk('t1', 'toulmin', 15, {
    checks: [checkItem('T1', 'unanswered', '担保'), checkItem('T2', 'violated', '反驳')],
  });
  const notApplicable = mk('n1', 'copi', 25, {
    scope: { applicable: false, reason: '这段是口号，不是论证', outOfScopeAt: null, partialNote: null },
  });
  const deep = mk('d1', 'pragma', 30, {}, 'deep');
  const otherPassage = { ...mk('o1', 'copi', 40), passage: '别的原文' };
  const view = crossLensOf(passage, 'diagnose', [
    waltonOld,
    waltonNew,
    toulmin,
    notApplicable,
    deep,
    otherPassage,
  ]);

  ok(view.rows.length === 3, '多镜只数同原文、同模式的报告');
  ok(view.rows[0].theory === 'walton' && view.rows[0].weak === '新的一处', '同一副透镜取最近一份');
  ok(view.rows[0].checks.total === 0, '检查项计数来自各自报告');
  ok(
    view.rows[1].theory === 'toulmin' &&
      view.rows[1].weak.includes('被削弱') &&
      view.rows[1].weakKind === 'verdict',
    '没写整体分析时退回判读句'
  );
  ok(view.rows[0].weakKind === 'weakest', '有整体分析时取「最弱的一处」');
  ok(
    view.rows[1].checks.unanswered === 1 && view.rows[1].checks.violated === 1,
    '未答与未过的检查项分开数'
  );
  ok(
    view.rows[2].applicable === false &&
      view.rows[2].reason.includes('口号') &&
      view.rows[2].weak === '' &&
      view.rows[2].weakKind === 'none',
    '判了不适用的透镜不把理由当成「最弱的一处」'
  );
  ok(view.rows[2].checks.total === 0, '不适用的透镜不数检查项');
  ok(view.missing.some((x) => x.theory === 'pragma'), '没跑过的透镜单列，不补假报告');
  ok(/不换算档位|不投票/.test(view.line), '多镜总述写明不换算、不投票');
  ok(/其中 1 副判了「不适用」/.test(view.line), '多镜总述把不适用单独说出来');
  ok(/不可换算/.test(view.caveat), '并列不等于互相证实');

  const current = diag({
    id: 'cur',
    theory: 'walton',
    mode: 'diagnose',
    createdAt: 30,
    passage,
    overall: {
      summary: '',
      strongest: null,
      weakest: { at: 'C', what: '屏幕上这一处', why: '' },
      ifOneChange: null,
    },
  });
  const v2 = crossLensOf(passage, 'diagnose', [waltonNew, toulmin], current);
  ok(v2.rows[0].weak === '屏幕上这一处', '当前报告比存档新时用当前的');

  ok(crossLensOf('别的一段', 'diagnose', [waltonNew]).rows.length === 0, '原文不同 → 不误配');
  ok(
    JSON.stringify(
      crossLensOf(passage, 'diagnose', [waltonOld, waltonNew, toulmin, notApplicable, deep, otherPassage])
    ) === JSON.stringify(view),
    '同一批报告两次多镜对照结果全等'
  );
}

/* ── 四 · 确定性 ── */

ok(JSON.stringify(auditReport(good)) === JSON.stringify(auditReport(good)), '同一份报告两次自检结果全等');

/* 断言总数兜底：少跑就是静默跳过 */
ok(passed >= 60, '断言总数不少于 60 项', `实际 ${passed}`);

/* ── 五 · 真实报告现状（只打印，不断言） ── */

const dir = join(process.env.APPDATA ?? '', 'argument-lens/archive');
if (existsSync(dir)) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('index'));
  let n = 0;
  let withInv = 0;
  let withGap = 0;
  const tally = new Map<string, number>();
  for (const f of files) {
    try {
      const d = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Diagnosis;
      if (!d || d.version !== 2) continue;
      n += 1;
      const a = auditReport(d);
      if (a.invariants.length) withInv += 1;
      if (a.gaps.length) withGap += 1;
      for (const i of a.invariants) {
        const k = i.replace(/[「」]/g, '').slice(0, 26);
        tally.set(k, (tally.get(k) ?? 0) + 1);
      }
    } catch {
      /* 坏文件跳过：报告目录里可能有用户手改过的东西 */
    }
  }
  console.log(`\n真实报告：${n} 份｜含结构矛盾 ${withInv} 份｜含缺口 ${withGap} 份`);
  for (const [k, v] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}× ${k}`);
} else {
  console.log('\n未找到报告目录，跳过真实数据统计。');
}

if (failed.length) {
  console.error(`\n✗ 报告自检失败 ${failed.length} 项（通过 ${passed} 项）`);
  for (const f of failed) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ 报告自检规则通过 ${passed} 项`);
