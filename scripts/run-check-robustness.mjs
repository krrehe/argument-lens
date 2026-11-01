import { runTs } from './ts-runner.mjs';

// 稳健性契约：写失败能不能传出去、空 catch 有没有写明理由。跑法：npm run check:robustness
await runTs({ entry: 'scripts/check-robustness.ts', outName: 'check-robustness.mjs' });
