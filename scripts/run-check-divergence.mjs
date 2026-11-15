import { runTs } from './ts-runner.mjs';

// v1.1 分歧内核：纯函数 + 二十步流程账 + 源码接线断言，不需要 electron。
await runTs({ entry: 'scripts/check-divergence.ts', outName: 'check-divergence.mjs' });
