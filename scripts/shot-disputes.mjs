/**
 * 截「争议地图」对话框。
 *
 * 为什么单独一支：这张图的内容全在弹窗里，而弹窗要靠点击打开，
 * 静态预览页（mock.html）跑不了它，只能拉起真应用点一下。
 *
 * 跑法：node scripts/shot-disputes.mjs [高] [宽]
 * 产物：scripts/.out/disputes.png（附 .log 里的 DOM 探针）
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));

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

// 指向假模型。跑完还原——截图不该改用户的配置。
const settingsFile = join(userData, 'settings.json');
const backup = existsSync(settingsFile) ? readFileSync(settingsFile, 'utf-8') : null;
writeFileSync(
  settingsFile,
  JSON.stringify(
    { baseUrl: 'http://127.0.0.1:8799/v1', model: 'mock-big', temperature: 0.2, apiKeyCipher: '', apiKeyPlain: 'test' },
    null,
    2
  ),
  'utf-8'
);

const shot = join(out, 'disputes.png');
for (const f of [shot, `${shot}.log`]) rmSync(f, { force: true });

const env = {
  ...process.env,
  AL_SMOKE: shot,
  // 先跑一次分析：争议是从判定结果里推出来的，空页面没有争议可看
  AL_ACTION: 'analyze',
  AL_PANEL: 'disputes',
  AL_SHOT_H: String(args[0] ?? 1150),
  AL_SHOT_W: String(args[1] ?? 1400),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.AL_FORCE_ONBOARD;

const child = spawn(electronBin, [root], { env, stdio: 'ignore' });
const done = await new Promise((r) => {
  child.on('exit', () => r('exit'));
  setTimeout(() => r('timeout'), 90_000);
});
child.kill();

if (backup === null) rmSync(settingsFile, { force: true });
else writeFileSync(settingsFile, backup, 'utf-8');

const log = existsSync(`${shot}.log`) ? readFileSync(`${shot}.log`, 'utf-8') : '';
const panel = log.split('\n').find((l) => l.includes('PANELDOM')) ?? '(没有面板探针)';

console.log(`${done}｜${existsSync(shot) ? `截图：${shot}` : '没有产出截图'}`);
console.log(panel.replace(/^.*PANELDOM /, '面板探针：'));
process.exit(existsSync(shot) ? 0 : 1);
