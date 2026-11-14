import { runTs } from './ts-runner.mjs';

// 长文本专题的事实账：依赖本机存档，不进 verify（换台机器没有长文本就该明说量不了）。
await runTs({ entry: 'scripts/audit-longtext.ts', outName: 'audit-longtext.mjs' });
