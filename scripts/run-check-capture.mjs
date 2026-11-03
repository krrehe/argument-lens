import { runTs } from './ts-runner.mjs';

// 全局快捷键捕获的判定断言：空/同段不动、超长不截断、用户的字只问不填。跑法：npm run check:capture
await runTs({ entry: 'scripts/check-capture.ts', outName: 'check-capture.mjs' });
