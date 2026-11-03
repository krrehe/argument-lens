/**
 * 「这段文字你跑过没有」——字面重合度。
 *
 * 起因是一组真实数字：102 份报告里，128 字那段跑了 89 次，另有两版改稿各跑 8 次与 1 次，
 * 合起来 98 份报告落在同一段早读上。软件在这件事上一句话都没说，照常计费、照常出报告。
 * 于是「试过多少种文本」这件事只能靠人自己记，而人就记不住。
 *
 * 为什么不是哈希：哈希只能认出逐字相同的那 89 份，认不出那 9 份改稿——
 * 而改稿恰恰是「想再试一次」的样子（加一句、删一句）。所以要比相似度。
 *
 * 为什么是字符二元组而不是词：中文没有空格分词，分词器又各有口径。
 * 二元组不需要词典，也不会因为切分歧义把两段一样的文字判成不同的。
 *
 * 它量的是**字面**，不是**论证**。同一段话换个说法重写，这里会判成不重合——
 * 这是对的：字面不重合就说字面不重合，不能拿字面去猜「这是不是同一个论点」。
 * 那件事只有模型能做，而模型每次都换说法，不能用来当判据。
 */

/**
 * 判定为「几乎同一段」的下限。
 *
 * 0.85 不是估的：真实存档里那段早读 128 字，加了两句变成 157 字（+23% 长度），
 * 实测重合度 0.897。阈值若定 0.9，这 8 份改稿会被判成「不同的文本」，
 * 界面就会说「跑过 89 次」——而真相是 97 份落在同一段话上。
 * 一句比事实更自信的话，比不说话更糟。
 *
 * 反过来讲清它的盲区：二元组被改一个字打断两条，所以短文本改几个字掉得很快。
 * 60 字的段落改 5 个字约掉到 0.83，这里会判成「不同」。这是字面度量的上限，
 * 不是 bug——不能拿它去猜「这是不是同一个论点」。
 */
export const NEAR_SAME = 0.85;

/**
 * 低于这个数就不提了——「和某份有 12% 像」是噪音，不是信息。
 *
 * 0.4 是拿真实存档里 6 段文本对出来的：同源的删节版是 0.404–0.475，
 * 不同源的两段是 0.26。6 段太少，不足以说这个数放之四海皆准；
 * 它是个可调常量，断言只锁「边界行为」，不锁「这个数对一切文本都合适」。
 */
export const WORTH_MENTION = 0.4;

export interface PriorPassage {
  id: string;
  at: number;
  passage: string;
}

export interface Closest {
  id: string;
  at: number;
  /** 0–1 的字面重合度 */
  share: number;
  /** 那份的字数，用来解释「为什么 93% 不是 100%」 */
  chars: number;
}

export interface Sameness {
  /** 规范化后逐字相同的份数 */
  exact: number;
  /** 字面重合 ≥ NEAR_SAME 的份数（含 exact 那些） */
  near: number;
  /** 最像的那一份；没有可比对象时 null */
  closest: Closest | null;
}

/**
 * 规范化：只做两件事——去掉首尾空白、把连续空白压成一个空格。
 *
 * 不动标点、不转全半角、不忽略大小写。每一种「顺手」的归一化都在替用户判断
 * 两段文字是不是同一段：全角逗号换半角之后，「他说『对』」和「他说"对"」会合并，
 * 而那是两段不同的原文，报告里的引文要能对回去。
 */
export function normalizePassage(s: string): string {
  return s.replace(/^\uFEFF/, '').replace(/\s+/g, ' ').trim();
}

/**
 * 字符二元组的多重集。
 *
 * 用多重集而不是集合：一段里反复出现的片段应当比只出现一次的更有分量，
 * 否则「的的的的」这种文本会和任何正常句子都有很高的重合。
 */
export function bigrams(s: string): Map<string, number> {
  const t = normalizePassage(s).replace(/ /g, '');
  const out = new Map<string, number>();
  for (let i = 0; i + 1 < t.length; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** 多重集 Dice 系数：2·Σmin / (|A|+|B|)。空文本与任何东西的重合度记 0。 */
export function dice(a: Map<string, number>, b: Map<string, number>): number {
  let total = 0;
  for (const n of a.values()) total += n;
  for (const n of b.values()) total += n;
  if (total === 0) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let overlap = 0;
  for (const [g, n] of small) {
    const m = big.get(g);
    if (m) overlap += Math.min(n, m);
  }
  return (2 * overlap) / total;
}

/**
 * 与已有报告比一遍。
 *
 * 两段文本都只有一两个字时（「你行你上」），二元组太少，重合度会剧烈跳动：
 * 四个字和五个字共享三个二元组，算出来 0.67，看起来「有一大半相同」。
 * 所以短文本只认逐字相同，不报相似度——报出来的数字会比事实更自信。
 */
export function samenessOf(
  current: string,
  priors: PriorPassage[],
  opts: { minBigrams?: number } = {}
): Sameness {
  const cur = normalizePassage(current);
  const minBigrams = opts.minBigrams ?? 12;
  const curGram = bigrams(cur);
  let curLen = 0;
  for (const n of curGram.values()) curLen += n;

  let exact = 0;
  let near = 0;
  let closest: Closest | null = null;

  for (const p of priors) {
    const prior = normalizePassage(p.passage);
    if (prior === cur) {
      exact++;
      near++;
      /*
       * 并列时取**最近**的那一份，不是目录里第一份。
       *
       * 89 份逐字相同，扫描顺序由文件系统决定；取第一个会告诉用户「最近 10-20」，
       * 而真正的最近一次可能是 11-01。日期是这句话里唯一的可核对信息，
       * 它错了，整句话就不可信了。
       */
      if (!closest || closest.share < 1 || p.at > closest.at) {
        closest = { id: p.id, at: p.at, share: 1, chars: prior.length };
      }
      continue;
    }
    if (curLen < minBigrams) continue;
    const g = bigrams(prior);
    let len = 0;
    for (const n of g.values()) len += n;
    if (len < minBigrams) continue;
    const share = dice(curGram, g);
    if (share >= NEAR_SAME) near++;
    if (!closest || share > closest.share || (share === closest.share && p.at > closest.at)) {
      closest = { id: p.id, at: p.at, share, chars: prior.length };
    }
  }

  // 「最像 0.42」这种数字不值得出现在界面上，不如不出现
  if (closest && closest.share < WORTH_MENTION && exact === 0 && near === 0) closest = null;
  return { exact, near, closest };
}

/** 数字说成人话。0.934 → 「93%」。 */
export function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/**
 * 摆给用户看的那一句话。**只陈述位置，不劝也不拦。**
 *
 * 不说「别重复跑」：重跑一次是合法的用法——同一段文字、同一副透镜跑两遍，
 * 差多少正是模型稳不稳的证据，那恰恰是这个项目缺的东西之一。
 * 所以这句话只回答「跑过没有」，跑不跑由人决定。
 *
 * fmt 由调用方给：shared 层不该知道本地时间怎么格式化。
 */
export function samenessLine(s: Sameness, fmt: (at: number) => string): string | null {
  const c = s.closest;
  if (!c) return null;
  if (s.exact > 0) {
    const tail = s.near > s.exact ? `，另有 ${s.near - s.exact} 份只差几个字` : '';
    /*
     * 「最近一次：」这四个字不能省。
     *
     * 省掉之后是「（最近 今天 13:19）」——两个时间副词叠在一起，读起来像病句。
     * fmt 给的是「今天 13:19」这种口语形式，前面必须有个名词把它接住。
     */
    return `这段文字已经跑过 ${s.exact} 次（最近一次：${fmt(c.at)}）${tail}。`;
  }
  if (c.share >= NEAR_SAME) {
    return `这段和 ${fmt(c.at)} 那份有 ${pct(c.share)} 相同（那份 ${c.chars} 字）。`;
  }
  return `这段和 ${fmt(c.at)} 那份有 ${pct(c.share)} 字面重合。`;
}
