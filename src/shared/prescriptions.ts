/**
 * 处方：从「这一环空着」到「要填什么形状的东西」。
 *
 * 这个工具一直缺最后一段。它说「CQ2 未答」，然后就没有下文了——
 * 用户拿到一句准确的诊断，还得自己把它翻译成动作。诊断到处方之间那一步，
 * 过去全靠用户走。
 *
 * 为什么不用模型：这一步不需要判断，只需要映射。检查项已经说清了缺哪一环，
 * 而「这一环要填什么形状」由那一环的名字决定，不由文本内容决定。
 * 交给模型做会花 token、会不稳定，还会让本来确定的东西变成一次猜测。
 * 全部由已落盘字段本地推导——与 limits.ts、topics.ts 同一套做法。
 *
 * 三条硬约束，写在这里是为了将来改代码时看得见：
 *
 *   1. 处方只给问法，不给答案。「补一句过渡句」是建议，「除了这个原因还有什么能解释
 *      同一现象」是问题。前者替用户思考了，后者把这一步还给他。
 *
 *   2. 每条处方都必须可被证伪。验收标准指向具体的检查项 id：补完之后它应当从
 *      「未答」变成「过」。这件事由 compare.ts 的 resolved 自动核对——
 *      没变，就说明补的不是这一环要的东西。做不到这一点的处方只是安慰。
 *
 *   3. 处方不承诺救得回来。有些环补上了也没用（前提本身是假的），
 *      所以每条都带一句「不改的代价」，并在档位判到「不成立」时明说：
 *      这不是补结构能解决的问题。
 */

import type { CheckItem, Diagnosis } from './types';
import { MODE_META, normalizeMode } from './types';

/* ───────────────── 一 · 位置 ───────────────── */

/**
 * 问题落在论证的哪个位置。
 *
 * 按位置聚合，而不是按检查项平铺罗列，是这一栏与检查表唯一实质的区别：
 * 五条未答的 CQ 如果全指向同一处，那是**一个**问题，不是五个。
 * 平铺着看，用户会以为要改五遍；按位置看，他只需要动一处。
 *
 * 四个位置借自图尔敏的分层（依据／担保／主张／反驳），
 * 但这里不声称那是唯一分法——它只是本工具唯一有的那把尺子的刻度。
 */
export type RxSite = 'ground' | 'bridge' | 'claim' | 'opposition';

export interface RxItem {
  /** 挂在哪条检查项上。补完之后它应当变 passed——这是验收，不是修辞。 */
  checkId: string;
  /** 检查项的显示名，如「CQ2 因果方向」 */
  checkLabel: string;
  /** 空到什么程度：文中没交代（未答），还是交代了但不成立（明确没过） */
  state: 'unanswered' | 'violated';
  /** 缺的是哪一环。照录检查项的 guards——它来自本地静态表，不是模型自由发挥 */
  ring: string;
  /** 要填什么形状的内容。是问法，不是答案。 */
  need: string;
  /** 验收：补完之后什么算过了。由 compare.ts 自动核对。 */
  accept: string;
  /** 不改的代价。这一句才是处方与安慰的分界。 */
  cost: string;
}

export interface RxGroup {
  site: RxSite;
  title: string;
  /** 为什么问题集中在这一处。一句话，不写套话。 */
  gist: string;
  items: RxItem[];
}

export interface PrescriptionView {
  groups: RxGroup[];
  /** 无法给处方时说清为什么。空数组必须带理由——空着不解释才是最糟的一种。 */
  emptyReason: string | null;
  /** 处方条数（不含 missingPremise 那条） */
  total: number;
  /** 缺的前提。报告里本来就有这一栏，这里只说明它要满足什么才算够。 */
  missingPremise: { text: string; accept: string; cost: string } | null;
}

/* ───────────────── 二 · 这一环属于哪一类 ───────────────── */

/**
 * 环的语义类型。
 *
 * guards 是四十来个高度领域化的短语（「威胁的现实性」「替代假说的穷尽度」），
 * 逐条写文案会写出四十多条套话，而且改一处漏三处。所以按语义归成八类，
 * 每类给一个问法模板，具体名词用 guards 原词补进去。
 *
 * 归类靠关键词，是启发式的。这一点必须承认：分类可能错，
 * 但错法的代价很小——问法偏了，用户仍然能看懂那一环缺的是什么，
 * 因为 ring 那一栏写的是原词。
 */
type RingKind =
  | 'causal'
  | 'fact'
  | 'evidence'
  | 'compare'
  | 'condition'
  | 'source'
  | 'definition'
  | 'opposition'
  | 'other';

const RING_RULES: { kind: RingKind; re: RegExp }[] = [
  { kind: 'causal', re: /因果|相关|联结|原因|干扰|排他/ },
  { kind: 'source', re: /来源|引述|可信|可及|忠实|准确|说话人/ },
  { kind: 'evidence', re: /证据|样本|代表|概括|搜索|充分|共识|汇聚|充分性/ },
  { kind: 'compare', re: /比较|可比|权衡|效率|差异|优先/ },
  { kind: 'condition', re: /可行性|必要性|排他|有效性|适用性|现实性|成立|边界/ },
  { kind: 'opposition', re: /反例|反驳|对方|例外|异议|反类比|先例/ },
  { kind: 'definition', re: /定义|归类|中立|征兆/ },
  { kind: 'fact', re: /事实|真实性|承诺|不一致|品性|征兆/ },
];

function ringKind(guards: string): RingKind {
  for (const r of RING_RULES) if (r.re.test(guards)) return r.kind;
  return 'other';
}

/**
 * 每一类要填什么形状。全部写成问句。
 *
 * 「形状」这个词是刻意的：它说的是**该给出一份什么样的材料**，
 * 不是**该得出什么结论**。给出频率、给出处、给反例——这些都是可核的；
 * 「说得更有说服力」不是。
 */
const NEED: Record<RingKind, string> = {
  causal:
    '除了这一个原因，还有什么能解释同一个现象？如果两件事总是同时出现、但前者并不是后者的原因，那会是什么样子？',
  fact: '这一事实本身有没有出处？谁在场、什么时候、有没有记录或数据？如果只是转述，原话是怎么说的？',
  evidence:
    '凭现在这些材料下这个结论够不够？覆盖到谁、多少人、有没有反例？要搜到什么程度才算搜过了？',
  compare: '跟什么比？按哪个指标比？好处和代价分别由谁承担——不是抽象的「社会」，是具体哪一群人。',
  condition:
    '这一步在什么条件下成立？有没有别的路也能达到同一目的？如果有第二条路，排他性是从哪来的？',
  source: '这个说法出自哪里，是原文还是转述？说话的人在这件事上有没有资格、有没有利害关系？',
  definition:
    '这里用的词和对方用的是同一个意思吗？边界画在哪——哪些情形算在内，哪些不算？换一种归类，结论还成立吗？',
  opposition:
    '如果对方举出这个反例，这套说法还成立吗？不成立的那一部分，要不要先把范围收窄，再谈剩下的？',
  other: '这一环现在是空的。要补它，先得能正面回答下面这个问题。',
};

/* ───────────────── 三 · 检查项归到哪个位置 ───────────────── */

/**
 * 检查项守着论证的哪一处。
 *
 * 优先用编号前缀（toulmin 的 T-warrant、ars 的 P1-relevance 这些自带位置），
 * 拿不到再退回按 guards 的语义判。两者都失败就归到 bridge——
 * 担保是型式法里最常出问题的一处，也是所有 CQ 默认在问的那一处。
 * 这个兜底可能把某条归错，但归错位置只会让分组标题偏一点，
 * 不会让处方本身变成假话。
 */
function siteOf(c: CheckItem): RxSite {
  const id = c.id.toLowerCase();
  if (/warrant|backing|bridge/.test(id)) return 'bridge';
  if (/ground|premise/.test(id)) return 'ground';
  if (/claim|conclusion/.test(id)) return 'claim';
  if (/rebuttal|refut/.test(id)) return 'opposition';

  const k = ringKind(c.guards);
  if (k === 'causal' || k === 'condition' || k === 'definition') return 'bridge';
  if (k === 'fact' || k === 'evidence' || k === 'source') return 'ground';
  if (k === 'compare') return 'claim';
  if (k === 'opposition') return 'opposition';
  return 'bridge';
}

const SITE_META: Record<RxSite, { title: string; gist: string }> = {
  bridge: {
    title: '从依据走到结论的那一步',
    gist: '这一步是论证里最容易空着的地方：两句话都真，但它们之间靠什么连起来，往往没人说。事实可以全部为真，结论仍然落不下来——差的就是这一处。',
  },
  ground: {
    title: '依据本身',
    gist: '结论搭在这些材料上。材料本身站不住，上面的结构再整齐也没用——而这一类的毛病通常不是「错」，是「没说清它从哪来」。',
  },
  claim: {
    title: '结论的强度与范围',
    gist: '结论说得比材料撑得住的更大。这一处的问题很少靠补材料解决，改法通常是把它收窄到材料真能覆盖的那一片。',
  },
  opposition: {
    title: '对手方与例外',
    gist: '如果对方举出一个反例就能推翻，那这套说法现在还没有处理过反驳。这一处要么先答，要么先把范围划出来。',
  },
};

/* ───────────────── 四 · 不改的代价 ───────────────── */

/**
 * 这一环空着，代价是什么。
 *
 * 三档的说法必须分开，因为它们是三种严重程度：
 * 论证不成立（结论未必假）、结论被反驳（比前者重得多）、以及没有实质击败。
 * 混成一句「论证可能有问题」会把最重的那一档盖掉。
 */
function costOf(d: Diagnosis): string {
  const mode = normalizeMode(d.mode);
  if (!MODE_META[mode].givesVerdict) {
    return `本次是${MODE_META[mode].label}模式，不给档位。这一环空着不构成「不好」的判断——它只说明结构上缺一块，补不补都不影响这段文本作为文本成立。`;
  }
  if (d.defeat.kind === 'none') {
    return '本次没有实质击败。这一环空着，不改变档位——但对方一旦从这里下手，你手上没有现成的答复。';
  }
  if (d.verdict.whatIsRefuted === 'conclusion') {
    return '这一环空了，而判读到「结论被反驳」——这比论证不成立重得多。补结构救不回来，需要正面证据，或者把结论撤回。';
  }
  return '论证的这一步仍然空着。结论不必因此放弃，但它现在是一句主张，不是被支撑的结论——两者的区别在别人追问时才会显出来。';
}

/* ───────────────── 五 · 组装 ───────────────── */

/** 验收标准：一句话，指回具体的检查项。这句是处方能被证伪的地方。 */
function acceptOf(c: CheckItem): string {
  return `补上之后，${c.id}（${c.label}）应当从「未答」变成「过」。改完重跑一次，对照栏会自动核对——没变，就说明补的不是这一环要的东西。`;
}

/**
 * 缺的前提。
 *
 * 报告里 100% 都会给出这一栏（真实账上 86/86），所以它不是「有时有」的补充。
 * 但原文只给一句候选前提，没说它要满足什么才算够——那正是这里补的：
 * 一句前提能填上这一环，当且仅当它本身还能被独立支持。
 */
function missingPremiseOf(d: Diagnosis): PrescriptionView['missingPremise'] {
  const text = d.repair.missingPremise?.trim();
  if (!text) return null;
  const hasCheck = d.checks.find((c) => c.answer !== 'passed' && c.answer !== 'not-applicable');
  return {
    text,
    accept: hasCheck
      ? `把这句话补进原文之后，${hasCheck.id}（${hasCheck.label}）应当能答「过」。但前提本身也会被要求有支持——补完它，下一轮它会变成新的依据，然后被问同样的问题。`
      : '把这句话补进原文之后，重跑一次，看未答的检查项有没有减少。',
    cost: '不补的话，结论和依据之间那一步始终由读者替你补——而读者补进去的，往往不是你想的那个。',
  };
}

export function prescriptionsOf(d: Diagnosis): PrescriptionView {
  const cost = costOf(d);

  /* 范围门没过：这里没有「补」这回事，只有「换一副尺子」。 */
  if (!d.scope.applicable) {
    return {
      groups: [],
      emptyReason: `本次判定这副透镜不适用（${d.scope.reason || '未说明理由'}）。不适用不是「有问题」，所以这里不列处方——拿着不合适的尺子去改文本，改出来的是迎合尺子的东西，不是更好的论证。${
        d.scope.outOfScopeAt ? `具体卡在：${d.scope.outOfScopeAt}。` : ''
      }`,
      total: 0,
      missingPremise: null,
    };
  }

  const open = d.checks.filter((c) => c.answer === 'unanswered' || c.answer === 'violated');
  const mp = missingPremiseOf(d);

  if (!open.length) {
    return {
      groups: [],
      emptyReason:
        '所有检查项都答上了。这一栏空着是结论，不是遗漏——没有可补的地方，就不编一条出来。下一步不是改文本，是换一副透镜看同一段话还成不成立。',
      total: 0,
      missingPremise: mp,
    };
  }

  const bySite = new Map<RxSite, RxItem[]>();
  for (const c of open) {
    const site = siteOf(c);
    const item: RxItem = {
      checkId: c.id,
      checkLabel: c.label,
      state: c.answer === 'violated' ? 'violated' : 'unanswered',
      ring: c.guards || c.question,
      need: NEED[ringKind(c.guards || c.question)],
      accept: acceptOf(c),
      cost:
        c.answer === 'violated'
          ? '这一处不是「没说」，是说了但不成立。它不会因为补得更多而变好——要么改掉它，要么承认结论撑不到这么远。'
          : cost,
    };
    const list = bySite.get(site);
    if (list) list.push(item);
    else bySite.set(site, [item]);
  }

  /*
   * 顺序固定：桥 → 依据 → 结论 → 对手方。
   * 不按条数排、不按严重度排，因为严重度在这里不可比——
   * 「威胁的现实性没交代」和「样本不具代表性」哪个更严重，取决于文本想干什么，
   * 而那是用户的事。给一个假装中立的排序，比不给更误导。
   */
  const ORDER: RxSite[] = ['bridge', 'ground', 'claim', 'opposition'];
  const groups: RxGroup[] = [];
  for (const site of ORDER) {
    const items = bySite.get(site);
    if (!items?.length) continue;
    groups.push({ site, ...SITE_META[site], items });
  }

  return { groups, emptyReason: null, total: open.length, missingPremise: mp };
}
