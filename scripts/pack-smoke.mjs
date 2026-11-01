/**
 * 打包产物自检：直接跑 dist/win-unpacked 里的 exe，而不是跑源码。
 *
 * 为什么非要有这一步：`electron-vite build` 成功只说明渲染层能打包，
 * 说明不了「装完之后能不能用」。asara 打包后 preload 路径、资源路径、
 * userData 位置都可能变；这些错在源码态一次也复现不出来。
 *
 * 而且它验的是**新功能真的进了包**——探针里会找用量面板的节点，
 * 找不到就说明 main 或 preload 的改动没进 asar。
 *
 * 跑法：node scripts/pack-smoke.mjs
 * 前置：先 node node_modules/electron-builder/cli.js --win --dir --config electron-builder.yml
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'scripts/.out');
mkdirSync(out, { recursive: true });

const exe = resolve(root, 'dist/win-unpacked/ArgumentLens.exe');
if (!existsSync(exe)) {
  console.error('没有打包产物。先运行：node node_modules/electron-builder/cli.js --win --dir --config electron-builder.yml');
  process.exit(1);
}

const PORT = 8799;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 假模型：自己起，起不动就沿用已经在跑的那个 */
let mock = null;
async function ensureMock() {
  const ping = async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }], max_tokens: 4 }),
      });
      return r.ok;
    } catch {
      return false;
    }
  };
  if (await ping()) return;
  mock = spawn(process.execPath, [resolve(root, 'scripts/mock-llm.mjs')], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    if (await ping()) return;
  }
  throw new Error('假模型没起来');
}

/*
 * 打包态的 userData 目录。
 *
 * 踩过一次坑：以为按 productName（论证镜）走，写了半天配置，应用根本没读——
 * 它用的是 package.json 的 name（argument-lens），因为 electron-builder 不改这个字段。
 * 现在两个候选都写，谁生效都不会空跑。目录写错的表现是「分析没开始就结束了」，
 * 而脚本如果只看截图是否生成，会把它判成通过。这是最坏的一种假绿。
 */
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
const candidates = [join(process.env.APPDATA ?? '', pkg.name), join(process.env.APPDATA ?? '', '论证镜')].filter((d) =>
  existsSync(d)
);
if (!candidates.length) candidates.push(join(process.env.APPDATA ?? '', pkg.name));

const restores = [];
for (const dir of candidates) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'settings.json');
  const backup = existsSync(file) ? readFileSync(file, 'utf-8') : null;
  restores.push(() => {
    if (backup === null) rmSync(file, { force: true });
    else writeFileSync(file, backup, 'utf-8');
  });
  writeFileSync(
    file,
    JSON.stringify(
      { baseUrl: `http://127.0.0.1:${PORT}/v1`, model: 'mock-argument-lens', temperature: 0.2, apiKeyCipher: '', apiKeyPlain: 'test' },
      null,
      2
    ),
    'utf-8'
  );
}

const shot = join(out, 'packshot.png');
for (const f of [shot, `${shot}.log`]) rmSync(f, { force: true });

await ensureMock();

const env = {
  ...process.env,
  AL_SMOKE: shot,
  AL_ACTION: 'analyze',
  AL_PANEL: 'usage',
  // 提示词页顺带验。它要验的不是「提示词显示出来了」，而是**版本号与指纹显示出来了**——
  // 提示词一改判定口径就可能变，那行小字是判断两份报告能不能对照的唯一凭据，
  // 而且它比正文更容易在重构里掉。
  AL_PANEL2: 'prompt',
  AL_SHOT_H: '1000',
  AL_SHOT_W: '1400',
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.AL_FORCE_ONBOARD;

const child = spawn(exe, [], { env, stdio: 'ignore' });
const done = await new Promise((r) => {
  child.on('exit', () => r('exit'));
  setTimeout(() => r('timeout'), 90_000);
});
try {
  child.kill();
} catch {
  /* 已经退了 */
}
mock?.kill();

for (const fn of restores) fn();

const log = existsSync(`${shot}.log`) ? readFileSync(`${shot}.log`, 'utf-8') : '';
const pick = (tag) => log.split('\n').find((l) => l.includes(tag)) ?? `(没有 ${tag})`;

console.log(`${done}`);
console.log(pick('DOM').replace(/^.*DOM /, '首屏探针：'));
console.log(pick('RESULT').replace(/^.*RESULT /, '分析结果：'));
console.log(pick('PANELDOM').replace(/^.*PANELDOM /, '用量面板：'));
console.log(existsSync(shot) ? `截图：${shot}` : '没有产出截图');

/*
 * 四条都必须成立。第一条最容易被忽略，也最要紧：
 * 截图存在、面板渲染出来了，都不等于这次分析真的跑过——
 * 没有接模型时界面照样画得好好的，脚本会开心地判成通过。
 */
const panel = pick('PANELDOM');
const result = pick('RESULT');
// 两个面板各写一行 PANELDOM，靠探针内容区分，不靠顺序
const promptPanel = log.split('\n').find((l) => l.includes('PANELDOM') && l.includes('"view"')) ?? '';
const checks = [
  /*
   * locales 只该留下中文与英文两个。
   * Electron 默认带 55 个语言包（约 49MB），界面只有中文时它们一个字节都不会被读到。
   * 这条优化退化时**没有任何症状**：功能全好，只是安装包悄悄涨回 120MB。
   * 所以只能靠数文件来守住——它是这一版里唯一用体积而不是行为来验证的检查。
   */
  [
    'locales 只留了中文与英文（体积优化没退化）',
    (() => {
      const dir = resolve(root, 'dist/win-unpacked/locales');
      if (!existsSync(dir)) return false;
      const paks = readdirSync(dir).filter((f) => f.endsWith('.pak'));
      return paks.length > 0 && paks.length <= 3;
    })(),
  ],
  ['分析真的跑完并落屏', /"grid":true/.test(result)],
  // 争议栏是这一轮的新东西。只看「页面渲染出来了」会漏掉它——
  // 它只在确实碰到分歧时才出现，渲染失败的表现是「安静地不显示」，不是报错。
  ['争议栏进了打包产物', /"disputes":[1-9]/.test(result)],
  ['板块标题上的争议芯片在', /"disputeMarks":[1-9]/.test(result)],
  // 主张库同理，而且更隐蔽：它挂在侧栏最底部，整块没渲染出来时页面完全正常。
  ['侧栏的主张入口在', /"claims":[1-9]/.test(result)],
  ['顶栏「理论」入口在', /"theoryBtn":true/.test(result)],
  // 本轮四条新功能。它们的共同点是坏了不报错，所以进包之后要逐个数。
  ['模式开关五档进了包', /"modeChips":5/.test(result)],
  // 模式横幅：进包后最容易坏的一处是 MODE_META 被摇树摇掉，
  // 表现为报告照常渲染、横幅安静消失——而横幅是「这份为什么没有档位」的唯一解释。
  ['模式与横幅机制进了包', /"modeOn":"[a-z]+"/.test(result) && /"modeBanner":"/.test(result)],
  ['顶栏「历史」入口在', /"histBtn":true/.test(result)],
  ['切分条进了包', /"segBar":true/.test(result)],
  ['异议按钮进了包', /"objBtns":[1-9]/.test(result)],
  // 跑道上「倒在哪一关」：加在既有按钮上的类名，坏了页面照样正常
  ['跑道标出倒下的那一关', /"stripDown":[1-9]/.test(result)],
  ['用量面板进入 DOM', /"kpis":3/.test(panel)],
  ['面板认得出账本', /"bars":14/.test(panel)],
  ['提示词页进了包', /"view":true/.test(promptPanel) && /"sysLen":(\d{4,})/.test(promptPanel)],
  ['提示词版本号与指纹进了包', /v\d+\.\d+\.\d+/.test(promptPanel) && /[0-9a-f]{8}/.test(promptPanel)],
  ['流程无报错', /\bOK\b/.test(log)],
  ['截图产出', existsSync(shot)],
];
for (const [name, pass] of checks) console.log(`${pass ? '通过' : '失败'}  ${name}`);
const ok = checks.every(([, p]) => p);
console.log(ok ? '打包产物自检通过' : '打包产物自检失败');
process.exit(ok ? 0 : 1);
