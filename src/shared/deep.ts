import type { Diagnosis, Diagnostic } from './types';
import { CLAIM_BY_ID } from './theory-base';

/**
 * 深查（第六个分析模式）的发现账本。
 *
 * 这一层只做三件事：核对每条发现指不指得到原文/报告里的位置、引文是不是原文的
 * 逐字子串、理论依据是不是主张库里真的有一条；它**不判断发现对不对**。
 * 发现是模型写的候选；「站住」只表示它扛过了第二遍的那一次反驳，不表示真。
 */

export const DEEP_KINDS = [
  'missing-premise',
  'cq-gap',
  'equivocation',
  'burden',
  'evidence',
  'structure',
  'rhetoric',
  'scope',
  'alternative',
] as const;

export type DeepKind = (typeof DEEP_KINDS)[number];

export const DEEP_KIND_LABEL: Record<DeepKind, string> = {
  'missing-premise': '未说的前提',
  'cq-gap': '该问没问',
  equivocation: '词义漂移',
  burden: '举证责任',
  evidence: '证据缺口',
  structure: '结构断点',
  rhetoric: '修辞替代',
  scope: '适用条件',
  alternative: '另一种解释',
};

export const DEEP_STATUSES = ['open', 'confirmed', 'weakened', 'rejected', 'unresolved'] as const;

export type DeepStatus = (typeof DEEP_STATUSES)[number];

export const DEEP_STATUS_LABEL: Record<DeepStatus, string> = {
  open: '未反驳',
  confirmed: '站住',
  weakened: '被削弱',
  rejected: '被推翻',
  unresolved: '未决',
};

export const DEEP_METHODS = ['lens-cq', 'cross-exam', 'counterexample', 'structural'] as const;

export type DeepMethod = (typeof DEEP_METHODS)[number];

export const DEEP_METHOD_LABEL: Record<DeepMethod, string> = {
  'lens-cq': '按透镜的 CQ 找',
  'cross-exam': '换身份追问',
  counterexample: '造反例',
  structural: '走结构',
};

export interface DeepFinding {
  id: string;
  kind: DeepKind;
  title: string;
  detail: string;
  /** 报告里真实存在的主张/中间结论/检查项；没有就是空串。 */
  targetId: string;
  /** 原文的逐字子串；没有就是空串。 */
  quote: string;
  /** theory-base.ts 的主张 id；没有就是空串。 */
  theoryRef: string;
  method: DeepMethod;
  /** 什么证据/条件会改变这条发现。 */
  ifChanged: string;
  /** 第二遍写下的最强反驳。 */
  challenge: string;
  status: DeepStatus;
  /** 本地核对结果；模型不写这三个字段。 */
  targetOk: boolean;
  quoteOk: boolean;
  theoryOk: boolean;
}

export interface DeepUnlocated {
  title: string;
  detail: string;
  why: string;
}

export interface DeepReport {
  findings: DeepFinding[];
  /** 指不到任何位置的候选：不丢，单独列出来。 */
  unlocated: DeepUnlocated[];
}

export interface DeepValidation {
  deep: DeepReport;
  diagnostics: Diagnostic[];
}

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function targetIdsOf(d: Diagnosis): Set<string> {
  return new Set([
    d.conclusion?.id,
    ...(d.premises ?? []).map((x) => x?.id),
    ...(d.intermediate ?? []).map((x) => x?.id),
    ...(d.checks ?? []).map((x) => x?.id),
  ].filter((x): x is string => typeof x === 'string' && x.length > 0));
}

/**
 * 把模型写的 `deep` 对象核成账本。
 *
 * 丢掉的是**形状不成立**的条目（没有标题、id 重复）；落点/引文/理论依据对不上
 * 不丢，只在卡片上标出来——那正是「发现」最需要被读者看见的部分。
 */
export function validateDeep(raw: unknown, d: Diagnosis, passage: string): DeepValidation {
  const diagnostics: Diagnostic[] = [];
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const rawFindings = Array.isArray((obj as any).findings) ? ((obj as any).findings as unknown[]) : [];
  const rawUnlocated = Array.isArray((obj as any).unlocated) ? ((obj as any).unlocated as unknown[]) : [];
  const targets = targetIdsOf(d);
  const seen = new Set<string>();
  const findings: DeepFinding[] = [];
  const unlocated: DeepUnlocated[] = [];

  rawFindings.forEach((item, i) => {
    const x = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const title = s(x.title);
    const detail = s(x.detail);
    if (!title) {
      diagnostics.push({
        level: 'warn',
        code: 'DEEP_TITLE_MISSING',
        message: `第 ${i + 1} 条深查发现没有标题，已丢弃；它不是一条可读的发现。`,
      });
      return;
    }
    let id = s(x.id) || `D${i + 1}`;
    if (seen.has(id)) {
      diagnostics.push({
        level: 'warn',
        code: 'DEEP_ID_DUPLICATED',
        message: `深查发现 id「${id}」重复，后一条已跳过；编号重复会让第二遍的反驳对不上号。`,
      });
      return;
    }
    seen.add(id);

    const kind = (DEEP_KINDS as readonly string[]).includes(s(x.kind)) ? (s(x.kind) as DeepKind) : null;
    if (!kind) {
      diagnostics.push({
        level: 'info',
        code: 'DEEP_KIND_INVALID',
        message: `深查发现「${title}」的类型不认识，按「结构断点」显示；类型只影响分组，不参与判定。`,
      });
    }
    const method = (DEEP_METHODS as readonly string[]).includes(s(x.method))
      ? (s(x.method) as DeepMethod)
      : 'cross-exam';
    const status = (DEEP_STATUSES as readonly string[]).includes(s(x.status))
      ? (s(x.status) as DeepStatus)
      : 'open';
    if (!(DEEP_STATUSES as readonly string[]).includes(s(x.status))) {
      diagnostics.push({
        level: 'info',
        code: 'DEEP_STATUS_INVALID',
        message: `深查发现「${title}」的状态不认识，按「未反驳」显示。`,
      });
    }

    const targetId = s(x.targetId);
    const targetOk = !!targetId && targets.has(targetId);
    const rawQuote = s(x.quote);
    /* 允许模型把引文包在「」或引号里；核的是里面那句是否逐字在原文中。 */
    const quote = rawQuote.replace(/^[「“"]/, '').replace(/[」”"]$/, '').trim();
    const quoteOk = !!quote && passage.includes(quote);
    const theoryRef = s(x.theoryRef);
    const theoryOk = !!theoryRef && !!CLAIM_BY_ID[theoryRef];
    const ifChanged = s(x.ifChanged);
    if (!ifChanged) {
      diagnostics.push({
        level: 'info',
        code: 'DEEP_IF_CHANGED_MISSING',
        message: `深查发现「${title}」没写「什么会改变它」；这条发现仍然保留，但读者没法知道该去找什么证据。`,
      });
    }
    const challenge = s(x.challenge);
    if (status !== 'open' && !challenge) {
      diagnostics.push({
        level: 'info',
        code: 'DEEP_CHALLENGE_MISSING',
        message: `深查发现「${title}」标了「${DEEP_STATUS_LABEL[status]}」却没写最强反驳；状态保留，但这一条没有可复核的依据。`,
      });
    }

    /*
     * 既没有可解析的落点、也没有逐字引文：这条发现无法回到原文。
     * 不把它混进正常列表——那会让「有落点」的计数虚高；放进 unlocated，写明原因。
     */
    if (!targetOk && !quoteOk) {
      unlocated.push({
        title,
        detail: detail || '（没有写细节）',
        why: targetId
          ? `落点「${targetId}」在报告里找不到；引文也不是原文的逐字子串。`
          : '没有给落点，也没有给原文引文。',
      });
      return;
    }

    if (!targetOk && targetId) {
      diagnostics.push({
        level: 'info',
        code: 'DEEP_TARGET_UNRESOLVED',
        message: `深查发现「${title}」的落点「${targetId}」在报告里找不到；已保留，界面上会标「落点未对上」。`,
      });
    }
    if (rawQuote && !quoteOk) {
      diagnostics.push({
        level: 'info',
        code: 'DEEP_QUOTE_UNRESOLVED',
        message: `深查发现「${title}」的引文与原文对不上；已保留，界面上会标「引文未对上」。`,
      });
    }
    if (theoryRef && !theoryOk) {
      diagnostics.push({
        level: 'info',
        code: 'DEEP_THEORY_UNRESOLVED',
        message: `深查发现「${title}」的理论依据「${theoryRef}」不在主张库里；已保留，界面上会标「理论依据未对上」。`,
      });
    }

    findings.push({
      id,
      kind: kind ?? 'structure',
      title,
      detail,
      targetId,
      quote,
      theoryRef,
      method,
      ifChanged,
      challenge,
      status,
      targetOk,
      quoteOk,
      theoryOk,
    });
  });

  rawUnlocated.forEach((item) => {
    const x = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const title = s(x.title);
    if (!title) return;
    unlocated.push({
      title,
      detail: s(x.detail) || '（没有写细节）',
      why: s(x.why) || '模型没有写为什么指不到位置。',
    });
  });

  if (!findings.length && !unlocated.length) {
    diagnostics.push({
      level: 'info',
      code: 'DEEP_EMPTY',
      message: '这次深查没有产出可复核的发现。没有发现不等于没有问题；这份账本只说明这一遍没有写下来。',
    });
  }

  return { deep: { findings, unlocated }, diagnostics };
}

export interface DeepChallengeResult {
  deep: DeepReport;
  diagnostics: Diagnostic[];
}

/**
 * 把第二遍的 challenges 合并回发现。
 *
 * 只认 id 对应；第二遍新增的 finding 不合并（那会绕过第一遍的落点核对）。
 * 没被反驳到的发现标 `unresolved`，不假装它站住了。
 */
export function applyDeepChallenges(deep: DeepReport, raw: unknown): DeepChallengeResult {
  const diagnostics: Diagnostic[] = [];
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray((obj as any).challenges) ? ((obj as any).challenges as unknown[]) : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const item of list) {
    const x = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const id = s(x.id);
    if (!id) continue;
    if (byId.has(id)) {
      diagnostics.push({
        level: 'info',
        code: 'DEEP_CHALLENGE_DUPLICATED',
        message: `第二遍对「${id}」给了两条反驳，只取第一条；第二条没有可对应的位置。`,
      });
      continue;
    }
    byId.set(id, x);
  }
  const known = new Set(deep.findings.map((f) => f.id));
  for (const id of byId.keys()) {
    if (!known.has(id)) {
      diagnostics.push({
        level: 'info',
        code: 'DEEP_CHALLENGE_UNKNOWN',
        message: `第二遍反驳了不存在的发现「${id}」，已忽略；第二遍不许新增发现。`,
      });
    }
  }
  const findings = deep.findings.map((f) => {
    const x = byId.get(f.id);
    if (!x) {
      return {
        ...f,
        status: 'unresolved' as DeepStatus,
      };
    }
    const rawStatus = s(x.status);
    const status = (DEEP_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as DeepStatus)
      : 'unresolved';
    const challenge = s(x.challenge) || s(x.reason);
    if (status !== 'unresolved' && !challenge) {
      diagnostics.push({
        level: 'info',
        code: 'DEEP_CHALLENGE_MISSING',
        message: `第二遍把「${f.id}」标成「${DEEP_STATUS_LABEL[status]}」却没写最强反驳；已降为未决。`,
      });
      return { ...f, status: 'unresolved' as DeepStatus };
    }
    return {
      ...f,
      challenge: challenge || f.challenge,
      ifChanged: s(x.ifChanged) || f.ifChanged,
      status,
    };
  });
  if (list.length && !findings.length) {
    diagnostics.push({
      level: 'info',
      code: 'DEEP_CHALLENGE_EMPTY',
      message: '第二遍给了反驳，但第一遍没有可对应的发现；这一段没有可合并的内容。',
    });
  }
  return { deep: { ...deep, findings }, diagnostics };
}

export interface DeepCounts {
  total: number;
  located: number;
  unlocated: number;
  confirmed: number;
  weakened: number;
  rejected: number;
  pending: number;
}

export function deepSummary(deep: DeepReport | null | undefined): DeepCounts {
  const findings = deep?.findings ?? [];
  const count = (s: DeepStatus) => findings.filter((x) => x.status === s).length;
  return {
    total: findings.length,
    located: findings.filter((x) => x.targetOk || x.quoteOk).length,
    unlocated: deep?.unlocated?.length ?? 0,
    confirmed: count('confirmed'),
    weakened: count('weakened'),
    rejected: count('rejected'),
    pending: count('open') + count('unresolved'),
  };
}

/** 一行总述；没有发现时返回 null，由界面自己说「这一遍没有写下来」。 */
export function deepLine(deep: DeepReport | null | undefined): string | null {
  const c = deepSummary(deep);
  if (!c.total && !c.unlocated) return null;
  const parts = [
    `${c.total} 处发现`,
    `${c.located} 处有原文或检查项落点`,
    `${c.confirmed} 站住 / ${c.weakened} 削弱 / ${c.rejected} 推翻 / ${c.pending} 未决`,
  ];
  if (c.unlocated) parts.push(`${c.unlocated} 处落不到原文（另列）`);
  return parts.join(' · ');
}

export const DEEP_CAVEAT =
  '这些是第二遍找出来的候选，不是判决；「站住」只表示它扛过了这一次反驳，不表示它一定成立。';

export const DEEP_EMPTY_NOTE =
  '这一遍没有产出可复核的发现。没有发现不等于没有问题——它只说明这一次没有写下来。';

/** 导出件里的「深查发现」段；只排版，不另写评价。 */
export function deepMarkdown(deep: DeepReport | null | undefined): string {
  if (!deep) return '';
  const c = deepSummary(deep);
  if (!c.total && !c.unlocated) return '';
  const L: string[] = ['## 深查发现', '', `> ${DEEP_CAVEAT}`, ''];
  const line = deepLine(deep);
  if (line) L.push(line, '');
  deep.findings.forEach((f) => {
    L.push(`### ${f.id} · ${DEEP_KIND_LABEL[f.kind]} · ${DEEP_STATUS_LABEL[f.status]}`, '');
    L.push(`**${f.title}**`, '');
    if (f.detail) L.push(f.detail, '');
    if (f.targetId) L.push(`- 落点：${f.targetId}${f.targetOk ? '' : '（报告里找不到这个位置）'}`);
    if (f.quote) L.push(`- 引文：「${f.quote}」${f.quoteOk ? '' : '（与原文对不上）'}`);
    if (f.theoryRef) L.push(`- 理论依据：${f.theoryRef}${f.theoryOk ? '' : '（主张库里没有这一条）'}`);
    if (f.ifChanged) L.push(`- 什么会改变它：${f.ifChanged}`);
    if (f.challenge) L.push(`- 最强反驳：${f.challenge}`);
    L.push('');
  });
  if (deep.unlocated.length) {
    L.push('### 落不到原文的候选', '');
    deep.unlocated.forEach((u) => {
      L.push(`- **${u.title}**：${u.detail}（${u.why}）`);
    });
    L.push('');
  }
  return L.join('\n');
}
