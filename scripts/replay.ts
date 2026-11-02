import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODE_META } from '@shared/types';
import { THEORY_BY_ID } from '@shared/theories';
import {
  coverageOf,
  defaultArchiveDir,
  loadArchives,
  replayOne,
  suspectOf,
  type ReplayOutcome,
} from './replay-lib';

/**
 * 离线重放。跑法：npm run replay [-- 目录]
 *
 * 为什么要这个：改提示词或改裁决之后，唯一的验证方式是重跑一次评测——
 * 六分钟、十七万 token，而那次评测的模型输出又变了，于是「报告不一样了」
 * 依然分不清是代码改坏了还是模型换了说法。存档里存了模型原文之后，
 * 这条链路可以离线复算：三秒、零成本，每天改十次也跑得起。
 *
 * 判据不是零差异。版本升级本来就该有差异，判据是**每一处差异都能被解释**。
 * 所以这个命令不替你判定好坏，它只负责把差异列全、把每一处指向最可能动它的那段代码。
 * 所谓回归，就是那处你解释不出来的差异。
 *
 * 退出码有三档，因为「验过、干净」和「什么都没验」不能共用一个 0：
 *   0  有可重放的存档，且全部无差异
 *   1  有差异，或重放跑不完
 *   2  没有可重放的存档——这一次什么都没验到
 */

const argv = process.argv.slice(2);
const takeArg = (name: string): string | null => {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : null;
};

const ACCEPT = argv.includes('--accept');
const SHOW_ALL = argv.includes('--all');
const MAX_PER_REPORT = 12;

const dir = takeArg('--dir') ?? argv.find((a) => !a.startsWith('--')) ?? process.env.REPLAY_DIR ?? defaultArchiveDir();

const loaded = loadArchives(dir);

console.log(`重放目录：${dir}`);
console.log(
  `存档 ${loaded.ready.length + loaded.noRaw.length + loaded.broken.length} 份 · ` +
    `可重放 ${loaded.ready.length} · 无模型原文 ${loaded.noRaw.length} · 读不出 ${loaded.broken.length}`
);

/* 读不出的文件必须说出来。它们是「本该参与比对、但没参与」的那一类，
   悄悄跳过就等于拿「没验」冒充「验过」。 */
for (const b of loaded.broken) console.log(`  ! ${b.file} 读不出：${b.why}`);

if (loaded.ready.length === 0) {
  console.error(
    '\n✗ 没有可重放的存档：本次没有验证任何东西。\n' +
      '  存档要有 `raw`（模型返回原文）才能重放，那是 2026-11-01 之后才存的。\n' +
      '  想让这条命令有用，先去跑一次 `npm run eval` 或分析一段文本，再回来重放。'
  );
  process.exit(2);
}

const cov = coverageOf(loaded.ready);
const fmt = (o: Record<string, number>) =>
  Object.entries(o)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(' · ');
console.log(`覆盖：模式 ${fmt(cov.modes)} ｜ 透镜 ${fmt(cov.theories)}`);
console.log(`      提示词 ${fmt(cov.prompts)} ｜ 不同原文 ${cov.passages} 种`);
if (cov.passages <= 1) {
  console.log('      ⚠ 只有一种原文。全绿只说明这一种没被改坏，不代表判据普遍没动。');
}

const outcomes: ReplayOutcome[] = [];
for (const { report } of loaded.ready) outcomes.push(replayOne(report));

console.log('');
let diffCount = 0;
let badReports = 0;

for (const o of outcomes) {
  const modeName = MODE_META[o.mode as keyof typeof MODE_META]?.label ?? o.mode;
  const theoryName = THEORY_BY_ID[o.theory as keyof typeof THEORY_BY_ID]?.name ?? o.theory;
  const tag = `${o.id}  ${modeName}/${theoryName}`;

  if (!o.ok) {
    badReports++;
    console.log(`✗ ${tag}`);
    console.log(`    重放跑不完（${o.failed!.stage}）：${o.failed!.why}`);
    console.log('    这不是「有差异」，是这条链路本身断了——比差异更严重。');
    continue;
  }

  const d = o.diff!;
  /* 新增字段照旧列出来，但不计入「有差异」：
     它们多半是存档写在这些字段之前，成因与「值被改掉」根本不是一回事。
     列出来是为了让它可见——今天不解释的东西，明天就会变成没人知道的东西。 */
  const addedNote =
    d.added.length > 0
      ? `\n    ⓘ 新增 ${d.added.length} 处字段（存档里没有，那时候还没这一栏）：${d.added
          .slice(0, 6)
          .map((f) => f.path)
          .join('、')}${d.added.length > 6 ? ' 等' : ''}`
      : '';

  if (d.diffs.length === 0) {
    console.log(`✓ ${tag}  无回归${addedNote}`);
    for (const u of d.uncompared) console.log(`    ⓘ 未比对 ${u.code}：${u.why}`);
    continue;
  }

  diffCount += d.diffs.length;
  badReports++;
  console.log(`✗ ${tag}  ${d.diffs.length} 处差异${addedNote}`);
  const shown = SHOW_ALL ? d.diffs : d.diffs.slice(0, MAX_PER_REPORT);
  for (const f of shown) {
    console.log(`    ${f.path}`);
    console.log(`      存档 ${f.before}${f.beforeLen ? `（共 ${f.beforeLen} 字）` : ''}`);
    console.log(`      重算 ${f.after}${f.afterLen ? `（共 ${f.afterLen} 字）` : ''}`);
    console.log(`      ↳ 最可能是：${suspectOf(f.path)}`);
  }
  if (shown.length < d.diffs.length) {
    console.log(`    …另有 ${d.diffs.length - shown.length} 处，加 --all 看全部`);
  }
  for (const u of d.uncompared) console.log(`    ⓘ 未比对 ${u.code}：${u.why}`);
}

/* 没有 raw 的存档单列一条汇总：它们的沉默不该被读成「没问题」 */
if (loaded.noRaw.length) {
  const byMode = loaded.noRaw.reduce<Record<string, number>>((acc, x) => {
    acc[x.mode] = (acc[x.mode] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\n· ${loaded.noRaw.length} 份存档没有模型原文，未参与重放（${fmt(byMode)}）`);
}

if (ACCEPT && diffCount > 0) {
  /*
   * 更新基准。
   *
   * 这个开关很危险，所以它有一个硬条件：**先把差异逐条打印出来**，再写。
   * 一条命令就能让检查从此不再拦你，那种设计迟早会把真回归一起「确认」掉。
   */
  let n = 0;
  for (const o of outcomes) {
    if (!o.ok || !o.replayed || !o.diff || o.diff.diffs.length === 0) continue;
    const file = loaded.ready.find((e) => e.report.id === o.id)!.file;
    writeFileSync(join(dir, file), JSON.stringify(o.replayed), 'utf-8');
    n++;
  }
  console.log(`\n已把 ${n} 份的当前输出写回基准（共 ${diffCount} 处差异）。`);
  console.log('上面每一条从此都不再被这条命令拦截——确认过是有意的，再往下走。');
  process.exit(0);
}

console.log('');
if (badReports === 0) {
  console.log(`✓ 重放 ${outcomes.length} 份，全部与存档一致`);
  process.exit(0);
}

console.error(
  `✗ ${badReports}/${outcomes.length} 份有差异或跑不完，共 ${diffCount} 处\n` +
    '  差异不一定是坏消息：判据是每一处都能被解释。\n' +
    '  能解释（这次有意改的）→ 用 --accept 更新基准；解释不了 → 那就是回归。'
);
process.exit(1);
