import type { TheoryId } from './theories';

/**
 * 理论主张库。
 *
 * 为什么需要这一层：`docs/理论支撑/` 七编是散文，写给人读；`theory-notes.ts`
 * 是每副透镜一张卡，粒度太粗（一副透镜背后有七八条互不相同的主张）。
 * 结果是：报告里说「按 RSA 三标准」，用户再问「三标准本身凭什么」就断了。
 *
 * 这个库把七编拆成一条条可以单独指认、单独质疑的主张。每条必须回答三件事：
 *   1. 它说的是什么（claim，去术语，一句）
 *   2. 它凭什么（tier + refs）
 *   3. 它让本工具做了什么（decides，落到字段或行为）
 *
 * 第 3 条是硬要求。一条主张若指不出它在代码里改变了什么，它就不该进这个库——
 * 那是文档，不是理论基础。反过来说，代码里任何一条判定都应能在这里找到依据，
 * 找不到的地方就是理论没做实的地方。
 *
 * 三档标注与产品里的 tag 字段是同一套纪律：
 *   A 一手文献可核查（书名/篇名 + 年份，或原作者本人的明确限定）
 *   B 教材转述或学界通说（可靠但没核到原文）
 *   C 本工具的判断（可能是错的，写出来让人打）
 * 硬规矩：C 档不许标成 A 档。「研究表明」没有具体出处一律降到 C。
 */

export type EvidenceTier = 'A' | 'B' | 'C';

/**
 * 细分域：同一编里的主张按它回答的问题再分一层。
 *
 * 为什么需要第二根轴：编（1—7）是按「理论在回答什么」组织的，一份报告里
 * 同一个话题（比如举证责任）的主张散在第二、四两编里。用户在报告里看到
 * 「举证责任」四个字，想找的是**所有**关于举证责任的主张，而不是某一编的。
 * 专题分析（报告里的区块）也按这根轴取主张——sub 就是它和这个库之间的接口。
 *
 * 硬规矩：取值封闭。开放枚举会让筛选器变成一排只有一个条目的按钮。
 */
export type ClaimSub =
  /** 结构与重构：论证长什么样 */
  | 'structure'
  /** 判定与标准：站得住凭什么、档位怎么给 */
  | 'verdict'
  /** 举证责任：谁负责证明什么 */
  | 'burden'
  /** 语境与受众：换场合结论怎么变 */
  | 'context'
  /** 型式与透镜：六副透镜各自的认识论 */
  | 'scheme'
  /** 命名与谬误：给名字的条件与代价 */
  | 'naming'
  /** 模型边界：语言模型能干什么、不能干什么 */
  | 'machine'
  /** 可追溯与落地：版本、留痕、检查器 */
  | 'trace'
  /* ── 下面五个是批判性思维与人文方向（第八、九编）。与上面八域是同一根轴 ── */
  /** 技能与倾向：批判性思维由哪些能力与习惯构成 */
  | 'ct-skill'
  /** 思维标准：拿什么尺子量一个想法好不好 */
  | 'ct-standard'
  /** 修辞与听众：说服的三来源、普遍听众与特殊听众 */
  | 'rhetoric'
  /** 诠释与理解：前见、视域、言语行为、解释与说明之分 */
  | 'hermeneutic'
  /** 权力与位置：谁有资格说话、知识有没有立场 */
  | 'power'
  /* ── 下面一个是其他论证传统（第十编）。加它是因为 T9-08 自认「只有一套规范」，
         而「只有一套」这句话若不写出另一套长什么样，就只是句检讨 ── */
  /** 其他传统：墨家、名家、荀子、因明——它们怎么看待理由与论证 */
  | 'tradition'
  /* ── 下面六个是专题域，与报告里的「专题分析」区块一一对应 ── */
  /** 类比：相似性数量不决定强度，相关性才决定 */
  | 'topic-analogy'
  /** 因果与统计：默认条件是「没有别的因素」与「样本可靠」 */
  | 'topic-causal'
  /** 来源与权威：专家意见型式的四个默认条件 */
  | 'topic-source'
  /** 实践推理：替代方案与副作用，不是动机 */
  | 'topic-practical'
  /** 定义与含混：术语在推理中途换义 */
  | 'topic-definition'
  /** 预设与问句：问句可以夹带未经同意的假定 */
  | 'topic-presupposition';

export const SUB_LABEL: Record<ClaimSub, string> = {
  structure: '结构与重构',
  verdict: '判定与标准',
  burden: '举证责任',
  context: '语境与受众',
  scheme: '型式与透镜',
  naming: '命名与谬误',
  machine: '模型边界',
  trace: '可追溯与落地',
  'ct-skill': '技能与倾向',
  'ct-standard': '思维标准',
  rhetoric: '修辞与听众',
  hermeneutic: '诠释与理解',
  power: '权力与位置',
  // 标签取四字：六字的「其他论证传统」在条目行里会挤出容器（另外五个都是五字以内）。
  // 编名仍是「其他论证传统」，这里只是筛选与行内标记用的短名。
  tradition: '其他传统',
  'topic-analogy': '专题·类比',
  'topic-causal': '专题·因果与统计',
  'topic-source': '专题·来源与权威',
  'topic-practical': '专题·实践推理',
  'topic-definition': '专题·定义与含混',
  'topic-presupposition': '专题·预设与问句',
};

export interface TheoryClaim {
  /** 形如 T2-04：编-序号。序号在编内稳定，插入新条目时往后排，不改旧号。 */
  id: string;
  /** 所属编（1—7），对应 docs/理论支撑/ 下的文件序号 */
  book: number;
  /** 一句话主张。去术语，念给没上过逻辑课的人听也不别扭。 */
  claim: string;
  tier: EvidenceTier;
  /** 可核查出处。A 档必须有具体文献；C 档写「本工具的判断」并说明依据什么推的。 */
  refs: string[];
  /** 它让本工具做了什么决定。指到字段、行为或一条程序层裁决。 */
  decides: string;
  /** 谁反对它、反对什么。没有值得一提的反对就留空——不留空话。 */
  contested?: string;
  /** 影响哪几副透镜。省略表示全局（六副都受影响）。 */
  lens?: TheoryId[];
  /** 细分域。旧条目的取值集中在下面的 SUB_BY_ID 一张表里，新条目直接写在这里。 */
  sub?: ClaimSub;
}

export interface TheoryBook {
  n: number;
  title: string;
  /** 这一编回答的问题 */
  asks: string;
  /** 对应的文档文件 */
  doc: string;
  /**
   * 工程判断编：这一编说的是「本工具做了什么决定」，不是文献结论。
   * 整编 C 档因此是合法的——check:theory 认这个标记。
   * 不标它却整编 C 档，等于把工程判断摆在文献编的排场上。
   */
  engineering?: boolean;
}

export const THEORY_BOOKS: TheoryBook[] = [
  { n: 1, title: '论证是什么', asks: '我们在分析的到底是什么东西', doc: 'docs/理论支撑/01-论证是什么.md' },
  { n: 2, title: '好论证凭什么', asks: '「站得住」这四个字的规范力量从哪来', doc: 'docs/理论支撑/02-好论证凭什么.md' },
  { n: 3, title: '型式的认识论', asks: '一个型式凭什么要求对方回答那几问', doc: 'docs/理论支撑/03-型式的认识论.md' },
  { n: 4, title: '语境为什么改变结论', asks: '同一句话换个场合为什么对错会变', doc: 'docs/理论支撑/04-语境为什么会改变结论.md' },
  { n: 5, title: '谬误的自然史', asks: '人为什么会犯这些错，命名有什么用', doc: 'docs/理论支撑/05-谬误的自然史.md' },
  { n: 6, title: '机器能做什么', asks: '哪些判断可以交给模型，哪些不许', doc: 'docs/理论支撑/06-机器能做什么.md' },
  {
    n: 7,
    title: '理论到代码',
    asks: '上面六编各自落在了哪个字段',
    doc: 'docs/理论支撑/07-理论到代码.md',
    engineering: true,
  },
  {
    n: 8,
    title: '批判性思维',
    asks: '「会思考」由哪些能力与习惯构成，本工具代劳了哪几样',
    doc: 'docs/理论支撑/08-批判性思维.md',
  },
  {
    n: 9,
    title: '哲学与人文视野',
    asks: '论证之外还有哪些读文本的方式，本工具为什么不采用',
    doc: 'docs/理论支撑/09-哲学与人文视野.md',
  },
  {
    n: 10,
    title: '其他论证传统',
    asks: '西方非形式逻辑之外，别的传统怎么算「把话说住了」——本工具为什么不采用',
    doc: 'docs/理论支撑/10-其他论证传统.md',
  },
];

/**
 * 原始条目。对外一律用下面的 THEORY_CLAIMS——它补上了旧条目的细分域。
 * 细分域是库建好之后才长出来的第二根轴，所以旧条目的取值集中在一张映射表里
 * 补上（见数组之后），不动原文；新条目直接写 sub 字段。
 */
export const RAW_CLAIMS: TheoryClaim[] = [
  /* ───────────────── 一 · 论证是什么 ───────────────── */
  {
    id: 'T1-01',
    book: 1,
    claim: '「论证」有两种经典理解：一是前提支持结论的结构，二是提出理由以说服他人接受某命题的言语行为。两者不重合。',
    tier: 'A',
    refs: ['SEP, "Argument"（两种理解并存的说明）'],
    decides:
      '报告同时输出结构与语境两项：结论与前提单独成字段并画进结构图，这段话在做什么进 context.issue（争议之点）。只取一种理解会漏掉一半文本。',
    contested: '有学者主张言语行为那一路过于宽泛，会把一切说服性话语都算成论证。',
  },
  {
    id: 'T1-02',
    book: 1,
    claim: '抒情、提问、命令、纯陈述、口号都不是论证，哪怕它们出现在论证旁边。',
    tier: 'B',
    refs: ['SEP, "Argument"', '武宏志《非形式逻辑导论》第一章（论证与非论证的划界）'],
    decides:
      '检出不构成论证时照实说，不硬凑结论与前提。空报告优于假报告——这一条是 applicable=false 那一整条分支的依据。',
  },
  {
    id: 'T1-03',
    book: 1,
    claim: '日常论证大多是可废止的：结论只在若干默认条件成立时被支持，条件一旦被推翻，结论就要撤回。',
    tier: 'A',
    refs: ['Walton, "Argumentation Schemes" 传统；可废止推理的一般表述'],
    decides:
      '判定用三档（站得住／勉强／不成立）而不是对错二元；检查项可被单独推翻，不影响其它项。可废止性是整座楼的地基。',
  },
  {
    id: 'T1-04',
    book: 1,
    claim: '不存在一个能通吃所有领域、所有目的的论证模型。多元论不是妥协，是当前学界的实际状态。',
    tier: 'A',
    refs: ['SEP, "Informal Logic"（不主张单一通吃模型的表述）'],
    decides:
      '六副透镜并置，不合并成一个总分。**透镜之间结论不一致是信息，不是错误**——这一条是「换副透镜，同一处会被判成不同的东西」那句话的根据。',
  },
  {
    id: 'T1-05',
    book: 1,
    claim: '论证、解释、证明、说服的边界是功能性的，看它在对话里起什么作用，不看它的句法形式。',
    tier: 'B',
    refs: ['SEP, "Argument"', 'van Eemeren 关于论证与解释区分的讨论'],
    decides:
      'conclusion 字段要求填「他要你信的那句话」，不是「这段话的主题」。很多返工都出在这个字段被填成了主题。',
  },
  {
    id: 'T1-06',
    book: 1,
    claim: '一段真实文本常常同时是论证和别的东西，体裁是混合的。',
    tier: 'C',
    refs: ['本工具的判断：由上述边界的功能性直接推出'],
    decides:
      '允许「部分适用」：整篇不判 applicable=false，但某一副透镜不适用时照实标出。不强行把整篇归成一类。',
    sub: 'context',
  },
  {
    id: 'T1-07',
    book: 1,
    claim: '一条前提被削弱，不等于整段论证清零。多条独立支撑链里，一条断了，其余各条各自还剩多少就是多少。',
    tier: 'B',
    refs: ['SEP, "Argument"（论辩型与链式结构的区分）', '标准逻辑教材对多前提结构的处理'],
    decides:
      'claim.supports 允许多对一：一条结论可以同时挂在几条链上。击破一条链只削弱它撑住的那部分，报告照实分开说——合成一句「不成立」会把没断的链也埋掉。',
    sub: 'structure',
  },
  {
    id: 'T1-08',
    book: 1,
    claim: '重构按善意原则取最强读法：补出来的隐含前提必须是「若不假定它，这一步就推不出」，而不是给对方塞一个更好打的版本。',
    tier: 'B',
    refs: ['SEP, "Informal Logic"（善意原则与论证重建）'],
    decides:
      'implicit=true 的前提必填 implicitBasis，格式固定为「若不假定 X，则从 {前提} 推不出 {结论}」。写不出这一句的隐含前提不成立——那多半是给对方栽赃的稻草人。',
    contested: '善意原则的「度」有争议：补得太强，等于替对方写了一篇他没写的论证。',
    sub: 'structure',
  },

  /* ───────────────── 二 · 好论证凭什么 ───────────────── */
  {
    id: 'T2-01',
    book: 2,
    claim: '「好」的规范力量有四个互不相同的来源：认识论上的真、程序上的公正、修辞上的有效、说话者的品质。混用会得到互相矛盾的判定。',
    tier: 'B',
    refs: ['Johnson, Manifest Rationality（论证实践的多种立场）', '本工具的四分整理'],
    decides:
      '每副透镜明示自己拿的是哪一把尺子。透镜冲突时不调和、不取平均——取平均会把两种不同性质的失败混成一个数。',
  },
  {
    id: 'T2-02',
    book: 2,
    claim: '前提可接受、前提与结论相干、前提足以支撑结论，这三条不是并列打分项，而是一条漏斗。',
    tier: 'B',
    refs: ['Johnson & Blair, Logical Self-Defense（RSA 三标准的原始表述）'],
    decides:
      '相干性未过时不评充分性，并在报告里写明「因为相干性未建立，未评充分性」。跳过要留痕，否则读者会以为查过了。',
    lens: ['ars'],
  },
  {
    id: 'T2-03',
    book: 2,
    claim: '三标准之外还要第四条：没有未被回应的击败因素。三关全过但存在明显反证的论证，仍不是好论证。',
    tier: 'B',
    refs: ['Govier, A Practical Study of Argument（第四条件）'],
    decides:
      'defeat 与 refutations 独立成块，不并进「充分性」。两者修补方式不同：一个补前提，一个处理反证；合成一个指标会抹掉行动指引。',
    lens: ['ars', 'toulmin'],
  },
  {
    id: 'T2-04',
    book: 2,
    claim: '可接受性问的是「有没有理由接受」，不是「愿不愿意接受」。',
    tier: 'B',
    refs: ['Johnson & Blair', 'SEP, "Informal Logic"（受众一条）'],
    decides:
      'status 与 forAudience 分开存。报告写「在『谁』看来可接受」，而不是笼统一句「可接受」。这一条同时是「受众相对」那条争议的站位依据。',
    contested: '相对主义指责：可接受性既然随受众变，就没有跨受众判准。',
    lens: ['ars'],
  },
  {
    id: 'T2-05',
    book: 2,
    claim: '判断一个前提可不可接受，要问三件事：它本身可信吗、它是否已被论证支持、它是否落在双方共同的起点之内。',
    tier: 'B',
    refs: ['Freeman 关于前提可接受性的三问'],
    decides:
      'acceptability 检查项拆成三问分别回答，不许合成一个模糊的「可接受」。合成之后无法指出下一步该补什么。',
    lens: ['ars'],
  },
  {
    id: 'T2-06',
    book: 2,
    claim: '论证的布局是跨领域通用的，但「什么算够」随领域而变——场域依赖与场域不变是两件事。',
    tier: 'A',
    refs: ['Toulmin, The Uses of Argument, CUP 1958'],
    decides:
      '门槛 T₂：「够不够」先填领域门槛（刑事／民事／政策讨论），再谈强弱。门槛不填时不许给充分性判定。',
    contested: 'Hitchcock 等指出担保与前提在实际文本里难以划清，六要素的可操作性受质疑。',
    lens: ['toulmin', 'ars'],
  },
  {
    id: 'T2-07',
    book: 2,
    claim: '提出主张的一方承担举证责任。责任可以转移，但不会消失。',
    tier: 'B',
    refs: ['Walton 关于 burden of proof 的论述', 'van Eemeren & Grootendorst 第 2 条规则'],
    decides:
      'claim.burden 字段；推卸责任时记「未建立」而不记「已推翻」。两者分量差很远：一个是还没说清，一个是说错了。',
    lens: ['pragma', 'walton'],
  },
  {
    id: 'T2-08',
    book: 2,
    claim: '充分性没有通用阈值。阈值来自论证负担与后果严重程度，而这两者都要人填。',
    tier: 'C',
    refs: ['本工具的判断：由场域依赖 + 举证责任两条推出'],
    decides:
      '不输出「充分／不充分」的绝对话，只输出「在 X 门槛下够／不够」，并写明门槛是从哪来的。',
    lens: ['ars', 'toulmin'],
    sub: 'verdict',
  },
  {
    id: 'T2-09',
    book: 2,
    claim: '削弱性击败与反驳性击败不可混。前者切断前提与结论的联结而不否定结论，后者直接给出结论为假的理由。',
    tier: 'B',
    refs: ['Pollock 关于 undermining / rebutting击败的区分，论证与可废止推理文献通行表述'],
    decides:
      'DefeatKind 分 undermining / rebutting 两型分开存。把削弱写成「该论证不成立」是越界——那等于把「这一步接不上」说成了「你要信的那句话是假的」。',
    sub: 'verdict',
  },
  {
    id: 'T2-10',
    book: 2,
    claim: '一个判定若说不出「什么情况下它该被撤回」，它就不是判断，是表态。',
    tier: 'C',
    refs: ['本工具的判断：由可废止性（T1-03）直接推出'],
    decides:
      'selfCheck.withdrawIf 必填。每一份分析都要写明「出现什么就得收回这份结论」——没有撤回条件的结论，与它反对的标签化裁决是同一种东西。',
    sub: 'verdict',
  },
  {
    id: 'T2-11',
    book: 2,
    claim: '三标准互相独立：一个假前提可以与结论完全相干，一个可接受的前提也可以与结论毫不相干。任何一关都不能替另外两关打分。',
    tier: 'B',
    refs: ['Johnson & Blair, Logical Self-Defense（三标准相互独立的原始意图）'],
    decides:
      'ARS 的三条检查项各自独立作答，禁止由相干性推断可接受性或反之。合并打分会让「补哪一关」的行动指引消失。',
    /*
      这一条是被手册顶住的：「三标准互相独立」在文献里不是定论。
      原先只写「相互独立的原始意图」，等于把有争议的话写成了事实；
      手册核对（§7.3，页 453）把批评原样摆出来，这里就照实认下来。
    */
    contested:
      '比罗与西格尔认为「相关性」是「充分性」的特例，是三条里多余的一条；布莱尔本人也承认 RSA 三标准过于片面，照顾不到论证的论辩与修辞层面。本工具仍然三关分开作答，理由是要给「补哪一关」的行动指引，不是文献已经判过这一条。',
    lens: ['ars'],
    sub: 'verdict',
  },

  /* ───────────────── 三 · 型式的认识论 ───────────────── */
  {
    id: 'T3-01',
    book: 3,
    claim: '型式不是形式。一个论证型式靠内容与功能成立，不靠逻辑形式——两个不同型式可以有同一逻辑形式。',
    tier: 'A',
    refs: ['Walton, Reed & Macagno, Argumentation Schemes, CUP 2008'],
    decides:
      '型式识别是候选而非结论：认不出写 none，允许在 alternativeFamily 里写「族可能认错」。型式名不进结论，只作检索入口。',
    lens: ['walton', 'pta'],
  },
  {
    id: 'T3-02',
    book: 3,
    claim: '每个型式自带一组批判性问题，那组问题就是该型式默认条件的展开。',
    tier: 'A',
    refs: ['Walton, Reed & Macagno 2008（型式与 CQ 的配对）'],
    decides:
      '检查项由 CQ 逐条生成，不另立一套通用清单。另立清单会变成「你能想到的检查」，而不是「这个型式必须交代的环节」。',
    lens: ['walton'],
  },
  {
    id: 'T3-03',
    book: 3,
    claim: 'CQ 有三种理解：附加前提、批判性问题、默认条件。只有「默认条件」这一读法既有规范力量又能判定。',
    tier: 'C',
    refs: ['本工具的判断：比较三种读法在本应用里的可执行性'],
    decides:
      'SchemeDefinition.criticalQuestions 里每条的 why 必须写出「这一问守的是担保的哪一环」。写不出来的 CQ 从库里删掉——它只是凑数。',
    lens: ['walton'],
  },
  {
    id: 'T3-04',
    book: 3,
    claim: '在框架内，型式误用与故意误导长得完全一样。',
    tier: 'C',
    refs: ['本工具的判断：型式法不含意图判据'],
    decides:
      '不设任何动机字段。报告里不出现「他故意」「他在带节奏」这类表述，只描述言语行为本身。',
    lens: ['walton', 'copi'],
  },
  {
    id: 'T3-05',
    book: 3,
    claim: '型式识别无法被可靠地自动化：没有形式判据，也没有配套的识别程序。',
    tier: 'A',
    refs: ['论证挖掘研究对 Walton 型式的批评（型式靠内容区分）'],
    decides:
      '型式只作检索入口与检查项来源，不出现在判定里。认错型式不会直接导致判错结论，只会让检查项失焦——这个代价是可接受的，反过来不行。',
    lens: ['walton', 'pta'],
  },
  {
    id: 'T3-06',
    book: 3,
    claim: '元问题优先于对象问题：先问「这个型式在此处适不适用」，再问「它的条件满不满足」。',
    tier: 'C',
    refs: ['本工具的判断：适用性错误比条件缺失更根本'],
    decides:
      'meta=true 的 CQ 先判。命中则后续各项不再评，直接改写 applicable。这一条也解释了为什么每条 CQ 要标 meta。',
    lens: ['walton'],
    sub: 'scheme',
  },
  {
    id: 'T3-07',
    book: 3,
    claim: '类比论证的强度不取决于相似点的数量，取决于相似点与担保是否相关：差异若落在担保链上，一百个相似点也救不回来。',
    tier: 'B',
    refs: ['Walton, Reed & Macagno, Argumentation Schemes（argument from analogy 一节）', 'SEP, "Analogy and Analogical Reasoning"'],
    decides:
      '类比专题的检查按「已知差异点是否切断担保」提问，不数相似点。数相似点是这类论证最常见也最没用的辩护方式。',
    sub: 'topic-analogy',
  },
  {
    id: 'T3-08',
    book: 3,
    claim: '因果论证的默认条件是「没有别的因素在起作用」。型式本身不保证因果，只把举证责任交给提出者去排除替代解释。',
    tier: 'B',
    refs: ['Walton 的因果论证型式（从因到果／从果到因）及其批判性问题'],
    decides:
      '因果专题的检查默认三问：相关是真的吗、方向对吗、还有什么也能解释它。第三问最容易漏——它是「相关不等于因果」的操作形式。',
    sub: 'topic-causal',
  },
  {
    id: 'T3-09',
    book: 3,
    claim: '统计概括的可信度取决于样本代表性与基数，不取决于百分比的大小。「97% 的用户满意」若来自自我选择的样本，百分比毫无意义。',
    tier: 'B',
    refs: ['非形式逻辑教材对统计概括（统计三段论）的处理'],
    decides:
      '统计专题按「样本怎么来的、基数多大、比率跟什么比」三问展开。第三问「跟什么比」最常被省略——没有基线的百分比是修辞，不是数据。',
    sub: 'topic-causal',
  },
  {
    id: 'T3-10',
    book: 3,
    claim: '诉诸专家意见型式的默认条件至少有四：专家在相关领域内、引用真实、领域内存在共识、专家无利益冲突。任何一条不满足，型式的担保就换了来源。',
    tier: 'A',
    refs: ['Walton, Appeal to Expert Opinion, CUP 1997（该型式批判性问题的原始表述）'],
    decides:
      '来源专题按这四条展开，缺一条就降档到「该说的话需要另外的担保」；四条全空时，「专家说」只等于「有人说」。',
    sub: 'topic-source',
  },
  {
    id: 'T3-11',
    book: 3,
    claim: '实践推理（要不要做 X）的批判性问题是替代方案与副作用，不是动机。问「他图什么」改变不了方案本身的好坏。',
    tier: 'B',
    refs: ['Walton, Reed & Macagno（practical reasoning 型式的 CQ：目标、替代方案、副作用、价值排序）'],
    decides:
      '实践推理专题按「有没有替代方案、副作用有哪些、价值排序摆出来了吗」三问展开。动机不是其中一问——那是人身之争的入口。',
    sub: 'topic-practical',
  },
  {
    id: 'T3-12',
    book: 3,
    claim: '关键术语在推理中途换义，担保就断了。含混不是「词不精确」，是同一个词在前提与结论里各撑着一段推理。',
    tier: 'B',
    refs: ['型式法对 equivocation 的表述；传统上属语义谬误的通行讨论'],
    decides:
      '定义与含混专题对关键术语只问一句：从前提走到结论，这个词的含义变过没有。变了就指出在哪一步断的，不笼统说「概念不清」。',
    sub: 'topic-definition',
  },

  /* ───────────────── 四 · 语境 ───────────────── */
  {
    id: 'T3-13',
    book: 3,
    claim:
      '类比的举证负担在提出者一方：他负责说明相似点落在担保上；对方只要指出一个落在担保上的差异就够了。',
    tier: 'B',
    refs: ['Walton, D., Reed, C. & Macagno, F. (2008). Argumentation Schemes（类比型式与其批判性问题）'],
    decides:
      '专题分析对类比列的第一问是「有没有差异落在担保链上」，不列「相似点够不够多」——后者不决定强度（见 T3-07）。两条问法的差别不是措辞：数相似点会鼓励提出者多凑几个，指差异才逼他交代担保。',
    sub: 'topic-analogy',
  },
  {
    id: 'T3-14',
    book: 3,
    claim:
      '援引先例与打比方是两回事：前者的担保是「同类案件同类处理」，后者是「同样的机制会有同样的结果」。',
    tier: 'B',
    refs: ['Walton, D., Reed, C. & Macagno, F. (2008)（analogy 与 argument from precedent 分列）'],
    decides:
      '型式库里 argument-from-precedent 与 analogy 是两条，分开识别。合并之后，「上次这么做没事」会被当机制类比来查，而先例真正要问的是「这次与上次在相关方面是不是同一类」。命中类比时 warrantType 记 analogy，Toulmin 那一栏按担保类型而不是按句式给。',
    sub: 'topic-analogy',
    lens: ['toulmin'],
  },
  {
    id: 'T3-15',
    book: 3,
    claim:
      '相关不是因果：第三变量、方向反转、巧合，三种情形都能造出一模一样的相关。',
    tier: 'B',
    refs: ['SEP, "Causation"', 'Walton, D., Reed, C. & Macagno, F. (2008)（cause-to-effect 与 correlation-causation 分列）'],
    decides:
      '型式库里 correlation-causation 与 cause-to-effect 是两条，命中时专题分析同时问「还有什么也能解释这个结果」与「方向对吗」——两条并列而不合并，因为它们的举证负担不同：前者要排除替代解释，后者要交代机制。',
    sub: 'topic-causal',
  },
  {
    id: 'T3-16',
    book: 3,
    claim:
      '「他是这个领域的专家」与「他当时在场」是两种不同的担保：前者靠领域权威，后者靠亲历地位。混成一句「诉诸权威」会查错地方。',
    tier: 'B',
    refs: ['Walton, D., Reed, C. & Macagno, F. (2008)（expert opinion 与 position to know 分列）'],
    decides:
      '型式库里 expert-opinion 与 position-to-know 分开识别。合并之后，「他当时在场」会被按专家型式的四个条件查（领域、共识、利益冲突），而亲历地位真正的条件是「他有没有看见、记不记得、有没有理由隐瞒」。',
    sub: 'topic-source',
  },
  {
    id: 'T3-17',
    book: 3,
    claim:
      '实践推理的结论是「该做什么」，不是「什么是真的」。所以它的失败方式与断言不同：断言错在假，行动建议错在划不来或办不到。',
    tier: 'B',
    refs: ['Walton, D. (2007). "Evaluating Practical Reasoning"（实践推理的评估）'],
    decides:
      'practical-basic 的批判性问题里有替代方案与副作用，没有「结论是否为真」这一问。专题分析照此列出，不问「他说的对不对」——对实践推理问真假，是把行动建议读成了断言。',
    sub: 'topic-practical',
    lens: ['pta'],
  },
  {
    id: 'T3-18',
    book: 3,
    claim:
      '「应该做 X」里藏着一个可行性前提：X 做得到。做不到时，整段实践推理悬空，而前提与结论之间的逻辑可以一点毛病没有。',
    tier: 'C',
    refs: ['本工具的判断（依据：PTA 三类命题的分工）'],
    decides:
      'PtaStatementType 把 policy 与 value 分开计：政策命题要同时交代价值前提与可行性前提，缺后者时判「未定」而不是「站得住」。专题分析对实践推理只问替代方案与副作用，不问「他图什么」。',
    sub: 'topic-practical',
    lens: ['pta'],
  },
  {
    id: 'T4-01',
    book: 4,
    claim: '语用辩证十规则只在「这段话语确实以解决分歧为目标」时适用。对广告、社论、带货话术套十规则是范畴错误。',
    tier: 'A',
    refs: ['van Eemeren & Grootendorst, A Systematic Theory of Argumentation, CUP 2004（作者本人的适用范围限定）'],
    decides:
      'aimedAtResolution 是硬门槛，为假时整副透镜 applicable=false，而不是硬判。这是全应用最严格的一条范围门。',
    lens: ['pragma'],
  },
  {
    id: 'T4-02',
    book: 4,
    claim: '对话类型决定哪些招式合法。同一句话在谈判里正常，在学术讨论里是转移话题。',
    tier: 'A',
    refs: ['Walton 的对话类型划分（八类）'],
    decides:
      'dialogueType 参与判定，不是背景注释。同一招式在不同对话类型下会得出不同结论——这正是「换语境结论会变」的具体体现。',
    lens: ['pragma', 'walton'],
  },
  {
    id: 'T4-03',
    book: 4,
    claim: '受众是判定参数，不是背景信息。',
    tier: 'B',
    refs: ['Perelman 一路的修辞学传统', 'Johnson & Blair 的可接受性一条'],
    decides:
      'forAudience 参与可接受性判定。受众未定时可接受性判不动——此时照实写「判不动」，不拿一个默认受众悄悄顶上。',
    lens: ['ars'],
  },
  {
    id: 'T4-04',
    book: 4,
    claim: '举证责任随对话类型与「谁先提出」而变，不是固定常数。',
    tier: 'A',
    refs: ['Walton, Burden of Proof, Presumption and Argumentation'],
    decides:
      '举证责任（claim.burden）从语境取，不在代码里写死。写死等于对所有文本用同一把尺子，而那正好违背场域依赖。',
    lens: ['pragma', 'walton'],
  },
  {
    id: 'T4-05',
    book: 4,
    claim: '独白文本里没有「对方」，很多规则无从违反。',
    tier: 'C',
    refs: ['本工具的判断：由十规则的对话前提推出'],
    decides:
      'opposingPosition 为 null 时不允许凑满检查项，宁可整副透镜不适用。十项全填满的分析通常是在编。',
    lens: ['pragma'],
    sub: 'context',
  },
  {
    id: 'T4-06',
    book: 4,
    claim: '问句可以携带未经同意的预设。「你停止造假了吗」不管答是或否都认下了「造过假」——预设必须先谈，问题才能谈。',
    tier: 'B',
    refs: ['Walton 对复杂问语（complex question）的讨论；语用学对预设投射的通行结论'],
    decides:
      '预设与问句专题把「这一问里藏着哪个假定」单独列为一问；提问模式的「别问这些」栏同样依据这一条——带预设的问句问出口位置就反了。',
    sub: 'topic-presupposition',
  },
  {
    id: 'T4-07',
    book: 4,
    claim: '受众类型决定可接受性的偏置方向：对手受众的「可接受」门槛天然高于支持受众。同一句话对两种受众的可接受性判成一样，多半是没真判。',
    tier: 'C',
    refs: ['本工具的判断：由受众参与判定（T4-03）细分而来'],
    decides:
      'context.audienceKind 字段（general/specialist/adversarial/supportive）参与 forAudience 的判定方向。判不出写 unknown，不拿默认受众顶上。',
    sub: 'context',
  },
  {
    id: 'T4-08',
    book: 4,
    claim: '对话类型判不出来时判不动，不许拿「说服」当默认值。说服型只是八类之一，默认它等于悄悄替文本选了战场。',
    tier: 'C',
    refs: ['本工具的判断：由对话类型参与判定（T4-02）推出'],
    decides:
      'dialogueType=unknown 参与判定并留下依据，不做替换。同一招式在谈判里合法、在学术讨论里违规——类型判错，合法性的判定就跟着错。',
    sub: 'context',
  },

  /* ───────────────── 五 · 谬误 ───────────────── */
  {
    id: 'T4-09',
    book: 4,
    claim:
      '夹带预设的不只有问句：名词化（「他的造假行为」）、限定词（「又」「还」「终于」）同样能把没谈过的事说成已定的事。',
    tier: 'B',
    refs: ['SEP, "Presupposition"', 'SEP, "Questions"'],
    decides:
      '专题分析的预设栏不只查「你停止 X 了吗」这种显眼句式，也扫原文里的名词化与限定词。命中与否都照列——扫不到不等于没有，这一栏因此写明依据是强是弱。',
    sub: 'topic-presupposition',
  },
  {
    id: 'T4-10',
    book: 4,
    claim:
      '带预设的问句不能靠回答解决：先把它改成陈述句，看那句陈述是否被双方接受。预设没谈之前，答案无论正反都在替它背书。',
    tier: 'B',
    refs: ['SEP, "Questions"（问句的预设结构）', 'Walton, D. (2008)（复杂问语的处理）'],
    decides:
      '提问模式两条块各守一头：q.answerable 管这个问题能不能答，q.language 管有没有夹带未经同意的假定。两条分开，是因为「能答但不许那样问」与「那样问了根本没法答」是不同的毛病。',
    sub: 'topic-presupposition',
    lens: ['copi'],
  },
  {
    id: 'T5-01',
    book: 5,
    claim: '谬误没有公认定义。教科书通说「看似有效而实际无效」的三个必要条件，全部受到质疑。',
    tier: 'A',
    refs: ['SEP, "Fallacies"（SDF 三条件及其受质疑的说明）'],
    decides:
      '谬误名只作末端注释，不作判定。名录透镜的 verdict 恒为 undetermined、whatIsRefuted 恒为 nothing——它不给结论，只给对照。',
    lens: ['copi'],
  },
  {
    id: 'T5-02',
    book: 5,
    claim: '谬误清单不封闭，分类学本身仍在争议中，条目之间大量重叠。',
    tier: 'A',
    refs: ['IEP, "Fallacies"（231 条名录与分类争议的说明）'],
    decides:
      '名录只作教学对照，不宣称覆盖。同一违规有多个名字时并列写出，不选一个「最对的」。',
    lens: ['copi'],
  },
  {
    id: 'T5-03',
    book: 5,
    claim: '多数谬误指控死在同一处：这个型式在此处其实合法。',
    tier: 'B',
    refs: ['各条目 whenLegitimate 栏的汇总观察'],
    decides:
      'whenLegitimate 是必填字段，不是免责声明。命名前必须先排除「此处合法」——这一条是三道门槛里的第三道。',
    lens: ['copi', 'walton'],
  },
  {
    id: 'T5-04',
    book: 5,
    claim: '给名字是有代价的：一个名字会带走注意力，并预设反驳方向。',
    tier: 'C',
    refs: ['本工具的判断：命名即分类，分类即排除其它解释'],
    decides:
      '命名须过三道门槛：条件齐备、无更简解释、此处合法已被排除。三条不齐时只写位置，不给名字。',
    lens: ['copi'],
  },
  {
    id: 'T5-05',
    book: 5,
    claim: '认知资源有限是谬误的常态成因之一，不是例外情况。',
    tier: 'B',
    refs: ['Woods 关于资源约束与谬误的解释一路'],
    decides:
      '解释错误时，启发式捷径优先于恶意解释。不把错误一律读成故意——那既不准确，也让报告变得没法用。',
    lens: ['copi'],
  },
  {
    id: 'T5-06',
    book: 5,
    claim: '由身份偏见造成的可信度折扣不是论证的缺陷，是听者的缺陷。',
    tier: 'A',
    refs: ['Fricker, Epistemic Injustice, OUP 2007, p.28（identity-prejudicial credibility deficit）'],
    decides:
      '针对人身加第四条元问题：打折的依据是具体条件（利益冲突、专业不对口、转述失真）还是身份特征。后者写进此处合法，不写进命名候选。',
    contested: '边界必须划得很细：因「他说错了、他收了钱」而打折，是正常评估，不是不义。',
    lens: ['copi', 'ars'],
    sub: 'naming',
  },
  {
    id: 'T5-07',
    book: 5,
    claim: '滑坡指控必须指认断点：连环因果的每一环单独看往往都成立，「连起来会滑坡」是一个需要论证的主张，不是一句可以白得的反驳。',
    tier: 'B',
    refs: ['非形式逻辑对 slippery slope 的当代处理（区分合法连锁与凭空滑坡）'],
    decides:
      '命名候选给「滑坡」时必须写明断在哪一环；写不出断点的滑坡指控本身按凭空断言处理——这一条同样适用于本工具的反驳输出。',
    sub: 'naming',
  },
  {
    id: 'T5-08',
    book: 5,
    claim: '利益冲突是真实的可信度折扣理由，但只在冲突与结论相关时成立。「他收了钱」不自动等于「他说错了」——它改变的是核查义务，不是结论的真值。',
    tier: 'B',
    refs: ['诉诸动机（circumstantial ad hominem）的通行区分', 'Fricker 一路对可信度管理的限定'],
    decides:
      '来源专题的合法性栏依据这一条：利益冲突成立时输出的是「该核查」而不是「该不信」。混同两者就是把举证责任论成动机指控。',
    sub: 'topic-source',
  },

  /* ───────────────── 六 · 机器能做什么 ───────────────── */
  {
    id: 'T5-09',
    book: 5,
    claim:
      '含混有三种，代价很不一样：一词多义（歧义）、边界不清（模糊）、说得太宽（笼统）。只有第一种会在这里断掉担保。',
    tier: 'B',
    refs: ['SEP, "Ambiguity"', 'SEP, "Vagueness"'],
    decides:
      '专题分析只认第一种：同一个词在前提与结论里各撑着一段推理。模糊与笼统不标含混——否则每一句日常话都能被标上，命名就变成了噪音而不是信息。',
    sub: 'topic-definition',
  },
  {
    id: 'T5-10',
    book: 5,
    claim:
      '按类属下判断的论证（「这属于这一类，所以它有那个属性」）强弱取决于那个类属到底有没有那个属性，不取决于定义写得精不精确。',
    tier: 'B',
    refs: ['Walton, D., Reed, C. & Macagno, F. (2008)（verbal classification 型式）'],
    decides:
      '型式库里 verbal-classification 的批判性问题问的是类属与属性，不是定义是否精确。命中定义专题时按这两问列，不追问术语的词典义——追问词典义会让人以为把词定义清楚，论证就好了。',
    sub: 'topic-definition',
    lens: ['toulmin'],
  },
  {
    id: 'T6-01',
    book: 6,
    claim: '语言模型能给候选，不能给保证。',
    tier: 'C',
    refs: ['本工具的判断：模型输出无稳定性保证，且无法自证'],
    decides:
      '所有输出带 confidence 与 tag。报告里不出现「已证明」「确凿」这类措辞——那是在替模型越权表态。',
  },
  {
    id: 'T6-02',
    book: 6,
    claim: '模型会顺着文本的语气走。一段带偏见的文本，很容易被复述成「分析结论」。',
    tier: 'C',
    refs: ['本工具的判断：来自对提示词行为的观察'],
    decides:
      '涉及可信度、身份、动机的判断全部走专门的边界检查。这时工具若不复述偏见，就已经在起作用；若复述，就是在放大它。',
  },
  {
    id: 'T6-03',
    book: 6,
    claim: '结构化输出比自由文本更可核。',
    tier: 'C',
    refs: ['本工具的判断：可核性来自字段边界，不来自措辞'],
    decides:
      'JSON 契约 + 程序层七道裁决。模型输出不是最终结果，要过归一化、去重、守卫才落屏。',
  },
  {
    id: 'T6-04',
    book: 6,
    claim: '分析的可复现性依赖固定提示词与低温度，与模型「聪明程度」关系不大。',
    tier: 'B',
    refs: ['采样温度对输出稳定性的常规结论'],
    decides:
      'temperature 默认 0.2，设置页写明「这个任务要的是稳定复现，不是文采」。',
  },
  {
    id: 'T6-05',
    book: 6,
    claim: '工具不该替用户下最终判断。判定权在人。',
    tier: 'C',
    refs: ['本工具的判断：也是这个产品存在的理由'],
    decides:
      '三档判定、此处合法、本工具站哪边、争议栏，四样同时输出，不合并成一句话结论。合并就是为了让人不再自己判断。',
    sub: 'machine',
  },
  {
    id: 'T6-06',
    book: 6,
    claim: '整篇长文塞进一次分析，只有两种下场：被诚实判成「不是单一论证」，或被硬压成一条主论证而过度简化。两者都是失效，且发生在第一次使用最自然的那次操作上。',
    tier: 'C',
    refs: ['本工具的判断：来自整篇社论类文本的实测'],
    decides:
      '先切分（segment）再逐段分析：切分是本地启发式、不花钱、每个切点带依据，且切分权留给用户——工具给候选，不给结论。',
    sub: 'machine',
  },
  {
    id: 'T6-07',
    book: 6,
    claim: '提示词是判定口径的一部分。改了提示词不改版本号，历史对照就变成谎言——两份报告长得一样，却不是同一把尺子量的。',
    tier: 'C',
    refs: ['本工具的判断：可对照性是修订验收的前提'],
    decides:
      '提示词版本化（PROMPT_VERSION + 指纹），随每份报告落盘，并在提示词页展示。旧存档没有版本字段的按「未知版本」处理，不回填假值。',
    sub: 'trace',
  },
  {
    id: 'T6-08',
    book: 6,
    claim: '模型的 JSON 输出会坏。坏格式既不能算成功，也不能悄悄丢弃；格式修复只许修格式，第二次仍失败要如实记账。',
    tier: 'C',
    refs: ['本工具的判断：结构化输出的实际故障率'],
    decides:
      '解析失败回喂修复一次（提示词只声明修格式）；第二次仍失败时调用照常计入用量——失败率本身是重要信息，抹掉它账就失真了。',
    sub: 'machine',
  },

  /* ───────────────── 七 · 理论到代码 ───────────────── */
  {
    id: 'T7-01',
    book: 7,
    claim: '一条理论主张若指不出它在代码里改变了什么，它就不算落地——那是文档，不是理论基础。',
    tier: 'C',
    refs: ['本工具的判断：也是这个库存在的原因'],
    decides:
      '本库每条必须有 decides 字段；docs/理论支撑/07 的映射表逐条对应。找不到落点的主张不进库。',
  },
  {
    id: 'T7-02',
    book: 7,
    claim: '程序层裁决优先于模型自述。',
    tier: 'C',
    refs: ['本工具的判断：模型自述无法被它自己核实'],
    decides:
      '七道裁决（归一化、supports 解析、去重、G1 守卫、非论证降级等）在模型输出之后执行。模型说了不算。',
  },
  {
    id: 'T7-03',
    book: 7,
    claim: '不确定必须显式标出，不能靠措辞暗示。',
    tier: 'C',
    refs: ['本工具的判断：与这套产品的 tag 纪律同源'],
    decides:
      'confidence 字段、token 估算的「估」标记、本库的 A/B/C 档，三者是同一条纪律在三个层面的执行。',
  },
  {
    id: 'T7-04',
    book: 7,
    claim: '承认盲区比宣称全面更可信。',
    tier: 'C',
    refs: ['本工具的判断'],
    decides:
      '每副透镜有 blind 栏，争议栏有「这一层不能干什么」，名录透镜直接把自己的无能写进 verdict。',
    sub: 'trace',
  },
  {
    id: 'T7-05',
    book: 7,
    claim: '静默降级是最危险的失败形态：不报错、界面照常出报告，用户不知道某一步被跳过。报错的失败消耗一次操作，静默的失败消耗信任。',
    tier: 'C',
    refs: ['本工具的判断：来自对「模式不认识就当诊断」这类旧代码的复盘'],
    decides:
      '禁止按「未知就当 diagnose」写三元降级；不给档位的模式强制 undetermined 时写 MODE_NO_VERDICT 诊断留痕。凡是跳过的步骤都必须在报告里看得见。',
    sub: 'trace',
  },
  {
    id: 'T7-06',
    book: 7,
    claim: '一个从不失败的检查器等于没检查。断言必须有总数兜底，脚本必须被反向验证过会失败——否则全绿只说明脚本在跑，不说明它在守。',
    tier: 'C',
    refs: ['本工具的判断：来自「检查脚本自己坏了仍报通过」的实际事故'],
    decides:
      '各 check 脚本带下限断言（断言数少于下限即失败）；每个脚本做一次反向验证（注入坏输入确认它真的报错）。反向验证不进 CI，改脚本时手工做。',
    sub: 'trace',
  },
  {
    id: 'T7-07',
    book: 7,
    claim: '本地能算的不调模型。本地派生可复现、零成本、可审计；调一次模型换来的那点措辞，抵不上两次运行结果不一致带来的怀疑。',
    tier: 'C',
    refs: ['本工具的判断'],
    decides:
      '专题分析、修订对照、争议命中、理论主张命中全部由已落盘字段本地计算，不进提示词、不加 token。要让模型做的只有真正需要语言判断的那一步。',
    sub: 'trace',
  },

  /* ───────────────── 八 · 批判性思维 ───────────────── */
  {
    id: 'T8-01',
    book: 8,
    claim:
      '批判性思维不是「爱挑毛病」的态度，而是六项可教可测的技能：解读、分析、评价、推论、说明、自我校准。',
    tier: 'A',
    refs: [
      'Facione, P. (1990). Critical Thinking: A Statement of Expert Consensus for Purposes of Educational Assessment and Instruction（Delphi 共识报告，46 位学者两轮德尔菲）',
    ],
    decides:
      '本工具只代劳其中三样：分析（六副透镜的检查项）、评价（档位与依据）、说明（每关的依据栏）。解读只代劳一半——切分是启发式，不是理解。推论由模型暗做且不展示中间步骤。**自我校准完全不代劳**。这份账不藏在文档里，写进报告底部的边界区块。',
    sub: 'ct-skill',
  },
  {
    id: 'T8-02',
    book: 8,
    claim:
      '会做与愿意做是两回事：技能之外还有倾向——求真、开放、审慎、愿意考虑异见。有技能而无倾向的人，会用得很漂亮地替自己辩护。',
    tier: 'A',
    refs: [
      'Facione, P. (1990)（技能与倾向的二分）',
      'Ennis, R. (1987). A Taxonomy of Critical Thinking Dispositions and Abilities',
    ],
    decides:
      '输出里没有任何关于人的评价：不评说话者是否开放、是否真诚，也不给用户打分。labels 只标候选谬误名，不指向品格。工具能做的是把文本摊开，倾向是人自己的事。',
    sub: 'ct-skill',
  },
  {
    id: 'T8-03',
    book: 8,
    claim:
      '任何推理都有八个要素：目的、待决问题、信息、概念、假设、推论、意涵、观点。漏掉其中一个，推理就少了一块。',
    tier: 'B',
    refs: [
      'Paul, R. & Elder, L. (2006). The Miniature Guide to Critical Thinking: Concepts and Tools（思维的八要素）',
    ],
    decides:
      '假设这一要素落到 unknowns：重构模式要求把补出来的隐含前提写进去，不许默认它读者自明。观点这一要素**本工具不取**——不要求模型声明它从哪个视角读。一句「我从 X 视角读」既不可核，又会让人以为视角问题已经交代过了。',
    sub: 'ct-standard',
    contested: '立场论者会反问：不声明视角等于默认站在 dominant 视角，沉默本身就是一种立场。这一条没有化解，见 T9-07。',
  },
  {
    id: 'T8-04',
    book: 8,
    claim:
      '衡量一个想法的尺子有九条：清晰、准确、精确、相关、深度、广度、逻辑、重要性、公平。九条不能互相顶替。',
    tier: 'B',
    refs: ['Paul, R. & Elder, L. (2006)（思维的九标准）'],
    decides:
      '只有广度与公平单独立栏：steelman 要求给出对方最强的版本。其余七条不单独成字段——它们散在检查项里，单独立栏会让一份报告看起来逐条都做了，实际上只是把同一句话抄九遍。',
    sub: 'ct-standard',
  },
  {
    id: 'T8-05',
    book: 8,
    claim:
      '公平标准不等于让步：把对方的版本说到最强，是检查手段，不是承认它对。',
    tier: 'C',
    refs: ['本工具的判断（依据：steelman 与 refutation 分开计的实践后果）'],
    decides:
      'steelman 与 refutation 是两个字段，不合并。合并之后读者分不清哪句是「对方最可能说的」、哪句是「本工具的结论」——那正是把让步伪装成检查的地方。',
    sub: 'ct-standard',
  },
  {
    id: 'T8-06',
    book: 8,
    claim:
      '批判性思维的倾向里包括「寻求替代解释」与「暂缓判断」：在没有排他证据之前不急着收口。',
    tier: 'B',
    refs: ['Ennis, R. (1987)（倾向清单中的 seek alternatives / suspend judgment）'],
    decides:
      '替代解释不由模型即兴发挥：topicsOf 本地列出「还有什么也能解释这个结果」，无论模型这次想到没有。模型想不到的那次，正是最需要它的那次。',
    sub: 'ct-skill',
  },
  {
    id: 'T8-07',
    book: 8,
    claim:
      '自我校准是六项技能里最难的一项：好的思考者会回过头检查自己的推理，包括自己刚才用的那把尺子。',
    tier: 'A',
    refs: ['Facione, P. (1990)（self-regulation 为第六项技能）'],
    decides:
      '本工具不做自我校准：它不回查自己给出的依据是否前后一致，也不检查自己这次选的透镜对不对。这个缺口不藏——写进报告底部边界区块的第一条，而不是留给用户自己发现。',
    sub: 'ct-skill',
  },
  {
    id: 'T8-08',
    book: 8,
    claim:
      '批判不等于否定。建设性地重构一个说法，与拆穿它一样是批判性思维。',
    tier: 'B',
    refs: ['Facione, P. (1990)（分析与评价之外的建设性维度）', 'Johnson, R. (2000). Manifest Rationality（论证的辩证义务）'],
    decides:
      '所以有重构与提问两个模式：MODE_META.givesVerdict 为 false 时不给档位，G8 强制 level 取 undetermined。批判性的一面由红队承担，建设性的一面由重构承担，两者不混在同一份输出里。',
    sub: 'ct-skill',
  },
  {
    id: 'T8-09',
    book: 8,
    claim:
      '批判性思维还要会问「为什么这个问题被这样提出」——问题的框架本身可以是一个立场。',
    tier: 'B',
    refs: ['Paul, R. & Elder, L. (2006)（question-at-issue 要素）', 'Ennis, R. (1987)（聚焦问题 focus on a question）'],
    decides:
      '提问模式保留这一维度：q.aim 要求问题对准文本的目标，而不是对准审讯。诊断与红队不追问问题框架——它们接受文本提出的那个问题，只问它答得对不对。这是两个模式的区别，不是遗漏。',
    sub: 'ct-skill',
  },
  {
    id: 'T8-10',
    book: 8,
    claim:
      '对结论标注把握程度是元认知的一部分；但把把握程度写成数字，会让不确定的东西看起来是确定的。',
    tier: 'C',
    refs: ['本工具的判断（依据：档位设计的取舍）'],
    decides:
      '档位只有三档加 undetermined，不输出百分比、分数或「置信度 0.82」。一个两位小数的置信度会被当成测量结果，而它其实只是模型的一次取样。',
    sub: 'ct-standard',
  },
  {
    id: 'T8-11',
    book: 8,
    claim:
      '给一个谬误起名字，不等于评估了它。命名是分析的一步，不是结论。',
    tier: 'B',
    refs: ['Facione, P. (1990)（分析与评价为两项分列技能）', 'Ennis, R. (1987)'],
    decides:
      'labels 只标候选名，不因命名自动下调档位；命名必须连带说出「此处它合法或它不成立」的理由。查谬误模式把名字当主输出，但每条都要指得出原文哪一句；重构与提问模式清空 labels——先看清结构再谈名字。',
    sub: 'naming',
  },
  {
    id: 'T8-12',
    book: 8,
    claim:
      '批判性思维能不能跨领域迁移，学界没有共识：一派认为它是通用技能，一派认为它总是某门学科内部的技能。',
    tier: 'B',
    refs: [
      'McPeck, J. (1981). Critical Thinking and Education（领域特殊论）',
      'Facione, P. (1990)（通用技能论的 Delphi 共识）',
    ],
    decides:
      '本工具不按领域切换判定标准：六副透镜对所有文本同一套。topicsOf 只列出该领域该问的那几个问题，不改阈值、不改档位口径。争议没解决的地方，工具不假装已经选边。',
    sub: 'ct-skill',
    contested: '领域特殊论者会说：一套通用标准对诗歌与对实验报告同样粗暴。本工具接受这个批评，但不假装能解决它。',
  },

  /* ───────────────── 九 · 哲学与人文视野 ───────────────── */
  {
    id: 'T9-01',
    book: 9,
    claim:
      '说服有三个来源：说话者的品格、听众的情绪、论证本身。三者各自独立，好品格不能替坏论证补台。',
    tier: 'A',
    refs: ['Aristotle, Rhetoric（ethos / pathos / logos）'],
    decides:
      '本工具只评 logos：不评说话者品格，也不评情绪诉求的效果好不好。audienceKind 只用来定可接受性的门槛高低，不用来给情感诉求打分——那需要知道听众，而工具不知道。',
    sub: 'rhetoric',
  },
  {
    id: 'T9-02',
    book: 9,
    claim:
      '听众不是背景：面向「所有人」的论证与面向某一群人的论证，说服力标准不同。',
    tier: 'A',
    refs: ['Perelman, C. & Olbrechts-Tyteca, L. (1958). La Nouvelle Rhétorique（普遍听众与特殊听众）'],
    decides:
      '同一份文本的档位不因受众切换而改写——否则同一句话会有两个「站得住」。但 audienceKind 决定可接受性的偏置方向：对手受众的门槛天然更高，两种受众判成一样，多半是没真判。',
    sub: 'rhetoric',
  },
  {
    id: 'T9-03',
    book: 9,
    claim:
      '论证这种言语行为有语用前提：参与者不受强制、可以质疑、彼此真诚。前提不成立时，看上去的「论证」其实是别的东西。',
    tier: 'B',
    refs: ['Habermas, J. (1981). Theorie des kommunikativen Handelns（理想言说情境）'],
    decides:
      '本工具假定文本是真诚的，不检测欺骗、宣传与操纵意图，也不输出任何关于动机的判断。它只能看文本，看不见言说情境——而强制与不真诚恰恰发生在情境里，不在文本里。',
    sub: 'hermeneutic',
  },
  {
    id: 'T9-04',
    book: 9,
    claim:
      '理解总带着前见：读一段话不可能从零开始，「读成最强版本」不是宽容，是理解得以发生的条件。',
    tier: 'A',
    refs: ['Gadamer, H.-G. (1960). Wahrheit und Methode（前见与视域融合）', 'Davidson, D. (1973). "Radical Interpretation"（善意原则）'],
    decides:
      '重构取最强读法，并把其他合理解读写进 unknowns。rc.ambiguity 明确禁止「挑一种读法、然后当它唯一」——那是给对方塞一个更好打的版本，而不是理解。',
    sub: 'hermeneutic',
  },
  {
    id: 'T9-05',
    book: 9,
    claim:
      '一句话在做什么，不等于它的字面内容：断言、承诺、命令、暗示是四种不同的行为，规范后果各不相同。',
    tier: 'A',
    refs: ['Austin, J. (1962). How to Do Things with Words', 'Searle, J. (1969). Speech Acts'],
    decides:
      '异议的身份规则：反驳必须落在被断言的命题上，不能落在语气与措辞上。objectionKey 按字段与范围定位，OBJECTION_SCOPE_NOTE 写明范围——「他说得难听」不是异议，因为它没有可被断言反驳的内容。',
    sub: 'hermeneutic',
  },
  {
    id: 'T9-06',
    book: 9,
    claim:
      '知识与权力是缠在一起的：谁有资格说话、什么算证据，由体制而不是由逻辑决定。',
    tier: 'B',
    refs: ['Foucault, M. (1971). "L\'ordre du discours"', 'Foucault, M. (1975). Surveiller et punir'],
    decides:
      '来源专题会问「专家与这个结论有利益关系吗」，但本工具不评估制度性权力，也不因说话者的社会位置加减可信度。它能做的只是把「这话凭什么被相信」摊成可查的几问，把判断留给人。',
    sub: 'power',
  },
  {
    id: 'T9-07',
    book: 9,
    claim:
      '知识有位置性：从什么位置看，决定什么被看见、什么被当成背景。不存在无立场之眼。',
    tier: 'B',
    refs: ['Harding, S. (1991). Whose Science? Whose Knowledge?（立场论）', 'Haraway, D. (1988). "Situated Knowledges"'],
    decides:
      '本工具不声明自己的视角，报告里不写「从某某立场看」。理由是：一句视角声明既不可核，又会让人以为视角问题已经处理了。代价是沉默会被读成默认立场——这一点写在这里，不掩饰。',
    sub: 'power',
    contested: '立场论者认为：不声明视角就是站在 dominant 视角上。本工具承认这一点，但仍选择沉默——因为一句不可核的声明比沉默更像是在处理问题。',
  },
  {
    id: 'T9-08',
    book: 9,
    claim:
      '论证规范不是唯一的：不同传统对什么算理由、什么算证据、谁有发言权，有不同的规定。',
    tier: 'B',
    refs: ['SEP, "Feminist Epistemology"', 'Said, E. (1978). Orientalism（知识传统的权力维度）'],
    decides:
      '本工具只有一套规范——分析传统下的非形式逻辑与论辩理论，不按文化传统切换标准。这是明确局限，写进已知限制；不靠「兼容多元传统」这类措辞把它盖过去。',
    sub: 'power',
    contested: '认识论多元论者会认为：一套标准本身就是一种未经辩护的立场选择。这条批评成立，本工具没有回应它，只是不假装中立。',
  },
  {
    id: 'T9-09',
    book: 9,
    claim:
      '事实推不出价值：从「是这样」到「应当这样」之间有道缺口，跨过去需要一个额外的价值前提。',
    tier: 'A',
    refs: ['Hume, D. (1739). A Treatise of Human Nature III.i.1（是与应当）', 'SEP, "The Is/Ought Gap"'],
    decides:
      '实践推理里价值前提必须显式：PtaStatementType 把 value 与 fact 分开计，不允许拿事实前提充当价值前提。缺口要是被填上了，就得能指出填进去的那一句是哪一句。',
    sub: 'ct-standard',
  },
  {
    id: 'T9-10',
    book: 9,
    claim:
      '证成必然停在某一处：要么无限回溯，要么循环，要么在某一处独断。三条路都不完美。',
    tier: 'B',
    refs: ['Albert, H. (1968). Traktat über rationale Praxis（明希豪森三难）', 'SEP, "Infinite Regress Arguments"'],
    decides:
      '检查不递归：前提只被要求「有没有独立支持、是否落在共同起点之内」，不要求它自身也被证明。工具停在第一步，不停在最后一步——假装能停到最后一步的三难，会让每一份报告都显得没根据。',
    sub: 'verdict',
  },
  {
    id: 'T9-11',
    book: 9,
    claim:
      '假设不是单独接受检验的，它们结成一整块面对经验。所以一条被驳倒，不等于整块被推翻。',
    tier: 'B',
    refs: ['Quine, W. (1951). "Two Dogmas of Empiricism"', 'Duhem, P. (1906). La Théorie Physique（迪昂—蒯因论题）'],
    decides:
      '不因一条检查项没过就把整篇判成 fails：level 由各条支撑链各自计算，一条断了只减去它自己那份支撑。整体论在这里与削弱/击败之分同向——两者都反对「一点坏了全都坏了」。',
    sub: 'verdict',
  },
  {
    id: 'T9-12',
    book: 9,
    claim:
      '人文科学区分「说明因果」与「理解意义」：知道一段话为什么被写出来，不等于知道它在说什么。',
    tier: 'B',
    refs: ['Weber, M. (1922). Wirtschaft und Gesellschaft（Verstehen 与 erklären 之分）', 'Dilthey, W. (1883). Einleitung in die Geisteswissenschaften'],
    decides:
      '本工具做的是说明：给结构、给型式、给条件。它不做理解——重构模式不声称「作者真正想说的是」。rc.role 写明它的角色是重构者不是代言人。',
    sub: 'hermeneutic',
  },

  /* ───────────────── 十 · 其他论证传统 ───────────────── */
  /*
   * 这一编不是「多元文化点缀」。它存在的理由是第九编 T9-08 那句话：
   * 「本工具只有一套规范——分析传统下的非形式逻辑与论辩理论，不按文化传统切换标准。」
   * 一句自认局限的话，如果不写出「另一套长什么样」，就只是一句检讨，读者没法判断它到底差在哪。
   * 所以这里逐条写出：墨家怎么算把话说住了、名家在辩什么、因明的论式长什么样，
   * 然后写出**本工具对应得到哪一层、对应不到哪一层**。
   * 对应得到的地方照实说对应得到——不是所有比较都要以「我们不如人家」收尾。
   */
  {
    id: 'T10-01',
    book: 10,
    claim:
      '一个论断要站住，要三样东西：故（理由）、理（所依的法则）、类（它属于哪一类、能推及哪些同类情形）。三样齐了，话才成立。',
    tier: 'A',
    refs: [
      '《墨子·大取》：「夫辞以故生，以理长，以类行者也。三物必具，然后辞足以生。」',
      '孙诒让《墨子间诂》',
      '沈有鼎《墨经的逻辑学》（中国社会科学出版社，1980）',
    ],
    decides:
      '本工具的结构图只有「前提→结论」一层，「故」对应得上，「理」勉强对应担保，「类」这一层没有：它不问「这条理由按什么法则成立、还能推及哪些同类情形」。类比专题只问相似点是否落在担保链上（T3-07），不问「凭什么算同一类」。这是缺口，不是已经做到的事——写在这里，不从措辞上找补。',
    sub: 'tradition',
    contested: '「类」在墨经里是否等同于逻辑上的归类，学界有争论：有人读作类推的根据，有人读作社会伦理的同类。本工具两种都不采用。',
  },
  {
    id: 'T10-02',
    book: 10,
    claim:
      '说话分三层：以名举实（用概念指对象）、以辞抒意（用命题表达判断）、以说出故（用论证给出理由）。三层齐备，才算把一件事说明白。',
    tier: 'A',
    refs: ['《墨子·小取》：「以名举实，以辞抒意，以说出故。」', '沈有鼎《墨经的逻辑学》'],
    decides:
      '这三层在本工具里各有位置：名落在术语与定义专题，辞落在 conclusion 字段（存的是「他要你信的那句」而不是主题），说落在前提与 supports 构成的支撑链。这是墨家与西方非形式逻辑真能对上的一处——不是巧合，两边都在分「概念／命题／理由」这三件事。',
    sub: 'tradition',
  },
  {
    id: 'T10-03',
    book: 10,
    claim:
      '检验一个主张有三条路：上本之于古者圣王之事（历史经验）、下原察百姓耳目之实（当下见闻）、发以为刑政观其中国家百姓人民之利（实际效果）。三条都在文本之外。',
    tier: 'A',
    refs: ['《墨子·非命上》（三表法）', '孙诒让《墨子间诂》'],
    decides:
      '本工具只看文本内部：前提、结论、担保、检查项。它不查史实、不做调查、不评估政策效果——三表法里没有一表是它能做的。这不是谦虚，是能力边界：它没有文本以外的世界。所以学术分析里那几处「待核」只能指方向，核不了内容。',
    sub: 'tradition',
  },
  {
    id: 'T10-04',
    book: 10,
    claim:
      '「白马非马」不是一句耍赖：它说的是两个「名」所指的范围不同——「白马」的范围比「马」小，所指不是一回事。名的层次一旦混了，话就说不清。',
    tier: 'B',
    refs: ['《公孙龙子·白马论》', '庞朴《公孙龙子研究》（中华书局，1979）'],
    decides:
      '定义专题只查一件事：同一个词在前提与结论里含义变过没有。它不查「名」的外延与内涵分几层，也不判「这算不算同一个概念」。遇到白马式的论辩，它只能标出「这里在谈名实关系」，给不出判定——这类争论的胜负取决于你采用哪套名实理论，而本工具没有那套理论。',
    sub: 'tradition',
    contested: '「白马非马」的解读分歧很大：逻辑学读作概念外延之争，训诂一路读作「非」字的用法之争。本工具不选边，也不假装能判。',
  },
  {
    id: 'T10-05',
    book: 10,
    claim:
      '定名是为了辨实：名分清了，实才分得清；名混了，沟通就断了。所以名不是装饰，定错一个名，事情就跟着乱。',
    tier: 'A',
    refs: ['《荀子·正名》：「名定而实辨，道行而志通。」'],
    decides:
      '给谬误命名要过三道门槛（T5-04），且命名不自动下调档位（T8-11）——与「名定而实辨」同向：名是为了辨实，不是为了显得高明。反过来，硬套一个不相干的谬误名会让实更乱，所以宁可只写位置、不给名字。这一条是本工具命名纪律的古典对应，不是装饰性引用。',
    sub: 'tradition',
  },
  {
    id: 'T10-06',
    book: 10,
    claim:
      '因明的论式是三支：宗（命题）、因（理由）、喻（同类的例证与异类的反例）。它与三段论、图尔敏都不同——喻这一支要求同时给出正例与反例。',
    tier: 'A',
    refs: [
      '陈那《因明正理门论》（玄奘译）',
      '窥基《因明大疏》',
      '虞愚《因明学》（中华书局，1989）',
    ],
    decides:
      '六副透镜里没有因明，也不打算加。理由是它与本工具的输入格式不匹配：喻支要求举出同品与异品的实例，而输入只有一段文本，看不出说话者愿意把哪些实例算作同类——这一支没法从文本里读出来。遇到汉传佛教论式，它会被套进图尔敏（宗≈claim、因≈grounds），那是范畴错误。这一条写进报告底部的边界栏，而不是假装能处理。',
    sub: 'tradition',
  },
];

/*
 * 旧条目的细分域。库里已有四十条时细分域才长出来，逐条回头改原文要碰四十处、
 * 容易碰坏 id；集中一张表，缺谁漏谁一目了然（check:theory 会验全覆盖）。
 * 新条目不进这张表——直接写 sub 字段，写漏了同样会被 check:theory 抓住。
 */
/** 旧条目的细分域映射表。check:theory 会验它没有幽灵 id。 */
export const SUB_BY_ID: Record<string, ClaimSub> = {  // 一 · 论证是什么
  'T1-01': 'structure',
  'T1-02': 'structure',
  'T1-03': 'verdict',
  'T1-04': 'scheme',
  'T1-05': 'structure',
  'T1-06': 'context',
  // 二 · 好论证凭什么
  'T2-01': 'verdict',
  'T2-02': 'verdict',
  'T2-03': 'verdict',
  'T2-04': 'verdict',
  'T2-05': 'verdict',
  'T2-06': 'verdict',
  'T2-07': 'burden',
  'T2-08': 'verdict',
  // 三 · 型式的认识论
  'T3-01': 'scheme',
  'T3-02': 'scheme',
  'T3-03': 'scheme',
  'T3-04': 'scheme',
  'T3-05': 'scheme',
  'T3-06': 'scheme',
  // 四 · 语境
  'T4-01': 'context',
  'T4-02': 'context',
  'T4-03': 'context',
  'T4-04': 'burden',
  'T4-05': 'context',
  // 五 · 谬误
  'T5-01': 'naming',
  'T5-02': 'naming',
  'T5-03': 'naming',
  'T5-04': 'naming',
  'T5-05': 'naming',
  'T5-06': 'naming',
  // 六 · 机器能做什么
  'T6-01': 'machine',
  'T6-02': 'machine',
  'T6-03': 'machine',
  'T6-04': 'machine',
  'T6-05': 'machine',
  // 七 · 理论到代码
  'T7-01': 'trace',
  'T7-02': 'trace',
  'T7-03': 'trace',
  'T7-04': 'trace',
};

export const THEORY_CLAIMS: TheoryClaim[] = RAW_CLAIMS.map((c) => ({
  ...c,
  sub: c.sub ?? SUB_BY_ID[c.id],
}));

/* ─────────── 派生查询 ─────────── */

export const CLAIM_BY_ID: Record<string, TheoryClaim> = Object.fromEntries(
  THEORY_CLAIMS.map((c) => [c.id, c])
);

/** 某一编下的全部主张，按 id 排序 */
export function claimsOfBook(n: number): TheoryClaim[] {
  return THEORY_CLAIMS.filter((c) => c.book === n).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * 一副透镜**专有**的主张。
 *
 * 刻意不把全局底座算进来。第一版把两者混在一起，侧栏显示「这一栏站在 39 条
 * 主张上」——39 条等于全部，等于没有信息。分层的道理和争议栏一样：
 * 一个数字若对谁都一样大，它就不能帮人判断。
 */
export function lensClaims(t: TheoryId): TheoryClaim[] {
  return THEORY_CLAIMS.filter((c) => c.lens?.includes(t));
}

/** 六副透镜共用的底座：论证是什么、机器能做什么、理论怎么落到代码。 */
export function sharedClaims(): TheoryClaim[] {
  return THEORY_CLAIMS.filter((c) => !c.lens);
}

/** 三档分布。界面上的「A 14 · B 24 · C 24」就是这个。 */
export function tierStats(claims: TheoryClaim[] = THEORY_CLAIMS): { A: number; B: number; C: number } {
  const out = { A: 0, B: 0, C: 0 };
  for (const c of claims) out[c.tier] += 1;
  return out;
}

/** 某一细分域下的全部主张。报告里的专题分析按这一根轴取依据。 */
export function claimsOfSub(sub: ClaimSub): TheoryClaim[] {
  return THEORY_CLAIMS.filter((c) => c.sub === sub);
}

/**
 * 全文检索。只搜四个地方：主张本身、它改了什么、出处、细分域名。
 * 不搜 id——想找 T2-04 的人多半已经知道它在哪一编了。
 */
export function searchClaims(q: string): TheoryClaim[] {
  const k = q.trim().toLowerCase();
  if (!k) return THEORY_CLAIMS;
  return THEORY_CLAIMS.filter((c) =>
    [c.claim, c.decides, c.contested ?? '', ...c.refs, c.sub ? SUB_LABEL[c.sub] : '']
      .join(' ')
      .toLowerCase()
      .includes(k)
  );
}

/** 档位的中文名。界面上不写「A/B/C」，写全称，否则读者不知道 A 是什么。 */
export const TIER_LABEL: Record<EvidenceTier, string> = {
  A: '一手文献',
  B: '学界通说',
  C: '本工具判断',
};

/** 档位的读法。悬停提示用。 */
export const TIER_HINT: Record<EvidenceTier, string> = {
  A: '能在具体文献里查到。这一档最硬，也最少。',
  B: '教材转述或学界通行说法。可靠，但没核到原文那一句。',
  C: '本工具自己的判断，可能是错的。写出来是为了让人知道该往哪儿打。',
};
