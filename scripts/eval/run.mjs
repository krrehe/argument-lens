/**
 * 跑评测：打成 CJS 主进程包，再用 electron 拉起。
 *
 * 为什么不用 ts-runner：那个走 ESM ssr 产物，而 Electron 的主进程入口对
 * .mjs 的支持依赖版本与 package.json 的 type 字段。打成 CJS 是最不容易出意外的路，
 * 评测脚本不该把时间花在和模块格式较劲上。
 *
 * ── 隔离 ──
 *
 * 评测必须用自己的 userData 目录。理由不是洁癖：runAnalysis 会写用量账本与报告存档，
 * 而那是**用户的**账。第一版直接在真实目录里跑，二十三条报告进了用户的历史、
 * 十七万 token 进了用户的用量面板——用户打开软件看到一笔不是自己花的钱。
 * 更糟的是 npm run smoke：它先写测试配置、退出时删掉 settings.json，
 * 于是「跑一次构建检查」会把用户的 API Key 一起删了。
 *
 * 做法：把真实 settings.json 复制到临时 userData（safeStorage 的密文按系统账户加密，
 * 换个目录照样解得开），再用 --user-data-dir 指过去。Key 不用重新输入，账却记在别处。
 */
import { build } from 'vite';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, 'scripts/.out/eval-harness.cjs');
const USER_DATA = resolve(ROOT, 'scripts/.out/eval-userdata');

await build({
  root: ROOT,
  configFile: false,
  logLevel: 'warn',
  resolve: { alias: { '@shared': resolve(ROOT, 'src/shared') } },
  build: {
    ssr: resolve(ROOT, 'scripts/eval/harness.ts'),
    outDir: resolve(ROOT, 'scripts/.out'),
    emptyOutDir: false,
    target: 'node22',
    minify: false,
    rollupOptions: {
      external: ['electron'],
      output: { format: 'cjs', entryFileNames: 'eval-harness.cjs' },
    },
  },
});

if (!existsSync(OUT)) {
  console.error('构建失败：没有产出', OUT);
  process.exit(1);
}

/* 每次跑之前清空临时 userData：残留的存档会让「历史」面板越跑越长，干扰下一次读数 */
rmSync(USER_DATA, { recursive: true, force: true });
mkdirSync(USER_DATA, { recursive: true });

/*
 * 只复制 settings.json 不够：Windows 上 safeStorage 的密钥装在 userData 的
 * 「Local State」里（DPAPI 保护的那把钥匙就藏在那儿）。临时目录没有它，
 * Chromium 会现场生成一把新钥匙，旧密文自然解不开——报的却是「尚未配置 API Key」。
 * 这个错很贵：会让人以为用户没配 Key，然后去改代码。
 */
const realUserData = join(
  process.env.APPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData/Roaming'),
  'argument-lens'
);
for (const f of ['settings.json', 'Local State']) {
  const src = join(realUserData, f);
  if (existsSync(src)) copyFileSync(src, join(USER_DATA, f));
}
if (!existsSync(join(USER_DATA, 'settings.json'))) {
  console.warn('警告：没找到已有的 settings.json，评测会以「未配置 Key」结束。先在应用里配置一次。');
}

const electronBin = resolve(ROOT, 'node_modules/electron/dist/electron.exe');
if (!existsSync(electronBin)) {
  console.error('未找到 electron。先运行：node node_modules/electron/install.js');
  process.exit(1);
}

/*
 * 必须删掉 ELECTRON_RUN_AS_NODE。
 * 这个变量存在时，electron.exe 不以主进程启动，而是退化成普通 Node——
 * 于是 require('electron') 找不到模块、app 是 undefined，
 * 报错信息（Cannot find module 'electron'）完全指不到真正的原因。
 */
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;

const child = spawn(electronBin, [OUT, `--user-data-dir=${USER_DATA}`], {
  cwd: ROOT,
  env,
  stdio: 'inherit',
});

const code = await new Promise((r) => child.on('exit', (c) => r(c)));

/*
 * 跑完把复制过去的凭据删掉。
 *
 * 「为了读 Key 而复制一份 Key」如果留在盘上，就变成第二份密钥——而且藏在
 * scripts/.out 这种没人会去看的地方。复制是为了这一次运行，不是为了留存。
 * Local State 里装的是保护密文的那把钥匙，比 settings.json 更该删。
 */
for (const f of ['settings.json', 'Local State']) {
  rmSync(join(USER_DATA, f), { force: true });
}

process.exit(code ?? 0);
