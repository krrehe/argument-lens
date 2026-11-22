import { runTs } from './ts-runner.mjs';

// 首屏总结与逻辑链：只用纯函数 + 造出来的报告，不需要 electron。
await runTs({ entry: 'scripts/check-digest.ts', outName: 'check-digest.mjs' });
