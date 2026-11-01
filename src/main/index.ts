import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSettings, writeSettings, hasApiKey } from './store';
import { runAnalysis } from './analyze';
import { testConnection } from './llm';
import { archiveDirPath, getReport, listReports, removeReport, saveReport } from './archive';
import { clearAnchor, exportUsageCsv, setAnchor, setPricing, summarizeUsage, usageDirPath } from './usage';
import {
  addObjection,
  listObjections,
  objectionStats,
  objectionsDirPath,
  objectionsOf,
  removeObjection,
  type ObjectionInput,
} from './objections';
import { SCHEMES } from './kb/schemes';
import { FALLACIES } from './kb/fallacies';
import { PRAGMA_RULES } from './kb/pragma';
import { normalizeMode, type AnalysisMode, type LlmSettings, type Pricing } from '@shared/types';
import { DEFAULT_THEORY, THEORIES, isTheoryId, type TheoryId } from '@shared/theories';
import { buildPrompt, renderPrompt, SAMPLING, BUDGET } from './prompt';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#f7f6f3',
    title: '论证镜',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  // 外部链接一律交给系统浏览器，不在应用内开窗
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => {
    const s = readSettings();
    return {
      baseUrl: s.baseUrl,
      model: s.model,
      temperature: s.temperature,
      apiKey: s.apiKey,
      hasKey: hasApiKey(),
    };
  });

  ipcMain.handle('settings:save', (_e, payload: Partial<LlmSettings>) => {
    writeSettings(payload);
    return { ok: true };
  });

  ipcMain.handle(
    'analysis:run',
    async (event, passage: string, theory: TheoryId, mode?: AnalysisMode, parentId?: string | null) => {
      const sender = event.sender;
      try {
        const { diagnosis, usage } = await runAnalysis(
          passage,
          theory,
          (stage, label, percent) => {
            if (!sender.isDestroyed()) {
              sender.send('analysis:progress', { stage, label, percent });
            }
          },
          { mode, parentId }
        );
        /*
         * 自动存档。放在这里而不是 runAnalysis 里，是因为「跑分析」和「留住结果」
         * 是两件事：前者是纯计算，后者是应用行为。存失败也不能影响这次的结果——
         * 用户已经花了钱，不能因为磁盘满了就把报告也扣下。
         */
        try {
          saveReport(diagnosis, usage);
        } catch {
          /* 存不下就算了，报告本身照常返回 */
        }
        // 把这次记账一并返回：报告顶部要显示「这一份花了多少」，
        // 再去账本里取最近一条会有认错记录的风险。
        return { ok: true, data: diagnosis, usage };
      } catch (err) {
        const e = err as Error;
        return {
          ok: false,
          error: { code: (e as any).code ?? 'ANALYSIS_FAILED', message: e.message },
        };
      }
    }
  );

  ipcMain.handle('settings:test', (_e, patch: Partial<LlmSettings>) => testConnection(patch));

  /* 用量与余额。所有写操作都返回最新汇总，界面不用再取一次——少一次取就可能旧一次。 */
  ipcMain.handle('usage:summary', () => summarizeUsage());
  ipcMain.handle('usage:setPricing', (_e, patch: Partial<Pricing>) => {
    setPricing(patch);
    return summarizeUsage();
  });
  ipcMain.handle('usage:setAnchor', (_e, amount: number, note: string) => {
    setAnchor(amount, note);
    return summarizeUsage();
  });
  ipcMain.handle('usage:clearAnchor', () => {
    clearAnchor();
    return summarizeUsage();
  });
  ipcMain.handle('usage:export', (e) => exportUsageCsv(BrowserWindow.fromWebContents(e.sender)));
  ipcMain.handle('usage:reveal', () => shell.openPath(usageDirPath()));

  ipcMain.handle('kb:schemes', () => SCHEMES);
  ipcMain.handle('kb:fallacies', () => FALLACIES);
  ipcMain.handle('kb:pragmaRules', () => PRAGMA_RULES);
  ipcMain.handle('kb:theories', () => THEORIES);

  /* 异议：只记录，不改报告。所有写操作返回全量，界面直接替换状态。 */
  ipcMain.handle('objections:list', () => listObjections());
  ipcMain.handle('objections:of', (_e, diagId: string) => objectionsOf(diagId));
  ipcMain.handle('objections:add', (_e, input: ObjectionInput) => addObjection(input));
  ipcMain.handle('objections:remove', (_e, diagId: string, key: string) => removeObjection(diagId, key));
  ipcMain.handle('objections:stats', () => objectionStats());
  ipcMain.handle('objections:reveal', () => shell.openPath(objectionsDirPath()));

  /* 存档：报告本身。列表只给元数据，取全文要单独要。 */
  ipcMain.handle('archive:list', () => listReports());
  ipcMain.handle('archive:get', (_e, id: string) => getReport(id));
  ipcMain.handle('archive:remove', (_e, id: string) => removeReport(id));
  ipcMain.handle('archive:reveal', () => shell.openPath(archiveDirPath()));

  // 提示词可读，是这个产品必须满足的一条：用户有权看到自己被什么标准在衡量
  ipcMain.handle('prompt:get', (_e, theory: TheoryId, mode?: AnalysisMode) => {
    const t = isTheoryId(theory) ? theory : DEFAULT_THEORY;
    // 归一化而不是 `mode === 'redteam' ? …`：那种写法在四个模式下会把新模式静默变成诊断，
    // 提示词页于是显示诊断版，而用户以为自己在看重构版。
    const m = normalizeMode(mode);
    const b = buildPrompt(t, m);
    /*
     * 连版本、指纹、预算一起给出去。
     * 只给文本等于只给结论不给依据：用户无法判断「上次看到的那份和这份是不是同一份」，
     * 也无法知道这份提示词是不是已经长到会挤掉输出空间。
     */
    return {
      theory: t,
      mode: m,
      version: b.version,
      fingerprint: b.fingerprint,
      chars: b.chars,
      estTokens: b.estTokens,
      overBudget: b.overBudget,
      budget: { warn: BUDGET.warnChars, max: BUDGET.maxChars },
      sampling: SAMPLING[m],
      blockIds: b.blockIds,
      system: b.system,
      userTemplate: renderPrompt(b, '{{原文}}').user,
    };
  });
  ipcMain.handle('app:openExternal', (_e, url: string) => shell.openExternal(url));
}

/**
 * 冒烟检查：设了 AL_SMOKE 就加载完成后截图、写检查结果、退出。
 * 这不只是开发调试用——打包后的 exe 也要能自己证明「我打开了、渲染出来了」，
 * 否则「构建成功」和「能用」之间那道缝只能靠人眼去补。
 *
 * 结论写文件而不是 console：Windows 上 Electron 是 GUI 子系统程序，
 * console.log 不会流进父进程的管道，靠 stdout 判断等于什么都没测。
 */
function attachSmoke(): void {
  const shot = process.env['AL_SMOKE'];
  if (!shot || !mainWindow) return;

  const trace = `${shot}.log`;
  const add = (line: string) => {
    try {
      appendFileSync(trace, `${new Date().toISOString()} ${line}\n`);
    } catch {
      /* 日志失败不能影响主流程 */
    }
  };
  writeFileSync(trace, '');
  add(`boot pid=${process.pid} electron=${process.versions.electron}`);

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

      // AL_ACTION=analyze：填入示例、点分析、等结果落屏。
      // 这一步验证的是整条链，而不只是窗口能开：IPC → HTTP → 解析 → 裁决 → 渲染。
      if (process.env['AL_ACTION'] === 'analyze') {
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
        await wc.executeJavaScript(`(() => {
          const btn = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t);
          btn('填入示例')?.click();
          return true;
        })()`);
        await new Promise((r) => setTimeout(r, 500));
        // 注意：页签也叫「分析」，按文本找会点到页签上。这里按提交按钮的类名定位
        await wc.executeJavaScript(`(() => {
          document.querySelector('button.primary')?.click();
          return true;
        })()`);

        for (let i = 0; i < 60; i++) {
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
              failed: /分析未完成/.test(document.body.innerText),
              text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 240),
            })`
          );
          const st = JSON.parse(state);
          if (st.grid || st.failed) {
            add(`RESULT ${state}`);
            break;
          }
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
        if (process.env['AL_REVISE'] === '1' && !process.env['AL_PANEL']) {
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
        mainWindow!.setContentSize(Number(process.env['AL_SHOT_W'] ?? 1380), shotH);
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
      add('OK');
    } catch (err) {
      add(`ERR ${(err as Error).message}`);
    }
    app.exit(0);
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  attachSmoke();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
