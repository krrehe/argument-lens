import type { Diagnosis } from './types';
import { DEEP_KINDS, DEEP_STATUSES, type DeepKind, type DeepStatus } from './deep';

/**
 * 深查发现库。
 *
 * 单份报告的深查账本回答「这一遍漏了什么」；这一层回答另一个问题：
 * **我在哪些类型的论证上反复漏同一种东西。**
 *
 * 它只汇总已经落盘的发现，不重新分析、不判发现真假、不把发现数折成分数。
 * 排序按报告时间从新到旧；同一份报告里的发现保持原编号顺序。
 */

export interface DeepArchiveItem {
  reportId: string;
  at: number;
  theory: string;
  mode: string;
  /** 报告原文开头，给列表认人用；不替代原文。 */
  passageHead: string;
  findingId: string;
  kind: DeepKind;
  title: string;
  detail: string;
  status: DeepStatus;
  targetId: string;
  quote: string;
  theoryRef: string;
  targetOk: boolean;
  quoteOk: boolean;
  theoryOk: boolean;
}

export interface DeepArchiveView {
  items: DeepArchiveItem[];
  /** 有深查账本的报告份数（含账本为空的）。 */
  reports: number;
  total: number;
  /** 落不到原文/检查项的候选总数；它们不在 items 里。 */
  unlocated: number;
  byStatus: Record<DeepStatus, number>;
  byKind: Record<DeepKind, number>;
  /** 至少有一条该类发现的报告份数。用来回答「这类问题在几份文本里反复出现」。 */
  byKindReports: Record<DeepKind, number>;
  /** 出现在两份及以上报告里的类型，按报告份数降序，最多三条。 */
  repeats: Array<{ kind: DeepKind; reports: number }>;
}

type Source = Pick<Diagnosis, 'id' | 'createdAt' | 'theory' | 'mode' | 'passage' | 'deep'>;

const head = (text: string | undefined): string =>
  (typeof text === 'string' ? text : '').replace(/\s+/g, ' ').trim().slice(0, 32);

function zeroStatus(): Record<DeepStatus, number> {
  return Object.fromEntries(DEEP_STATUSES.map((s) => [s, 0])) as Record<DeepStatus, number>;
}

function zeroKind(): Record<DeepKind, number> {
  return Object.fromEntries(DEEP_KINDS.map((k) => [k, 0])) as Record<DeepKind, number>;
}

export function collectDeepFindings(reports: ReadonlyArray<Source>): DeepArchiveView {
  const byStatus = zeroStatus();
  const byKind = zeroKind();
  const kindReports: Record<DeepKind, Set<string>> = Object.fromEntries(
    DEEP_KINDS.map((k) => [k, new Set<string>()]),
  ) as Record<DeepKind, Set<string>>;
  const items: DeepArchiveItem[] = [];
  let withDeep = 0;
  let unlocated = 0;

  for (const d of reports) {
    if (!d?.deep) continue;
    withDeep += 1;
    unlocated += d.deep.unlocated.length;
    const passageHead = head(d.passage);
    for (const f of d.deep.findings) {
      byStatus[f.status] += 1;
      byKind[f.kind] += 1;
      kindReports[f.kind].add(d.id);
      items.push({
        reportId: d.id,
        at: d.createdAt,
        theory: d.theory,
        mode: d.mode,
        passageHead,
        findingId: f.id,
        kind: f.kind,
        title: f.title,
        detail: f.detail,
        status: f.status,
        targetId: f.targetId,
        quote: f.quote,
        theoryRef: f.theoryRef,
        targetOk: f.targetOk,
        quoteOk: f.quoteOk,
        theoryOk: f.theoryOk,
      });
    }
  }

  items.sort((a, b) => b.at - a.at || a.reportId.localeCompare(b.reportId) || a.findingId.localeCompare(b.findingId));
  const byKindReports = Object.fromEntries(
    DEEP_KINDS.map((k) => [k, kindReports[k].size]),
  ) as Record<DeepKind, number>;
  /*
   * 排序也放在纯函数里：界面只负责画，不按相关度重排。
   * 同一份报告里写三条同类型不算反复出现——这里数的是报告份数。
   */
  const repeats = DEEP_KINDS.map((k) => ({ kind: k, reports: byKindReports[k] }))
    .filter((x) => x.reports >= 2)
    .sort((a, b) => b.reports - a.reports || a.kind.localeCompare(b.kind))
    .slice(0, 3);
  return { items, reports: withDeep, total: items.length, unlocated, byStatus, byKind, byKindReports, repeats };
}
