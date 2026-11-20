import { runTs } from './ts-runner.mjs';

// 判档：D0–D5 的六档表、记录核对（缺一不算判决）、提示词与界面接线、本地不越权判档。
// 跑法：npm run check:grading
await runTs({ entry: 'scripts/check-grading.ts', outName: 'check-grading.mjs' });
