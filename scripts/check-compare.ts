/**
 * 修订对照的断言测试。
 *
 * 为什么这一块要单独测：「变好了」是这个工具能说出来的最重的一句话。
 * 它一旦说错方向，用户就会以为自己补对了——而工具本来是拿来拦住这种错觉的。
 * 冒烟测试验不到它：那要跑两次真分析，而假模型每次返回同一份 JSON。
 *
 * 所以这里直接造两版报告，把六种走向各走一遍，看它说的是不是该说的那句。
 *
 * 跑法：npm run check:compare
 */
import { MOCK } from '../src/renderer/src/mock-data';
import { diffRevision } from '@shared/compare';
import type { CheckAnswer, Diagnosis, VerdictLevel } from '@shared/types';

let failed = 0;
let passed = 0;
function ok(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? '通过' : '失败'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failed += 1;
  else passed += 1;
}

/** 造一版：改判读档位与检查项答案。其余沿用示例，保证是合法契约。 */
function variant(patch: {
  id: string;
  level?: VerdictLevel;
  answers?: Record<string, CheckAnswer>;
  passage?: string;
  theory?: Diagnosis['theory'];
  mode?: Diagnosis['mode'];
}): Diagnosis {
  const d: Diagnosis = JSON.parse(JSON.stringify(MOCK));
  d.id = patch.id;
  d.parentId = null;
  if (patch.level) d.verdict.level = patch.level;
  if (patch.passage !== undefined) d.passage = patch.passage;
  if (patch.theory) d.theory = patch.theory;
  if (patch.mode) d.mode = patch.mode;
  if (patch.answers) {
    d.checks = d.checks.map((c) =>
      patch.answers && c.id in patch.answers ? { ...c, answer: patch.answers[c.id] as CheckAnswer } : c
    );
  }
  return d;
}

const ids = MOCK.checks.map((c) => c.id);
console.log(`示例报告有 ${ids.length} 条检查项：${ids.join(', ')}\n`);

/* 1. 未答 → 过，档位上移：这才是「改好了」 */
{
  const parent = variant({ id: 'p', level: 'weakened', answers: { [ids[0]]: 'unanswered' } });
  const child = variant({ id: 'c', level: 'withstands', answers: { [ids[0]]: 'passed' } });
  const r = diffRevision(parent, child);
  ok('未答→过且档位上移 = 有推进', r.trend === 'advanced', `trend=${r.trend}`);
  ok('并且算出 1 条答上', r.checks.filter((c) => c.kind === 'resolved').length === 1);
}

/* 2. 过 → 没过：必须报退步，哪怕档位没动 */
{
  const parent = variant({ id: 'p', level: 'weakened', answers: { [ids[0]]: 'passed' } });
  const child = variant({ id: 'c', level: 'weakened', answers: { [ids[0]]: 'violated' } });
  const r = diffRevision(parent, child);
  ok('过→没过 = 退步', r.trend === 'regressed', `trend=${r.trend}`);
}

/* 3. 最危险的一条：未答变少，但明确没过变多。不能给好消息 */
{
  const parent = variant({
    id: 'p',
    level: 'weakened',
    answers: { [ids[0]]: 'unanswered', [ids[1]]: 'unanswered' },
  });
  const child = variant({
    id: 'c',
    level: 'weakened',
    answers: { [ids[0]]: 'passed', [ids[1]]: 'violated' },
  });
  const r = diffRevision(parent, child);
  ok('未答转硬伤：不给 advanced', r.trend !== 'advanced', `trend=${r.trend}`);
  ok('并明确写出这条提醒', r.caveats.some((c) => c.includes('把含糊改成了清晰')), `${r.caveats.length} 条提醒`);
}

/* 4. 一头判不了：没有升降可言 */
{
  const parent = variant({ id: 'p', level: 'undetermined' });
  const child = variant({ id: 'c', level: 'withstands' });
  const r = diffRevision(parent, child);
  ok('判不了→站得住 = 说不了变好', r.trend === 'mixed', `trend=${r.trend}`);
  ok('并说明为什么', r.caveats.some((c) => c.includes('判不了')));
}

/* 5. 换透镜：刻度不可换算 */
{
  const parent = variant({ id: 'p', level: 'weakened', theory: 'walton' });
  const child = variant({ id: 'c', level: 'withstands', theory: 'toulmin' });
  const r = diffRevision(parent, child);
  ok('换透镜 = 不可比', r.comparable === false && r.trend === 'not-comparable', `trend=${r.trend}`);
  ok('并说明刻度不可换算', r.caveats.some((c) => c.includes('不同的透镜')));
}

/* 6. 文本改太多：这不是修订，是两次独立分析 */
{
  const parent = variant({ id: 'p', level: 'weakened', passage: MOCK.passage });
  const child = variant({ id: 'c', level: 'withstands', passage: '完全不是同一段话。'.repeat(12) });
  const r = diffRevision(parent, child);
  ok('文本大改 = 不可比', r.comparable === false);
  ok('并说明这更像两次独立分析', r.caveats.some((c) => c.includes('两次独立分析')));
}

/*
 * 7. 最关键的一条：原文 + 补上的那句前提。
 *
 * 这是真实工作流里的样子——「把这一版填回输入框」填的就是这个。
 * 它必须判为可比，否则修补验收这个功能等于没有。
 * 早先用 Jaccard 时它会被判成不可比：修订天然变长，Jaccard 的分母是并集，
 * 加一句前提就把分数压下去，于是「补上了一句话」被算成「换了另一段话」。
 */
{
  const parent = variant({ id: 'p', level: 'weakened', passage: MOCK.passage });
  const child = variant({
    id: 'c',
    level: 'withstands',
    passage: `${MOCK.passage}\n早读取消与一本率下降之间还有其他变量，本文假定已排除。`,
  });
  const r = diffRevision(parent, child);
  ok('原文 + 补上的前提 = 可比', r.comparable === true, `trend=${r.trend}`);
  ok('并给出档位升降', r.trend === 'advanced', `trend=${r.trend}`);
  ok('不误报「两次独立分析」', !r.caveats.some((c) => c.includes('两次独立分析')));
}

/* 7. 一份诊断一份红队：含义不同 */
{
  const parent = variant({ id: 'p', level: 'weakened', mode: 'diagnose' });
  const child = variant({ id: 'c', level: 'withstands', mode: 'redteam' });
  const r = diffRevision(parent, child);
  ok('诊断 vs 红队 = 不可比', r.comparable === false);
  ok('并说明红队判读含义不同', r.caveats.some((c) => c.includes('红队')));
}

/*
 * 7b. 判定类 vs 描述类：后者根本没有档位。
 *
 * 这两种「不可比」的措辞必须分开：判定类互比是「含义不同但都还有档位」，
 * 判定类对描述类是「有一份恒为判不了，升降读不出任何东西」。
 * 合成一句笼统的「模式不同」，用户看不出哪一种更严重。
 * 这一条同时也是给新加的两个描述类模式兜底——不加的话，那份分支就是没跑过的代码。
 */
{
  const parent = variant({ id: 'p', level: 'weakened', mode: 'diagnose' });
  for (const m of ['reconstruct', 'interrogate'] as const) {
    const child = variant({ id: 'c', level: 'withstands', mode: m });
    const r = diffRevision(parent, child);
    ok(`诊断 vs ${m} = 不可比`, r.comparable === false);
    ok(
      `并说明 ${m} 的档位恒为判不了`,
      r.caveats.some((c) => c.includes('判不了') && c.includes('升降')),
      r.caveats.join('｜')
    );
  }
}

/*
 * 断言总数下限。
 *
 * 缺了这一条，某个循环一旦因为条件不成立少跑一半，输出仍然是「全部通过」——
 * 数量悄悄缩水没人会发现，这与断言静默跳过是同一件事。
 * 阈值定得比当前实际值低一截，日常改动不会误报，但整段循环没跑起来一定会被抓住。
 */
ok('断言总数不少于 18 项（少跑就是静默跳过）', passed + failed >= 18, `实际 ${passed + failed}`);

console.log(failed ? `\n${failed} 项没过。` : '\n对照逻辑全部通过。');
process.exit(failed ? 1 : 0);
