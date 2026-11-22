import { runTs } from './ts-runner.mjs';

// 整体分析与三种改法：只用纯函数 + 造出来的报告 + 源码接线，不需要 electron。
await runTs({ entry: 'scripts/check-overall.ts', outName: 'check-overall.mjs' });
