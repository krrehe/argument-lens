import type { TheoryClaim } from './theory-base';

/**
 * 手册核对层。
 *
 * 为什么单立一层：主张库的 `refs` 写的是「SEP」「某本教材」，读者核不到具体一句话——
 * 那是「我知道有这回事」，不是「你可以去这一页看」。范爱默伦等《论证理论手册》
 * （中译本，中国社会科学出版社 2020，上下册）有章有节、目录带起页，能把一条主张
 * 指到「第 7.3 节，页 452 起」这种可以当面翻开的地址。
 *
 * 这一层只做一件事：**手册怎么看这条主张**。四种结论分开写——
 *   confirm 文献确认（意思对得上）
 *   narrow  文献只说一半（另一半是本工具的整理，得认下来）
 *   dispute 文献有反对（这条被批评顶着，必须让读者知道）
 *   absent  本次没核到（不在读到的范围内，不猜）
 *
 * 它不改判定、不改分档、不改提示词，也不替主张库说话。库里那条该是什么档还是什么档；
 * 核对表里没有 tier 字段，就是为了让「核对过一次」不等于「升了一档」。
 *
 * 页码的规矩：**只抄目录**。目录里给了起页的才写，没给的（1.3.3 / 1.3.4 / 2.4.2 这些
 * 节在目录里只到 1.3、2.4 这一层）就留空——宁可少一个数字，不要多一个自己算出来的数字。
 * 这一条由 check:theory-handbook 把关：核对条目里的页码必须与 HANDBOOK_SECTIONS 逐字相同。
 */

export type HbVerdict = 'confirm' | 'narrow' | 'dispute' | 'absent';

export const HB_VERDICT_LABEL: Record<HbVerdict, string> = {
  confirm: '文献确认',
  narrow: '文献只说一半',
  dispute: '文献有反对',
  absent: '本次未核到',
};

export const HB_VERDICT_HINT: Record<HbVerdict, string> = {
  confirm: '手册这一节说的和本条主张对得上',
  narrow: '手册只支持一半，另一半是本工具的整理',
  dispute: '手册记载的批评正面顶着本条主张',
  absent: '这一节不在本次读到的范围里，没有核',
};

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
  { id: '1.3.3', title: '用于描述论证类型的论证型式', volume: 1, page: null },
  { id: '1.3.4', title: '作为逻辑实体与功能实体的论证结构', volume: 1, page: null },
  { id: '2.4.2', title: '亚里士多德的谬误清单', volume: 1, page: null },
  { id: '3.5', title: '标准谬误处理', volume: 1, page: 190 },
  { id: '7.3', title: '布莱尔和约翰逊对非形式逻辑的贡献', volume: 1, page: 452 },
  { id: '7.5', title: '戈维尔对非形式逻辑核心议题的理论探讨', volume: 1, page: 465 },
  { id: '10.5', title: '批判性讨论规则', volume: 2, page: 642 },
];

export interface HbCheck {
  /** 主张库里的 id。必须真存在，否则这条核对挂在空处 */
  claimId: string;
  /** 手册节号，必须在 HANDBOOK_SECTIONS 里 */
  section: string;
  /** 结论。四种，没有第五种 */
  verdict: HbVerdict;
  /** 手册在这一节说了什么（转述，不是原文摘录） */
  says: string;
  /** 与本库这条的差：多了什么、少了什么、顶在哪里 */
  gap: string;
}

/**
 * 覆盖范围。写在界面上，也写在文档里——同一句话，两处不许各写一份。
 */
export const HB_SCOPE =
  '这次核到的是中译本上册第 1—7 章（页 1—470）。下册第 10 章（语用论辩，页 625 起）没读到，凡指到那里的条目一律标「本次未核到」，不猜。';

export const HB_CHECKS: HbCheck[] = [
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
    claimId: 'T2-07',
    section: '10.5',
    verdict: 'absent',
    says: '语用论辩的讨论规则在第十章的 §10.5（页 642 起）；本次只读到上册页 470，这一节没读到。',
    gap: '所以「责任可以转移、但不会消失」这半句没有手册原文兜着，只有第 1 章概览里的一句连带说法。',
  },
  {
    claimId: 'T2-11',
    section: '7.3',
    verdict: 'dispute',
    says: '手册记载比罗与西格尔的批评：「相关性」是「充分性」的特例，是一条多余的标准（页 453）。',
    gap: '这条被文献正面顶着。本工具仍坚持三关分开作答，理由是「补哪一关」的行动指引，不是文献结论。',
  },
  {
    claimId: 'T3-07',
    section: '1.3.3',
    verdict: 'narrow',
    says: '论证型式是对某种论证类型的抽象描述，靠批判性问题来评价；沃尔顿列出 25 种，其中一类基于类比与先例。',
    gap: '手册只到「型式 + 批判性问题」这一层；「相似点必须落在担保上」在沃尔顿那一节（§7.8，页 483 起），本次没核。',
  },
  {
    claimId: 'T4-06',
    section: '3.5',
    verdict: 'confirm',
    says: '复杂问语：要回答这个问题，必须同时回答另一个问题；这种谬误只有放到对话里才分析得清（页 190）。',
    gap: '与库里的处理一致；「先改成陈述句再谈」这一步手册没给，那是本工具的做法。',
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
 */
export function hbLocator(c: HbCheck): string {
  const s = SECTION_BY_ID.get(c.section);
  if (!s) return `§${c.section}`;
  const vol = s.volume === 1 ? '上册' : '下册';
  return s.page === null ? `${vol} §${s.id}` : `${vol} §${s.id}（页 ${s.page} 起）`;
}

export function hbStats(): { total: number; byVerdict: Record<HbVerdict, number> } {
  const byVerdict: Record<HbVerdict, number> = { confirm: 0, narrow: 0, dispute: 0, absent: 0 };
  for (const c of HB_CHECKS) byVerdict[c.verdict] += 1;
  return { total: HB_CHECKS.length, byVerdict };
}

/** 界面与导出共用的一句话，避免两处各写一份数字。 */
export function hbLine(): string {
  const { total, byVerdict } = hbStats();
  return `已用手册核过 ${total} 条：确认 ${byVerdict.confirm}、只说一半 ${byVerdict.narrow}、有反对 ${byVerdict.dispute}、未核到 ${byVerdict.absent}`;
}

/** 类型守卫：库里有没有这条。给检查器与界面共用。 */
export function hbCovers(claims: TheoryClaim[], claimId: string): boolean {
  return claims.some((c) => c.id === claimId);
}
