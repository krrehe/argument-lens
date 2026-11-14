import type { Claim, Diagnosis } from './types';
import { ACCEPT_LABEL, CONF_LABEL, STRATEGY_LABEL } from './labels';

/**
 * 枢纽前提：这一段里，哪一条是「被当成起点用的争点」。
 *
 * 为什么要有这一栏：
 *
 * 命题账回答「每条主张该由什么来定」，可它不回答另一个更要紧的问题——
 * **这一段是靠哪一条撑着的**。日常批评最容易犯的错，是指出十个措辞毛病
 * （用词不准、举例太少、口气太满），而那些毛病全在枝叶上；真正让整段垮掉的，
 * 往往是作者当成「大家都知道」的那一句。指出十处枝叶，不如指出一次
 * 「你把 X 当前提用了，而 X 正是要争的那件事」。
 *
 * 所以这一栏只做两件事：
 *   1. 顺着报告已落盘的 supports 走一遍，看结论到底压在谁身上（承重）；
 *   2. 数一数这条身上有几**种**独立的「有人会不同意」的记录（争点）。
 * 两样都有的，就是枢纽。
 *
 * 三条硬边界：
 *
 *   1. **不新算判定。** 承重只看 supports，争点只看已落盘的
 *      acceptability / confidence / refutations / implicit，外加一处字面重合
 *      （并明说它是按字面算的）。不调模型、不改 verdict。
 *   2. **不打分。** 排序按三件能逐条说出来的事（能不能到结论 → 有没有替补 →
 *      有几种独立的争点信号），没有权重、没有总分。信号多不等于更假，
 *      只等于更该先看——这句要写在界面上。
 *   3. **写不出位置就不写。** 一条命题若连不到结论，它不进「枢纽」候选，
 *      而是进「吵得热闹但改不了判定」那一组——那一组同样有用：
 *      它告诉你哪些争论其实是白费的。
 */

/** 争点信号的种类。同一种信号记多次只算一种（两条反驳打在同一处，仍是一种）。 */
export type PivotSignalKind = 'acceptability' | 'confidence' | 'refutation' | 'implicit' | 'circular';

export interface PivotSignal {
  kind: PivotSignalKind;
  /** 逐条写清来源与内容。只给类名等于什么也没说。 */
  text: string;
}

/**
 * 归类。四类之外还有一个 `silent`（既不承重也没人争），只计数、不列出。
 *
 * 它们不是一条尺子的四档：`pivot` 是「该先看这里」，`noisy` 是「这里可以不看」，
 * `sole` 是「没人看但必须看」，`support` 是「正常承重」。
 */
export type PivotKind = 'pivot' | 'sole' | 'noisy' | 'support' | 'silent';

export interface PivotRow {
  id: string;
  role: Claim['role'];
  roleLabel: string;
  text: string;
  implicit: boolean;
  /** 到结论要经过几步（1 = 直接支撑结论）。null = 结论不经过它。 */
  steps: number | null;
  /** 它供给的那一步还有几个别的支撑者（取最小）。0 = 那一步只有它一个。 */
  substitutes: number | null;
  signals: PivotSignal[];
  /** 它一垮，谁跟着垮（含结论）。按报告顺序，不按重要性。 */
  falls: string[];
  kind: PivotKind;
  /**
   * 行首那两个字。排第一的承重争点叫「枢纽」，其余同类叫「争点」——
   * 三条都叫枢纽，等于说「三条都是要害」，那句话对读者没有用。
   */
  badge: string;
  /** 它为什么排在这儿。一句话，能被人拿去反驳。 */
  why: string;
}

export interface PivotView {
  /** 只含 pivot / sole / noisy 三种；support 与 silent 只进计数。 */
  rows: PivotRow[];
  /** 排第一的那一条。它可能是枢纽，也可能是孤柱（必经而无争）。 */
  top: PivotRow | null;
  /** 主句。没有可说的就不编一句。 */
  headline: string | null;
  line: string;
  /** 排序规则。必须写在界面上，否则「为什么它在第一」就成了黑箱。 */
  orderNote: string;
  counts: Record<PivotKind, number>;
  /** 建议先去核哪一条。一句话。 */
  nextToCheck: string | null;
}

const ROLE_LABEL: Record<Claim['role'], string> = {
  premise: '前提',
  intermediate: '中间结论',
  conclusion: '结论',
};

/** 结论在句子里通常叫「结论」，不叫「C」。 */
function nameOf(id: string, conclusionId: string): string {
  return id === conclusionId ? '结论' : id;
}

const ORDER_NOTE =
  '排序按三件已经记下来的事，依次比：①能不能走到结论 ②它供给的那一步有没有替补 ③有几种独立的争点信号（同一种算一种）。没有权重，也没有总分——信号多不等于更假，只等于更该先看。';

/**
 * 汉字二元组。去掉标点与空白再切：否则「，」与「。」的二元组会互相命中，
 * 让两段毫不相干的文字看起来重合。
 */
function bigrams(t: string): Set<string> {
  const s = (t ?? '').replace(/[\s\p{P}\p{S}]/gu, '');
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/**
 * 重合系数 = 交集 / 较短那一方的大小。
 *
 * 用「较短一方」而不是 Jaccard：把要证的结论原样搬成前提时，
 * 两者长度往往差很多（结论一句、前提一大段），Jaccard 会被长度摊薄，
 * 于是最典型的循环反而算不出来。
 */
function overlapCoeff(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  /* 少于 8 个二元组（约十个字）时，任何两句话都容易撞上一半，宁可不判。 */
  if (A.size < 8 || B.size < 8) return 0;
  let hit = 0;
  for (const x of A) if (B.has(x)) hit += 1;
  return hit / Math.min(A.size, B.size);
}

/** 报告里一条主张「支撑谁」。空数组按最朴素的重构处理：直接支撑结论。 */
function targetsOf(c: Claim, conclusionId: string): string[] {
  const raw = (c.supports ?? []).filter((x) => typeof x === 'string' && x.length > 0);
  return raw.length ? raw : [conclusionId];
}

/**
 * 承重：从这条出发，沿着 supports 能不能走到结论，几步。
 *
 * 走不通返回 null。**走不通就不进枢纽候选**——一条连不上结论的前提，
 * 再可疑也改不了判定；把它排在前面，等于把读者往岔路上带。
 */
function stepsToConclusion(
  from: string,
  graph: Map<string, string[]>,
  conclusionId: string
): number | null {
  if (from === conclusionId) return 0;
  /* BFS：环不会死循环（visited），最短步数才是「承重」的正解——
     一条要绕五步才到结论的前提，与一条直连结论的，不该并列。 */
  const seen = new Set<string>([from]);
  let frontier = [from];
  let depth = 0;
  while (frontier.length && depth < 12) {
    depth += 1;
    const next: string[] = [];
    for (const id of frontier) {
      for (const t of graph.get(id) ?? []) {
        if (t === conclusionId) return depth;
        if (seen.has(t)) continue;
        seen.add(t);
        next.push(t);
      }
    }
    frontier = next;
  }
  return null;
}

/** 它一垮，谁跟着垮：沿 supports 正向传递闭包。 */
function fallsWith(id: string, graph: Map<string, string[]>, order: string[]): string[] {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop() as string;
    for (const t of graph.get(cur) ?? []) {
      if (out.has(t)) continue;
      out.add(t);
      stack.push(t);
    }
  }
  out.delete(id);
  return order.filter((x) => out.has(x));
}

function signalsOf(d: Diagnosis, c: Claim, conclusionId: string): PivotSignal[] {
  const out: PivotSignal[] = [];
  const acc = c.acceptability;
  const conclusion = d.conclusion;

  if (acc.status === 'questionable' || acc.status === 'unacceptable') {
    out.push({
      kind: 'acceptability',
      text: `报告自己把它的可接受性标成「${ACCEPT_LABEL[acc.status] ?? acc.status}」：${acc.reason || '（没写理由）'}`,
    });
  }

  if (acc.confidence === 'low' || acc.confidence === 'very-low' || acc.confidence === 'undetermined') {
    out.push({
      kind: 'confidence',
      text: `置信只有「${CONF_LABEL[acc.confidence] ?? acc.confidence}」——这一条连报告自己都没把握`,
    });
  }

  const refs = (d.refutations ?? []).filter((r) => r.targetId === c.id);
  if (refs.length) {
    const how = [...new Set(refs.map((r) => STRATEGY_LABEL[r.strategy] ?? r.strategy))].join('、');
    out.push({
      kind: 'refutation',
      text: `有 ${refs.length} 条反驳直接打在它身上（${how}）——这不是「可能有问题」，是报告已经写出来的反对意见`,
    });
  }

  if (c.implicit) {
    out.push({
      kind: 'implicit',
      text: `它是补出来的前提：原文没有这一句${c.implicitBasis ? `，报告补的是「${c.implicitBasis}」` : ''}——认不认这一句，本身就是争点`,
    });
  }

  /* 结论自己不自比。 */
  if (c.id !== conclusionId) {
    const ov = overlapCoeff(c.text ?? '', conclusion?.text ?? '');
    if (ov >= 0.6) {
      out.push({
        kind: 'circular',
        text: `与结论字面重合 ${Math.round(ov * 100)}%——很可能是把要证的当成了前提（按字面二元组算的，不是语义判断）`,
      });
    }
  }

  return out;
}

export function pivotOf(d: Diagnosis): PivotView {
  const conclusionId = d?.conclusion?.id ?? 'C';
  const claims: Claim[] = [d.conclusion, ...(d.premises ?? []), ...(d.intermediate ?? [])].filter(
    (c): c is Claim => !!c && typeof c.id === 'string'
  );

  /* 同一个 id 出现两次只算一次：重复上账会把「几条压在它身上」算假。 */
  const uniq: Claim[] = [];
  const seen = new Set<string>();
  for (const c of claims) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    uniq.push(c);
  }

  const order = uniq.map((c) => c.id);
  /* 只有主张能支撑别人；结论不支撑自己。 */
  const graph = new Map<string, string[]>();
  for (const c of uniq) {
    if (c.role === 'conclusion') continue;
    graph.set(
      c.id,
      targetsOf(c, conclusionId).filter((t) => t !== c.id)
    );
  }

  /* 每一步有几个支撑者。算「替补」用：只有它一个，那一步就是单点。 */
  const supporters = new Map<string, Set<string>>();
  for (const c of uniq) {
    if (c.role === 'conclusion') continue;
    for (const t of graph.get(c.id) ?? []) {
      if (!supporters.has(t)) supporters.set(t, new Set());
      (supporters.get(t) as Set<string>).add(c.id);
    }
  }

  const counts: Record<PivotKind, number> = { pivot: 0, sole: 0, noisy: 0, support: 0, silent: 0 };
  const all: PivotRow[] = [];

  for (const c of uniq) {
    if (c.role === 'conclusion') continue;
    const steps = stepsToConclusion(c.id, graph, conclusionId);
    const targets = graph.get(c.id) ?? [];
    /* 替补 = 它供给的那几步里，替补最少的那个数。某一步只有它一个，就是 0。 */
    const substitutes = targets.length
      ? Math.min(...targets.map((t) => (supporters.get(t)?.size ?? 1) - 1))
      : null;
    const signals = signalsOf(d, c, conclusionId);
    const contested = signals.length > 0;
    const bearing = steps !== null;
    const sole = bearing && substitutes === 0;

    const kind: PivotKind = bearing
      ? contested
        ? 'pivot'
        : sole
          ? 'sole'
          : 'support'
      : contested
        ? 'noisy'
        : 'silent';
    counts[kind] += 1;

    const falls = bearing ? fallsWith(c.id, graph, order) : [];
    const fallsText = falls.length
      ? falls.map((f) => nameOf(f, conclusionId)).join('、')
      : '';

    const why = !bearing
      ? `结论不经过它——争赢这一处也改不了判定`
      : kind === 'pivot'
        ? `${steps} 步到结论${sole ? '，且那一步只有它一个支撑者' : `，那一步还有 ${substitutes} 个替补`}；身上有 ${signals.length} 种独立的争点信号`
        : kind === 'sole'
          ? `${steps} 步到结论，那一步只有它一个支撑者，而现在没人质疑它`
          : `${steps} 步到结论，有 ${substitutes ?? 0} 个替补，没人反对它`;

    all.push({
      id: c.id,
      role: c.role,
      roleLabel: ROLE_LABEL[c.role] ?? '主张',
      text: c.text,
      implicit: !!c.implicit,
      steps,
      substitutes,
      signals,
      falls,
      kind,
      badge: '',
      why: fallsText && bearing && fallsText !== '结论' ? `${why}；它一垮，${fallsText} 跟着垮` : why,
    });
  }

  /*
   * 排序：枢纽 → 孤柱 → 白吵。组内依次比 ①必经 ②信号种类数 ③报告顺序。
   * 没有一处是「加权」：每一项都能指到报告里的一行。
   */
  const rank: Record<PivotKind, number> = { pivot: 0, sole: 1, noisy: 2, support: 3, silent: 4 };
  const idx = new Map(order.map((id, i) => [id, i]));
  const rows = all
    .filter((r) => r.kind === 'pivot' || r.kind === 'sole' || r.kind === 'noisy')
    .sort(
      (a, b) =>
        rank[a.kind] - rank[b.kind] ||
        Number(a.substitutes !== 0) - Number(b.substitutes !== 0) ||
        b.signals.length - a.signals.length ||
        (idx.get(a.id) ?? 0) - (idx.get(b.id) ?? 0)
    );

  rows.forEach((r, i) => {
    r.badge =
      r.kind === 'pivot' ? (i === 0 ? '枢纽' : '争点') : r.kind === 'sole' ? '孤柱' : '白吵';
  });

  const top = rows[0] ?? null;
  const total = all.length;

  const line =
    total === 0
      ? '这份报告里没有可推敲的命题'
      : `共 ${total} 条主张｜承重且有争 ${counts.pivot}｜必经无争 ${counts.sole}｜吵了但不承重 ${counts.noisy}｜普通承重 ${counts.support}｜其余 ${counts.silent}`;

  let headline: string | null = null;
  if (top && top.kind === 'pivot') {
    const fall = top.falls
      .filter((f) => f !== conclusionId)
      .map((f) => nameOf(f, conclusionId));
    const tail = top.falls.includes(conclusionId)
      ? `它一垮，${fall.length ? `${fall.join('、')}与结论` : '结论'}跟着垮。`
      : '';
    headline = `这一段把「${top.id}」当前提用，而它本身是争点。${tail}`;
  } else if (top && top.kind === 'sole') {
    headline = `整段的结论只经过「${top.id}」一道门，而现在没有一条记录在质疑它。`;
  }

  let nextToCheck: string | null = null;
  if (top && top.kind === 'pivot') {
    nextToCheck = `先去核「${top.id}」本身，而不是它引出来的后果：把它当起点用，等于把要证的那一步跳过去了。`;
  } else if (top && top.kind === 'sole') {
    nextToCheck = `先去核「${top.id}」：它是必经之路，塌了没有替补——这一条比任何措辞毛病都值得查。`;
  } else if (top && top.kind === 'noisy') {
    nextToCheck = `没有哪一条争点真的压在结论上；先把这几处争完，判定也不会变。`;
  }

  return { rows, top, headline, line, orderNote: ORDER_NOTE, counts, nextToCheck };
}
