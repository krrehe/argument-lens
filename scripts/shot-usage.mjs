/**
 * 截「用量与余额」面板。
 *
 * 单独一支脚本的两个理由：
 *   1. 面板靠 IPC 取数，静态预览页（mock.html）跑不了它，只能拉起真应用。
 *   2. 空账本的面板看不出排版问题——没数据的地方全是说明文字。
 *      所以先预写单价与余额锚点，再跑一次真实分析，让面板里有数。
 *
 * 跑法：node scripts/shot-usage.mjs [--first] [高] [宽]
 *   --first   截「第一次打开、什么都没填」的样子（无记录、无单价、无余额）
 * 产物：scripts/.out/usage.png ｜ usage-first.png（以及各 .log 里的 DOM 探针）
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const FIRST = args.includes('--first');
const sizeArgs = args.filter((a) => !a.startsWith('--'));

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

const restore = [];
function stash(file) {
  const backup = existsSync(file) ? readFileSync(file, 'utf-8') : null;
  restore.push(() => {
    try {
      if (backup === null) rmSync(file, { force: true });
      else writeFileSync(file, backup, 'utf-8');
    } catch {
      /* 还原失败不该让脚本判负：截图已经产出了 */
    }
  });
}

/* 配置：指向假模型，跳过首次引导 */
const settingsFile = join(userData, 'settings.json');
stash(settingsFile);
writeFileSync(
  settingsFile,
  JSON.stringify(
    { baseUrl: 'http://127.0.0.1:8799/v1', model: 'mock-big', temperature: 0.2, apiKeyCipher: '', apiKeyPlain: 'test' },
    null,
    2
  ),
  'utf-8'
);

/*
 * 账本：清掉旧记录再塞一组人造数据。
 * 为什么要造：截图要展示的是「有数时长什么样」，而真实账本是空的。
 * 造的数据刻意包含三种记录——实测、估算、失败——否则看不出标记有没有生效。
 */
const usageDir = join(userData, 'usage');
mkdirSync(usageDir, { recursive: true });
const now = Date.now();
const ym = (() => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
})();
const monthFile = join(usageDir, `usage-${ym}.jsonl`);
const metaFile = join(usageDir, 'meta.json');
stash(monthFile);
stash(metaFile);

writeFileSync(
  metaFile,
  JSON.stringify(
    FIRST
      ? { pricing: { inPerM: 0, outPerM: 0, currency: '¥' }, anchor: null }
      : { pricing: { inPerM: 2, outPerM: 8, currency: '¥' }, anchor: { at: now - 3 * 86_400_000, amount: 20, note: '充值 20' } },
    null,
    2
  ),
  'utf-8'
);

const lines = [];
let seed = 1;
const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
for (let d = FIRST ? 0 : 12; d >= 0; d--) {
  const n = FIRST ? 0 : d === 0 ? 2 : Math.floor(rnd() * 4);
  for (let k = 0; k < n; k++) {
    const at = now - d * 86_400_000 - k * 3_600_000 - 60_000;
    const ok = !(d === 2 && k === 0);
    const prompt = 2600 + Math.floor(rnd() * 1400);
    const completion = 1500 + Math.floor(rnd() * 900);
    const estimated = d === 5 && k === 0;
    lines.push({
      id: `seed-${d}-${k}`,
      at,
      ok,
      theory: ['walton', 'pragma', 'ars', 'pta', 'toulmin', 'copi'][(d + k) % 6],
      model: 'mock-big',
      host: '127.0.0.1:8799',
      promptTokens: estimated ? 3800 : prompt,
      completionTokens: estimated ? 2100 : completion,
      estimated,
      cost: ok ? (prompt * 2 + completion * 8) / 1_000_000 : 0,
      priced: true,
      currency: '¥',
      priceIn: 2,
      priceOut: 8,
      ms: 12_000 + Math.floor(rnd() * 20_000),
      chars: 180 + Math.floor(rnd() * 300),
    });
  }
}
writeFileSync(monthFile, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');

const shot = join(out, FIRST ? 'usage-first.png' : 'usage.png');
for (const f of [`${shot}`, `${shot}.log`]) rmSync(f, { force: true });

const env = {
  ...process.env,
  AL_SMOKE: shot,
  // 首次状态要截「还没跑过」的面板，就不该先跑一次分析
  AL_ACTION: FIRST ? '' : 'analyze',
  AL_PANEL: 'usage',
  AL_SHOT_H: String(sizeArgs[0] ?? 1000),
  AL_SHOT_W: String(sizeArgs[1] ?? 1400),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.AL_FORCE_ONBOARD;
if (!env.AL_ACTION) delete env.AL_ACTION;

const child = spawn(electronBin, [root], { env, stdio: 'ignore' });
const done = await new Promise((r) => {
  child.on('exit', () => r('exit'));
  setTimeout(() => r('timeout'), 90_000);
});
child.kill();
for (const fn of restore) fn();

const log = existsSync(`${shot}.log`) ? readFileSync(`${shot}.log`, 'utf-8') : '';
const panel = log.split('\n').find((l) => l.includes('PANELDOM')) ?? '(没有面板探针)';

console.log(`${done}｜${existsSync(shot) ? `截图：${shot}` : '没有产出截图'}`);
console.log(panel.replace(/^.*PANELDOM /, '面板探针：'));
process.exit(existsSync(shot) ? 0 : 1);
