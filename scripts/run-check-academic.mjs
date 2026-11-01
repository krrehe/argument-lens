import { runTs } from './ts-runner.mjs';

// 学术分析的断言测试。跑法：npm run check:academic
await runTs({ entry: 'scripts/check-academic.ts', outName: 'check-academic.mjs' });
