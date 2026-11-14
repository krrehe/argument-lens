import { runTs } from './ts-runner.mjs';

// 枢纽前提：纯函数 + 源码结构断言，不需要 electron。
await runTs({ entry: 'scripts/check-pivot.ts', outName: 'check-pivot.mjs' });
