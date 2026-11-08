import { runTs } from './ts-runner.mjs';
import { resolve } from 'node:path';

// 「两份对照」：同一段字跑两遍，两份报告逐处摆在一起。
// 要 import analyze.ts 的 normalizeDiagnosis 造真报告，所以和 check:views 一样换掉 electron。
const ROOT = resolve(import.meta.dirname, '..');
await runTs({
  entry: 'scripts/check-sideby.ts',
  outName: 'check-sideby.mjs',
  alias: { electron: resolve(ROOT, 'scripts/stubs/electron.ts') },
});
