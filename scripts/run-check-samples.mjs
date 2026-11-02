import { runTs } from './ts-runner.mjs';

// 示例文本的断言：段数、互不相同、长度、句数。跑法：npm run check:samples
await runTs({ entry: 'scripts/check-samples.ts', outName: 'check-samples.mjs' });
