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
import type { Diagnosis } from '@shared/types';
import { checkItem, claim, diag, refutation } from './fixture-report';

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

ok(has(diag({ refutations: [refutation('R1', 'P7')] }), '指向不存在的 P7'), '反驳指向不存在的主张 → 报');

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

/* ── 四 · 确定性 ── */

ok(JSON.stringify(auditReport(good)) === JSON.stringify(auditReport(good)), '同一份报告两次自检结果全等');

/* 断言总数兜底：少跑就是静默跳过 */
ok(passed >= 18, '断言总数不少于 18 项', `实际 ${passed}`);

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
