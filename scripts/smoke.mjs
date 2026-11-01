/**
 * 端到端冒烟：起假模型 → 预置配置 → 拉起真应用 → 填示例 → 点分析 → 验收渲染结果。
 *
 * 为什么要连假模型一起起：只验证「窗口能开」等于没测。这个产品的风险集中在中间那段——
 * IPC 传参、HTTP 调用、JSON 宽容解析、七道裁决、再到渲染。任何一环断了，窗口照样能开。
 *
 * 跑法：npm run smoke
 * 产物：scripts/.out/smoke.png / analyzed.png
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'scripts/.out');
mkdirSync(outDir, { recursive: true });

const MOCK_PORT = 8799;
const shot = resolve(outDir, 'analyzed.png');
const trace = `${shot}.log`;

const electronBin = resolve(root, 'node_modules/electron/dist/electron.exe');
if (!existsSync(electronBin)) {
  console.error('未找到 electron。先运行：node node_modules/electron/install.js');
  process.exit(1);
}

/*
 * 冒烟用自己的 userData 目录，不碰用户的那一份。
 *
 * 第一版不是这样：它把测试配置写进真实的 %APPDATA%/argument-lens/settings.json，
 * 退出时再删掉。两个后果，第二个是事故级的：
 *   1. 每跑一次就往用户的用量账本里记一笔假账、往历史里塞一份假报告；
 *   2. 退出时那句 rmSync 删的是**用户的** settings.json——API Key 一起没了。
 *      「跑一次构建检查，Key 没了」这种 bug 在源码里完全看不出来，因为它只发生在脚本分支里。
 * --user-data-dir 把这两件事一起解决：App 读写的都是临时目录，删光也不影响任何人。
 */
const smokeUserData = join(outDir, 'smoke-userdata');
rmSync(smokeUserData, { recursive: true, force: true });
mkdirSync(smokeUserData, { recursive: true });
const settingsFile = join(smokeUserData, 'settings.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * 模式：默认诊断。SMOKE_MODE 可传 diagnose / redteam / reconstruct / interrogate。
 *
 * 这里**必须**用 SMOKE_* 而不是 AL_*：AL_MODE 是传给子进程（应用）的那个，
 * 本进程读 AL_MODE 也能读到（因为 env 展开了），但读错名字会拿到 undefined，
 * 于是条件恒不成立、该项静默不跑——输出里既不通过也不失败，看上去像全绿。
 */
const SMOKE_MODE = process.env.SMOKE_MODE ?? 'diagnose';
/** 描述类模式不给判定，报告上要挂一条横幅解释为什么没有档位。 */
const DESCRIPTIVE = new Set(['reconstruct', 'interrogate']);

function waitForPort(port, tries = 40) {
  return new Promise((resolveP) => {
    const tick = async (n) => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [{ role: 'user', content: 'ping' }] }),
        });
        if (res.ok) return resolveP(true);
      } catch {
        /* 还没起来 */
      }
      if (n <= 0) return resolveP(false);
      setTimeout(() => tick(n - 1), 250);
    };
    tick(tries);
  });
}

const mock = spawn(process.execPath, [resolve(root, 'scripts/mock-llm.mjs')], {
  env: { ...process.env, MOCK_PORT: String(MOCK_PORT) },
  stdio: 'ignore',
});

const cleanup = () => {
  try {
    mock.kill();
  } catch {
    /* 已退出 */
  }
  // 临时目录里的测试配置：删掉是卫生，不是安全——它本来就不在用户的 profile 里
  try {
    rmSync(settingsFile, { force: true });
  } catch {
    /* 没写过 */
  }
};
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));

console.log('1/4 启动假模型…');
const up = await waitForPort(MOCK_PORT);
if (!up) {
  console.error(`假模型没起来（端口 ${MOCK_PORT} 可能被占用）。`);
  process.exit(1);
}

console.log('2/4 预置本地配置…');
mkdirSync(smokeUserData, { recursive: true });
writeFileSync(
  settingsFile,
  JSON.stringify(
    {
      baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`,
      model: 'mock-argument-lens',
      temperature: 0.2,
      apiKeyCipher: '',
      apiKeyPlain: 'test',
    },
    null,
    2
  ),
  'utf-8'
);

console.log('3/4 拉起应用并跑一次分析…');
rmSync(shot, { force: true });
rmSync(trace, { force: true });

const env = {
  ...process.env,
  AL_SMOKE: shot,
  AL_ACTION: 'analyze',
  // 默认拉高到 5200：报告一屏放不下，截成一次便于人眼核对。调小可以只看上半页。
  AL_SHOT_H: String(process.env.SMOKE_H ?? 5200),
  AL_SHOT_W: String(process.env.SMOKE_W ?? 1400),
  // 折叠区默认看不见。要验它，给 SMOKE_EXPAND 传选择器（如 .tcard），
  // 再给 SMOKE_SCROLL=1 让它滚进视野。不传就是原来的整页截图。
  ...(process.env.SMOKE_EXPAND ? { AL_EXPAND: process.env.SMOKE_EXPAND } : {}),
  ...(process.env.SMOKE_SCROLL === '1' ? { AL_EXPAND_SCROLL: '1' } : {}),
  // SMOKE_CLIP=选择器：只截某一块。长图能证明渲染出来了，不能证明排得对。
  ...(process.env.SMOKE_CLIP ? { AL_CLIP: process.env.SMOKE_CLIP } : {}),
  // SMOKE_CLICK / SMOKE_CLICK_CHECK：点一下、再验它有没有进视野（验跳转类交互用）
  ...(process.env.SMOKE_CLICK ? { AL_CLICK: process.env.SMOKE_CLICK } : {}),
  ...(process.env.SMOKE_CLICK_CHECK ? { AL_CLICK_CHECK: process.env.SMOKE_CLICK_CHECK } : {}),
  // SMOKE_PANEL=usage|disputes|history：跑完分析再点开某个面板
  ...(process.env.SMOKE_PANEL ? { AL_PANEL: process.env.SMOKE_PANEL } : {}),
  // SMOKE_MODE=<模式名>：切成该模式再跑。四种模式各自单独验，
  // 因为「新模式被静默降级成诊断」是这类改动最容易出的错：界面照常出报告。
  ...(process.env.SMOKE_MODE ? { AL_MODE: process.env.SMOKE_MODE } : {}),
  // SMOKE_REVISE=1：跑完再点「拿这一版再判一次」，验修订对照整条链
  ...(process.env.SMOKE_REVISE === '1' ? { AL_REVISE: '1' } : {}),
};
delete env.ELECTRON_RUN_AS_NODE; // 宿主注入它会让 Electron 退化成 node
delete env.AL_FORCE_ONBOARD;

const app = spawn(electronBin, [root, `--user-data-dir=${smokeUserData}`], { env, stdio: 'ignore' });

const done = await Promise.race([
  new Promise((r) => app.on('exit', () => r('exit'))),
  sleep(60_000).then(() => 'timeout'),
]);

console.log(`4/4 验收（${done}）…\n`);

if (!existsSync(trace)) {
  console.error('应用没有写出自检记录。窗口可能没创建，或被安全软件拦下。');
  process.exit(1);
}

const log = readFileSync(trace, 'utf-8');
const resultLine = log.split('\n').find((l) => l.includes('RESULT')) ?? '';
const domLine = log.split('\n').find((l) => l.includes('DOM')) ?? '';

/*
 * 板块数单独解析出来，既用于断言也打印。
 *
 * 原先写的是 `?.[1] >= 10`：① 拿字符串在比，靠隐式转换才没出错；
 * ② 门槛停在 10，而实际早就过了 13——加了三块之后这条断言一点没变紧，
 * 删掉两块它也照样绿。断言不跟着功能生长，就是慢慢变成假绿。
 *
 * 门槛 16 是实测值，不是拍的：诊断 18、提问 17（这两项本轮实测），
 * 红队 18、重构 16（本轮未单独跑成——环境的安全删除钩子拦了三次，
 * 所以这两个数是从上一轮实测的 17／15 各加一推出来的；「下一步」栏四个模式无条件渲染，
 * 加它只可能整体 +1）。
 *
 * 取四模式最小值，意味着任何一个模式少渲染一块都会响——这是有意的，掉了就该知道；
 * 写宽一格，这条断言就退回到只能防白屏。
 */
const blocks = Number(/"blocks":(\d+)/.exec(resultLine)?.[1] ?? 0);
const downCount = Number(/"stripDown":(\d+)/.exec(resultLine)?.[1] ?? 0);
console.log(`  板块 ${blocks} 块｜倒下的关卡 ${downCount} 处` + String.fromCharCode(10));

const checks = [
  ['应用启动并渲染', domLine.includes('"topbar":true')],
  ['六副透镜就位', domLine.includes('"lensChips":6')],
  ['preload 桥接可用', domLine.includes('"hasApi":true')],
  ['分析结果落屏', resultLine.includes('"grid":true')],
  ['板块全部渲染', blocks >= 16],
  ['无失败提示', resultLine.includes('"failed":false')],
  ['截图产出', existsSync(shot)],
  /*
   * 后加的四项。它们都是「附在既有页面上」的东西：
   * 少了页面照常跑，所以各自单独断言。异议按钮尤其要数——
   * 它是唯一一处让工具承认「可能是我错」的入口，静默消失最容易被忽略。
   */
  ['模式开关四档', resultLine.includes('"modeChips":4')],
  ['历史入口在顶栏', resultLine.includes('"histBtn":true')],
  ['切分条出现', resultLine.includes('"segBar":true')],
  ['异议按钮已挂载', /"objBtns":(\d+)/.exec(resultLine)?.[1] >= 1],
  /*
   * 「下一步」栏：至少一组、至少一条处方。
   * 数条目而不是只看标题——标题在、内容空，是这一栏最常见的坏法：
   * 推导函数一抛异常被 catch 掉，容器照样渲染，只是里面什么都没有。
   */
  ['下一步栏给出了处方', /"rxGroups":([1-9]\d*)/.test(resultLine) && /"rxItems":([1-9]\d*)/.test(resultLine)],
  ['导出按钮在', resultLine.includes('"expBtn":true')],
  // 几何：新元素不许宽或高为 0（数得出来但点不到），页面不许横向溢出（截图看不出来的那种坏）
  ['新元素都有实际尺寸', sizesOk()],
  ['无横向溢出', domObj().overflowX === 0],
  /*
   * 跑道上的「倒在哪一关」只在有判定的模式里出现。
   *
   * 描述类模式把 defeat.checkId 清空了，所以跑道上一处「倒下」都不该有——
   * 这两条在描述类下必须是**反向**断言：`stripDown:0`。
   * 若照抄判定类的写法，重构模式一跑就红，而红的原因是功能正确。
   * 反过来也别写成「>=0」那种恒真条件：那就是静默不跑。
   */
  [
    DESCRIPTIVE.has(SMOKE_MODE) ? '描述类模式不标「倒在哪一关」' : '跑道上标出倒下的那一关',
    DESCRIPTIVE.has(SMOKE_MODE)
      ? resultLine.includes('"stripDown":0')
      : /"stripDown":[1-9]/.test(resultLine),
  ],
  [
    DESCRIPTIVE.has(SMOKE_MODE) ? '描述类模式不写判定倒在哪' : '跑道写明判定倒在哪',
    DESCRIPTIVE.has(SMOKE_MODE)
      ? resultLine.includes('"stripDies":false')
      : resultLine.includes('"stripDies":true'),
  ],
  // 元问题闸门：数据里有 meta 才出现，所以只断言「类名挂着、不报错」
  ['元问题闸门机制在', resultLine.includes('"stripGate":')],
  /*
   * 模式横幅与当前选中的模式片，两条一起验。
   *
   * 只验横幅会漏掉「模式没真切、但横幅因为别的原因出现了」；
   * 只验选中片会漏掉「切了模式、报告却按诊断渲染」。
   * 判定类模式没有横幅（MODE_META.banner 为 null），所以期望值是「没有」——
   * 这个反向断言同样重要：诊断报告上挂一条「重构模式」的横幅，比没有横幅更糟。
   */
  [
    `当前选中模式是 ${SMOKE_MODE}`,
    (() => {
      const on = /"modeOn":"([a-z]*)"/.exec(resultLine)?.[1];
      return on === SMOKE_MODE;
    })(),
  ],
  /*
   * 横幅的判据从 modeOn 推出，不在脚本里另抄一份模式名单。
   * 抄名单的后果是加第五个模式时忘了改这里，于是横幅该有没有——
   * 而横幅是「这份报告为什么没有档位」的唯一解释处。
   *
   * 规则：诊断是默认口径，不需要解释；其余三种换的是主语或判不判，必须解释。
   */
  [
    `横幅与模式匹配（${SMOKE_MODE}）`,
    (() => {
      const on = /"modeOn":"([a-z]*)"/.exec(resultLine)?.[1];
      const banner = /"modeBanner":"([^"]*)"/.exec(resultLine)?.[1] ?? '';
      return on === 'diagnose' ? banner === '' : banner.length > 0;
    })(),
  ],
  // 同上：这里也必须读 SMOKE_PANEL。读错的话这一项是「静默不跑」，
  // 输出里既没有通过也没有失败，看上去像全过了——那是最坏的一种假绿。
  ...(process.env.SMOKE_PANEL === 'history'
    ? [['历史列表读到存档', /"rows":([1-9]\d*)/.test(panelLine())]]
    : []),
  ...(process.env.SMOKE_PANEL === 'prompt'
    ? [
        // 版本号与指纹：提示词改动后判定口径可能变，这两样是唯一能横向比对报告的凭据
        ['提示词页显示版本号', /v\d+\.\d+\.\d+/.test(panelLine())],
        ['提示词页显示指纹', /"meta":"[^"]*[0-9a-f]{8}/.test(panelLine())],
        ['提示词正文已加载', /"sysLen":(\d{4,})/.test(panelLine())],
      ]
    : []),
  ...(process.env.SMOKE_REVISE === '1'
    ? [
        ['修补版填回输入框', /REVISE fill=true pend=true chars=(\d+)/.test(log)],
        ['修订对照条出现', reviseLine().includes('"bar":true')],
        // 展开后的六项数字（判读 / 未答 / 明确没过 / 争议 / 命名候选 / 字数）。
        // 折叠着的对照条只有一句话，证明不了这些算出来了。
        ['对照数字算出', /"nums":([3-9]|\d\d+)/.test(openLine())],
        ['对照写明只按本透镜刻度', openLine().includes('只按这副透镜自己的刻度算')],
      ]
    : []),
];

function panelLine() {
  return log.split('\n').find((l) => l.includes('PANELDOM')) ?? '';
}

function reviseLine() {
  return log.split('\n').find((l) => l.includes('REVISERESULT')) ?? '';
}

function openLine() {
  return log.split('\n').find((l) => l.includes('REVISEOPEN')) ?? '';
}

/** DOM 探针那行是 JSON，正经解析它——拿正则抠嵌套数组迟早抠出错来。 */
function domObj() {
  try {
    return JSON.parse(domLine.replace(/^.*?DOM /, ''));
  } catch {
    return {};
  }
}

function sizesOk() {
  const raw = domObj().sizes;
  let arr;
  try {
    arr = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!Array.isArray(arr) || arr.length < 4) return false;
  // [选择器, 宽, 高]。元素不存在时是 [-1,-1]。
  return arr.every(([, w, h]) => w > 0 && h > 0);
}

let allOk = true;
for (const [name, ok] of checks) {
  console.log(`${ok ? '通过' : '失败'}  ${name}`);
  if (!ok) allOk = false;
}

if (existsSync(shot)) {
  console.log(`\n截图：${shot}（${(statSync(shot).size / 1024).toFixed(0)} KB）`);
}
if (!allOk) {
  console.log('\n──── 自检记录 ────');
  console.log(readFileSync(trace, 'utf-8'));
}

console.log(allOk ? '\n端到端通过。' : '\n有问题，看上面的记录。');
cleanup();
process.exit(allOk ? 0 : 1);
