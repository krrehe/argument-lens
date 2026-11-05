import { runTs } from './ts-runner.mjs';

// 下一句：原话逐字存下，只数逐字相同的次数，不判断这句话算不算空泛。
// 跑法：npm run check:nextline
await runTs({ entry: 'scripts/check-nextline.ts', outName: 'check-nextline.mjs' });
