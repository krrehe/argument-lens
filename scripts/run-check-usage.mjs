import { runTs } from './ts-runner.mjs';

// 记账规则断言：谁算模拟调用、取价顺序。跑法：npm run check:usage
await runTs({ entry: 'scripts/check-usage.ts', outName: 'check-usage.mjs' });
