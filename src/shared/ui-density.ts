/**
 * 阅读层级：界面默认收起哪些栏，以及这一收起不能越过哪三条线。
 *
 * 这一层只管**显示**。它不读报告、不改判定、不落盘、不碰提示词，也不碰导出：
 * 一份报告在「简洁」与「完整」下必须是同一份报告，改的只是屏幕上先看见哪几块。
 * 之所以要一份纯函数常量表，是因为「哪几栏算核对层」不能由界面随手写在
 * 十几个 className 里——那样检查器没法核对，改了一处另一处还留着旧的。
 *
 * 跑法：npm run check:density（已进 verify）
 */

export type Density = 'compact' | 'full';

/** 存本机的选择。只影响显示，与 `al:views` 同一类偏好。 */
export const DENSITY_STORAGE_KEY = 'al:density';

/** 真应用默认简洁：第一次打开不该先撞见二十几栏等权重的卡片。 */
export const DEFAULT_DENSITY: Density = 'compact';

/**
 * 预览页默认完整。
 * 预览页是整个仓库的截图基准，几十张既有截图都按「所有栏展开」拍的；
 * 换了默认会让旧截图集体失效，而 `?density=compact` 可以单独拍简洁态。
 */
export const PREVIEW_DENSITY: Density = 'full';

/** 读坏了、读到不认识的值，一律退回默认，不猜一个「看起来像」的模式。 */
export function normalizeDensity(v: unknown): Density {
  return v === 'full' ? 'full' : v === 'compact' ? 'compact' : DEFAULT_DENSITY;
}

/**
 * 主线：结论链本身。收起这些等于把报告正文藏了，所以它们**永远不能**进核对层。
 * 没有 id 的三块（原文 / 重构 / 下一步）也属主线，按「不在收起清单里」处理。
 */
export const CORE_SECTIONS = [
  'sec-structure',
  'sec-checks',
  'sec-verdict',
  'sec-legit',
  'sec-repair',
  'sec-defeat',
] as const;

/**
 * 核对层：默认收起，点标题或切「完整」即回原样。
 * 这些栏都是「回看、追溯、核对」用的，不是「这段话站不站得住」的正文；
 * 它们一栏不少地留在 DOM 里，只是不跟结论抢第一屏。
 *
 * `sec-lens` 是六块理论专用面板共用的 id，一并归这里：它们是按理论展开的
 * 补充视图，四句话与判读才是主线。
 */
export const LEDGER_SECTIONS = [
  'sec-flow',
  'sec-gaps',
  'sec-topics',
  'sec-academic',
  'sec-props',
  'sec-pivot',
  'sec-disputes',
  'sec-limits',
  'sec-context',
  'sec-lens',
  'sec-selfcheck',
  'sec-divergence',
  'sec-prompt-history',
] as const;

/** 少数栏没有 id（内容随数据出现），按标题归层。 */
export const LEDGER_TITLES = ['程序裁定'] as const;

/** 判定只按 id / 标题，不按数据现算：同一栏在两份报告里必须同等待遇。 */
export function isLedgerSection(id?: string, title?: string): boolean {
  if (id && (CORE_SECTIONS as readonly string[]).includes(id)) return false;
  if (id && (LEDGER_SECTIONS as readonly string[]).includes(id)) return true;
  return !!title && (LEDGER_TITLES as readonly string[]).includes(title);
}

/** 折叠块的展开键：有 id 用 id（目录「跳到」认识它），没有就用标题。 */
export function sectionKey(id?: string, title?: string): string {
  return id || title || 'unnamed';
}

/** 工具条上那句话。不写「已收起 N 栏」——实际渲染的栏随报告内容变，写死会说错。 */
export function densityLine(d: Density): string {
  return d === 'compact'
    ? '简洁 · 核对层默认收起，点栏名即展开；结论链一直展开着'
    : '完整 · 所有栏都展开，顺序不变';
}

/** 三条边界，一句不许少：收起只是显示层的事，不许被读成「报告少了内容」。 */
export const DENSITY_BOUNDS = [
  '收起的只是屏幕上的内容：报告、存档与导出的 Markdown 一个字不变。',
  '切到「完整」时一栏不少，顺序也不动；选择只存在本机。',
  '从四句话或「跳到」点进收起的栏，会自动展开那一栏。',
] as const;
