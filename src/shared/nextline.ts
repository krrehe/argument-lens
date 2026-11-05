/**
 * 「看完报告之后，你下一句想说什么」。
 *
 * 路线图第四节那条判据——十段真实文本，只记「看完之后下一句是什么」——
 * 写了一个月，一直是零输入。原因很具体：软件里从来没有一处地方收这句话，
 * 于是「多数人的下一句是不是『所以呢』」这个掉头条件到今天都无法触发。
 *
 * 这一层只做两件事：按原话存下、按原话数事实。
 *
 * **它不判断这句话是在提问、在抱怨，还是在要一个结论。**
 * 一旦软件替人分「这句算不算空泛追问」，这份记录就变成了另一份由本地口径写下的判定，
 * 而它要回答的恰恰是「人自己是怎么说的」——那只能逐字留着，让人自己读。
 *
 * 所以这里唯一的「分析」是逐字相同：完全一样的句子归一堆，只数出现几次。
 * 差一个字就不合并（「所以呢」与「所以呢？」是两句），因为判断两者算不算一句话
 * 需要语义，而语义不是这一层有权给出的东西。
 *
 * 与 @shared/portfolio 的分工：那个数「你试过几段文字」，这个数「你读完说了什么」。
 * 两个都只数事实，都不劝，都不给分。
 */

/** 一句话的上限。记的是一句反应，不是一份新文本；超过就不记，不静默截断。 */
export const NEXT_LINE_MAX = 500;

/** 存档里留多长的原文开头，只为让人在明细里认出「这是哪一次之后说的」。 */
export const NEXT_LINE_HEAD = 32;

export interface NextLineRecord {
  id: string;
  at: number;
  /** 用户原话。只在首尾去空白，内部一个字都不动。 */
  text: string;
  /** 这句话写在看完哪一份报告之后。报告可能被删，所以不靠它取原文。 */
  diagId: string;
  /** 那份报告的原文开头若干字，逐字来自原文；报告删了也还认得出来。 */
  passageHead: string;
  /** 当时用的是哪副透镜。只是一个字符串，这一层不认识透镜类型。 */
  theory: string;
}

export interface NextLineGroup {
  /** 逐字相同的那句话本身。 */
  text: string;
  count: number;
  /** 这一组最早 / 最近出现在什么时候。 */
  firstAt: number;
  lastAt: number;
}

export interface NextLineView {
  /** 存档里的记录条数（含空白的那些）。 */
  total: number;
  /** 去空白后为空的条数。它们不进明细，也不算「一句」。 */
  blanks: number;
  /** 真正说得出来的句子数。 */
  usable: number;
  /** 读不出来的行数，由主进程给，也含形状不对的记录。 */
  badLines: number;
  /** 明细，按时间降序。 */
  lines: NextLineRecord[];
  /** 逐字相同的组，只含出现两次以上的；按出现次数降序。 */
  groups: NextLineGroup[];
  /** 出现次数最多的那一句（可能是只出现一次的一句）。 */
  topText: string | null;
  topCount: number;
  firstAt: number | null;
  lastAt: number | null;
}

/**
 * 记一条之前先问一句：这句话能不能记。
 *
 * 返回 null 表示可以。返回一句话表示不能，而那句话要能原样显示给用户——
 * 写不进去却回一个正常的结果，是这个项目反复修的同一类毛病。
 */
export function nextLineIssue(text: unknown): string | null {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return '这一栏是空的，没有记。';
  if (t.length > NEXT_LINE_MAX) return `超过 ${NEXT_LINE_MAX} 字，没有记。这里记的是一句反应，不是一份新文本。`;
  return null;
}

/** 一行存档文本 → 一条记录。认不出来返回 null，由 jsonl 层计进坏行数。 */
export function parseNextLineRecord(v: unknown): NextLineRecord | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  if (typeof o.at !== 'number' || !Number.isFinite(o.at)) return null;
  if (typeof o.text !== 'string') return null;
  if (typeof o.diagId !== 'string') return null;
  return {
    id: o.id,
    at: o.at,
    text: o.text,
    diagId: o.diagId,
    passageHead: typeof o.passageHead === 'string' ? o.passageHead : '',
    theory: typeof o.theory === 'string' ? o.theory : '',
  };
}

/**
 * 把记录整理成一份账。
 *
 * badLines 从外面传，是因为这一层不碰文件：它要在纯 node 里能单测。
 * 传进来的数只会原样出现，不会被「修正」成好看的值。
 */
export function nextLinesOf(records: NextLineRecord[], badLines = 0): NextLineView {
  let bad = Number.isFinite(badLines) && badLines > 0 ? Math.floor(badLines) : 0;

  const valid: NextLineRecord[] = [];
  for (const r of records) {
    const parsed = parseNextLineRecord(r);
    if (!parsed) {
      bad += 1;
      continue;
    }
    valid.push(parsed);
  }

  /*
   * 固定顺序。这两行不能省：省掉之后，同一时刻两条记录的先后由目录顺序决定，
   * 而明细里的时间是唯一可核对的信息——它错了，整块账就不可信。
   */
  const ordered = [...valid].sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const map = new Map<string, NextLineGroup>();
  const lines: NextLineRecord[] = [];
  let blanks = 0;
  let firstAt: number | null = null;
  let lastAt: number | null = null;

  for (const r of ordered) {
    /* 只去首尾空白；中间的空格、标点、语气词一个字都不动。 */
    const text = r.text.trim();
    if (!text) {
      blanks += 1;
      continue;
    }

    /* 空白记录不进明细，也就不该影响时间跨度——「没有算进来」要体现在每一处。 */
    if (firstAt === null || r.at < firstAt) firstAt = r.at;
    if (lastAt === null || r.at > lastAt) lastAt = r.at;

    lines.push({ ...r, text });

    const g = map.get(text);
    if (g) {
      g.count += 1;
      g.firstAt = Math.min(g.firstAt, r.at);
      g.lastAt = Math.max(g.lastAt, r.at);
    } else {
      map.set(text, { text, count: 1, firstAt: r.at, lastAt: r.at });
    }
  }

  /*
   * 次数相同的时候按「最近一次说」排，最后按文字定序。
   * 最后那一项在数据里几乎用不到（并列到这里意味着次数与最近时间都相同），
   * 它在那儿是为了让输出不依赖 Map 的插入顺序——那份顺序来自上面两层排序，
   * 是这个模块自己造的，不该成为第三种依据。
   */
  const all = [...map.values()].sort(
    (a, b) => b.count - a.count || b.lastAt - a.lastAt || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0)
  );
  const groups = all.filter((g) => g.count >= 2);
  const usable = lines.length;

  return {
    total: valid.length,
    blanks,
    usable,
    badLines: bad,
    lines,
    groups,
    topText: all.length ? all[0].text : null,
    topCount: all.length ? all[0].count : 0,
    firstAt,
    lastAt,
  };
}

/**
 * 摆给用户看的那一行。**只陈述数目，不劝也不评价。**
 *
 * 不说「这句话太短」「换一种说法」。同一句话重复十次，正是这张账最该显示的东西——
 * 它是不是空泛，由读这句话的人判断，不由这一层判断。
 * fmt 由调用方给：shared 层不该知道本地时间怎么格式化。
 */
export function nextLineHead(v: NextLineView, fmt: (at: number) => string): string | null {
  if (v.total === 0 && v.badLines === 0) return null;
  const parts: string[] = [];
  if (v.usable === 0) {
    parts.push('本机还没有记下任何一句。');
  } else {
    parts.push(`本机记了 ${v.usable} 句「看完报告之后说的话」。`);
    if (v.groups.length > 0) {
      const repeated = v.groups.reduce((n, g) => n + g.count, 0);
      parts.push(`其中 ${v.groups.length} 组、共 ${repeated} 句是逐字相同的；出现最多的一句有 ${v.topCount} 次。`);
    }
    if (v.firstAt !== null && v.lastAt !== null && v.firstAt !== v.lastAt) {
      parts.push(`时间从 ${fmt(v.firstAt)} 到 ${fmt(v.lastAt)}。`);
    }
  }
  if (v.blanks > 0) parts.push(`有 ${v.blanks} 条是空的，没有算进来。`);
  if (v.badLines > 0) parts.push(`另有 ${v.badLines} 条读不出来，没有计入。`);
  return parts.join('');
}

/** 明细里的一行。文字只来自固定模板、时间与用户原话。 */
export function nextLineRow(r: NextLineRecord, index: number, fmt: (at: number) => string): string {
  return `${index}. ${fmt(r.at)} · ${r.text}`;
}

/**
 * 可复制的纯文本清单。没有结尾总结——
 * 加一句「看起来你更想要结论」就把这一层变成了它最不该变成的东西：
 * 一份替人解读自己那句话的报告。
 */
export function nextLineText(v: NextLineView, fmt: (at: number) => string): string {
  const head = nextLineHead(v, fmt) ?? '本机还没有记下任何一句。';
  return [head, '', ...v.lines.map((r, i) => nextLineRow(r, i + 1, fmt))].join('\n');
}
