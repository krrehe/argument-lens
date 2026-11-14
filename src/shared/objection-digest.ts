import type { Objection, ObjectionField } from './types';

/**
 * 「这一份里我不同意哪几处」——把散在报告各处的异议收成一条账。
 *
 * 为什么需要：异议按钮长在每一处判定旁边，记完之后它就变成那一行「你不同意」，
 * 看得见的是**当前这一屏**。一份报告两万像素、十几处能点「不同意」，
 * 记到第三条之后，人既不知道自己一共记了几条，也没法回到第一条去改口——
 * 界面里没有任何一处地方能回答「这份报告我反驳过哪几处」。
 *
 * 三条边界：
 *   · **只归类，不改判。** 这里没有一个「按我的意见重算」，也不把异议标成「正确」——
 *     它连「这条异议成立不成立」都不判断，只回答「记过没记过、记在哪一节」。
 *   · **不丢记录。** 认不出 field 的旧记录照样计数，进「位置不明」那一组：
 *     静默省略会让「3 条」与「界面上看得见 2 条」同时成立，那种不一致最难查。
 *   · **同一处只算一条。** 跨报告的身份是 key（透镜 + 位置 + 被反对的那句话）；
 *     同一份里同一个 key 出现两次是重复写入，不是「反对了两次」。
 */

interface DigestGroupMeta {
  field: ObjectionField;
  /** 报告里对应区块的 id；null 表示这一条不是从报告页记的，跳不过去 */
  sectionId: string | null;
  title: string;
}

/**
 * 分组顺序固定，与报告从上往下的阅读顺序一致：
 * 判读在首屏、检查项在中间、命名与「此处合法」靠后。
 * 不按条数排序——按数量排会让面板的顺序随今天记了几条而变，第二天找不到昨天那条。
 */
const GROUP_META: DigestGroupMeta[] = [
  { field: 'verdict', sectionId: 'sec-verdict', title: '判读' },
  { field: 'check', sectionId: 'sec-checks', title: '逐关检查' },
  { field: 'label', sectionId: 'sec-labels', title: '命名' },
  { field: 'legitimate', sectionId: 'sec-legit', title: '此处合法' },
  { field: 'defeat', sectionId: 'sec-defeat', title: '击败类型' },
  /* 工作台里钉在字段或原文句子上的异议：同属这份报告，但不在报告页的任何一栏里。 */
  { field: 'anchor', sectionId: null, title: '在工作台里钉的' },
];

/** 认不出的 field（旧版本写下的、或将来新增的）落到这里，不静默省略。 */
const UNKNOWN_ID = '__unknown';
const UNKNOWN_TITLE = '位置不明';

export interface DigestSection extends DigestGroupMeta {
  items: Objection[];
  /** 这一组里有认不出位置的记录；界面上要写明，别让它看起来像正常分组 */
  unknown?: boolean;
}

export interface ObjectionDigest {
  total: number;
  sections: DigestSection[];
  /** 有记录但 field 认不出来的条数（它们进了「位置不明」那一组） */
  unknown: number;
}

const META_OF = new Map<string, DigestGroupMeta>(GROUP_META.map((m) => [m.field, m]));

/**
 * 取某一份报告的异议账。
 *
 * `diagId` 必须非空：空 id 会把所有「没有报告 id」的历史记录都算到当前这份上，
 * 那是一条看起来像数据的假账。
 */
export function digestOf(list: Objection[], diagId: string): ObjectionDigest {
  const empty: ObjectionDigest = { total: 0, sections: [], unknown: 0 };
  if (!diagId || !Array.isArray(list) || !list.length) return empty;

  /* 按 key 去重，留最新的那条（同一处被重复写入时，后写的理由是用户最后的意思）。 */
  const byKey = new Map<string, Objection>();
  for (const o of list) {
    if (!o || typeof o !== 'object') continue;
    if (o.diagId !== diagId) continue;
    if (typeof o.key !== 'string' || !o.key) continue;
    const prev = byKey.get(o.key);
    if (!prev || (typeof o.at === 'number' && o.at >= prev.at)) byKey.set(o.key, o);
  }
  if (!byKey.size) return empty;

  const buckets = new Map<string, DigestSection>();
  let unknown = 0;
  for (const o of byKey.values()) {
    const meta = META_OF.get(o.field);
    if (!meta) unknown += 1;
    /* 认不出的 field 共用「位置不明」一组：计数不丢，界面上也不冒充正常分组。 */
    const id = meta ? `${meta.field}:${meta.sectionId ?? ''}` : UNKNOWN_ID;
    let b = buckets.get(id);
    if (!b) {
      b = meta
        ? { ...meta, items: [] }
        : { field: 'check', sectionId: null, title: UNKNOWN_TITLE, items: [], unknown: true };
      buckets.set(id, b);
    }
    b.items.push(o);
  }

  /* 组内按时间倒序（最近记的在上），同一时刻按 key 定序：两份同样的账必须逐字节一致。 */
  for (const b of buckets.values()) {
    b.items.sort((x, y) => {
      const ax = typeof x.at === 'number' ? x.at : 0;
      const ay = typeof y.at === 'number' ? y.at : 0;
      if (ax !== ay) return ay - ax;
      return x.key < y.key ? -1 : x.key > y.key ? 1 : 0;
    });
  }

  const sections = GROUP_META.map((m) => buckets.get(`${m.field}:${m.sectionId ?? ''}`))
    .filter((b): b is DigestSection => !!b && b.items.length > 0);
  const odd = buckets.get(UNKNOWN_ID);
  if (odd) sections.push(odd);

  const total = sections.reduce((n, s) => n + s.items.length, 0);
  return { total, sections, unknown };
}

/** 一句话说清这条账：只数事实，不评价这些异议对不对。 */
export function digestLine(d: ObjectionDigest): string {
  if (!d.total) return '这份报告里没有记下不同意见。';
  const where = d.sections.filter((s) => s.sectionId).length;
  return `这份报告里记了 ${d.total} 条不同意见，分布在 ${where} 处。`;
}
