import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSettings, writeSettings, hasApiKey, keyUnreadable } from './store';
import { runAnalysis } from './analyze';
import { testConnection, LlmError } from './llm';
import { attachSmoke } from './smoke';
import {
  allPassages,
  archiveDirPath,
  archiveHealth,
  findReports,
  getReport,
  listReports,
  passageScan,
  probeReport,
  removeReport,
  reportScan,
  saveReport,
} from './archive';
import {
  copyReportMarkdown,
  exportReportArgdown,
  exportReportPrg,
  exportReportMarkdown,
  openExported,
  revealExported,
} from './report-export';
import { captureStatus, registerCapture, unregisterCapture } from './capture';
import { ledgerOfReport, longformDirPath, saveLedger } from './longform';
import { REPORT_NAV_SCRIPT } from './report-nav';
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
import { addNextLine, listNextLines, removeNextLine, type NextLineInput } from './nextlines';
import { SCHEMES } from './kb/schemes';
import type { Diagnosis } from '@shared/types';
import { FALLACIES } from './kb/fallacies';
import { PRAGMA_RULES } from './kb/pragma';
import { normalizeMode, type AnalysisMode, type LlmSettings, type Pricing } from '@shared/types';
import { describeProblems, validateSettingsPatch } from '@shared/settings-check';
import { DEFAULT_THEORY, THEORIES, isTheoryId, type TheoryId } from '@shared/theories';
import { samenessOf } from '@shared/sameness';
import { portfolioOf } from '@shared/portfolio';
import { agreementOf } from '@shared/agreement';
import { crossLensOf } from '@shared/cross-lens';
import { collectDeepFindings } from '@shared/deep-archive';
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
    backgroundColor: '#f5f5f7',
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
   * 工作台入口之一：往原界面挂一个悬浮按钮。
   *
   * 为什么不改 React 组件树：Diagnosis.tsx 的组件数被 check:arch 冻结在 18，
   * 而这一版工作台是另一套信息架构，不该挤进那 18 个里。主进程注入一段
   * 只负责「开一个窗口」的脚本，原界面一个组件都不动，撤掉也只删这一段。
   * executeJavaScript 走 CDP，不受页面 CSP 的 script-src 约束。
   */
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.executeJavaScript(`(function(){
      if (document.getElementById('__wbLauncher')) return;
      var b = document.createElement('button');
      b.id = '__wbLauncher';
      b.textContent = '▦ 工作台';
      b.title = '打开工作台：回看已存档的报告（分析新文本请留在当前界面）';
      /* 配色跟着主界面走：原来是深色浮块，压在米白界面上像贴上去的补丁。 */
      b.style.cssText = 'position:fixed;right:18px;bottom:16px;z-index:2147483647;padding:7px 12px;border:1px solid rgba(0,0,0,.07);border-radius:8px;background:rgba(255,255,255,.86);backdrop-filter:saturate(180%) blur(20px);color:#48484a;font:11px system-ui;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.12)';
      b.onmouseenter = function(){ b.style.background = '#eef1f5'; b.style.color = '#2c3a49'; };
      b.onmouseout = function(){ b.style.background = 'rgba(255,255,255,.94)'; b.style.color = '#6b6458'; };
      b.onclick = function(){ window.api && window.api.workbench && window.api.workbench.open(); };
      document.body.appendChild(b);
    })();`).catch(() => {
      // @allow-silent: 悬浮按钮只是两个入口之一，注入失败时仍可用 Ctrl+Shift+W；
      // 主界面的分析功能与这个按钮无关，不该因为它抛错。
    });

    /*
     * 报告目录：一份报告 18 个一级区块、约 20 屏，判读在第七节。
     * 与前面的工作台入口同一层注入，理由见 ./report-nav.ts。
     */
    mainWindow?.webContents.executeJavaScript(REPORT_NAV_SCRIPT).catch(() => {
      // @allow-silent: 目录是阅读辅助，注入失败时报告本身仍完整可读。
    });
  });

  /* 入口之二：应用内快捷键。放在主窗口上，不注册全局键，不抢别的程序。
     目录的 Ctrl+Shift+D 在注入脚本内绑定（与目录同生共死，撤掉目录不留半截快捷键）。 */
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'w') {
      event.preventDefault();
      openWorkbench();
    }
  });

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

/*
 * ─────────── 工作台窗口 ───────────
 *
 * 这一层只做两件事：把本机存档读出来、交给工作台界面去摆。
 * 不解析论证、不改任何判定文字、不调用模型、不写盘。
 * 工作台里显示的是存档里已经存在的那一份报告，不是新分析出来的结论。
 */
let workbenchWindow: BrowserWindow | null = null;

type WorkbenchRow = Record<string, unknown>;

/*
 * 工作台缓存。buildWorkbenchData() 本来就要把 104 份报告全读一遍算统计，
 * 顺手留下对象与「同原文对照」映射：左树点某一份时不必再扫一遍磁盘。
 * 缓存只在刷新存档时重建；不保存路径、不接受任意路径参数。
 */
let workbenchDocs: WorkbenchRow[] = [];
let workbenchPairs: Record<string, string> = {};
/* 缓存对应的 id 集合。只比「份数」不够：删一份又跑一份，数目没变，
   缓存里却还是那份已经不存在的报告。检索前拿它和索引对一次。 */
let workbenchCacheKey = '';
/* 存档变了（跑完一份新报告 / 删掉一份）就置脏。工作台是「藏起来」而不是关掉，
   再显示时若还是旧快照，用户会以为刚跑的报告没存上。惰性重建：不在每次写盘时
   同步扫 104 个文件，等下次真要用工作台数据时才重算。 */
let workbenchDirty = false;
function markWorkbenchDirty(): void { workbenchDirty = true; }

function tallyOf(values: unknown[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    const k = String(v ?? '—');
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function buildWorkbenchData(): Record<string, unknown> {
  const metas = listReports();
  const docs: WorkbenchRow[] = [];
  for (const m of metas) {
    const d = getReport(m.id);
    if (d) docs.push(d as unknown as WorkbenchRow);
  }
  const report = docs[0] ?? null;
  const samePassage = report
    ? docs.filter((d) => d['id'] !== report['id'] && d['passage'] === report['passage'])
    : [];
  const compare = samePassage.find((d) => d['mode'] !== report?.['mode']) ?? samePassage[0] ?? report;

  const listOf = (d: WorkbenchRow, key: string): unknown[] =>
    Array.isArray(d[key]) ? (d[key] as unknown[]) : [];
  const objOf = (d: WorkbenchRow, key: string): WorkbenchRow => {
    const v = d[key];
    return v && typeof v === 'object' ? (v as WorkbenchRow) : {};
  };
  const groups = new Map<string, number>();
  for (const d of docs) {
    const k = String(d['passage'] ?? '').trim();
    groups.set(k, (groups.get(k) ?? 0) + 1);
  }
  const premises = (d: WorkbenchRow) => listOf(d, 'premises');
  const refutations = (d: WorkbenchRow) => listOf(d, 'refutations');
  const stats = {
    total: docs.length,
    passages: groups.size,
    maxGroup: Math.max(0, ...groups.values()),
    modes: tallyOf(docs.map((d) => d['mode'])),
    levels: tallyOf(docs.map((d) => objOf(d, 'verdict')['level'])),
    theories: tallyOf(docs.map((d) => d['theory'])),
    checks: tallyOf(docs.flatMap((d) => listOf(d, 'checks').map((c) => (c as WorkbenchRow)['answer']))),
    burdenPremises: `${docs.reduce((n, d) => n + premises(d).filter((p) => (p as WorkbenchRow)['burden'] === 'proponent').length, 0)}/${docs.reduce((n, d) => n + premises(d).length, 0)}`,
    burdenAfter: `${docs.reduce((n, d) => n + refutations(d).filter((r) => (r as WorkbenchRow)['burdenAfter'] === 'proponent').length, 0)}/${docs.reduce((n, d) => n + refutations(d).length, 0)}`,
    stage: tallyOf(docs.map((d) => objOf(d, 'context')['stage'])),
  };
  /*
   * 对照映射：同一段原文、不同 id 的另一份优先挑模式不同的，
   * 这样点开任意历史存档时「对照」页看得出两种问法的差别，而不是同一次复跑的拷贝。
   * 左树原来只拿到 16 条索引、点了也打不开报告；这里给全量索引 + 按 id 取全文的通道。
   */
  const pairs: Record<string, string> = {};
  for (const d of docs) {
    const id = String(d['id'] ?? '');
    const passage = String(d['passage'] ?? '').trim();
    if (!id || !passage) continue;
    const same = docs.filter(
      (x) => String(x['id'] ?? '') !== id && String(x['passage'] ?? '').trim() === passage
    );
    const other = same.find((x) => String(x['mode']) !== String(d['mode'])) ?? same[0];
    if (other) pairs[id] = String(other['id'] ?? '');
  }
  workbenchDocs = docs;
  workbenchPairs = pairs;
  workbenchCacheKey = metas.map((m) => String(m.id)).sort().join('|');
  workbenchDirty = false;
  /* 回看台同样要如实：索引里有几行、文件里有几份、哪些读不出来。
     以前只用 docs.length 报「本机存档 N 份」，坏文件被跳过时那句话听着完整，其实不完整。 */
  return { report, compare, archive: metas, pairOf: pairs, stats, health: archiveHealth() };
}

/* ─────────── 跨报告全文检索（纯读） ───────────
 *
 * 放在主进程只有一个理由：全库的字只在这里。工作台手里是当前一份报告全文
 * 和 72 字的存档摘要；拿摘要搜「全库」会给出看似完整、其实漏掉九成的结果。
 * 与 archive:portfolio / archive:sameness 同一个口径：不写盘、不调模型、不接路径。
 *
 * 只收字符串、只走白名单根字段。raw（模型原文）、prompt、diagnostics、
 * span（重复引文）、supports（结构连线的 id）都不进索引——它们不是读者会搜的
 * 「判断」，混进来只会把判读文字淹掉。
 */
const SEARCH_ROOTS = [
  'passage', 'context', 'scope', 'conclusion', 'premises', 'intermediate',
  'checks', 'lens', 'defeat', 'verdict', 'repair', 'labels',
  'legitimateMoves', 'refutations', 'selfCheck',
];
const SEARCH_SKIP = new Set([
  'raw', 'prompt', 'diagnostics', 'span', 'supports', 'id', 'at', 'createdAt',
  'version', 'parentId', 'fingerprint', 'confidence', 'tag', 'meta',
  'bytes', 'cost', 'open',
]);

function searchWalk(v: unknown, path: string, out: { path: string; text: string }[], depth: number): void {
  if (v == null || depth > 6) return;
  if (typeof v === 'string') {
    if (v.trim()) out.push({ path, text: v });
    return;
  }
  if (Array.isArray(v)) {
    v.forEach((x, i) => searchWalk(x, `${path}[${i}]`, out, depth + 1));
    return;
  }
  if (typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (SEARCH_SKIP.has(k)) continue;
      searchWalk(x, path ? `${path}.${k}` : k, out, depth + 1);
    }
  }
}

/** 命中处前后各留一点上下文；关键词本身逐字保留，不改写报告用字。 */
function snippetOf(text: string, q: string): string {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return '';
  const from = Math.max(0, i - 36);
  const to = Math.min(text.length, i + q.length + 60);
  return (from ? '…' : '') + text.slice(from, to).replace(/\s+/g, ' ') + (to < text.length ? '…' : '');
}

interface SearchHit {
  id: string;
  at: number;
  mode: string;
  theory: string;
  level: string;
  sec: string;
  path: string;
  snippet: string;
  n: number;
}

function searchArchive(q: string, filter: Record<string, unknown>) {
  const query = q.trim().toLowerCase();
  if (!query) return { ok: true, total: 0, docTotal: 0, capped: false, hits: [] as SearchHit[] };
  const mode = String(filter.mode ?? 'all');
  const theory = String(filter.theory ?? 'all');
  const level = String(filter.level ?? 'all');
  const rawLimit = Number(filter.limit ?? 120);
  const limit = Math.max(1, Math.min(200, Number.isFinite(rawLimit) ? rawLimit : 120));
  /* 每份报告最多列几条。不设这个上限，搜「早读」时 89 份里第一份就能
     把 120 条占满，界面看起来像只搜到一份报告——那是假的全库。 */
  const perDoc = 3;

  let total = 0;
  let docTotal = 0;
  let matchedEntries = 0;
  const hits: SearchHit[] = [];
  for (const d of workbenchDocs) {
    const id = String(d['id'] ?? '');
    if (!id) continue;
    const dMode = String(d['mode'] ?? '');
    const dTheory = String(d['theory'] ?? '');
    const vd = d['verdict'];
    const dLevel = vd && typeof vd === 'object' ? String((vd as Record<string, unknown>)['level'] ?? '') : '';
    if (mode !== 'all' && dMode !== mode) continue;
    if (theory !== 'all' && dTheory !== theory) continue;
    if (level !== 'all' && dLevel !== level) continue;

    const texts: { path: string; text: string }[] = [];
    for (const root of SEARCH_ROOTS) searchWalk(d[root], root, texts, 0);
    let docN = 0;
    for (const t of texts) {
      const lower = t.text.toLowerCase();
      let n = 0;
      let from = 0;
      for (;;) {
        const i = lower.indexOf(query, from);
        if (i < 0) break;
        n++;
        from = i + Math.max(1, query.length);
      }
      if (!n) continue;
      total += n;
      docN++;
      matchedEntries++;
      if (hits.length < limit && docN <= perDoc) {
        hits.push({
          id,
          at: Number(d['createdAt'] ?? 0),
          mode: dMode,
          theory: dTheory,
          level: dLevel,
          sec: t.path.split(/[.[]/)[0],
          path: t.path,
          snippet: snippetOf(t.text, query),
          n,
        });
      }
    }
    if (docN > 0) docTotal++;
  }
  return { ok: true, total, docTotal, capped: hits.length < matchedEntries, hits };
}

function injectWorkbenchData(win: BrowserWindow): void {
  const data = buildWorkbenchData();
  const payload = JSON.stringify(data).replace(/</g, '\\u003c');
  const script = data.report
    ? `window.__wbApply && window.__wbApply(${payload});`
    : `var e=document.getElementById('wbSource');if(e)e.textContent='v2 · 本机暂无存档';`;
  win.webContents.executeJavaScript(script).catch(() => {
    // @allow-silent: 工作台是附加视图；注入失败时界面顶栏仍写着「样张数据」，
    // 不会把内嵌样例冒充成本机存档。主窗口的分析功能不受影响。
  });
}

function openWorkbench(): void {
  if (workbenchWindow && !workbenchWindow.isDestroyed()) {
    // 「回去分析文本」会把工作台藏起来而不是销毁，这里必须能把它重新显示，
    // 否则用户再点「▦ 工作台」会毫无反应。
    /* 主窗口刚跑完一份或删掉一份：藏起来的工作台里还是旧快照，重新注入再显示。 */
    if (workbenchDirty) injectWorkbenchData(workbenchWindow);
    if (!workbenchWindow.isVisible()) workbenchWindow.show();
    if (workbenchWindow.isMinimized()) workbenchWindow.restore();
    workbenchWindow.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    title: '论证镜 · 工作台',
    backgroundColor: '#1c1c1e',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  workbenchWindow = win;
  win.on('closed', () => {
    if (workbenchWindow === win) workbenchWindow = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });
  win.webContents.on('dom-ready', () => injectWorkbenchData(win));
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });
  win.loadFile(join(__dirname, '../renderer/workbench.html'));
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
    async (
      event,
      passage: string,
      theory: TheoryId,
      mode?: AnalysisMode,
      parentId?: string | null,
      brief?: unknown,
      divergence?: unknown
    ) => {
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
          { mode, parentId, signal: ctl.signal, brief, divergence }
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
          markWorkbenchDirty();
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
  /*
   * 第三个出口：画布工程（.prg）。前两个带走的是一份文件，这一个带走的是
   * 「可以自己摆」——节点和线都在，位置只是草稿，用户在画布工具里重排。
   * 它同样不重算任何判定：节点文本逐字来自报告，线只来自 supports / targetId。
   */
  ipcMain.handle('report:exportPrg', (e, d: Diagnosis) => exportReportPrg(BrowserWindow.fromWebContents(e.sender), d));
  /*
   * 「拿走之后还能拿回来」的三条：
   *   · 复制：不落盘，贴到聊天窗口或自己的稿子里；
   *   · 打开 / 定位：只认本次运行真的导出过的那几个路径（report-export 里那份名单）。
   * 三条都只读报告、不改报告，也不改写任何判定。
   */
  ipcMain.handle('report:copyMarkdown', (_e, d: Diagnosis) => copyReportMarkdown(d));
  ipcMain.handle('report:openSaved', (_e, path: string) => openExported(typeof path === 'string' ? path : ''));
  ipcMain.handle('report:revealSaved', (_e, path: string) => revealExported(typeof path === 'string' ? path : ''));
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
  /*
   * 存档体检与单份探测：两条都是纯读，不删、不修、不写盘。
   * 与 archive:get 分开是因为 get 的返回值（报告或 null）被 smoke 当独立真值用，
   * 不能为了带上一句原因就改它的形状。
   */
  ipcMain.handle('archive:health', () => archiveHealth());
  ipcMain.handle('archive:probe', (_e, id: string) => probeReport(typeof id === 'string' ? id : ''));
  ipcMain.handle('archive:remove', (_e, id: string) => {
    markWorkbenchDirty();
    return removeReport(id);
  });
  ipcMain.handle('archive:reveal', () => shell.openPath(archiveDirPath()));
  /*
   * 存档检索：按字面在原文与报告正文里找。
   *
   * 纯读：不写盘、不改索引、不调模型。它出错时最坏也只是「搜不出来」，
   * 不会让任何一份报告变样——这一点与 `remove` 相反，所以两者不能共用一条通道。
   */
  ipcMain.handle('archive:find', (_e, q: string) => findReports(typeof q === 'string' ? q : ''));
  /*
   * 「这段文字跑过没有」。
   *
   * 放在主进程是因为原文只在这里——渲染层手里只有摘要。
   * 它不写盘、不改账本、不调模型，是纯读：这样它出错时最坏也只是这一行字不出现，
   * 不会影响分析与记账。
   */
  ipcMain.handle('archive:sameness', (_e, text: string) =>
    samenessOf(typeof text === 'string' ? text : '', allPassages())
  );
  /*
   * 样本账：这台机器上跑过几种不同的文字。
   *
   * 与 sameness 同属「纯读」，但多一样东西：读不出来的文件数要一起回去。
   * 少读一个文件不会报错，只会让「本机 103 份报告」这句听起来完整——
   * 而它不完整。这类错没有别的症状，所以只能把计数显式带上。
   */
  ipcMain.handle('archive:portfolio', () => {
    const scan = passageScan();
    return { view: portfolioOf(scan.items, scan.badFiles), dirError: scan.dirError };
  });

  /*
   * 同题复跑：同一版提示词、同一段字、同一个模式跑过多遍时，报告每次一样吗。
   *
   * 与样本账同一次目录扫描口径（坏文件计数也共用），但要看整份报告，
   * 所以走 reportScan。这里只回算好的视图：103 份报告约 1.2MB，
   * 没必要把全文丢进渲染层再算一遍，而且那样渲染层就得知道报告 schema。
   */
  ipcMain.handle('archive:agreement', () => {
    const scan = reportScan();
    return { view: agreementOf(scan.items, scan.badFiles), dirError: scan.dirError };
  });

  /*
   * 深查发现库：把历次深查的发现汇总成一份可以跨报告看的账。
   *
   * 与 agreement 同一次目录扫描口径：纯读、不写盘、不调模型。
   * 坏文件数必须一起回去——少读一份不会报错，只会让「我在哪些地方反复漏」
   * 这个结论建立在一份不完整的样本上，而界面看起来完全正常。
   */
  ipcMain.handle('archive:deep', () => {
    const scan = reportScan();
    /*
     * reportScan 的 item 是「给对照用的摘要」（at / report），不是 Diagnosis。
     * 发现库要的是报告本体里的 deep 栏，所以从 item.report 里取回整份报告；
     * 摘要里没有 id 以外的字段也没关系——report 是 {...d} 去掉 raw 的副本。
     */
    const reports = scan.items
      .map((x) => (x.report && typeof x.report === 'object' ? (x.report as Diagnosis) : null))
      .filter((x): x is Diagnosis => !!x);
    return { view: collectDeepFindings(reports), dirError: scan.dirError, badFiles: scan.badFiles };
  });

  /*
   * 同一段文字，六副透镜各盯住了哪里。
   *
   * 纯读：只比较原文（空白归一后逐字相同）与模式，每副透镜取最近一份报告。
   * 把当前这份一起传回来，是因为它可能刚跑完、还没被下一轮目录扫描读到；
   * 没有它，读者会看到一份比自己屏幕上更旧的「同一副透镜」。
   */
  ipcMain.handle('archive:cross', (_e, current: Diagnosis) => {
    const scan = reportScan();
    const report = current && typeof current === 'object' ? current : undefined;
    return {
      view: crossLensOf(report?.passage ?? '', report?.mode ?? '', scan.items, report),
      dirError: scan.dirError,
      badFiles: scan.badFiles,
    };
  });

  /*
   * 「看完报告之后，你下一句想说什么」。
   *
   * 三件事都返回整份账，界面拿返回值直接替换状态——不另取一次，
   * 避免出现「刚记上、显示的还是一分钟前的数目」。
   *
   * 写失败一律翻成 ok:false + 原因：这一句要是没写进去，用户必须当场知道。
   * 它不像报告，丢了还能重跑——这句话只在那一刻存在。
   */
  ipcMain.handle('nextlines:list', () => listNextLines());
  ipcMain.handle('nextlines:add', (_e, input: NextLineInput) => {
    try {
      return { ok: true, view: addNextLine(input) };
    } catch (err) {
      return { ok: false, view: listNextLines(), error: (err as Error)?.message ?? '这句话没能写进文件。' };
    }
  });
  ipcMain.handle('nextlines:remove', (_e, id: string) => {
    try {
      return { ok: true, view: removeNextLine(String(id ?? '')) };
    } catch (err) {
      return { ok: false, view: listNextLines(), error: (err as Error)?.message ?? '这句话没能从文件里删掉。' };
    }
  });

  /*
   * 长文台账：只存索引，不复制报告。
   *
   * 写失败一律翻成 ok:false + 原因：台账是「这 N 份报告来自同一篇文章」的唯一凭据，
   * 没写进去而界面照常显示，用户下次从历史里点开第 3 段时会发现它孤零零的，
   * 而那时已经没有任何东西能说明它属于哪一批。
   */
  ipcMain.handle('longform:save', (_e, ledger: unknown) => saveLedger(ledger));
  /* 按报告 id 反查台账：用户从历史里点开某一段的报告时，整批的账要跟着回来。 */
  ipcMain.handle('longform:ofReport', (_e, reportId: string) => ledgerOfReport(String(reportId ?? '')));
  ipcMain.handle('longform:reveal', () => shell.openPath(longformDirPath()));

  // 提示词可读，是这个产品必须满足的一条：用户有权看到自己被什么标准在衡量
  ipcMain.handle('prompt:get', (_e, theory: TheoryId, mode?: AnalysisMode) => {    const t = isTheoryId(theory) ? theory : DEFAULT_THEORY;
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

  ipcMain.handle('workbench:open', () => {
    openWorkbench();
    return { ok: true };
  });
  ipcMain.handle('workbench:refresh', () => {
    if (workbenchWindow && !workbenchWindow.isDestroyed()) injectWorkbenchData(workbenchWindow);
    return { ok: true };
  });
  /*
   * 按 id 取一份历史报告全文。id 必须在存档索引里——不接路径、不拼文件名，
   * 工作台拿不到存档目录之外的东西。缓存里没有这份（例如刚跑完一份新报告）时
   * 先重建一次，别让用户先去点刷新才看得见自己的新报告。
   */
  ipcMain.handle('workbench:report', (_e, id: string) => {
    if (workbenchDirty || !workbenchDocs.some((d) => String(d['id']) === id)) buildWorkbenchData();
    const row = workbenchDocs.find((d) => String(d['id']) === id);
    if (!row) return { ok: false, error: '这份存档不在本机索引里，点右上角「刷新存档」再试。' };
    const cid = workbenchPairs[id];
    const cmp = cid ? (workbenchDocs.find((d) => String(d['id']) === cid) ?? row) : row;
    return { ok: true, report: row, compare: cmp };
  });
  /*
   * 跨报告全文检索。检索前先对一次索引的 id 集合：刚跑完一份新报告，
   * 或刚删掉一份，缓存还是旧的，直接搜会给出「本机没有」的假结论。
   * 参数只有关键词和三个枚举过滤，不含路径，也不写任何东西。
   */
  ipcMain.handle('workbench:search', (_e, q: unknown, filter: unknown) => {
    try {
      const key = listReports().map((m) => String(m.id)).sort().join('|');
      if (workbenchDirty || key !== workbenchCacheKey || !workbenchDocs.length) buildWorkbenchData();
      const f = filter && typeof filter === 'object' ? (filter as Record<string, unknown>) : {};
      return searchArchive(typeof q === 'string' ? q : '', f);
    } catch (err) {
      return { ok: false, error: String(err), total: 0, docTotal: 0, capped: false, hits: [] };
    }
  });
  ipcMain.handle('workbench:back', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      /*
       * 「回去」不只是换个窗口：把光标放进原文输入框，用户落回来就知道下一步做什么。
       * 这里只做 DOM 聚焦，不写值、不触发分析、不花钱。
       */
      mainWindow.webContents.executeJavaScript(`(function(){
        var t=document.querySelector('.composer textarea')||document.querySelector('textarea');
        if(t){t.focus();t.scrollIntoView({block:'center'});}
      })();`).catch(() => {
        // @allow-silent: 聚焦失败不影响切回主界面；主窗口的导入/分析按钮仍可用。
      });
    } else {
      createWindow();
    }
    // 藏起来而不是关掉：再开时保留当前标签与滚动位置，也不留一个空窗口在任务栏。
    if (workbenchWindow && !workbenchWindow.isDestroyed()) workbenchWindow.hide();
    return { ok: true };
  });
}


app.whenReady().then(() => {
  registerIpc();
  createWindow();
  if (mainWindow) attachSmoke(mainWindow);

  /*
   * 启动默认只开原诊断界面 —— 那里才能粘贴文本、发起分析。
   * 工作台是「回看已存档报告」的第二窗口，由右下角「▦ 工作台」或
   * Ctrl+Shift+W 按需打开。之前自动弹出并置前，会把用户熟悉的操作路径挡住，
   * 打开就面对一张不能干活的字段表；这条已按实测反馈撤回。
   */

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
