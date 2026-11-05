import { runTs } from './ts-runner.mjs';

// 同题复跑：同一版提示词、同一段字、同一个模式跑过多遍时，报告每次一样吗。
// 跑法：npm run check:agreement
await runTs({ entry: 'scripts/check-agreement.ts', outName: 'check-agreement.mjs' });
