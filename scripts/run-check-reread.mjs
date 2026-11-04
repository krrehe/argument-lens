import { runTs } from './ts-runner.mjs';

// 回到原文重读：原文逐字还原、引用不越界、展示文字一个字都不许本地新写。
// 跑法：npm run check:reread
await runTs({ entry: 'scripts/check-reread.ts', outName: 'check-reread.mjs' });
