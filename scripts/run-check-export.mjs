import { runTs } from './ts-runner.mjs';

// 导出件断言：该出现的是不是都出现了、不适用时有没有假装分析过。跑法：npm run check:export
await runTs({ entry: 'scripts/check-export.ts', outName: 'check-export.mjs' });
