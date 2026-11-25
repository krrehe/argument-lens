import { runTs } from './ts-runner.mjs';

// 全屏论证地图：只用纯函数 + 造出来的报告 + 源码接线，不需要 electron。
await runTs({ entry: 'scripts/check-map.ts', outName: 'check-map.mjs' });
