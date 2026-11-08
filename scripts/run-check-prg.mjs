import { runTs } from './ts-runner.mjs';
import { resolve } from 'node:path';

// 「导出画布工程」：报告 → 图 → .prg 的字节。
// 要导入 analyze.ts 的 normalizeDiagnosis 造真报告，所以和 check:views 一样换掉 electron。
const ROOT = resolve(import.meta.dirname, '..');
await runTs({
  entry: 'scripts/check-prg.ts',
  outName: 'check-prg.mjs',
  alias: { electron: resolve(ROOT, 'scripts/stubs/electron.ts') },
});
