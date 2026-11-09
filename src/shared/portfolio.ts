/**
 * 样本账：这台机器上到底试过几种文字。
 *
 * 起因是一句反馈——「感觉就像喂给 AI 一段提示词让它输出一点东西」。
 * 那句话里有一半是真的：报告里绝大多数文字逐字来自模型返回的 JSON。
 * 但有一件事是裸提示词、云端对话、任何在线工具都不可能知道的：
 * **你在这台机器上跑过几段不同的文字、同一段跑了多少遍。**
 * 它 100% 来自本地存档，一个字都不来自模型。
 *
 * 所以这一层只数事实，不评价：不写「样本太少」、不劝人换一段、不给分、
 * 不排优先级。读不出来的文件与原文为空的报告都单独数出来，不静默跳过——
 * 静默跳过会让「本机 103 份」这句听起来完整，而真相是 103 份里没算那些。
 *
 * 分组口径沿用 @shared/sameness：字符二元组 Dice ≥ NEAR_SAME 算同一组，
 * 短文本只认逐字相同。阈值怎么来的、盲区在哪，都写在那里，这里不重造一套。
 *
 * 贪心聚类的代表句是每一组里**最近**的那份。为了让输入顺序不影响结果，
 * 先按 (at 降序, id 字典序) 固定排序——文件系统给出的目录顺序不是事实，
 * 拿它当依据会让同一份存档在不同机器上读出不同的账。
 */
import { EXCERPT_LEN } from './excerpt';
import { NEAR_SAME, bigrams, dice, normalizePassage, type PriorPassage } from './sameness';

/**
 * 短文本守卫，与 samenessOf 的 minBigrams 同一个数。
 * 四个字和五个字共享三个二元组能算出 0.67，那个数字比事实更自信。
 */
const MIN_BIGRAMS = 12;

export interface PortfolioGroup {
  /** 第几组（1 起）。按每组最近一次的时间降序，不按份数排——排份数是在替人定优先级。 */
  index: number;
  size: number;
  /** 这一组最近一次的时间戳，等于代表句那一份的 at。 */
  at: number;
  /** 代表句的字数（规范化后）。 */
  chars: number;
  /** 代表句前若干字，逐字来自原文；不改写、不概括。 */
  excerpt: string;
  /** 原文比摘录长。界面据此补省略号，不在数据里造一个不属于原文的字。 */
  truncated: boolean;
  /** 组里每一份报告的 id，按时间降序。 */
  ids: string[];
}

export interface PortfolioView {
  /** 读得出来的报告份数（含原文为空的那些）。 */
  reports: number;
  /** 原文为空、没有参与分组的份数。 */
  blanks: number;
  /** 读不出来的报告文件数，由主进程给。 */
  badFiles: number;
  groups: number;
  largest: number;
  singletons: number;
  /** 最早 / 最晚一份的时间；一份都没有时 null，不拿 0 冒充日期。 */
  firstAt: number | null;
  lastAt: number | null;
  buckets: PortfolioGroup[];
}

interface Bucket {
  rep: string;
  gram: Map<string, number>;
  len: number;
  at: number;
  ids: string[];
}

function gramLen(g: Map<string, number>): number {
  let n = 0;
  for (const v of g.values()) n += v;
  return n;
}

/**
 * 把存档里的原文分堆。
 *
 * badFiles 从外面传，是因为这一层不许碰文件：它是纯函数，要能在 node 里单测。
 * 传进来的数只会原样出现在账上，不会被这一层「修正」成好看的值。
 */
export function portfolioOf(priors: PriorPassage[], badFiles = 0): PortfolioView {
  let bad = Number.isFinite(badFiles) && badFiles > 0 ? Math.floor(badFiles) : 0;

  const valid: PriorPassage[] = [];
  for (const p of priors) {
    if (typeof p?.passage !== 'string' || typeof p?.id !== 'string' || !Number.isFinite(p?.at)) {
      bad += 1;
      continue;
    }
    valid.push(p);
  }

  /*
   * 固定顺序。这两行不能省：省掉之后，同一组里「最近那份」会变成目录里第一份，
   * 而读目录的顺序由文件系统决定。日期是明细里唯一可核对的信息，它错了整块账就不可信。
   */
  const ordered = [...valid].sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const buckets: Bucket[] = [];
  let blanks = 0;
  let firstAt: number | null = null;
  let lastAt: number | null = null;

  for (const p of ordered) {
    if (firstAt === null || p.at < firstAt) firstAt = p.at;
    if (lastAt === null || p.at > lastAt) lastAt = p.at;

    const rep = normalizePassage(p.passage);
    if (!rep) {
      blanks += 1;
      continue;
    }

    const gram = bigrams(rep);
    const len = gramLen(gram);
    let best = -1;
    let bestShare = -1;

    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (rep === b.rep) {
        best = i;
        bestShare = 1;
        break;
      }
      /* 短文本只认逐字相同，不拿几个二元组去算相似度。 */
      if (len < MIN_BIGRAMS || b.len < MIN_BIGRAMS) continue;
      const share = dice(gram, b.gram);
      /* 平手取先出现的组，也就是最近一次更晚的那组；不再引入第二个排序依据。 */
      if (share >= NEAR_SAME && share > bestShare) {
        best = i;
        bestShare = share;
      }
    }

    if (best >= 0) {
      buckets[best].ids.push(p.id);
    } else {
      buckets.push({ rep, gram, len, at: p.at, ids: [p.id] });
    }
  }

  const list: PortfolioGroup[] = buckets.map((b, i) => ({
    index: i + 1,
    size: b.ids.length,
    at: b.at,
    chars: b.rep.length,
    excerpt: b.rep.slice(0, EXCERPT_LEN),
    truncated: b.rep.length > EXCERPT_LEN,
    ids: b.ids,
  }));

  return {
    reports: valid.length,
    blanks,
    badFiles: bad,
    groups: list.length,
    largest: list.reduce((m, g) => Math.max(m, g.size), 0),
    singletons: list.filter((g) => g.size === 1).length,
    firstAt,
    lastAt,
    buckets: list,
  };
}

/**
 * 摆给用户看的那一行。**只陈述数目，不劝也不拦。**
 *
 * 不说「该换一段文字了」：重跑同一段是合法用法——同一段、同一副透镜跑两遍，
 * 差多少正是模型稳不稳的证据。这里只回答「你试过几种文字」，
 * 试不试新的由人决定。fmt 由调用方给：shared 层不该知道本地时间怎么格式化。
 */
export function portfolioLine(v: PortfolioView, fmt: (at: number) => string): string | null {
  if (v.reports === 0 && v.badFiles === 0) return null;
  const parts: string[] = [];
  if (v.reports === 0) {
    parts.push('本机还没有读得出来的报告。');
  } else {
    parts.push(
      `本机 ${v.reports} 份报告，落在 ${v.groups} 组不同的文字上；` +
        `最多的那组 ${v.largest} 份，只跑过一次的有 ${v.singletons} 组。`
    );
    if (v.firstAt !== null && v.lastAt !== null && v.firstAt !== v.lastAt) {
      parts.push(`时间从 ${fmt(v.firstAt)} 到 ${fmt(v.lastAt)}。`);
    }
  }
  if (v.blanks > 0) parts.push(`有 ${v.blanks} 份原文是空的，没有参与分组。`);
  if (v.badFiles > 0) parts.push(`另有 ${v.badFiles} 个报告文件读不出来，没有计入。`);
  return parts.join('');
}

/** 明细里的一行。文字只来自固定模板、时间与原文摘录。 */
export function groupLine(g: PortfolioGroup, fmt: (at: number) => string): string {
  return `第 ${g.index} 组 · ${g.size} 份 · 最近一次 ${fmt(g.at)} · ${g.excerpt}${g.truncated ? '…' : ''}`;
}

/**
 * 可复制的纯文本清单。没有表头以外的说明，没有结尾总结——
 * 加一句「综合来看」就把这一层变成了它最不该变成的东西：一份替人下判断的报告。
 */
export function portfolioText(v: PortfolioView, fmt: (at: number) => string): string {
  return [portfolioLine(v, fmt) ?? '本机还没有读得出来的报告。', '', ...v.buckets.map((g) => groupLine(g, fmt))].join(
    '\n'
  );
}
