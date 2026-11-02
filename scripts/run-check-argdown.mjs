import { runTs } from './ts-runner.mjs';

// Argdown 导出断言：官方解析器读得进去、关系按 supports 画、转义不炸。跑法：npm run check:argdown
await runTs({ entry: 'scripts/check-argdown.ts', outName: 'check-argdown.mjs' });
