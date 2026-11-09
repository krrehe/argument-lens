/**
 * 打包产物自检：直接跑 dist/win-unpacked 里的 exe，而不是跑源码。
 *
 * 为什么非要有这一步：`electron-vite build` 成功只说明渲染层能打包，
 * 说明不了「装完之后能不能用」。asar 打包后 preload 路径、资源路径、
 * userData 位置都可能变；这些错在源码态一次也复现不出来。
 *
 * 而且它验的是**新功能真的进了包**——探针里会找用量面板的节点，
 * 找不到就说明 main 或 preload 的改动没进 asar。
 *
 * 跑法：node scripts/pack-smoke.mjs
 * 前置：先 node node_modules/electron-builder/cli.js --win --dir --config electron-builder.yml
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
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
 * 隔离目录：这一步跑的是打包后的 exe，它自己会写设置、写存档、写账本。
 * 这些一律写进临时目录，**不碰用户的 %APPDATA%/argument-lens**。
 *
 * 第一版不是这样：它把测试设置写进真实目录，只备份还原 settings.json 一个文件。
 * 三个后果，第三个是事故级的：
 *   1. 每跑一次就往真实账本里记一笔假账、往真实历史里塞一份假报告；
 *   2. 用量面板那条断言（14 根柱子）于是依赖「用户账本里恰好有多少条」，
 *      换台机器就是误报——断言一旦靠用户数据成立，它守的就不是代码；
 *   3. **跑的中途崩一次，真实 settings.json 里就留着 `apiKeyPlain: "test"`，
 *      用户真正的那把 Key 被覆盖掉。** 这种错在源码里完全看不出来，
 *      因为它只发生在脚本分支里，也只在崩的那一次发生。
 * smoke.mjs 早就为同一件事吃过亏（注释里写着「删的是用户的 settings.json，
 * API Key 一起没了」），pack-smoke 一直没跟上。
 *
 * `--user-data-dir` 是 Chromium 的开关，Electron 拿它当 userData 用。
 * 但它**不保证**一定被吃下，所以在花任何一次分析之前先跑一次前置探针确认（见下）。
 */
const userData = join(out, 'pack-userdata');
rmSync(userData, { recursive: true, force: true });
mkdirSync(userData, { recursive: true });

/* 注意目录名：是 package.json 的 name（argument-lens），不是 productName（论证镜）
   ——electron-builder 不改这个字段，应用读的就是 name。 */
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
const realDirs = [join(process.env.APPDATA ?? '', pkg.name), join(process.env.APPDATA ?? '', '论证镜')].filter((d) =>
  existsSync(d)
);

/*
 * 真实目录的指纹：每个文件的相对路径 + 大小 + 修改时间。
 *
 * 不读内容（13MB 的 Chromium 缓存没必要读），只回答一个问题：
 * **这次自检有没有在任何地方动过用户的数据。**
 * 隔离失效时它会红——这条断言守的是「别再把东西写回用户目录」，
 * 而不是「这一次恰好没写」。
 */
function snapshot(dir) {
  const rows = [];
  const walk = (d) => {
    let items;
    try {
      items = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of items) {
      const p = join(d, it.name);
      if (it.isDirectory()) {
        walk(p);
        continue;
      }
      try {
        const st = statSync(p);
        rows.push(`${relative(dir, p)}|${st.size}|${Math.round(st.mtimeMs)}`);
      } catch {
        /* 刚被删掉的文件不算变化 */
      }
    }
  };
  walk(dir);
  return rows.sort();
}

const before = realDirs.map((d) => ({ dir: d, rows: snapshot(d) }));

const shot = join(out, 'packshot.png');
for (const f of [shot, `${shot}.log`]) rmSync(f, { force: true });

const baseEnv = { ...process.env };
delete baseEnv.ELECTRON_RUN_AS_NODE; // 宿主注入它会让 Electron 退化成 node
delete baseEnv.AL_FORCE_ONBOARD;

/* 跑一次 exe，等它自己退（或超时被杀）。返回 'exit' | 'timeout'。 */
async function runExe(env, ms) {
  const child = spawn(exe, [`--user-data-dir=${userData}`], { env, stdio: 'ignore' });
  const how = await new Promise((r) => {
    child.on('exit', () => r('exit'));
    setTimeout(() => r('timeout'), ms);
  });
  try {
    child.kill();
  } catch {
    /* 已经退了 */
  }
  return how;
}

const samePath = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();

await ensureMock();

/*
 * 前置探针：在花任何一次分析之前，先问一句「你用哪个 userData」。
 *
 * 这一步的意义不是多一条断言，而是**把风险挡在花钱之前**：
 * 隔离没生效时，后面那次分析会拿真实 Key 去打真模型。
 * 只靠「跑完再比对真实目录」也能发现，但那时钱已经花了。
 */
const whereFile = join(out, 'pack-where.txt');
rmSync(whereFile, { force: true });
await runExe({ ...baseEnv, AL_SMOKE: join(out, 'pack-where.log'), AL_WHERE: whereFile }, 40_000);
const whereRaw = existsSync(whereFile) ? readFileSync(whereFile, 'utf-8') : '';
const reported = (whereRaw.match(/^USERDATA (.+)$/m)?.[1] ?? '').trim();
const isolated = Boolean(reported) && samePath(reported, userData);
if (!isolated) {
  console.error('前置探针失败：打包后的 exe 没有使用隔离目录，已中止，没有花任何一次分析。');
  console.error(`  期望：${userData}`);
  console.error(`  实得：${reported || `（没读到 ${whereFile}）`}`);
  console.error('  真实目录此刻仍是干净的；请先查清 --user-data-dir 为什么没生效。');
  mock?.kill();
  process.exit(1);
}

writeFileSync(
  join(userData, 'settings.json'),
  JSON.stringify(
    { baseUrl: `http://127.0.0.1:${PORT}/v1`, model: 'mock-argument-lens', temperature: 0.2, apiKeyCipher: '', apiKeyPlain: 'test' },
    null,
    2
  ),
  'utf-8'
);

/*
 * 预置两条账本记录。
 *
 * 为什么不能让它空着：空账本时「读不到账本」和「账本本来就是空的」在界面上
 * 长得一模一样——用量面板一栏字都不显示。原来那条断言（14 根柱子）之所以能过，
 * 是因为它读的是**用户真实账本**里恰好有数据；隔离之后立刻变成 0 根。
 * 也就是说，旧断言守着的东西从来不是代码，是那台机器上恰好存在的记录。
 *
 * 放两条固定记录进去，「读得到」才有正面证据：读不到时明细行数是 0，一眼就红。
 * 用今年这个月的文件名，日期落在本月内，避开「近 14 天」跨月那段边界。
 */
const usageDir = join(userData, 'usage');
mkdirSync(usageDir, { recursive: true });
const now = new Date();
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const day = 24 * 60 * 60 * 1000;
const seeded = [0, 1].map((back) => ({
  id: `pack-seed-${back}`,
  at: now.getTime() - back * day,
  ok: true,
  theory: 'walton',
  /*
   * 模型名与主机名必须像一次真实调用。
   * 写成 mock-xxx + 127.0.0.1 会被 isMockCall 判成「模拟调用」并排除统计——
   * 那条规则是对的（冒烟跑出来的假账不该进账本），这里只是把夹具写对，
   * 不是绕开它：面板要验的是「读得到账本」，不是「读得到假账」。
   */
  model: 'deepseek-chat',
  host: 'api.deepseek.com',
  promptTokens: 8000,
  completionTokens: 2000,
  estimated: false,
  cost: 0.008,
  priced: true,
  currency: '¥',
  priceIn: 1,
  priceOut: 2,
  ms: 1234,
  chars: 120,
}));
writeFileSync(join(usageDir, `usage-${ym}.jsonl`), seeded.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');

/* 余额锚点：面板上那条「已花 / 共」的横条只在有锚点时出现，
   没有锚点它整块不渲染，看着和「坏了」一样。预置一个，让那条路也被走到。 */
writeFileSync(
  join(usageDir, 'meta.json'),
  JSON.stringify(
    { pricing: { inPerM: 1, outPerM: 2, currency: '¥' }, anchor: { at: now.getTime() - day, amount: 20, note: '自检预置' } },
    null,
    2
  ),
  'utf-8'
);

const env = {
  ...baseEnv,
  AL_SMOKE: shot,
  AL_ACTION: 'analyze',
  // 包内也点一次「回到原文重读」：渲染层与 @shared/reread 有没有一起进 asar，看探针输出
  AL_REREAD: '1',
  // 包内也填一次词换尺度：验的是 @shared/rescale 与输入框重算链路都进了 asar
  AL_RESCALE: '1',
  // 包内也写一次成立条件：@shared/conditions 是这轮新加的，最容易漏进 asar
  AL_CONDITIONS: '1',
  // 包内也点一次样本账：@shared/portfolio 与 passageScan 没进 asar 时，
  // 表现不是报错，是那一栏干脆不出现或数字对不上
  AL_PORTFOLIO: '1',
  // 包内也让同一段字再跑一遍：@shared/agreement 没进 asar 时，
  // 那一栏不出现，或遍数与索引对不上
  AL_AGREEMENT: '1',
  // 包内也挑一次图：@shared/views 或 DiagramMore 没进 asar 时，
  // 那一栏不出现，或清单在、图不动
  AL_VIEWS: '1',
  // 包内也写一句「下一句」：@shared/nextline 与 nextlines.jsonl 的落盘通道
  // 没进 asar 时，表现不是报错，是「点了记下、账上没动」
  AL_NEXTLINE: '1',
  AL_PANEL: 'usage',
  // 提示词页顺带验。它要验的不是「提示词显示出来了」，而是**版本号与指纹显示出来了**——
  // 提示词一改判定口径就可能变，那行小字是判断两份报告能不能对照的唯一凭据，
  // 而且它比正文更容易在重构里掉。
  AL_PANEL2: 'prompt',
  AL_SHOT_H: '1000',
  AL_SHOT_W: '1400',
};

const done = await runExe(env, 90_000);
mock?.kill();

const log = existsSync(`${shot}.log`) ? readFileSync(`${shot}.log`, 'utf-8') : '';
const pick = (tag) => log.split('\n').find((l) => l.includes(tag)) ?? `(没有 ${tag})`;

console.log(`${done}`);
console.log(`隔离目录：${userData}`);
console.log(pick('DOM').replace(/^.*DOM /, '首屏探针：'));
console.log(pick('RESULT').replace(/^.*RESULT /, '分析结果：'));
console.log(pick('PANELDOM').replace(/^.*PANELDOM /, '用量面板：'));
console.log(existsSync(shot) ? `截图：${shot}` : '没有产出截图');

/* 隔离目录里到底有没有这次分析留下的东西——这是「隔离生效」的正面证据，
   与下面「真实目录没被碰过」那条互为对照：一条证明写对了地方，一条证明没写错地方。 */
const isoArchive = join(userData, 'archive');
const isoReports = existsSync(isoArchive)
  ? readdirSync(isoArchive).filter((f) => f.endsWith('.json') && f !== 'index.json').length
  : 0;

const after = realDirs.map((d) => ({ dir: d, rows: snapshot(d) }));
const touched = [];
for (const b of before) {
  const a = after.find((x) => x.dir === b.dir);
  if (!a) continue;
  const setB = new Set(b.rows);
  const setA = new Set(a.rows);
  for (const r of a.rows) if (!setB.has(r)) touched.push(`新增/改动 ${join(b.dir, r.split('|')[0])}`);
  for (const r of b.rows) if (!setA.has(r)) touched.push(`消失/改动 ${join(b.dir, r.split('|')[0])}`);
}

const panel = pick('PANELDOM');
const result = pick('RESULT');
/* 探针行是「时间戳 PANELDOM {...}」，取第一个左花括号之后的部分。
   解析不出来时给 null，下面每一条都会红——不会因为「拿不到数」而静默通过。 */
const panelJson = (() => {
  const i = panel.indexOf('{');
  if (i < 0) return null;
  try {
    return JSON.parse(panel.slice(i));
  } catch {
    return null;
  }
})();
// 两个面板各写一行 PANELDOM，靠探针内容区分，不靠顺序
const promptPanel = log.split('\n').find((l) => l.includes('PANELDOM') && l.includes('"view"')) ?? '';
const checks = [
  /* 隔离三条：正向、反向、以及「跑来跑去到底用哪个目录」。
     只有正向会被「恰好没写盘」骗过，只有反向会被「根本没跑起来」骗过。 */
  ['前置探针确认 --user-data-dir 生效', isolated],
  ['分析写进了隔离目录，不是别处', isoReports >= 1],
  ['真实用户目录一份文件都没动', touched.length === 0],
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
  // 这几条新功能。它们的共同点是坏了不报错，所以进包之后要逐个数。
  ['模式开关五档进了包', /"modeChips":5/.test(result)],
  // 模式横幅：进包后最容易坏的一处是 MODE_META 被摇树摇掉，
  // 表现为报告照常渲染、横幅安静消失——而横幅是「这份为什么没有档位」的唯一解释。
  ['模式与横幅机制进了包', /"modeOn":"[a-z]+"/.test(result) && /"modeBanner":"/.test(result)],
  ['顶栏「历史」入口在', /"histBtn":true/.test(result)],
  ['切分条进了包', /"segBar":true/.test(result)],
  ['异议按钮进了包', /"objBtns":[1-9]/.test(result)],
  // 跑道上「倒在哪一关」：加在既有按钮上的类名，坏了页面照样正常
  ['跑道标出倒下的那一关', /"stripDown":[1-9]/.test(result)],
  ['用量面板进入 DOM', panelJson?.kpis === 3],
  // 「读得到账本」要有正面证据：预置了两条，明细里就该读出来。
  // 读不到时是 0，与「账本本来就空」区分开——这正是上一版断言的漏洞。
  ['用量面板读得到账本（预置两条）', (panelJson?.rows ?? 0) >= 2],
  ['用量面板画出 14 天窗口', panelJson?.bars === 14],
  // 有数据就要有高度。全是 0 高的柱子说明「比例算错了」或「金额一律取 0」，
  // 而这两种情况下格子数一分不差，只数格子永远看不出来。
  ['今天那根柱子有高度（数据真的映射成了图形）', (panelJson?.todayH ?? 0) > 0],
  // 余额条只在有锚点时出现。预置了锚点还看不到，就是那条路断了。
  ['余额条画得出来（有锚点时）', panelJson?.bar === true],
  ['提示词页进了包', /"view":true/.test(promptPanel) && /"sysLen":(\d{4,})/.test(promptPanel)],
  ['提示词版本号与指纹进了包', /v\d+\.\d+\.\d+/.test(promptPanel) && /[0-9a-f]{8}/.test(promptPanel)],
  /*
   * 打包产物里的快捷键提示。
   *
   * 源码态绿不代表包里的绿：这条通道过 preload 与 IPC，两处都可能没进 asar。
   * 探针会先切回分析页再跑；切不回来时它写的是 `CAPTURE-SKIP`，
   * 这里读不到 `CAPTURE {` 就是 false——**没跑不是通过**。
   */
  [
    '打包产物里的快捷键提示在',
    (() => {
      const line = log.split('\n').find((l) => l.includes('CAPTURE {')) ?? '';
      if (!line) return false;
      try {
        const c = JSON.parse(line.slice(line.indexOf('{')));
        return (c.status === 'on' || c.status === 'off') && String(c.hint ?? '').length > 0;
      } catch {
        return false;
      }
    })(),
  ],
  /*
   * 打包产物里的「这段跑过没有」。
   *
   * 和快捷键那条同一个理由，而且更隐蔽：这条通道是「渲染层 → preload → IPC → 主进程读存档」。
   * 少任何一环，渲染层的 catch 都会把它咽掉，于是**那一行不出现**——
   * 页面完全正常、分析照常出报告，没有任何报错。源码态跑得通，包里漏注册照样一声不响。
   * 所以这里读的是包内真实输出，不是代码。
   */
  [
    '打包产物里「这段跑过没有」说得出来',
    (() => {
      const line = log.split('\n').find((l) => l.includes('RESULT {')) ?? '';
      if (!line) return false;
      try {
        const r = JSON.parse(line.slice(line.indexOf('{')));
        return Number(r.sameCount) >= 1 && String(r.sameText ?? '').includes('已经跑过');
      } catch {
        return false;
      }
    })(),
  ],
  /*
   * 打包产物里的「回到原文重读」。
   *
   * 这一屏的判定在 @shared/reread，渲染在 Diagnosis.tsx，两者都得进 asar 才算数。
   * 源码态的端到端已经把整屏验过了，这里验的是**包里那份真的点得开**：
   * 读包内探针的输出，不读代码；读不到 REREADRESULT 就是没跑，判失败而不是跳过。
   */
  [
    '打包产物里「回到原文重读」点得开且原文逐字没改',
    (() => {
      const line = log.split('\n').find((l) => l.includes('REREADRESULT')) ?? '';
      if (!line) return false;
      try {
        const r = JSON.parse(line.slice(line.indexOf('{')));
        return (
          r.opened === true &&
          r.screen === true &&
          r.blocks === 0 &&
          r.refs > 0 &&
          typeof r.text === 'string' &&
          r.text === String(r.passage ?? '').trim() &&
          r.text.length > 20
        );
      } catch {
        return false;
      }
    })(),
  ],
  /*
   * 打包产物里的「换个尺度读」：内核在 @shared/rescale、渲染在 Diagnosis.tsx，
   * 两个都得进 asar。这里不问「按钮在不在」，问的是**填词后有没有真的重算**——
   * 包里若只带了一半代码，最常见的表现是按钮能点、两栏却一模一样。
   */
  [
    '打包产物里「换个尺度读」填词后真的重算了',
    (() => {
      const line = log.split('\n').find((l) => l.includes('RESCALERESULT')) ?? '';
      if (!line) return false;
      try {
        const r = JSON.parse(line.slice(line.indexOf('{')));
        return (
          r.opened === true &&
          r.filled === true &&
          r.screen === true &&
          r.blocks === 0 &&
          typeof r.original === 'string' &&
          r.original === String(r.passage ?? '').trim() &&
          typeof r.changed === 'string' &&
          r.changed.includes('午休') &&
          r.changed !== r.original
        );
      } catch {
        return false;
      }
    })(),
  ],
  /*
   * 打包产物里的「自己列成立条件」：这一轮新加的 @shared/conditions 若没进 asar，
   * 表现不是报错，是按钮点了没反应或导出文本里没有用户刚写的字。
   */
  [
    '打包产物里「自己列成立条件」写进去的字真的被重算了',
    (() => {
      const line = log.split('\n').find((l) => l.includes('CONDITIONSRESULT')) ?? '';
      if (!line) return false;
      try {
        const r = JSON.parse(line.slice(line.indexOf('{')));
        return (
          r.opened === true &&
          r.filled === true &&
          r.screen === true &&
          r.blocks === 0 &&
          typeof r.passage === 'string' &&
          r.passage === String(r.submitted ?? '').trim() &&
          typeof r.quote === 'string' &&
          r.quote.length > 20 &&
          String(r.take ?? '').includes('得先排除别的原因吗') &&
          String(r.stat ?? '').includes('写了 2 条')
        );
      } catch {
        return false;
      }
    })(),
  ],
  /*
   * 打包产物里的样本账：@shared/portfolio 或 passageScan 没进 asar 时，
   * 应用照常能跑，只是那一栏不出现、或数字是旧的。这里拿包内自己的
   * archive:list 当独立真值，不靠一个「看起来通顺」的数字。
   */
  [
    '打包产物里样本账的数目来自本地存档，不是写死的',
    (() => {
      const line = log.split('\n').find((l) => l.includes('PORTFOLIORESULT')) ?? '';
      if (!line) return false;
      try {
        const r = JSON.parse(line.slice(line.indexOf('{')));
        const m = String(r.line ?? '').match(/本机 (\d+) 份报告，落在 (\d+) 组不同的文字上/);
        return (
          r.opened === true &&
          r.detail === true &&
          r.detailBefore === false &&
          !!m &&
          Number(m[1]) > 0 &&
          Number(m[1]) === Number(r.listLen) &&
          Array.isArray(r.rows) &&
          r.rows.length === Number(m[2]) &&
          String(r.text ?? '').startsWith(String(r.line ?? ''))
        );
      } catch {
        return false;
      }
    })(),
  ],
  /*
   * 打包产物里的同题复跑：@shared/agreement 没进 asar 时，那一栏干脆不出现。
   * 遍数拿包内自己的 archive:list 当独立真值。
   */
  [
    '打包产物里同题复跑把两份报告摆到一起，遍数与存档索引一致',
    (() => {
      const line = log.split('\n').find((l) => l.includes('AGREEMENTRESULT')) ?? '';
      if (!line) return false;
      try {
        const r = JSON.parse(line.slice(line.indexOf('{')));
        const m = String(r.line ?? '').match(/最多的一组跑了 (\d+) 遍/);
        return (
          r.run === 'ok' &&
          r.opened === true &&
          r.detail === true &&
          r.detailBefore === false &&
          !!m &&
          Number(m[1]) === Number(r.listLen) &&
          /跑过不止一次的有 1 组/.test(String(r.line ?? '')) &&
          String(r.text ?? '').startsWith(String(r.line ?? ''))
        );
      } catch {
        return false;
      }
    })(),
  ],
  /*
   * 打包产物里的两份对照。
   *
   * `@shared/sideby` 与那个面板没进 asar 时，按钮点下去什么也不会开——而
   * 纯函数层的断言全在源码里跑，包坏不坏它都不知道。所以这里只问一句：
   * 点完之后面板开没开、处数与「同题复跑」那一栏是不是同一个数。
   */
  [
    '打包产物里两份对照打得开，处数与同题复跑同源',
    (() => {
      const line = log.split('\n').find((l) => l.includes('SIDEBYRESULT')) ?? '';
      if (!line) return false;
      try {
        const r = JSON.parse(line.slice(line.indexOf('{')));
        return (
          Number(r.btns) >= 2 &&
          r.cmpDisabledBefore === true &&
          Number(r.picked) === 2 &&
          r.disabledAfter === false &&
          r.open === true &&
          Number(r.rows) === 0 &&
          /逐字相同/.test(String(r.line ?? '')) &&
          Array.isArray(r.flags) &&
          r.flags.length === 4 &&
          r.closed === true
        );
      } catch {
        return false;
      }
    })(),
  ],
  /*
   * 打包产物里的「结论的口气」。
   *
   * `@shared/modal` 没进 asar 时，界面这一块整块消失——而纯函数层的 61 条全在源码里跑，
   * 包坏不坏它不知道。所以这里只问一句：包里这一块出现了，两句逐字是报告里的那两句，
   * 本地读到的那一处也对得上。
   */
  [
    '打包产物里的结论口气按原文逐字核了一遍',
    (() => {
      const line = log.split('\n').find((l) => l.includes('TONERESULT')) ?? '';
      if (!line) return false;
      try {
        const r = JSON.parse(line.slice(line.indexOf('{')));
        return (
          r.has === true &&
          r.source === '这说明取消早读是错的' &&
          r.claim === '取消早读是错的，应当恢复早读' &&
          Array.isArray(r.diffs) &&
          r.diffs.length === 1 &&
          r.diffs[0] === 'causal-dropped' &&
          /报告说越界/.test(String(r.cross ?? ''))
        );
      } catch {
        return false;
      }
    })(),
  ],
  /*
   * 打包产物里的「骨架缺口」。
   *
   * `@shared/skeleton` 没进 asar 时，界面这一块整块消失——而 check:skeleton 的 78 条
   * 全在源码里跑，包坏不坏它不知道。包内除了「这一块在」，还要核两条缺口的来源标签
   * 真的带进去了：本地数的那条与报告自己说的那条分得开，才算这一层进了包。
   */
  [
    '打包产物里的骨架缺口带着两种来源',
    (() => {
      const line = log.split('\n').find((l) => l.includes('GAPSRESULT')) ?? '';
      if (!line) return false;
      try {
        const r = JSON.parse(line.slice(line.indexOf('{')));
        const all = [r.line, r.sub, r.plain, ...(r.notes ?? []), ...(r.facts ?? [])].join(' ');
        return (
          r.has === true &&
          Number(r.gapCount) === 2 &&
          Array.isArray(r.kinds) &&
          r.kinds.join(',') === 'quiet-sentences,hollow-checks' &&
          Array.isArray(r.froms) &&
          r.froms.join(',') === 'local,report' &&
          Array.isArray(r.fromLabels) &&
          r.fromLabels.join(',') === '本地数的,报告自己说的' &&
          !/没答|未答/.test(all)
        );
      } catch {
        return false;
      }
    })(),
  ],
  /*
   * 打包产物里的「逐字比」。
   *
   * `@shared/rewrite` 没进 asar 时，每张主张卡上那一小块会整块消失，
   * 而 check:rewrite 全在源码里跑，包坏不坏它不知道。包内除了「这一块在」，
   * 还要核它贴在原话那行后面、以及片段明细真的带进去了。
   */
  [
    '打包产物里的逐字比贴在每张主张上',
    (() => {
      const line = log.split('\n').find((l) => l.includes('REWRITERESULT')) ?? '';
      if (!line) return false;
      try {
        const r = JSON.parse(line.slice(line.indexOf('{')));
        const cards = Array.isArray(r.cards) ? r.cards : [];
        const first = cards[0] ?? {};
        return (
          cards.length === 4 &&
          cards.every((c) => c.afterQuote === true && c.note === '只比字面，不判改写对不对；这两句都是报告自己写下的。') &&
          first.line === '本地逐字比：原话 10 字、这一句 14 字；1 段没接上、1 段对不上。' &&
          String(first.detail).includes('「这说明」') &&
          String(first.detail).includes('「应当恢复早读」')
        );
      } catch {
        return false;
      }
    })(),
  ],
  /*
   * 打包产物里的「谁跑的」：包内跑一次分析之后，报告里那一栏得在。
   *
   * 这一条与包外那条不完全重复：`Diagnosis.engine` 只有一个类型、逻辑全在 analyze.ts，
   * 但「类型改了、接线没进包」是最难看出来的一种坏法——外面全绿，用户拿到的那份 exe
   * 永远显示「没记模型」，下一轮看到 279 处差异时又只能猜。
   */
  [
    '打包产物里的报告记下了跑它的模型与生效温度',
    (() => {
      const line = log.split('\n').find((l) => l.includes('ENGINERESULT')) ?? '';
      if (!line) return false;
      try {
        const r = JSON.parse(line.slice(line.indexOf('{')));
        return (
          r.present === true &&
          typeof r.model === 'string' &&
          r.model === r.cfgModel &&
          typeof r.temperature === 'number' &&
          typeof r.ceiling === 'number' &&
          r.temperature === Math.min(r.cfgTemp, r.ceiling) &&
          r.keyLeak === false
        );
      } catch {
        return false;
      }
    })(),
  ],
  /*
   * 打包产物里的挑图：清单得在，勾掉之后图得真的消失，全显示时两张新图得画出来。
   *
   * 这一条与包外那条不重复：`@shared/views` 是纯函数，两张新图在另一个组件文件里——
   * 它们没进 asar 的典型表现不是报错，是那一栏干脆不出现，或者清单在、图永远不动。
   */
  [
    '打包产物里挑图真的能挑，两张新图也能画出来',
    (() => {
      const line = log.split('\n').find((l) => l.includes('VIEWSRESULT')) ?? '';
      if (!line) return false;
      try {
        const r = JSON.parse(line.slice(line.indexOf('{')));
        const before = r.before ?? {};
        const off = r.off ?? {};
        const all = r.all ?? {};
        return (
          before.bar === true &&
          Number(before.count) === 3 &&
          off.structSvg === false &&
          Array.isArray(off.offNotes) &&
          off.offNotes.includes('structure') &&
          all.refuteSvg === true &&
          all.repairSvg === true
        );
      } catch {
        return false;
      }
    })(),
  ],
  /*
   * 打包产物里的「下一句」：探针写的那句话得逐字回得来，账上的数目也得跟着动。
   *
   * 包内最可能坏的样子是「模块进了 asar、但主进程那条写盘路径没进」——
   * 界面照样显示「记下了」，文件里什么都没有。所以要求 disk 这一项也对得上。
   */
  [
    '打包产物里写下的「下一句」逐字存回去了',
    (() => {
      const line = log.split('\n').find((l) => l.includes('NEXTLINERESULT')) ?? '';
      if (!line) return false;
      try {
        const r = JSON.parse(line.slice(line.indexOf('{')));
        const TEXT = '这句话我确实想再问一句：那第二个数据是怎么来的';
        const before = Number(r.total);
        const s1 = r.s1 ?? {};
        const s2 = r.s2 ?? {};
        return (
          r.bar === true &&
          r.input === true &&
          r.belowReport === true &&
          r.typed === true &&
          r.saved === true &&
          Number(s1.total) === before + 1 &&
          String(s1.input ?? '') === '' &&
          Array.isArray(r.said) &&
          r.said[0] === TEXT &&
          Number(s2.total) === before + 2 &&
          String(s2.line ?? '').includes('逐字相同') &&
          Number(r.disk) === before + 2 &&
          String(r.text ?? '').includes(TEXT) &&
          r.deleted === true &&
          Number(r.afterDel2) === before
        );
      } catch {
        return false;
      }
    })(),
  ],
  ['流程无报错', /\bOK\b/.test(log)],
  ['截图产出', existsSync(shot)],
];

if (touched.length) {
  console.log(`\n真实目录被动过（${touched.length} 处，最多列 5 条）：`);
  for (const t of touched.slice(0, 5)) console.log(`  ${t}`);
}

for (const [name, pass] of checks) console.log(`${pass ? '通过' : '失败'}  ${name}`);
const ok = checks.every(([, p]) => p);
console.log(ok ? '打包产物自检通过' : '打包产物自检失败');
process.exit(ok ? 0 : 1);
