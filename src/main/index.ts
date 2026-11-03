import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSettings, writeSettings, hasApiKey, keyUnreadable } from './store';
import { runAnalysis } from './analyze';
import { testConnection, LlmError } from './llm';
import { attachSmoke } from './smoke';
import { archiveDirPath, getReport, listReports, removeReport, saveReport } from './archive';
import { exportReportArgdown, exportReportMarkdown } from './report-export';
import { captureStatus, registerCapture, unregisterCapture } from './capture';
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
import type { Diagnosis } from '@shared/types';
import { FALLACIES } from './kb/fallacies';
import { PRAGMA_RULES } from './kb/pragma';
import { normalizeMode, type AnalysisMode, type LlmSettings, type Pricing } from '@shared/types';
import { describeProblems, validateSettingsPatch } from '@shared/settings-check';
import { DEFAULT_THEORY, THEORIES, isTheoryId, type TheoryId } from '@shared/theories';
import { buildPrompt, renderPrompt, SAMPLING, BUDGET } from './prompt';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

let mainWindow: BrowserWindow | null = null;

/**
 * 只放行这几种协议。
 *
 * `shell.openExternal` 交出去的是操作系统的执行权，不是浏览器的导航权：
 * 传一个 `file:///C:/Windows/System32/cmd.exe` 过去，系统会照办。
 * 这些 url 的来源是模型输出与用户粘贴的文本，任何一个被渲染成链接的地方
 * 都可能把它递进来，所以白名单在这里，不在渲染层——渲染层可以被打穿，主进程不行。
 */
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function openExternalSafely(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (!SAFE_PROTOCOLS.has(parsed.protocol)) return;
  shell.openExternal(parsed.toString());
}

/*
 * 正在进行的那一次分析，按渲染进程分别记。
 *
 * 为什么需要这张表：请求在主进程发出去，渲染层手上只有一个 Promise，
 * 没有任何办法让它停——关窗、切走都只是「不再看它」，请求照样跑到底、
 * 照样计费。要真的停，abort 必须发生在 fetch 那一侧，而那一侧只有主进程够得着。
 *
 * 键用 webContents.id 而不是「全局一个」：两个窗口各跑各的，
 * 一个窗口按「停」不该顺手掐掉另一个窗口的分析。
 */
const running = new Map<number, AbortController>();

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
      /*
       * sandbox 打开。
       *
       * 以前是 false，理由是「preload 里可能会用到 node」——实际上 preload 只用
       * ipcRenderer 和 contextBridge，两者在沙箱里都可用。关掉沙箱换来的只有风险：
       * 渲染层一旦被注入脚本，它拿到的就是一个完整的 node 运行时。
       *
       * 渲染层的边界是三层的：nodeIntegration 关、contextIsolation 开、sandbox 开。
       * 缺第三层，前两层只是「正常路径上不会用到 node」，而不是「用不了 node」。
       */
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  /*
   * 关窗就把还在跑的那一次掐掉。
   *
   * 不掐的后果：窗口没了，fetch 还在跑，最长跑到 120 秒超时；
   * 而它跑完之后 saveReport 还会往历史里写一份——一份用户以为自己已经
   * 关掉的报告，下次打开应用时出现在列表最上面。
   */
  const wcId = mainWindow.webContents.id;
  mainWindow.on('closed', () => {
    running.get(wcId)?.abort();
    running.delete(wcId);
  });

  // 外部链接一律交给系统浏览器，不在应用内开窗
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
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
      /*
       * 不回 Key 明文。
       *
       * 以前这里把解密后的 Key 原样发回渲染层，仅仅是为了让设置页的输入框
       * 显示出来「已经填过」。为一次显示把凭据复制一份到渲染进程，
       * 换来的好处是用户少看一个占位符——代价却是任何能读到渲染层状态的东西
       * 都能读到它（开发者工具、注入的脚本、将来接进来的任何一段前端代码）。
       *
       * 现在只回「有没有」和「解不解得开」两个事实，这两件事才是界面真正需要的：
       * 没有 → 引导去填；有 → 显示「已保存，留空则不改」。
       */
      apiKey: '',
      hasKey: hasApiKey(),
      // 「配过但这台机器解不开」要单独说。只报 hasKey=false 的话，
      // 用户会把它当成没配过，回头去填一个新的，旧密文就被覆盖了。
      keyUnreadable: keyUnreadable(),
    };
  });

  ipcMain.handle('settings:save', (_e, payload: Partial<LlmSettings>) => {
    const problems = validateSettingsPatch(payload);
    if (problems.length) {
      /*
       * 不写。
       *
       * 保存时不做校验的后果是：错误被推迟到下一次请求才暴露，而那时界面上
       * 显示的是「网络请求失败」——一条把用户指向错误方向的提示。
       * 更坏的一种是 file:// 开头的地址：它会被 new URL 接受，也会真的发出去。
       */
      return { ok: false, error: describeProblems(problems) };
    }
    writeSettings(payload);
    return { ok: true };
  });

  ipcMain.handle(
    'analysis:run',
    async (event, passage: string, theory: TheoryId, mode?: AnalysisMode, parentId?: string | null) => {
      const sender = event.sender;
      const ctl = new AbortController();
      running.set(sender.id, ctl);
      try {
        const { diagnosis, usage } = await runAnalysis(
          passage,
          theory,
          (stage, label, percent) => {
            if (!sender.isDestroyed()) {
              sender.send('analysis:progress', { stage, label, percent });
            }
          },
          { mode, parentId, signal: ctl.signal }
        );
        /*
         * 自动存档。放在这里而不是 runAnalysis 里，是因为「跑分析」和「留住结果」
         * 是两件事：前者是纯计算，后者是应用行为。
         *
         * 存失败不再只是「算了」：它照样返回结果（用户已经花了钱，不能因为磁盘
         * 满了把报告也扣下），但把失败一并报回去。以前这个 catch 是空的，
         * 于是列表里没有这一份、修订对照也找不到上一版，而界面上什么都没说——
         * 用户第一次发现是在他想对照的时候，那时原因已经无从查起。
         */
        let saved = true;
        let saveError: string | null = null;
        try {
          saveReport(diagnosis, usage);
        } catch (err) {
          saved = false;
          saveError = (err as Error)?.message ?? '写不进存档目录';
        }
        // 把这次记账一并返回：报告顶部要显示「这一份花了多少」，
        // 再去账本里取最近一条会有认错记录的风险。
        return { ok: true, data: diagnosis, usage, saved, saveError };
      } catch (err) {
        /*
         * 错误码只从 LlmError 上取。
         * 以前这里读的是 `(e as any).code`，于是任何带 code 字段的意外错误
         * （比如 Node 的 `ENOENT`）都会被当成业务错误码报给界面，
         * 而界面上那些码是拿来对应「去改 Key / 去改地址」的。有码不等于有语义。
         */
        return {
          ok: false,
          error: {
            code: err instanceof LlmError ? err.code : 'ANALYSIS_FAILED',
            message: (err as Error)?.message ?? '分析失败，原因不明。',
          },
        };
      } finally {
        // 只清自己那一条：万一期间有新的分析顶上来，删掉的是它的控制器，
        // 那一次就再也停不掉了。
        if (running.get(sender.id) === ctl) running.delete(sender.id);
      }
    }
  );

  /*
   * 停。
   *
   * 返回 canceled 而不是一个笼统的 ok：调用方必须知道「到底有没有停到东西」。
   * 常见的尴尬时刻是请求刚好在这 200 毫秒里跑完了——那时 abort 打在一个已经
   * 结束的控制器上，什么都不会发生。界面若照样显示「已停止」，就是在撒谎：
   * 用户随后会看到一份报告冒出来，而它明明已经「停了」。
   */
  ipcMain.handle('analysis:cancel', (e) => {
    const ctl = running.get(e.sender.id);
    if (!ctl) return { ok: true, canceled: false };
    ctl.abort();
    return { ok: true, canceled: true };
  });

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
  /*
   * 报告的导出走主进程，是因为要弹系统保存框。
   * 传进来的是整份报告：导出的排版由 shared/report-markdown.ts 做，
   * 与界面用的是同一份数据、同一套标签，不存在「导出件与界面不一致」的第三种结果。
   */
  ipcMain.handle('report:exportMarkdown', (e, d: Diagnosis) =>
    exportReportMarkdown(BrowserWindow.fromWebContents(e.sender), d)
  );
  /* 同一份报告、同一套 supports，换个格式给工具读。判定不在导出里重算。 */
  ipcMain.handle('report:exportArgdown', (e, d: Diagnosis) =>
    exportReportArgdown(BrowserWindow.fromWebContents(e.sender), d)
  );
  ipcMain.handle('usage:reveal', () => shell.openPath(usageDirPath()));

  ipcMain.handle('kb:schemes', () => SCHEMES);
  ipcMain.handle('kb:fallacies', () => FALLACIES);
  ipcMain.handle('kb:pragmaRules', () => PRAGMA_RULES);
  ipcMain.handle('kb:theories', () => THEORIES);

  /* 异议：只记录，不改报告。所有写操作返回全量，界面直接替换状态。 */
  ipcMain.handle('objections:list', () => listObjections());
  ipcMain.handle('objections:of', (_e, diagId: string) => objectionsOf(diagId));
  /*
   * 写失败要变成界面上的一句话，不能是静默的空操作。
   *
   * 异议这个功能唯一的价值是「留下来」。写不进去却回一个正常的列表，
   * 界面上就表现为「点了一下，什么也没发生」——用户会以为是自己没点对，
   * 再点一次，还是没有。这比直接告诉他「没记上」坏得多：前者让他怀疑自己，
   * 后者让他知道磁盘出了什么事。
   */
  ipcMain.handle('objections:add', (_e, input: ObjectionInput) => {
    try {
      return { ok: true, list: addObjection(input) };
    } catch (err) {
      return { ok: false, list: listObjections(), error: (err as Error)?.message ?? '异议没能写进文件。' };
    }
  });
  ipcMain.handle('objections:remove', (_e, diagId: string, key: string) => {
    try {
      return { ok: true, list: removeObjection(diagId, key) };
    } catch (err) {
      return { ok: false, list: listObjections(), error: (err as Error)?.message ?? '异议没能从文件里删掉。' };
    }
  });
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
  ipcMain.handle('app:openExternal', (_e, url: string) => openExternalSafely(url));

  /*
   * 快捷键的注册结果。
   *
   * 为什么要有这条通道：注册失败是**正常事**（键被别的程序占着），
   * 而失败的样子和「这个功能本来就不存在」一模一样——按了没反应。
   * 界面拿不到结论，就只能装作有这个功能，或者干脆不提；
   * 两种都比直说「这个键被占了，换一个」更坏。
   */
  ipcMain.handle('capture:status', () => captureStatus());
}


app.whenReady().then(() => {
  registerIpc();
  createWindow();
  if (mainWindow) attachSmoke(mainWindow);

  /*
   * 快捷键在窗口之后注册：回调需要拿到窗口。
   *
   * 失败不拦启动——一个锦上添花的入口不该让整台机器起不来。
   * 但结论要留下来（`capture:status`），界面会把它写在提示条里。
   */
  registerCapture(() => mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/*
 * 退出必须注销。
 *
 * 不注销的话，这个键在进程结束后仍可能挂在系统里（某些环境下直到登录会话结束），
 * 表现是「卸载了应用，那个键还是不灵」——而人找不到原因。
 */
app.on('will-quit', () => unregisterCapture());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
