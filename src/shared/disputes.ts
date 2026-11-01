import type { Diagnosis } from './types';

/**
 * 争议：这份分析里，哪些判断点在学界是真的「两派不一致」。
 *
 * 两种东西必须分开，混在一起就成了免责声明：
 *   - **不确定**（confidence 低）：我们没把握。这是本工具的能力问题。
 *   - **有争议**（dispute）：学理上真的没有共识，谁站哪边都说得通。这是学科的状况。
 * 所以这一栏不写「可能不准」，只写「两派各主张什么、各自代价是什么、本工具站哪边」。
 *
 * 写作纪律：
 *   1. 每一派都必须写出代价。只写主张不写代价的，是在替自己那一边说话。
 *   2. 站边要说明理由；站的那一边同样有代价，一并写出来。
 *   3. 人名与年份只用已核实过的（见 docs/理论支撑 的三档标注）。
 *      拿不准是谁说的，就写「常见反对」，不编引用。
 */

export type DisputeId =
  | 'scheme-id'
  | 'cq-force'
  | 'pragma-scope'
  | 'audience-relativity'
  | 'warrant-inference'
  | 'pta-formalize'
  | 'field-standard'
  | 'fourth-condition'
  | 'label-pluralism'
  | 'testimonial-injustice'
  | 'no-verdict';

export interface DisputeCamp {
  id: string;
  /** 也就是这一派的名字，四到六字 */
  name: string;
  /** 他们主张什么 */
  holds: string;
  /** 接受这一派的代价 */
  cost: string;
  /** 代表人物或文献，拿不准就不写 */
  who?: string;
}

export interface Dispute {
  id: DisputeId;
  /** 芯片上的短名 */
  short: string;
  /** 争的是什么，问句 */
  title: string;
  /** 这条争论跟「读这份报告的人」有什么关系 */
  stake: string;
  camps: DisputeCamp[];
  /** 本工具站哪一派，以及为什么 */
  stance: { camp: string; why: string };
  refs: string[];
}

export const DISPUTES: Dispute[] = [
  {
    id: 'scheme-id',
    short: '型式判定',
    title: '这段话到底属于哪个型式，认得准吗？',
    stake:
      '整份检查表都建立在「先认对型式」之上。型式如果认错，后面问的问题再严谨也是问错了人——所以这一栏要你看一眼它对不对，而不是默认它对。',
    camps: [
      {
        id: 'content',
        name: '按内容认',
        holds:
          '型式靠骨架、语境、结论类型一起辨认，不必先有形式判据。认得出就能用，认不出就写认不出。',
        cost: '没有形式判据，也没有配套的识别程序：换个人可能认成另一种型式，而两边都说得出理由。',
        who: 'Walton、Reed & Macagno 2008',
      },
      {
        id: 'formalize',
        name: '先形式化',
        holds:
          '认不出逻辑形式的文本，不该给它型式名。给名字只是贴了个无法检验的标签，反而挡住了追问。',
        cost: '日常话语几乎全部落空。工具会变成「什么都判不了」，这跟不给结论不是一回事，是给不出。',
        who: '做自动论证挖掘的一派',
      },
    ],
    stance: {
      camp: 'content',
      why:
        '型式名在本工具里是检索入口，不是结论：认不出就写 none，族可能认错就写出来，且不参与最后的判定档位。代价照认——型式这一层可靠性有限，检查表的分量全部压在「每条依据写不写得出来」上。',
    },
    refs: ['Walton, Reed & Macagno, Argumentation Schemes, CUP 2008', 'docs/理论支撑/03-型式的认识论.md'],
  },

  {
    id: 'cq-force',
    short: '未答的分量',
    title: '有一关没答上，算不算论证已经被打倒了？',
    stake:
      '检查表上「未答」和「未过」看起来只差一个字，分量差得很远。这一栏决定你该怎么用那一格。',
    camps: [
      {
        id: 'fail',
        name: '没答就算没过',
        holds:
          '举证责任在提出论证的一方。某条批判性问题没有被回答，这条担保就没有被建立，论证停在半路。',
        cost: '沉默被当成了认输。很多文本只是没写全，不是写不出来——把它们一律算失败，批评就变便宜了。',
      },
      {
        id: 'undetermined',
        name: '没答只是未知',
        holds:
          '没有被问到不等于答不了。缺省状态应该是「未定」，要判失败得拿出「它确实不成立」的理由。',
        cost: '几乎所有日常论证都会变成「未定」。用户拿不到任何可用的判断，工具失去用处。',
      },
      {
        id: 'graded',
        name: '按「有没有被建立」分档',
        holds:
          '不问「算不算打倒」，问「这一环建立到什么程度」：未答是没建立，有据的违反才是被推翻。两者给不同的档。',
        cost: '分档本身要人判，界线上仍有模糊地带；而且三档比二档更难解释给外行。',
      },
    ],
    stance: {
      camp: 'graded',
      why:
        '未答只削弱联结，不否证结论；只有「有据的违反且未修补」才往上加一档。所以本工具绝大多数判定是 weakening，而不是 refutation——这不是手软，是把两种失败分开。',
    },
    refs: ['van Eemeren & Grootendorst 2004（举证责任与规则违反的区分）', 'docs/理论支撑/02-好论证凭什么.md'],
  },

  {
    id: 'pragma-scope',
    short: '适用域',
    title: '一段根本不想说服谁的话，还能用「解决分歧」的规则去判吗？',
    stake:
      '这套规则判的是「有没有妨碍分歧解决」，前提是说话的人确实在争一个分歧。前提不成立时，逐条判违规就成了冤枉——这一栏决定你看到的是判定，还是退场。',
    camps: [
      {
        id: 'strict',
        name: '严格限定',
        holds:
          '十条规则只适用于以解决分歧为目标的论辩。对广告、抒情、独白按这套规则判谬误，是范畴错误：它压根不在这个游戏里。',
        cost: '大量真实文本被排除在外。用户拿一段社论来问，工具答「不适用」，看起来像推脱。',
        who: 'van Eemeren & Grootendorst 2004',
      },
      {
        id: 'broad',
        name: '当普适标准用',
        holds:
          '这套规则描述的是一种理想的讨论方式，任何论证都可以拿它来对照，看离理想有多远。',
        cost: '把「没打算跟你讨论」当成犯规。批评变成要求所有话都按学术讨论的规矩说，这本身是一种越界。',
      },
    ],
    stance: {
      camp: 'strict',
      why:
        '所以「这段对话是不是以解决分歧为目标」是这副透镜的第一道闸：不成立就整副透镜退出（写「不适用」），而不是硬判出一堆违规。代价照认——退场的次数会比硬判多。',
    },
    refs: [
      'van Eemeren & Grootendorst, A Systematic Theory of Argumentation, CUP 2004',
      'docs/理论支撑/04-语境为什么会改变结论.md',
    ],
  },

  {
    id: 'audience-relativity',
    short: '受众相对',
    title: '「可接受」看受众，是不是等于没有客观标准？',
    stake:
      '如果可接受性只是「听众愿不愿意信」，那这份判定就只是一次民意调查，不该被当成批评。这条争论决定这一栏的话能不能拿去用。',
    camps: [
      {
        id: 'relative',
        name: '看受众就是相对',
        holds: '可接受性既然随受众变，就不存在跨受众的判准；谁信谁对，批评只是换了个人。',
        cost: '任何论证都无法被批评——只要它能找到一群信它的人。这条推论没人真的接受。',
      },
      {
        id: 'reasoned',
        name: '问的是「有没有理由」',
        holds:
          '可接受性问的是「有没有理由接受」，不是「愿不愿意接受」。受众是判定的参数之一，不是判定的主人。',
        cost: '「理由」的强弱仍要人判。给了受众就能改变结论，实际使用中很容易滑成「看人下菜」。',
        who: 'Johnson & Blair；SEP《Informal Logic》',
      },
    ],
    stance: {
      camp: 'reasoned',
      why:
        '受众与判定分开存：受众写在语境坐标里，判定写在自己的字段里，两者不互相顶替。所以这份报告会明说「在『谁』看来可接受」，而不是笼统说「可接受」。',
    },
    refs: ['Johnson & Blair, Logical Self-Defense', 'docs/理论支撑/02-好论证凭什么.md'],
  },

  {
    id: 'warrant-inference',
    short: '补出来的话',
    title: '补出来的那句「他没说出口的话」，凭什么算他的？',
    stake:
      '本工具会把原文没写的话补进结构里。补得对，是帮他补全；补得错，是替他立了一个他没主张的靶子，然后打赢它。',
    camps: [
      {
        id: 'must',
        name: '必须补',
        holds:
          '不补就评不了。任何从前提走到结论的步子都带着一条没说出口的规则，它是论证的一部分，不管作者有没有写下来。',
        cost: '补哪一条，取决于分析者怎么理解原文。补错了，整份批评打的是另一个人。',
        who: 'Toulmin 1958（warrant 的原始区分）',
      },
      {
        id: 'minimal',
        name: '只补到能站住为止',
        holds:
          '补全的限度是「让论证成为论证」，再多就是分析者的发明。补得越强，越容易把论证救活。',
        cost: '「刚好能站住」这条线在哪，没有判据；实际操作里它会跟着分析者想不想放过对方走。',
        who: 'Hitchcock 对 warrant 可操作性的质疑',
      },
    ],
    stance: {
      camp: 'must',
      why:
        '补，但一律标「推定」，并且必须写出那句形式固定的检验：「若不假定 X，则从 P 推不出 C」——写不出这句，就不许列成隐含前提。补出来的东西永远不进「原文说了什么」，只进「我推的」。',
    },
    refs: ['Toulmin, The Uses of Argument, CUP 1958', 'Hitchcock, "Toulmin\'s Warrants"'],
  },

  {
    id: 'pta-formalize',
    short: '能不能切',
    title: '没做过形式化整理的口语，能直接切成三个特征吗？',
    stake:
      '这副透镜靠三次小判断代替一次大分类。如果第一步（把它整理成可切分的句子）本身就要靠判断，那后面三次判断的可靠性都得跟着打折。',
    camps: [
      {
        id: 'first-formalize',
        name: '先重构再切',
        holds:
          '三个特征要求前提与结论都是完整命题。没整理过的口语（省略主语、反问、插入语）切不出干净的三特征，先形式化是前提。',
        cost: '整理本身是一次解释。整理错了，三个特征全对也没用——错误被藏在看不见的第一步里。',
        who: 'Wagemans（PTA）',
      },
      {
        id: 'surface',
        name: '直接读表层',
        holds: '多数论证的主谓与层级在表层就能看出来，为每段文本做形式化成本过高，实用上不划算。',
        cost: '遇到中文口语的省略句、无标记因果时，主谓切分会连带失真，而失真不会被标出来。',
      },
    ],
    stance: {
      camp: 'first-formalize',
      why:
        '所以这副透镜排在「重构」之后，并把中文口语的主谓切分列为已知风险：三个特征可以全部写「未定」，此时算透镜失效，而不是算「中性结论」。',
    },
    refs: ['Wagemans, "The Periodic Table of Arguments"', 'docs/理论支撑/03-型式的认识论.md'],
  },

  {
    id: 'field-standard',
    short: '够不够',
    title: '多强的证据才算够，谁定？',
    stake:
      '「不充分」是这份报告最常给的一档。但充分性没有通用阈值——不把门槛写出来，「不充分」就只是一句口气很硬的空话。',
    camps: [
      {
        id: 'field',
        name: '看领域',
        holds:
          '刑事、民事、政策讨论要求的强度本来就不同。同一份证据在一种场合够，在另一种不够，这不是矛盾。',
        cost: '每个领域都可以给自己定一个刚好过得去的标准，于是「不够充分」永远批评不到任何具体的领域。',
        who: 'Toulmin（场域依赖）',
      },
      {
        id: 'universal',
        name: '有通用门槛',
        holds: '若没有通用门槛，论证评估就退化成各说各话；至少要有一条能跨领域比高低的尺。',
        cost: '这条尺一定很粗。用它判细活，会把「证据类型不对」误判成「证据不够多」。',
      },
    ],
    stance: {
      camp: 'field',
      why:
        '但加一道硬要求：门槛必须先写出来（本工具里是 T₂ 一栏），再谈够不够。所以这份报告说「不够充分」时，前面一定有一句「按什么场合的要求」。没有那一句，这一档不成立。',
    },
    refs: ['Toulmin 1958 场域依赖与场域不变的区分', 'docs/理论支撑/02-好论证凭什么.md'],
  },

  {
    id: 'fourth-condition',
    short: '反证算不算',
    title: '三关全过，但对方有反证，这算好论证吗？',
    stake:
      '这一栏决定「结构没问题」和「结论可信」之间的距离有多远。两者被混成一个分数时，读者会以为过关就等于对。',
    camps: [
      {
        id: 'three',
        name: '三关就够',
        holds: '前提可接受、相干、足以支撑结论——三条都过就是好论证。反证属于结论真假的问题，不属于论证好坏的评判。',
        cost: '一个三关全过、但结论有反例的论证会被判成好论证。这对拿它去做决定的人是有害的。',
        who: 'Johnson & Blair（RSA 三标准）',
      },
      {
        id: 'four',
        name: '还要第四关',
        holds:
          '要加一条：没有未被回应的击败因素。存在明显反证而未被处理的论证，结构再漂亮也不是好论证。',
        cost: '第四关会污染「充分性」：补前提和找反证是两种完全不同的修补动作，混在一起就不知道该做什么。',
        who: 'Govier',
      },
    ],
    stance: {
      camp: 'four',
      why:
        '但不并进三标准，而是分开放在「击败」与「反驳」两栏。所以本报告里结构分和反证是两处，允许出现「三关都过，但结论已被反证」这种组合——这不是自相矛盾，是两个问题的两个答案。',
    },
    refs: ['Govier, A Practical Study of Argument（第四条件）', 'docs/理论支撑/02-好论证凭什么.md'],
  },

  {
    id: 'label-pluralism',
    short: '给不给名字',
    title: '同一个毛病有三个名字，该给哪个？',
    stake:
      '给名字很有说服力，也很容易变成扣帽子。这一栏决定你拿到的是「一个可以拿去说的判断」还是「一个听起来很重的词」。',
    camps: [
      {
        id: 'name',
        name: '必须给名字',
        holds:
          '名字是沟通的起点。没有名字，批评无法被记住、无法被引用，也无法在争论里指认对方做了什么。',
        cost: '名字一旦给出就会被当成判定。同一段话被叫成三个不同的名字时，讨论会变成争名字，而不是争道理。',
      },
      {
        id: 'no-name',
        name: '名字是负担',
        holds:
          '谬误的分类学本身仍在争议中，条目互相重叠。给名字会把一个尚有争议的分类固化成结论。',
        cost: '只描述不命名，批评就难传播。很多用户要的恰恰是那个词。',
        who: 'SEP《Fallacies》；IEP《Fallacies》',
      },
    ],
    stance: {
      camp: 'no-name',
      why:
        '给「候选」，不给判定：每条名字必须同时给出「什么时候其实合法」和「这条判断最可能错在哪」，三条不全就整条不显示。名字是末端注释，不参与档位。',
    },
    refs: ['SEP, Fallacies（SDF 三条件及其受质疑）', 'IEP, Fallacies（231 条名录与分类争议）'],
  },

  {
    id: 'testimonial-injustice',
    short: '可信度',
    title: '「他的话要打个折」，依据是什么？',
    stake:
      '这条争论管的是：本工具会不会把一段带偏见的文本，复述成一份看起来很中立的分析结论。',
    camps: [
      {
        id: 'deflate',
        name: '按条件打折',
        holds:
          '可信度可以按可核查的条件估：有没有利益冲突、专业对不对口、是不是转述。这些与身份无关。',
        cost: '条件清单永远列不全。列不全的部分，实践中就由身份特征悄悄补上，而且补的人不自知。',
      },
      {
        id: 'injustice',
        name: '身份折扣是不义',
        holds:
          '由身份偏见造成的可信度折扣，不是论证的缺陷，是听者的缺陷。它该被指出来，而不是被当成评估结果。',
        cost: '界线要求很细：因为他说错了、收了钱而打折，是正常评估，不算不义。划不清就会把正当质疑也挡掉。',
        who: 'Fricker 2007（identity-prejudicial credibility deficit）',
      },
    ],
    stance: {
      camp: 'injustice',
      why:
        '所以本工具强制分开：用具体条件打折，写进论证缺陷；用身份特征打折，写进「此处合法」——即「他这里没错，是听的人错了」。模型天然顺着文本语气走，不设这道闸，工具就会替偏见背书。',
    },
    refs: ['Fricker, Epistemic Injustice, OUP 2007, p.28', 'docs/理论支撑/05-谬误的自然史.md'],
  },

  {
    id: 'no-verdict',
    short: '不下结论',
    title: '拒绝给一个结论，是严谨还是逃避？',
    stake:
      '这份报告有时会给出「未定」。你可以把它读成诚实，也可以读成不负责任——两种读法都成立，区别在于它有没有说清折在哪一步。',
    camps: [
      {
        id: 'refuse',
        name: '宁可不说',
        holds: '没把握就写没把握。给一个错结论的害处，大于不给结论。',
        cost: '「未定」不可反驳，也不可用。它把判断的成本全部推回给用户，而用户来这儿就是为了少花这个成本。',
      },
      {
        id: 'demand',
        name: '必须给',
        holds: '用户要的是判断。工具的价值就在于替人下定决心，哪怕要承担出错的风险。',
        cost: '为了给结论而给结论，会逼着模型在证据不足处编一个理由——这是最坏的结果：错，而且看起来很有依据。',
      },
    ],
    stance: {
      camp: 'refuse',
      why:
        '但加一条硬义务：说「未定」必须同时说清折在哪一步、缺什么才能定。空白的「未定」不接受——那不是严谨，是没做完。',
    },
    refs: ['docs/理论支撑/06-机器能做什么.md（三档能力与三种界面义务）'],
  },
];

export const DISPUTE_BY_ID: Record<DisputeId, Dispute> = Object.fromEntries(
  DISPUTES.map((d) => [d.id, d])
) as Record<DisputeId, Dispute>;

/** 一次分析里被碰到的争议。because 是这一份的具体理由，不是通用说明。 */
export interface DisputeHit {
  id: DisputeId;
  because: string;
}

/**
 * 判断这次分析碰到了哪些争议。
 *
 * 全部由已经落定的字段推出，不调模型、不再花钱——
 * 争议是「这次结论涉及的学理分歧」，不是再一次生成。
 */
export function disputesIn(d: Diagnosis): DisputeHit[] {
  const hits: DisputeHit[] = [];
  const push = (id: DisputeId, because: string) => {
    if (!hits.some((h) => h.id === id)) hits.push({ id, because });
  };

  const unanswered = d.checks.filter((c) => c.answer === 'unanswered').length;
  const violated = d.checks.filter((c) => c.answer === 'violated').length;
  const implicit = [...d.premises, ...d.intermediate].filter((c) => c.implicit);

  // 型式：Walton 透镜下必然涉及。认不出与认得出，是这条争论的两面。
  if (d.lens.kind === 'walton') {
    push(
      'scheme-id',
      d.lens.schemeId === 'none'
        ? '这次没能把文本归入任何型式（写了 none）。这正是「按内容认」这一派被批评的地方：认不出的时候，工具说不清是文本不像，还是识别能力不够。'
        : `这次把它归到了「${d.lens.schemeName}」（${d.lens.schemeId}）。型式是按内容认的，没有形式判据——换一套判法可能归到别的型式，而后面整张检查表都建立在这个归类上。`
    );
  }

  // 语用辩证：这副透镜每次都要先判适用域，那条争论就压在这一次判定上。
  if (d.theory === 'pragma') {
    push(
      'pragma-scope',
      d.scope.applicable
        ? `这次判成了「适用」，也就是认定这段对话确实在争一个分歧（对话类型：${d.context.dialogueType}）。这条认定一旦不成立，下面按十条规则数出来的违规就全部作废——所以它写在最前面，也最该被质疑。`
        : '这次判成了「不适用」：这段文本不以解决分歧为目标。按另一派的看法，这一步就该直接开判——你看到的是退场，不是判决。'
    );
  }

  // PTA：三特征切得干不干净，取决于有没有先做形式化。
  if (d.theory === 'pta') {
    const undet = d.checks.filter((c) => c.answer === 'not-applicable' || c.answer === 'unanswered').length;
    push(
      'pta-formalize',
      undet > 0
        ? `这次有 ${undet} 项落在「未定／不适用」——多半是主谓切不干净。这正是「先重构再切」那一派说的：切不动的部分，不该硬给一个特征值。`
        : '这次三个特征都切出来了。请留意：切分本身建立在对原文的一次整理上，那一步不在检查表里，也不在置信度里。'
    );
  }

  // 未答 vs 未过：只要出现「未答」，这条争论就直接压在这次的结论上。
  if (unanswered > 0) {
    push(
      'cq-force',
      `这次有 ${unanswered} 项落在「未答」，${violated} 项是「有据的未过」。两者在检查表上只差一个字，分量差很远：前者是没建立，后者是被推翻。把前者的分量算高，这次判定就重了。`
    );
  }

  // 隐含前提：补了就得交代补的规矩。
  if (implicit.length > 0) {
    push(
      'warrant-inference',
      `这次补了 ${implicit.length} 条原文没说出口的话。它们全部标着「推定」——补哪一条取决于怎么读原文，换一种读法，被批评的可能就不是同一个论证了。`
    );
  }

  // 判定档：判了「不够」或「未定」，两条争论都直接相关。
  if (d.scope.applicable && (d.verdict.level === 'fails' || d.verdict.level === 'weakened')) {
    push(
      'field-standard',
      `这次的档位是「${d.verdict.level === 'fails' ? '不成立' : '被削弱'}」，意思是「不够」。而「够」的门槛随场合变——请先看判读那一栏的限定条件里写了按什么场合的要求。`
    );
  }

  if (!d.scope.applicable || d.verdict.level === 'undetermined') {
    push(
      'no-verdict',
      !d.scope.applicable
        ? '这次的判定是「不适用」而不是「没问题」：这副透镜的适用条件没有满足，工具选择退场，而不是硬判。'
        : '这次的档位是「未定」。请检查它有没有说清折在哪一步、缺什么才能定——说清了是诚实，没说清是没做完。'
    );
  }

  // 三关全过却仍有反证：Govier 那条第四条件的争论正好落在这里。
  if (d.defeat.kind !== 'none' && violated === 0) {
    push(
      'fourth-condition',
      `这次没有任何一条检查项被「有据地」违反，但仍然记下了击败（${d.defeat.kind === 'undermining' ? '削弱' : '反驳'}）。三标准全过而结论仍被反证——这正是「要不要加第四关」那条争论的现场。`
    );
  }

  // 可接受性：ARS 透镜下必然按某个受众判。
  if (d.theory === 'ars') {
    push(
      'audience-relativity',
      d.context.audience
        ? `这次的可接受性是按「${d.context.audience}」判的。换一群听众，同一条前提的判定可能变——所以这一栏的结论带着受众，不是无条件的。`
        : '这次没能确定受众。受众不定时，可接受性这一项本来就判不动——这是这条争论最实际的后果。'
    );
  }

  // 命名：给了两个以上名字，就已经在展示「分类不唯一」。
  if (d.labels.length >= 2) {
    push(
      'label-pluralism',
      `这次给了 ${d.labels.length} 个名字：${d.labels.map((l) => l.name).join('、')}。它们不互斥，也不构成判定——名字多了不是更有把握，是说明这段文本正好落在几种分类的交叉处。`
    );
  } else if (d.theory === 'copi') {
    push(
      'label-pluralism',
      '这一栏用的就是名录法，而名录法本身在学科内仍有争议。它给的是对照，不是判定。'
    );
  }

  // 可信度：碰到来源、利益、身份这一环，才需要这条闸。
  const credRe = /可信|证言|人身|利益|专业|来源|权威/;
  const credHit =
    d.labels.find((l) => credRe.test(`${l.name}${l.condition}${l.whenLegitimate}`)) ??
    d.legitimateMoves.find((m) => credRe.test(`${m.what}${m.why}`));
  if (credHit) {
    push(
      'testimonial-injustice',
      `这次碰到了「他的话能不能信」这一环（${
        'name' in credHit ? credHit.name : credHit.what.slice(0, 18)
      }）。判据必须是具体条件——利益冲突、专业不对口、转述失真；如果依据是身份特征，那是听者的缺陷，不是论证的缺陷。`
    );
  }

  // 稳定的显示顺序：按 DISPUTES 的定义顺序，不按触发先后。
  return DISPUTES.filter((x) => hits.some((h) => h.id === x.id)).map(
    (x) => hits.find((h) => h.id === x.id)!
  );
}

/** 争议与报告板块的对照：点得回去，才叫相辅相成。 */
export const DISPUTE_SECTION: Record<DisputeId, { id: string; label: string }> = {
  'scheme-id': { id: 'sec-checks', label: '逐关检查' },
  'cq-force': { id: 'sec-checks', label: '逐关检查' },
  'pragma-scope': { id: 'sec-context', label: '语境坐标' },
  'audience-relativity': { id: 'sec-context', label: '语境坐标' },
  'warrant-inference': { id: 'sec-structure', label: '结构图' },
  'pta-formalize': { id: 'sec-checks', label: '逐关检查' },
  'field-standard': { id: 'sec-verdict', label: '判读' },
  'fourth-condition': { id: 'sec-defeat', label: '击败' },
  'label-pluralism': { id: 'sec-labels', label: '命名候选' },
  'testimonial-injustice': { id: 'sec-legit', label: '此处合法' },
  'no-verdict': { id: 'sec-verdict', label: '判读' },
};
