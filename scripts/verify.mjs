/**
 * 一条命令跑完全部静态检查。
 *
 * 为什么需要这个：现有十来个 check 散在 package.json 里，靠人记住。
 * 一个人维护的项目，**记不住的东西等于不存在**——断言写得再多，跑不起来就是零。
 * 在这之前每次都要手打一长串，于是实际上常常只跑其中几个，而漏掉的那几个
 * 恰恰是最久没被动过、最可能已经坏掉的。
 *
 * 清单从 package.json 动态发现，不在这里硬编码。理由是经验性的：
 * 硬编码的清单会漏掉后来新增的检查，而漏掉的方式是静默的——它照常打印「全部通过」。
 * 那正是这个项目一直在防的那种假绿。
 *
 * 排除慢的（打包自检、端到端冒烟、真实模型评测）：它们要几分钟到几十分钟，
 * 还有的花钱。需要时单独跑，见 package.json。
 *
 * 跑法：npm run verify
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
const scripts = Object.keys(pkg.scripts ?? {});

/** 慢或花钱的，不进 verify。 */
const SLOW = new Set(['smoke', 'pack:check', 'eval', 'eval:audit', 'dist', 'dist:dir', 'build', 'preview', 'dev']);

const picked = scripts.filter(
  (k) => !SLOW.has(k) && (k === 'typecheck' || k === 'prompt:lint' || k.startsWith('check:'))
);

/*
 * 顺序：先类型，再提示词，再各个 check。
 * 类型不过，后面的检查跑出来也没有意义——它会在一堆编译错误里显得像别的问题。
 */
const rank = (k) => (k === 'typecheck' ? 0 : k === 'prompt:lint' ? 1 : 2);
const order = picked.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

/*
 * --list：只打印清单与项数，立刻退出。
 * 给 check:docs 用——README 里写着「全部静态检查（N 项）」，
 * 那个 N 必须等于这里实际会跑的条数。两边各算一遍迟早对不上，
 * 于是只留一处算法，让文档去核对代码。
 */
if (process.argv.includes('--list')) {
  for (const name of order) console.log(name);
  console.log(`共 ${order.length} 项`);
  process.exit(0);
}

const rows = [];
const startedAll = Date.now();

for (const name of order) {
  const t0 = Date.now();
  const r = spawnSync('npm', ['run', '--silent', name], {
    encoding: 'utf-8',
    shell: true,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const lines = out.split(/\r?\n/).filter((l) => l.trim());
  const passed = r.status === 0;
  /* 摘要把最后一行非空输出当通过数——各脚本的末行都是「✓ … N 项」 */
  const summary = passed ? (lines[lines.length - 1] ?? '').replace(/^✓\s*/, '').trim() : '';
  rows.push({ name, passed, summary, ms: Date.now() - t0, output: out });
  process.stdout.write(passed ? `.` : `\n✗ ${name}\n`);
}

const failed = rows.filter((r) => !r.passed);
const total = ((Date.now() - startedAll) / 1000).toFixed(0);

console.log('\n');
for (const r of rows) {
  const mark = r.passed ? '✓' : '✗';
  const right = r.passed ? r.summary : '失败';
  console.log(`${mark} ${r.name.padEnd(20)} ${right}  ${(r.ms / 1000).toFixed(1)}s`);
}

if (failed.length) {
  for (const f of failed) {
    console.log(`\n───── ${f.name} 完整输出 ─────`);
    console.log(f.output.trim());
  }
  console.error(`\n✗ ${failed.length}/${rows.length} 项失败（共 ${total}s）`);
  process.exit(1);
}

console.log(`\n✓ 全部 ${rows.length} 项通过（共 ${total}s）`);
