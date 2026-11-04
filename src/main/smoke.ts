import { app, type BrowserWindow } from 'electron';
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { listReports } from './archive';
import { deliverClipboard } from './capture';

/** 等一拍。只在自检里用：界面更新不是同步落到 DOM 上的，点完就取会拿到上一帧。 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/*
 * 打包自检。
 *
 * 这个文件里全是「验证界面真的长出来了」的探针：点按钮、取 DOM、数节点、截图。
 * 它被拆出主进程，理由不是整洁，是因果：`index.ts` 回答「这个应用启动时接上了什么」，
 * 而这里回答「启动之后怎么证明它对」。两件事混在一个文件里，六百行探针
 * 会把一百行的启动逻辑挤到看不见的地方——而启动逻辑才是出事时第一个要看的东西。
 *
 * 生产运行时整段不执行：没有 AL_SMOKE 环境变量就直接返回。
 *
 * 结论一律写文件而不是 console：Windows 上 Electron 是 GUI 子系统程序，
 * console.log 不会流进父进程的管道，靠 stdout 判断等于什么都没测。
 */
export function attachSmoke(mainWindow: BrowserWindow): void {
  const shot = process.env['AL_SMOKE'];
  if (!shot) return;

  const trace = `${shot}.log`;
  const add = (line: string) => {
    try {
      appendFileSync(trace, `${new Date().toISOString()} ${line}\n`);
    } catch {
      // @allow-silent: 冒烟日志写不进磁盘不影响被冒烟的功能本身；
      // 断言结论走画面断言与退出码，不靠这份日志（它只是排错时的旁证）。
    }
  };
  writeFileSync(trace, '');
  add(`boot pid=${process.pid} electron=${process.versions.electron}`);

  /*
   * AL_WHERE=<文件>：只回报「这个进程用的是哪个 userData 目录」，报完立刻退出。
   *
   * 为什么需要它：`pack:check` 要跑打包后的 exe，而那个 exe 一旦没吃下
   * `--user-data-dir`，就会读**真实用户目录**里那份设置去打一次真模型——
   * 花钱、往真实存档里塞报告，而且事前完全看不出来（界面照常跑完）。
   * 有了这个探针，脚本能在花任何一次分析之前先确认隔离生效，不生效就直接退出。
   *
   * 必须放在任何业务动作之前：它唯一的作用就是「什么都还没做的时候问一句」。
   */
  const where = process.env['AL_WHERE'];
  if (where) {
    try {
      writeFileSync(
        where,
        `USERDATA ${app.getPath('userData')}\nAPPDATA ${process.env['APPDATA'] ?? ''}\n`
      );
    } catch {
      // @allow-silent: 这份回报写不出来时，pack:check 会因为读不到 USERDATA 而判失败并退出，
      // 不是静默通过。这里不抛只是不想在同一个地方报两次同样的错。
    }
    app.exit(0);
    return;
  }

  const wc = mainWindow.webContents;
  wc.on('console-message', (e) => add(`[renderer:${e.level}] ${e.message}`));
  wc.on('render-process-gone', (_e, d) => add(`GONE ${JSON.stringify(d)}`));
  wc.on('did-fail-load', (_e, code, desc) => {
    add(`LOAD_FAIL ${code} ${desc}`);
    app.exit(2);
  });

  // 首次引导只在「没配过 Key 且没答过」时出现，正常环境复现不出来。
  // AL_FORCE_ONBOARD 清掉标记再刷一次，让这条路径可以被截到。
  let reloaded = false;
  const forceOnboard = process.env['AL_FORCE_ONBOARD'] === '1';

  wc.on('did-finish-load', async () => {
    add('did-finish-load');
    if (forceOnboard && !reloaded) {
      reloaded = true;
      await wc.executeJavaScript(`localStorage.removeItem('al:onboarded'); true;`);
      wc.reload();
      return;
    }
    try {
      // 给 React 一帧时间挂载，再验证关键节点确实存在
      await new Promise((r) => setTimeout(r, 1600));

      // AL_ACTION=test：点一次「测试连接」，验证这条 IPC 与错误分类真的走得通
      if (process.env['AL_ACTION'] === 'test') {
        await wc.executeJavaScript(`(() => {
          [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '测试连接')?.click();
          return true;
        })()`);
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 400));
          const msg = await wc.executeJavaScript(
            `document.querySelector('.test-bar')?.textContent ?? ''`
          );
          if (msg) {
            add(`TESTBAR ${msg}`);
            break;
          }
        }
      }

      /*
       * AL_EMPTY=1：不分析，只验首屏空态。
       *
       * 空态是每个新用户看到的第一屏，而端到端跑道永远带着一份报告——
       * 不加这条岔路，空态的任何改动都只能靠运气被发现坏没坏。
       * 它坏了同样安静：整块消失或文字缺失，页面不报任何错。
       */
      if (process.env['AL_EMPTY'] === '1') {
        add('action=empty');
        await new Promise((r) => setTimeout(r, 800));
        const probe = await wc.executeJavaScript(
          `JSON.stringify({
            empty: !!document.querySelector('.empty'),
            title: (document.querySelector('.empty h2')?.innerText || '').trim(),
            emptyP: (document.querySelector('.empty > p')?.innerText || '').trim(),
            steps: document.querySelectorAll('.empty .step').length,
            emSteps: document.querySelectorAll('.empty .em-steps > div').length,
            modeNote: (document.querySelector('.mode-note')?.innerText || '').trim(),
            hint: (document.querySelector('.composer p.hint')?.innerText || '').trim(),
            modeChips: document.querySelectorAll('.mode-chip').length,
          })`
        );
        add(`EMPTYDOM ${probe}`);
      } else if (process.env['AL_ACTION'] === 'analyze') {
        // AL_ACTION=analyze：填入示例、点分析、等结果落屏。
        // 这一步验证的是整条链，而不只是窗口能开：IPC → HTTP → 解析 → 裁决 → 渲染。
        add('action=analyze');
        // AL_MODE=<模式名>：先切模式再跑。不同模式走的是同一套透镜与 CQ，
        // 变的是提示词与报告主语——这两处如果没真的生效，界面会安静地显示成诊断版。
        // 这里按 `[data-mode="..."]` 定位，所以新模式只要加了按钮就自动能被切到，
        // 不需要再改这个脚本——改脚本漏一处，就会出现「切了但没切」的假绿。
        const alMode = process.env['AL_MODE'] ?? '';
        if (alMode) {
          const sel = JSON.stringify(`[data-mode="${alMode}"]`);
          await wc.executeJavaScript(`(() => { document.querySelector(${sel})?.click(); return true; })()`);
          await new Promise((r) => setTimeout(r, 300));
        }
        /*
         * 示例按钮的轮换：连按到绕一圈，验三件事。
         *
         * 为什么值得单独验：示例只有一段时，「再试一次」永远得到同一段，
         * 存档里一百多份报告绝大多数是同一段文字——那不是一百个样本，
         * 是同一个样本跑了一百遍。轮换是这件事的对策，而**它坏了不会有任何报错**：
         * 按钮照样能按，照样填字，只是永远填同一段。这种坏法只能靠断言抓。
         *
         * 次数不写死在这里，从按钮标签（「示例 1/6」）里读出来——
         * 脚本里抄一份段数，加第七段时必然漏改，而漏改的表现是断言静默少跑几次。
         *
         * 每按一次都要等一拍再读：React 的 setState 不是同步落到 DOM 上的，
         * 同一个 tick 里读完会拿到上一段的值——第一版就是这么写的，
         * 六次读出来全是 0，而按钮其实好好地换到了第 2 段。
         *
         * 绕完一圈之后再多按一次，必须回到第一段：轮换是「转圈」，不是「用完即弃」。
         * 最后停在第一段，是因为假模型夹具里那两处 span 是照第一段算的。
         */
        const readSample = () =>
          wc.executeJavaScript(`(() => {
            const b = document.querySelector('[data-sample-btn]');
            const t = document.querySelector('textarea');
            if (!b || !t) return { found: false };
            return {
              found: true,
              label: (b.textContent || '').trim(),
              genre: b.getAttribute('data-genre') || '',
              value: t.value,
            };
          })()`);
        const clickSample = () =>
          wc.executeJavaScript(`(() => {
            const b = document.querySelector('[data-sample-btn]');
            if (!b) return false;
            b.click();
            return true;
          })()`);

        const first = (await readSample()) as { found: boolean; label?: string };
        const n = Number(((first.label ?? '').match(/(\d+)\s*\/\s*(\d+)/) ?? [])[2] ?? 0);
        const seen: string[] = [];
        const seenGenres: string[] = [];
        let labelAfterFirst = '';
        for (let i = 0; i < n; i++) {
          await clickSample();
          await sleep(120);
          const cur = (await readSample()) as { label?: string; genre?: string; value?: string };
          seen.push(cur.value ?? '');
          seenGenres.push(cur.genre ?? '');
          if (i === 0) labelAfterFirst = cur.label ?? '';
        }
        await clickSample();
        await sleep(120);
        const back = (await readSample()) as { label?: string; value?: string };

        /*
         * 「框里是自己的字」这一路。
         *
         * 输入框没有撤销，覆盖掉就没了——所以第一下只问，第二下才换。
         * 这条光靠读代码守不住：把判断写反、或者忘了在输入时复位确认态，
         * 表现都是一个能按的按钮，按下去字没了。只有真的打一段字再按，才验得到。
         *
         * 打完字要按原生 setter 派发 input 事件：React 的受控输入框不认 `t.value = x`，
         * 直接从原型上取 setter 赋值，状态才会跟着变。
         */
        const mine = '这是我自己写的一段话，用来验证按示例不会把它直接盖掉。它够长，也像一段能被判的文字。';
        await wc.executeJavaScript(`(() => {
          const t = document.querySelector('textarea');
          if (!t) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          setter.call(t, ${JSON.stringify(mine)});
          t.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()`);
        await sleep(150);
        await clickSample();
        await sleep(150);
        const afterFirstClick = (await readSample()) as { label?: string; value?: string };
        /*
         * 「覆盖原文？」这个状态只在两次点击之间存在，平时截不到。
         * 给它留一个入口，理由和「分析进行中」那一屏一样：
         * 来不及被拍到的屏，等于从没被人看过。
         */
        {
          const img = await wc.capturePage();
          const p = join(dirname(shot), 'sample-confirm.png');
          writeFileSync(p, img.toPNG());
          add(`SAMPLESHOT ${p}`);
        }
        await clickSample();
        await sleep(150);
        const afterSecondClick = (await readSample()) as { label?: string; value?: string };

        /* 收尾：把输入框放回第一段。轮换是转圈，按满一圈必然回到它，所以上界取 n。 */
        let restored = false;
        for (let i = 0; i < n; i++) {
          if (((await readSample()) as { value?: string }).value === seen[0]) {
            restored = true;
            break;
          }
          await clickSample();
          await sleep(120);
        }
        if (!restored) {
          restored = ((await readSample()) as { value?: string }).value === seen[0];
        }

        add(
          `SAMPLES ${JSON.stringify({
            found: first.found,
            N: n,
            label0: first.label ?? '',
            labelAfterFirst,
            distinct: new Set(seen).size,
            genresDistinct: new Set(seenGenres).size,
            backToFirst: back.value === seen[0],
            chars: seen.map((s) => s.length),
            mineKept: afterFirstClick.value === mine,
            askShown: (afterFirstClick.label ?? '').includes('覆盖'),
            replaced: afterSecondClick.value !== mine && (afterSecondClick.value ?? '').trim() !== '',
            restored,
          })}`
        );
        await new Promise((r) => setTimeout(r, 200));
        // 注意：页签也叫「分析」，按文本找会点到页签上。这里按提交按钮的类名定位
        await wc.executeJavaScript(`(() => {
          document.querySelector('button.primary')?.click();
          return true;
        })()`);

        /*
         * AL_RUNSHOT=<路径>：趁分析还没回来，把「进行中」那一屏拍下来。
         *
         * 这一屏的存在时间等于模型延迟：假模型平时 200 毫秒就回来，它根本来不及出现，
         * 所以这个模式要配 MOCK_DELAY_MS 用。要点不是「拍张图」，而是三个断言：
         *   - 面板真的出现了（.running）；
         *   - 阶段名是主进程报的那句，不是写死的占位；
         *   - 「已等」在动（隔一秒取两次，第二次必须更大）——不动就说明计时器没跑，
         *     用户看到的是一个永远停在 0 秒的假象。
         * 只截图不断言，等于给一个坏掉的界面留下了一张好看的证据。
         */
        const runShot = process.env['AL_RUNSHOT'];
        if (runShot) {
          const probeRun = () =>
            wc.executeJavaScript(
              `JSON.stringify({
                on: !!document.querySelector('.running'),
                label: (document.querySelector('.running .run-label')?.innerText || ''),
                pct: (document.querySelector('.running .run-pct')?.innerText || ''),
                wait: (document.querySelector('.running .run-wait')?.innerText || ''),
                empty: !!document.querySelector('.empty'),
              })`
            );
          let first: Record<string, unknown> = {};
          for (let i = 0; i < 20; i++) {
            const raw = await probeRun();
            first = JSON.parse(raw);
            if (first.on) break;
            await new Promise((r) => setTimeout(r, 100));
          }
          await new Promise((r) => setTimeout(r, 1100));
          const second: Record<string, unknown> = JSON.parse(await probeRun());
          add(`RUNNING ${JSON.stringify({ first, second })}`);
          const img0 = await wc.capturePage();
          writeFileSync(runShot, img0.toPNG());
          add(`RUNSHOT ${runShot}`);
        }

        /*
         * AL_CANCEL=1：跑起来之后按「停」，验它真的停得住。
         *
         * 这一条要抓住的坏法都长得像成功：按钮点了、界面回到可用状态、
         * 什么都不报——而请求还在跑、钱还在花。所以不只验界面，
         * 还要验三件更硬的事：
         *   - 主区回到空态（.running 没了），且**没有**红条（停下不是故障）；
         *   - 输入框里的原文还在（能改完再跑，不必重新粘一遍）；
         *   - 历史里没有多出一份（停在半路的报告不该被存成一份「结果」）。
         * 最后一条只能从主进程数：存档由主进程写，界面上看不见它有没有写。
         *
         * 要配 MOCK_DELAY_MS 用（两千毫秒以上），否则请求在按下之前就回来了——
         * 那时 abort 打在空气里，界面会说「没赶上」，而这条断言会红。
         * 红得对：没跑到就等于没验。
         */
        let canceled = false;
        if (process.env['AL_CANCEL'] === '1') {
          const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
          let btn = false;
          for (let i = 0; i < 30; i++) {
            btn = await wc.executeJavaScript(`!!document.querySelector('.run-stop')`);
            if (btn) break;
            await sleep(100);
          }
          const clicked = await wc.executeJavaScript(`(() => {
            const b = document.querySelector('.run-stop');
            if (!b) return false;
            b.click();
            return true;
          })()`);
          const t0 = Date.now();

          // 等主进程真的把它掐掉：.running 消失就是落点
          let gone = false;
          for (let i = 0; i < 40; i++) {
            gone = await wc.executeJavaScript(`!document.querySelector('.running')`);
            if (gone) break;
            await sleep(100);
          }
          /*
           * 从按下到面板消失用了多久。
           *
           * 这个数才是「停」与「等它跑完」的分界线：面板消失这件事，两种结局都会发生——
           * 真停了，它一百毫秒就消失；没停，它要等模型回来（假模型这里是三秒）。
           * 所以只数「消失没消失」等于没验，时间上界才是证据。
           */
          const stopMs = Date.now() - t0;
          await sleep(300); // 让提示条渲染完，别在它出现前就取 DOM
          const after = await wc.executeJavaScript(
            `JSON.stringify({
              running: !!document.querySelector('.running'),
              stopNote: (document.querySelector('[data-stop-note]')?.innerText || '').replace(/\\s+/g, ' '),
              bad: !!document.querySelector('.banner.bad'),
              text: (document.querySelector('textarea')?.value || '').length,
              btnOff: !!document.querySelector('button.primary')?.disabled,
              stopBtn: !!document.querySelector('.run-stop'),
              grid: !!document.querySelector('.grid'),
            })`
          );
          add(
            `CANCEL ${JSON.stringify({
              btn,
              clicked,
              gone,
              stopMs,
              ...JSON.parse(after),
              archived: listReports().length,
            })}`
          );
          canceled = true;
          const cancelShot = process.env['AL_CANCEL_SHOT'];
          if (cancelShot) {
            const img = await wc.capturePage();
            writeFileSync(cancelShot, img.toPNG());
          }
        }

        /*
         * 报告出来之后要再多取一次的标记。
         *
         * 「跑过 N 次」那一行在报告出现之后才渲染：它要等 400ms 的输入停顿，
         * 再去问主进程存档里有没有这段。而下面的循环一看到 .grid 就 break，
         * 那一刻这一行还没生成——照原来的写法取 DOM，会稳定地读到「没有」，
         * 于是「把这一行整个删掉」和「它正常渲染」得到同一个结果。
         */
        let tookSame = false;

        for (let i = 0; i < 60 && !canceled; i++) {
          await new Promise((r) => setTimeout(r, 500));
          const state = await wc.executeJavaScript(
            `JSON.stringify({
              grid: !!document.querySelector('.grid'),
              blocks: document.querySelectorAll('.block').length,
              // 争议栏只在碰到分歧时出现，渲染失败是「安静地不显示」，不会报错——
              // 所以必须单独探一下卡片数，否则它坏了也没人知道。
              disputes: document.querySelectorAll('#sec-disputes .dp-card').length,
              disputeMarks: document.querySelectorAll('.block-head .dp-mark').length,
              // 主张库同理：侧栏那块渲染不出来时页面一切正常，只是悄悄少了一块。
              // claims 是侧栏列出的专有主张，theoryBtn 是顶栏入口。
              claims: document.querySelectorAll('.tb-ri').length,
              theoryBtn: !!document.querySelector('[data-panel="theory"]'),
              /*
               * 这四项是后加的功能，共同点是：坏了都不报错，只是悄悄少一块。
               * 「异议按钮不存在」不会让页面崩，「切分条不出现」也不会——
               * 所以每一处都要单独数出来，不能靠「页面没报错」来推断它好着。
               */
              objBtns: document.querySelectorAll('.obj-btn').length,
              segBar: !!document.querySelector('.sg-bar'),
              modeChips: document.querySelectorAll('.mode-chip').length,
              histBtn: !!document.querySelector('[data-panel="history"]'),
              /*
               * 「下一步」栏。它同样是坏了不报错的那种——整块消失，页面照常。
               * 数的是处方条目：只验标题在不在，等于允许它渲染成一个空壳。
               */
              rxGroups: document.querySelectorAll('.rx-group').length,
              rxItems: document.querySelectorAll('.rx-item').length,
              /*
               * 命名栏。两件事要一起数：
               *   labelCards 数的是卡片数——「不命名的模式」必须为 0，
               *               而「命名的模式」必须至少有一张，否则就是主输出空了。
               *   candQuote  数的是带原文位置的卡片数。查谬误模式的全部价值系于它：
               *               有名字没位置，用户拿到手第一句就会问「我哪句这样了」。
               * 只数第一样会漏掉「卡片在、位置丢」——那种报告看起来完整，实际没法用。
               */
              labelCards: document.querySelectorAll('.cand').length,
              candQuote: document.querySelectorAll('.cand-quote').length,
              /*
               * 谬误落点图（查谬误模式的第五张图）。
               * fmapSent 数格子（原文句），fmapHit 数命中格。
               * 它的坏法与命名卡同款：图不渲染页面照常，命名卡也都在——
               * 少的只是「哪句挂了哪个名字」那张一眼图，只能数出来。
               */
              fmapSent: document.querySelectorAll('.fmap-s').length,
              fmapHit: document.querySelectorAll('.fmap-s-hit').length,
              /* 当前模式允不允许命名，从按钮上读——名单只存在 MODE_META 一处 */
              modeLabels: document.querySelector('.mode-chip.on')?.getAttribute('data-labels') ?? '',
              /*
               * 「有一件事没做成」的提示条。
               *
               * 这是本轮新加的那条（存档没写进去、异议没记上）。它的风险方向和别的
               * 元素相反：别的怕消失，它怕**凭空出现**——存档明明成功了却提示没存，
               * 用户就会开始怀疑历史面板里到底有几份是真的。
               * 所以这里数它是 0，不是数它在。
               */
              noticeBars: document.querySelectorAll('.banner.warn').length,
              /*
               * 导出按钮。它坏起来比别的更安静：按钮在、点了没反应，用户会以为
               * 是保存框被浏览器拦了，然后去别处找原因。这里只能验它渲染出来，
               * 保存框弹不出来（无头环境没有对话框）——那一半靠 check:export / check:argdown 的纯函数断言。
               *
               * 数文案而不是只数存在：两个格式并排，少一个也照样「有按钮」，
               * 而用户会以为这个版本就只支持一种导出。
               */
              expBtns: [...document.querySelectorAll('.exp-btn')].map((b) => (b.textContent ?? '').trim()),
              /*
               * 模式横幅与当前选中的模式片。
               * 这两个必须一起验：横幅出现但选中片不对，说明切了模式而报告没跟着走；
               * 选中片对了而横幅不出现，说明报告渲染走了默认分支。
               * 只验其中一个，都会得到「切了等于切了」的假绿。
               */
              modeBanner: (document.querySelector('.mode-banner')?.textContent ?? '').slice(0, 30),
              modeOn: document.querySelector('.mode-chip.on')?.getAttribute('data-mode') ?? '',
              /*
               * 跑道上的「倒在哪一关」与元问题闸门。
               * 这两处是加在既有按钮上的类名，坏了的表现是跑道照常显示、
               * 只是没有那一道红边和那个「闸」字——页面完全正常，照样通过一切别的检查。
               */
              stripDown: document.querySelectorAll('.strip-item.down').length,
              stripGate: document.querySelectorAll('.si-gate').length,
              stripDies: !!document.querySelector('.strip-dies'),
              /*
               * 判读的推导链。它坏起来是最彻底的那种——整块不见——但页面上
               * 刻度尺还在、结论句还在，报告看起来完全正常，只是「为什么在这一格」
               * 这一层没了。数三样：
               *   vwhy    链上的步数（给档位的模式至少两步：问了几关、钉住哪一关）
               *   vladder 三格对照（这个数必须正好 3，少一格就是有一档没写释义）
               *   vnow    标着「本次」的格，必须正好 1——0 是两个都不亮（读者不知道落在哪），
               *           2 是同时亮两格（比不亮更糟：它自相矛盾）
               */
              vwhy: document.querySelectorAll('.vstep').length,
              vlad: document.querySelectorAll('.vl-cell').length,
              vnow: document.querySelectorAll('.vl-cell.now').length,
              failed: /分析未完成/.test(document.body.innerText),
              /*
               * 「这段文字跑过没有」那一行。
               * sameCount 读的是 data-same（逐字相同的份数），sameText 读那句话本身。
               * 两样都要：只验条在，等于允许它渲染成一句空话；只验文字不验数目，
               * 验不出「数错了」——而数错了才最危险（说 89 次，实际 97 份）。
               */
              sameCount: document.querySelector('.same-bar')?.getAttribute('data-same') ?? '',
              sameText: (document.querySelector('.same-bar .sb-v')?.textContent ?? '').slice(0, 80),
              text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 240),
            })`
          );
          const st = JSON.parse(state);
          if (st.grid || st.failed) {
            /*
             * 看见报告后再等一次，专门为了那一行「跑过 N 次」。
             * 只多取一次（tookSame 挡住第二次），不是每轮都多等半秒。
             */
            if (st.grid && !tookSame && !canceled) {
              tookSame = true;
              await new Promise((r) => setTimeout(r, 900));
              continue;
            }
            add(`RESULT ${state}`);
            break;
          }
        }

        /*
         * 「跑过 N 次」那一行的样子。
         *
         * 和候选条同一个理由：整页两万像素高，一行提示缩到全页尺寸占不到一个像素。
         * 这里连 `.composer` 都不够——它有一千多像素高，那一行是里面最窄的一条。
         * 所以按 `.same-bar` 自己的矩形裁，四周各留 10px，看它有没有溢出、有没有被压成两行。
         */
        const sameRect = await wc.executeJavaScript(`(() => {
          const el = document.querySelector('.same-bar');
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return {
            x: Math.max(0, Math.round(b.left) - 10),
            y: Math.max(0, Math.round(b.top) - 10),
            width: Math.min(Math.round(b.width) + 20, 1200),
            height: Math.round(b.height) + 20,
          };
        })()`);
        const samePng = (await wc.capturePage(sameRect ?? undefined)).toPNG();
        const sameShot = join(dirname(shot), 'same-bar.png');
        writeFileSync(sameShot, samePng);
          add(
            `SAMESHOT ${sameShot} ${samePng.length} bytes rect=${
              sameRect ? `${sameRect.width}x${sameRect.height}` : 'missing'
            }`
          );

          /*
           * AL_REREAD=1：真应用里点开「回到原文重读」。
           *
           * 静态检查已经在纯函数层验过「逐句拼回 === 原文」，但那一层碰不到真界面：
           * 按钮点不动、整屏没换、句子被 React 悄悄 trim 过，纯函数全都不会知道。
           * 所以这里验四件只有 DOM 能回答的事：点得开、报告真的让位了、屏幕上那些句子
           * 与输入框里的原文逐字相同、点「回报告」还回得去。
           *
           * 输入框的值在提交时会 trim 掉首尾空白（App.tsx 的既有行为），
           * 所以比对用 trim 后的原文；纯函数那一层不 trim，两边各守各的边界。
           */
          if (process.env['AL_REREAD'] === '1' && !canceled) {
            /* 点之前先记下报告板块数：回来时必须是同一份，不是随便一块东西。 */
            const before = await wc.executeJavaScript(`JSON.stringify({
              entry: !!document.querySelector('[data-reread-open]'),
              blocksBefore: document.querySelectorAll('.block').length,
            })`);
            const opened = await wc.executeJavaScript(`(() => {
              const b = document.querySelector('[data-reread-open]');
              if (!b) return false;
              b.click();
              return true;
            })()`);
            await sleep(320);
            await wc.executeJavaScript(`(() => { window.scrollTo(0, 0); return true; })()`);
            const rrState = await wc.executeJavaScript(`JSON.stringify({
              screen: !!document.querySelector('[data-reread]'),
              blocks: document.querySelectorAll('.block').length,
              sentences: document.querySelectorAll('[data-reread-sentence]').length,
              text: [...document.querySelectorAll('.rr-text')].map((e) => e.textContent ?? '').join(''),
              passage: document.querySelector('textarea')?.value ?? '',
              refs: document.querySelectorAll('[data-reread-ref]').length,
              legal: document.querySelectorAll('.rr-ref-legit').length,
              quiet: document.querySelectorAll('[data-reread-quiet]').length,
              stat: (document.querySelector('[data-reread-stat]')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
              unplaced: document.querySelectorAll('[data-reread-unplaced]').length,
            })`);
            const rr = JSON.parse(rrState);
            add(`REREADRESULT ${JSON.stringify({ ...rr, ...JSON.parse(before), opened })}`);

            /* 整页两万像素高，这一屏单独裁出来才看得清句子与条目的层次。 */
            const rrRect = await wc.executeJavaScript(`(() => {
              const el = document.querySelector('[data-reread]');
              if (!el) return null;
              const b = el.getBoundingClientRect();
              return {
                x: Math.max(0, Math.round(b.left)),
                y: Math.max(0, Math.round(b.top)),
                width: Math.min(Math.round(b.width), 1200),
                height: Math.min(Math.round(b.height), 1100),
              };
            })()`);
            const rrPng = (await wc.capturePage(rrRect ?? undefined)).toPNG();
            const rrShot = join(dirname(shot), 'reread.png');
            writeFileSync(rrShot, rrPng);
            add(
              `REREADSHOT ${rrShot} ${rrPng.length} bytes rect=${
                rrRect ? `${rrRect.width}x${rrRect.height}` : 'missing'
              }`
            );
            /* 截图必须真的裁到了那一屏；拿全窗口顶替会让「有截图」变成恒真。 */
            add(`REREADRECT ${rrRect ? `${rrRect.width}x${rrRect.height}` : 'missing'}`);

            await wc.executeJavaScript(`(() => { document.querySelector('[data-reread-back]')?.click(); return true; })()`);
            await sleep(280);
            const backState = await wc.executeJavaScript(`JSON.stringify({
              screen: !!document.querySelector('[data-reread]'),
              blocks: document.querySelectorAll('.block').length,
            })`);
            add(`REREADBACK ${backState}`);
          }

          /*
           * AL_REVISE=1：走一遍修订对照的完整链路。
         *
         * 修补建议 → 填回输入框 → 重新分析 → 存档 → 按 parentId 取回上一版 → 算对照 → 渲染对照条。
         * 环环相扣，任何一环断掉界面都会「安静地不显示」，不报错。
         *
         * 分成两步点，是因为它本来就是两步：填回输入框只填不跑，跑要用户自己按。
         * 合成一步去验，就等于默认「工具可以替用户花这笔钱」——那正是这里要拦住的事。
         * 顺带也验了「填回去的文本跟原文像不像」：像不像决定了对照条是给结论还是说不可比。
         */
        if (process.env['AL_REVISE'] === '1' && !process.env['AL_PANEL'] && !canceled) {
          const filled = await wc.executeJavaScript(`(() => {
            const b = document.querySelector('.rp-rerun-btn');
            if (!b) return false;
            b.click();
            return true;
          })()`);
          await new Promise((r) => setTimeout(r, 400));
          const pend = await wc.executeJavaScript(`!!document.querySelector('.pend-bar')`);
          const chars = await wc.executeJavaScript(
            `(document.querySelector('textarea')?.value || '').length`
          );
          add(`REVISE fill=${filled} pend=${pend} chars=${chars}`);

          const clicked = await wc.executeJavaScript(`(() => {
            document.querySelector('button.primary')?.click();
            return true;
          })()`);
          add(`REVISE run=${clicked}`);

          for (let i = 0; i < 60; i++) {
            await new Promise((r) => setTimeout(r, 500));
            const st = await wc.executeJavaScript(
              `JSON.stringify({
                bar: !!document.querySelector('.rv-bar'),
                barText: (document.querySelector('.rv-bar')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 220),
                nums: document.querySelectorAll('.rv-bar .rv-num').length,
                rows: document.querySelectorAll('.rv-bar .rv-table tr').length,
                failed: /分析未完成/.test(document.body.innerText),
              })`
            );
            const o = JSON.parse(st);
            if (o.bar || o.failed) {
              add(`REVISERESULT ${st}`);
              /*
               * 折叠着的对照条只有一句话，证明不了下面的三项数字算出来了。
               * 点开再探一次——对照条的价值全在展开后的那几行里。
               */
              await wc.executeJavaScript(`document.querySelector('.rv-head')?.click()`);
              await new Promise((r) => setTimeout(r, 400));
              const open = await wc.executeJavaScript(
                `JSON.stringify({
                  detail: !!document.querySelector('.rv-detail'),
                  nums: document.querySelectorAll('.rv-bar .rv-num').length,
                  rows: document.querySelectorAll('.rv-bar .rv-table tr').length,
                  text: (document.querySelector('.rv-detail')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 240),
                })`
              );
              add(`REVISEOPEN ${open}`);
              break;
            }
          }
        }
      }
      const probe = await wc.executeJavaScript(`(() => {
        const q = (s) => !!document.querySelector(s);
        return JSON.stringify({
          topbar: q('.topbar'),
          lensChips: document.querySelectorAll('.lens-chip').length,
          textarea: q('textarea'),
          hasApi: typeof window.api === 'object' && !!window.api,
          hash: location.hash,
          /*
           * 横向溢出。截图看不出「右边被截掉一点」，但数字看得出：
           * 只要文档比视口宽，就说明有元素撑出去了。新加的条（切分条、模式条、
           * 待对照条）都塞在侧栏里，那里宽度最紧，是最容易撑破的地方。
           */
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          /*
           * 新加的几处：不只要「存在」，还要「有尺寸」。
           * 一个宽度 0 的按钮在 DOM 里照样数得出来，但用户点不到。
           */
          sizes: JSON.stringify(
            ['.sg-bar', '.mode-bar', '.obj-btn', '[data-panel="history"]'].map((s) => {
              const el = document.querySelector(s);
              if (!el) return [s, -1, -1];
              const r = el.getBoundingClientRect();
              return [s, Math.round(r.width), Math.round(r.height)];
            })
          ),
          text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 300),
        });
      })()`);
      add(`DOM ${probe}`);

      // AL_PANEL=usage：点开用量面板再截。面板靠 IPC 取数，纯静态预览页跑不了它。
      if (process.env['AL_PANEL'] === 'usage') {
        const ok = await wc.executeJavaScript(`(() => {
          const el = document.querySelector('.usage-chip');
          if (!el) return false;
          el.click();
          return true;
        })()`);
        add(`PANEL click=${ok}`);
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 300));
          const ready = await wc.executeJavaScript(`!!document.querySelector('.dialog.usage .u-kpis')`);
          if (ready) break;
        }
        const panelProbe = await wc.executeJavaScript(`JSON.stringify({
          kpis: document.querySelectorAll('.u-kpi').length,
          rows: document.querySelectorAll('.u-tr').length,
          bars: document.querySelectorAll('.u-day').length,
          bar: !!document.querySelector('.u-bar'),
          /*
           * 今天那根柱子的实际像素高度。
           *
           * 「14 个格子画出来了」与「数据真的映射成了高度」是两件事：
           * 比例算错、单位用错、或者 cost 一律取 0 时，格子照样是 14 个，
           * 只是全部贴底——看起来完全正常。所以要量高度，不数格子。
           */
          todayH: (() => {
            const el = document.querySelector('.u-day.today i');
            return el ? Math.round(el.getBoundingClientRect().height) : -1;
          })(),
          text: (document.querySelector('.dialog.usage')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 260),
        })`);
        add(`PANELDOM ${panelProbe}`);
        await new Promise((r) => setTimeout(r, 400));
      }

      // AL_PANEL=disputes：点开「争议地图」。这条最要紧的是「站边」看得出看不出。
      if (process.env['AL_PANEL'] === 'disputes') {
        const ok = await wc.executeJavaScript(`(() => {
          const el = document.querySelector('.dp-open');
          if (!el) return false;
          el.click();
          return true;
        })()`);
        add(`PANEL click=${ok}`);
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 300));
          if (await wc.executeJavaScript(`!!document.querySelector('.dialog.dp-dialog .dp-card')`)) break;
        }
        // 展开前三张：折叠着的卡看不出「两派各主张什么」，而那正是这张图的全部内容
        await wc.executeJavaScript(`(() => {
          const hs = [...document.querySelectorAll('.dialog.dp-dialog .dp-card .dp-head')].slice(0, 3);
          hs.forEach((h) => h.click());
          return hs.length;
        })()`);
        await new Promise((r) => setTimeout(r, 400));
        const panelProbe = await wc.executeJavaScript(`JSON.stringify({
          cards: document.querySelectorAll('.dialog.dp-dialog .dp-card').length,
          camps: document.querySelectorAll('.dialog.dp-dialog .dp-camp').length,
          pins: document.querySelectorAll('.dialog.dp-dialog .dp-pin').length,
          because: document.querySelectorAll('.dialog.dp-dialog .dp-because').length,
          text: (document.querySelector('.dialog.dp-dialog')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 260),
        })`);
        add(`PANELDOM ${panelProbe}`);
        await new Promise((r) => setTimeout(r, 400));
      }

      /*
       * AL_PANEL=history：点开「历史」。
       * 这条顺带验了存档——列表里的行是从磁盘读出来的，不是内存里的 diag。
       * 存档坏了，界面一切照常，只是列表永远空着，所以必须数行。
       */
      if (process.env['AL_PANEL'] === 'history') {
        const ok = await wc.executeJavaScript(`(() => {
          const el = document.querySelector('[data-panel="history"]');
          if (!el) return false;
          el.click();
          return true;
        })()`);
        add(`PANEL click=${ok}`);
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 300));
          if (await wc.executeJavaScript(`!!document.querySelector('.dialog.hs-dialog')`)) break;
        }
        await new Promise((r) => setTimeout(r, 400));
        const panelProbe = await wc.executeJavaScript(`JSON.stringify({
          tabs: document.querySelectorAll('.dialog.hs-dialog .hs-tab').length,
          rows: document.querySelectorAll('.dialog.hs-dialog .hs-row').length,
          del: document.querySelectorAll('.dialog.hs-dialog .hs-del').length,
          text: (document.querySelector('.dialog.hs-dialog')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 300),
        })`);
        add(`PANELDOM ${panelProbe}`);
        await new Promise((r) => setTimeout(r, 400));
      }

      /*
       * AL_PANEL=prompt：切到「提示词」页。
       *
       * 这一页要验的不只是「提示词显示出来了」，还有**版本号与指纹显示出来了**。
       * 提示词一改，判定口径就可能变；用户手上有三份报告时，
       * 唯一能回答「这三份是不是同一把尺子量的」的，就是这一行小字。
       * 它比提示词正文更容易在重构里掉，所以单独断言。
       */
      // AL_PANEL2：第二个面板。打包自检要一次跑完「用量」与「提示词」两页，
      // 而 AL_PANEL 只有一个，为它再起一次进程要多花一分多钟。
      if (process.env['AL_PANEL'] === 'prompt' || process.env['AL_PANEL2'] === 'prompt') {
        const ok = await wc.executeJavaScript(`(() => {
          const b = Array.from(document.querySelectorAll('button.tab')).find((x) => (x.innerText || '').includes('提示词'));
          if (!b) return false;
          b.click();
          return true;
        })()`);
        add(`PANEL click=${ok}`);
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 300));
          if (await wc.executeJavaScript(`!!document.querySelector('.prompt-view .pv-meta')`)) break;
        }
        await new Promise((r) => setTimeout(r, 400));
        const panelProbe = await wc.executeJavaScript(`JSON.stringify({
          view: !!document.querySelector('.prompt-view'),
          meta: (document.querySelector('.pv-meta')?.innerText || '').replace(/\\s+/g, ' '),
          sysLen: (document.querySelector('.prompt-scroll pre.code')?.innerText || '').length,
        })`);
        add(`PANELDOM ${panelProbe}`);
        await new Promise((r) => setTimeout(r, 400));
      }

      // 报告类界面一屏看不完，允许把窗口撑高再截，避免逐段滚动拼接
      const shotH = Number(process.env['AL_SHOT_H'] ?? 0);
      if (shotH) {
        mainWindow.setContentSize(Number(process.env['AL_SHOT_W'] ?? 1380), shotH);
        await new Promise((r) => setTimeout(r, 800));
      }

      // AL_EXPAND=选择器：把页面上的折叠区展开，可选 AL_EXPAND_SCROLL=1 滚过去。
      // 折叠区在截图里是看不见的，而「看不看得见」正是这类改动唯一能验的东西。
      const expandSel = process.env['AL_EXPAND'];
      if (expandSel) {
        const scrollIt = process.env['AL_EXPAND_SCROLL'] === '1';
        const res = await wc.executeJavaScript(
          `(() => {
            const el = document.querySelector(${JSON.stringify(expandSel)});
            if (!el) return 'missing';
            if (el.tagName === 'DETAILS') el.open = true;
            ${scrollIt ? "el.scrollIntoView({ block: 'start' });" : ''}
            const secs = el.querySelectorAll('.tc-sec').length;
            const refs = el.querySelectorAll('.tc-refs li').length;
            return 'opened secs=' + secs + ' refs=' + refs;
          })()`
        );
        add(`EXPAND ${expandSel} ${res}`);
        await new Promise((r) => setTimeout(r, 600));
      }

      /*
        AL_CLICK=选择器：点一下；AL_CLICK_CHECK=选择器：点完之后看它有没有真的进视野。
        为什么需要这一对：像「从结论跳到那一条争议」这种交互，
        截图只能证明「点了没崩」，证明不了「跳到了对的地方」——
        而跳错地方恰恰是这类链接最常见的坏法。
      */
      const clickSel = process.env['AL_CLICK'];
      if (clickSel) {
        /*
          支持链式：AL_CLICK='a >> b' 表示先点 a、等界面更新、再点 b。
          需要它的场景：新内容折在两级入口后面（先开「理论」再点「十规则」），
          一次点击到不了，而分两次跑就得写两支脚本。
        */
        const steps = clickSel.split('>>').map((s) => s.trim()).filter(Boolean);
        const done: string[] = [];
        for (const step of steps) {
          const r = await wc.executeJavaScript(
            `(() => {
              const el = document.querySelector(${JSON.stringify(step)});
              if (!el) return 'missing';
              el.click();
              return 'clicked';
            })()`
          );
          done.push(`${step}=${r}`);
          await new Promise((r2) => setTimeout(r2, 700));
        }
        const checkSel = process.env['AL_CLICK_CHECK'];
        const probe = checkSel
          ? await wc.executeJavaScript(
              `(() => {
                const el = document.querySelector(${JSON.stringify(checkSel)});
                if (!el) return JSON.stringify({ found: false });
                const b = el.getBoundingClientRect();
                return JSON.stringify({
                  found: true,
                  inView: b.top >= 0 && b.bottom <= window.innerHeight + 1,
                  top: Math.round(b.top),
                  flash: el.classList.contains('dp-flash'),
                });
              })()`
            )
          : '';
        add(`CLICK ${done.join(' → ')} ${probe}`);
        await new Promise((r) => setTimeout(r, 500));
      }

      /*
        AL_CLIP=选择器：只截这一块，并把它滚到窗口内。
        长图能证明「渲染出来了」，证明不了「排得对」——一行小字有没有被压住，
        在两万像素的长图里根本看不出来。要判排版，就得单独截那一块。
      */
      const clipSel = process.env['AL_CLIP'];
      let clip: { x: number; y: number; width: number; height: number } | undefined;
      if (clipSel) {
        await wc.executeJavaScript(
          `(() => {
            const el = document.querySelector(${JSON.stringify(clipSel)});
            if (el) el.scrollIntoView({ block: 'start' });
            return !!el;
          })()`
        );
        await new Promise((r) => setTimeout(r, 400));
        clip =
          (await wc.executeJavaScript(
            `(() => {
              const el = document.querySelector(${JSON.stringify(clipSel)});
              if (!el) return null;
              const b = el.getBoundingClientRect();
              const w = Math.min(b.width, window.innerWidth - Math.max(0, b.left));
              const h = Math.min(b.height, window.innerHeight - Math.max(0, b.top));
              return { x: Math.round(Math.max(0, b.left)), y: Math.round(Math.max(0, b.top)), width: Math.round(w), height: Math.round(h) };
            })()`
          )) ?? undefined;
        add(`CLIP ${clip ? `${clip.width}x${clip.height}@${clip.x},${clip.y}` : 'missing'}`);
      }

      const img = await wc.capturePage(clip);
      const png = img.toPNG();
      writeFileSync(shot, png);
      add(`SHOT ${shot} ${png.length} bytes`);

      /*
        全局快捷键：把「剪贴板里读到这段」直接投给渲染层，一条条走判定。

        这一步**跳过了「按一下那个键」**——全局键盘事件在自检里造不出来
        （没有可编程的按键注入，也不该为了测试往系统里装一个）。
        跳过的是按键与 `clipboard.readText()` 那一行；判定（填 / 问 / 不填）
        与界面回话，走的都是真实代码。

        放在截图之后：它会改输入框内容，先拍完再动，免得把首屏截图改成测试现场。
      */
      {
        /*
         * 打包自检跑完会切到提示词页，那时分析页整块不在 DOM 里（连输入框都没有）。
         * 先切回来——这样打包产物里的快捷键也能被真验一次，而不是输出一行 null。
         * 切不回来就明写 SKIP：一行全 null 看起来像「全坏了」，比不跑更误导。
         */
        const back = await wc.executeJavaScript(`(() => {
          if (document.querySelector('textarea')) return 'already';
          const t = [...document.querySelectorAll('.tab')].find((el) => (el.textContent || '').includes('分析'));
          if (!t) return 'no-tab';
          t.click();
          return 'switched';
        })()`);
        if (back === 'switched') await sleep(500);
        const hasTa = await wc.executeJavaScript(`!!document.querySelector('textarea')`);
        if (!hasTa) {
          add(`CAPTURE-SKIP 没有输入框（back=${back}），这一组没有跑`);
        } else {
        const setText = async (t: string) =>
          wc.executeJavaScript(`(() => {
            const ta = document.querySelector('textarea');
            if (!ta) return false;
            const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
            if (!set) return false;
            set.call(ta, ${JSON.stringify(t)});
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          })()`);

        const snap = async (): Promise<{
          v: string | null;
          status: string | null;
          hint: string;
          note: string;
          ask: boolean;
          askText: string;
        }> =>
          JSON.parse(
            await wc.executeJavaScript(`(() => {
              const ta = document.querySelector('textarea');
              const st = document.querySelector('[data-cap-status]');
              const n = document.querySelector('[data-cap-note]');
              const a = document.querySelector('[data-cap-ask]');
              return JSON.stringify({
                v: ta ? ta.value : null,
                status: st ? st.getAttribute('data-cap-status') : null,
                hint: (st ? st.innerText : '').replace(/\\s+/g, ' ').slice(0, 140),
                note: n ? (n.innerText || '').replace(/\\s+/g, ' ') : '',
                ask: !!a,
                askText: a ? (a.innerText || '').replace(/\\s+/g, ' ') : '',
              });
            })()`)
          );

        const offer = async (text: string) => {
          await deliverClipboard(mainWindow, () => text);
          await sleep(220);
          return snap();
        };

        const click = async (sel: string) => {
          await wc.executeJavaScript(
            `(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true; })()`
          );
          await sleep(180);
          return snap();
        };

        const MINE = '这是我自己写的一段话，不能被悄悄换掉。';
        const out: Record<string, unknown> = {};

        const s0 = await snap();
        out.status = s0.status;
        out.hint = s0.hint;

        // 1) 空框 + 剪贴板有字 → 直接填，并说明它从哪来
        await setText('');
        await sleep(120);
        const s1 = await offer('这是从剪贴板里来的一段话。');
        out.fill = s1.v;
        out.fillNote = s1.note;

        // 2) 框里是自己的字 → 只问，不覆盖
        await setText(MINE);
        await sleep(120);
        const s2 = await offer('另一段来自剪贴板的文字。');
        out.ask = s2.ask;
        out.askKept = s2.v === MINE;
        // 候选条里的那句话在 [data-cap-ask] 里，不在 [data-cap-note] 里——
        // 这是两条不同的条：一条是「回话」，一条是「问话」。
        out.askNote = s2.askText;

        /*
         * 这一屏只在「框里有你的字 + 按了快捷键」时出现，正常跑一遍永远看不到。
         * 不留一张，就等于没人见过它长什么样——而排版的错（按钮挤到换行、
         * 提示被截断）只有看图才发现。
         */
        const askShot = join(dirname(shot), 'capture-ask.png');
        /*
         * 只截输入区那一块。
         *
         * 整页截图在这个应用里有两万像素高：候选条只有一行，缩到能看全页的尺寸时
         * 它占不到一个像素，等于没拍。要判排版就得把那一块单独取出来。
         */
        const askRect = await wc.executeJavaScript(`(() => {
          const el = document.querySelector('.composer');
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return {
            x: Math.round(b.left),
            y: Math.round(b.top),
            width: Math.round(b.width),
            height: Math.min(Math.round(b.height), 520),
          };
        })()`);
        const askPng = (await wc.capturePage(askRect ?? undefined)).toPNG();
        writeFileSync(askShot, askPng);
        out.askShot = askPng.length;
        out.askShotRect = askRect ? `${askRect.width}x${askRect.height}` : 'missing';
        add(`CAPTURESHOT ${askShot} ${askPng.length} bytes rect=${out.askShotRect}`);

        // 3) 点「不用」→ 条消失，字不动
        const s3 = await click('.cap-keep');
        out.keepAsk = s3.ask;
        out.keepText = s3.v === MINE;

        // 4) 再投一次、点「用它」→ 这时才替换
        await offer('另一段来自剪贴板的文字。');
        const s4 = await click('.cap-use');
        out.useText = s4.v;

        // 5) 剪贴板是白的 → 不填，但要说一句（否则人会以为键坏了）
        await setText('');
        await sleep(120);
        const s5 = await offer('   ');
        out.emptyNote = s5.note;
        out.emptyText = s5.v;

        // 6) 超长 → 不填，也不许截断
        const s6 = await offer('字'.repeat(12001));
        out.longNote = s6.note.slice(0, 90);
        out.longText = s6.v;
        out.longLen = (s6.v ?? '').length;

        add(`CAPTURE ${JSON.stringify(out)}`);
        }
      }

      add('OK');
    } catch (err) {
      add(`ERR ${(err as Error).message}`);
    }
    app.exit(0);
  });
}
