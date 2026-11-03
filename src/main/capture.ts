/**
 * 全局快捷键：把剪贴板里的那段字叫进窗口。
 *
 * 这个文件做的三件事，每一件都有个「不说出来就会变坏」的地方：
 *
 * 1. **注册**。`globalShortcut.register` 返回 false 是常态——那个键可能被输入法、
 *    截图工具、游戏助手占着。false 不报错、不抛异常，只是从此按了没反应。
 *    所以这里把结论存下来给界面，而不是 `if (!ok) return;`。
 *
 * 2. **读剪贴板**。这里只读、不写、不模拟按键。
 *    有人会想要「选中即分析」（在别的应用里选中一段字，按键就抓过来）。那需要
 *    模拟 Ctrl+C：要么引入原生按键库，要么借系统脚本。代价是它会在用户不知情的
 *    时候改动剪贴板、在部分应用里会触发「粘贴」副作用，而且没有可靠的办法在
 *    无人值守的环境里验证它真的抓到了。**宁可要一个确定的剪贴板，不要一个
 *    不确定的选中**——所以这里只认剪贴板，并且在界面上写清楚是剪贴板。
 *
 * 3. **不判断该不该填**。那件事在 `@shared/capture` 里，是纯函数，可断言。
 *    这里只负责「把候选交上去」，绝不直接改任何状态。
 */
import { BrowserWindow, clipboard, globalShortcut } from 'electron';
import { CAPTURE_ACCELERATOR, humanizeAccelerator, type CaptureStatus } from '@shared/capture';

let status: CaptureStatus = {
  accelerator: CAPTURE_ACCELERATOR,
  human: humanizeAccelerator(CAPTURE_ACCELERATOR, platformTag()),
  registered: false,
  reason: '还没有注册（应用还没启动完）',
};

function platformTag(): 'win32' | 'darwin' | 'linux' {
  if (process.platform === 'darwin') return 'darwin';
  if (process.platform === 'linux') return 'linux';
  return 'win32';
}

export function captureStatus(): CaptureStatus {
  return status;
}

/**
 * 把窗口叫到前台。
 *
 * 顺序有讲究：先还原、再显示、最后聚焦。反过来的话，最小化的窗口会被
 * `show()` 忽略（它已经「显示」着，只是在最小化状态），用户看到的是任务栏图标，
 * 于是以为没反应，再按一次——而第二次按下时框里已经是这段，判定成
 * 「已经是这段」静默不动。一次失败会变成两次沉默。
 */
function bringToFront(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

/**
 * 读一次剪贴板，把候选交给渲染层。
 *
 * `read` 只在自检里被替换。为什么不直接读系统剪贴板：端到端跑在开发机上，
 * 而剪贴板里可能存着用户刚复制的图片——写进去再「恢复」是恢复不了的
 * （`readText()` 读不到图片，写回一个空字符串等于把它删了）。
 * 所以探针注入一段固定的字符串：**跳过的是「读系统剪贴板」这一行，不是判定**。
 * 这一行没被自检跑过，交付时要写明。
 */
export async function deliverClipboard(
  win: BrowserWindow,
  /*
   * 两种返回都收：这个 Electron 版本的类型把 `clipboard.readText()` 标成 Promise，
   * 而运行时它是同步的。只写 `string` 会让 typecheck 红（类型说的和跑的差一层），
   * 只写 Promise 会让自检里传同步函数的地方多一层无谓的包装。
   */
  read: () => string | Promise<string> = () => clipboard.readText()
): Promise<void> {
  const text = await read();
  /*
   * 只发候选，不发结论：填不填由渲染层的 decideCapture 决定，主进程不越权。
   *
   * 启动那一两秒里按到也会发生：页面还没加载完，`send` 直接掉进虚空，
   * 用户看到的是「按了没反应」。所以加载中就等一帧再发。
   * 这不是兜底——真兜底失败（页面崩了）仍然什么都不发生，
   * 那种情况由 `render-process-gone` 记进冒烟日志。
   */
  const send = () => win.webContents.send('capture:offer', { text });
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
}

/**
 * 注册。返回最终状态，方便调用方在启动日志里留一行。
 *
 * `AL_CAPTURE_ACCELERATOR` 只给自检用：
 * - 设成 `off` → 不注册，用来验「没注册上时界面说的是实话」；
 * - 设成别的键 → 换一个键注册，避免自检与正在运行的真实应用抢同一个键
 *   （抢不到就是 false，那会把「注册失败」这条路径测成常态，反而测不出东西）。
 *
 * 生产环境没有这个变量，走 `CAPTURE_ACCELERATOR`。
 */
export function registerCapture(getWindow: () => BrowserWindow | null): CaptureStatus {
  const override = process.env['AL_CAPTURE_ACCELERATOR'];
  const acc = override === undefined ? CAPTURE_ACCELERATOR : override;
  const human = humanizeAccelerator(acc, platformTag());

  if (acc === '' || acc === 'off') {
    status = { accelerator: acc, human, registered: false, reason: '这个版本没有启用全局快捷键。' };
    return status;
  }

  try {
    const ok = globalShortcut.register(acc, () => {
      const win = getWindow();
      if (!win || win.isDestroyed()) return;
      bringToFront(win);
      /*
       * 不等它：读剪贴板失败也不该在快捷键回调里抛出去——那个回调没有地方接，
       * 抛了只会让 Electron 在主进程里留一条未处理拒绝，界面上什么都不显示。
       */
      void deliverClipboard(win).catch(() => {
        // @allow-silent: 读剪贴板抛错（权限、剪贴板被别的进程独占）时，快捷键回调里
        // 没有界面通道可用：这条回调不返回给渲染层，也不该为此弹系统对话框。
        // 唯一能做的是不让主进程挂掉。现象是「按了没反应」，这一条写在 README 的已知限制里。
      });
    });

    if (ok) {
      status = { accelerator: acc, human, registered: true, reason: null };
    } else {
      status = {
        accelerator: acc,
        human,
        registered: false,
        reason: `${human} 被别的程序占用了，没能注册。关掉占着它的程序（常见是截图工具、输入法快捷短语），或改设置里的键。`,
      };
    }
  } catch (e) {
    /*
     * 非法 accelerator 会抛，不会返回 false。
     *
     * 这条分支在生产里正常走不到（键是常量），但 `AL_CAPTURE_ACCELERATOR`
     * 能把它造出来——而「抛出来没人接」会让整个应用启动失败，
     * 只因为一个锦上添花的快捷键。所以这里接住，并变成一句人话。
     */
    status = {
      accelerator: acc,
      human,
      registered: false,
      reason: `这个快捷键写法认不出来（${acc}）：${(e as Error)?.message ?? '原因不明'}`,
    };
  }
  return status;
}

export function unregisterCapture(): void {
  globalShortcut.unregisterAll();
}
