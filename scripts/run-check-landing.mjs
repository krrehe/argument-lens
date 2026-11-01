import { runTs } from './ts-runner.mjs';

// 理论主张落点表检查。跑法：npm run check:landing
await runTs({ entry: 'scripts/check-landing.ts', outName: 'check-landing.mjs' });
