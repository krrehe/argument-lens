import { runTs } from './ts-runner.mjs';

// 理论主张库的断言测试。跑法：npm run check:theory
await runTs({ entry: 'scripts/check-theory.ts', outName: 'check-theory.mjs' });
