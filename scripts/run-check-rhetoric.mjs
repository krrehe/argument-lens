import { runTs } from './ts-runner.mjs';

// 修辞审计：D-03 四项审计与八列词表、替代链的完整性核对（做完了没有）、提示词与界面接线、本地不越权判定。
// 跑法：npm run check:rhetoric
await runTs({ entry: 'scripts/check-rhetoric.ts', outName: 'check-rhetoric.mjs' });
