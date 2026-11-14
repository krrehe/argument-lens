/**
 * 跑对照组：打成 CJS，用 electron 拉起。与 run.mjs 同一套隔离做法。
 *
 * 单独一个脚本而不是给 run.mjs 加开关，是因为两条腿的产物落在不同目录、
 * 也不该在同一次运行里先后跑：产品侧一次要几十秒到一分多钟，
 * 混在一起会让「跑到一半」变成两件事都做不完。
 */
import { build } from 'vite';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, 'scripts/.out/eval-bare-harness.cjs');
const USER_DATA = resolve(ROOT, 'scripts/.out/eval-userdata-bare');

await build({
  root: ROOT,
  configFile: false,
  logLevel: 'warn',
  resolve: { alias: { '@shared': resolve(ROOT, 'src/shared') } },
  build: {
    ssr: resolve(ROOT, 'scripts/eval/bare.ts'),
    outDir: resolve(ROOT, 'scripts/.out'),
    emptyOutDir: false,
    target: 'node22',
    minify: false,
    rollupOptions: {
      external: ['electron'],
      output: { format: 'cjs', entryFileNames: 'eval-bare-harness.cjs' },
    },
  },
});

if (!existsSync(OUT)) {
  console.error('构建失败：没有产出', OUT);
  process.exit(1);
}

rmSync(USER_DATA, { recursive: true, force: true });
mkdirSync(USER_DATA, { recursive: true });

const realUserData = join(
  process.env.APPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData/Roaming'),
  'argument-lens'
);
for (const f of ['settings.json', 'Local State']) {
  const src = join(realUserData, f);
  if (existsSync(src)) copyFileSync(src, join(USER_DATA, f));
}
if (!existsSync(join(USER_DATA, 'settings.json'))) {
  console.warn('警告：没找到已有的 settings.json，对照组会以「未配置 Key」结束。');
}

const electronBin = resolve(ROOT, 'node_modules/electron/dist/electron.exe');
if (!existsSync(electronBin)) {
  console.error('未找到 electron。先运行：node node_modules/electron/install.js');
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;

const child = spawn(electronBin, [OUT, `--user-data-dir=${USER_DATA}`], {
  cwd: ROOT,
  env,
  stdio: 'inherit',
});

const code = await new Promise((r) => child.on('exit', (c) => r(c)));

for (const f of ['settings.json', 'Local State']) {
  rmSync(join(USER_DATA, f), { force: true });
}

process.exit(code ?? 0);
