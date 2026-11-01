import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTs } from './ts-runner.mjs';

/*
 * 提示词契约检查。跑法：npm run check:contract
 *
 * 这里额外把 `electron` 换成替身：analyze.ts 链路上的 store/usage 会导入它，
 * 而 node 里 import 真 electron 只会拿回一个路径字符串，ESM 具名导入直接报错。
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await runTs({
  entry: 'scripts/prompt-contract.ts',
  outName: 'prompt-contract.mjs',
  alias: { electron: resolve(ROOT, 'scripts/stubs/electron.ts') },
});
