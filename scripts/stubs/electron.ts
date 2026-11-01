/**
 * electron 的最小替身。
 *
 * 只服务于脚本：契约检查要在 node 里跑，而 analyze.ts 链路上的 store/usage
 * 会在模块顶层 `import { app } from 'electron'`。electron 包在非 electron 进程里
 * 导出的是一个字符串（可执行文件路径），ESM 具名导入会直接报
 * "does not provide an export named 'app'"——打包期过了，运行期才炸。
 *
 * 这里只提供被调用到的那几个方法，且 getPath 指向临时目录：
 * 契约检查不该碰真实的用户数据目录，碰了就等于测试有副作用。
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = join(tmpdir(), 'argument-lens-contract');

export const app = {
  getPath: () => dir,
  getName: () => 'argument-lens',
  getVersion: () => '0.0.0',
  isPackaged: false,
  quit: () => {},
  on: () => {},
  whenReady: () => Promise.resolve(),
};

export const dialog = {
  showSaveDialog: async () => ({ canceled: true, filePath: '' }),
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  showMessageBox: async () => ({ response: 0 }),
};

export const shell = {
  openPath: async () => '',
  openExternal: async () => {},
  showItemInFolder: () => {},
};

export const ipcMain = {
  handle: () => {},
  on: () => {},
  removeHandler: () => {},
};

export const contextBridge = {
  exposeInMainWorld: () => {},
};

export const BrowserWindow = class {
  constructor() {}
  loadFile() {}
  on() {}
  once() {}
  webContents = { on: () => {}, send: () => {} };
};

export const nativeTheme = { shouldUseDarkColors: false, on: () => {} };

/**
 * 加密存储替身。
 * 不加密——脚本里没有真 Key 要保护，而一旦真去调 safeStorage，
 * 在没初始化 GUI 的进程里会直接崩。
 */
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s: string) => Buffer.from(s, 'utf8'),
  decryptString: (b: Buffer) => b.toString('utf8'),
};
export const screen = { getPrimaryDisplay: () => ({ workAreaSize: { width: 1440, height: 900 } }) };
