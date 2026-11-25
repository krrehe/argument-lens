import { app, clipboard, type BrowserWindow } from 'electron';
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { listReports } from './archive';
import { deliverClipboard } from './capture';
import { SAMPLING } from './prompt';
import { readSettings } from './store';

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

      /*
       * 阅读层级的切换放在**报告落屏之后**（见下面那个等 .grid 的循环）：
       * 这一刻窗口里只有输入区，报告第一行那条工具条还不存在，点了也是空点。
       * 第一版就栽在这儿——日志写着 no-report-bar，整趟其实一直在简洁态跑，
       * 于是末尾两处按元素高度取数的断言悄悄红了。
       */
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
        /*
         * AL_BRIEF=1：先把立案三问填了再跑。
         *
         * 这一条要验的是「填了之后报告那边认不认」：输入区填的四个值 → preload →
         * 主进程 → 存进报告 → 报告里那一栏把 A1/A2 记成「做了」。链上任何一环断了，
         * 界面都不会报错，只会显示成「没立案」——而没立案看起来完全正常（默认就是这样）。
         * 所以必须有两条跑道：默认不填（报告应说缺），这条填（报告应说做了）。
         */
        if (process.env['AL_BRIEF'] === '1') {
          const filled = await wc.executeJavaScript(`(() => {
            const t = document.querySelector('[data-brief-toggle]');
            if (!t) return { found: false };
            t.click();
            return { found: true };
          })()`);
          await new Promise((r) => setTimeout(r, 200));
          const typed = await wc.executeJavaScript(`(() => {
            const setV = (sel, v) => {
              const el = document.querySelector(sel);
              if (!el) return false;
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              setter.call(el, v);
              el.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            };
            const a = setV('[data-brief-field="speaker"]', '城南小学校办');
            const b = setV('[data-brief-field="version"]', '2026-11 第一版');
            document.querySelector('[data-brief-source="original"]')?.click();
            document.querySelector('[data-brief-object="argument"]')?.click();
            return { a, b };
          })()`);
          await new Promise((r) => setTimeout(r, 250));
          const briefDom = await wc.executeJavaScript(`(() => {
            const card = document.querySelector('[data-brief]');
            return {
              flag: card?.getAttribute('data-brief') ?? '',
              gaps: card?.querySelector('[data-brief-gaps]')?.getAttribute('data-brief-gaps') ?? '',
              line: (card?.querySelector('[data-brief-line]')?.textContent ?? '').trim(),
            };
          })()`);
          add(`BRIEFCARD ${JSON.stringify({ filled, typed, ...briefDom })}`);
          /*
           * 立案卡展开的样子：它只在「点开填写」之后出现，而这一屏是流程的入口——
           * 没人拍过它，就等于没人核对过那四个字段排得下排不下。
           */
          const box = (await wc.executeJavaScript(`(() => {
            const el = document.querySelector('.bf');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
          })()`)) as { x: number; y: number; width: number; height: number } | null;
          if (box && box.width > 100 && box.height > 60) {
            const img = await wc.capturePage(box);
            const p = join(dirname(shot), 'brief-card.png');
            writeFileSync(p, img.toPNG());
            add(`BRIEFSHOT ${p}`);
          }
        }
        /*
         * AL_DIVERGENCE=1：把 v1.1 的分歧账填齐，再按「分析」。
         *
         * 比立案更险的一处：分歧账没带进报告时，界面既不报错也不空白，
         * 只是老老实实写「没有分歧账」——而那正是**没填**时的正确样子。
         * 「填了没传过去」与「本来就没填」在截图上一模一样，只有把输入区那张卡
         * 与报告里那一栏对着读才分得开。
         *
         * 填的是 §4.3「分叉」的全套：四格坐标、并列 2 个方案、矩阵四行、
         * E4 一条（位置 + F2 + 影响档位）。填齐了 F-a/F-b/F-c/E4 四格才该是「做了」。
         * 四格下拉故意**同步连点**：坐标曾按渲染时的快照整份展开，连着选四下
         * 只会留下最后一格；这一跑要证明它真的改成函数式合并了。
         */
        if (process.env['AL_DIVERGENCE'] === '1') {
          const dvOpen = await wc.executeJavaScript(`(() => {
            const t = document.querySelector('[data-dv-toggle]');
            if (!t) return { found: false };
            t.click();
            return { found: true };
          })()`);
          await sleep(220);

          const dvFrames = await wc.executeJavaScript(`(() => {
            const setSel = (sel, v) => {
              const el = document.querySelector(sel);
              if (!el) return false;
              const s = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
              s.call(el, v);
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            };
            return {
              formal: setSel('[data-dv-frame="formal"] select', 'classical'),
              criterion: setSel('[data-dv-frame="criterion"] select', 'scheme-cq'),
              dimension: setSel('[data-dv-frame="dimension"] select', 'dialectic'),
              protocol: setSel('[data-dv-frame="protocol"] select', 'inquiry'),
              fork: !!document.querySelector('[data-dv-mode="fork"]'),
            };
          })()`);
          await wc.executeJavaScript(`(() => {
            document.querySelector('[data-dv-mode="fork"]')?.click();
            return true;
          })()`);
          await sleep(300);

          const dvTexts = await wc.executeJavaScript(`(() => {
            const setSel = (sel, v) => {
              const el = document.querySelector(sel);
              if (!el) return false;
              const s = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
              s.call(el, v);
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            };
            const setIn = (sel, v) => {
              const el = document.querySelector(sel);
              if (!el) return false;
              const proto = el.tagName === 'TEXTAREA'
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype;
              const s = Object.getOwnPropertyDescriptor(proto, 'value').set;
              s.call(el, v);
              el.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            };
            return {
              branches: setSel('[data-dv-branches]', '2'),
              basis: setIn('[data-dv-text="basis"]', '宽读：第 3 句 + 未过 CQ「样例是否典型」；严读：第 3 句 + 未过 CQ「转述是否准确」'),
              common: setIn('[data-dv-text="common"]', '两读都同意：早读与记忆效率之间的支撑不足'),
              difference: setIn('[data-dv-text="difference"]', 'B2 补出的 A，以及 C2 选中的型式'),
              condition: setIn('[data-dv-text="condition"]', '给出原始研究出处只剩宽读；只给二手转述只剩严读'),
              add: !!document.querySelector('[data-dv-add="1"]'),
            };
          })()`);
          await wc.executeJavaScript(`(() => {
            document.querySelector('[data-dv-add="1"]')?.click();
            return true;
          })()`);
          await sleep(300);

          const dvEntry = await wc.executeJavaScript(`(() => {
            const setIn = (sel, v) => {
              const el = document.querySelector(sel);
              if (!el) return false;
              const proto = el.tagName === 'TEXTAREA'
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype;
              const s = Object.getOwnPropertyDescriptor(proto, 'value').set;
              s.call(el, v);
              el.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            };
            const at = setIn('[data-dv-entry-at="0"]', 'B2 补 A：宽读与严读各补一个 A');
            const s = document.querySelector('[data-dv-entry-source="F2"]');
            const k = document.querySelector('[data-dv-entry-stakes="level"]');
            if (s) s.click();
            if (k) k.click();
            return { at: at, source: !!s, stakes: !!k };
          })()`);
          await sleep(320);

          const dvCard = await wc.executeJavaScript(`(() => {
            const card = document.querySelector('[data-dv]');
            const frames = ['formal', 'criterion', 'dimension', 'protocol'].map(function (k) {
              return document.querySelector('[data-dv-frame="' + k + '"] select')?.value ?? '';
            });
            return {
              flag: card?.getAttribute('data-dv') ?? '',
              open: card?.getAttribute('data-open') ?? '',
              frames: frames.join(','),
              closure: document.querySelector('.dv-chips[data-dv-closure]')?.getAttribute('data-dv-closure') ?? '',
              gaps: card?.querySelector('[data-dv-gaps]')?.getAttribute('data-dv-gaps') ?? '',
              line: (card?.querySelector('[data-dv-line]')?.textContent ?? '').trim().slice(0, 100),
              entries: card?.querySelectorAll('[data-dv-entry]').length ?? 0,
              pend: !!card?.querySelector('[data-dv-pend]'),
            };
          })()`);
          add(
            `DIVERGENCECARD ${JSON.stringify({ opened: dvOpen, frames: dvFrames, texts: dvTexts, entry: dvEntry, card: dvCard })}`
          );

          /*
           * 展开后的卡比视口高，一张截不完。上半张看四格坐标与矩阵，
           * 下半张看缺口、硬规矩与「填完要再跑一次」——最后那句尤其容易被挤到
           * 屏幕外，而它一旦看不见，人根本不知道填完还得重跑一次。
           *
           * 矩形一律夹在视口内：capturePage 拿到视口外的 rect 会抛
           * UnknownVizError，整趟自检断在这里，后面几十条断言会一起红到
           * 「应用没启动」那种不相干的地方。
           */
          const dvRectExpr = `(() => {
            const el = document.getElementById('divergence-card');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const y = Math.max(0, Math.round(r.top));
            const height = Math.min(Math.round(r.bottom) - y, window.innerHeight - y);
            return {
              x: Math.max(0, Math.round(r.left)),
              y: y,
              width: Math.round(r.width),
              height: Math.max(0, Math.min(height, 1800)),
            };
          })()`;
          const dvRect = async () =>
            (await wc.executeJavaScript(dvRectExpr)) as {
              x: number;
              y: number;
              width: number;
              height: number;
            } | null;

          await wc.executeJavaScript(`(() => {
            document.getElementById('divergence-card')?.scrollIntoView({ block: 'start', behavior: 'instant' });
            return true;
          })()`);
          await sleep(250);
          const dvBox = await dvRect();
          if (dvBox && dvBox.width > 100 && dvBox.height > 60) {
            const img = await wc.capturePage(dvBox);
            const p = join(dirname(shot), 'divergence-card.png');
            writeFileSync(p, img.toPNG());
            add(`DIVCARDSHOT ${p}`);
          }

          await wc.executeJavaScript(`(() => {
            document.getElementById('divergence-card')?.scrollIntoView({ block: 'end', behavior: 'instant' });
            return true;
          })()`);
          await sleep(280);
          const dvBox2 = await dvRect();
          if (dvBox2 && dvBox2.width > 100 && dvBox2.height > 60) {
            const img = await wc.capturePage(dvBox2);
            const p = join(dirname(shot), 'divergence-card-bottom.png');
            writeFileSync(p, img.toPNG());
            add(`DIVCARDBOTTOM ${p}`);
          }
        }
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
        let densityFlipped = false;
        const wantCompact = process.env['AL_DENSITY'] === 'compact';

        for (let i = 0; i < 60 && !canceled; i++) {
          await new Promise((r) => setTimeout(r, 500));
          /*
           * 真应用默认「简洁」（核对层收起），而这一百多条端到端断言是按
           * 「所有栏都展开」写的：有的按 DOM 取数，有的量元素高度，有的拍整页图。
           * 所以默认跑道在报告真落屏之后点一下界面上真人也会点的「完整」按钮——
           * 顺带验了它一栏不少。点完让这一轮跳过读数，下一轮从展开态重新取。
           * AL_DENSITY=compact 不点，那条跑道专验收起本身（见 DENSITYDOM）。
           */
          if (!wantCompact && !densityFlipped) {
            const flip = await wc.executeJavaScript(`(() => {
              if (!document.querySelector('.grid')) return 'no-report-yet';
              const b = document.querySelector('[data-density="full"]');
              if (!b) return 'no-bar';
              b.click();
              return 'clicked';
            })()`);
            if (flip === 'clicked') {
              densityFlipped = true;
              add('DENSITY full clicked');
              continue;
            }
          }
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
               * 深查发现账本。坏起来同样是「安静地少一块」，
               * 所以单独数：块在不在、几条发现、每条有没有状态、
               * 第二遍的最强反驳有没有落进卡片、落不到原文的候选有没有被吞。
               */
              deepBlock: !!document.querySelector('#sec-deep'),
              deepCount: document.querySelectorAll('[data-deep-finding]').length,
              deepLine: (document.querySelector('[data-deep-line]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
              deepStatuses: [...document.querySelectorAll('[data-deep-status]')].map((e) => e.getAttribute('data-deep-status') ?? ''),
              deepChallenges: document.querySelectorAll('.dp-challenge').length,
              deepUnlocated: document.querySelectorAll('[data-deep-unlocated-list] li').length,
              deepTheory: document.querySelectorAll('[data-deep-theory]').length,
              deepTargetMiss: document.querySelectorAll('[data-deep-target-ok="0"]').length,
              deepTargetBtns: document.querySelectorAll('[data-deep-target]').length,
              deepQuoteBtns: document.querySelectorAll('[data-deep-quote]').length,
              /*
               * 自省账本。它只在深查报告里出现，坏法是「整块消失」或
               * 「只剩一句总述、来源分不开」——页面照样完整，读者以为这报告自省过。
               */
              selfAuditBlock: !!document.querySelector('#sec-selfaudit'),
              selfAuditCount: document.querySelectorAll('[data-self-audit-item]').length,
              selfAuditLine: (document.querySelector('[data-self-audit-line]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
              selfAuditSources: [...document.querySelectorAll('[data-self-audit-item]')].map(
                (e) => e.getAttribute('data-self-audit-source') ?? ''
              ),
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
              /*
               * 命题账。它是纯本地推导：模型每次给的前提数目不一样，所以这里
               * 不钉死条数，只验三件在真应用里会单独坏掉的事——
               * 挂没挂上（0 行）、分到组没有、每行有没有露出依据与改归条件。
               * 第三件最容易坏成「四个标签一字排开」，那样子上还是一栏，
               * 实际只是把标签又贴了一遍。
               */
              propRows: document.querySelectorAll('[data-prop]').length,
              propGroups: document.querySelectorAll('[data-decid]').length,
              propBasis: (document.querySelector('.pl-why')?.textContent ?? '').slice(0, 60),
              /*
               * 枢纽前提。它和命题账一样全是本地推导，条数跟着模型给的支撑关系走，
               * 所以不钉死条数；守三件会单独坏的事——
               * 挂没挂上（0 行）、有没有主句、排序规则有没有印出来。
               * 第三件最容易坏成「一个排名悬在半空」：读者看到「枢纽」两个字，
               * 却不知道凭什么它排第一，那一栏就成了判决。
               */
              pivRows: document.querySelectorAll('[data-pivot]').length,
              pivHead: (document.querySelector('.pvt-head')?.textContent ?? '').slice(0, 80),
              pivBadges: Array.from(document.querySelectorAll('.pvt-badge')).map((b) => b.textContent ?? ''),
              pivSigs: document.querySelectorAll('[data-sig]').length,
              pivNote: (document.querySelector('.pvt-fine')?.textContent ?? '').slice(0, 40),
              pivNext: (document.querySelector('[data-pivot-next]')?.textContent ?? '').slice(0, 40),
              propIf: (document.querySelector('.pl-if')?.textContent ?? '').slice(0, 60),
              /*
               * 首屏那条「跳到」。它是整页唯一的紧凑索引，而命题账与枢纽落在一万像素
               * 以下——不进这条就等于做完藏起来。两种坏法都验：
               *   qnavDead  格子指向一个不存在的 id（点下去没反应，看起来像卡了一下）
               *   qnavOrder 格子的先后与正文顺序不一致（读者按索引走会来回折返）
               */
              qnav: Array.from(document.querySelectorAll('[data-qnav]')).map(
                (b) => b.getAttribute('data-qnav') ?? '',
              ),
              qnavDead: Array.from(document.querySelectorAll('[data-qnav]')).filter(
                (b) => !document.getElementById(b.getAttribute('data-qnav') ?? ''),
              ).length,
              qnavOrder: (() => {
                const els = Array.from(document.querySelectorAll('[data-qnav]')).map((b) =>
                  document.getElementById(b.getAttribute('data-qnav') ?? ''),
                );
                for (let i = 1; i < els.length; i += 1) {
                  const a = els[i - 1];
                  const b = els[i];
                  if (!a || !b) return false;
                  if (!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
                }
                return true;
              })(),
              /*
               * 全流程账。三样东西会各自单独坏：
               *   flowRows  二十步挂没挂上（0 行 = 整块没渲染，而报告别处一切正常）
               *   flowA1/A2 立案填了没有——它必须与输入区那张卡对得上，否则就是
               *             「填了没传过去」或「没填却显示做过」，两种都只在报告侧露馅
               *   breach    A 没做完却给了档位时那句话在不在
               */
              flowRows: document.querySelectorAll('[data-flow-row]').length,
              flowIds: Array.from(document.querySelectorAll('[data-flow-row]')).map(
                (e) => e.getAttribute('data-flow-row') ?? '',
              ),
              flowDepth: document.querySelector('[data-flow]')?.getAttribute('data-depth') ?? '',
              flowLine: (document.querySelector('[data-flow-line]')?.textContent ?? '').trim().slice(0, 70),
              flowA1: document.querySelector('[data-flow-row="A1"]')?.getAttribute('data-status') ?? '',
              flowA2: document.querySelector('[data-flow-row="A2"]')?.getAttribute('data-status') ?? '',
              flowBreach: !!document.querySelector('[data-flow-breach]'),
              flowBrief: document.querySelector('[data-brief]')?.getAttribute('data-brief') ?? '',
              /*
               * v1.1：默认收束那一行，与 F 三步 / E4 四格的状态。
               *
               * 分歧账最阴的坏法是「填了却没带进报告」：界面不报错、不空白，
               * 只是写一句「没有分歧账」——而那正是没填时的正确样子。
               * 所以除了四格状态，还得把报告里那一栏本身读出来对着比。
               */
              flowClosure: (document.querySelector('[data-flow-closure]')?.textContent ?? '').trim().slice(0, 90),
              flowF: Array.from(document.querySelectorAll('[data-flow-row]'))
                .filter(function (e) {
                  return ['F-a', 'F-b', 'F-c', 'E4'].indexOf(e.getAttribute('data-flow-row') ?? '') >= 0;
                })
                .map(function (e) {
                  return String(e.getAttribute('data-flow-row')) + ':' + String(e.getAttribute('data-status'));
                })
                .join(','),
              dvView: document.querySelector('[data-dv-view]')?.getAttribute('data-dv-view') ?? '',
              dvClosure: document.querySelector('[data-dv-view]')?.getAttribute('data-dv-closure') ?? '',
              dvVLine: (document.querySelector('[data-dv-vline]')?.textContent ?? '').trim().slice(0, 100),
              dvVGaps: document.querySelector('[data-dv-vgaps]')?.getAttribute('data-dv-vgaps') ?? '',
              dvEntries: document.querySelectorAll('[data-dv-ventry]').length,
              dvPend: !!document.querySelector('[data-dv] [data-dv-pend]'),
              dvSection: !!document.getElementById('sec-divergence'),
              dvAbsent: (document.querySelector('.dv-absent')?.textContent ?? '').trim().slice(0, 80),
              /*
               * 这把尺子：真机这份报告一定是「当前装机版」（假模型也走 buildPrompt 落字段），
               * 所以关系该是 same、指纹该是 match、注记该查得到、三条边界该一条不少。
               *
               * 只读 DOM，不从源码反推：界面要是自己抄了一份注记、或把基线读丢了，
               * 这栏照样渲染得出来，只是内容与事实脱节——那正是要对着比的那类坏法。
               */
              phSection: !!document.getElementById('sec-prompt-history'),
              phRelation: document.querySelector('[data-ph]')?.getAttribute('data-ph') ?? '',
              phFp: document.querySelector('[data-ph]')?.getAttribute('data-ph-fp') ?? '',
              phVersion: document.querySelector('[data-ph-version]')?.getAttribute('data-ph-version') ?? '',
              phLine: (document.querySelector('[data-ph-line]')?.textContent ?? '').trim().slice(0, 130),
              phNoteState: document.querySelector('[data-ph-note-state]')?.getAttribute('data-ph-note-state') ?? '',
              phNote: (document.querySelector('[data-ph-note]')?.textContent ?? '').trim().slice(0, 90),
              phCaveats: Number(document.querySelector('[data-ph-caveats]')?.getAttribute('data-ph-caveats') ?? -1),
              phCaveatText: (document.querySelector('.ph-caveats')?.textContent ?? '').replace(/\\s+/g, ' ').slice(0, 220),
              phToggle: document.querySelector('[data-ph-toggle]')?.getAttribute('data-ph-toggle') ?? '',
              phRows: document.querySelectorAll('[data-ph-row]').length,
              phIndex: !!document.querySelector('[data-qnav="sec-prompt-history"]'),
              /*
               * 每一步那个按钮指向哪里、指过去有没有东西。
               * 「点了没反应」最像软件卡了一下，而它真正的成因是那一栏这一份报告里
               * 根本没有（反驳按模式开关、命题账与枢纽按数据）——所以要在真报告上数一遍。
               */
              flowGo: Array.from(document.querySelectorAll('[data-flow-go]')).map(function (e) {
                return (
                  String(e.getAttribute('data-flow-go')) +
                  '>' +
                  String(e.getAttribute('data-flow-to')) +
                  '>' +
                  String(e.textContent || '').trim()
                );
              }),
              flowGoDead: Array.from(document.querySelectorAll('[data-flow-go]')).filter(
                (e) => !document.getElementById(e.getAttribute('data-flow-to') ?? ''),
              ).length,
              sameCount: document.querySelector('.same-bar')?.getAttribute('data-same') ?? '',
              sameText: (document.querySelector('.same-bar .sb-v')?.textContent ?? '').slice(0, 80),
              /*
               * v1.0 内容层：整体分析与三种改法。
               *
               * 读的是真实报告上的 DOM，不是预览页：假模型这次会返回 overall/revisions，
               * 所以这里能验到「解析 → 报告 → 渲染 → 目录」整条链。
               * 只数有内容的部分：摘要有几段、只改一处有没有、改法几条、每条有没有代价。
               */
              overallSection: !!document.getElementById('sec-overall'),
              overallParas: document.querySelectorAll('[data-overall] .ov-p').length,
              overallChange: !!document.querySelector('[data-overall-change]'),
              revisionsSection: !!document.getElementById('sec-revisions'),
              revisionItems: document.querySelectorAll('[data-revisions] .rv-item').length,
              revisionCosts: document.querySelectorAll('[data-revisions] .rv-meta dd').length,
              qnavOverall: !!document.querySelector('[data-qnav="sec-overall"]'),
              qnavRevisions: !!document.querySelector('[data-qnav="sec-revisions"]'),
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
         * 全屏论证地图：开关 → 节点数 → 点结论看详情 → 缩放 → 拖拽 → 切回文字。
         *
         * 这一块最容易「看起来正常」：开关在、图也在，但点节点没详情、滚轮不动、
         * 切回文字后正文再也回不来。所以每一步都取一次 DOM，并在最后核对
         * `.block` 数量回到原值——目录注入脚本靠这个数量重扫。
         */
        if (!canceled) {
          const opened = JSON.parse(
            await wc.executeJavaScript(`JSON.stringify((() => {
              const open = document.querySelector('[data-map-open]');
              const text = document.querySelector('[data-map-text]');
              if (!open || !text) return { switch: false };
              const defaultText = text.getAttribute('aria-pressed') === 'true';
              const blocksBefore = document.querySelectorAll('.block').length;
              open.click();
              return { switch: true, defaultText, blocksBefore };
            })())`)
          ) as { switch: boolean; defaultText?: boolean; blocksBefore?: number };
          await sleep(500);
          const mapState = JSON.parse(
            await wc.executeJavaScript(`JSON.stringify((() => {
              const map = document.querySelector('[data-arg-map]');
              if (map) map.scrollIntoView({ block: 'start' });
              const svg = document.querySelector('.mp-svg');
              return {
                on: !!map,
                nodes: document.querySelectorAll('[data-map-node]').length,
                edges: document.querySelectorAll('[data-map-edge]').length,
                count: (document.querySelector('[data-map-count]')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
                edgeTitle: (document.querySelector('[data-map-edge] title')?.textContent ?? '').trim(),
                viewBox: svg?.getAttribute('viewBox') ?? '',
                overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
              };
            })())`)
          ) as {
            on: boolean;
            nodes: number;
            edges: number;
            count: string;
            edgeTitle: string;
            viewBox: string;
            overflow: boolean;
          };
          await sleep(350);
          const box = (await wc.executeJavaScript(`(() => {
            const el = document.querySelector('[data-arg-map]');
            if (!el) return null;
            const b = el.getBoundingClientRect();
            const y = Math.max(0, Math.round(b.top));
            return {
              x: Math.max(0, Math.round(b.left)),
              y,
              width: Math.round(b.width),
              height: Math.max(0, Math.min(1200, Math.round(b.height), window.innerHeight - y)),
            };
          })()`)) as { x: number; y: number; width: number; height: number } | null;

          /* 第一张拍整张图（详情未开），第二张拍点开结论之后的样子。 */
          if (box && box.width > 200 && box.height > 200) {
            const png = (await wc.capturePage(box)).toPNG();
            const p = join(dirname(shot), 'map.png');
            writeFileSync(p, png);
            add(`MAPSHOT ${p} ${png.length} bytes`);
          }

          const clicked = await wc.executeJavaScript(`(() => {
            const n = document.querySelector('[data-map-node="C"]');
            if (!n) return false;
            n.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            return true;
          })()`);
          await sleep(300);
          const detail = JSON.parse(
            await wc.executeJavaScript(`JSON.stringify({
              open: !!document.querySelector('[data-map-detail]'),
              text: (document.querySelector('[data-map-detail]')?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 120),
            })`)
          ) as { open: boolean; text: string };
          if (box && box.width > 200 && box.height > 200) {
            const png = (await wc.capturePage(box)).toPNG();
            const p = join(dirname(shot), 'map-detail.png');
            writeFileSync(p, png);
            add(`MAPDETAILSHOT ${p} ${png.length} bytes`);
          }

          /*
           * 聚焦模式：选中一个节点后，无关的节点与线默认淡下去。
           * 这里读两样：淡化标记的数量，以及点「只看相连」之后是不是全亮回来。
           * 只验按钮在不算数——按钮在而淡化为 0，等于这个功能没做。
           */
          const focusOn = JSON.parse(
            await wc.executeJavaScript(`JSON.stringify({
              btn: !!document.querySelector('[data-map-focus]'),
              dimNodes: document.querySelectorAll('[data-map-node][data-map-dim="1"]').length,
              dimEdges: document.querySelectorAll('[data-map-edge][data-map-dim="1"]').length,
            })`)
          ) as { btn: boolean; dimNodes: number; dimEdges: number };
          await wc.executeJavaScript(`document.querySelector('[data-map-focus]')?.click()`);
          await sleep(250);
          const focusOff = JSON.parse(
            await wc.executeJavaScript(`JSON.stringify({
              text: (document.querySelector('[data-map-focus]')?.textContent ?? '').trim(),
              dimNodes: document.querySelectorAll('[data-map-node][data-map-dim="1"]').length,
            })`)
          ) as { text: string; dimNodes: number };
          await wc.executeJavaScript(`document.querySelector('[data-map-focus]')?.click()`);
          await sleep(200);

          /* 点空白处：详情应该关掉。点的是 svg 本身，不是节点或线。 */
          const blankClicked = await wc.executeJavaScript(`(() => {
            const svg = document.querySelector('.mp-svg');
            if (!svg) return false;
            svg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            return true;
          })()`);
          await sleep(200);
          const detailClosed = await wc.executeJavaScript(`!document.querySelector('[data-map-detail]')`);

          const zoomBefore = await wc.executeJavaScript(`document.querySelector('.mp-svg')?.getAttribute('viewBox') ?? ''`);
          await wc.executeJavaScript(`document.querySelector('[data-map-zoom-in]')?.click()`);
          await sleep(300);
          const zoomAfter = await wc.executeJavaScript(`document.querySelector('.mp-svg')?.getAttribute('viewBox') ?? ''`);
          await wc.executeJavaScript(`document.querySelector('[data-map-zoom-fit]')?.click()`);
          await sleep(300);
          const fitBox = await wc.executeJavaScript(`document.querySelector('.mp-svg')?.getAttribute('viewBox') ?? ''`);

          await wc.executeJavaScript(`(() => {
            const svg = document.querySelector('.mp-svg');
            if (!svg) return false;
            const r = svg.getBoundingClientRect();
            const mk = (type, x, y) => new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 });
            svg.dispatchEvent(mk('pointerdown', r.left + r.width / 2, r.top + r.height / 2));
            svg.dispatchEvent(mk('pointermove', r.left + r.width / 2 + 60, r.top + r.height / 2 + 40));
            svg.dispatchEvent(mk('pointerup', r.left + r.width / 2 + 60, r.top + r.height / 2 + 40));
            return true;
          })()`);
          await sleep(300);
          const dragBox = await wc.executeJavaScript(`document.querySelector('.mp-svg')?.getAttribute('viewBox') ?? ''`);

          await wc.executeJavaScript(`document.querySelector('[data-map-text]')?.click()`);
          await sleep(700);
          const back = JSON.parse(
            await wc.executeJavaScript(`JSON.stringify({
              blocks: document.querySelectorAll('.block').length,
              map: !!document.querySelector('[data-arg-map]'),
            })`)
          ) as { blocks: number; map: boolean };

          add(
            `MAP ${JSON.stringify({
              ...opened,
              ...mapState,
              nodeClicked: clicked,
              detail,
              focus: { on: focusOn, off: focusOff },
              blankClose: { clicked: blankClicked, detailClosed },
              zoomBefore,
              zoomAfter,
              fitBox,
              dragBox,
              back,
            })}`
          );
        }


        /*
         * 报告出来之后的第一件事——把全文复制走。默认就跑，不需要开关：
         * 它不花钱、不发请求、只多等半秒，而「点了没反应」正是这个按钮最可能的坏法。
         *
         * 这条只有真应用能验：复制走的是渲染层按钮 → preload → 主进程 clipboard 这条链，
         * 纯函数断言守得住「复制的内容与导出同一份」，守不住「按钮点下去真的写进了剪贴板」。
         * 读回来的文字就是系统剪贴板里那一段，不是组件里那份 state。
         *
         * 剪贴板是系统级的：读完把它还回去，不把用户原来复制的东西弄丢。
         */
        if (!canceled) {
          const prevClip = await clipboard.readText();
          const copyClicked = await wc.executeJavaScript(`(() => {
            const b = document.querySelector('[data-copy-markdown]');
            if (!b) return false;
            b.click();
            return true;
          })()`);
          await sleep(600);
          const copied = await clipboard.readText();
          await clipboard.writeText(prevClip);
          const copyLine = await wc.executeJavaScript(
            `(document.querySelector('[data-copy-ok]')?.textContent ?? '').trim()`
          );
          add(
            `AFTERRESULT ${JSON.stringify({
              clicked: copyClicked,
              chars: copied.length,
              head: copied.slice(0, 16),
              sections: (copied.match(/\n## /g) ?? []).length,
              line: copyLine,
            })}`
          );
        }

        /*
         * 全流程账整块的截图。
         *
         * 这一块比报告里任何一栏都长（二十行），一旦某一行被挤成两行、
         * 状态符号与文字错位，单独一行 DOM 断言是看不出来的——断言只数得到节点。
         * 拍成一张，人眼一次能看完；而且它是真的从这份报告上截的，不是预览页的构造数据。
         */
        if (!canceled) {
          /* 先滚到这一节：不滚的话截到的是视口外的空白。滚完再取一次坐标。 */
          await wc.executeJavaScript(
            `(() => { document.getElementById('sec-flow')?.scrollIntoView({ block: 'start' }); return true; })()`
          );
          await sleep(400);
          const box = (await wc.executeJavaScript(`(() => {
            const el = document.getElementById('sec-flow');
            if (!el) return null;
            const b = el.getBoundingClientRect();
            const y = Math.max(0, Math.round(b.top));
            return {
              x: Math.max(0, Math.round(b.left)),
              y,
              width: Math.round(b.width),
              /* 与「这把尺子」那一栏同一条：超出视口的矩形会让 capturePage 抛
                 UnknownVizError。报告变长（v1.0 加了整体分析与改法）之后，
                 全流程账可能落到视口下沿之外，所以高度扣掉剩余空间。 */
              height: Math.max(0, Math.min(2400, Math.round(b.height), window.innerHeight - y)),
            };
          })()`)) as { x: number; y: number; width: number; height: number } | null;
          if (box && box.width > 200 && box.height > 100) {
            const png = (await wc.capturePage(box)).toPNG();
            const p = join(dirname(shot), 'flow-section.png');
            writeFileSync(p, png);
            add(`FLOWSHOT ${p} ${png.length} bytes`);
          }
        }

        /*
         * 「去填立案」：报告里那张账说 A 没做，得能一步走到输入区那张卡上。
         * 三步都要验：点得动 → 卡片展开 → 卡片在视口里。
         * 少第三步就是「点了有反应，但不知道看哪」——那种失败看起来像软件没反应。
         */
        if (!canceled) {
          const bJump = JSON.parse(
            await wc.executeJavaScript(`JSON.stringify((() => {
              const b = document.querySelector('[data-flow-go="A2"]');
              const card = document.getElementById('brief-card');
              const before = card ? card.getAttribute('data-open') || '' : '';
              if (!b) return { ok: false, before };
              b.click();
              return { ok: true, before, to: b.getAttribute('data-flow-to') || '' };
            })())`)
          );
          await sleep(700);
          const bAfter = JSON.parse(
            await wc.executeJavaScript(`JSON.stringify((() => {
              const card = document.getElementById('brief-card');
              if (!card) return { found: false };
              const r = card.getBoundingClientRect();
              return {
                found: true,
                open: card.getAttribute('data-open') || '',
                top: Math.round(r.top),
                inView: r.top >= -12 && r.top < window.innerHeight * 0.9,
              };
            })())`)
          );
          add(`BRIEFJUMP ${JSON.stringify({ jump: bJump, after: bAfter })}`);
          /* 回到报告那一栏：后面几条都在报告上取数，别让它停在半路。 */
          await wc.executeJavaScript(`(() => {
            const el = document.getElementById('sec-flow');
            if (el) el.scrollIntoView({ block: 'start' });
            return true;
          })()`);
          await sleep(320);
        }

        /*
         * 「接着读」——重开一份报告时，那句话说不说得出来。
         *
         * 这一条只有真应用能验：记录写在注入脚本里（目录不在 React 树里），
         * 而「打开时不自动跳」「点了才跳」这两件事都发生在滚动与落点上。
         * 纯函数能验的只有措辞，验不了这两件。
         *
         * 顺序刻意排成「打开 → 点一节 → 重开 → 点那句」：
         *   ① 刚打开的这份新报告不该有任何记录，也就不该有那句话；
         *   ② 点目录里的「先看判读」，记住的必须是判读那一节（不是第一节、不是别的）；
         *   ③ 重开时那句话写着第几节，且**页面没有被自动滚过去**（滚了就是软件替人决定）；
         *   ④ 点那句，真的落在那一节。
         */
        if (!canceled) {
          /* 换报告要等渲染层派发 al:report-change（App 里 180ms 防抖）——
             目录没收到那份通知就不知道「这是哪一份」，位置也就无从记起。 */
          /*
           * 先清掉这一份的位置记录，再重扫一次。
           *
           * 为什么必须清：上面几步（全流程账截图、去填立案）把视口滚到报告深处，
           * 目录按设计把这当成「读者读到了这里」并落了一条记录——那是软件该做的事，
           * 不是 bug。但这一段要验的是「没有记录时界面说不说那句话」，
           * 留着自检自己写的那条，验的就不是这件事了。
           */
          await wc.executeJavaScript(`(() => {
            if (window.__alNavForget) window.__alNavForget();
            if (window.__alNavRescan) window.__alNavRescan();
            return true;
          })()`);
          await sleep(400);
          const rBefore = JSON.parse(
            await wc.executeJavaScript(`JSON.stringify((() => {
              const b = document.querySelector('#__alNav .nresume');
              const j = document.querySelector('#__alNav .njump');
              let all = {};
              try { all = JSON.parse(localStorage.getItem('alPos.v1') || '{}'); } catch (e) { /* @allow-silent: 探针读本机记录，读坏了按「没有记录」处理，只看界面说不说那句话 */ }
              return {
                shown: !!b && getComputedStyle(b).display !== 'none',
                marks: Object.keys(all).length,
                /* 「简洁态多出一条记录」这类红，光看条数判不出是谁写的：
                   把每条的节号与标题一起带出来，才看得出是这一份的哪一节。 */
                markList: Object.keys(all).map((k) => ({
                  id: String(k).slice(0, 10),
                  i: all[k] ? all[k].i : -1,
                  title: all[k] ? String(all[k].title || '').slice(0, 12) : '',
                })),
                /* 谁写的那条记录：当前高亮节、滚动位置、报告 id 各是多少。 */
                nav: window.__alNavDebug ? window.__alNavDebug() : null,
                jumpLabel: (j ? j.textContent : '') || '',
              };
            })())`)
          );
          const rClicked = await wc.executeJavaScript(`(() => {
            const b = document.querySelector('#__alNav .njump');
            if (!b) return false;
            b.click();
            return true;
          })()`);
          /*
           * 等记录落盘，不写死时长。
           *
           * 记录是 350ms 防抖后写的，而平滑滚动期间每跨过一节内的一块就重新计时一次：
           * 从附录底部（一万八千像素）点「先看判读」跳到第五节，实测滚动约 1 秒，
           * 加上 350ms 防抖，落盘落在点击后约 1.4 秒——写死 1500ms 正好卡在边界上，
           * 同一份代码两次跑，一次读到记录、一次读到空。改成轮询到写出来为止。
           */
          let rRec = null;
          for (let i = 0; i < 40; i += 1) {
            rRec = JSON.parse(
              await wc.executeJavaScript(`JSON.stringify((() => {
              let all = {};
              try { all = JSON.parse(localStorage.getItem('alPos.v1') || '{}'); } catch (e) { /* @allow-silent: 探针读本机记录，读坏了按「没有记录」处理，只看界面说不说那句话 */ }
              const ks = Object.keys(all);
              const v = ks.length ? all[ks[0]] : null;
              return {
                count: ks.length,
                id: ks.length ? ks[0] : '',
                index: v ? v.i : -1,
                title: v ? String(v.title || '') : '',
                sections: document.querySelectorAll('#__alNav .nlist .ni').length,
              };
            })())`)
            );
            if (Number(rRec.count) > 0) break;
            await sleep(120);
          }
          const rScrollBefore = await wc.executeJavaScript(
            `(() => { const m = document.querySelector('.main'); return m ? Math.round(m.scrollTop) : -1; })()`
          );
          await wc.executeJavaScript(`window.__alNavRescan && window.__alNavRescan()`);
          await sleep(260);
          const rResume = JSON.parse(
            await wc.executeJavaScript(`JSON.stringify((() => {
              const b = document.querySelector('#__alNav .nresume');
              const m = document.querySelector('.main');
              const vis = !!b && getComputedStyle(b).display !== 'none';
              return {
                vis,
                at: b && vis ? b.getAttribute('data-resume') || '' : '',
                text: b && vis ? (b.textContent || '').replace(/\\s+/g, ' ').trim() : '',
                scrollAfter: m ? Math.round(m.scrollTop) : -1,
              };
            })())`)
          );
          /*
           * 存一张目录面板的图。这句话只有两行，缩到整页尺寸看不见；
           * 而它坏起来的样子（挤成三行、按钮被压成一条）不会让任何断言变红。
           */
          const navRect = await wc.executeJavaScript(`(() => {
            const el = document.querySelector('#__alNav');
            if (!el) return null;
            const b = el.getBoundingClientRect();
            const x = Math.max(0, Math.round(b.left) - 6);
            const y = Math.max(0, Math.round(b.top) - 6);
            /*
             * 目录会随报告里真实有哪几栏变长（v1.0 加了「整体分析」「三种改法」两格）。
             * capturePage 拿到超出视口的矩形会抛 UnknownVizError，整趟自检断在这里，
             * 后面几十条断言一起假红到「应用没启动」。所以高度扣掉视口剩余空间：
             * 截到的是看得见的部分，不是一张不存在的整图。
             */
            return {
              x,
              y,
              width: Math.round(b.width) + 12,
              height: Math.max(0, Math.min(Math.round(b.height) + 12, window.innerHeight - y)),
            };
          })()`);
          if (navRect) {
            const navPng = (await wc.capturePage(navRect)).toPNG();
            const navShot = join(dirname(shot), 'nav-resume.png');
            writeFileSync(navShot, navPng);
            add(`NAVSHOT ${navShot} ${navPng.length} bytes`);
          }
          const rTap = await wc.executeJavaScript(`(() => {
            const b = document.querySelector('#__alNav .nresume');
            if (!b || getComputedStyle(b).display === 'none') return false;
            b.click();
            return true;
          })()`);
          /* 落点等动画结束，不写死时长：报告越长，平滑滚动越久。 */
          const landExpr = `JSON.stringify((() => {
            const hs = [].slice.call(document.querySelectorAll('.main .block-head'));
            const n = Number(${JSON.stringify(rResume.at || '0')});
            const h = hs[n - 1];
            if (!h) return { found: false, n };
            const r = h.getBoundingClientRect();
            return { found: true, n, top: Math.round(r.top), inView: r.top >= -8 && r.top < window.innerHeight * 0.6 };
          })())`;
          let rLanded = JSON.parse(await wc.executeJavaScript(landExpr));
          for (let i = 0; i < 20; i += 1) {
            if (rLanded.inView) break;
            await sleep(150);
            rLanded = JSON.parse(await wc.executeJavaScript(landExpr));
          }
          add(
            `RESUMERESULT ${JSON.stringify({
              before: rBefore,
              clicked: rClicked,
              rec: rRec,
              scrollBefore: rScrollBefore,
              resume: rResume,
              tapped: rTap,
              landed: rLanded,
            })}`
          );

          /*
           * 节内那一段：把「判读」这一节中间的一块顶到视口顶线，等防抖落盘，再重开一次。
           *
           * 上面那一条只验到节。这一条验的是「读到节里哪一段」——它多出来的风险在
           * 「记下来的到底是不是屏幕上那一块」：序号在 DOM 里，读数在滚动里，
           * 纯函数验得了「比不比字」，验不了这两个数是不是同一块。所以顺序是
           * 滚 → 等 350ms 落盘 → 读回记录 → 重开 → 那句话 → 点它 → 落点。
           * 第四步是关键：读回的 seg 必须与当初那一块的开头逐字相同，
           * 否则「记的是别人的第三段」这条断言看不出来。
           */
          if (!canceled) {
            /*
             * 等「点了接着读」那个窗口过去，再滚。
             *
             * 点目录/接着读之后的 1500ms 里，目录把「滚到哪」记成「点的哪一节、哪一段」——
             * 那是为了不让平滑滚动途中的中间站覆盖掉点击结果。这一条要验的却是
             * 「人自己滚到某一节中间时记下的是不是那一块」，落在窗口里就会记成
             * 上一步点的那一段（实测记录成第 1 段，而屏幕上停在第 5 段）。
             * 窗口是写死的 1500ms（见 focusSection），所以这里等它过去。
             */
            await sleep(1600);
            const segPrep = JSON.parse(
              await wc.executeJavaScript(`JSON.stringify((() => {
                const hs = [].slice.call(document.querySelectorAll('.main .block-head'));
                let idx = -1;
                for (let i = 0; i < hs.length; i += 1) {
                  if (/^\\s*判读/.test(hs[i].textContent || '')) { idx = i; break; }
                }
                if (idx < 0) return { ok: false, why: 'no-section' };
                const sec = hs[idx].closest('.block');
                const body = sec ? sec.querySelector('.block-body') : null;
                const kids = body ? [].slice.call(body.children) : [];
                if (kids.length < 2) return { ok: false, why: 'one-block', kids: kids.length };
                /*
                 * 挑最高的一块，不是中间那一块。
                 *
                 * 「顶线」（容器顶往下 72px）要落在这一块**里面**，才谈得上「记的是哪一段」。
                 * 判读这一节里有一块只有一行高（一条提示），把顶线放在它上面 32px 处，
                 * 顶线已经越过它、压进下一块了——探针就会去比错对象，红得莫名其妙。
                 * 取最高的一块，这个前提就与排版无关了。
                 */
                let mid = 0, best = -1;
                for (let i = 0; i < kids.length; i += 1) {
                  const h = kids[i].getBoundingClientRect().height;
                  if (h > best) { best = h; mid = i; }
                }
                const box = document.querySelector('.main');
                const top = kids[mid].getBoundingClientRect().top
                  - box.getBoundingClientRect().top + box.scrollTop - 40;
                box.scrollTop = Math.max(0, top);
                return {
                  ok: true, kids: kids.length, mid,
                  want: (kids[mid].textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 24),
                };
              })())`)
            );
            /* 350ms 防抖 + 余量：这一条验的就是「停稳之后记下的那一刻」，等短了会读到上一块。 */
            await sleep(700);
            const segRec = JSON.parse(
              await wc.executeJavaScript(`JSON.stringify((() => {
                let all = {};
                try { all = JSON.parse(localStorage.getItem('alPos.v1') || '{}'); } catch (e) { /* @allow-silent: 探针读本机记录，读坏了按「没有记录」处理，只看界面说不说那句话 */ }
                const ks = Object.keys(all);
                const v = ks.length ? all[ks[0]] : null;
                return {
                  count: ks.length,
                  i: v ? v.i : -1,
                  seg: v && v.seg ? { k: v.seg.k, x: String(v.seg.x || '') } : null,
                };
              })())`)
            );
            await wc.executeJavaScript(`window.__alNavRescan && window.__alNavRescan()`);
            await sleep(260);
            const segLine = JSON.parse(
              await wc.executeJavaScript(`JSON.stringify((() => {
                const b = document.querySelector('#__alNav .nresume');
                const vis = !!b && getComputedStyle(b).display !== 'none';
                return {
                  vis,
                  at: b && vis ? b.getAttribute('data-resume') || '' : '',
                  seg: b && vis ? b.getAttribute('data-seg') || '' : '',
                  text: b && vis ? (b.textContent || '').replace(/\\s+/g, ' ').trim() : '',
                };
              })())`)
            );
            /*
             * 存一张两行版的图。这一句比上一版长一倍（还带一段引文），面板只有 250px 宽：
             * 撑到四五行、把下面的按钮压走，都不会让任何断言变红——只有看图才知道。
             */
            const segRect = await wc.executeJavaScript(`(() => {
              const el = document.querySelector('#__alNav');
              if (!el) return null;
              const b = el.getBoundingClientRect();
              const y = Math.max(0, Math.round(b.top) - 6);
              return {
                x: Math.max(0, Math.round(b.left) - 6),
                y,
                width: Math.round(b.width) + 12,
                height: Math.max(0, Math.min(Math.round(b.height) + 12, window.innerHeight - y)),
              };
            })()`);
            if (segRect) {
              const segPng = (await wc.capturePage(segRect)).toPNG();
              const segShot = join(dirname(shot), 'nav-seg.png');
              writeFileSync(segShot, segPng);
              add(`SEGSHOT ${segShot} ${segPng.length} bytes`);
            }
            const segTap = await wc.executeJavaScript(`(() => {
              const b = document.querySelector('#__alNav .nresume');
              if (!b || getComputedStyle(b).display === 'none') return false;
              b.click();
              return true;
            })()`);            const segLandExpr = `JSON.stringify((() => {
              const hs = [].slice.call(document.querySelectorAll('.main .block-head'));
              const n = ${JSON.stringify(segRec.i + 1)};
              const k = ${JSON.stringify(segRec.seg ? segRec.seg.k : -1)};
              const h = hs[n - 1];
              const sec = h && h.closest('.block');
              const body = sec ? sec.querySelector('.block-body') : null;
              const kids = body ? [].slice.call(body.children) : [];
              const el = kids[k];
              if (!el) return { found: false, n, k };
              const r = el.getBoundingClientRect();
              return {
                found: true, n, k, top: Math.round(r.top),
                inView: r.top >= -12 && r.top < window.innerHeight * 0.6,
              };
            })())`;
            let segLanded = JSON.parse(await wc.executeJavaScript(segLandExpr));
            for (let i = 0; i < 20; i += 1) {
              if (segLanded.inView) break;
              await sleep(150);
              segLanded = JSON.parse(await wc.executeJavaScript(segLandExpr));
            }
            add(
              `SEGRESULT ${JSON.stringify({
                prep: segPrep,
                rec: segRec,
                line: segLine,
                tapped: segTap,
                landed: segLanded,
              })}`
            );
          }
        }

        /*
         * 异议账：记一条 → 账出现 → 逐条展开 → 撤销 → 整块消失。
         *
         * 这条账只在「这份报告里已经有过异议」时才出现，所以现场记一条是唯一能让它
         * 在真应用里出现的方式——预览页能拍到版式，拍不到「点了真的记上、记上真的回到
         * 那一节」。四步互相卡着：不记就没有账、账不出现说明上下文没接上、
         * 撤销之后还留着一个 0 条的壳，就等于把「没有异议」写成了一条空记录。
         */
        if (!canceled) {
          const dgBefore = await wc.executeJavaScript(`!!document.querySelector('[data-obj-digest]')`);
          const objClicked = await wc.executeJavaScript(`(() => {
            const b = document.querySelector('.obj-btn');
            if (!b) return false;
            b.click();
            return true;
          })()`);
          await sleep(220);
          const objTyped = await wc.executeJavaScript(`(() => {
            const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
            const ta = document.querySelector('.obj-form textarea');
            if (!set || !ta) return false;
            set.call(ta, '这一条的依据只举了一个学校的例子，不足以支撑整句');
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          })()`);
          await sleep(140);
          const objSaved = await wc.executeJavaScript(`(() => {
            const b = document.querySelector('.obj-save');
            if (!b) return false;
            b.click();
            return true;
          })()`);
          await sleep(500);
          const dgAfter = JSON.parse(
            await wc.executeJavaScript(`JSON.stringify({
              present: !!document.querySelector('[data-obj-digest]'),
              total: Number(document.querySelector('[data-obj-digest]')?.getAttribute('data-obj-digest') ?? -1),
            })`)
          );
          const dgOpened = await wc.executeJavaScript(`(() => {
            const b = document.querySelector('[data-obj-digest-toggle]');
            if (!b) return false;
            b.click();
            return true;
          })()`);
          await sleep(280);
          const dgOpen = JSON.parse(
            await wc.executeJavaScript(`JSON.stringify({
              items: document.querySelectorAll('[data-obj-digest-item]').length,
              jumps: document.querySelectorAll('[data-obj-jump]').length,
              text: (document.querySelector('[data-obj-digest-item]')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
            })`)
          );
          const dgJump = JSON.parse(
            await wc.executeJavaScript(`(() => {
              const b = document.querySelector('[data-obj-jump]');
              if (!b) return JSON.stringify({ clicked: false });
              const id = b.getAttribute('data-obj-jump') || '';
              b.click();
              return JSON.stringify({ clicked: true, id });
            })()`)
          );
          /*
           * 等它落位，而不是等一个固定时长。
           *
           * 原来是 `sleep(1100)` 一把梭：滚动的 behavior 是 smooth，页面越长落位越慢。
           * 报告里加了「枢纽前提」那一栏之后页面又长了一截，这条断言第一次真红在
           * 「还在滚」上——固定等待这种东西，页面的高度一变就变成偶发红，
           * 而偶发红最后一定会被人当噪声忽略掉。改成每 150ms 看一次、最多 3 秒：
           * 等的是动画结束，不是放宽标准（判定条件一个字没动）。
           */
          const measureJump = `(() => {
              const id = ${JSON.stringify(String(dgJump.id ?? ''))};
              const el = id ? document.getElementById(id) : null;
              if (!el) return JSON.stringify({ found: false, id });
              const r = el.getBoundingClientRect();
              return JSON.stringify({
                found: true,
                id,
                top: Math.round(r.top),
                inView: r.top >= -8 && r.top < window.innerHeight * 0.6,
                folded: el.getAttribute('data-al-fold') === '1',
              });
            })()`;
          let dgLanded = JSON.parse(await wc.executeJavaScript(measureJump));
          for (let i = 0; i < 20; i++) {
            if (dgLanded.inView && !dgLanded.folded) break;
            await sleep(150);
            dgLanded = JSON.parse(await wc.executeJavaScript(measureJump));
          }
          const dgUndone = await wc.executeJavaScript(`(() => {
            const b = document.querySelector('.odg-undo');
            if (!b) return false;
            b.click();
            return true;
          })()`);
          await sleep(500);
          const dgStillThere = await wc.executeJavaScript(`!!document.querySelector('[data-obj-digest]')`);
          add(
            `DIGESTRESULT ${JSON.stringify({
              before: dgBefore,
              clicked: objClicked,
              typed: objTyped,
              saved: objSaved,
              after: dgAfter,
              opened: dgOpened,
              open: dgOpen,
              jump: dgJump,
              landed: dgLanded,
              undone: dgUndone,
              stillThere: dgStillThere,
            })}`
          );
        }

        /*
         * 「跑过 N 次」那一行的样子。
         *
         * 和候选条同一个理由：整页两万像素高，一行提示缩到全页尺寸占不到一个像素。
         * 这里连 `.composer` 都不够——它有一千多像素高，那一行是里面最窄的一条。
         * 所以按 `.same-bar` 自己的矩形裁，四周各留 10px，看它有没有溢出、有没有被压成两行。
         */
        /*
         * 裁切矩形必须落在**视口内**。输入区的分歧卡展开时，composer 被撑高，
         * `.same-bar` 会被推到一千多像素下方；Electron 的 capturePage 拿到
         * 视口外的 rect 会抛 UnknownVizError，整趟自检就断在这里，后面几十条
         * 断言一起红在「应用没启动」这种完全不相干的地方。
         * 先把那一行滚进视口截，截完把滚动还回去——不是放宽标准，是让截图站对地方。
         */
        const sameScroll = (await wc.executeJavaScript(`(() => {
          const el = document.querySelector('.same-bar');
          if (!el) return null;
          const before = Math.round(window.scrollY);
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          return { before };
        })()`)) as { before: number } | null;
        await sleep(220);
        const sameRect = await wc.executeJavaScript(`(() => {
          const el = document.querySelector('.same-bar');
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return {
            x: Math.max(0, Math.round(b.left) - 10),
            y: Math.max(0, Math.round(b.top) - 10),
            width: Math.min(Math.round(b.width) + 20, 1200),
            height: Math.round(b.height) + 20,
            vh: window.innerHeight,
          };
        })()`);
        add(`SAMERECT ${JSON.stringify(sameRect)}`);
        const samePng = (await wc.capturePage(sameRect ?? undefined)).toPNG();
        if (sameScroll) {
          await wc.executeJavaScript(`(() => {
            window.scrollTo({ top: ${sameScroll.before}, behavior: 'instant' });
            return true;
          })()`);
          await sleep(150);
        }
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
           * AL_RESCALE=1：真应用里点开「换个尺度读」，并且**由探针往输入框里填词**。
           *
           * 这里刻意不用预填数据：这一屏的全部意义是「用户发起的一次操作」，
           * 若靠初始词对截图，验到的只是渲染，验不到「填了词 → 本地重算」。
           * 纯函数层已经验过可逆与逐字还原，DOM 层只问四件它答不了的事：
           * 点得开、报告让位、填词后两栏真的变了、原文那一栏仍是提交时的原文。
           */
          if (process.env['AL_RESCALE'] === '1' && !canceled) {
            const rsBefore = await wc.executeJavaScript(`JSON.stringify({
              entry: !!document.querySelector('[data-rescale-open]'),
              blocksBefore: document.querySelectorAll('.block').length,
            })`);
            const rsOpened = await wc.executeJavaScript(`(() => {
              const b = document.querySelector('[data-rescale-open]');
              if (!b) return false;
              b.click();
              return true;
            })()`);
            await sleep(320);
            await wc.executeJavaScript(`(() => { window.scrollTo(0, 0); return true; })()`);

            /* 填词之前：不该有「换过」那一栏。拿空屏截图冒充填过是最容易混过去的一处。 */
            const rsEmpty = await wc.executeJavaScript(`JSON.stringify({
              screen: !!document.querySelector('[data-rescale]'),
              changed: [...document.querySelectorAll('[data-rescale-changed]')].map((e) => e.textContent ?? '').join(''),
              stat: (document.querySelector('[data-rescale-stat]')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
            })`);

            const rsFilled = await wc.executeJavaScript(`(() => {
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
              const froms = [...document.querySelectorAll('[data-rescale-from]')];
              const tos = [...document.querySelectorAll('[data-rescale-to]')];
              const vals = [['早读', '午休'], ['一本率', '及格率']];
              if (froms.length < 2 || tos.length < 2 || !setter) return false;
              for (let i = 0; i < 2; i++) {
                setter.call(froms[i], vals[i][0]);
                froms[i].dispatchEvent(new Event('input', { bubbles: true }));
                setter.call(tos[i], vals[i][1]);
                tos[i].dispatchEvent(new Event('input', { bubbles: true }));
              }
              return true;
            })()`);
            await sleep(360);

            const rsState = await wc.executeJavaScript(`JSON.stringify({
              screen: !!document.querySelector('[data-rescale]'),
              blocks: document.querySelectorAll('.block').length,
              sentences: document.querySelectorAll('[data-rescale-sentence]').length,
              original: [...document.querySelectorAll('[data-rescale-original]')].map((e) => e.textContent ?? '').join(''),
              changed: [...document.querySelectorAll('[data-rescale-changed]')].map((e) => e.textContent ?? '').join(''),
              passage: document.querySelector('textarea')?.value ?? '',
              stat: (document.querySelector('[data-rescale-stat]')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
              refs: document.querySelectorAll('[data-rescale-ref]').length,
              conflicts: document.querySelectorAll('[data-rescale-conflicts]').length,
              inputs: document.querySelectorAll('[data-rescale-from]').length,
            })`);
            const rs = JSON.parse(rsState);
            add(`RESCALEEMPTY ${rsEmpty}`);
            add(`RESCALERESULT ${JSON.stringify({ ...rs, ...JSON.parse(rsBefore), opened: rsOpened, filled: rsFilled })}`);

            const rsRect = await wc.executeJavaScript(`(() => {
              const el = document.querySelector('[data-rescale]');
              if (!el) return null;
              const b = el.getBoundingClientRect();
              return {
                x: Math.max(0, Math.round(b.left)),
                y: Math.max(0, Math.round(b.top)),
                width: Math.min(Math.round(b.width), 1200),
                height: Math.min(Math.round(b.height), 1100),
              };
            })()`);
            const rsPng = (await wc.capturePage(rsRect ?? undefined)).toPNG();
            const rsShot = join(dirname(shot), 'rescale.png');
            writeFileSync(rsShot, rsPng);
            add(`RESCALESHOT ${rsShot} ${rsPng.length} bytes rect=${rsRect ? `${rsRect.width}x${rsRect.height}` : 'missing'}`);
            add(`RESCALERECT ${rsRect ? `${rsRect.width}x${rsRect.height}` : 'missing'}`);

            await wc.executeJavaScript(`(() => { document.querySelector('[data-rescale-back]')?.click(); return true; })()`);
            await sleep(280);
            const rsBack = await wc.executeJavaScript(`JSON.stringify({
              screen: !!document.querySelector('[data-rescale]'),
              blocks: document.querySelectorAll('.block').length,
            })`);
            add(`RESCALEBACK ${rsBack}`);
          }

          /*
           * AL_CONDITIONS=1：真应用里点开「自己列成立条件」，并且由探针自己写条件、
           * 自己点三态、自己把条件挂到原文某一句。
           *
           * 这一屏验的东西和前两屏不同：不是「渲染出来了」，而是「填进去的字本地真的
           * 被重算进对位与导出文本」。静态检查只能验纯函数，验不到 textarea / select
           * 的事件有没有接到 React 上——那正是最容易「看着有、其实不动」的地方。
           *
           * 另外验一条只有这一屏才有的：**主区不出现报告里的任何一句话**。
           * 报告板块 .block 全让位还不够，条目文字也可能被顺手带进来。
           */
          if (process.env['AL_CONDITIONS'] === '1' && !canceled) {
            const cBefore = await wc.executeJavaScript(`JSON.stringify({
              entry: !!document.querySelector('[data-conditions-open]'),
              blocksBefore: document.querySelectorAll('.block').length,
            })`);
            const cOpened = await wc.executeJavaScript(`(() => {
              const b = document.querySelector('[data-conditions-open]');
              if (!b) return false;
              b.click();
              return true;
            })()`);
            await sleep(320);
            await wc.executeJavaScript(`(() => { window.scrollTo(0, 0); return true; })()`);

            /* 填之前：三行空条件，一条引文都不该有，导出文本里也不该有用户还没写的字。 */
            const cEmpty = await wc.executeJavaScript(`JSON.stringify({
              screen: !!document.querySelector('[data-conditions]'),
              items: document.querySelectorAll('[data-conditions-item]').length,
              quotes: document.querySelectorAll('[data-conditions-quote]').length,
              stat: (document.querySelector('[data-conditions-stat]')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
              take: document.querySelector('[data-conditions-take]')?.value ?? '',
              passage: [...document.querySelectorAll('[data-conditions-sentence] .rr-text')].map((e) => e.textContent ?? '').join(''),
              unasked: document.querySelectorAll('[data-conditions-unasked]').length,
            })`);

            /* textarea 用原型 setter 绕开 React 的 value tracker，与换尺度那屏同一套做法。
               select 同时派发 input 与 change：不同 React 版本对哪一个生效不一样，两个都发。 */
            const cFilled = await wc.executeJavaScript(`(() => {
              const ta = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
              const sl = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
              const areas = [...document.querySelectorAll('[data-conditions-textarea]')];
              const picks = [...document.querySelectorAll('[data-conditions-pick]')];
              if (areas.length < 2 || picks.length < 2 || !ta || !sl) return false;
              ta.call(areas[0], '得先排除别的原因吗');
              areas[0].dispatchEvent(new Event('input', { bubbles: true }));
              ta.call(areas[1], '两年数据够不够');
              areas[1].dispatchEvent(new Event('input', { bubbles: true }));
              sl.call(picks[0], '0');
              picks[0].dispatchEvent(new Event('input', { bubbles: true }));
              picks[0].dispatchEvent(new Event('change', { bubbles: true }));
              const marks = [...document.querySelectorAll('[data-conditions-item]')][0]
                ?.querySelectorAll('[data-conditions-mark]') ?? [];
              marks[1]?.click();
              return true;
            })()`);
            await sleep(380);

            const cState = await wc.executeJavaScript(`JSON.stringify({
              screen: !!document.querySelector('[data-conditions]'),
              blocks: document.querySelectorAll('.block').length,
              items: document.querySelectorAll('[data-conditions-item]').length,
              quotes: document.querySelectorAll('[data-conditions-quote]').length,
              quote: (document.querySelector('[data-conditions-quote] .cl-quote-text')?.textContent ?? ''),
              sentences: document.querySelectorAll('[data-conditions-sentence]').length,
              passage: [...document.querySelectorAll('[data-conditions-sentence] .rr-text')].map((e) => e.textContent ?? '').join(''),
              submitted: document.querySelector('textarea')?.value ?? '',
              stat: (document.querySelector('[data-conditions-stat]')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
              unasked: document.querySelectorAll('[data-conditions-unasked]').length,
              unaskedList: (document.querySelector('[data-conditions-unasked-list]')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
              take: document.querySelector('[data-conditions-take]')?.value ?? '',
              marked: document.querySelectorAll('.cl-mark-on').length,
              /* 每行默认亮「还没想好」，数高亮个数验不出「点得动」；要看亮的是哪一个。 */
              markOns: [...document.querySelectorAll('.cl-mark-on')].map((e) => e.getAttribute('data-conditions-mark')),
              /* 这一屏不渲染报告里的条目：报告板块让位之外，也不许把条目卡顺手带进来。 */
              refs: document.querySelectorAll('[data-conditions] .rr-ref').length,
              /* 三态按钮不许折行：nowrap 失效时高度会明显超过一行。 */
              markHeights: [...document.querySelectorAll('[data-conditions-mark]')].map((e) => Math.round(e.getBoundingClientRect().height)),
            })`);
            const c = JSON.parse(cState);
            add(`CONDITIONSEMPTY ${cEmpty}`);
            add(`CONDITIONSRESULT ${JSON.stringify({ ...c, ...JSON.parse(cBefore), opened: cOpened, filled: cFilled })}`);

            const cRect = await wc.executeJavaScript(`(() => {
              const el = document.querySelector('[data-conditions]');
              if (!el) return null;
              const b = el.getBoundingClientRect();
              return {
                x: Math.max(0, Math.round(b.left)),
                y: Math.max(0, Math.round(b.top)),
                width: Math.min(Math.round(b.width), 1200),
                height: Math.min(Math.round(b.height), 1100),
              };
            })()`);
            const cPng = (await wc.capturePage(cRect ?? undefined)).toPNG();
            const cShot = join(dirname(shot), 'conditions-e2e.png');
            writeFileSync(cShot, cPng);
            add(`CONDITIONSSHOT ${cShot} ${cPng.length} bytes rect=${cRect ? `${cRect.width}x${cRect.height}` : 'missing'}`);
            add(`CONDITIONSRECT ${cRect ? `${cRect.width}x${cRect.height}` : 'missing'}`);

            await wc.executeJavaScript(`(() => { document.querySelector('[data-conditions-back]')?.click(); return true; })()`);
            await sleep(280);
            const cBack = await wc.executeJavaScript(`JSON.stringify({
              screen: !!document.querySelector('[data-conditions]'),
              blocks: document.querySelectorAll('.block').length,
            })`);
            add(`CONDITIONSBACK ${cBack}`);
          }

          /*
           * AL_PORTFOLIO=1：真应用里点开样本账，核数目与可复制的纯文本。
           *
           * 这一栏最容易「看着对」：把数字写死在组件里，界面照样是一句完整的话。
           * 所以这里取一个独立真值——archive:list 是另一条 IPC、读的是索引，
           * 而样本账走 passageScan 扫文件；两者对不上就说明数目不是从存档来的。
           *
           * 点之前先记下「明细确实收起」，否则「点开后明细出现」是一条恒真断言。
           */
          if (process.env['AL_PORTFOLIO'] === '1' && !canceled) {
            const pBefore = await wc.executeJavaScript(`JSON.stringify({
              bar: !!document.querySelector('[data-portfolio-bar]'),
              detailBefore: !!document.querySelector('[data-portfolio-detail]'),
              labelBefore: (document.querySelector('[data-portfolio-open]')?.textContent ?? '').trim(),
            })`);
            const pOpened = await wc.executeJavaScript(`(() => {
              const b = document.querySelector('[data-portfolio-open]');
              if (!b) return false;
              b.click();
              return true;
            })()`);
            await sleep(300);
            const pListLen = await wc.executeJavaScript(`window.api.archive.list().then((a) => a.length)`);
            const pState = await wc.executeJavaScript(`JSON.stringify({
              bar: !!document.querySelector('[data-portfolio-bar]'),
              detail: !!document.querySelector('[data-portfolio-detail]'),
              line: (document.querySelector('[data-portfolio-line]')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
              groupsAttr: document.querySelector('[data-portfolio-bar]')?.getAttribute('data-portfolio-groups') ?? '',
              rows: [...document.querySelectorAll('[data-portfolio-group]')].map((e) => (e.textContent ?? '').replace(/\\s+/g, ' ').trim()),
              text: document.querySelector('[data-portfolio-text]')?.value ?? '',
              labelAfter: (document.querySelector('[data-portfolio-open]')?.textContent ?? '').trim(),
              error: (document.querySelector('[data-portfolio-error]')?.textContent ?? '').trim(),
              lineHeight: Math.round(document.querySelector('[data-portfolio-line]')?.getBoundingClientRect().height ?? 0),
            })`);
            add(`PORTFOLIORESULT ${JSON.stringify({ ...JSON.parse(pState), ...JSON.parse(pBefore), opened: pOpened, listLen: pListLen })}`);
          }

          /*
           * AL_NEXTLINE=1：真应用里在报告末尾写一句、记下、再记一遍、删掉。
           *
           * 这一条要验的都不是「渲染出来了」：
           *   1. 写进去的字**逐字**存回去（trim 之外一个字符都不许变）——截断、规范化都会在这里露出来；
           *   2. 同一句记两遍，账上出现「逐字相同」与「2 次」——说明数的真是逐字，不是近似；
           *   3. 删得掉，删完数目回到原处——「随时可删」这句话得能兑现；
           *   4. 这一块长在报告**下面**（比最后一个报告板块更靠下）。挪到开头就等于
           *      在人还没读的时候先要一句评价，那一条数据就废了。
           *
           * 打字与点按钮必须分成两步、中间 sleep：React 的 onChange 是同步派发的，
           * 但重渲染不是——同一个 tick 里填完就点，「记下」读到的还是空字符串。
           */
          if (process.env['AL_NEXTLINE'] === '1' && !canceled) {
            const NL_TEXT = '这句话我确实想再问一句：那第二个数据是怎么来的';

            const nlBefore = JSON.parse(
              await wc.executeJavaScript(`JSON.stringify({
                bar: !!document.querySelector('[data-nextline]'),
                input: !!document.querySelector('[data-nextline-input]'),
                listBefore: !!document.querySelector('[data-nextline-list]'),
                total: Number(document.querySelector('[data-nextline-total]')?.getAttribute('data-nextline-total') ?? -1),
                lineBefore: (document.querySelector('[data-nextline-line]')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
                /* 这一块必须在报告最后一个板块之下，不是之上。 */
                belowReport: (() => {
                  const el = document.querySelector('[data-nextline]');
                  const blocks = document.querySelectorAll('.block');
                  const last = blocks[blocks.length - 1];
                  if (!el || !last) return false;
                  return el.getBoundingClientRect().top >= last.getBoundingClientRect().top;
                })(),
              })`)
            );

            const nlType = async (t: string): Promise<boolean> =>
              wc.executeJavaScript(`(() => {
                const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
                const ta = document.querySelector('[data-nextline-input]');
                if (!set || !ta) return false;
                set.call(ta, ${JSON.stringify(t)});
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
              })()`);
            const nlSave = async (): Promise<boolean> =>
              wc.executeJavaScript(`(() => {
                const b = document.querySelector('[data-nextline-save]');
                if (!b) return false;
                b.click();
                return true;
              })()`);
            const nlRead = async (): Promise<Record<string, unknown>> =>
              JSON.parse(
                await wc.executeJavaScript(`JSON.stringify({
                  total: Number(document.querySelector('[data-nextline-total]')?.getAttribute('data-nextline-total') ?? -1),
                  line: (document.querySelector('[data-nextline-line]')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
                  input: document.querySelector('[data-nextline-input]')?.value ?? '',
                  ok: (document.querySelector('[data-nextline-ok]')?.textContent ?? '').trim(),
                  error: (document.querySelector('[data-nextline-error]')?.textContent ?? '').trim(),
                })`)
              );
            const nlDelOne = async (): Promise<boolean> => {
              const a = await wc.executeJavaScript(`(() => {
                const b = document.querySelector('[data-nextline-del]');
                if (!b) return false;
                b.click();
                return true;
              })()`);
              await sleep(140);
              const b = await wc.executeJavaScript(`(() => {
                const b = document.querySelector('[data-nextline-del-yes]');
                if (!b) return false;
                b.click();
                return true;
              })()`);
              await sleep(340);
              return a && b;
            };

            const t1 = await nlType(NL_TEXT);
            await sleep(160);
            const s1Click = await nlSave();
            await sleep(420);
            const s1 = await nlRead();

            /* 第二遍故意写同一句：账上应当出现「逐字相同」与「2 次」。 */
            const t2 = await nlType(NL_TEXT);
            await sleep(160);
            const s2Click = await nlSave();
            await sleep(420);
            const s2 = await nlRead();

            /*
             * 独立真值：再读一次盘（走的是 list 的读路径，不是写的时候顺手返回的那份）。
             * 少了这一条，「界面上的数目变了」与「真的写进文件了」就分不开——
             * 一个只往内存里加、根本没落盘的实现，前面每一条都会绿。
             */
            const nlDisk = await wc.executeJavaScript(`window.api.nextlines.list().then((v) => v.usable)`);

            const nlOpened = await wc.executeJavaScript(`(() => {
              const b = document.querySelector('[data-nextline-open]');
              if (!b) return false;
              b.click();
              return true;
            })()`);
            await sleep(300);
            const nlDetail = JSON.parse(
              await wc.executeJavaScript(`JSON.stringify({
                detail: !!document.querySelector('[data-nextline-detail]'),
                items: document.querySelectorAll('[data-nextline-item]').length,
                said: [...document.querySelectorAll('[data-nextline-said]')].map((e) => e.textContent ?? ''),
                text: document.querySelector('[data-nextline-text]')?.value ?? '',
              })`)
            );

            const d1 = await nlDelOne();
            const afterDel1 = await nlRead();
            const d2 = await nlDelOne();
            const afterDel2 = await nlRead();

            add(
              `NEXTLINERESULT ${JSON.stringify({
                ...nlBefore,
                typed: t1 && t2,
                saved: s1Click && s2Click,
                s1,
                s2,
                opened: nlOpened,
                disk: nlDisk,
                ...nlDetail,
                deleted: d1 && d2,
                afterDel1: afterDel1.total,
                afterDel2: afterDel2.total,
              })}`
            );
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

        /*
         * AL_AGREEMENT=1：真应用里让同一段字再跑一遍，然后看「同题复跑」那一栏。
         *
         * 为什么非要跑第二遍：这一栏的全部意义是「同一段字跑过不止一次时，报告一样吗」。
         * 只有一份报告时它只会说「看不出」——那句话是真的，但证明不了它在数。
         * 第二遍是假模型跑的（同一提示词指纹、同一模式、同一段原文），所以两份报告
         * 在比对的字段上应当逐字相同，界面必须说「1 组每次报告完全一样」。
         *
         * 第二遍之后要点一下历史：那一栏的刷新跟着 diag.id 与历史开关走，
         * 直接调 IPC 不会改 React 的 state——不点这一下，界面会一直显示跑一遍时的账，
         * 而「显示旧账」恰恰是这一栏最坏的坏法：它看起来完全正常。
         *
         * 独立真值：archive:list 是另一条 IPC（读索引），界面上的「跑了 N 遍」
         * 必须等于它的长度。写死一个 2 也能让界面通顺。
         */
        if (process.env['AL_AGREEMENT'] === '1' && !canceled) {
          const aBefore = await wc.executeJavaScript(`JSON.stringify({
            bar: !!document.querySelector('[data-agreement-bar]'),
            detailBefore: !!document.querySelector('[data-agreement-detail]'),
            labelBefore: (document.querySelector('[data-agreement-open]')?.textContent ?? '').trim(),
          })`);
          const aRun = await wc.executeJavaScript(`(async () => {
            const list = await window.api.archive.list();
            if (!list.length) return 'no-report';
            const rep = await window.api.archive.get(list[0].id);
            if (!rep) return 'no-body';
            const r = await window.api.analysis.run(rep.passage, rep.theory, rep.mode);
            return r && r.ok ? 'ok' : 'fail:' + (r && r.error ? r.error.code : '?');
          })()`);
          await new Promise((r) => setTimeout(r, 300));
          await wc.executeJavaScript(`(() => { document.querySelector('[data-panel="history"]')?.click(); return true; })()`);
          await new Promise((r) => setTimeout(r, 500));
          const aOpened = await wc.executeJavaScript(`(() => {
            const b = document.querySelector('[data-agreement-open]');
            if (!b) return false;
            b.click();
            return true;
          })()`);
          await new Promise((r) => setTimeout(r, 300));
          const aListLen = await wc.executeJavaScript(`window.api.archive.list().then((a) => a.length)`);
          /*
           * 「谁跑的」真的落盘了吗：把最新那份带 engine 的报告读回来，拿主进程读到的设置当独立真值。
           *
           * 三件事，缺一不可：
           *   1. 模型名与设置一致——写死一个字符串也能让界面通顺，只有跟设置对上才算数；
           *   2. 温度等于「设置与模式上限里更低那个」——记成设置页里填的数字，
           *      在被上限压过的模式上就是一条假证据；
           *   3. 整份报告里搜不到 Key——这份报告会被导出，凭据漏进去是最坏的一种「顺手」。
           *      冒烟用的 Key 是专门挑的假串（见 scripts/smoke.mjs），
           *      用 'test' 这种常见词当 canary 会让这条断言偶发误红。
           */
          const ids = await wc.executeJavaScript(`window.api.archive.list().then((a) => a.map((x) => x.id))`);
          let newest: { engine?: { model?: string; host?: string; temperature?: number }; mode?: string } | null = null;
          for (const id of ids) {
            const got = await wc.executeJavaScript(`window.api.archive.get(${JSON.stringify(id)})`);
            if (got && got.engine) {
              newest = got;
              break;
            }
          }
          const cfg = readSettings();
          const ceiling = newest?.mode ? SAMPLING[newest.mode as keyof typeof SAMPLING]?.temperature : undefined;
          add(
            `ENGINERESULT ${JSON.stringify({
              present: !!newest?.engine,
              model: newest?.engine?.model ?? null,
              host: newest?.engine?.host ?? null,
              temperature: newest?.engine?.temperature ?? null,
              mode: newest?.mode ?? null,
              cfgModel: cfg.model,
              cfgTemp: cfg.temperature,
              cfgHost: (() => {
                try {
                  return new URL(cfg.baseUrl).host;
                } catch {
                  return null;
                }
              })(),
              ceiling: ceiling ?? null,
              keyLeak: !!cfg.apiKey && JSON.stringify(newest ?? {}).includes(cfg.apiKey),
              keyLen: cfg.apiKey.length,
            })}`,
          );
          const aState = await wc.executeJavaScript(`JSON.stringify({
            bar: !!document.querySelector('[data-agreement-bar]'),
            repeatAttr: document.querySelector('[data-agreement-bar]')?.getAttribute('data-agreement-repeat') ?? '',
            detail: !!document.querySelector('[data-agreement-detail]'),
            line: (document.querySelector('[data-agreement-line]')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
            cells: [...document.querySelectorAll('[data-agreement-cell]')].map((e) => (e.textContent ?? '').replace(/\\s+/g, ' ').trim()),
            caveat: (document.querySelector('[data-agreement-caveat]')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
            text: document.querySelector('[data-agreement-text]')?.value ?? '',
            foot: (document.querySelector('[data-engine-foot]')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
            labelAfter: (document.querySelector('[data-agreement-open]')?.textContent ?? '').trim(),
            error: (document.querySelector('[data-agreement-error]')?.textContent ?? '').trim(),
          })`);
          add(`AGREEMENTRESULT ${JSON.stringify({ ...JSON.parse(aState), ...JSON.parse(aBefore), run: aRun, opened: aOpened, listLen: aListLen })}`);

          /*
           * 同一段·多镜：真机走一遍 archive.cross。
           *
           * 只验接线与守恒：读得回、六副透镜恰好各占一行或一个 missing、坏文件数带回来。
           * 「两副以上时界面长什么样」由 check:report 的纯函数样本负责——
           * 假模型这段文字只跑过一副透镜，端到端造不出第二种，造了就是假数据作证。
           */
          const crossProbe = await wc.executeJavaScript(`(async () => {
            const list = await window.api.archive.list();
            if (!list.length) return JSON.stringify({ ok: false, why: 'no-list' });
            const d = await window.api.archive.get(list[0].id);
            if (!d) return JSON.stringify({ ok: false, why: 'no-body' });
            const r = await window.api.archive.cross(d);
            return JSON.stringify({
              ok: true,
              rows: r.view.rows.length,
              missing: r.view.missing.length,
              badFiles: r.badFiles,
              line: r.view.line,
            });
          })()`);
          add(`CROSSRESULT ${crossProbe}`);

          /*
           * 挑两份摆在一起。
           *
           * 这一块验的是**接线**：入口在不在、没选够两份时按钮是不是真的不能点、
           * 点完之后面板开没开、面板上的数是不是与「同题复跑」那一栏同源。
           *
           * 为什么只验到「0 处」：假模型两次输出逐字相同，真报告在这一栏里就是 0 处。
           * 「有几处不同」那一档端到端造不出来——要造就得往存档里写两份不一样的真报告，
           * 那等于拿假数据替这一屏作证。那一档由 `check:sideby` 的样本与预览页截图负责。
           * 这条边界写在这里，免得下次有人以为端到端把两种情况都验了。
           */
          const pick = await wc.executeJavaScript(`JSON.stringify({
            btns: document.querySelectorAll('[data-agreement-pickbtn]').length,
            cmpDisabledBefore: (() => {
              const c = document.querySelector('[data-agreement-compare]');
              return c ? !!c.disabled : null;
            })(),
          })`);
          /*
           * 点号码与读结果必须分成两次执行。
           *
           * 第一版写在一个同步 IIFE 里：点完两个号码立刻数 `[data-agreement-picked="1"]`，
           * 读到 0——React 还没重渲染。**那不是界面坏了，是探针抢跑。**
           * 而这种失败看起来和「按钮点不动」一模一样（按钮确实还是灰的）。
           */
          await wc.executeJavaScript(`(() => {
            [...document.querySelectorAll('[data-agreement-pickbtn]')].slice(0, 2).forEach((b) => b.click());
            return true;
          })()`);
          await new Promise((r) => setTimeout(r, 250));
          const cmpAfter = await wc.executeJavaScript(`(() => {
            const picked = document.querySelectorAll('[data-agreement-picked="1"]').length;
            const c = document.querySelector('[data-agreement-compare]');
            const disabled = c ? !!c.disabled : null;
            if (c && !c.disabled) c.click();
            return JSON.stringify({ picked, disabledAfter: disabled });
          })()`);
          await new Promise((r) => setTimeout(r, 400));
          const panel = await wc.executeJavaScript(`JSON.stringify({
            open: !!document.querySelector('[data-sideby]'),
            rows: Number(document.querySelector('[data-sideby]')?.getAttribute('data-sideby-rows') ?? -1),
            line: (document.querySelector('[data-sideby-line]')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
            flags: [...document.querySelectorAll('[data-sideby-flag]')].map((e) => e.getAttribute('data-sideby-flag')),
            cards: [...document.querySelectorAll('[data-sideby-card]')].map((e) => (e.textContent ?? '').replace(/\\s+/g, ' ').trim()),
            sections: document.querySelectorAll('[data-sideby-section]').length,
            text: (document.querySelector('[data-sideby-text]')?.value ?? ''),
          })`);
          /* 同一条抢跑的坑：点完关闭要等一拍再读，否则读到的是「面板还在」 */
          await wc.executeJavaScript(`(() => {
            const x = document.querySelector('[data-sideby-close]');
            if (x) x.click();
            return true;
          })()`);
          await new Promise((r) => setTimeout(r, 250));
          const closed = await wc.executeJavaScript(`JSON.stringify({
            closed: !document.querySelector('[data-sideby]'),
            barStill: !!document.querySelector('[data-agreement-bar]'),
          })`);
          add(
            `SIDEBYRESULT ${JSON.stringify({
              ...JSON.parse(pick),
              ...JSON.parse(cmpAfter),
              ...JSON.parse(panel),
              ...JSON.parse(closed),
            })}`,
          );
        }
      }

      /*
       * AL_VIEWS=1：挑图——这次看哪几张图，用户真的能选，而且选了就算数。
       *
       * 这一块最坏的坏法有三种，每一种都不会报错：
       *   1. 面板打得开但点不动（勾选是装饰）；
       *   2. 点得动但只改了勾，图还在原处（界面说了谎）；
       *   3. 改了当时，刷新或换一份报告就回到默认（用户每次都要重关）。
       *
       * 第 3 种在这条端到端里只能验一半：这里核的是「写进本机的值对不对」
       * （独立真值，直接读 localStorage 原文），
       * 「重启后读回来」靠初始化那行源码守着（check:views 有一条断言）。
       * 剩下的写进 README 的已知限制，不装作验过。
       */
      /*
       * 「结论的口气」：本地拿原文那一句核报告那一句。
       *
       * 这一块不依赖任何开关——报告一出现它就在，所以每条冒烟路径都会顺带核一次。
       * 核的是**接线**：界面上那两句必须逐字等于报告里的 quote 与 text（不是界面另写一份），
       * 差别条数与种类必须等于纯函数算出来的那一档。
       * 「本地算得对不对」归 `check:modal` 的 59 条与八组反证，不在这里重复。
       */
      {
        const tone = await wc.executeJavaScript(`JSON.stringify({
          has: !!document.querySelector('[data-tone]'),
          verdict: document.querySelector('[data-tone]')?.getAttribute('data-tone-verdict') ?? '',
          source: (document.querySelector('[data-tone-source]')?.textContent ?? '').trim(),
          claim: (document.querySelector('[data-tone-claim]')?.textContent ?? '').trim(),
          diffs: [...document.querySelectorAll('[data-tone-diff]')].map((e) => e.getAttribute('data-tone-diff')),
          cross: (document.querySelector('[data-tone-cross]')?.textContent ?? '').trim(),
          rep: (document.querySelector('[data-tone-rep]')?.textContent ?? '').trim(),
          fine: (document.querySelector('[data-tone] .tone-fine')?.textContent ?? '').trim(),
          /* 位置：这一块必须长在结论名片之后、第一条前提之前 */
          afterConcl: (() => {
            const tone = document.querySelector('[data-tone]');
            const cards = [...document.querySelectorAll('.claim-card')];
            if (!tone || !cards.length) return false;
            const order = [...document.querySelectorAll('.claim-card, [data-tone]')];
            return order.indexOf(tone) === 1;
          })(),
        })`);
        add(`TONERESULT ${tone}`);
      }

      /*
       * 语境地基：判定那一格下面那句，以及语境坐标的口径句。
       *
       * 假模型不产出 context.grounding，所以这条跑道走的一定是**旧档路径**：
       * 界面必须说「分不出哪几格是原文说的」，而不是补一句「假定」。
       * 这正是要验的那条边界——真实模型漏标时，界面会不会替它编一个来路。
       * 「读的是哪两格」由 check:context-use 的 128 条守着（walton→对话类型＋阶段），
       * 这里只核接线：标记在、文字来自载荷、徽章数对得上。
       */
      {
        const ctx = await wc.executeJavaScript(`JSON.stringify({
          has: !!document.querySelector('[data-verdict-context]'),
          caveat: (document.querySelector('[data-verdict-context] .vscope-say')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
          note: (document.querySelector('[data-ctx-sum]')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
          reads: document.querySelectorAll('.ctxused').length,
          badges: [...document.querySelectorAll('.ctxbadge')].map((e) => e.textContent.trim()),
          tags: [...document.querySelectorAll('[data-verdict-context] .vtag')].map((e) => e.textContent.trim()),
        })`);
        add(`CTXRESULT ${ctx}`);
      }

      /*
       * 判档记录卡（D0–D5）。
       *
       * 假模型这份给了完整的 D2 记录，所以这里走的是「有档位」的那条分支：
       * 档位、条款、缺陷位置、处置、降级条件、置信度都得逐字来自报告，
       * 而不是卡片自己按检查项算一个。缺口为 0 时不许摆一条空的缺口清单
       * （空格子会被读成「记录不全」）——反过来说，缺口数必须真等于本地核对的结果。
       *
       * 「判几档对不对」本地给不了（判断由模型写出），归 check:grading 的 81 条与
       * 13 组反证；这里只核接线：属性、文案来源、D5 闸门在 D2 上不出现。
       */
      {
        const grade = await wc.executeJavaScript(`JSON.stringify({
          has: !!document.querySelector('[data-grade]'),
          none: !!document.querySelector('[data-grade-none]'),
          level: document.querySelector('[data-grade]')?.getAttribute('data-grade') ?? '',
          blocks: document.querySelector('[data-grade]')?.getAttribute('data-grade-gap') ?? '',
          label: (document.querySelector('[data-grade] .glb')?.textContent ?? '').trim(),
          clause: (document.querySelector('[data-grade] .gcl')?.textContent ?? '').trim(),
          heads: [...document.querySelectorAll('[data-grade] .grows dt')].map((e) => (e.textContent ?? '').trim()),
          vals: [...document.querySelectorAll('[data-grade] .grows dd')].map((e) => (e.textContent ?? '').trim()),
          gates: !!document.querySelector('[data-grade-gates]'),
          gaps: [...document.querySelectorAll('[data-grade] .ggaps li')].length,
          boundary: (document.querySelector('[data-grade] .gnote')?.textContent ?? '').trim(),
          conf: (document.querySelector('[data-grade] .gconf')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
        })`);
        add(`GRADERESULT ${grade}`);
      }

      /*
       * 修辞审计卡（D-03）。
       *
       * 假模型给了一张完整表（3 行、1 条替代链、1 处与强度超载重合），所以这里走
       * 「有表」那一支。核的是接线与来源：八列表头顺序、每行的测试结论、替代链的
       * 被顶掉理由、隔离声明逐字、边界句在、索引里有一格。
       * 单手法不移交 D5 这条由 check:rhetoric 的断言与反证守着，这里只核它真的
       * 以「只记缺陷位置」的样子出现在界面上——两种写法在屏幕上长得一样，
       * 只有走到 DOM 才分得出模型写的是哪一种。
       */
      {
        const rh = await wc.executeJavaScript(`JSON.stringify({
          has: !!document.querySelector('[data-rhetoric]'),
          none: !!document.querySelector('[data-rhetoric-none]'),
          rows: Number(document.querySelector('[data-rhetoric]')?.getAttribute('data-rhetoric-rows') ?? -1),
          chains: Number(document.querySelector('[data-rhetoric]')?.getAttribute('data-rhetoric-chains') ?? -1),
          subs: Number(document.querySelector('[data-rhetoric]')?.getAttribute('data-rhetoric-subs') ?? -1),
          cols: [...document.querySelectorAll('[data-rhetoric] thead th')].map((e) => (e.textContent ?? '').trim()),
          tests: [...document.querySelectorAll('[data-rhetoric-row]')].map((e) => e.getAttribute('data-rhetoric-test')),
          chainText: [...document.querySelectorAll('[data-rhetoric-chain]')].map((e) => (e.textContent ?? '').replace(/\\s+/g, ' ').trim()),
          replaced: [...document.querySelectorAll('[data-rhetoric-replaced]')].map((e) => e.getAttribute('data-rhetoric-replaced')),
          iso: (document.querySelector('[data-rhetoric-iso]')?.textContent ?? '').trim(),
          boundary: (document.querySelector('[data-rhetoric] .rh-boundary')?.textContent ?? '').trim(),
          close: (document.querySelector('[data-rhetoric] .rh-close')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
          inIndex: [...document.querySelectorAll('[data-qnav]')].some((e) => e.getAttribute('data-qnav') === 'sec-rhetoric'),
        })`);
        add(`RHETRESULT ${rh}`);
      }

      /*
       * 型式—CQ 对表（C-04）。
       *
       * 假模型这份的型式是「相关—因果」：表内第 8 型最低集四问，库内只列了三问，
       * 少的那一问是「机制」。所以这里走的是「表内 + 本库有缺口」那一支：
       * 核四行都渲染、第四行标的是 library-gap（不是「报告没答」）、缺口说明点名
       * 「机制」、报告那三问都登记了、边界句与隔离句在。
       * 「表对不对、覆盖是不是真的」归 check:scheme-cq 的 373 条与 12 组反证，
       * 这里只核它真的走到了屏幕上，且没有把库的边界算成模型的漏答。
       */
      {
        const scq = await wc.executeJavaScript(`JSON.stringify({
          has: !!document.querySelector('[data-scheme-cq]'),
          table: document.querySelector('[data-scheme-cq]')?.getAttribute('data-scq-table') ?? '',
          no: Number(document.querySelector('[data-scheme-cq]')?.getAttribute('data-scq-no') ?? -1),
          min: Number(document.querySelector('[data-scheme-cq]')?.getAttribute('data-scq-min') ?? -1),
          registered: Number(document.querySelector('[data-scheme-cq]')?.getAttribute('data-scq-registered') ?? -1),
          libgap: Number(document.querySelector('[data-scheme-cq]')?.getAttribute('data-scq-libgap') ?? -1),
          unlisted: Number(document.querySelector('[data-scheme-cq]')?.getAttribute('data-scq-unlisted') ?? -1),
          rows: [...document.querySelectorAll('[data-scq-row]')].map((e) => e.getAttribute('data-scq-row') + ':' + e.getAttribute('data-scq-gap') + ':' + e.getAttribute('data-scq-answer')),
          notes: [...document.querySelectorAll('[data-scq-note]')].map((e) => (e.textContent ?? '').replace(/\\s+/g, ' ').trim()),
          line: (document.querySelector('[data-scq-line]')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
          boundary: (document.querySelector('[data-scheme-cq] .scq-boundary')?.textContent ?? '').trim(),
          iso: (document.querySelector('[data-scheme-cq] .scq-iso')?.textContent ?? '').trim(),
        })`);
        add(`SCQRESULT ${scq}`);
      }

      /*
       * 命题账（D-02）。
       *
       * 假模型给了四条命题的账：C 在规范栏（带 A_v 与条件式结论）、P1 已证真、
       * P2 不可裁、P3 未决，两个方向的谬误筛查都写了「未发现」。这里走「有账」那一支。
       * 核的是接线与形状：每条命题都有一行账、状态值与栏位对得上、规范栏露出 A_v、
       * 「不判」那一行看得到理由与复核人、两个方向各占一行、缺口为 0、索引里有一格。
       * 「账该记成什么样」归 check:ledger 的断言与反证守，这里只核它真的走到了屏幕上。
       */
      {
        const led = await wc.executeJavaScript(`JSON.stringify({
          none: !!document.querySelector('[data-ledger="none"]'),
          rows: [...document.querySelectorAll('.pl-led')].map((e) => e.getAttribute('data-ledger') + ':' + e.getAttribute('data-status')),
          props: [...document.querySelectorAll('[data-prop]')].map((e) => e.getAttribute('data-prop')),
          conds: [...document.querySelectorAll('.pl-led[data-ledger="norm-undecidable"] .pl-f')].map((e) => (e.textContent ?? '').replace(/\\s+/g, ' ').trim()),
          fal: [...document.querySelectorAll('.pl-fal-row')].map((e) => e.getAttribute('data-dir')),
          falText: (document.querySelector('.pl-fal')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
          gaps: document.querySelectorAll('.pl-gaps').length,
          d2: (document.querySelector('.pl-d2')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
          inIndex: [...document.querySelectorAll('[data-qnav]')].some((e) => e.getAttribute('data-qnav') === 'sec-props'),
        })`);
        add(`LEDGERRESULT ${led}`);
      }

      /*
       * 「骨架缺口」：本地第一次对报告本身说「这里接不上」。
       *
       * 核的是接线与来源，不是算法：每条缺口都得带 `data-skeleton-from`，
       * 标签文字得逐字是「本地数的 / 报告自己说的」。不标来源，读的人分不出
       * 哪几条是本地新产出的判定、哪几条只是把报告里已有的话又念了一遍。
       * 「算得对不对」归 `check:skeleton` 的断言与反证，不在这里重复。
       */
      {
        const gaps = await wc.executeJavaScript(`JSON.stringify({
          has: !!document.querySelector('[data-skeleton]'),
          line: (document.querySelector('[data-skeleton-line]')?.textContent ?? '').trim(),
          gapCount: Number(document.querySelector('[data-skeleton-line]')?.getAttribute('data-skeleton-line') ?? -1),
          kinds: [...document.querySelectorAll('[data-skeleton-gap]')].map((e) => e.getAttribute('data-skeleton-gap')),
          froms: [...document.querySelectorAll('[data-skeleton-gap]')].map((e) => e.getAttribute('data-skeleton-from')),
          fromLabels: [...document.querySelectorAll('[data-skeleton-from-label]')].map((e) => (e.textContent ?? '').trim()),
          notes: [...document.querySelectorAll('[data-skeleton-gap] .sk-note')].map((e) => (e.textContent ?? '').trim()),
          facts: [...document.querySelectorAll('[data-skeleton-fact]')].map((e) => (e.textContent ?? '').trim()),
          sub: (document.querySelector('#sec-gaps .s')?.textContent ?? '').trim(),
          plain: (document.querySelector('#sec-gaps .block-plain')?.textContent ?? '').trim(),
        })`);
        add(`GAPSRESULT ${gaps}`);
      }

      /*
       * 「逐字比」：贴在每一条主张下面，不在报告外面另起一栏。
       *
       * 核的是接线与位置，不是算法：这一块必须紧跟着「原话」那一行、必须逐字
       * 显示报告自己写下的两句话、必须把本地读出的片段列出来。「算得对不对」
       * 归 check:rewrite 的断言与反证，不在这里重复。
       */
      {
        const rw = await wc.executeJavaScript(`JSON.stringify({
          cards: [...document.querySelectorAll('[data-rewrite]')].map((e) => {
            const card = e.parentElement;
            const kids = [...(card?.children ?? [])];
            const quoteAt = kids.findIndex((k) => k.classList.contains('claim-quote'));
            return {
              kind: e.getAttribute('data-rewrite'),
              line: (e.querySelector('[data-rewrite-line]')?.textContent ?? '').trim(),
              quoteChars: Number(e.querySelector('[data-rewrite-line]')?.getAttribute('data-rewrite-line') ?? -1),
              detail: (e.querySelector('[data-rewrite-detail]')?.textContent ?? '').trim(),
              fragCount: Number(e.querySelector('[data-rewrite-detail]')?.getAttribute('data-rewrite-detail') ?? -1),
              note: (e.querySelector('[data-rewrite-note]')?.textContent ?? '').trim(),
              quote: (card?.querySelector('.claim-quote')?.textContent ?? '').trim(),
              text: (card?.querySelector('.claim-text')?.textContent ?? '').trim(),
              afterQuote: quoteAt >= 0 && kids.indexOf(e) === quoteAt + 1,
            };
          }),
        })`);
        add(`REWRITERESULT ${rw}`);
      }

      /*
       * 「来源账」：把「模型给出的判断」与「本地复算」分开的那一栏。
       *
       * 核的是接线与展开：默认必须收起（替人决定先读什么不是这一层该做的），
       * 点开之后四类本地复算要各占一行、每行都标「本地复算」。
       * 点击与读取分两次并等一拍——同一个 executeJavaScript 里点完立刻读，
       * 读到的是点击前的 DOM，看起来像「按钮点不动」。
       */
      {
        const sourceBefore = JSON.parse(
          await wc.executeJavaScript(`JSON.stringify({
            has: !!document.querySelector('[data-source-bar]'),
            headline: (document.querySelector('[data-source-headline]')?.textContent ?? '').trim(),
            modelCount: Number(document.querySelector('[data-source-model-count]')?.getAttribute('data-source-model-count') ?? -1),
            toggle: (document.querySelector('[data-source-toggle]')?.textContent ?? '').trim(),
            openedByDefault: !!document.querySelector('[data-source-list]'),
          })`)
        );
        const sourceClicked = await wc.executeJavaScript(`(() => {
          const b = document.querySelector('[data-source-toggle]');
          if (!b) return false;
          b.click();
          return true;
        })()`);
        await sleep(300);
        const sourceAfter = JSON.parse(
          await wc.executeJavaScript(`JSON.stringify({
            rows: [...document.querySelectorAll('[data-source-row]')].map((e) => ({
              key: e.getAttribute('data-source-row'),
              from: (e.querySelector('.src-from')?.textContent ?? '').trim(),
              count: (e.querySelector('.src-count')?.textContent ?? '').trim(),
            })),
            note: (document.querySelector('[data-source-note]')?.textContent ?? '').trim(),
          })`)
        );
        add(`SOURCERESULT ${JSON.stringify({ ...sourceBefore, clicked: sourceClicked, ...sourceAfter })}`);
      }

      /*
       * 「这一圈的词」：学术分析区块里词表由人给的那一栏。
       *
       * 核的是接线，不是算法：默认收起、点开后出现输入框、把词真的填进去之后
       * 本地当场重算（行、条数、状态都跟着变）。填词走 React 受控组件的原生
       * setter + input 事件；点击／输入／读取分三次并各等一拍，抢跑会读到旧 DOM。
       */
      {
        const termsBefore = JSON.parse(
          await wc.executeJavaScript(`JSON.stringify({
            has: !!document.querySelector('[data-terms-bar]'),
            openedByDefault: !!document.querySelector('[data-terms-panel]'),
          })`)
        );
        const termsClicked = await wc.executeJavaScript(`(() => {
          const b = document.querySelector('[data-terms-toggle]');
          if (!b) return false;
          b.click();
          return true;
        })()`);
        await sleep(300);
        const termsTyped = await wc.executeJavaScript(`(() => {
          const el = document.querySelector('[data-terms-input]');
          if (!el) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          setter.call(el, '早读, 一本率, 举证责任');
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()`);
        await sleep(300);
        const termsAfter = JSON.parse(
          await wc.executeJavaScript(`JSON.stringify({
            rows: [...document.querySelectorAll('[data-terms-row]')].map((e) => ({
              word: e.getAttribute('data-terms-row'),
              count: (e.querySelector('.ft-count')?.textContent ?? '').trim(),
              facts: [...e.querySelectorAll('.ft-fact')].map((x) => (x.textContent ?? '').trim()),
            })),
            note: (document.querySelector('[data-terms-note]')?.textContent ?? '').trim(),
            state: document.querySelector('[data-terms-note]')?.getAttribute('data-terms-state') ?? '',
            caveat: (document.querySelector('[data-terms-caveat]')?.textContent ?? '').trim(),
          })`)
        );
        add(`TERMSRESULT ${JSON.stringify({ ...termsBefore, clicked: termsClicked, typed: termsTyped, ...termsAfter })}`);
      }

      /*
       * 长文覆盖账：这一栏只在长文本上出现。冒烟跑道用的是短文本示例，
       * 所以这里验的是「不该出现时整块不出现」——把 `!v.long` 那道闸去掉，
       * 短文本就多一条 100% 的空面板，页面不报任何错，看起来还挺正常。
       * 长文本那一版由预览页 `?coverage=1`（真组件渲染）与 `npm run audit:longtext`
       * （在真模型长报告上复算）分别守，边界写在 README 已知限制。
       */
      {
        const cv = JSON.parse(
          await wc.executeJavaScript(`JSON.stringify({
            present: !!document.querySelector('[data-coverage]'),
            headline: (document.querySelector('[data-coverage-headline]')?.textContent ?? '').trim(),
            rows: document.querySelectorAll('[data-coverage-row]').length,
          })`)
        );
        add(`COVERAGERESULT ${JSON.stringify({ ...cv, short: true })}`);
      }

      if (process.env['AL_VIEWS'] === '1') {
        const snap = async (): Promise<Record<string, unknown>> =>
          JSON.parse(
            await wc.executeJavaScript(`JSON.stringify({
              bar: !!document.querySelector('[data-view-bar]'),
              count: Number(document.querySelector('[data-view-bar]')?.getAttribute('data-view-count') ?? -1),
              line: (document.querySelector('[data-view-line]')?.textContent ?? '').trim(),
              panel: !!document.querySelector('[data-view-panel]'),
              items: document.querySelectorAll('[data-view-item]').length,
              on: [...document.querySelectorAll('[data-view-item]')]
                .filter((e) => e.getAttribute('data-view-on') === '1')
                .map((e) => e.getAttribute('data-view-id')),
              blocked: [...document.querySelectorAll('[data-view-item]')]
                .filter((e) => e.getAttribute('data-view-blocked') === '1')
                .map((e) => e.getAttribute('data-view-id')),
              structSvg: !!document.querySelector('#sec-structure svg'),
              refuteSvg: !!document.querySelector('#sec-refute [aria-label="反驳落点"]'),
              repairSvg: !!document.querySelector('#sec-repair [aria-label="修补对照"]'),
              offNotes: [...document.querySelectorAll('[data-view-off]')].map((e) => e.getAttribute('data-view-off')),
              stored: (() => {
                try { return localStorage.getItem('al:views'); } catch { return 'x'; }
              })(),
              offText: (document.querySelector('[data-view-off]')?.textContent ?? '').trim(),
            })`),
          );

        const click = async (sel: string): Promise<boolean> =>
          wc.executeJavaScript(`(() => {
            const el = document.querySelector(${JSON.stringify(sel)});
            if (!el) return false;
            el.click();
            return true;
          })()`);

        const vBefore = await snap();
        await click('[data-view-open]');
        await new Promise((r) => setTimeout(r, 200));
        const vOpened = await snap();

        /* 关掉结构图：图必须真的从正文里消失，而不是只把勾去掉。 */
        const vClickOff = await click('[data-view-toggle="structure"]');
        await new Promise((r) => setTimeout(r, 200));
        const vOff = await snap();

        /* 全显示：新增的两张图要真的画出来——这是「更多可视化」这一半的证据。 */
        const vClickAll = await click('[data-view-all]');
        await new Promise((r) => setTimeout(r, 250));
        const vAll = await snap();

        /* 只留默认三张：回到旧版的样子，且选择要写回本机。 */
        const vClickDef = await click('[data-view-default]');
        await new Promise((r) => setTimeout(r, 200));
        const vDef = await snap();

        add(
          `VIEWSRESULT ${JSON.stringify({
            before: vBefore,
            opened: vOpened,
            off: vOff,
            all: vAll,
            def: vDef,
            clicks: { off: vClickOff, all: vClickAll, def: vClickDef },
          })}`,
        );
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

      /*
       * 简洁态里「分歧账」「这把尺子」两栏按核对层收着（只剩标题一行）。
       * 截图前要先展开，否则量到的高度只有二三十像素，整块图静默地不产出——
       * 而断言只查「有没有 PHSHOT / DIVSHOT」，不查「为什么没有」，红得没头没脑。
       *
       * 展开走界面自己那条路：报告里每一处「跳到 X」用的就是派发 al:reveal，
       * 由阅读层级接住并展开那一栏（见 Density.tsx）。改 data-al-fold 没用——
       * 简洁态的收起在 React 那一层（is-collapsed），目录那一层是另一套。
       * 返回读数是为了让日志分得清「本来就展开」与「这次才展开」。
       */
      const revealBlock = async (id: string): Promise<string> =>
        (await wc.executeJavaScript(`(() => {
          const el = document.getElementById(${JSON.stringify(id)});
          if (!el) return 'absent';
          const folded = el.classList.contains('is-collapsed');
          window.dispatchEvent(new CustomEvent('al:reveal', { detail: ${JSON.stringify(id)} }));
          return folded ? 'revealed' : 'open';
        })()`)) as string;

      /*
       * 分歧账那一栏的整块截图：默认拍「没登记」，AL_DIVERGENCE=1 拍「填齐了」。
       *
       * 位置必须放在这里，不能放在刚出报告那会儿：截图要先 scrollIntoView，
       * 而滚动会往「接着读」写一条位置记录；放在前面会把「新报告没有记录」
       * 那条断言弄成假红——红的是自检自己制造的痕迹，不是产品坏了。
       * 放在 DOM 探针之后、各面板探针之前，那时该读的位置都已经读完了。
       *
       * 两张都要看：没登记时那一栏不能是一片空白（人会以为报告少了半页），
       * 填齐时四格坐标、矩阵尾部三行、E4 登记册得排得下。
       *
       * 这里不在 `canceled` 的作用域里（那是最前面分析循环里的局部变量）。
       * 按停与空态跑道本来就没有报告：getElementById 取不到，dvBox 为 null，自然不截。
       */
      if (!process.env['AL_CANCEL']) {
        const dvReveal = await revealBlock('sec-divergence');
        await sleep(120);
        await wc.executeJavaScript(`(() => {
          document.getElementById('sec-divergence')?.scrollIntoView({ block: 'start' });
          return true;
        })()`);
        await sleep(400);
        add(`DIVREVEAL ${dvReveal}`);
        const dvBox = (await wc.executeJavaScript(`(() => {
          const el = document.getElementById('sec-divergence');
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return {
            x: Math.max(0, Math.round(b.left)),
            y: Math.max(0, Math.round(b.top)),
            width: Math.round(b.width),
            height: Math.min(2000, Math.round(b.height)),
          };
        })()`)) as { x: number; y: number; width: number; height: number } | null;
        if (dvBox && dvBox.width > 200 && dvBox.height > 60) {
          const png = (await wc.capturePage(dvBox)).toPNG();
          const name = process.env['AL_DIVERGENCE'] === '1' ? 'divergence-filled.png' : 'divergence-empty.png';
          const p = join(dirname(shot), name);
          writeFileSync(p, png);
          add(`DIVSHOT ${p} ${png.length} bytes`);
        }
      }

      /*
       * 「这把尺子」整块截图。与上面同一个位置：DOM 读数都已取完，滚动不会再
       * 污染「接着读」的初始状态。裁切高度必须扣掉视口剩余空间——这一栏在
       * 报告末尾，scrollIntoView 之后底边仍可能超出 864 高的窗口，capturePage
       * 会抛 UnknownVizError，然后几十条断言一起假红到「应用没启动」。
       */
      if (!process.env['AL_CANCEL']) {
        /* 同上一栏：简洁态里它是收着的，先展开再量、再拍。 */
        const phReveal = await revealBlock('sec-prompt-history');
        await sleep(120);
        await wc.executeJavaScript(`(() => {
          document.getElementById('sec-prompt-history')?.scrollIntoView({ block: 'start' });
          return true;
        })()`);
        await sleep(350);
        add(`PHREVEAL ${phReveal}`);
        const phBox = (await wc.executeJavaScript(`(() => {
          const el = document.getElementById('sec-prompt-history');
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return {
            x: Math.max(0, Math.round(b.left)),
            y: Math.max(0, Math.round(b.top)),
            width: Math.round(b.width),
            height: Math.max(0, Math.min(Math.round(b.height), window.innerHeight - Math.round(b.top))),
          };
        })()`)) as { x: number; y: number; width: number; height: number } | null;
        if (phBox && phBox.width > 200 && phBox.height > 80) {
          const png = (await wc.capturePage(phBox)).toPNG();
          const p = join(dirname(shot), 'prompt-history-real.png');
          writeFileSync(p, png);
          add(`PHSHOT ${p} ${png.length} bytes`);
        }
        /* 展开一次变更史，读数交给 DOM 探针；这一步只验按钮真的挂了并且能点。 */
        await wc.executeJavaScript(`(() => {
          const b = document.querySelector('[data-ph-toggle]');
          if (b) b.click();
          return !!b;
        })()`);
        await sleep(150);
        add(`PHOPEN ${await wc.executeJavaScript(`JSON.stringify({
          toggle: document.querySelector('[data-ph-toggle]')?.getAttribute('data-ph-toggle') ?? '',
          rows: document.querySelectorAll('[data-ph-row]').length,
        })`)}`);
      }

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

        /*
         * 深查发现页签：点进去，等 IPC 读完，记下总述/空态/条数，再切回报告页签。
         * 默认跑道刚跑的是一份诊断，临时 userData 里没有深查账本，所以这里应当是空态；
         * 若以后有 deep 报告混进来，空态断言会红——那说明夹具变了，不是功能坏了。
         */
        const deepLib = await wc.executeJavaScript(`(async () => {
          const tab = document.querySelector('[data-hs-tab="deep"]');
          if (!tab) return JSON.stringify({ found: false });
          tab.click();
          for (let i = 0; i < 40; i++) {
            await new Promise((r) => setTimeout(r, 100));
            if (document.querySelector('[data-deep-sum]') || document.querySelector('[data-deep-empty]')) break;
          }
          const probe = {
            found: true,
            tabOn: tab.classList.contains('on'),
            sum: (document.querySelector('[data-deep-sum]')?.innerText || '').replace(/\\s+/g, ' ').trim(),
            empty: !!document.querySelector('[data-deep-empty]'),
            items: document.querySelectorAll('[data-deep-arc]').length,
            note: (document.querySelector('[data-deep-empty]')?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
          };
          document.querySelector('[data-hs-tab="reports"]')?.click();
          return JSON.stringify(probe);
        })()`);
        add(`DEEPLIB ${deepLib}`);
        await new Promise((r) => setTimeout(r, 300));

        /*
         * 检索：拿刚读到的那一行摘要的开头当查询。
         *
         * 为什么不用写死的词：存档是用户自己的。写死一个「早读」，在有人的机器上一次也搜不到，
         * 而断言会红成「检索坏了」——那是把夹具的错记在功能头上。用列表里真有的字，
         * 验的才是同一条路：输入框 → 主进程扫盘 → 结果行 → 片段加亮。
         *
         * 分成两段是因为中间要截图：命中那一屏只在「词还在框里」时存在，
         * 清空之后就再也拍不到了。
         */
        const findReady = await wc.executeJavaScript(`(() => {
          const row0 = document.querySelector('.dialog.hs-dialog .hs-row .hs-excerpt');
          const q = (row0?.innerText || '').trim().slice(0, 4);
          const inp = document.querySelector('[data-hs-q]');
          if (!inp || !q) return null;
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          window.__alFind = { q, set, inp, before: document.querySelectorAll('.dialog.hs-dialog .hs-row').length };
          set.call(inp, q);
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          return window.__alFind.before;
        })()`);
        add(`FINDBEFORE ${findReady}`);
        const findProbe = await wc.executeJavaScript(`(async () => {
          const st = window.__alFind;
          if (!st) return JSON.stringify({ ok: false, why: 'no-input-or-no-row' });
          const wait = async () => {
            for (let i = 0; i < 30; i++) {
              await new Promise((r) => setTimeout(r, 100));
              const v = document.querySelector('[data-hs-state]')?.getAttribute('data-hs-state') || '';
              if (v && v !== 'pending') return v;
            }
            return '';
          };
          const state = await wait();
          const rows = document.querySelectorAll('.dialog.hs-dialog .hs-row').length;
          const marks = document.querySelectorAll('.dialog.hs-dialog .hs-hit').length;
          const excerpt = (document.querySelector('.dialog.hs-dialog .hs-row .hs-excerpt')?.innerText || '').replace(/\s+/g, ' ');
          const line = (document.querySelector('[data-hs-line]')?.innerText || '').replace(/\s+/g, ' ');
          return JSON.stringify({ ok: true, q: st.q, before: st.before, state, rows, marks, excerpt, line });
        })()`);
        add(`FINDDOM ${findProbe}`);
        {
          const box = (await wc.executeJavaScript(`(() => {
            const el = document.querySelector('.dialog.hs-dialog');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
          })()`)) as { x: number; y: number; width: number; height: number } | null;
          if (box && box.width > 200 && box.height > 120) {
            const img = await wc.capturePage(box);
            const p = join(dirname(shot), 'history-find.png');
            writeFileSync(p, img.toPNG());
            add(`FINDSHOT ${p}`);
          }
        }
        const findAfter = await wc.executeJavaScript(`(async () => {
          const st = window.__alFind;
          if (!st) return JSON.stringify({ ok: false });
          const wait = async () => {
            for (let i = 0; i < 30; i++) {
              await new Promise((r) => setTimeout(r, 100));
              const v = document.querySelector('[data-hs-state]')?.getAttribute('data-hs-state') || '';
              if (v && v !== 'pending') return v;
            }
            return '';
          };
          document.querySelector('[data-hs-q-clear]')?.click();
          let after = 0;
          for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 100));
            after = document.querySelectorAll('.dialog.hs-dialog .hs-row').length;
            if (after === st.before) break;
          }
          st.set.call(st.inp, 'zzzqqq');
          st.inp.dispatchEvent(new Event('input', { bubbles: true }));
          const state2 = await wait();
          return JSON.stringify({
            ok: true,
            after,
            state2,
            rows2: document.querySelectorAll('.dialog.hs-dialog .hs-row').length,
            line2: (document.querySelector('[data-hs-line]')?.innerText || '').replace(/\s+/g, ' '),
          });
        })()`);
        add(`FINDAFTER ${findAfter}`);
        /*
         * 「一份都没有匹配」那一屏也要拍：列表空着的时候，如果状态那句话被挤掉或没渲染，
         * 整块会是一片空白——而空白的读法是「还没开始搜」，不是「没有」。
         * 这个失败方式任何断言都抓不到，只有图能看出来。
         */
        {
          const box = (await wc.executeJavaScript(`(() => {
            const el = document.querySelector('.dialog.hs-dialog');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
          })()`)) as { x: number; y: number; width: number; height: number } | null;
          if (box && box.width > 200 && box.height > 120) {
            const img = await wc.capturePage(box);
            const p = join(dirname(shot), 'history-none.png');
            writeFileSync(p, img.toPNG());
            add(`FINDSHOT ${p}`);
          }
        }
        await new Promise((r) => setTimeout(r, 300));
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

      /*
       * AL_DENSITY=compact：简洁态自己的跑道。
       * 验三件机器能判的事：核对层真的收起了、点栏名真的展开了、以及收起前后
       * .block-body 的文字一个字没少——收起只改显示，不卸载节点，也不动导出。
       */
      if (process.env['AL_DENSITY'] === 'compact') {
        const bodyProbe = `JSON.stringify((() => {
          const bodies = [...document.querySelectorAll('.block-body')];
          return {
            density: document.documentElement.dataset.density || '',
            bar: !!document.querySelector('[data-density-bar]'),
            collapsed: document.querySelectorAll('.block.is-collapsed').length,
            ledger: document.querySelectorAll('[data-density-tier="ledger"]').length,
            core: document.querySelectorAll('[data-density-tier="core"]').length,
            bodies: bodies.length,
            textLen: bodies.reduce((n, e) => n + (e.textContent || '').length, 0),
            brief: document.querySelector('[data-brief-fold]')?.open ? 1 : 0,
          };
        })())`;
        add(`DENSITYDOM before ${await wc.executeJavaScript(bodyProbe)}`);
        /*
         * 简洁态里点「目录」上的栏名，那一栏应当展开。
         *
         * 旧探针找的是 `[data-fold]`，但正文区里从来没有这个属性——Block 只渲染
         * block-head，折叠按钮那一版早已撤掉。于是这条断言一直点到空处，
         * 「点栏名之后那一栏展开了」在简洁态跑道上永远是红的（不是这条改动弄红的）。
         * 改成点真正存在的目录芯片：先找一个「目录里有、正文里收着」的栏，再点它。
         */
        const foldClick = await wc.executeJavaScript(`(() => {
          const chips = [...document.querySelectorAll('[data-qnav]')];
          const hit = chips.find((c) => {
            const id = c.getAttribute('data-qnav');
            return !!id && !!document.getElementById(id)?.classList.contains('is-collapsed');
          });
          if (!hit) return 'no-target';
          hit.click();
          return hit.getAttribute('data-qnav') || 'clicked';
        })()`);
        add(`DENSITYDOM fold ${foldClick}`);
        await new Promise((r) => setTimeout(r, 250));
        add(
          `DENSITYDOM after ${await wc.executeJavaScript(`JSON.stringify((() => {
            const bodies = [...document.querySelectorAll('.block-body')];
            return {
              collapsed: document.querySelectorAll('.block.is-collapsed').length,
              textLen: bodies.reduce((n, e) => n + (e.textContent || '').length, 0),
            };
          })())`)}`
        );
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
                  // 带上它的字：验「开关真的翻面了」这类交互，有没有这个类不够，
                  // 得看它自己写出了什么——「只看核过的」翻成「看全部」才是真翻面。
                  text: (el.textContent ?? '').trim().slice(0, 30),
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

      /*
       * AL_FIND=1：打包产物里的历史检索。
       *
       * 这一功能跨三层（preload 桥 → 主进程 IPC → scanDir / @shared/archive-search）。
       * 任一层没进 asar，症状都不是报错，而是「搜什么都没有」或「输入框点不动」——
       * 光在包里 grep 一个字符串证明不了路是通的，所以这里直接调一次桥。
       *
       * 查询词取原文**中段**四个字，不取开头：列表摘要本来就带开头 72 字，
       * 用开头验等于证明不了「摘要之外的字也找得到」，而那正是这一轮要补的事。
       * 词也不写死：存档是用户自己的，写死一个词在有人的机器上一次也搜不到，
       * 断言会红成「检索坏了」——那是把夹具的错记在功能头上。
       */
      if (process.env['AL_FIND'] === '1') {
        const findPack = await wc.executeJavaScript(`(async () => {
          const api = window.api?.archive;
          if (!api || typeof api.find !== 'function') return JSON.stringify({ ok: false, why: 'no-bridge' });
          const list = await api.list();
          if (!list.length) return JSON.stringify({ ok: false, why: 'no-list' });
          const d = await api.get(list[0].id);
          const passage = String(d?.passage ?? '').replace(/\\s+/g, '');
          if (passage.length < 8) return JSON.stringify({ ok: false, why: 'no-passage' });
          const mid = Math.floor(passage.length / 2);
          let q = passage.slice(mid, mid + 4);
          /* 首字是标点就往右挪一格：搜「，学生就」也能命中，但读数里
             看着像搜了个标点，说不清「找的是字」。不用正则，免得模板串再转义一次。 */
          const punct = '，。、；：？！“”‘’《》（）,.!?;:';
          for (let i = mid; i + 4 <= passage.length; i++) {
            if (!punct.includes(passage[i])) { q = passage.slice(i, i + 4); break; }
          }
          const hit = await api.find(q);
          const miss = await api.find('zzzqqq没有这个词');
          return JSON.stringify({
            ok: true, q, listLen: list.length,
            scanned: hit.scanned, unreadable: hit.unreadable, terms: hit.terms,
            ids: hit.hits.map((h) => h.id),
            hasFirst: hit.hits.some((h) => h.id === list[0].id),
            inList: hit.hits.every((h) => list.some((m) => m.id === h.id)),
            firstSnippet: hit.hits.find((h) => h.id === list[0].id)?.snippet ?? '',
            missHits: miss.hits.length, missScanned: miss.scanned,
          });
        })()`);
        add(`FINDRESULT ${findPack}`);
      }

      /*
       * AL_LONGFORM=1：长文逐段跑整条链。
       *
       * 放在最后（所有常规探针都读完、`add('OK')` 之前），因为它会把输入框换成
       * 一篇六段的文字，之后屏幕上是「第 5 段」那一份报告——一百多条按示例文本
       * 写的断言都会被它带偏。所以在**同一条跑道里**先跑常规部分，再跑这一段。
       *
       * 要验的是四件不能靠静态断言的事：
       *   1. 那五次调用真的发出去了，而且每一段各存下一份报告（id 互不相同）；
       *   2. 台账真的写进了磁盘：拿报告 id 反查得回同一批（back === 段数）；
       *   3. 点某一行的「打开」真的能把那一段的报告调回来；
       *   4. 跑完之后没有卡在「正在跑」的行——批次会结束，这是最容易坏的一处。
       */
      if (process.env['AL_LONGFORM'] === '1') {
        const lf = await wc.executeJavaScript(`(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const segs = [
            '我们学校去年取消了早读，今年高考一本率下降了 6 个百分点。这说明取消早读是错的。',
            '王校长在公开材料里说，早读能提高记忆效率，学生就该早起读书。但他没有给出任何数据。',
            '如果连早读都保证不了，将来上课、自习、考试还能保证什么？',
            '另外，很多家长也反对取消早读，可见取消早读不得人心。',
            '学校的作息安排应当听取家长意见，这一点在教育部文件里有明确规定。',
            '总之，早读必须立刻恢复，否则教学质量会继续下滑。'
          ];
          const ta = document.querySelector('.composer textarea') || document.querySelector('textarea');
          if (!ta) return JSON.stringify({ ok: false, why: 'no-textarea' });
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          /*
           * 先摆一段**真够长**的（>800 字）再验跳转：覆盖账与那句范围只在长文上出现，
           * 而下面逐段跑用的六段合起来才两百字，拿它验等于验了一个不会出现的按钮。
           * 内容就是把六段各重复六遍——切分仍是六段（空行分隔），字数过千。
           */
          const longText = segs.map(function (s) { return [s, s, s, s, s, s].join(' '); }).join('\\n\\n');
          setter.call(ta, longText);
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(400);

          /*
           * 先验「报告页 → 切分条」这一跳，再逐段跑。
           *
           * 顺序不能反：逐段跑会把输入框换成第 5 段，那时切分条只剩「恢复全文」，
           * 判定区那个按钮也随覆盖账改算到那一段上、不再出现。
           *
           * 这里要验的是三件静态断言看不见的事：按钮真的出现、点了列表真的展开、
           * 展开之后真的停在视口里（滚过去了才算把人送到）。
           */
          let segJump = { ok: false, why: 'no-primary' };
          const primary = document.querySelector('.composer button.primary');
          if (primary) {
            primary.click();
            let sawScope = false;
            for (let i = 0; i < 40; i++) {
              await sleep(200);
              if (document.querySelector('[data-verdict-scope]')) { sawScope = true; break; }
            }
            const btn = document.querySelector('[data-verdict-segment]');
            if (!btn) {
              segJump = { ok: false, why: 'no-seg-btn', scope: sawScope };
            } else {
              const listBefore = !!document.querySelector('.sg-list');
              const label = (btn.textContent || '').trim();
              btn.click();
              await sleep(400);
              const bar = document.querySelector('.sg-bar');
              const hit = !!bar && bar.classList.contains('sg-hit');
              const listAfter = !!document.querySelector('.sg-list');
              await sleep(1200);
              const rect = bar ? bar.getBoundingClientRect() : null;
              segJump = {
                ok: true,
                scope: sawScope,
                label,
                listBefore,
                listAfter,
                hit,
                inView: !!rect && rect.top >= -2 && rect.bottom <= window.innerHeight + 2,
                top: rect ? Math.round(rect.top) : null,
              };
            }
          }

          /*
           * 换回六段短文再逐段跑。跳转那一步把列表点开了，这里先收起——
           * 下面照原流程「点开头展开再找逐段跑」，列表若已展开，那一点会把它收起。
           */
          setter.call(ta, segs.join('\\n\\n'));
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(400);
          if (document.querySelector('.sg-list')) {
            const h0 = document.querySelector('.sg-head');
            if (h0) { h0.click(); await sleep(200); }
          }

          const head = document.querySelector('.sg-head');
          if (!head) return JSON.stringify({ ok: false, why: 'no-segbar' });
          head.click();
          await sleep(300);
          const runBtn = document.querySelector('[data-sg-run]');
          if (!runBtn) return JSON.stringify({ ok: false, why: 'no-run-btn' });
          const calls = runBtn.getAttribute('data-sg-run');
          runBtn.click();
          await sleep(250);
          const go = document.querySelector('[data-sg-run-go]');
          if (!go) return JSON.stringify({ ok: false, why: 'no-confirm' });
          go.click();

          let rows = 0, done = 0, running = 0, waiting = 0, spins = 0;
          for (let i = 0; i < 100; i++) {
            await sleep(300);
            spins = i + 1;
            const list = [...document.querySelectorAll('[data-lf-row]')];
            rows = list.length;
            const st = list.map((el) => el.getAttribute('data-lf-status'));
            running = st.filter((s) => s === 'running').length;
            waiting = st.filter((s) => s === 'idle' || s === 'stopped').length;
            done = st.filter((s) => s === 'ok').length;
            if (rows && !running && !waiting) break;
          }
          const list = [...document.querySelectorAll('[data-lf-row]')];
          const ids = list.map((el) => el.getAttribute('data-lf-id') || '');
          const levels = list.map((el) => el.getAttribute('data-lf-level') || '');
          const line = (document.querySelector('[data-lf-line]') || {}).textContent || '';
          const busyLeft = document.querySelectorAll('[data-lf-status="running"]').length;

          const opener = document.querySelector('[data-lf-open]');
          let opened = false, openedPassage = '';
          if (opener) {
            opener.click();
            await sleep(1200);
            opened = !!document.querySelector('.grid');
            const box = document.querySelector('.composer textarea') || document.querySelector('textarea');
            openedPassage = ((box && box.value) || '').slice(0, 12);
          }

          let back = null;
          if (ids[0]) {
            try {
              const l = await window.api.longform.ofReport(ids[0]);
              back = l && l.items ? l.items.length : null;
            } catch (e) { back = 'err'; }
          }
          return JSON.stringify({
            ok: true, calls, rows, done, running, waiting, spins, ids, levels,
            line: String(line).slice(0, 120), busyLeft, opened, openedPassage, back,
            skipped: [...document.querySelectorAll('[data-lf-status="skipped"]')].length,
            uniq: new Set(ids.filter(Boolean)).size,
            segJump,
          });
        })()`);
        add(`LFRESULT ${lf}`);

        const lfShot = process.env['AL_LONGFORM_SHOT'];
        if (lfShot) {
          /*
           * 只拍台账那一块，不拍整页。
           *
           * 整页截在这个窗口下是 7800 像素高——图能出，但没人能在一张长条上
           * 看清六行字，而这一张的用途正是「让人看一眼这批账长什么样」。
           * 矩形夹在视口内：capturePage 拿到视口外的 rect 会抛，一抛就会把
           * 后面几十条断言一起带到「应用没启动」上去。
           */
          try {
            const box = (await wc.executeJavaScript(`(() => {
              const el = document.querySelector('[data-longform]');
              if (!el) return null;
              const main = el.closest('.main');
              if (main) main.scrollTop = 0;
              const r = el.getBoundingClientRect();
              const top = Math.max(0, r.top);
              const height = Math.min(r.height + 10, window.innerHeight - top - 6);
              return {
                x: Math.max(0, r.left),
                y: top,
                width: Math.min(r.width, window.innerWidth - Math.max(0, r.left)),
                height: Math.max(30, height),
              };
            })()`)) as { x: number; y: number; width: number; height: number } | null;
            if (box) {
              const img = await wc.capturePage(box);
              writeFileSync(lfShot, img.toPNG());
            } else {
              add('LFSHOT_FAIL 台账不在页面上');
            }
          } catch (err) {
            add(`LFSHOT_FAIL ${(err as Error).message}`);
          }
        }
      }

      add('OK');
    } catch (err) {
      add(`ERR ${(err as Error).message}`);
    }
    app.exit(0);
  });
}
