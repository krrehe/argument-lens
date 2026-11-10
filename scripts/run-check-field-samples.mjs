import { runTs } from './ts-runner.mjs';

// 同一个入口、同一套自检，只是 verify 里只要一行结论。
// `AL_CHECK_MODE` 必须在 import 之前设好：ts-runner 是在本进程里 import 产物的。
process.env['AL_CHECK_MODE'] = '1';
await runTs({ entry: 'scripts/audit-field-samples.ts', outName: 'check-field-samples.mjs' });
