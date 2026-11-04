import { runTs } from './ts-runner.mjs';

// 样本账：只有本地存档知道你跑过几段不同的文字，这一层一个判断都不写。
// 跑法：npm run check:portfolio
await runTs({ entry: 'scripts/check-portfolio.ts', outName: 'check-portfolio.mjs' });
