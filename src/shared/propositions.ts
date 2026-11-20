import type { Claim, ConfidenceLevel, Diagnosis, EpistemicTag } from './types';
import type { Ledger, LedgerColumn, LedgerRow } from './ledger';
import { BURDEN_LABEL, CONF_LABEL, TAG_LABEL } from './labels';

/**
 * 命题账：这份报告里的每一条命题，该由什么来定。
 *
 * 为什么要有这一栏：
 *
 * 一份报告读下来，读者面对的是八条、十条排得很整齐的命题，可它们**性质不同**，
 * 界面上却长得一模一样。有的能去查——原始统计口径、法条原文、重算那一步；
 * 有的现在谁都给不出证据；有的是价值与制度选择，论证再多也只能说明代价，
 * 不能把它判真判假。把这三样混在一张表里，最顺手的错答案就是：
 * 用「证据不足」去否掉一个「本来就不该由证据来定」的命题。
 *
 * 这不是新加一种判断，是把「价值不假扮事实裁」这句已经写进库里的话
 * 变成界面上看得见的一行。它只归类，不改 verdict、不改 acceptability、
 * 不改任何一个已有字段——本地推导，不调模型、不加 token。
 *
 * 三栏，不是四类：
 *
 * 早先这一栏按四组排，多出一组「框架·体系内成立」，理由是把它折进「不可裁」
 * 会把「只在体系里成立」说成「缺证据」。但知识库 01_立案层 A-03 与 04_裁决层 D-02
 * 用的是同一套三栏，且 A-03 五节写死「两册不得各造一套栏位名称」——
 * 本地多出一栏，账与流程就对不上号，位号一错，后面所有引用都错。
 *
 * 折法不是抹掉那一层：框架命题留在「事实·不可裁」，理由写成
 * 「缺的是把体系接到现实的那条桥接前提」，而不是「缺数据」。两句话都真，
 * 但只有后一句能被人拿材料推翻——这就是可复核与不可复核的差别。
 *
 * 三条硬边界：
 *
 *   1. 只按字面分。规范命题靠用词认（应当、不得、合理……），认不出的按事实处理，
 *      并写明「按用词未见规范词」——本地读不出语义，就不假装读得出。
 *   2. 不给分、不排序。这一栏没有「重要程度」，组顺序固定（能定的 → 定不了的 →
 *      不是这回事的），组内按报告顺序。
 *   3. 每行必须写「什么条件下改归另一类」。写不出改归条件的分类，
 *      和一句结论没有区别。
 *
 * 归栏只是本地读出来的那一栏；账上写什么由模型按 D-02 记（见 ledger.ts）。
 * 两边不一致时登记成分歧，不静默取一。
 */

/**
 * 可裁性。三个取值对应三种「该由什么来定」，不是一条刻度上的三档。
 *
 * 所以它不参与排序：把「规范·不由论证裁定」排在「事实·不可裁」下面，
 * 读起来就成了「更不可信」——那是把性质差别读成了程度差别。
 *
 * 类型直接取 D-02 的栏位名：两处共用一个名字，才谈得上「对得上号」。
 */
export type Decidability = LedgerColumn;

export const DECID_ORDER: readonly Decidability[] = [
  'fact-decidable',
  'fact-undecidable',
  'norm-undecidable',
] as const;

export const DECID_LABEL: Record<Decidability, string> = {
  'fact-decidable': '事实·可裁',
  'fact-undecidable': '事实·不可裁',
  'norm-undecidable': '规范·不可裁',
};

/** 一句话说清这一组是「什么在挡着」。给的是理由，不是标签释义。 */
export const DECID_GIST: Record<Decidability, string> = {
  'fact-decidable': '有门路核：去查哪份资料、回哪句原文、重算哪一步。这一组的对错能被证据推翻。',
  'fact-undecidable':
    '原则上能判真假，现在缺东西：可能是缺证据（谁去查哪份材料），也可能缺的是把它接到现实的那条前提（框架命题）。它不写「假」，只写缺什么、补齐后回哪一栏。',
  'norm-undecidable':
    '这是价值与制度选择。论证能说明它的后果与代价，不能把它判真判假；这一栏该给出的是一句条件式结论（若承认 X，则应 Y），不是真假。',
};

/**
 * 规范词。**长词在前**：先匹配到的就是最长的那个，
 * 否则「不合理」会被读成「合理」，「不应当」会被读成「应当」——意思正好反过来。
 */
const NORM_WORDS = [
  '应不应当',
  '该不该',
  '是否应当',
  '是否应该',
  '不应当',
  '不应该',
  '应否',
  '应当',
  '应该',
  '不应',
  '不该',
  '必须',
  '不得',
  '禁止',
  '严禁',
  '有权',
  '无权',
  '有资格',
  '无资格',
  '不合理',
  '不公平',
  '不正当',
  '不妥当',
  '不必要',
  '不值得',
  '不可取',
  '合理',
  '公平',
  '正当',
  '妥适',
  '妥当',
  '正义',
  '不义',
  '可耻',
  '值得',
  '可取',
  '优于',
  '劣于',
  '好过',
] as const;

/**
 * 评价性说法：**按词组认，不按单字认**。
 *
 * 「错误」「失败」这类词单独看太脏——「错误率」「失败率」是统计口径，不是价值判断；
 * 但「是错误决定」几乎不会出现在事实陈述里。所以这里只收搭配，不收单词。
 * 写在规范词表之前判：它们更长更具体，先命中才不会被「合理」这类词提前拦走。
 */
const NORM_PHRASES = [
  '错误决定',
  '是错的',
  '是错误的',
  '荒谬',
  '荒唐',
  '罪有应得',
  '太过分',
  '不可接受',
  '不该被',
] as const;

/**
 * 会被误读成规范词的说法，先抹掉再找。
 *
 * 「不得不承认」里有「不得」，「不得已」里有「不得」——它们说的是被迫，
 * 不是规范。不抹掉，每一句「不得不说」都会被归进「不由论证裁定」，
 * 而这一栏正是靠归类的准确性吃饭的。
 */
const NOT_NORM = ['不得不', '不得已', '不由得', '恨不得'] as const;

function normWordIn(text: string): string | null {
  let t = text;
  for (const w of NOT_NORM) t = t.split(w).join('＿'.repeat(w.length));
  for (const w of NORM_PHRASES) if (t.includes(w)) return w;
  for (const w of NORM_WORDS) if (t.includes(w)) return w;
  return null;
}

export interface PropositionRow {
  id: string;
  role: Claim['role'];
  roleLabel: string;
  text: string;
  /** 原文没有这句话，是补出来的前提 */
  implicit: boolean;
  decidability: Decidability;
  /** 本地凭什么这么归：命中的那个词、读到的标签与置信。不给依据的归类就是扣帽子。 */
  basis: string;
  /** 什么条件下改归另一类。空字符串在这一栏是不允许的（check:props 会红）。 */
  reclassifyIf: string;
  tag: EpistemicTag;
  confidence: ConfidenceLevel;
  status: Claim['acceptability']['status'];
  burden: Claim['burden'];
  /** 谁该去证。没分配就直说没分配——那本身就是缺陷。 */
  burdenWho: string;
  /**
   * 账上这一条（模型按 D-02 记的）。旧存档没有账，这里就是 null：
   * 界面照实说「没有记账」，不补一个「未决」——那是替模型宣布不判。
   */
  ledger: LedgerRow | null;
}

/**
 * A3 路由：这一段整体该用哪套标准量。
 *
 * 流程里这一步在立案阶段（A3），且写着「混合命题必须拆，不拆后面必然串账」。
 * 本工具不必让用户手选——账已经分好栏了，路由就是那个分配的直接结果。
 * 拆开之后两套标准并排走：事实按证据判真假，规范只判「辩护成不成立」。
 */
export type Route = 'fact' | 'norm' | 'mixed';

export interface PropositionView {
  rows: PropositionRow[];
  total: number;
  counts: Record<Decidability, number>;
  /** 总述一行。放在小节标题后面，让人先知道分布再看逐条。 */
  line: string;
  /** 补出来的前提有几条（它们最容易读着读着就当成了原文） */
  implicitCount: number;
  route: Route;
  /** 路由那句话：拆成几栏、各判什么。 */
  routeLine: string;
  /**
   * 账上的整份记录（含双向谬误筛查）。旧存档没有，界面照实说「没有记账」。
   * 这里只带引用，不改：状态值是模型的判决，本地只核记录。
   */
  ledger: Ledger | null;
}

const ROLE_LABEL: Record<Claim['role'], string> = {
  premise: '前提',
  intermediate: '中间结论',
  conclusion: '结论',
};

function burdenWho(b: Claim['burden']): string {
  switch (b) {
    case 'proponent':
      return '主张这条的人';
    case 'respondent':
      return '反对这条的人';
    case 'both':
      return '双方各自举证';
    default:
      /* 不清不是「两边都行」，是这一步没人做。照实说。 */
      return `未分配——${BURDEN_LABEL[b] ?? b}`;
  }
}

/**
 * 报告里已经落盘的一句判断：这条命题是不是价值/政策命题。
 *
 * 只在两处取，且都要求报告自己说过：
 *   - 实践论证透镜把**结论**判为 value 或 policy（前提那一栏是整组一个取值，
 *     分不到单条上，所以不用它——用它会变成替模型猜）；
 *   - 用词里出现规范词（由 normWordIn 独立判，见上）。
 *
 * 为什么不统一用「结论类型」：只有那一副透镜有这个字段。
 * 同一句话换副透镜、归类可能不同——账上按**本次这份报告已落盘的判断**走，
 * 并把依据写在行里。不是偷换口径，是把口径说出来。
 */
function lensSaysValue(d: Diagnosis, c: Claim): 'value' | 'policy' | null {
  const lens = d.lens;
  if (!lens || lens.kind !== 'pta') return null;
  if (c.role !== 'conclusion') return null;
  if (lens.conclusionType !== 'value' && lens.conclusionType !== 'policy') return null;
  return lens.conclusionType;
}

function decidabilityOf(d: Diagnosis, c: Claim): { kind: Decidability; basis: string } {
  const norm = normWordIn(c.text ?? '');
  const lensValue = lensSaysValue(d, c);
  const tag = c.acceptability.tag;
  const conf = c.acceptability.confidence;
  const tagText = `依据等级「${TAG_LABEL[tag] ?? tag}」`;
  const confText = `置信「${CONF_LABEL[conf] ?? conf}」`;

  if (norm || lensValue) {
    /*
     * 规范优先于「框架内」。一条命题可以同时是两样（「按这套理论应当先补前提」）：
     * 账上归到最挡路的那一层——规范命题拿去用证据判，是错得更彻底的一种；
     * 另一层不丢掉，写进依据里。
     */
    const what = lensValue === 'value' ? '价值命题' : '政策命题（该不该做）';
    const why = norm
      ? `按用词「${norm}」判为规范命题——它说的是「该怎样」，不是「是怎样」`
      : `本次透镜把结论判为${what}——它说的是「该怎样」，不是「是怎样」`;
    /* 两条线索各有各的来路：用词是本地读的，透镜判断是报告自己落盘的。
       两边都指向同一处时都说出来——一条依据被两个独立来源支持，比只说一个硬。 */
    const also: string[] = [];
    if (norm && lensValue) also.push(`本次透镜同样把结论判为${what}`);
    if (tag === 'framework') also.push('它同时只在所引的那套体系里成立，拿到现实里还差一步');
    return { kind: 'norm-undecidable', basis: why + also.map((x) => `；${x}`).join('') };
  }
  if (tag === 'framework') {
    /*
     * 框架命题：不是「缺数据」，是缺「把体系接到现实」的那条前提。
     * 两句话都归「事实·不可裁」，但只有后一句能被材料推翻——
     * 写成「证据不足」，读者会去翻资料；写成桥接前提，读者才知道要争的是哪一步。
     */
    return {
      kind: 'fact-undecidable',
      basis: `${tagText}——它的真假只在所引的那套体系里成立；要拿到现实里用，缺的是把体系接上现实的那条桥接前提，不是数据`,
    };
  }
  if (conf === 'undetermined' || tag === 'guess') {
    return {
      kind: 'fact-undecidable',
      basis: `${confText}、${tagText}——两边都没有可核的东西`,
    };
  }
  return {
    kind: 'fact-decidable',
    basis: `${tagText}、${confText}——有可核的门路`,
  };
}

/**
 * 改归条件。按「现在归在哪一类 + 依据是什么等级」写成一句可执行的话。
 *
 * 不写「可能有误差」那种套话：套话对每一条都成立，因此对哪一条都没用。
 */
function reclassifyIf(kind: Decidability, c: Claim): string {
  const where = '改归「事实·可裁」';
  switch (kind) {
    case 'norm-undecidable':
      return `把它换写成事实命题（这样做实际会造成什么后果），才进入可裁范围；本工具不替它换写`;
    case 'fact-undecidable':
      if (c.acceptability.tag === 'framework') {
        return `只有当承认这套体系能映射现实时，它才${where}；在此之前缺的是那条桥接前提，不是数据`;
      }
      return c.burden === 'unclear'
        ? `先定该谁举证，再由任一方给出可复现的证据；现在连这一步都没做`
        : `任一方给出可复现的证据即${where}——目前${burdenWho(c.burden)}还没给出`;
    default:
      switch (c.acceptability.tag) {
        case 'known':
          return `回原文或原始资料核一次；原文改口，这一条跟着改`;
        case 'computed':
          return `算法或输入一变就重算；这一处是算出来的，不是判出来的`;
        case 'inferred':
          return `机制被推翻或出现一个反例，即降为「事实·证据不足」`;
        case 'general':
          return `领域共识被专门研究推翻即改判；在此之前它靠的是共识，不是证据`;
        default:
          return `给出反例或原始资料，即改判`;
      }
  }
}

export function propositionsOf(d: Diagnosis): PropositionView {
  const counts: Record<Decidability, number> = {
    'fact-decidable': 0,
    'fact-undecidable': 0,
    'norm-undecidable': 0,
  };

  /* 账上按编号取：模型给的账与本地归的栏是两件事，行上并列放，界面各说各的。 */
  const ledgerOf = new Map<string, LedgerRow>();
  for (const r of d.ledger?.rows ?? []) {
    if (r?.at && !ledgerOf.has(r.at)) ledgerOf.set(r.at, r);
  }

  /* 顺序照报告：结论在前，然后前提、中间结论各按原顺序。
     同一组里保持这个次序，读者才能在账上认出正文里那一行。 */
  const all: Claim[] = [d.conclusion, ...(d.premises ?? []), ...(d.intermediate ?? [])].filter(
    (c): c is Claim => !!c && typeof c.id === 'string'
  );

  const rows: PropositionRow[] = [];
  const seen = new Set<string>();
  for (const c of all) {
    /* 同一个 id 出现两次只记一次：账上重复一行，计数就假了。 */
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const { kind, basis } = decidabilityOf(d, c);
    counts[kind] += 1;
    rows.push({
      id: c.id,
      role: c.role,
      roleLabel: ROLE_LABEL[c.role] ?? '主张',
      text: c.text,
      implicit: !!c.implicit,
      decidability: kind,
      /* 隐含前提要单独说明：原文里没有这句话，读者容易把它当成原文的一部分。 */
      basis: c.implicit ? `${basis}（这是补出来的前提，原文没有这句话）` : basis,
      reclassifyIf: reclassifyIf(kind, c),
      tag: c.acceptability.tag,
      confidence: c.acceptability.confidence,
      status: c.acceptability.status,
      burden: c.burden,
      burdenWho: burdenWho(c.burden),
      ledger: ledgerOf.get(c.id) ?? null,
    });
  }

  const total = rows.length;
  const line =
    total === 0
      ? '这份报告里没有可归账的命题'
      : `共 ${total} 条｜可裁 ${counts['fact-decidable']}｜不可裁 ${counts['fact-undecidable']}｜规范 ${counts['norm-undecidable']}`;

  const normCount = counts['norm-undecidable'];
  const factCount = total - normCount;
  const route: Route = total === 0 ? 'fact' : normCount === 0 ? 'fact' : factCount === 0 ? 'norm' : 'mixed';
  const routeLine =
    total === 0
      ? ''
      : route === 'fact'
        ? '纯事实：整段按证据判真假，不涉及价值选择'
        : route === 'norm'
          ? '纯规范：只判「支持它的辩护成不成立」，不判这条主张本身对不对'
          : `混合：拆成 ${factCount} 条按证据判真假 + ${normCount} 条只判辩护成不成立——两套标准并排走，不许互相转账`;

  return {
    rows,
    total,
    counts,
    line,
    implicitCount: rows.filter((r) => r.implicit).length,
    route,
    routeLine,
    ledger: d.ledger ?? null,
  };
}
