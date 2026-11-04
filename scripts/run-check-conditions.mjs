import { runTs } from './ts-runner.mjs';

// 自己列成立条件：条件与判断都在人手里，本地只做可复算的对位。
// 跑法：npm run check:conditions
await runTs({ entry: 'scripts/check-conditions.ts', outName: 'check-conditions.mjs' });
