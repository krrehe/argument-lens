import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTs } from './ts-runner.mjs';

/*
 * 重放检查（进 verify）。跑法：npm run check:replay
 *
 * 同样要把 `electron` 换成替身：这条检查会导入 analyze.ts 的 normalizeDiagnosis。
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await runTs({
  entry: 'scripts/check-replay.ts',
  outName: 'check-replay.mjs',
  alias: { electron: resolve(ROOT, 'scripts/stubs/electron.ts') },
});
