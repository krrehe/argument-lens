import { runTs } from './ts-runner.mjs';

// 命题账：纯函数 + 源码结构断言，不需要 electron。
await runTs({ entry: 'scripts/check-props.ts', outName: 'check-props.mjs' });
