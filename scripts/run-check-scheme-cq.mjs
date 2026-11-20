import { runTs } from './ts-runner.mjs';

// 型式—CQ 对表：C-04 十九型最低集、库内映射、三种缺席分开、与 C-03 档位衔接。
// 跑法：npm run check:scheme-cq
await runTs({ entry: 'scripts/check-scheme-cq.ts', outName: 'check-scheme-cq.mjs' });
