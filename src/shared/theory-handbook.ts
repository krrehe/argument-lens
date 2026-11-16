import type { TheoryClaim } from './theory-base';

/**
 * 手册核对层。
 *
 * 为什么单立一层：主张库的 `refs` 写的是「SEP」「某本教材」，读者核不到具体一句话——
 * 那是「我知道有这回事」，不是「你可以去这一页看」。范爱默伦等《论证理论手册》
 * （中译本，中国社会科学出版社 2020，上下册）有章有节、目录带起页，能把一条主张
 * 指到「第 7.3 节，页 452 起」这种可以当面翻开的地址。
 *
 * 这一层只做一件事：**手册怎么看这条主张**。六种结论分开写——
 *   confirm 文献确认（意思对得上）
 *   narrow  文献只说一半（另一半是本工具的整理，得认下来）
 *   dispute 文献有反对（这条被批评顶着，必须让读者知道）
 *   absent  本次没核到（书里有这一节，但没读到，不猜）
 *   outside 本书范围外（这书的目录里没有这一块，翻也翻不到）
 *   own     无文献可核（refs 写的就是「本工具的判断」，没有一本书在说这个）
 *
 * 后两种是第一版没有的，补的理由很具体：第一版把「这本书不管」和「这次没读到」都写成了
 * 「本次未核到」。读者看到的都是「还没核」，其实前者翻遍全书也没有，后者等下轮就能补上。
 * 一句话把两件事说成一件，就不算说真话。第五条（outside）通常还带着一句更难受的话：
 * 那条主张在库里是有档位的，可这本书帮不上忙——读者得知道这一点。
 *
 * 它不改判定、不改分档、不改提示词，也不替主张库说话。库里那条该是什么档还是什么档；
 * 核对表里没有 tier 字段，就是为了让「核对过一次」不等于「升了一档」。
 *
 * 页码的规矩：**只抄目录**。目录里给了起页的才写，没给的（1.3.3 / 1.3.4 / 2.4.2 这些
 * 节在目录里只到 1.3、2.4 这一层）就留空——宁可少一个数字，不要多一个自己算出来的数字。
 * 这一条由 check:theory-handbook 把关：核对条目里的页码必须与 HANDBOOK_SECTIONS 逐字相同。
 */

export type HbVerdict = 'confirm' | 'narrow' | 'dispute' | 'absent' | 'outside' | 'own';

export const HB_VERDICT_LABEL: Record<HbVerdict, string> = {
  confirm: '文献确认',
  narrow: '文献只说一半',
  dispute: '文献有反对',
  absent: '本次未核到',
  outside: '本书范围外',
  own: '无文献可核',
};

export const HB_VERDICT_HINT: Record<HbVerdict, string> = {
  confirm: '手册这一节说的和本条主张对得上',
  narrow: '手册只支持一半，另一半是本工具的整理',
  dispute: '手册记载的批评正面顶着本条主张',
  absent: '书里有这一节，但这次没读到，没有核',
  outside: '这本书的十二章目录里没有这一块，翻也翻不到',
  own: '这一条不是文献命题，没有一本书在说这个',
};

/** 统计与界面按这个顺序排。数组而不是 Object.keys——顺序也是内容。 */
export const HB_VERDICT_ORDER: HbVerdict[] = ['confirm', 'narrow', 'dispute', 'absent', 'outside', 'own'];

/** 手册里被引用到的节。page 为 null 表示目录只列到上一级，没给这一节的起页。 */
export interface HbSection {
  /** 节号，如 7.3 */
  id: string;
  title: string;
  /** 1 = 上册，2 = 下册 */
  volume: 1 | 2;
  /** 目录里的起页；null = 目录没给到这一层 */
  page: number | null;
}

export const HANDBOOK_SECTIONS: HbSection[] = [
  { id: '1.1', title: '作为研究主题的论证', volume: 1, page: 1 },
  { id: '1.3.3', title: '用于描述论证类型的论证型式', volume: 1, page: null },
  { id: '1.3.4', title: '作为逻辑实体与功能实体的论证结构', volume: 1, page: null },
  { id: '2.4.2', title: '亚里士多德的谬误清单', volume: 1, page: null },
  { id: '3.4', title: '传统谬误进路', volume: 1, page: 186 },
  { id: '3.5', title: '标准谬误处理', volume: 1, page: 190 },
  { id: '3.6', title: '汉布林对标准处理的批评', volume: 1, page: 195 },
  { id: '4.5', title: '领域不变性与领域依赖性', volume: 1, page: 247 },
  { id: '5.4', title: '听众的主导作用', volume: 1, page: 309 },
  { id: '7.3', title: '布莱尔和约翰逊对非形式逻辑的贡献', volume: 1, page: 452 },
  { id: '7.5', title: '戈维尔对非形式逻辑核心议题的理论探讨', volume: 1, page: 465 },
  { id: '7.7', title: '弗里曼论论证结构与论证可接受性', volume: 1, page: 477 },
  { id: '7.8', title: '沃尔顿论论证型式与对话类型', volume: 1, page: 483 },
  { id: '10.5', title: '批判性讨论规则', volume: 2, page: 642 },
  { id: '12.18', title: '中国的论证研究', volume: 2, page: 913 },
];

/**
 * 这份解析文本读到哪一页为止。
 *
 * 数字只写在这里：界面上的「还差几页」、检查器里「说法与页码自洽」的判断、
 * 文档里的覆盖范围，都从这一处取。上一版「470」在三个地方各写一遍，
 * 改一处就会有两处对不上。
 */
export const HB_TEXT_END = 470;

/**
 * 「本次没核到」的两种情形。
 *
 * 为什么要分：页 642 那一节，是整册没进这份解析文本；页 190 那一节，
 * 文本里有、就是没有那一段。前者等文本补齐就能核，后者再怎么读也读不出来——
 * 读者对这两件事该有的期待完全不同，写成同一句「未核到」就是在骗人。
 */
export type HbGapKind = 'no-text' | 'no-section';

export const HB_GAP_LABEL: Record<HbGapKind, string> = {
  'no-text': '整节没进文本',
  'no-section': '读到了，节里没有',
};

export interface HbCheck {
  /** 主张库里的 id。必须真存在，否则这条核对挂在空处 */
  claimId: string;
  /** 手册节号。判 outside / own 时必须是 null——没有那一节可指，指着节号就是自相矛盾 */
  section: string | null;
  /** 结论。六种，没有第七种 */
  verdict: HbVerdict;
  /** 手册在这一节说了什么（转述，不是原文摘录） */
  says: string;
  /** 与本库这条的差：多了什么、少了什么、顶在哪里 */
  gap: string;
  /**
   * 只有「本次未核到」才填：这次为什么没核到。
   * 其余五种结论带着这个字段就是矛盾——核到了还说什么没核到。
   */
  why?: HbGapKind;
}

/**
 * 覆盖范围。写在界面上，也写在文档里——同一句话，两处不许各写一份。
 *
 * 第一版这句写的是「上册第 1—7 章（页 1—470）」，顺带只说下册第十章没读到。
 * 查目录才发现：上册第 8 章（页 515）、第 9 章（页 578）也在 470 之后，同样没读到。
 * 一句话少说两章，读者会以为只有第十章空着。
 */
export const HB_SCOPE =
  `读到的是上册第 1—7 章，止于页 ${HB_TEXT_END}（§7.5 中途）。上册第 8、9 章（页 515、578 起）与下册第 10—12 章（页 625 起）都没读到。`;

export const HB_CHECKS: HbCheck[] = [
  {
    claimId: 'T1-01',
    section: '1.1',
    verdict: 'confirm',
    says: '论证既是过程也是结果：既是消除意见分歧的交际行为复合体，又是为立场提出的一组命题（页 1—5）。',
    gap: '两层都认。「不重合」手册也写明了：论证不含立场本身，只管为立场提出的那组命题（页 4）。',
  },
  {
    claimId: 'T1-02',
    section: '1.1',
    verdict: 'narrow',
    says: '论证须针对真实或预期的意见分歧、由说话者担责、诉诸理性裁判；不指向消除分歧的交际活动不算论证。',
    gap: '判据有；抒情、提问、命令、口号逐项点名没有——那五类是工具照判据归纳的清单。',
  },
  {
    claimId: 'T1-07',
    section: '1.3.4',
    verdict: 'narrow',
    says: '论证结构分单一、多重（并列支撑同一立场，原则等权、互不依赖）、并列复合与从属复合四类。',
    gap: '结构区分有文献；「一条断了，其余各剩多少」这个算法没有——那是本工具的算术，不是手册的。',
  },
  {
    claimId: 'T1-08',
    section: '7.5',
    verdict: 'narrow',
    says: '戈维尔主张「适度宽容原则」：除非有明确理由，应选那个使对方主张最可能正确、推论最可能合理的解释。',
    gap: '手册译作「宽容原则」不叫「善意原则」；且戈维尔按论证型式补省略前提，本库用「不假定就推不出」这一条更窄的判据。',
  },
  {
    claimId: 'T2-02',
    section: '7.3',
    verdict: 'narrow',
    says: '约翰逊与布莱尔（1977/1983/2006）提出相关性、可接受性、充分性三条标准，违反其中一条即为谬误性论证。',
    gap: '三条并列是文献；「不是并列打分项、而是一条漏斗」是工具的顺序化处理，手册里没有这个比喻。',
  },
  {
    claimId: 'T2-04',
    section: '7.3',
    verdict: 'confirm',
    says: '可接受性被用来替代「真」这个标准：汉布林认为「真」既不充分也不必要（页 454）。',
    gap: '手册还记了约翰逊后来主张把「真」加回来，以及两条标准可能互相打架——本库这条没提这一层。',
  },
  {
    claimId: 'T2-05',
    section: '1.3.4',
    verdict: 'confirm',
    says: '弗里曼把挑战者的提问分三类：可接受性、相关性、证据充分性，每一类导出不同的论证结构。',
    gap: '三类与本库三问对得上；弗里曼原书那一节（§7.7，页 477 起）在本次范围外，没逐字核。',
  },
  {
    claimId: 'T2-06',
    section: '4.5',
    verdict: 'confirm',
    says: '图尔敏分「领域不变要素」与「领域依赖要素」：程序与形式跨领域，具体要素随领域而变（页 247）。',
    gap: '与库里一致。手册说的是要素与可靠性随领域变，没有给阈值；库里也没给，只把阈值交给论证负担。',
  },
  {
    claimId: 'T2-07',
    section: '10.5',
    verdict: 'absent',
    why: 'no-text',
    says: '语用论辩的讨论规则在 §10.5；正文没读到。',
    gap: '所以「责任可以转移、但不会消失」这半句没有手册原文兜着，只有第 1 章概览里的一句连带说法。',
  },
  {
    claimId: 'T2-08',
    section: '7.3',
    verdict: 'narrow',
    says:
      '约翰逊本人承认「论辩性外层」的评估标准仍不明确，戈维尔批评这套要求不可操作、会导向无穷倒退（页 452 起）。',
    gap:
      '手册说的是「该回应哪些反对意见」这一层的充分性，不是前提够不够支撑结论；两边都指向「没有通用阈值」。「阈值来自论证负担与后果严重程度」这个可操作方向是本工具给的。',
  },
  {
    claimId: 'T2-11',
    section: '7.3',
    verdict: 'dispute',
    says: '手册记载比罗与西格尔的批评：「相关性」是「充分性」的特例，是一条多余的标准（页 453）。',
    gap: '这条被文献正面顶着。本工具仍坚持三关分开作答，理由是「补哪一关」的行动指引，不是文献结论。',
  },
  {
    claimId: 'T3-01',
    section: '1.3.3',
    verdict: 'narrow',
    says: '论证型式是对论证类型的抽象描述，靠与它配套的批判性问题来评价；它是形式有效标准的补充，不取代它。',
    gap: '「两个不同型式可以有同一逻辑形式」手册没这么表述——那是库里的推论，手册只说型式不是形式标准。',
  },
  {
    claimId: 'T3-02',
    section: '1.3.3',
    verdict: 'confirm',
    says:
      '论证型式是对某类论证的抽象描述；每一类型式都要明确「用来评价论证本身的评价性问题」，也就是批判性问题。',
    gap: '一致。手册没说「检查项应当逐条由 CQ 生成」——那是本工具把它落到检查表上的做法。',
  },
  {
    claimId: 'T3-05',
    section: '1.3.3',
    verdict: 'narrow',
    says: '型式靠前提与立场之间的一种特定关系成立；要判就得先认出这层关系，手册没给形式判据。',
    gap:
      '「因此无法可靠自动化」是本工具的工程判断，手册不讨论自动化。库里把型式降级为检索入口，正是为了不让识别错误直接变成判定错误。',
  },
  {
    claimId: 'T3-06',
    section: '7.8',
    verdict: 'absent',
    why: 'no-text',
    says: '沃尔顿论论证型式与对话类型在 §7.8；正文没读到。',
    gap: '库里这条 refs 写的是「本工具的判断」，本来就没有文献；手册若有一句，也只可能在 §7.8。',
  },
  {
    claimId: 'T3-07',
    section: '1.3.3',
    verdict: 'narrow',
    says: '论证型式是对某种论证类型的抽象描述，靠批判性问题来评价；沃尔顿列出 25 种，其中一类基于类比与先例。',
    gap: '手册只到「型式 + 批判性问题」这一层；「相似点必须落在担保上」在沃尔顿那一节（§7.8，页 483 起），本次没核。',
  },
  {
    claimId: 'T4-01',
    section: '10.5',
    verdict: 'absent',
    why: 'no-text',
    says: '十规则的原文在 §10.5；正文没读到。',
    gap:
      '「对广告、社论、带货话术套十规则是范畴错误」这半句没有手册原文兜着；第 1 章概览只说到论证指向消除分歧，没到「否则即范畴错误」这一步。',
  },
  {
    claimId: 'T4-02',
    section: '7.8',
    verdict: 'absent',
    why: 'no-text',
    says: '对话类型如何约束招式合法性，手册在 §7.8 与下册第十章讲；两处正文都没读到。',
    gap: '库里把 dialogueType 做成参与判定的字段，手册依据核不到。',
  },
  {
    claimId: 'T4-05',
    section: '1.1',
    verdict: 'narrow',
    says:
      '论证不是独白的一部分，而是互动行为复合体；受话人可以是隐性的——没参与互动的听众，甚至不存在的读者（页 2—3）。',
    gap:
      '手册认为对方可以隐含，本工具要求显式立场（opposingPosition）。没有显式对方时逐条评十规则，等于替文本编一个对手，所以宁判不适用。这条差异是有意留的，不是漏读。',
  },
  {
    claimId: 'T4-03',
    section: '5.4',
    verdict: 'confirm',
    says: '新修辞学从听众讲起：说服与信服之分由听众类型（特殊／普遍）定，可靠性最终取决于目标听众（页 309）。',
    gap: '意思一致。手册把听众说成论证者的「建构」；库里说「判定参数」，是同一件事的另一种说法。',
  },
  {
    claimId: 'T4-06',
    section: '3.5',
    verdict: 'confirm',
    says: '复杂问语：要回答这个问题，必须同时回答另一个问题；这种谬误只有放到对话里才分析得清（页 190）。',
    gap: '与库里的处理一致；「先改成陈述句再谈」这一步手册没给，那是本工具的做法。',
  },
  {
    claimId: 'T4-10',
    section: '3.5',
    verdict: 'narrow',
    says: '毛病在预设：答是或否都认下了那个预设；手册给的办法是指出相互纠缠的预设，亚里士多德还允许把问拆开（页 190）。',
    gap: '「先改成陈述句、看双方接不接受」这一步手册没有；它给的是拆问与指出预设。',
  },
  {
    claimId: 'T5-01',
    section: '3.6',
    verdict: 'narrow',
    says: '汉布林：我们根本没有谬误理论；「看似有效而实际无效」这个标准定义与它要处理的谬误对不上（页 196）。',
    gap: '定义受质疑有原文；「三个必要条件逐条被质疑」是库里的整理，手册给的是这个定义的反例。',
  },
  {
    claimId: 'T5-02',
    section: '3.4',
    verdict: 'confirm',
    says:
      '同一名称被不同作者用来指整个诉诸人身或它的变体（页 188）；汉布林也说多数谬误与定义对不上（§3.6，页 196）。',
    gap: '条目重叠与清单不封闭都有文献；「名录只作教学对照、不宣称覆盖」这个用法是本工具的决定。',
  },
  {
    claimId: 'T5-04',
    section: '3.6',
    verdict: 'narrow',
    says:
      '汉布林：标准处理把谬误收进「短章或附录」，是一堆没有理论的名字——「我们根本没有谬误理论」（页 195—196）。',
    gap: '「命名会带走注意力、预设反驳方向」是本工具从这条批评里读出的操作含义；手册只批「没有理论」，没写这两个后果。',
  },
  {
    claimId: 'T5-05',
    section: '3.5',
    verdict: 'absent',
    why: 'no-section',
    says: '伍兹的资源约束解释一路，手册只在第 1 章概述里点了一句（页 25）；§3.5 里没有对应段落。',
    gap: '库里这条出处写 Woods；手册帮不上忙，只能回 Woods 原书。「认知资源有限是常态成因」这一段没核到。',
  },
  {
    claimId: 'T5-06',
    section: '3.4',
    verdict: 'narrow',
    says: '诉诸人身因攻击对方人品而非其论证才成为谬误——手册把问题定在攻击的那一方（页 189）。',
    gap: '手册讲的是说话者一侧；「听者据身份打折，缺陷在听者」这半句是 Fricker 那一路，手册不引，没核。',
  },
  {
    claimId: 'T5-07',
    section: '3.5',
    verdict: 'confirm',
    says: '滑坡是因果论证的一种：对拟采取的行动推出一串毫无根据、被推向极端的后果（页 194）。',
    gap: '手册把问题定在「推测毫无根据」；库里要求「指认断点」是更可操作的说法，比手册细。',
  },
  {
    claimId: 'T5-09',
    section: '2.4.2',
    verdict: 'narrow',
    says: '亚里士多德的清单只分两种：语词层的歧义（一词多义）与语句层的模棱两可。',
    gap: '本库分三种（歧义／模糊／笼统），比手册多一层；多出来的那层是本工具的整理，手册没有对应的三分。',
  },
  {
    claimId: 'T6-02',
    section: null,
    verdict: 'own',
    says: '不是文献命题：refs 那一栏写的就是「本工具的判断」，手册里没有对应的一节。',
    gap: '所以这条没有文献兜着。它管的是可信度判断要不要走边界检查，属于本工具的行为约定。',
  },
  {
    claimId: 'T8-03',
    section: null,
    verdict: 'outside',
    says: '十二章目录里没有批判性思维教育这一支，保罗—埃尔德八要素不在其中。',
    gap: '要核只能回原书（Paul & Elder 2006）。界面标「本书范围外」，不标「本次未核到」——两件事不一样。',
  },
  {
    claimId: 'T8-09',
    section: null,
    verdict: 'outside',
    says: '批判性思维里「问题框架本身是立场」这一支（question-at-issue）不在十二章目录里。',
    gap: '同上：要核得回去看保罗与埃尔德、恩尼斯；这本书讲的是论证理论各家，不是批判性思维课程。',
  },
  {
    claimId: 'T9-04',
    section: null,
    verdict: 'outside',
    says: '十二章目录里讲的是论辩理论各家，没有解释学这一支，加达默尔的前见不在其中。',
    gap: '最接近的是第 9 章语言学进路，但那讲的是语义语用，不是解释学。这条的页码只能回原书找。',
  },
  {
    claimId: 'T9-12',
    section: null,
    verdict: 'outside',
    says: '韦伯的「说明」与「理解」之分不在十二章目录里，这本书不处理那条德国传统。',
    gap: '所以「本工具只做说明」这一步没有本书的页码可指，出处仍是韦伯与狄尔泰的原书。',
  },
  {
    claimId: 'T10-02',
    section: '12.18',
    verdict: 'absent',
    why: 'no-text',
    says: '下册 §12.18「中国的论证研究」是本书唯一可能谈到墨家的地方；正文没读到。',
    gap: '所以墨家三层对得上手册哪一页，现在答不了，只能说这本书里有一节叫这个名字——未核。',
  },
  {
    claimId: 'T10-05',
    section: '12.18',
    verdict: 'absent',
    why: 'no-text',
    says: '《荀子·正名》与「中国的论证研究」在 §12.18；正文没读到。',
    gap: '「名定而实辨」与命名纪律同向这一层，没有手册页码可指；出处仍是《荀子》原书。',
  },
];

const BY_ID = new Map(HB_CHECKS.map((c) => [c.claimId, c]));
const SECTION_BY_ID = new Map(HANDBOOK_SECTIONS.map((s) => [s.id, s]));

/** 某条主张的手册核对；没核过的返回 null（界面就不显示那一块）。 */
export function hbOf(claimId: string): HbCheck | null {
  return BY_ID.get(claimId) ?? null;
}

export function hbSectionOf(id: string): HbSection | null {
  return SECTION_BY_ID.get(id) ?? null;
}

/**
 * 一句位置话：有目录页码的写页码，没有的只写节号。
 * 不在这里凑数字——页码缺一个，读者最多少看一个数；编一个，他就核不了。
 *
 * 判「本书范围外」「无文献可核」时不写节号：那两种结论的意思恰恰是「没有这一页」。
 */
export function hbLocator(c: HbCheck): string {
  if (c.section === null) return c.verdict === 'own' ? '无文献可核' : '本书范围外';
  const s = SECTION_BY_ID.get(c.section);
  if (!s) return `§${c.section}`;
  const vol = s.volume === 1 ? '上册' : '下册';
  return s.page === null ? `${vol} §${s.id}` : `${vol} §${s.id}（页 ${s.page} 起）`;
}

/**
 * 「为什么没核到」那一行。只有「本次未核到」有。
 *
 * 句子由这里生成，不写在数据里：七条未核到要是各写一句，就会出现七种口径，
 * 有的说「范围外」有的说「没读到」，读者分不清是同一种情况还是七种。
 * 数也是算出来的——「还差 172 页」是页 642 减文本末尾 470，不是抄来的。
 */
export function hbGapLine(c: HbCheck): string | null {
  if (c.verdict !== 'absent' || !c.why) return null;
  const s = c.section === null ? undefined : SECTION_BY_ID.get(c.section);
  if (c.why === 'no-text') {
    if (s?.page == null) {
      return `整节没进这份解析文本（文本止于页 ${HB_TEXT_END}）——不是节里没这段话，是整册没读到。`;
    }
    const behind = s.page - HB_TEXT_END;
    const far = behind > 0 ? `，还差 ${behind} 页` : '';
    return `文本止于页 ${HB_TEXT_END}，这一节在页 ${s.page} 起${far}——不是节里没这段话，是整册没读到。`;
  }
  const head = s?.page == null ? '这一节' : `这一节（页 ${s.page} 起）`;
  return `${head}这次读到了，节里没有讲这一段的段落——是这一段书里没写，不是没读到。`;
}

/**
 * 说法与页码必须自洽。检查器逐条拿它判，界面不显示。
 *
 * 页在文本末尾之后的节，只可能是「整节没进文本」；页在末尾之前的节，
 * 既然读到了，就只能说「节里没有」。这条互推关系挡的是拍脑袋：
 * 以后新增一条未核到，写错类别会当场红，而不是等读者发现「页 190 的节怎么会没读到」。
 */
export function hbGapFits(c: HbCheck): boolean {
  if (c.verdict !== 'absent') return c.why === undefined;
  if (!c.why) return false;
  const s = c.section === null ? undefined : SECTION_BY_ID.get(c.section);
  const page = s?.page ?? null;
  // 目录没给起页，就说不清「整节没进文本」还是「节里没有」——不许猜。
  if (page === null) return false;
  return c.why === 'no-text' ? page > HB_TEXT_END : page <= HB_TEXT_END;
}

export function hbStats(): { total: number; byVerdict: Record<HbVerdict, number> } {  const byVerdict = {
    confirm: 0,
    narrow: 0,
    dispute: 0,
    absent: 0,
    outside: 0,
    own: 0,
  } as Record<HbVerdict, number>;
  for (const c of HB_CHECKS) byVerdict[c.verdict] += 1;
  return { total: HB_CHECKS.length, byVerdict };
}

/**
 * 账目：全库多少条、核过多少条、还差多少条。
 *
 * 为什么要把「没核的」也写出来：界面上一百多条主张，只有二十几条挂着「手册核对」。
 * 其余那些不是「核过没问题」，是「根本没核」——不把这句话说清楚，那一块的颜色
 * 就会被当成对全书的态度。
 */
export function hbCoverage(totalClaims: number): {
  total: number;
  checked: number;
  unchecked: number;
  byVerdict: Record<HbVerdict, number>;
} {
  const { total: checked, byVerdict } = hbStats();
  const total = Math.max(totalClaims, checked);
  return { total, checked, unchecked: Math.max(0, total - checked), byVerdict };
}

/** 给一组主张 id，返回其中还没有核对条目的。检查组拿它守「写进提示词的必须核过」。 */
export function hbMissing(claimIds: string[]): string[] {
  return claimIds.filter((id) => !BY_ID.has(id));
}

/** 界面与导出共用的一句话，避免两处各写一份数字。 */
export function hbLine(): string {
  const { total, byVerdict } = hbStats();
  const parts = HB_VERDICT_ORDER.filter((v) => v !== 'confirm').map(
    (v) => `${HB_VERDICT_LABEL[v]} ${byVerdict[v]}`
  );
  return `已用手册核过 ${total} 条（${HB_VERDICT_LABEL.confirm} ${byVerdict.confirm}、${parts.join('、')}）`;
}

/** 类型守卫：库里有没有这条。给检查器与界面共用。 */
export function hbCovers(claims: TheoryClaim[], claimId: string): boolean {
  return claims.some((c) => c.id === claimId);
}
