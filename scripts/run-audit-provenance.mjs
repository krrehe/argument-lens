import { runTs } from './ts-runner.mjs';

// 手动审计：量本机存档里「报告正文有多少字来自模型、多少判定由本地产出」。
// 不进 verify —— 它依赖用户自己的存档，换一台机器没有存档就该明说量不了，而不是假绿。
await runTs({ entry: 'scripts/audit-provenance.ts', outName: 'audit-provenance.mjs' });
