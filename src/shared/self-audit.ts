import type { Diagnosis } from './types';
import { auditReport } from './report-audit';
import { promptHistoryOf } from './prompt-history';

/**
 * 自省：审查这份报告自己。
 *
 * 它不是再判一遍论证，也不新增任何判断。只做四件事：
 *   1. 把模型自己写下的「不知道」与「什么条件下撤回」摆出来；
 *   2. 把本地审计数出的结构矛盾与缺口摆出来；
 *   3. 把深查账本里的未落点、被削弱/被推翻摆出来；
 *   4. 核对这份报告的提示词版本还能不能在本机复核。
 *
 * 每条都写清来源。合成一句话说「报告不太可靠」会抹掉「谁说的」——
 * 模型自认的不知道与本地数出的结构矛盾，分量不是一回事。
 */

export type SelfAuditSource = 'model' | 'local' | 'deep' | 'provenance';

export type SelfAuditKind =
  | 'unknown'
  | 'withdraw'
  | 'no-withdraw'
  | 'invariant'
  | 'gap'
  | 'unlocated'
  | 'weakened'
  | 'rejected'
  | 'tension'
  | 'version';

export interface SelfAuditItem {
  id: string;
  source: SelfAuditSource;
  kind: SelfAuditKind;
  text: string;
  detail?: string;
}

export interface SelfAuditView {
  items: SelfAuditItem[];
  model: number;
  local: number;
  deep: number;
  provenance: number;
  line: string;
}

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * 同一层的措辞只在一处。
 * 「模型自认」「本地数的」「深查账本」「版本」四种来源要一眼分得开。
 */
export const SELF_AUDIT_SOURCE_LABEL: Record<SelfAuditSource, string> = {
  model: '模型自认',
  local: '本地数的',
  deep: '深查账本',
  provenance: '版本',
};

export const SELF_AUDIT_KIND_LABEL: Record<SelfAuditKind, string> = {
  unknown: '不知道',
  withdraw: '何时撤回',
  'no-withdraw': '没写撤回条件',
  invariant: '结构矛盾',
  gap: '缺口',
  unlocated: '落不到原文',
  weakened: '被削弱',
  rejected: '被推翻',
  tension: '两层并列',
  version: '版本',
};

export function selfAuditOf(d: Diagnosis): SelfAuditView {
  const items: SelfAuditItem[] = [];
  let n = 0;
  const add = (source: SelfAuditSource, kind: SelfAuditKind, text: string, detail?: string): void => {
    const body = s(text);
    if (!body) return;
    items.push({ id: `sa-${++n}`, source, kind, text: body, ...(detail ? { detail } : {}) });
  };

  /* 1. 模型自己承认的不知道与撤回条件。没有就照实说「没写」，不补一条假的自省。 */
  const unknowns = Array.isArray(d.selfCheck?.unknowns) ? d.selfCheck.unknowns.map(s).filter(Boolean) : [];
  const withdraw = Array.isArray(d.selfCheck?.withdrawIf) ? d.selfCheck.withdrawIf.map(s).filter(Boolean) : [];
  for (const x of unknowns) add('model', 'unknown', x);
  for (const x of withdraw) add('model', 'withdraw', x);
  if (!unknowns.length && !withdraw.length) {
    add(
      'model',
      'no-withdraw',
      '模型这次没有写「不知道」或「什么条件下撤回」。',
      '这不等于没有问题，只等于它没有留下可复核的自省条件。',
    );
  }

  /* 2. 本地审计：结构矛盾与缺口。只读 auditReport，不另立一套判据。 */
  const audit = auditReport(d);
  for (const x of audit.invariants) add('local', 'invariant', x);
  for (const x of audit.gaps) add('local', 'gap', x);

  /* 3. 深查账本：未落点的候选、被削弱/被推翻的发现。 */
  const deepItems = Array.isArray(d.deep?.findings) ? d.deep!.findings : [];
  for (const u of d.deep?.unlocated ?? []) {
    add('deep', 'unlocated', u.title, u.why || u.detail);
  }
  const weakened = deepItems.filter((x) => x.status === 'weakened');
  const rejected = deepItems.filter((x) => x.status === 'rejected');
  if (weakened.length) {
    add(
      'deep',
      'weakened',
      `${weakened.length} 条深查发现被第二遍削弱：${weakened.map((x) => x.title).join('；')}`,
      '被削弱不等于撤回；报告没有把它们并进判读。',
    );
  }
  if (rejected.length) {
    add(
      'deep',
      'rejected',
      `${rejected.length} 条深查发现被第二遍推翻：${rejected.map((x) => x.title).join('；')}`,
      '被推翻的发现仍留在账本里，只作为「找过又撤回」的痕迹。',
    );
  }
  /*
   * 两层并列：深查的所有发现都被削弱/推翻，而判读仍是「站住」。
   * 这不是说报告错了——两层回答的不是同一个问题；但如果报告没解释，
   * 读者会把「站住」读成「深查也没找出问题」。这里只把并列摆出来。
   */
  const allJudged = deepItems.length > 0 && deepItems.every((x) => x.status === 'weakened' || x.status === 'rejected');
  if (allJudged && d.verdict?.level === 'withstands') {
    add(
      'deep',
      'tension',
      `深查的 ${deepItems.length} 条发现全部被削弱或推翻，而判读仍是「站住」。`,
      '两层回答的不是同一个问题；报告没有说明它们怎么并存。',
    );
  }

  /* 4. 版本：这份报告用的提示词还能不能在本机复核。 */
  const ph = promptHistoryOf(d);
  if (ph.relation !== 'same') {
    add('provenance', 'version', ph.line, '自省只核对版本与指纹，不判旧版判断对不对。');
  }

  const model = items.filter((x) => x.source === 'model').length;
  const local = items.filter((x) => x.source === 'local').length;
  const deep = items.filter((x) => x.source === 'deep').length;
  const provenance = items.filter((x) => x.source === 'provenance').length;
  const line = items.length
    ? `${items.length} 条自省线索：模型自认 ${model} 条、本地数的 ${local} 条、深查账本 ${deep} 条、版本 ${provenance} 条。`
    : '没有留下自省线索；这不等于报告没问题，只等于这次没写、本地也没数出结构问题。';

  return { items, model, local, deep, provenance, line };
}
