import { runTs } from './ts-runner.mjs';

// 校准集：盲标表生成、评分与评分器自检。跑法：npm run calibration:score
await runTs({ entry: 'scripts/calibration.ts', outName: 'calibration.mjs' });
