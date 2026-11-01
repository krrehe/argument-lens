/**
 * 截「未分析」时的空状态。
 *
 * 单独一支脚本的理由：这条路径没有模型调用，smoke 那套「跑一次分析再验收」用不上，
 * 而它恰恰是用户装完之后看到的第一屏——第一屏排版坏了，后面做得再好也没人看见。
 *
 * 跑法：node scripts/shot-empty.mjs [高] [宽]
 * 产物：scripts/.out/empty.png
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'scripts/.out');
mkdirSync(out, { recursive: true });

const electronBin = resolve(root, 'node_modules/electron/dist/electron.exe');
if (!existsSync(electronBin)) {
  console.error('未找到 electron。先运行：node node_modules/electron/install.js');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
const userData = join(process.env.APPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData/Roaming'), pkg.name);
mkdirSync(userData, { recursive: true });
// 预置一个「已配置」的假 Key：否则会先弹首次引导，截不到空状态
const settingsFile = join(userData, 'settings.json');
const backup = existsSync(settingsFile) ? readFileSync(settingsFile, 'utf-8') : null;
writeFileSync(
  settingsFile,
  JSON.stringify({ baseUrl: 'http://127.0.0.1:8799/v1', model: 'mock', temperature: 0.2, apiKeyCipher: '', apiKeyPlain: 'test' }, null, 2),
  'utf-8'
);

const shot = join(out, 'empty.png');
const env = {
  ...process.env,
  AL_SMOKE: shot,
  AL_SHOT_H: String(process.argv[2] ?? 1200),
  AL_SHOT_W: String(process.argv[3] ?? 1400),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.AL_ACTION;
delete env.AL_FORCE_ONBOARD;

const child = spawn(electronBin, [root], { env, stdio: 'ignore' });
const done = await new Promise((r) => {
  child.on('exit', () => r('exit'));
  setTimeout(() => r('timeout'), 45_000);
});
child.kill();

if (backup === null) {
  try {
    writeFileSync(settingsFile, '', 'utf-8');
  } catch {
    /* 忽略 */
  }
} else {
  writeFileSync(settingsFile, backup, 'utf-8');
}

console.log(`${done}｜${existsSync(shot) ? `截图：${shot}` : '没有产出截图'}`);
process.exit(existsSync(shot) ? 0 : 1);
