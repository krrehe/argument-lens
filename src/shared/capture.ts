/**
 * 「按了快捷键，这段字要不要进输入框」——一个可以直接断言的判断。
 *
 * 为什么值得单独一层：
 *
 * 全局快捷键最坏的行为不是「没反应」，是**悄悄把框里的字换掉**。
 * 用户写了二十分钟的一段话，按了一下快捷键（本来只是想叫出窗口），
 * 回来发现里面是剪贴板上一句别人的微博——这种事不会报错，只会让人不敢再用。
 *
 * 所以这里不做「一按就填」，而是先分级：能直接填的、要问一声的、干脆不填的。
 * 三条分支都是纯函数，`check:capture` 全部覆盖；界面只负责把结论画出来。
 *
 * 这一层不认识 Electron：它不读剪贴板、不注册快捷键、不问平台。
 * 读剪贴板在主进程（`src/main/capture.ts`），名字取哪个键也在那里。
 */

/**
 * 快捷键。
 *
 * 用 CommandOrControl：同一个字符串在 Windows 上是 Ctrl、在 macOS 上是 ⌘。
 * 放在这里而不是各写一份，是因为「注册的键」和「界面上写给人看的键」
 * 必须是同一个——写岔了，人按的键永远没反应，而代码里找不到任何错。
 */
export const CAPTURE_ACCELERATOR = 'CommandOrControl+Alt+A';

/**
 * 剪贴板最多收多少字。
 *
 * 12000：一篇社论一两千字，一篇论文整章也就这个量级。
 * 再多基本就是整本 PDF 或整页网页——喂进去是花钱买一段被截断的分析，
 * 而且模型多半会在中段丢线索，给出一个「看起来很有条理」的空话。
 *
 * 超限**不截断**。截断等于替人改了他的原文，而报告里每条判定都带原文引文，
 * 引文对不上原文，比不给分析更坏。超限就明说没填，让他自己选一段。
 */
export const MAX_CAPTURE_CHARS = 12000;

/**
 * 快捷键的注册结果。
 *
 * 放在 shared 层而不是主进程里，是因为两个进程都要用它：主进程填这个结构，
 * 渲染层读它决定「提示条该说按哪个键」还是「该说这个键被占了」。
 * 两份结构各写一遍，字段名会分叉，而分叉之后界面会静默少显示一句话。
 */
export interface CaptureStatus {
  /** 注册用的原始 accelerator（CommandOrControl+Alt+A） */
  accelerator: string;
  /** 写给人看的（Ctrl+Alt+A / ⌘+⌥+A） */
  human: string;
  registered: boolean;
  /** 没注册上的原因；注册上了是 null */
  reason: string | null;
}

export type CaptureDecision =
  /**
   * 不填。note 是给用户看的一句话，不是日志。
   *
   * `quiet` 决定这句话要不要显示：
   * - 剪贴板空、超长 → 要说（他按了键，什么都没发生，会以为键坏了）；
   * - 框里已经是这段 → 不说（多半是他连按了两下，弹一句「已经是这段」纯属干扰）。
   */
  | { kind: 'ignore'; note: string; quiet: boolean }
  /** 直接填。note 说明它从哪来，避免「框里的字怎么变了」。 */
  | { kind: 'fill'; text: string; note: string }
  /** 问一声。text 是候选，只有用户点了「用它」才写进框。 */
  | { kind: 'ask'; text: string; note: string; chars: number };

export interface CaptureInput {
  /** 输入框里现在有什么（原样，不 trim）。 */
  current: string;
  /** 剪贴板里读到什么（原样）。 */
  clip: string;
  /** 框里现在这坨是不是某一段示例——示例被真实文本换掉是它的用途，不用问。 */
  currentIsSample: boolean;
}

/**
 * 判断一次「捕获」该怎么落地。
 *
 * 顺序有讲究，四条判据互相不能颠倒：
 * - 先看剪贴板有没有东西：没有就别打扰，连提示都不给。
 * - 再看长度：超限要**先说不要**，不能先问「要不要用它」——
 *   问了再拒绝，等于让人白点一次。
 * - 再看是不是同一段：一样就不填，也不提示（他会以为自己没按成功）。
 * - 最后才看框里：空的直接填；示例直接换；自己的字，一律问。
 */
export function decideCapture(i: CaptureInput): CaptureDecision {
  const clip = i.clip;
  if (clip.trim() === '') {
    return { kind: 'ignore', note: '剪贴板里没有文字。', quiet: false };
  }
  if (clip.length > MAX_CAPTURE_CHARS) {
    return {
      kind: 'ignore',
      quiet: false,
      note: `剪贴板里这段有 ${clip.length} 字，超过 ${MAX_CAPTURE_CHARS} 字的上限，没有填进来。整篇贴进来会得到一份中段丢线索的分析；先在里面选一段再按一次。`,
    };
  }
  if (clip.trim() === i.current.trim()) {
    return { kind: 'ignore', note: '框里已经是这段文字。', quiet: true };
  }
  if (i.current.trim() === '') {
    return { kind: 'fill', text: clip, note: '已从剪贴板填入。' };
  }
  if (i.currentIsSample) {
    return { kind: 'fill', text: clip, note: '已用剪贴板里的文字换掉了示例。' };
  }
  return {
    kind: 'ask',
    text: clip,
    chars: clip.length,
    note: `框里是你写的字，没有覆盖。用这 ${clip.length} 字替换？`,
  };
}

/**
 * 把 accelerator 说成人话。
 *
 * 界面上必须写出「按哪个键」，否则这个功能等于不存在——没人会去翻文档找一个
 * 面板里没提过的快捷键。而写在界面上的字必须和注册的那个字符串同源，
 * 所以由这里从 CAPTURE_ACCELERATOR 推出来，而不是在 JSX 里另抄一份。
 *
 * platform 从外面传：这一层不读 process，才能在 node 里对三个平台都断言。
 */
export function humanizeAccelerator(acc: string, platform: 'win32' | 'darwin' | 'linux'): string {
  const mac = platform === 'darwin';
  return acc
    .split('+')
    .map((k) => {
      if (k === 'CommandOrControl' || k === 'CmdOrCtrl') return mac ? '⌘' : 'Ctrl';
      if (k === 'Command' || k === 'Cmd') return mac ? '⌘' : 'Ctrl';
      if (k === 'Control' || k === 'Ctrl') return mac ? '⌃' : 'Ctrl';
      if (k === 'Alt') return mac ? '⌥' : 'Alt';
      if (k === 'Shift') return mac ? '⇧' : 'Shift';
      return k;
    })
    .join('+');
}
