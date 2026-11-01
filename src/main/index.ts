import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSettings, writeSettings, hasApiKey, keyUnreadable } from './store';
import { runAnalysis } from './analyze';
import { testConnection } from './llm';
import { attachSmoke } from './smoke';
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
      apiKey: s.apiKey,
      hasKey: hasApiKey(),
      // 「配过但这台机器解不开」要单独说。只报 hasKey=false 的话，
      // 用户会把它当成没配过，回头去填一个新的，旧密文就被覆盖了。
      keyUnreadable: keyUnreadable(),
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
  ipcMain.handle('app:openExternal', (_e, url: string) => openExternalSafely(url));
}


app.whenReady().then(() => {
  registerIpc();
  createWindow();
  if (mainWindow) attachSmoke(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
