import { runTs } from './ts-runner.mjs';

/**
 * 修订对照的断言测试（测的是 src/shared/compare.ts，不跑应用）。
 * 跑法：npm run check:compare
 */
await runTs({ entry: 'scripts/check-compare.ts', outName: 'check-compare.mjs' });
