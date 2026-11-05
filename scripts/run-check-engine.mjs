import { runTs } from './ts-runner.mjs';
import { resolve } from 'node:path';

/*
 * 「谁跑的」这一栏。要导入 analyze.ts 的 normalizeDiagnosis（真的落盘那一步，
 * 不是照着它再写一遍），所以和 check:replay 一样把 electron 换成替身。
 */
const ROOT = resolve(import.meta.dirname, '..');
await runTs({
  entry: 'scripts/check-engine.ts',
  outName: 'check-engine.mjs',
  alias: { electron: resolve(ROOT, 'scripts/stubs/electron.ts') },
});
