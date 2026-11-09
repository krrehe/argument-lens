/**
 * 这份报告里，哪些字是模型说的、哪些是本地算得出的。
 *
 * 只分类、只数、不改判定、不写新判断、不落盘。判定点的口径与
 * `scripts/audit-provenance.ts` 一致，这样界面上的数和那条命令的数可以对得上。
 *
 * 存在的理由：路线图第八节那条掉头处方——「把『确定』的部分与『模型认为』的
 * 部分在界面上彻底分开」。第 50 轮量出报告正文 97.5%~97.8% 逐字来自模型、
 * 本地独立判定只占 4.8%，而再往报告外加一块本地计算已被真实数据证伪
 * （311 条检查项里三种自相矛盾信号 0 / 1 / 0）。所以这里不再算新东西，
 * 只把界面上已经存在的几处本地复算汇总成一处，并把边界说清楚。
 */
import type { Claim, Diagnosis } from './types';
import { rewriteOf } from './rewrite';
import { skeletonOf } from './skeleton';
import { toneAudit } from './modal';

export type SourceFrom = 'model' | 'local';

/** 措辞只有这一个家：界面、检查脚本、导出都必须从这里取。 */
export const SOURCE_LABEL: Record<SourceFrom, string> = {
  model: '模型给出的判断',
  local: '本地复算',
};

export const SOURCE_HEADLINE =
  '这份报告里的判断（评级、可接受度、举证责任、检查项答案、反驳）由模型写出；' +
  '本地只做原文定位、字面比对、结构核对与计数，不改判定。';

export const SOURCE_NOTE =
  '这些处数是按这份报告逐字复算的，只说明哪些由本地算出；' +
  '算得多不等于判断更对，也不回答这段话站不站得住。';

export interface SourceRow {
  key: string;
  /** 只描述这一类在算什么，不写判断、不劝告。 */
  label: string;
  count: number;
  from: SourceFrom;
}

export interface Provenance {
  /** 模型给出的判定点处数。 */
  modelPoints: number;
  /** 本地复算的几类，各自在这一份报告里数出几处。 */
  localRows: SourceRow[];
  localPoints: number;
  headline: string;
  note: string;
}

const norm = (s: string) => String(s ?? '').replace(/[\s\u3000]/g, '');

export function provenanceOf(d: Diagnosis): Provenance {
  const claims = [d.conclusion, ...(d.premises || []), ...(d.intermediate || [])].filter(Boolean) as Claim[];

  /* 判定点：与 audit:provenance 逐字同口径，以下八类全部由模型给出。 */
  let modelPoints = 2; // 评级档位 + 被否证的是谁
  for (const c of claims) {
    if (c.acceptability) modelPoints++;
    if (c.burden) modelPoints++;
  }
  for (const k of d.checks || []) if (k && k.answer) modelPoints++;
  for (const rf of d.refutations || []) {
    if (rf && rf.confidence) modelPoints++;
    if (rf && rf.burdenAfter) modelPoints++;
  }
  if (d.conclusion && typeof d.conclusion.modalOverreach === 'boolean') modelPoints++;

  /* 本地复算：只数界面上已经存在的那几处，一处也不新算。 */
  const passage = norm(d.passage || '');
  const localRows: SourceRow[] = [
    {
      key: 'rewrite',
      label: '原话与整理后那一句的字面改动（逐字比）',
      count: claims.filter((c) => rewriteOf(c)?.kind === 'fragments').length,
      from: 'local',
    },
    {
      key: 'skeleton',
      label: '本地数的结构缺口（骨架缺口）',
      count: skeletonOf(d).gaps.filter((g) => g.from === 'local').length,
      from: 'local',
    },
    {
      key: 'tone',
      label: '原文那句与报告那句的字面差别（结论的口气）',
      count: toneAudit(d).diffs.length,
      from: 'local',
    },
    {
      key: 'quote',
      label: '引文在原文里逐字对上的条数',
      count: claims.filter((c) => c.quote && passage.includes(norm(c.quote))).length,
      from: 'local',
    },
  ];

  return {
    modelPoints,
    localRows,
    localPoints: localRows.reduce((n, r) => n + r.count, 0),
    headline: SOURCE_HEADLINE,
    note: SOURCE_NOTE,
  };
}
