/**
 * 记账的两条判定规则，抽成纯函数。
 *
 * 为什么单独放一个文件：这两条规则原先埋在 `main/usage.ts` 里，
 * 而那个文件 import 了 electron，纯 Node 环境下跑不起来——
 * 于是它们的对错只能靠人读，改坏了不会有任何东西响。
 *
 * 抽出来之后 `scripts/check-usage.ts` 能直接断言：
 * 本地 Ollama 不会被当成模拟调用、用户填的价不会被内置价盖掉。
 * 这两条都写反过，而且写反了都不报错，只是数字变小或变大。
 */
import type { Pricing } from './types';
import { hasPrice } from './tokens';

/**
 * 内置参考价（人民币 / 百万 token）。
 *
 * 只解决一件事：新用户从没填过单价，面板就一直显示「未计价」——
 * 记了 60 万 token 却一分钱都不显示，人就没有花费感知。
 *
 * 三条自我约束：
 * - 只做默认值。用户填过价就一律不生效，绝不覆盖。
 * - 只收有把握的模型。不确定的宁可不写——报一个错价，比报「未计价」更坏。
 * - 估价与账单会有出入（缓存命中价、时段折扣、上下文长度都影响）。
 *   所以界面必须写明「内置参考价」，不能让人以为自己填过。
 *
 * 价格会变。改这里的同时要改 `docs/提示词工程.md` 里那张表，
 * 否则文档会开始比软件更自信。
 */
export const KNOWN_PRICES: Record<string, { inPerM: number; outPerM: number }> = {
  'deepseek-chat': { inPerM: 1, outPerM: 2 },
  'deepseek-reasoner': { inPerM: 4, outPerM: 8 },
};

/**
 * 这次用哪套价。
 *
 * 顺序不能反：用户填的永远优先，内置价只填空档、不参与竞争。
 * 每条记录按**它自己的模型**取价——用今天的全局价重算历史，
 * 等于拿现在的价改昨天的账。
 */
export function pickPricing(user: Pricing, model: string): Pricing {
  if (hasPrice(user)) return user;
  const known = KNOWN_PRICES[model];
  return known ? { ...user, ...known } : user;
}

/**
 * 这次调用是不是本地假模型的。
 *
 * 两条同时成立才算：回环地址 + 名字以 mock 开头。
 *
 * - 只看地址会误伤把 baseURL 指向本地 Ollama 的人：那是真模型，
 *   该记账，也该出现在用量里（虽然不花钱，但那是「不花钱」不是「没发生」）。
 * - 只看名字会误伤某个真叫 mock 的线上服务。
 *
 * 为什么必须在记账这一层拦：冒烟测试每次返回编好的 3200/1800 token，
 * 它们进了真账本之后，「本月 197 次」里有 115 次根本没发生过。
 * 账本一旦开始记没发生的事，就不再是账本。
 */
export function isMockCall(r: { model?: string; host?: string }): boolean {
  const loopback = /^(127\.|localhost|\[::1\]|::1)/i.test(r.host ?? '');
  return loopback && /^mock/i.test(r.model ?? '');
}
