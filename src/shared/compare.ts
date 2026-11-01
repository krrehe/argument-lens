/**
 * 修订对照。
 *
 * 这个工具的闭环缺了最后一段：它给修补建议，但修补版从来没被重新判过。
 * 「这样补就站得住」于是只是另一句没有依据的话——和它反对的东西同构。
 *
 * 但对照这件事本身极易做错，而且错法只有一种：**替你宣布改好了**。
 *
 * 三条硬约束，写在这里是为了将来改代码时看得见：
 *
 *   1. 不合并成一个分数。「4 条未答变 2 条」和「档位升了一级」不是同一件事，
 *      压成一个百分比就等于把六套理论压成一个仪表盘，那是这个工具最反对的事。
 *
 *   2. 档位上升 ≠ 论证变好。档位是相对于「这套标准」的位置。文本变短、问题变简单、
 *      换了一副透镜，都会让档位动，而论证质量可能一点没变。所以要报的是**哪些检查项动了**，
 *      档位只是其中一项。
 *
 *   3. 任何可能让比较失效的情况都必须显示，不能藏在详情里。透镜不同、模式不同、
 *      文本改动过大——这三种情况下「前后对照」这个说法本身就不成立。
 */

import { MODE_META, type CheckAnswer, type Diagnosis, type VerdictLevel } from './types';
import { disputesIn } from './disputes';

export type CheckDeltaKind =
  /** 未答 → 过了。修补建议直接兑现，这是最值得看的一种 */
  | 'resolved'
  /** 过了 → 未过。改出问题来了 */
  | 'regressed'
  /** 仍没答上 */
  | 'still-open'
  /** 其它移动（未过→未答 等） */
  | 'shifted'
  /** 没动 */
  | 'same';

export interface CheckDelta {
  id: string;
  label: string;
  from: CheckAnswer;
  to: CheckAnswer;
  kind: CheckDeltaKind;
}

export type RevisionTrend = 'advanced' | 'regressed' | 'flat' | 'mixed' | 'not-comparable';

export interface RevisionDiff {
  parent: { id: string; at: number; theory: string; level: VerdictLevel; chars: number };
  child: { id: string; at: number; theory: string; level: VerdictLevel; chars: number };
  /** 两份能不能摆在一起看 */
  comparable: boolean;
  levelFrom: VerdictLevel;
  levelTo: VerdictLevel;
  /** 未答的检查项数量：修补建议要解决的就是这个 */
  openFrom: number;
  openTo: number;
  /** 明确没过的数量 */
  violatedFrom: number;
  violatedTo: number;
  checks: CheckDelta[];
  resolved: number;
  regressed: number;
  stillOpen: number;
  disputesFrom: number;
  disputesTo: number;
  labelsFrom: number;
  labelsTo: number;
  headline: string;
  trend: RevisionTrend;
  /** 这个对照在什么情况下不成立。必须显示，不能收进详情。 */
  caveats: string[];
}

const LEVEL_RANK: Record<VerdictLevel, number> = {
  fails: 0,
  weakened: 1,
  withstands: 2,
  // 判不了不在刻度上。把它当成最低档，会得出「从判不了变成不成立是退步」这种错误结论。
  undetermined: -1,
};

const ANSWER_TEXT: Record<CheckAnswer, string> = {
  passed: '过',
  violated: '没过',
  unanswered: '未答',
  'not-applicable': '不适用',
};

export function answerText(a: CheckAnswer): string {
  return ANSWER_TEXT[a];
}

/**
 * 相似度：3-gram 集合的重叠系数（交集 / 较小的那个集合）。
 *
 * 这里不用常见的 Jaccard，是因为修订天然会「变长」：原文加上补上的那句前提。
 * Jaccard 的分母是并集，加得越多分越低——于是「补上了一句话」会被算成
 * 「换了另一段话」，对照条永远显示「不可对照」，这个功能等于没有。
 *
 * 重叠系数问的是另一个问题，也是这里真正要问的那个：
 * **原话还在不在**。原文被完整保留、后面添了内容，就是 1；
 * 换了个话题，就是接近 0。
 */
function similarity(a: string, b: string): number {
  const grams = (s: string): Set<string> => {
    const t = s.replace(/\s+/g, '');
    const set = new Set<string>();
    for (let i = 0; i + 2 < t.length; i++) set.add(t.slice(i, i + 3));
    return set;
  };
  const A = grams(a);
  const B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter += 1;
  return inter / Math.min(A.size, B.size);
}

function deltaKind(from: CheckAnswer, to: CheckAnswer): CheckDeltaKind {
  if (from === to) return 'same';
  if (from === 'unanswered' && to === 'passed') return 'resolved';
  if (from === 'passed' && to === 'violated') return 'regressed';
  if (from === 'unanswered' && to === 'unanswered') return 'still-open';
  return 'shifted';
}

export function diffRevision(parent: Diagnosis, child: Diagnosis): RevisionDiff {
  const caveats: string[] = [];
  const sameTheory = parent.theory === child.theory;
  const sameMode = parent.mode === child.mode;

  if (!sameTheory) {
    caveats.push(
      '两份用的是不同的透镜。它们的刻度不可换算——「被削弱」在型式法里和在语用辩证里不是同一件事，所以下面的档位对比只能当作两个位置看，不能读成升降。'
    );
  }
  if (!sameMode) {
    /*
     * 跨模式对照分三种，措辞必须分开：
     * 判定类之间换模式，档位含义不同但都还有档位；
     * 一方给档位、一方不给：后者根本没有档位——这时「升降」是纯粹的假象。
     * 写一句笼统的「模式不同」会把这两种混成一件事，用户看不出哪一种更严重。
     */
    const a = MODE_META[parent.mode];
    const b = MODE_META[child.mode];
    caveats.push(
      a.givesVerdict && b.givesVerdict
        ? `一份是${a.label}、一份是${b.label}。判读的含义不同（${b.label}模式下表「${b.stageVerdict}」），档位不具可比性。`
        : `一份是${a.label}（${a.givesVerdict ? '给判定' : '不给判定'}）、一份是${b.label}（${b.givesVerdict ? '给判定' : '不给判定'}）。${
            (a.givesVerdict ? b : a).label
          }模式的档位恒为「判不了」，所以这里的「升降」读不出来任何东西——只能当作两次独立的看待。`
    );
  }

  const sim = similarity(parent.passage, child.passage);
  if (sim < 0.75) {
    caveats.push(
      `两段文本相似度只有 ${Math.round(sim * 100)}%。改动这么大，这更像两次独立分析，而不是一次修订的前后对照。`
    );
  }

  const byId = new Map(parent.checks.map((c) => [c.id, c]));
  const checks: CheckDelta[] = [];
  for (const c of child.checks) {
    const p = byId.get(c.id);
    if (!p) continue;
    checks.push({
      id: c.id,
      label: c.label,
      from: p.answer,
      to: c.answer,
      kind: deltaKind(p.answer, c.answer),
    });
  }

  const resolved = checks.filter((c) => c.kind === 'resolved').length;
  const regressed = checks.filter((c) => c.kind === 'regressed').length;
  const stillOpen = child.checks.filter((c) => c.answer === 'unanswered').length;
  const openFrom = parent.checks.filter((c) => c.answer === 'unanswered').length;
  const violatedFrom = parent.checks.filter((c) => c.answer === 'violated').length;
  const violatedTo = child.checks.filter((c) => c.answer === 'violated').length;

  const disputesFrom = disputesIn(parent).length;
  const disputesTo = disputesIn(child).length;

  const comparable = sameTheory && sameMode && sim >= 0.75;
  let trend: RevisionTrend = 'not-comparable';

  if (comparable) {
    const up = LEVEL_RANK[child.verdict.level] - LEVEL_RANK[parent.verdict.level];
    const openDown = openFrom - stillOpen;

    if (parent.verdict.level === 'undetermined' || child.verdict.level === 'undetermined') {
      /*
       * 有一头是「判不了」，就没有升降可言。
       * 从「判不了」到「站得住」，更可能是透镜终于适用了，而不是论证变好了。
       */
      trend = 'mixed';
      caveats.push('其中一份的判读是「判不了」。它不在刻度上，所以这次对照说不了「变好」或「变坏」，只能说判定变得确定了。');
    } else if (up > 0 && openDown >= 0 && regressed === 0) {
      trend = 'advanced';
    } else if (up < 0 || regressed > 0) {
      trend = 'regressed';
    } else if (up === 0 && openDown === 0 && regressed === 0) {
      trend = 'flat';
    } else {
      trend = 'mixed';
    }

    /*
     * 这条必须单独说：未答变少、但明确没过变多。
     * 表面上「答上了」，实际上可能只是把含糊的地方改成了明确的硬伤。
     * 这正是「不给你简单的好消息」该出现的地方。
     */
    if (resolved > 0 && violatedTo > violatedFrom) {
      caveats.push(
        `未答的从 ${openFrom} 条降到 ${stillOpen} 条，但明确没过的从 ${violatedFrom} 条升到 ${violatedTo} 条。这可能是把含糊改成了清晰，也可能是把能糊过去的地方改成了硬伤——两种都算「答上了」，好坏相反。`
      );
    }
    if (stillOpen > openFrom) {
      caveats.push(`未答的检查反而多了 ${stillOpen - openFrom} 条。若修补时删掉了某些内容，这通常就是这个原因。`);
    }
  }

  const parts: string[] = [];
  if (resolved) parts.push(`${resolved} 条未答的检查现在答上了`);
  if (stillOpen) parts.push(`还有 ${stillOpen} 条没答`);
  if (regressed) parts.push(`${regressed} 条从「过」变成「没过」`);
  if (!parts.length && comparable) {
    parts.push(openFrom === stillOpen && !regressed ? `检查项没有变化（${stillOpen} 条仍未答）` : '检查项有移动，但没有一项是「未答→过」');
  }
  const levelPart =
    parent.verdict.level === child.verdict.level
      ? `判读仍是「${levelFromText(child.verdict.level)}」`
      : `判读从「${levelFromText(parent.verdict.level)}」到「${levelFromText(child.verdict.level)}」`;

  const headline = comparable ? `${levelPart}；${parts.join('，')}` : '这一份不可与上一版直接对照';

  return {
    parent: {
      id: parent.id,
      at: parent.createdAt,
      theory: parent.theory,
      level: parent.verdict.level,
      chars: parent.passage.length,
    },
    child: {
      id: child.id,
      at: child.createdAt,
      theory: child.theory,
      level: child.verdict.level,
      chars: child.passage.length,
    },
    comparable,
    levelFrom: parent.verdict.level,
    levelTo: child.verdict.level,
    openFrom,
    openTo: stillOpen,
    violatedFrom,
    violatedTo,
    checks,
    resolved,
    regressed,
    stillOpen,
    disputesFrom,
    disputesTo,
    labelsFrom: parent.labels.length,
    labelsTo: child.labels.length,
    headline,
    trend,
    caveats,
  };
}

export function levelFromText(l: VerdictLevel): string {
  switch (l) {
    case 'withstands':
      return '站得住';
    case 'weakened':
      return '被削弱';
    case 'fails':
      return '不成立';
    case 'undetermined':
      return '判不了';
  }
}

export const TREND_LABEL: Record<RevisionTrend, string> = {
  advanced: '有推进',
  regressed: '退步了',
  flat: '没动',
  mixed: '方向不一',
  'not-comparable': '不可对照',
};
