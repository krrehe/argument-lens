import { runTs } from './ts-runner.mjs';

// 「这段文字跑过没有」的断言：数得对、日期取最近、短文本不报相似度、不劝人。
// 跑法：npm run check:sameness
await runTs({ entry: 'scripts/check-sameness.ts', outName: 'check-sameness.mjs' });
