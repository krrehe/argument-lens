import { runTs } from './ts-runner.mjs';
import { resolve } from 'node:path';

// 「挑图」：这份报告能画哪几张、这次显示哪几张。
// 要导入 analyze.ts 的 normalizeDiagnosis 造真报告，所以和 check:engine 一样换掉 electron。
const ROOT = resolve(import.meta.dirname, '..');
await runTs({
  entry: 'scripts/check-views.ts',
  outName: 'check-views.mjs',
  alias: { electron: resolve(ROOT, 'scripts/stubs/electron.ts') },
});
