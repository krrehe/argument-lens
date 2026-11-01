import { build } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/*
 * 用 vite 把 scripts 下的 TypeScript 入口打成单文件 ESM，再 import 执行。
 *
 * 项目里没有 tsx / ts-node，vite 本身就能干这件事，不必为一个测试再装一条工具链。
 * 五个 run-*.mjs 原先各自抄了一份这段配置，改 target 或 alias 要改五处、且容易漏——
 * 抽到这里之后配置只有一份。
 */

/*
 * 必须用 fileURLToPath。用 new URL(import.meta.url).pathname 在 Windows 上
 * 会得到「/D:/...」，再 resolve 就成了「../D:/...」，vite 报 UNRESOLVED_ENTRY，
 * 而错误信息完全看不出是路径斜杠的问题。
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'scripts/.out');

/**
 * @param {object}   opts
 * @param {string}   opts.entry    相对项目根的入口，如 'scripts/prompt-lint.ts'
 * @param {string}   opts.outName  产物文件名，如 'prompt-lint.mjs'
 * @param {object}  [opts.alias]   额外的 resolve.alias，如把 electron 换成替身
 * @returns {Promise<any>}         入口模块的导出（通常只需要副作用）
 */
export async function runTs({ entry, outName, alias = {} }) {
  await build({
    root: ROOT,
    configFile: false,
    logLevel: 'warn',
    resolve: {
      alias: {
        '@shared': resolve(ROOT, 'src/shared'),
        ...alias,
      },
    },
    build: {
      ssr: resolve(ROOT, entry),
      outDir: OUT_DIR,
      // 不清空：.out 是临时目录，清了没有收益，反而会在两个检查并发跑时互相删产物
      emptyOutDir: false,
      target: 'node22',
      minify: false,
      rollupOptions: { output: { entryFileNames: outName } },
    },
  });

  return import(pathToFileURL(resolve(OUT_DIR, outName)).href);
}
