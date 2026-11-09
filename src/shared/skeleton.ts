/**
 * 骨架缺口：这份报告把这段文字的结构接上了没有、哪里是空的。
 *
 * 为什么要有这一层：本机 103 份存档里 1998 处判定全部来自模型，本地独立产出的
 * **零处**。此前所有本地计算（图坐标、计数、聚合、导出、并排、口气复核）都在
 * 报告外面，报告正文一个字没被本地碰过。结果是一份「一路通过 + 一段评语」的体检，
 * 读起来和一段 AI 回话没有区别。
 *
 * 这一层把两类东西分开摆，**每一条都标明是谁说的**：
 *   · 本地算的：原文哪几句没有任何条目落到上面、支撑关系成不成环、一个前提都没列、
 *     说了不适用却把检查表填上。这些模型看不见——它不会回头数自己漏读了哪句。
 *   · 报告自己说的：检查表里那几条 `unanswered`。
 *
 * 关于 `unanswered` 必须写清的一件事：它在提示词里的定义是「文中无从判断」，
 * 是模型对**文本**的判断（这一环原文没交代），不是模型漏答。
 * 早先把它数成「模型没答 N 条」是误读，会把一份指认说成一份疏漏。
 * 界面上同一栏也写着「答『未回答』不是漏答」——两处说法必须一致，否则用户不知道该信谁。
 *
 * 它判的是「骨架接上了没有」，不是「这段话说得对不对」。后者本地做不到，
 * 所以缺口清零时的说法是「按这几项查没找到缺口」，而不是「没问题」。
 */
import { hitsOf } from './modal';
import { rereadOf } from './reread';
import type { Claim, Diagnosis } from './types';

/**
 * 推理连接词。
 *
 * 只用来数「原文里有几处显式的推理步」，不参与任何判定——一个连接词可能承前跨几句，
 * 与图上的连线数**不一一对应**。所以它只出现在并列事实里，不生成缺口。
 * 与 modal.ts 的四张口气表分开：那边读强度，这边读位置。
 */
export const STEP_MARKERS = [
  '所以',
  '因此',
  '于是',
  '由此可见',
  '可见',
  '这说明',
  '说明',
  '表明',
  '证明了',
  '证明',
  '这意味着',
  '由此',
  '正因为',
  '既然',
  '导致',
  '使得',
] as const;

export interface SkeletonFact {
  label: string;
  value: string;
}

export type GapKind =
  | 'off-scope'
  | 'scope-conflict'
  | 'no-premises'
  | 'cycle'
  | 'quiet-sentences'
  | 'hollow-checks';

/** 这条缺口是谁说的。界面必须分开显示，不能混成一类。 */
export type GapFrom = 'local' | 'report';

export interface SkeletonGap {
  kind: GapKind;
  from: GapFrom;
  /** 一句事实。里面每个数字都能对着原文或报告数出来。 */
  note: string;
  /** 要去看的位置：原文句子片段、主张 id、检查项编号。 */
  at: string[];
}

export interface Skeleton {
  /** 总述：一句话，数字全在里面。缺哪一块就不提哪一块，不拿 0 凑。 */
  line: string;
  facts: SkeletonFact[];
  gaps: SkeletonGap[];
  /** 缺口都为零时的说法。不许写成「没问题」。 */
  clearNote: string | null;
  count: {
    sentences: number;
    quiet: number;
    edges: number;
    marks: number;
    checks: number;
    passed: number;
    violated: number;
    /** 报告说「文中没交代这一环」的条数。这是判定，不是漏答。 */
    hollow: number;
    notApplicable: number;
  };
}

/**
 * 缺口的固定顺序：先把「根本没立起来」的放前面，再是「漏了原文」，最后是「空着的环节」。
 *
 * 顺序只由下面 push 的先后决定，**不再额外排序**——push 已经按这个次序时，
 * 一次 sort 是永远不会生效的代码，而为它写的断言会永远绿（第 42 轮栽过）。
 * 顺序本身仍有断言守着：同时有环和漏读的样本，环必须排在前。
 */
export const GAP_ORDER: GapKind[] = [
  'off-scope',
  'scope-conflict',
  'no-premises',
  'cycle',
  'quiet-sentences',
  'hollow-checks',
];

export const GAP_FROM_LABEL: Record<GapFrom, string> = {
  local: '本地数的',
  report: '报告自己说的',
};

/** 一句原文在一行里能露多少字。太长会把整块挤成一片。 */
const SNIP = 18;

function snip(text: string): string {
  const t = text.trim();
  return t.length > SNIP ? `${t.slice(0, SNIP)}…` : t;
}

/**
 * 支撑关系里的环。
 *
 * 报告里 supports 是「这条支撑谁」，所以 A→B、B→A 就是一个环：
 * 两条互相支撑，谁也不比谁更基础。这不是排版问题，是图上能看见的硬伤。
 * 返回的每条环都以同一个 id 收尾（`A → B → A`），人一眼能对上。
 */
export function findCycles(claims: Claim[]): string[][] {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const out: string[][] = [];
  const seen = new Set<string>();

  const walk = (id: string): void => {
    const st = state.get(id) ?? 0;
    if (st === 2) return;
    if (st === 1) {
      const at = stack.indexOf(id);
      if (at >= 0) {
        const cyc = [...stack.slice(at), id];
        /* 同一个环从不同入口走会得到同一组 id，用排序后的键去重，保留第一次遇到的那条路径。 */
        const key = [...new Set(cyc)].sort().join(',');
        if (!seen.has(key)) {
          seen.add(key);
          out.push(cyc);
        }
      }
      return;
    }
    const c = byId.get(id);
    if (!c) return;
    state.set(id, 1);
    stack.push(id);
    for (const t of c.supports ?? []) walk(t);
    stack.pop();
    state.set(id, 2);
  };

  for (const c of claims) walk(c.id);
  return out;
}

export function skeletonOf(d: Diagnosis): Skeleton {
  const rv = rereadOf(d);
  const sentences = rv.sentences;
  const quiet = sentences.filter((s) => s.quiet);

  const claims: Claim[] = [d.conclusion, ...(d.premises ?? []), ...(d.intermediate ?? [])].filter(
    (c): c is Claim => Boolean(c && c.id)
  );
  const edges = claims.reduce((n, c) => n + (c.supports?.length ?? 0), 0);
  const marks = hitsOf(d.passage ?? '', [...STEP_MARKERS]).length;

  const checks = d.checks ?? [];
  const passedItems = checks.filter((k) => k.answer === 'passed');
  const violatedItems = checks.filter((k) => k.answer === 'violated');
  const notApplicable = checks.filter((k) => k.answer === 'not-applicable').length;
  /*
   * `unanswered` 是「文中无从判断」——报告在指认这一环原文没交代。
   * 它既不进「已答」，也不叫「没答」：叫错了，一份指认就变成一份疏漏。
   */
  const hollowItems = checks.filter((k) => !k.answer || k.answer === 'unanswered');

  const count = {
    sentences: sentences.length,
    quiet: quiet.length,
    edges,
    marks,
    checks: checks.length,
    passed: passedItems.length,
    violated: violatedItems.length,
    hollow: hollowItems.length,
    notApplicable,
  };

  /*
   * 检查项的 label 通常已经带着编号（「CQ2 为何不只是同时发生」「第 CQ4 条」），
   * 再拼一次 id 会变成「CQ2 CQ2 …」——读起来像两个东西。
   */
  const labelOf = (k: { id: string; label?: string }): string => {
    const lab = (k.label || '').trim();
    if (!lab) return k.id;
    return lab.includes(k.id) ? lab : `${k.id} ${lab}`;
  };

  const gaps: SkeletonGap[] = [];

  /* 1) 透镜自己说不适用。 */
  const offScope = d.scope && d.scope.applicable === false;
  if (offScope) {
    gaps.push({
      kind: 'off-scope',
      from: 'report',
      note: `这副透镜自己说不适用于这段文字，理由是：${(d.scope.reason || '（没写理由）').trim()}。下面的数字只当参考。`,
      at: d.scope.outOfScopeAt ? [d.scope.outOfScopeAt] : [],
    });
  }

  /* 2) 说「不适用」，却把检查表填上了——这两件事不能同时成立。 */
  if (offScope && checks.length) {
    gaps.push({
      kind: 'scope-conflict',
      from: 'local',
      note: `透镜说不适用于这段文字，检查表却填了 ${checks.length} 条——这两件事不能同时成立。`,
      at: checks.slice(0, 4).map(labelOf),
    });
  }

  /* 3) 一条前提都没列：结论是悬空的。 */
  if ((d.premises ?? []).length === 0) {
    gaps.push({
      kind: 'no-premises',
      from: 'local',
      note: '报告一条前提都没列——结论是怎么接上去的，报告里没有交代。',
      at: ['C'],
    });
  }

  /* 4) 支撑关系成环。 */
  const cycles = findCycles(claims);
  if (cycles.length) {
    gaps.push({
      kind: 'cycle',
      from: 'local',
      note:
        cycles.length === 1
          ? `支撑关系里有一个环：${cycles[0].join(' → ')}。环上的几条互相支撑，谁也不比谁更基础。`
          : `支撑关系里有 ${cycles.length} 个环：${cycles.map((c) => c.join(' → ')).join('；')}。`,
      at: cycles.map((c) => c.join(' → ')),
    });
  }

  /* 5) 原文里有句子没人碰。 */
  if (quiet.length) {
    gaps.push({
      kind: 'quiet-sentences',
      from: 'local',
      note: `原文 ${sentences.length} 句，有 ${quiet.length} 句没有任何一条主张、命名或「此处合法」落到上面。`,
      at: quiet.slice(0, 3).map((s) => snip(s.text)),
    });
  }

  /* 6) 报告自己指认「这一环文中没交代」。 */
  if (!offScope && hollowItems.length) {
    gaps.push({
      kind: 'hollow-checks',
      from: 'report',
      note:
        checks.length === hollowItems.length
          ? `检查表 ${checks.length} 条，每一条报告都说「文中没交代这一环」——整条推理的担保一环都没落地。`
          : `检查表 ${checks.length} 条里，${hollowItems.length} 条报告说「文中没交代这一环」——这是它在指认这几处是空的，不是漏答。`,
      at: hollowItems.slice(0, 4).map(labelOf),
    });
  }

  /* 下面 push 的先后就是输出顺序，见 GAP_ORDER 的注释。 */

  /*
   * 并列事实：数出来的东西，不加解释。
   * 「原文几句、几句没碰」不放在这里——总述第一句已经说了，重复一遍只是占位置。
   */
  const facts: SkeletonFact[] = [];
  if (claims.length > 1) {
    facts.push({ label: '结构连线', value: `${edges} 条` });
  }
  if (marks) {
    facts.push({ label: '原文推理连接词', value: `${marks} 处（与连线数不一一对应）` });
  }
  if (checks.length) {
    facts.push({
      label: '检查表',
      value: `${checks.length} 条：通过 ${count.passed}、违反 ${count.violated}、文中没交代 ${count.hollow}、不适用 ${count.notApplicable}`,
    });
  }

  /*
   * 总述。缺哪一块就不提哪一块——「0 条」不是一句话。
   * 检查表那一段分三种说法，因为「全部不适用」和「通过 2、违反 0」是两件事，
   * 混成一句「答了 2 条」会把不适用数成答过。
   */
  const parts: string[] = [];
  if (sentences.length) parts.push(`原文 ${sentences.length} 句，${quiet.length} 句没碰`);
  if (checks.length) {
    if (count.hollow) parts.push(`检查表 ${checks.length} 条，其中 ${count.hollow} 条报告说「文中没交代」`);
    else if (count.notApplicable === checks.length) parts.push(`检查表 ${checks.length} 条，全部标为不适用`);
    else parts.push(`检查表 ${checks.length} 条：通过 ${count.passed}、违反 ${count.violated}`);
  }
  const line = parts.length
    ? `${parts.join('；')}。`
    : '这份报告里既没有原文句子，也没有检查表——本地没有可核的东西。';

  /*
   * 清零说明只列这一份报告里**确实有**的东西，不写死四项。
   * 写死「每句原文都有人碰、检查表都答了」在两份样本上会说错：
   * 全文为空时没有「每句」，检查表全标「不适用」时也没有「都答了」。
   */
  const checked: string[] = [];
  if (sentences.length) checked.push('每句原文都有条目落上去');
  if (claims.length > 1) checked.push('支撑关系不成环');
  if ((d.premises ?? []).length) checked.push('前提列了');
  if (checks.length) checked.push('检查表里没有报告说「文中没交代」的条目');
  const clearNote =
    gaps.length === 0
      ? `按这几项查，没找到缺口${checked.length ? `：${checked.join('、')}` : ''}。这只说明骨架接上了，不代表判断对——判断对不对，本地核不了。`
      : null;

  return { line, facts, gaps, clearNote, count };
}
