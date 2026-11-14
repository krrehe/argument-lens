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
/** SMOKE_RUNNING=1 时「分析进行中」那一屏的截图 */
const runShot = resolve(outDir, 'running.png');
/** SMOKE_CANCEL=1 时「按停之后」那一屏的截图 */
const cancelShot = resolve(outDir, 'canceled.png');
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
 * 模式：默认诊断。SMOKE_MODE 可传 diagnose / redteam / fallacy / reconstruct / interrogate。
 *
 * 这里**必须**用 SMOKE_* 而不是 AL_*：AL_MODE 是传给子进程（应用）的那个，
 * 本进程读 AL_MODE 也能读到（因为 env 展开了），但读错名字会拿到 undefined，
 * 于是条件恒不成立、该项静默不跑——输出里既不通过也不失败，看上去像全绿。
 */
const SMOKE_MODE = process.env.SMOKE_MODE ?? 'diagnose';
/**
 * 不给判定的模式：报告上要挂一条横幅解释为什么没有档位，
 * 而且跑道上不许出现「倒在哪一关」——它们把 defeat.checkId 清空了。
 *
 * 查谬误模式也在这一组里：它给名字，但不给档位、不给落点。
 * 名字在不在，由下面那条从 DOM 读出的 data-labels 单独判，不混进这一组——
 * 混进来的话，一份「模式对了但命名栏整个空着」的报告会照样全绿。
 */
const NO_VERDICT = new Set(['fallacy', 'reconstruct', 'interrogate']);

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
      /* 故意高于诊断模式的上限 0.2：这样「记的是生效温度还是设置页填的数字」
         在端到端里才是两件事。填 0.2 的话 min(0.2, 0.2) 两种实现都对，断言会白绿。 */
      temperature: 0.9,
      apiKeyCipher: '',
      /* 冒烟专用假 Key，故意挑一个不会在别处出现的串：下面「报告里搜不到 Key」那条
         拿它当 canary，用 'test' 这种常见词会偶发误红。 */
      apiKeyPlain: 'sk-canary-7c1f9e2b-do-not-leak',
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
  /*
   * SMOKE_EMPTY=1：不分析，验首屏空态。
   * 空态是每个新用户的第一屏，而默认跑道永远带着一份报告——
   * 没有这条岔路，空态的改动只能靠运气发现坏没坏。
   */
  ...(process.env.SMOKE_EMPTY === '1' ? { AL_EMPTY: '1' } : { AL_ACTION: 'analyze' }),
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
  /*
   * 查谬误模式下自动加一次「点命名卡」：验的是命名卡与落点图的双向对位。
   *
   * 单向联动（点图上的胶囊 → 卡亮边框）只解决一半；用户更常见的动作是从卡出发——
   * 读完四样代价后想知道「那这句在原文第几句」。AL_CLICK_CHECK 指到「图上高亮的胶囊」，
   * 点完它必须存在：不存在说明点了没反应，而点了没反应在截图里完全看不出来。
   * 手传了 SMOKE_CLICK 时不覆盖——那是人指定的目标，别替他改。
   */
  ...(process.env.SMOKE_MODE === 'fallacy' && !process.env.SMOKE_CLICK
    ? { AL_CLICK: '.cand-head .nm-btn', AL_CLICK_CHECK: '.fmap-chip.on' }
    : {}),
  ...(process.env.SMOKE_CLICK_CHECK ? { AL_CLICK_CHECK: process.env.SMOKE_CLICK_CHECK } : {}),
  // SMOKE_PANEL=usage|disputes|history：跑完分析再点开某个面板
  ...(process.env.SMOKE_PANEL ? { AL_PANEL: process.env.SMOKE_PANEL } : {}),
  // SMOKE_MODE=<模式名>：切成该模式再跑。五种模式各自单独验，
  // 因为「新模式被静默降级成诊断」是这类改动最容易出的错：界面照常出报告。
  ...(process.env.SMOKE_MODE ? { AL_MODE: process.env.SMOKE_MODE } : {}),
  // SMOKE_REVISE=1：跑完再点「拿这一版再判一次」，验修订对照整条链
  ...(process.env.SMOKE_REVISE === '1' ? { AL_REVISE: '1' } : {}),
  // SMOKE_REREAD=1：跑完再点开「回到原文重读」，验原文逐字没改、报告让位、回得去
  ...(process.env.SMOKE_REREAD === '1' ? { AL_REREAD: '1' } : {}),
  // SMOKE_RESCALE=1：跑完再点开「换个尺度读」，由探针往输入框填词，验本地重算
  ...(process.env.SMOKE_RESCALE === '1' ? { AL_RESCALE: '1' } : {}),
  // SMOKE_CONDITIONS=1：跑完再点开「自己列成立条件」，由探针写条件、点三态、挂原文句子
  ...(process.env.SMOKE_CONDITIONS === '1' ? { AL_CONDITIONS: '1' } : {}),
  // SMOKE_PORTFOLIO=1：点开样本账，拿 archive:list 当独立真值核界面上的数目
  ...(process.env.SMOKE_PORTFOLIO === '1' ? { AL_PORTFOLIO: '1' } : {}),
  // SMOKE_NEXTLINE=1：报告末尾写一句、记下、再记一遍、删掉，验原话逐字存回去
  ...(process.env.SMOKE_NEXTLINE === '1' ? { AL_NEXTLINE: '1' } : {}),
  // SMOKE_AGREEMENT=1：让同一段字再跑一遍，验「同题复跑」那一栏真的在数
  ...(process.env.SMOKE_AGREEMENT === '1' ? { AL_AGREEMENT: '1' } : {}),
  // SMOKE_VIEWS=1：挑图——勾掉一张图、全显示、只留默认三张，验图真的跟着变
  ...(process.env.SMOKE_VIEWS === '1' ? { AL_VIEWS: '1' } : {}),
  /*
   * SMOKE_CAPTURE_OFF=1：不注册全局快捷键。
   *
   * 「注册成功」那条路每趟都跑；失败那条不跑，等于只验了一半——
   * 而失败那一半才是这个功能真正容易坏的地方（键被占用是常态，
   * 界面这时必须说「没启用」，不能继续教人按一个不响的键）。
   */
  ...(process.env.SMOKE_CAPTURE_OFF === '1' ? { AL_CAPTURE_ACCELERATOR: 'off' } : {}),
  /*
   * SMOKE_RUNNING=1：验「分析进行中」那一屏。要配 MOCK_DELAY_MS=4000 左右一起用，
   * 否则假模型 200 毫秒就回来，那一屏来不及出现在截图里——来不及出现就等于没验。
   */
  ...(process.env.SMOKE_RUNNING === '1' ? { AL_RUNSHOT: runShot } : {}),
  /*
   * SMOKE_CANCEL=1：跑起来之后按「停」。必须配 MOCK_DELAY_MS，
   * 否则请求在按钮出现之前就回来了——那时 abort 打在空气上，
   * 界面会老实说「没赶上」，而验收会红。红得对：没跑到就是没验。
   */
  ...(process.env.SMOKE_CANCEL === '1' ? { AL_CANCEL: '1', AL_CANCEL_SHOT: cancelShot } : {}),
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
/*
 * 只认以「DOM {」开头的那一行，不用 includes('DOM')。
 *
 * 教训：新加的 BRIEFCARD 那行先出现，而它的名字里也含 DOM 三个字母——
 * 于是 DOM 这一行被抓成了立案卡那一行，五条依赖它的断言一起红，
 * 报的却是「应用启动并渲染」「无横向溢出」，指向完全不相干的地方。
 */
const domLine = log.split('\n').find((l) => /(^|\s)DOM \{/.test(l)) ?? '';
/** 示例轮换那一行。写在应用里的一条日志，取第一条即可。 */
const samplesLine = log.split('\n').find((l) => l.includes('SAMPLES ')) ?? '';
/** 从日志行里取一个字段。取不到给空串——空串会让相关断言自己失败，而不是抛异常把整趟冒烟打断。 */
function jOf(line, key) {
  try {
    return String(JSON.parse(line.slice(line.indexOf('{')))[key] ?? '');
  } catch {
    return '';
  }
}

/*
 * 首屏空态跑道（SMOKE_EMPTY=1）。
 *
 * 它的断言与报告跑道完全不同——那边验「报告里每块都在」，这边验「没有报告时页面说了什么」。
 * 空态的三样东西各自单独断言，因为它们坏法不同：
 *   整块消失（empty:false）→ 用户对着一片空白，不知道该干什么；
 *   步骤缺一步（steps<3）→ 新用户在第二步迷路；
 *   模式提示没跟上（modeChips≠5）→ 加模式时漏改了空态文案，首屏与功能脱节。
 */
if (process.env.SMOKE_EMPTY === '1') {
  const line = log.split('\n').find((l) => l.includes('EMPTYDOM')) ?? '';
  const j = (k, d = '') => {
    try {
      return JSON.parse(line.slice(line.indexOf('{')))[k] ?? d;
    } catch {
      return d;
    }
  };
  const emptyChecks = [
    ['首屏空态在', line.includes('"empty":true')],
    ['空态标题不是空串', j('title').length >= 4],
    ['三步引导齐', j('steps') === 3],
    ['报告样例四步齐', j('emSteps') === 4],
    ['模式开关五档（空态同款跑道）', j('modeChips') === 5],
    ['模式提示不是空串', j('modeNote').length >= 4],
    ['空态文案与功能一致（提到查谬误）', j('emptyP').includes('查谬误')],
    ['截图产出', existsSync(shot)],
  ];
  let bad = 0;
  for (const [name, pass] of emptyChecks) {
    console.log(`${pass ? '通过' : '失败'}  ${name}`);
    if (!pass) bad++;
  }
  console.log(bad ? `\n首屏空态验收失败 ${bad} 项` : '\n首屏空态端到端通过。');
  process.exit(bad ? 1 : 0);
}

/*
 * 按下「停」（SMOKE_CANCEL=1，要配 MOCK_DELAY_MS=3000 左右）。
 *
 * 这一屏的风险方向和别的都不同：它怕的是「看起来停了」。按钮点了、界面回到可用状态、
 * 一条提示也没有——而请求还在跑、钱还在花。所以每一条断言都对着一个具体的谎：
 *   gone/running  请求真的被掐掉了（不是界面假装不等了）
 *   bad=false     它没被当成故障（红条写着「分析未完成」，用户会去排查配置）
 *   stopNote      说了「已停」，也说了计费照收（不说，用户会以为省下了钱）
 *   text>20       原文还在（停了要能改完再跑，不必重新粘一遍）
 *   btnOff=false  「分析」恢复可点（这是「回到可操作状态」的定义）
 *   archived=0    历史里没有多出半份报告（停在半路的不是结果）
 * 最后一条只能从主进程数——存档是主进程写的，界面上看不见它有没有写。
 */
if (process.env.SMOKE_CANCEL === '1') {
  const line = log.split('\n').find((l) => l.includes('CANCEL {')) ?? '';
  const j = (k, d = '') => {
    try {
      return JSON.parse(line.slice(line.indexOf('{')))[k] ?? d;
    } catch {
      return d;
    }
  };
  const note = String(j('stopNote'));
  const cancelChecks = [
    ['「停」按钮在', j('btn') === true],
    ['按下去有反应', j('clicked') === true],
    ['请求真的停下了', j('gone') === true],
    /*
     * 时间上界才是「停」的证据。
     *
     * 只验「面板没了」会被一种坏法骗过去：abort 没接上，于是界面一直转到模型
     * 自己回来为止——面板照样消失，用户却白等了三秒，钱也照花。
     * 假模型这次拖 3 秒，所以 1.5 秒以内消失只可能是被掐掉的。
     */
    ['停是立刻生效的（1.5 秒内）', Number(j('stopMs', 99999)) < 1500],
    ['进行中面板已撤', j('running') === false],
    ['没有被当成故障（无红条）', j('bad') === false],
    ['说了「已停」', note.includes('已停')],
    /*
     * 文案要对得上账本里真会发生的事。
     *
     * 停下来的那次调用会写一条 ok=false 的记录：token 按字数估、金额记 0、
     * 余额不扣。所以这里断言的是「记 0」与「钱可能已经花了」——
     * 早一版的文案写的是「账本里不会留下这一条」，那是假的：
     * 用户按图去账本里翻，会看到那一行，然后不知道该信哪个。
     */
    ['交代了账本里会记一条失败', note.includes('失败记录') && note.includes('记 0')],
    ['说了钱可能已经花了', note.includes('花了')],
    ['原文还在输入框里', Number(j('text', 0)) > 20],
    ['「分析」恢复可点', j('btnOff') === false],
    ['停在半路的没有存成一份报告', j('grid') === false],
    ['历史里没有多出一份', Number(j('archived', -1)) === 0],
    ['截图产出', existsSync(cancelShot)],
  ];
  let bad = 0;
  for (const [name, pass] of cancelChecks) {
    console.log(`${pass ? '通过' : '失败'}  ${name}`);
    if (!pass) bad++;
  }
  console.log(bad ? `\n按停验收失败 ${bad} 项` : '\n按停端到端通过。');
  process.exit(bad ? 1 : 0);
}

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

const cap = capObj();
const checks = [
  ['应用启动并渲染', domLine.includes('"topbar":true')],
  ['六副透镜就位', domLine.includes('"lensChips":6')],
  ['preload 桥接可用', domLine.includes('"hasApi":true')],
  /*
   * 示例轮换（四条）。
   *
   * 这一组守的是「同一个样本跑一百遍」那个坑：示例只有一段时，
   * 按钮照样能按、照样填字，只是永远填同一段——没有任何报错。
   * 存档里那一百多份报告，就是它一路留在这个状态下的产物。
   *
   * 段数不写死在脚本里，从按钮标签读（「示例 1/6」→ 6）；
   * 抄一份段数进脚本，加第七段时必然漏改，而漏改的表现是断言静默少跑。
   */
  ['示例按钮在', /"found":true/.test(samplesLine)],
  ['示例段数从标签读得出', Number(jOf(samplesLine, 'N')) >= 5],
  [
    '连按一圈得到段数那么多段不同的文本',
    Number(jOf(samplesLine, 'distinct')) === Number(jOf(samplesLine, 'N')),
  ],
  ['每段的体裁名互不相同（不是换汤不换药）', Number(jOf(samplesLine, 'genresDistinct')) === Number(jOf(samplesLine, 'N'))],
  /*
   * 「回到第一段」单看是一条恒真断言：轮换整个坏掉、永远填第一段时，它天然成立。
   * 所以必须和「六段确实各不相同」一起看——两个都成立，才说明它是转圈而不是停着不动。
   */
  [
    '绕完一圈回到第一段（是轮换，不是耗完即止）',
    samplesLine.includes('"backToFirst":true') &&
      Number(jOf(samplesLine, 'distinct')) === Number(jOf(samplesLine, 'N')),
  ],
  /*
   * 标签要跟着换。只比 label0 与「绕完一圈之后」的标签是不行的：
   * 绕完一圈本来就该回到「示例 1/6」，两者相同是正确行为，不是证据。
   * 要的是「点过第一次之后」——那一刻它必须已经指向下一段。
   */
  ['按钮标签跟着换（否则用户不知道还有别的）', jOf(samplesLine, 'label0') !== jOf(samplesLine, 'labelAfterFirst')],
  /*
   * 框里是自己的字时，第一下只问、第二下才换。
   * 输入框没有撤销：这一条坏了，用户粘贴的一段话会在手滑一下之后消失，
   * 而界面不会报错、也不会提示——只会安静地变成一段示例。
   */
  ['框里是自己的字时，第一下不覆盖', samplesLine.includes('"mineKept":true')],
  ['第一下把按钮换成「覆盖原文？」', samplesLine.includes('"askShown":true')],
  ['第二下才真的替换', samplesLine.includes('"replaced":true')],
  ['替换完把输入框放回第一段（后面的假模型按它算下标）', samplesLine.includes('"restored":true')],
  ['「覆盖原文？」那一瞬被拍到了', existsSync(resolve(outDir, 'sample-confirm.png'))],
  /*
   * 「这段文字跑过没有」。
   *
   * 这一组和上面那组是同一个问题的两头：示例那一组防的是「按钮只给一段」，
   * 这一组防的是「跑了也不说」。分析完这一趟，存档里必然已经有同一段文字至少一份，
   * 所以那一行必须出现，而且必须说的是「已经跑过」，不是含糊的「有重合」。
   *
   * 只验「条在」不够：条渲染成一句空话也照样在。所以数量和句子一起验。
   */
  ['跑完之后「这段跑过没有」出现了', Number(jOf(resultLine, 'sameCount')) >= 1],
  ['那一行说的是「已经跑过」，不是含糊的重合', jOf(resultLine, 'sameText').includes('已经跑过')],
  ['分析结果落屏', resultLine.includes('"grid":true')],
  ['板块全部渲染', blocks >= 16],
  ['无失败提示', resultLine.includes('"failed":false')],
  /*
   * 「有一件事没做成」的提示条必须是 0。
   *
   * 这条断言的方向和上面几项相反：别的元素是怕少，它是怕多——
   * 冒烟这一趟存档与异议都写成功了，此时冒出一条「没能存进历史」，
   * 说明 saved 那个标志被读反了或根本没送过来。那种错不会崩、也不报错，
   * 只是每次分析都给用户一句假话。
   */
  ['没有凭空出现的失败提示条', resultLine.includes('"noticeBars":0')],
  ['截图产出', existsSync(shot)],
  /*
   * 后加的四项。它们都是「附在既有页面上」的东西：
   * 少了页面照常跑，所以各自单独断言。异议按钮尤其要数——
   * 它是唯一一处让工具承认「可能是我错」的入口，静默消失最容易被忽略。
   */
  ['模式开关五档', resultLine.includes('"modeChips":5')],
  /*
   * 命名栏与模式的契约。
   *
   * 期望值不从脚本里的模式名单推，而是从选中按钮上的 data-labels 读——
   * 那个属性由 MODE_META.allowsLabels 生成。抄一份名单进脚本，加模式时必漏改，
   * 而漏改的表现是这条断言静默不跑：既不通过也不失败，看上去像全绿。
   *
   * 两个方向都要判：
   *   allowsLabels=0 → 一张卡片都不许有（命名是评价，与「只描述」冲突）
   *   allowsLabels=1 → 至少一张卡片，且至少一张带原文位置（缺位置的会被 G11 丢掉）
   * 读不到 data-labels 直接判红，不当作通过——那正是「静默跳过」的样子。
   */
  [
    '命名栏与模式相符',
    (() => {
      const allows = /"modeLabels":"([01])"/.exec(resultLine)?.[1];
      const cards = Number(/"labelCards":(\d+)/.exec(resultLine)?.[1] ?? -1);
      const quotes = Number(/"candQuote":(\d+)/.exec(resultLine)?.[1] ?? -1);
      if (allows === '0') return cards === 0;
      if (allows === '1') return cards >= 1 && quotes >= 1;
      return false;
    })(),
  ],
  /*
   * 落点图：查谬误模式下必须有格子且有命中格；其他模式不渲染，数值为 0 是对的。
   * 反向也断言：判定类模式下若 fmap 出现了，说明渲染条件写松了——图跟着数据走，
   * 但「名录对照」模式下它不该出现（那里名字是末端注释，不配一张图）。
   * mock 报告的两条命名都带真实 span，所以命中格必须 ≥1：全 0 就是定位链路断了。
   */
  [
    SMOKE_MODE === 'fallacy' ? '落点图有格子且有命中' : '非查谬误模式不出落点图',
    SMOKE_MODE === 'fallacy'
      ? /"fmapSent":[1-9]/.test(resultLine) && /"fmapHit":[1-9]/.test(resultLine)
      : resultLine.includes('"fmapSent":0'),
  ],
  /*
   * 命名卡 → 落点图：点了名字，图上对应的胶囊必须亮起来。
   * 只在查谬误模式下断言——别的模式不给按钮（点了没反应的按钮不如不给），也就没有这条。
   */
  ...(SMOKE_MODE === 'fallacy'
    ? [
        [
          '点命名卡 → 图上对应句高亮',
          (() => {
            const line = log.split('\n').find((l) => l.includes('CLICK ')) ?? '';
            return line.includes('.cand-head .nm-btn=clicked') && line.includes('"found":true');
          })(),
        ],
      ]
    : []),
  ['历史入口在顶栏', resultLine.includes('"histBtn":true')],
  ['切分条出现', resultLine.includes('"segBar":true')],
  ['异议按钮已挂载', /"objBtns":(\d+)/.exec(resultLine)?.[1] >= 1],
  /*
   * 「下一步」栏：至少一组、至少一条处方。
   * 数条目而不是只看标题——标题在、内容空，是这一栏最常见的坏法：
   * 推导函数一抛异常被 catch 掉，容器照样渲染，只是里面什么都没有。
   */
  ['下一步栏给出了处方', /"rxGroups":([1-9]\d*)/.test(resultLine) && /"rxItems":([1-9]\d*)/.test(resultLine)],
  /*
   * 三个出口，逐个点名。
   *
   * 这一条原来写的是 `length === 2`，加上「导出为画布工程」之后它就红了——
   * 而那一轮只跑了 `pack:check`，没人跑冒烟，于是它红着躺了一整轮。
   * 现在的写法对「加了一个出口」这件事是**会红的**（`every` 要求每个都在名单里），
   * 加出口的人必须来改这里；但不再靠一个总数去猜。
   * 「复制 Markdown」加上来时这一条果然红了——它是第四个出口，虽然不落盘。
   */
  ['四个出口（Markdown / Argdown / 画布工程 / 复制）', (() => {
    try {
      const btns = JSON.parse(resultLine.slice(resultLine.indexOf('{')))?.expBtns;
      const want = ['Markdown', 'Argdown', '画布工程', '复制'];
      return (
        Array.isArray(btns) &&
        btns.length === want.length &&
        want.every((w) => btns.some((t) => String(t).includes(w)))
      );
    } catch {
      return false;
    }
  })()],
  /*
   * 「复制 Markdown」真的写进了系统剪贴板。
   *
   * 纯函数断言只守得住「复制的内容与导出的 .md 同一份」（check:after），
   * 守不住「点下去有没有真的写进去」：按钮在、handler 名字对，通道却断了的话，
   * 界面上只会显示一行「没能写进剪贴板」，而没人会去点它。
   * 读的是主进程剪贴板里那一段，不是组件 state；探针读完把原来的内容还回去。
   */
  ['「复制 Markdown」真的把报告写进了剪贴板', (() => {
    /* 这里自己解析那一行：`jOfLine` 定义在文件后半段，此刻还没初始化（const 的 TDZ）。 */
    const line = log.split('\n').find((l) => l.includes('AFTERRESULT')) ?? '';
    if (!line) return false;
    try {
      const r = JSON.parse(line.slice(line.indexOf('{')));
      return (
        r.clicked === true &&
        Number(r.chars ?? 0) > 800 &&
        String(r.head ?? '').startsWith('# 论证分析') &&
        Number(r.sections ?? 0) >= 3 &&
        /字已复制/.test(String(r.line ?? ''))
      );
    } catch {
      return false;
    }
  })()],
  /*
   * 命题账。纯本地推导，条数跟着模型给的前提走，所以不钉死数字；
   * 守的是「挂上了 / 分到组了 / 每行露出依据与改归条件」这三件会单独坏的事。
   * 它坏起来很安静：四个标签一字排开，看上去仍是一栏，实际只是把标签又贴了一遍。
   */
  ['命题账：挂上了，且每行都带依据与改归条件', (() => {
    try {
      const r = JSON.parse(resultLine.slice(resultLine.indexOf('{')));
      return (
        Number(r.propRows ?? 0) >= 2 &&
        Number(r.propGroups ?? 0) >= 1 &&
        /凭什么这么归/.test(String(r.propBasis ?? '')) &&
        /什么条件下改归/.test(String(r.propIf ?? ''))
      );
    } catch {
      return false;
    }
  })()],
  /*
   * 枢纽前提。条数跟着报告里的支撑关系走，不钉死；守的是三件会单独坏的事——
   * 挂没挂上、有没有主句、排序规则有没有跟着印出来。
   * 第三件最要紧：一个排名悬在半空（只有「枢纽」两个字，没有凭什么）就成了判决。
   */
  ['枢纽前提：挂上了，主句与排序规则都在', (() => {
    try {
      const r = JSON.parse(resultLine.slice(resultLine.indexOf('{')));
      return (
        Number(r.pivRows ?? 0) >= 1 &&
        /当前提用/.test(String(r.pivHead ?? '')) &&
        (r.pivBadges ?? []).includes('枢纽') &&
        Number(r.pivSigs ?? 0) >= 1 &&
        /排序按/.test(String(r.pivNote ?? '')) &&
        String(r.pivNext ?? '').length > 0
      );
    } catch {
      return false;
    }
  })()],
  /*
   * 全流程账：十六步、顺序、以及「立案填没填」与报告那边说的是不是同一件事。
   *
   * 最后这一条是这里最值钱的一条：输入区那张卡与报告里那一栏是两处独立的 DOM，
   * 一边填了另一边没认，界面上不会报任何错——只会显示成「没立案」，
   * 而「没立案」正是默认状态，看起来完全正常。所以断言必须把两边对着比：
   * 填了 → A1 必须是「做了」；没填 → A1 必须是「没做」且说出「判在立案之前」。
   */
  ['全流程账：十六步都在，顺序与文档 §1 一致', (() => {
    try {
      const r = JSON.parse(resultLine.slice(resultLine.indexOf('{')));
      const ids = Array.isArray(r.flowIds) ? r.flowIds.join(',') : '';
      return (
        Number(r.flowRows ?? 0) === 16 &&
        ids === 'A1,A2,A3,B1,B2,B3,B4,C1,C2,C3,D1,D2,D3,E1,E2,E3' &&
        ['quick', 'standard', 'audit'].includes(String(r.flowDepth ?? '')) &&
        /步/.test(String(r.flowLine ?? ''))
      );
    } catch {
      return false;
    }
  })()],
  ['全流程账：输入区填的立案，报告那边认了没有', (() => {
    try {
      const r = JSON.parse(resultLine.slice(resultLine.indexOf('{')));
      const filled = String(r.flowBrief ?? '') === '1';
      if (filled) return r.flowA1 === 'ok' && r.flowA2 === 'ok';
      /* 没填：A2 在任何一档都是必须的，所以必须是缺；A1 在速判档里本来就不走。 */
      const a1Wanted = String(r.flowDepth ?? '') === 'quick' ? 'na' : 'gap';
      return r.flowA1 === a1Wanted && r.flowA2 === 'gap';
    } catch {
      return false;
    }
  })()],
  ['全流程账：没立案却给了档位 → 说「判在立案之前」', (() => {
    try {
      const r = JSON.parse(resultLine.slice(resultLine.indexOf('{')));
      const filled = String(r.flowBrief ?? '') === '1';
      /* 填了立案就不该有这句；没填就该有（速判档也要求 A2 准入）。 */
      return filled ? r.flowBreach === false : r.flowBreach === true;
    } catch {
      return false;
    }
  })()],
  /*
   * 「跳到」条：新加的两栏进得去，且每一格都落到真有的区块。
   * 这条只有真应用能验：格子是「数据有没有」现算出来的，静态样本可以两边都对，
   * 到了真报告上仍然可能出现一格点了没反应——那看起来像软件卡了一下。
   */
  ['「跳到」条：命题账与枢纽进得去，且每一格都落得到', (() => {
    try {
      const r = JSON.parse(resultLine.slice(resultLine.indexOf('{')));
      const q = Array.isArray(r.qnav) ? r.qnav : [];
      return q.includes('sec-props') && q.includes('sec-pivot') && Number(r.qnavDead ?? 1) === 0 && r.qnavOrder === true;
    } catch {
      return false;
    }
  })()],
  /*
   * 异议账：记一条之前不出现、记了之后出来、展开能看见理由、撤销之后整块消失。
   *
   * 它只在「这份报告里有过异议」时出现，所以真应用里从来没有被人看见过——
   * 预览页能拍版式，拍不到「点了真的记上、记上真的能回到那一节」。
   */
  ...(() => {
    const line = log.split('\n').find((l) => l.includes('DIGESTRESULT')) ?? '';
    if (!line) {
      return [['异议账：真应用里记一条之后出现（探针没跑也算失败）', false]];
    }
    try {
      const r = JSON.parse(line.slice(line.indexOf('{')));
      const after = r.after ?? {};
      const open = r.open ?? {};
      return [
        ['异议账：记之前不出现（不摆「暂无异议」的空壳）', r.before === false],
        ['异议账：记一条之后出现，且数目是 1', r.saved === true && after.present === true && Number(after.total) === 1],
        ['异议账：逐条展开有一条，且带「跳到这一节」', r.opened === true && Number(open.items) === 1 && Number(open.jumps) >= 1],
        [
          '异议账：理由逐字是刚才打的那句话',
          /这一条的依据只举了一个学校的例子，不足以支撑整句/.test(String(open.text ?? '')),
        ],
        [
          '异议账：点「跳到这一节」真的落到那一节（不在折叠状态下停住）',
          r.jump?.clicked === true &&
            r.landed?.found === true &&
            r.landed?.id === r.jump?.id &&
            r.landed?.inView === true &&
            r.landed?.folded === false,
        ],
        ['异议账：撤销之后整块消失（没有留下 0 条的壳）', r.undone === true && r.stillThere === false],
      ];
    } catch {
      return [['异议账：结果行能解析', false]];
    }
  })(),
  /*
   * 「接着读」：重开一份报告时那句话说不说得出来。
   *
   * 三种坏法都在这五条里：没有记录也冒出一句（把自己说成记得）、
   * 记错了节（说第七节、点下去落到第五节）、以及最常见的一种——
   * 重开时**自动**滚过去：读者从此失去了「打开先看看标题」这个动作。
   */
  ...(() => {
    const line = log.split('\n').find((l) => l.includes('RESUMERESULT')) ?? '';
    if (!line) {
      return [['接着读：真应用里打开—跳节—重开—点它（探针没跑也算失败）', false]];
    }
    try {
      const r = JSON.parse(line.slice(line.indexOf('{')));
      const n = Number((String(r.before?.jumpLabel ?? '').match(/(\d+)/) ?? [])[1] ?? 0);
      const rec = r.rec ?? {};
      const rv = r.resume ?? {};
      return [
        ['接着读：刚打开的这份报告没有那句话（新报告没有记录）', r.before?.shown === false && Number(r.before?.marks) === 0],
        ['接着读：点了「先看判读」之后记住的是判读那一节', r.clicked === true && Number(rec.count) === 1 && Number(rec.index) === n - 1 && /判读/.test(String(rec.title ?? ''))],
        [
          '接着读：重开时那句话写着第几节、哪一节',
          rv.vis === true && String(rv.at ?? '') === String(n) && new RegExp('第\\s*' + n + '\\s*节').test(String(rv.text ?? '')) && /判读/.test(String(rv.text ?? '')),
        ],
        ['接着读：重开不会自动滚过去（从哪读起是读者的事）', Math.abs(Number(rv.scrollAfter ?? -1) - Number(r.scrollBefore ?? -1)) <= 2],
        ['接着读：点它真的落到那一节', r.tapped === true && r.landed?.inView === true && Number(r.landed?.n) === n],
      ];
    } catch {
      return [['接着读：结果行能解析', false]];
    }
  })(),
  /*
   * 接着读的第二层：节内那一段。
   *
   * 这一层比节更容易说假话——「第 7 节」错了，至少人一回滚就发现自己在别的节；
   * 「第 3 段」错了，人落在节里的另一段上，看上去完全正常。四件事各守一种：
   *   ① 记下的是不是屏幕上那一块（序号对、开头逐字对）；
   *   ② 那句话说不说得出第几段；
   *   ③ 引文是不是那一块的字（不是随手截的）；
   *   ④ 点下去落不落在这一段上。
   * 另外先守一条「验得了」：判读这一节得真的有两块以上，否则这条测的是空集。
   */
  ...(() => {
    const line = log.split('\n').find((l) => l.includes('SEGRESULT')) ?? '';
    if (!line) {
      return [['接着读·段：真应用里滚到一节中间—重开—点它（探针没跑也算失败）', false]];
    }
    try {
      const r = JSON.parse(line.slice(line.indexOf('{')));
      const prep = r.prep ?? {};
      const rec = r.rec ?? {};
      const seg = rec.seg ?? null;
      const ln = r.line ?? {};
      const mid = Number(prep.mid ?? -1);
      const want = String(prep.want ?? '');
      return [
        ['接着读·段：判读这一节至少有两块（一块的节不记，这条就测不成）', prep.ok === true && Number(prep.kids) >= 2],
        [
          '接着读·段：停稳之后记下的是屏幕上那一块（序号与开头都对）',
          seg !== null && Number(seg.k) === mid && want.length > 0 && String(seg.x ?? '') === want,
        ],
        [
          '接着读·段：重开时那句话写着第几段',
          ln.vis === true && String(ln.seg ?? '') === String(mid + 1) && new RegExp('第\\s*' + (mid + 1) + '\\s*段').test(String(ln.text ?? '')),
        ],
        ['接着读·段：那句话里的引文逐字来自那一段', want.length > 0 && String(ln.text ?? '').includes(want.slice(0, 12))],
        [
          '接着读·段：点它落在那一段上',
          r.tapped === true && r.landed?.found === true && r.landed?.inView === true && Number(r.landed?.k) === mid,
        ],
      ];
    } catch {
      return [['接着读·段：结果行能解析', false]];
    }
  })(),
  // 几何：新元素不许宽或高为 0（数得出来但点不到），页面不许横向溢出（截图看不出来的那种坏）
  ['新元素都有实际尺寸', sizesOk()],
  ['无横向溢出', domObj().overflowX === 0],
  /*
   * 全局快捷键。
   *
   * 探针跳过的是「按一下那个键」与「读系统剪贴板」，判定与界面回话都是真代码。
   * 所以这组断言守的是「填 / 问 / 不填」三条分支，以及「没启用时说的是实话」。
   *
   * 第一条两端都要对：注册成功就必须写出那个键（否则功能等于不存在），
   * 失败就必须写「没启用」。只验一端，另一端会退化成沉默。
   */
  [
    '快捷键提示与注册结果一致',
    cap.status === 'on'
      ? /Alt\+A/.test(String(cap.hint))
      : cap.status === 'off' && /没启用/.test(String(cap.hint)),
  ],
  [
    '空框时剪贴板里的字直接填入，并说明来源',
    cap.fill === '这是从剪贴板里来的一段话。' && /剪贴板/.test(String(cap.fillNote)),
  ],
  ['框里是自己的字：只问，不覆盖', cap.ask === true && cap.askKept === true],
  ['问话里明写「没有覆盖」', /没有覆盖/.test(String(cap.askNote))],
  /*
   * 候选条那一屏只在「框里有你的字 + 按了快捷键」时出现。
   * 断言截图有内容，是为了让「没人见过它」这件事至少能被机器发现一次。
   */
  ['候选条那一屏留下了截图', Number(cap.askShot) > 1000],
  ['点「不用」后条消失、字一个没动', cap.keepAsk === false && cap.keepText === true],
  ['点「用它」才真的替换', cap.useText === '另一段来自剪贴板的文字。'],
  ['空剪贴板不填，但要说一句', cap.emptyText === '' && /没有文字/.test(String(cap.emptyNote))],
  ['超长不填，也不截断', cap.longLen === 0 && /上限/.test(String(cap.longNote))],
  /*
   * 跑道上的「倒在哪一关」只在有判定的模式里出现。
   *
   * 描述类模式把 defeat.checkId 清空了，所以跑道上一处「倒下」都不该有——
   * 这两条在描述类下必须是**反向**断言：`stripDown:0`。
   * 若照抄判定类的写法，重构模式一跑就红，而红的原因是功能正确。
   * 反过来也别写成「>=0」那种恒真条件：那就是静默不跑。
   */
  [
    NO_VERDICT.has(SMOKE_MODE) ? '描述类模式不标「倒在哪一关」' : '跑道上标出倒下的那一关',
    NO_VERDICT.has(SMOKE_MODE)
      ? resultLine.includes('"stripDown":0')
      : /"stripDown":[1-9]/.test(resultLine),
  ],
  [
    NO_VERDICT.has(SMOKE_MODE) ? '描述类模式不写判定倒在哪' : '跑道写明判定倒在哪',
    NO_VERDICT.has(SMOKE_MODE)
      ? resultLine.includes('"stripDies":false')
      : resultLine.includes('"stripDies":true'),
  ],
  // 元问题闸门：数据里有 meta 才出现，所以只断言「类名挂着、不报错」
  ['元问题闸门机制在', resultLine.includes('"stripGate":')],
  /*
   * 判读的推导链（「为什么在这一格」）。
   *
   * 两件事一起验，因为它们的坏法相反：
   *   给档位的模式 → 链必须在（≥2 步）、三格对照必须正好 3 格、
   *                  并且**正好一格**标着「本次」。0 格说明没有一档被认成当前档，
   *                  2 格说明同时亮两格——后者比不亮更糟，它自相矛盾。
   *   不判的模式   → 一处都不许有。给「查谬误」配一条「为什么在这一格」，
   *                  等于把「不判」渲染成一次判定。
   * 读不到数字时返回 false，不当作通过：那正是静默跳过的样子。
   */
  [
    NO_VERDICT.has(SMOKE_MODE) ? '不判的模式不出推导链' : '推导链在，且只有一格标着本次',
    (() => {
      const steps = Number(/"vwhy":(\d+)/.exec(resultLine)?.[1] ?? -1);
      const cells = Number(/"vlad":(\d+)/.exec(resultLine)?.[1] ?? -1);
      const now = Number(/"vnow":(\d+)/.exec(resultLine)?.[1] ?? -1);
      if (NO_VERDICT.has(SMOKE_MODE)) return steps === 0 && cells === 0 && now === 0;
      return steps >= 2 && cells === 3 && now === 1;
    })(),
  ],
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
  /*
   * 「分析进行中」那一屏。三条一起验，因为它们各自会坏在不同的地方：
   *   面板没出现 → 用户对着「先给一段真话」等一分钟，以为按钮没生效；
   *   阶段名是空串 → 说明主进程的进度事件没接上，只剩一个光秃秃的百分比；
   *   「已等」不走 → 计时器没起来，屏幕上是个永远 0 秒的假象。
   */
  ...(process.env.SMOKE_RUNNING === '1'
    ? [
        [
          '进行中面板出现且不是空态',
          runObj().first?.on === true && runObj().first?.empty === false,
        ],
        ['阶段名由主进程报来（非占位）', String(runObj().first?.label ?? '').length >= 2],
        ['百分比已显示', /%/.test(String(runObj().first?.pct ?? ''))],
        ['「已等」在走', waitedSecs(runObj().second?.wait) > waitedSecs(runObj().first?.wait)],
        ['进行中截图产出', existsSync(runShot)],
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

function runLine() {
  return log.split('\n').find((l) => l.includes('RUNNING ')) ?? '';
}

/** RUNNING 探针是 {first, second} 两帧快照，用来证明「已等」在动。 */
function runObj() {
  try {
    return JSON.parse(runLine().slice(runLine().indexOf('{')));
  } catch {
    return { first: {}, second: {} };
  }
}

/** 把「已等 1 分 05 秒」这种文案折成秒；解析不出来返回 -1，让它必然失败。 */
function waitedSecs(text) {
  const s = String(text ?? '');
  const m = /(\d+)\s*分/.exec(s);
  const sec = /(\d+)\s*秒/.exec(s);
  if (!m && !sec) return -1;
  return (m ? Number(m[1]) * 60 : 0) + (sec ? Number(sec[1]) : 0);
}

/** DOM 探针那行是 JSON，正经解析它——拿正则抠嵌套数组迟早抠出错来。 */
function domObj() {
  try {
    return JSON.parse(domLine.replace(/^.*?DOM /, ''));
  } catch {
    return {};
  }
}

/**
 * 全局快捷键探针那行也是 JSON。
 *
 * 空对象是「没跑」——每一条用它的断言都会因此失败，而不是静默通过。
 * 这正是要的：探针崩了必须红，不能表现为「这一栏没问题」。
 */
function capObj() {
  const line = log.split('\n').find((l) => l.includes('CAPTURE ')) ?? '';
  try {
    return JSON.parse(line.slice(line.indexOf('{')));
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

/*
 * SMOKE_REREAD=1 / SMOKE_RESCALE=1 的附加断言。
 *
 * 空对象是「探针没跑」：下面每一条都会因此失败，而不是静默通过。
 * 这一屏最容易被写坏的方式恰恰是「看起来做了」——按钮在、点上没反应，
 * 或在报告末尾又添一段而不换屏，静态检查与纯函数断言都看不见。
 */
const jOfLine = (tag) => {
  const line = log.split('\n').find((l) => l.includes(tag)) ?? '';
  try {
    return JSON.parse(line.slice(line.indexOf('{')));
  } catch {
    return {};
  }
};

if (process.env.SMOKE_REREAD === '1') {
  const rr = jOfLine('REREADRESULT');
  const back = jOfLine('REREADBACK');
  const rrShot = resolve(outDir, 'reread.png');
  const shotLine = log.split('\n').find((l) => l.includes('REREADRECT')) ?? '';
  checks.push(
    ['回到原文：报告顶部有入口', rr.entry === true],
    [
      '回到原文：点开后换了一整屏，报告板块全让位',
      rr.opened === true && rr.screen === true && rr.blocks === 0 && rr.blocksBefore > 0,
    ],
    [
      '回到原文：屏幕上的句子与提交的原文逐字相同',
      typeof rr.text === 'string' && rr.text === String(rr.passage ?? '').trim() && rr.text.length > 20,
    ],
    [
      '回到原文：句子数与统计条相符',
      rr.sentences >= 2 && String(rr.stat ?? '').includes(`共 ${rr.sentences} 句`),
    ],
    ['回到原文：条目确实挂到了句子旁边', rr.refs > 0],
    ['回到原文：此处合法没有被过滤掉', rr.legal > 0],
    ['回到原文：没人提的句数与统计条相符', String(rr.stat ?? '').includes(`${rr.quiet} 句没人提`)],
    [
      '回到原文：点回报告后回到原来那份报告',
      rr.screen === true && back.screen === false && back.blocks === rr.blocksBefore && rr.blocksBefore > 0,
    ],
    [
      '回到原文：截图真的裁到了这一屏',
      /\d+x\d+/.test(shotLine) && existsSync(rrShot) && statSync(rrShot).size > 1000,
    ],
  );
}

/*
 * SMOKE_RESCALE=1：这一屏的关键不是「渲染出来了」，而是**填了词之后本地真的重算了**。
 * 所以探针先采一次空屏，再由探针往输入框里填词，两次都得对得上。
 */
if (process.env.SMOKE_RESCALE === '1') {
  const rs = jOfLine('RESCALERESULT');
  const empty = jOfLine('RESCALEEMPTY');
  const rsBack = jOfLine('RESCALEBACK');
  const rsShotPath = resolve(outDir, 'rescale.png');
  const rsRectLine = log.split('\n').find((l) => l.includes('RESCALERECT')) ?? '';
  checks.push(
    ['换尺度：报告顶部有入口', rs.entry === true],
    [
      '换尺度：点开后换了一整屏，报告板块全让位',
      rs.opened === true && rs.screen === true && rs.blocks === 0 && rs.blocksBefore > 0,
    ],
    [
      '换尺度：填词之前没有「换过」那一栏',
      empty.screen === true && empty.changed === '' && String(empty.stat ?? '').includes('还没填词'),
    ],
    ['换尺度：两组词由用户填进输入框', rs.filled === true && rs.inputs >= 2],
    [
      '换尺度：填词后本地重算了，两栏不再相同',
      typeof rs.changed === 'string' && rs.changed.length > 20 && rs.changed !== rs.original && rs.changed !== empty.changed,
    ],
    [
      '换尺度：原文那一栏与提交的原文逐字相同',
      typeof rs.original === 'string' && rs.original === String(rs.passage ?? '').trim() && rs.original.length > 20,
    ],
    [
      '换尺度：该换的换了，没被点名的字还在',
      typeof rs.changed === 'string' &&
        rs.changed.includes('午休') &&
        rs.changed.includes('及格率') &&
        !rs.changed.includes('早读') &&
        !rs.changed.includes('一本率') &&
        rs.changed.includes('6 个百分点'),
    ],
    [
      '换尺度：统计条报出替换处数与句子数',
      /替换 \d+ 处/.test(String(rs.stat ?? '')) &&
        String(rs.stat ?? '').includes(`共 ${rs.sentences} 句`) &&
        rs.sentences >= 2,
    ],
    ['换尺度：报告条目仍按句挂在旁边', rs.refs > 0],
    [
      '换尺度：点回报告后回到原来那份报告',
      rs.screen === true && rsBack.screen === false && rsBack.blocks === rs.blocksBefore && rs.blocksBefore > 0,
    ],
    [
      '换尺度：截图真的裁到了这一屏',
      /\d+x\d+/.test(rsRectLine) && existsSync(rsShotPath) && statSync(rsShotPath).size > 1000,
    ],
  );
}

/*
 * SMOKE_CONDITIONS=1：这一屏验的是「人写的字真的被本地重算进对位与导出文本」。
 *
 * 空对象是「探针没跑」：下面每一条都会因此失败，而不是静默通过。
 * 三条容易写歪的地方都单独钉住：
 *   - 只截图不断言，等于给一个点不动的界面留了张好看的证据；
 *   - 「原文还在」不比较内容，trim 过也照样绿；
 *   - 「填了条件」不看导出文本，事件没接到 React 上也照样绿。
 */
if (process.env.SMOKE_CONDITIONS === '1') {
  const cd = jOfLine('CONDITIONSRESULT');
  const cdEmpty = jOfLine('CONDITIONSEMPTY');
  const cdBack = jOfLine('CONDITIONSBACK');
  const cdShotPath = resolve(outDir, 'conditions-e2e.png');
  const cdRectLine = log.split('\n').find((l) => l.includes('CONDITIONSRECT')) ?? '';
  const cdUnasked = Number(cd.unasked);
  const cdEmptyUnasked = Number(cdEmpty.unasked);
  checks.push(
    ['成立条件：报告顶部有入口', cd.entry === true],
    [
      '成立条件：点开后换了一整屏，报告板块全让位',
      cd.opened === true && cd.screen === true && cd.blocks === 0 && cd.blocksBefore > 0,
    ],
    [
      '成立条件：主区没有混进报告里的条目卡',
      cd.screen === true && cd.refs === 0,
    ],
    [
      '成立条件：填之前是空清单，没有引文、也没有用户还没写的字',
      cdEmpty.screen === true &&
        cdEmpty.items >= 2 &&
        cdEmpty.quotes === 0 &&
        String(cdEmpty.stat ?? '').includes('写了 0 条') &&
        !String(cdEmpty.take ?? '').includes('得先排除别的原因吗'),
    ],
    ['成立条件：探针真的往界面里写条件、点三态、挂了原文句子', cd.filled === true],
    [
      '成立条件：写了两条之后统计条跟着变了',
      String(cd.stat ?? '').includes('写了 2 条') && String(cd.stat ?? '').includes('1 条挂到了原文'),
    ],
    [
      '成立条件：挂上去的引文逐字就是原文第一句',
      typeof cd.quote === 'string' && cd.quote.length > 20 && String(cd.passage ?? '').startsWith(cd.quote) && cd.quotes === 1,
    ],
    [
      '成立条件：屏幕上的原文与提交的原文逐字相同',
      typeof cd.passage === 'string' && cd.passage === String(cd.submitted ?? '').trim() && cd.sentences >= 2,
    ],
    [
      '成立条件：三态是用户点的，不是软件判的（第一行亮的是刚点的那个）',
      Array.isArray(cd.markOns) &&
        cd.markOns.length === 3 &&
        cd.markOns[0] === 'yes' &&
        cd.markOns[1] === 'unknown' &&
        String(cd.take ?? '').includes('[原文给了]'),
      JSON.stringify(cd.markOns),
    ],
    [
      '成立条件：带走的那段文本里，用户写的条件与挂的原句都在',
      String(cd.take ?? '').includes('得先排除别的原因吗') &&
        String(cd.take ?? '').includes('两年数据够不够') &&
        typeof cd.quote === 'string' &&
        String(cd.take ?? '').includes(cd.quote),
    ],
    [
      '成立条件：挂了一句之后，没被问到的句子真的少了一句',
      cdEmptyUnasked >= 2 && cdUnasked === cdEmptyUnasked - 1,
      `填前 ${cdEmptyUnasked} / 填后 ${cdUnasked}`,
    ],
    [
      '成立条件：没被问到的句子有单独一处逐句列出',
      String(cd.unaskedList ?? '').includes(`还有 ${cdUnasked} 句没被问到`),
    ],
    [
      '成立条件：三态按钮没有被挤成两行',
      Array.isArray(cd.markHeights) && cd.markHeights.length >= 9 && cd.markHeights.every((h) => h > 0 && h <= 34),
      JSON.stringify(cd.markHeights),
    ],
    [
      '成立条件：点回报告后回到原来那份报告',
      cd.screen === true && cdBack.screen === false && cdBack.blocks === cd.blocksBefore && cd.blocksBefore > 0,
    ],
    [
      '成立条件：截图真的裁到了这一屏',
      /\d+x\d+/.test(cdRectLine) && existsSync(cdShotPath) && statSync(cdShotPath).size > 1000,
    ],
  );
}

/*
 * SMOKE_VIEWS=1：核的是「图真的能挑」。
 *
 * 三条分开验，因为它们是三种不同的坏法：
 *   1. 勾了但图还在（界面说谎）；
 *   2. 图没了但本机没记住（下次还得重关）；
 *   3. 全显示时新增的两张图没画出来（「更多可视化」只停在清单上）。
 *
 * 独立真值不靠界面自己的 data 属性：本机存储那一栏直接读 localStorage 原文，
 * 比的是「写进去的几个 id」与「界面上亮着的几行」是否一致。
 */
if (process.env.SMOKE_VIEWS === '1') {
  const v = jOfLine('VIEWSRESULT');
  const b = v.before ?? {};
  const o = v.opened ?? {};
  const off = v.off ?? {};
  const all = v.all ?? {};
  const def = v.def ?? {};
  const clicks = v.clicks ?? {};
  const parseStored = (raw) => {
    try {
      const a = JSON.parse(String(raw ?? ''));
      return Array.isArray(a) ? a : null;
    } catch {
      return null;
    }
  };
  const storedOff = parseStored(off.stored);
  const storedAll = parseStored(all.stored);
  const storedDef = parseStored(def.stored);

  checks.push(
    ['挑图：报告里有这一条', b.bar === true],
    ['挑图：默认三张，与旧版一致', Number(b.count) === 3 && /^图 3\/5/.test(String(b.line ?? '')), String(b.line ?? '')],
    ['挑图：默认收起（不是一进来就摆一屏选项）', b.panel === false],
    [
      '挑图：五张图都列出来，一张不少',
      Number(o.items) === 5 && Array.isArray(o.on) && o.on.length === 3,
      `${o.items} 项 / 亮 ${Array.isArray(o.on) ? o.on.length : '?'}`,
    ],
    [
      '挑图：点得开，点开后明细出现',
      o.panel === true && clicks.off === true && clicks.all === true && clicks.def === true,
    ],
    [
      '挑图：关掉结构图之后，图真的从正文里消失',
      off.structSvg === false && Array.isArray(off.offNotes) && off.offNotes.includes('structure'),
      `svg=${off.structSvg} 占位=${JSON.stringify(off.offNotes)}`,
    ],
    [
      '挑图：消失的位置有一句话和一个能就地打开的按钮（不是整栏凭空没了）',
      /你关掉了/.test(String(off.offText ?? '')) && /打开/.test(String(off.offText ?? '')),
      String(off.offText ?? ''),
    ],
    ['挑图：关掉一张后计数行跟着变', /^图 2\/5/.test(String(off.line ?? '')), String(off.line ?? '')],
    [
      '挑图：选择写进了本机（独立真值：直接读存储原文）',
      Array.isArray(storedOff) && !storedOff.includes('structure') && storedOff.includes('checks') && storedOff.includes('verdict'),
      JSON.stringify(storedOff),
    ],
    [
      '挑图：全显示之后，新增的两张图真的画出来了',
      all.refuteSvg === true && all.repairSvg === true && all.structSvg === true,
      `反驳=${all.refuteSvg} 修补=${all.repairSvg}`,
    ],
    ['挑图：全显示后计数行是 5/5', /^图 5\/5/.test(String(all.line ?? '')), String(all.line ?? '')],
    [
      '挑图：全显示写回本机的是五个 id（不是只改了界面）',
      Array.isArray(storedAll) && storedAll.length === 5,
      JSON.stringify(storedAll),
    ],
    [
      '挑图：只留默认三张之后，两张新图收起',
      def.refuteSvg === false && def.repairSvg === false && Number(def.count) === 3,
      `反驳=${def.refuteSvg} 修补=${def.repairSvg} count=${def.count}`,
    ],
    [
      '挑图：只留默认三张也写回本机',
      Array.isArray(storedDef) && storedDef.join(',') === 'structure,checks,verdict',
      JSON.stringify(storedDef),
    ],
  );
}

/*
 * SMOKE_AGREEMENT=1：核的是「同一段字跑两遍，界面真的把两份摆到一起比了」。
 *
 * 这一栏最坏的坏法是「显示旧账」：跑完第二遍，界面还是跑一遍时那句话，
 * 读起来完全正常。所以探针跑完之后点了一下历史（那是它的刷新时机之一），
 * 下面的断言取的是点过之后的状态。
 *
 * 独立真值：遍数必须等于 archive:list 的长度——那是另一条 IPC，读的是索引。
 * 写死一个 2 也能让这句话通顺，只有跟索引对上才说明它真的扫了文件。
 */
if (process.env.SMOKE_AGREEMENT === '1') {
  const ag = jOfLine('AGREEMENTRESULT');
  const agLine = String(ag.line ?? '');
  const m = agLine.match(/最多的一组跑了 (\d+) 遍/);
  const runs = m ? Number(m[1]) : -1;
  const agCells = Array.isArray(ag.cells) ? ag.cells : [];
  const agText = String(ag.text ?? '');
  /*
   * 「谁跑的」：报告自述的三项，拿主进程读到的设置当独立真值。
   *
   * 这几条与静态断言不重复：静态那些验的是 normalizeDiagnosis 收什么写什么，
   * 这里验的是**真发了一次请求**之后，落盘的那份报告写的是不是这次真的用的模型与温度。
   * 少了它，「engine 从来没有被接上」这种坏法可以一路绿到底。
   */
  const eng = jOfLine('ENGINERESULT');
  const engTemp = typeof eng.temperature === 'number' ? eng.temperature : null;
  checks.push(
    [
      '谁跑的：新报告里记下了模型（不是空着）',
      eng.present === true && typeof eng.model === 'string' && eng.model.length > 0,
      String(eng.model),
    ],
    ['谁跑的：模型名与设置里的一致（不是写死的一串）', eng.model === eng.cfgModel, `${eng.model} / ${eng.cfgModel}`],
    [
      '谁跑的：主机与设置里的一致，且不含协议与路径',
      eng.host === eng.cfgHost && !String(eng.host).includes('/'),
      `${eng.host} / ${eng.cfgHost}`,
    ],
    [
      '谁跑的：温度是「设置与模式上限里更低那个」（不是设置页填的那个）',
      engTemp !== null && typeof eng.ceiling === 'number' && engTemp === Math.min(eng.cfgTemp, eng.ceiling),
      `${engTemp} vs min(${eng.cfgTemp}, ${eng.ceiling})`,
    ],
    [
      '谁跑的：整份报告里搜不到 Key（这份文件会被导出）',
      Number(eng.keyLen) > 0 && eng.keyLeak === false,
      `Key 长度 ${eng.keyLen}`,
    ],
    /*
     * 报告自己的脚注也要说出来：读一份报告的人未必会去展开「同题复跑」，
     * 而「这份是谁跑的」在核对两份能不能对照时是第一句话。
     */
    [
      '谁跑的：报告脚注写着模型与生效温度',
      /由 mock-argument-lens 跑出（温度 0\.2，127\.0\.0\.1:/.test(String(ag.foot ?? '')),
      String(ag.foot ?? ''),
    ],
    [
      '同题复跑明细：这一组写着模型名（界面真的读到了这一栏）',
      agCells.some((c) => /模型 /.test(c)),
      String(agCells[0] ?? ''),
    ],
  );

  checks.push(
    ['同题复跑：输入框下方有这一栏', ag.bar === true],
    ['同题复跑：第二遍真的跑完了（不是没跑到就断言）', ag.run === 'ok', String(ag.run)],
    [
      '同题复跑：点开前明细确实收起（不是一直展开着）',
      ag.detailBefore === false && ag.labelBefore === '看明细',
    ],
    ['同题复跑：按钮点得动，点开后明细出现', ag.opened === true && ag.detail === true && ag.labelAfter === '收起明细'],
    [
      '同题复跑：同一段字跑两遍被算成一组',
      /跑过不止一次的有 1 组/.test(agLine) && Number(ag.repeatAttr) === 1,
      agLine,
    ],
    [
      '同题复跑：假模型两次给出同一份报告，界面说「完全一样」',
      /1 组每次报告完全一样/.test(agLine) && agCells.length === 1 && /个字段每次都一样/.test(agCells[0] ?? ''),
      String(agCells[0] ?? ''),
    ],
    [
      '同题复跑：遍数与另一条 IPC 读到的存档数一致（不是写死的）',
      runs > 0 && Number(ag.listLen) === runs,
      `界面 ${runs} / 存档索引 ${ag.listLen}`,
    ],
    ['同题复跑：导出的纯文本以界面上那一行开头', agLine.length > 0 && agText.startsWith(agLine)],
    [
      '同题复跑：界面写明这一栏能读到多远（旧存档没记 + 模型名不等于版本）',
      /早期存档没有这一栏/.test(String(ag.caveat ?? '')) && /不等于同一个版本/.test(String(ag.caveat ?? '')),
      String(ag.caveat ?? ''),
    ],
    ['同题复跑：总述不劝、不评价', !/建议|应该|稳定|可靠/.test(agLine), agLine],
    ['同题复跑：这一栏没有报错', String(ag.error ?? '') === ''],
  );
}

/*
 * 结论的口气（无条件跑：报告一出现它就在，所以每条冒烟路径都会顺带核一次）。
 *
 * 核的是**接线**，不是算法：界面上那两句必须逐字等于报告里的 quote 与 text，
 * 差别条数必须等于本地那一档。「本地算得对不对」归 `check:modal` 的 61 条与八组反证。
 *
 * 下面两条字面量来自 `scripts/mock-llm.mjs` 的 conclusion —— 改那份夹具要一起改这里，
 * 和「改第一段示例要同步 span 下标」是同一件事。
 */
{
  const tone = jOfLine('TONERESULT');
  const diffs = Array.isArray(tone.diffs) ? tone.diffs : [];
  checks.push(
    ['结论的口气：这一块真的出现在报告里', tone.has === true],
    [
      '结论的口气：「原文」那行逐字是报告里的 quote',
      tone.source === '这说明取消早读是错的',
      String(tone.source),
    ],
    [
      '结论的口气：「报告」那行逐字是报告里的 text',
      tone.claim === '取消早读是错的，应当恢复早读',
      String(tone.claim),
    ],
    [
      '结论的口气：本地读到的那一处是「推论被写成断言」',
      diffs.length === 1 && diffs[0] === 'causal-dropped',
      diffs.join(','),
    ],
    [
      '结论的口气：两边各说各的（报告说越界 / 本地也在字面上读到差别）',
      /报告说越界/.test(String(tone.cross)) && /本地也在字面上读到了差别/.test(String(tone.cross)),
      String(tone.cross),
    ],
    [
      '结论的口气：报告给的理由逐字显示出来',
      String(tone.rep).indexOf('把或然说成必然') >= 0,
      String(tone.rep),
    ],
    ['结论的口气：这一块长在结论名片之后', tone.afterConcl === true, String(tone.afterConcl)],
    ['结论的口气：写着「不动报告」', /不动报告/.test(String(tone.fine)), String(tone.fine)],
  );
}

/*
 * 骨架缺口（无条件跑：报告一出现它就在）。
 *
 * 核的是「这一层有没有真的把本地判定与报告自己的话分开」——
 * 界面少一个来源标签、或把 `unanswered` 又说回「没答」，check:skeleton 的纯函数
 * 断言一条都不会红，只有走到界面才看得见。
 *
 * 下面的字面量来自 `scripts/mock-llm.mjs`：原文 5 句、检查表 3 条（1 通过 / 2 文中没交代）、
 * 1 句没人碰。改那份夹具要一起改这里，和「改第一段示例要同步 span 下标」是同一件事。
 */
{
  const g = jOfLine('GAPSRESULT');
  const kinds = Array.isArray(g.kinds) ? g.kinds : [];
  const froms = Array.isArray(g.froms) ? g.froms : [];
  const labels = Array.isArray(g.fromLabels) ? g.fromLabels : [];
  const notes = Array.isArray(g.notes) ? g.notes : [];
  const facts = Array.isArray(g.facts) ? g.facts : [];
  const allText = [g.line, g.sub, g.plain, ...notes, ...facts].join(' ');
  checks.push(
    ['骨架缺口：这一块真的出现在报告里', g.has === true],
    ['骨架缺口：总述标的缺口条数与列表同源', Number(g.gapCount) === kinds.length && kinds.length === 2, String(g.gapCount) + '/' + kinds.join(',')],
    ['骨架缺口：本地漏读与报告自认的空环都列出来了', kinds.join(',') === 'quiet-sentences,hollow-checks', kinds.join(',')],
    ['骨架缺口：两条缺口各自标了来源', froms.join(',') === 'local,report', froms.join(',')],
    ['骨架缺口：来源标签逐字是「本地数的 / 报告自己说的」', labels.join(',') === '本地数的,报告自己说的', labels.join(',')],
    /*
     * 下面两条都带「样本非空」：组件被整块摘掉时，两个空数组长度相等、
     * 空文本里也找不到「没答」，不写非空条件就是两条永远绿的假断言。
     */
    ['骨架缺口：每条缺口都有标签，不是只给第一条', kinds.length > 0 && labels.length === kinds.length, labels.length + '/' + kinds.length],
    [
      '骨架缺口：界面不许把「文中没交代」说成「没答 / 未答」',
      notes.length > 0 && facts.length > 0 && !/没答|未答/.test(allText),
      allText.slice(0, 120),
    ],
    [
      '骨架缺口：总述逐字对得上',
      g.line === '原文 5 句，1 句没碰；检查表 3 条，其中 2 条报告说「文中没交代」。',
      String(g.line),
    ],
    [
      '骨架缺口：检查表四档那一行与夹具同源',
      facts.some((f) => String(f).includes('文中没交代 2') && String(f).includes('通过 1')),
      facts.join('｜'),
    ],
    ['骨架缺口：标题旁写清两种来源分着摆', String(g.sub).includes('分着摆') && String(g.sub).includes('本地数的'), String(g.sub)],
    [
      '骨架缺口：「文中没交代」那条说的是指认，不是漏答',
      notes.some((n) => String(n).includes('指认这几处是空的，不是漏答')),
      notes.join('｜'),
    ],
  );
}

/*
 * 逐字比（无条件跑：报告一出现它就贴在每张主张卡上）。
 *
 * 核的是「这一层有没有真的贴到正文上」——纯函数层全绿，界面把这一块挪到
 * 报告外面另起一栏、或者只给第一条，check:rewrite 一条都不会红。
 * 字面量来自 scripts/mock-llm.mjs 的四条主张，改那份夹具要一起改这里。
 */
{
  const rw = jOfLine('REWRITERESULT');
  const cards = Array.isArray(rw.cards) ? rw.cards : [];
  const first = cards[0] ?? {};
  const allText = cards.map((c) => [c.line, c.detail, c.note].join(' ')).join(' ');
  checks.push(
    ['逐字比：每张主张卡上都有这一块（4 张）', cards.length === 4, String(cards.length)],
    ['逐字比：四块都紧跟在「原话」那一行后面，不是报告外面另起一栏', cards.length === 4 && cards.every((c) => c.afterQuote === true), JSON.stringify(cards.map((c) => c.afterQuote))],
    ['逐字比：四块都读得到原话与整理后那一句', cards.length === 4 && cards.every((c) => String(c.quote).length > 2 && String(c.text).length > 2), String(cards.length)],
    [
      '逐字比：结论那一句的总述逐字对得上',
      first.line === '本地逐字比：原话 10 字、这一句 14 字；1 段没接上、1 段对不上。',
      String(first.line),
    ],
    ['逐字比：总述里的字数与属性同源（不是写死的）', Number(first.quoteChars) === 10, String(first.quoteChars)],
    [
      '逐字比：片段明细逐字对得上，两边各一段',
      first.detail === '原话里有、这一句没接上：「这说明」；这一句里、原话对不上：「应当恢复早读」',
      String(first.detail),
    ],
    ['逐字比：明细标的段数与片段同源', Number(first.fragCount) === 2, String(first.fragCount)],
    [
      '逐字比：两行文字逐字来自报告自己',
      first.quote === '「这说明取消早读是错的」' && first.text === '取消早读是错的，应当恢复早读',
      String(first.quote) + ' / ' + String(first.text),
    ],
    [
      '逐字比：每块都印「不判改写对不对」，不是只给第一条',
      cards.length === 4 && cards.every((c) => c.note === '只比字面，不判改写对不对；这两句都是报告自己写下的。'),
      String(cards.length),
    ],
    [
      '逐字比：三条读得出片段，一条只差单个字也明说',
      cards.filter((c) => c.kind === 'fragments').length === 3 &&
        cards.some((c) => c.kind === 'one-char' && /只差单个字，读不出连续的片段/.test(String(c.line)) && String(c.detail) === ''),
      cards.map((c) => c.kind).join(','),
    ],
    [
      '逐字比：界面不替报告下判断（带样本非空，摘掉组件时必须红）',
      cards.length > 0 && !/改错|越界|建议改成|应该改成/.test(allText),
      allText.slice(0, 120),
    ],
  );
}

/*
 * 来源账（无条件跑：报告一出现它就在最上面）。
 *
 * 核的是接线与展开，不是算法：默认必须收起、点开之后四类本地复算各占一行、
 * 每行都标「本地复算」、抬头逐字取自纯函数。点开那一半专门验「按钮点了有反应」——
 * 纯函数与静态源码守卫都看不见这一层。
 */
{
  const so = jOfLine('SOURCERESULT');
  const rows = Array.isArray(so.rows) ? so.rows : [];
  checks.push(
    ['来源账：这一块真的出现在报告里', so.has === true, String(so.has)],
    ['来源账：默认收起，不替人决定先读什么', so.openedByDefault === false, String(so.openedByDefault)],
    ['来源账：展开按钮点得动', so.clicked === true, String(so.clicked)],
    ['来源账：抬头明说判断由模型写出、本地不改判定', /由模型写出/.test(String(so.headline)) && /不改判定/.test(String(so.headline)), String(so.headline)],
    ['来源账：模型判定点数来自实算，不是写死的 0', Number(so.modelCount) > 2, String(so.modelCount)],
    ['来源账：按钮写着「本地复算」', /本地复算/.test(String(so.toggle)), String(so.toggle)],
    ['来源账：点开后四类本地复算都列出来', rows.length === 4 && ['rewrite', 'skeleton', 'tone', 'quote'].every((k) => rows.some((r) => r.key === k)), JSON.stringify(rows.map((r) => r.key))],
    ['来源账：四类都标「本地复算」', rows.length === 4 && rows.every((r) => r.from === '本地复算'), JSON.stringify(rows.map((r) => r.from))],
    ['来源账：边界那句在展开后出现', /算得多不等于判断更对/.test(String(so.note)), String(so.note)],
  );
}

/*
 * 「这一圈的词」（无条件跑：它长在学术分析区块里，报告一出现 DOM 就有）。
 *
 * 核的是接线，不是算法：默认收起、点开后有输入框、把词真的填进去之后本地当场重算。
 * 三个词不是随手挑的：假模型那份原文是「取消早读」，「早读」「一本率」命中，
 * 「举证责任」不命中——刚好覆盖命中、不命中与「报告改写过」那一层的入口。
 */
{
  const tm = jOfLine('TERMSRESULT');
  const rows = Array.isArray(tm.rows) ? tm.rows : [];
  const byWord = Object.fromEntries(rows.map((r) => [r.word, r]));
  checks.push(
    ['圈内词：这一块真的出现在报告里', tm.has === true, String(tm.has)],
    ['圈内词：默认收起', tm.openedByDefault === false, String(tm.openedByDefault)],
    ['圈内词：展开按钮点得动', tm.clicked === true, String(tm.clicked)],
    ['圈内词：输入框在，词真的填进去了', tm.typed === true && rows.length === 3, `${tm.typed} / ${rows.length}`],
    ['圈内词：填词后状态是 ok，不是空表也不是全不命中', tm.state === 'ok', String(tm.state)],
    ['圈内词：命中的词有非零次数', Number(String(byWord['早读']?.count ?? '').replace(/\D/g, '')) > 0, String(byWord['早读']?.count)],
    ['圈内词：不命中的词明说「一次都没出现」', /一次都没出现/.test((byWord['举证责任']?.facts ?? []).join('')), JSON.stringify(byWord['举证责任']?.facts ?? [])],
    ['圈内词：总述逐字来自纯函数（3 个词、1 个没出现）', /3 个词/.test(String(tm.note)) && /1 个一次没出现/.test(String(tm.note)), String(tm.note)],
    ['圈内词：边界那句不判换义、不落盘', /不判术语有没有换义/.test(String(tm.caveat)) && /不存盘/.test(String(tm.caveat)), String(tm.caveat)],
  );
}

/*
 * 长文覆盖账：冒烟跑道是短文本，这里验「不该出现时整块不出现」。
 * 这一条不是凑数——去掉 `!v.long` 之后界面完全正常，只是短文本多了一条
 * 100% 的空面板；长文本那一版由预览页与 audit:longtext 守。
 */
{
  const cv = jOfLine('COVERAGERESULT');
  checks.push(
    ['长文覆盖账：短文本报告里整块不出现', cv.short === true && cv.present === false, `${cv.short} / ${cv.present}`],
    ['长文覆盖账：没有偷偷留一行总述或清单', String(cv.headline ?? '') === '' && Number(cv.rows ?? -1) === 0, `${cv.headline} / ${cv.rows}`],
  );
}

/*
 * 两份对照（跟在 SMOKE_AGREEMENT 后面跑）。
 *
 * 这一条验的是**接线**，不是算法：号码点得动、没选够两份时按钮不许亮、点完面板开、
 * 面板上的数跟「同题复跑」同源、关掉之后底下那份报告还在。
 *
 * 为什么这里只出现「0 处」：假模型两次输出逐字相同，真报告就是 0 处。
 * 「有几处不同」那一档端到端造不出来——造它就得往存档里塞两份不一样的真报告，
 * 那等于拿假数据给这一屏作证。那一档归 `check:sideby` 的样本与预览页截图。
 * 这条边界写在注释里，免得后来的人以为端到端把两种情况都验过了。
 */
if (process.env.SMOKE_AGREEMENT === '1') {
  const sb = jOfLine('SIDEBYRESULT');
  const sbLine = String(sb.line ?? '');
  const sbCards = Array.isArray(sb.cards) ? sb.cards : [];
  const sbFlags = Array.isArray(sb.flags) ? sb.flags : [];
  const sbText = String(sb.text ?? '');
  checks.push(
    ['两份对照：同题复跑的每一组里都有可点的号码', Number(sb.btns) >= 2, String(sb.btns)],
    [
      '两份对照：没选够两份时按钮点不动（不是永远亮着的摆设）',
      sb.cmpDisabledBefore === true,
      String(sb.cmpDisabledBefore),
    ],
    [
      '两份对照：点了两个号码才放行',
      Number(sb.picked) === 2 && sb.disabledAfter === false,
      `选中 ${sb.picked} 个 / 按钮禁用 ${sb.disabledAfter}`,
    ],
    ['两份对照：面板真的开了', sb.open === true],
    [
      '两份对照：两张名片各写各的（不是同一份复印两遍）',
      sbCards.length === 2 && sbCards[0] !== sbCards[1],
      sbCards.join(' || ').slice(0, 120),
    ],
    [
      '两份对照：同一段字跑两遍、假模型逐字相同 → 0 处差异',
      Number(sb.rows) === 0 && /逐字相同/.test(sbLine),
      `${sb.rows} 处 / ${sbLine}`,
    ],
    [
      '两份对照：四项相同与否各自给了标记（原文/透镜/模式/提示词）',
      sbFlags.length === 4 && sbFlags.every((f) => f === 'same'),
      sbFlags.join(','),
    ],
    [
      '两份对照：导出里带着「只列不一样的」与「不说哪一份更对」两句边界',
      /只列不一样的/.test(sbText) && /不说哪一份更对/.test(sbText),
      sbText.slice(0, 80),
    ],
    ['两份对照：关得掉，关掉之后底下那一栏还在', sb.closed === true && sb.barStill === true],
  );
}

/*
 * SMOKE_PORTFOLIO=1：核的是「这一栏的数字真的来自本地存档」。
 *
 * 数字写死在组件里，界面照样是一句通顺完整的话——所以必须另找一条独立真值：
 * archive:list 读索引，样本账扫文件，两条 IPC 的实现不同，对不上就说明数目是编的。
 * 空对象是「探针没跑」：下面每一条都会因此失败，不会静默通过。
 */
if (process.env.SMOKE_PORTFOLIO === '1') {
  const pf = jOfLine('PORTFOLIORESULT');
  const pfLine = String(pf.line ?? '');
  const m = pfLine.match(/本机 (\d+) 份报告，落在 (\d+) 组不同的文字上/);
  const reportN = m ? Number(m[1]) : -1;
  const groupN = m ? Number(m[2]) : -1;
  const rows = Array.isArray(pf.rows) ? pf.rows : [];
  const text = String(pf.text ?? '');
  checks.push(
    ['样本账：输入框下方有这一栏', pf.bar === true],
    [
      '样本账：点开前明细确实收起（不是一直展开着）',
      pf.detailBefore === false && pf.labelBefore === '看明细',
    ],
    [
      '样本账：按钮点得动，点开后明细出现',
      pf.opened === true && pf.detail === true && pf.labelAfter === '收起明细',
    ],
    [
      '样本账：主句里数字与量词连着写，没有被挤断',
      /最多的那组 \d+ 份/.test(pfLine) && /只跑过一次的有 \d+ 组/.test(pfLine),
    ],
    [
      '样本账：报告数与另一条 IPC 独立读到的存档数一致（不是写死的）',
      reportN > 0 && Number.isFinite(pf.listLen) && reportN === Number(pf.listLen),
      `界面 ${reportN} / 存档索引 ${pf.listLen}`,
    ],
    [
      '样本账：data 属性、明细行数、主句里的组数三者一致',
      Number(pf.groupsAttr) === groupN && rows.length === groupN && groupN > 0,
      `attr=${pf.groupsAttr} rows=${rows.length} groups=${groupN}`,
    ],
    ['样本账：导出的纯文本以界面上那一行开头', pfLine.length > 0 && text.startsWith(pfLine)],
    [
      '样本账：明细每一行都逐字出现在可复制的文本里',
      rows.length > 0 && rows.every((r) => typeof r === 'string' && r.length > 10 && text.includes(r)),
    ],
    [
      '样本账：导出里没有多出一组界面上没有的明细',
      !text.includes(`第 ${groupN + 1} 组`),
    ],
    [
      '样本账：没有把存档读失败静默成「一切正常」',
      pf.error === '' && pf.detail === true,
    ],
    [
      '样本账：信息条没有被按钮挤成四行以上',
      Number(pf.lineHeight) > 0 && Number(pf.lineHeight) <= 72,
      String(pf.lineHeight),
    ],
  );
}

/*
 * SMOKE_NEXTLINE=1：核的是「写进去的那句话真的原样存回去了」。
 *
 * 这一栏最坏的样子不是报错，是「看起来记上了」：句子被截断、被规范化、
 * 或者根本没写进文件而界面照样多了一行。所以断言逐字比对原话，并且要求
 * 删完之后数目回到写之前——「随时可删」不能只是界面上的一句话。
 *
 * 空对象是「探针没跑」：下面每一条都会因此失败，不会静默通过。
 */
if (process.env.SMOKE_NEXTLINE === '1') {
  const nl = jOfLine('NEXTLINERESULT');
  const TEXT = '这句话我确实想再问一句：那第二个数据是怎么来的';
  const before = Number(nl.total ?? -1);
  const s1 = nl.s1 ?? {};
  const s2 = nl.s2 ?? {};
  const said = Array.isArray(nl.said) ? nl.said : [];
  const items = Number(nl.items ?? -1);
  const exported = String(nl.text ?? '');
  checks.push(
    ['下一句：报告末尾有这一块，且有输入框', nl.bar === true && nl.input === true],
    [
      '下一句：明细默认收起（不是一上来就摊开）',
      nl.listBefore === false && nl.opened === true && nl.detail === true,
    ],
    [
      '下一句：这一块在报告最后一个板块之下，不在上面',
      nl.belowReport === true,
    ],
    [
      '下一句：填完字点「记下」，账上真的多了一句',
      nl.typed === true && nl.saved === true && Number(s1.total) === before + 1,
      `记之前 ${before} / 记之后 ${s1.total}`,
    ],
    [
      '下一句：写完就清空输入框，并说清「记下了」',
      String(s1.input ?? '') === '' && String(s1.ok ?? '').includes('记下了'),
    ],
    [
      '下一句：存回去的是原话，逐字不差（截断或规范化都会在这里露出来）',
      said.length > 0 && said[0] === TEXT,
      JSON.stringify(said[0]),
    ],
    [
      '下一句：同一句记两遍，账上出现「逐字相同」与「2 次」',
      Number(s2.total) === before + 2 &&
        String(s2.line ?? '').includes('逐字相同') &&
        String(s2.line ?? '').includes('有 2 次'),
      String(s2.line ?? ''),
    ],
    [
      '下一句：明细一条不少，条数与账上的句子数一致',
      items === Number(s2.total),
      `明细 ${items} / 账上 ${s2.total}`,
    ],
    [
      '下一句：再读一次盘，句子还在（不是只往内存里加了一份）',
      Number(nl.disk) === Number(s2.total) && Number(nl.disk) === before + 2,
      `读盘 ${nl.disk} / 账上 ${s2.total}`,
    ],
    [
      '下一句：可复制的纯文本里原话逐字出现，且带上编号',
      exported.includes(TEXT) && exported.includes(`1. `),
    ],
    [
      '下一句：删掉一句，账回到只多一句；再删一句，回到写之前',
      nl.deleted === true && Number(nl.afterDel1) === before + 1 && Number(nl.afterDel2) === before,
      `${nl.afterDel1} / ${nl.afterDel2}`,
    ],
  );
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
