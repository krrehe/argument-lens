import { runTs } from './ts-runner.mjs';

// 语境出处：三档可验、指不出原文就降级、旧档不补假。
// 跑法：npm run check:context-source
await runTs({ entry: 'scripts/check-context-source.ts', outName: 'check-context-source.mjs' });
