import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTs } from './ts-runner.mjs';

/*
 * 离线重放。跑法：npm run replay [-- 目录] [--all] [--accept]
 *
 * 和 check:contract 一样要把 `electron` 换成替身：重放要导入 analyze.ts 的
 * normalizeDiagnosis，而那条链路上的 store/usage 在模块顶层导入了 electron。
 * 这个替身只提供 getPath 等几个方法，且指向临时目录——重放不该碰真实用户数据。
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await runTs({
  entry: 'scripts/replay.ts',
  outName: 'replay.mjs',
  alias: { electron: resolve(ROOT, 'scripts/stubs/electron.ts') },
});
