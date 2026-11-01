import { runTs } from './ts-runner.mjs';

// 报告自检：每条不变量能否被触发、好报告是否零报警。跑法：npm run check:report
await runTs({ entry: 'scripts/check-report.ts', outName: 'check-report.mjs' });
