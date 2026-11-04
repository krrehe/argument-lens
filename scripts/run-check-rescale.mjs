import { runTs } from './ts-runner.mjs';

// 换个尺度重读：只换用户给的词，其余逐字保留；编辑可逆、例外全明说。
// 跑法：npm run check:rescale
await runTs({ entry: 'scripts/check-rescale.ts', outName: 'check-rescale.mjs' });
