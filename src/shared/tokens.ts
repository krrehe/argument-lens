/**
 * token 估算与计费。
 *
 * 为什么必须估算：OpenAI 兼容接口**不保证**返回 usage。Ollama 老版本、
 * 部分国内镜像、某些中间层代理都不给这个字段。没有 usage 的时候只有两个选择——
 * 不记，或者估。
 *
 * 不记等于让用户永远不知道花了多少，所以估。但估出来的数必须**自己承认是估的**：
 * 记录里带 estimated 标记，界面上带「估」字，聚合时单独统计估算占比。
 * 把估算和实测混成一个数字显示，是这类工具最容易犯的错——用户会拿它去对账，
 * 然后发现对不上，然后再也不信这里的任何数字。
 */

/** 中日韩文字与全角标点：这些字符的 token 密度远高于西文 */
const CJK =
  /[\u2e80-\u2eff\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/u;

/**
 * 粗估 token 数。
 *
 * 系数取经验值：中文约 1.5 字 / token，西文约 4 字符 / token。
 * 误差大概在 ±25% 以内——够用来回答「这次大约花了几分钱」，
 * 不够用来对账。对账要用接口返回的 usage，或者直接看供应商账单。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (CJK.test(ch)) cjk += 1;
    else other += 1;
  }
  return Math.max(1, Math.round(cjk / 1.5 + other / 4));
}

export interface PriceLike {
  /** 每百万输入 token 的单价 */
  inPerM: number;
  /** 每百万输出 token 的单价 */
  outPerM: number;
}

/**
 * 一次调用多少钱。
 *
 * 单价按「每百万 token」填，是因为供应商的价目表都这么写，
 * 用户抄数字时不会换算错。内部折算成单 token 再乘。
 */
export function costOf(promptTokens: number, completionTokens: number, p: PriceLike): number {
  const inP = Number.isFinite(p.inPerM) ? p.inPerM : 0;
  const outP = Number.isFinite(p.outPerM) ? p.outPerM : 0;
  if (!inP && !outP) return 0;
  return (promptTokens * inP + completionTokens * outP) / 1_000_000;
}

/** 有没有填过单价。两个都为 0 视为没填。 */
export function hasPrice(p: PriceLike | null | undefined): boolean {
  return !!p && (p.inPerM > 0 || p.outPerM > 0);
}

/**
 * 金额格式化。
 *
 * 单次分析的花费常在几厘到几毛之间，统一按两位小数会显示成「¥0.00」，
 * 用户会以为不花钱。所以小额给到四位，大额收到整数。
 */
export function formatMoney(n: number, currency = '¥'): string {
  if (!Number.isFinite(n) || n <= 0) return `${currency}0`;
  if (n < 0.01) return `${currency}${n.toFixed(4)}`;
  if (n < 1) return `${currency}${n.toFixed(3)}`;
  if (n < 1000) return `${currency}${n.toFixed(2)}`;
  return `${currency}${Math.round(n).toLocaleString('zh-CN')}`;
}

/** token 数格式化：过万折成「1.2 万」，表格里不撑破列宽 */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 10_000).toFixed(1)} 万`;
}

/** 相对时间：「刚刚」「12 分钟前」「昨天 14:03」「10-28」 */
export function formatAgo(at: number, now = Date.now()): string {
  const diff = now - at;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const today = new Date(now);
  const sameDay =
    d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  if (sameDay) return `今天 ${hh}:${mm}`;
  const yesterday = new Date(now - 86_400_000);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) return `昨天 ${hh}:${mm}`;
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hh}:${mm}`;
}

/** 本地日期键 YYYY-MM-DD。用本地时区，因为「今天花了多少」是人的概念，不是 UTC 的。 */
export function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 本地月份键 YYYY-MM，用于分文件 */
export function monthKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
