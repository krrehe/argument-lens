import { runTs } from './ts-runner.mjs';

// 全流程账：纯函数 + 源码接线断言，不需要 electron。
await runTs({ entry: 'scripts/check-flow.ts', outName: 'check-flow.mjs' });
