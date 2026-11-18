import { MODE_META, normalizeMode } from '@shared/types';
import type {
  AnalysisMode,
  ArsLens,
  CatalogLens,
  CheckAnswer,
  CheckItem,
  CheckSystem,
  Claim,
  ClaimRole,
  Conclusion,
  ConfidenceLevel,
  Diagnosis,
  Diagnostic,
  EpistemicTag,
  LabelCandidate,
  LegitimateMove,
  LensDetail,
  PragmaLens,
  PtaLens,
  Refutation,
  RefutationStrategy,
  ToulminLens,
  UsageRecord,
  VerdictLevel,
  WaltonLens,
} from '@shared/types';
import { DEFAULT_THEORY, THEORY_BY_ID, isTheoryId, type TheoryId } from '@shared/theories';
import { auditReport } from '@shared/report-audit';
import { normalizeBrief } from '@shared/brief';
import { normalizeGrounding } from '@shared/context-grounding';
import { normalizeDivergence } from '@shared/divergence';
import { buildPrompt, renderPrompt, SAMPLING } from './prompt';
import { chat, extractJson, LlmError, type ChatResult } from './llm';
import { locate } from './locator';
import { recordChatUsage } from './usage';
import { readSettings } from './store';
import { estimateTokens } from '@shared/tokens';
import { FALLACIES_BY_ID } from './kb/fallacies';
import { SCHEMES_BY_ID } from './kb/schemes';
import { PRAGMA_RULES } from './kb/pragma';

/**
 * 分析管线。
 *
 * 这里做的不只是「把模型的话翻译成结构」。这里有一层**确定性裁决**，
 * 它存在的唯一理由是：模型会给出越界的判断，而以下几类越界可以被代码抓住。
 *
 * 抓住的十一类：
 *   G1 名录透镜给出了终局判定        → 强制打回 undetermined
 *   G2 范围门判不适用却仍有检查项     → 清空 checks
 *   G3 削弱性击败写成「结论为假」     → 改回 argument-only
 *   G4 命名缺门槛（条件/合法情形/误判风险）→ 不显示该条目
 *   G5 型式 id 不在库内               → 降为 none
 *   G6 检查项 system 与透镜不符        → 改正并留痕
 *   G7 固定清单未列全（十规则/六要素）→ 补齐为「未覆盖」，不假装评估过
 *   G8 不给档位的模式给出档位           → 打回 undetermined
 *   G9 同一句既当依据又当中间结论      → 合并为一步
 *   G10 判为适用却抽不出结论           → 清引文并打回 undetermined
 *   G11 查谬误模式的命名没有位置        → 丢弃该条目，不显示
 *
 * 前七类是设计时就知道要防的；G8、G9 是评测跑出来的——真实语料里
 * 「不给档位的模式顺手给档位」和「一句话被算成两级支撑」都不是偶发，
 * 而是模型在没有外部约束时的默认走法。代码不抓，它们就会一直出现。
 * G11 是加查谬误模式时一并加的：那个模式把名字当主输出，而名字最容易脱离位置单独存在。
 *
 * 每一类都往 diagnostics 里写一条，界面必须展示。静默修正是另一种撒谎。
 */

const MAX_LEN = 15000;

type Progress = (stage: any, label: string, percent: number) => void;

/** 供应商主机名。只留 host，不落路径也不落 Key——这份账可能被导出成 CSV 发出去。 */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl.replace(/^https?:\/\//, '').split('/')[0] || '未知';
  }
}

const TAGS = ['known', 'computed', 'inferred', 'general', 'framework', 'guess'] as const;
const CONFS = ['high', 'medium', 'low', 'very-low', 'undetermined'] as const;
const ANSWERS = ['passed', 'violated', 'unanswered', 'not-applicable'] as const;
const LEVELS = ['withstands', 'weakened', 'fails', 'undetermined'] as const;
const SYSTEMS = ['walton-cq', 'pragma-rule', 'ars', 'pta', 'toulmin', 'catalog'] as const;

const EXPECTED_SYSTEM: Record<TheoryId, CheckSystem> = {
  walton: 'walton-cq',
  pragma: 'pragma-rule',
  ars: 'ars',
  pta: 'pta',
  toulmin: 'toulmin',
  copi: 'catalog',
};

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
/**
 * 取一个「必须有字」的字段。
 *
 * `str` 只在类型不对时才用兜底，空串会原样通过——于是模型返回 `"text": ""` 时，
 * 主张卡上是一块没有标题的空白，判定那一段也是空白。读者看到的是「界面坏了」，
 * 而数据层只知道自己拿到一个合法的字符串。空串在语义上就是缺值，这里按缺值处理。
 */
function strNonEmpty(v: unknown, fallback: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || fallback;
}
function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
function optStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function tag(v: unknown): EpistemicTag {
  return oneOf(v, TAGS, 'inferred');
}
function conf(v: unknown, fallback: ConfidenceLevel = 'undetermined'): ConfidenceLevel {
  return oneOf(v, CONFS, fallback);
}

/* ─────────── 主张 ─────────── */

function normalizeClaim(raw: any, passage: string, role: ClaimRole, fallbackId: string): Claim {
  const quote = optStr(raw?.quote);
  const acc = raw?.acceptability ?? {};
  return {
    id: str(raw?.id, fallbackId),
    role,
    text: strNonEmpty(raw?.text, quote ?? '（未能抽出陈述）'),
    supports: arr<string>(raw?.supports).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()),
    quote,
    span: locate(passage, quote),
    implicit: raw?.implicit === true || !quote,
    implicitBasis: optStr(raw?.implicitBasis),
    burden: oneOf(raw?.burden, ['proponent', 'respondent', 'both', 'unclear'] as const, 'unclear'),
    acceptability: {
      status: oneOf(acc?.status, ['acceptable', 'questionable', 'unacceptable', 'unknown'] as const, 'unknown'),
      reason: str(acc?.reason),
      forAudience: str(acc?.forAudience),
      tag: tag(acc?.tag),
      confidence: conf(acc?.confidence),
    },
  };
}

/**
 * 结构连线的兜底。
 *
 * 界面上的思维导图完全按 supports 画。模型漏填、写错 id、指回自己，都会让图变成
 * 一堆断线——而图一旦不可信，用户就会倒回去读那段最难读的表格。
 *
 * 所以这里统一收口：未知 id 丢掉、自指丢掉、空的一律落到结论 C（最朴素的重构），
 * 并且**留痕**，不静默。
 */
function resolveSupports(claims: Claim[], diagnostics: Diagnostic[]): void {
  const ids = new Set(claims.map((c) => c.id));
  let dangling = 0;

  for (const c of claims) {
    if (c.role === 'conclusion') {
      c.supports = [];
      continue;
    }
    const kept = c.supports.filter((s) => {
      if (s === c.id) return false;
      if (!ids.has(s)) {
        dangling += 1;
        return false;
      }
      return true;
    });
    c.supports = kept.length ? Array.from(new Set(kept)) : ['C'];
  }

  if (dangling) {
    diagnostics.push({
      level: 'info',
      code: 'SUPPORTS_UNRESOLVED',
      message: `有 ${dangling} 处「支撑关系」指向了不存在的主张 id，已丢弃；对应的前提按「直接支撑结论」处理。`,
    });
  }
}

function normalizeConclusion(raw: any, passage: string): Conclusion {
  return {
    ...normalizeClaim(raw, passage, 'conclusion', 'C'),
    id: 'C',
    role: 'conclusion',
    modalOverreach: raw?.modalOverreach === true,
    modalNote: str(raw?.modalNote),
  };
}

/* ─────────── 检查项 ─────────── */

const PRAGMA_IDS = PRAGMA_RULES.map((r) => `R${r.n}`);
const TOULMIN_IDS = ['T-claim', 'T-grounds', 'T-warrant', 'T-backing', 'T-qualifier', 'T-rebuttal'];

function normalizeChecks(raw: unknown, theory: TheoryId, diagnostics: Diagnostic[]): CheckItem[] {
  const expected = EXPECTED_SYSTEM[theory];
  const items: CheckItem[] = arr<any>(raw).map((c, i) => {
    const sys = oneOf(c?.system, SYSTEMS, expected);
    if (sys !== expected) {
      diagnostics.push({
        level: 'info',
        code: 'CHECK_SYSTEM_FIXED',
        message: `检查项「${str(c?.label, str(c?.id, `#${i + 1}`))}」标为 ${sys}，与「${THEORY_BY_ID[theory].name}」透镜不符，已按 ${expected} 记录。`,
      });
    }
    return {
      id: str(c?.id, `K${i + 1}`),
      system: expected,
      label: str(c?.label, str(c?.id, `检查项 ${i + 1}`)),
      question: str(c?.question),
      meta: c?.meta === true,
      answer: oneOf<CheckAnswer>(c?.answer, ANSWERS, 'unanswered'),
      basis: str(c?.basis),
      guards: str(c?.guards),
      landsOn: optStr(c?.landsOn),
    };
  });

  /*
   * 同一编号出现两次：保留信息最全的那一条。
   *
   * 模型偶尔会把同一项写两遍——一条只有编号和 label，另一条才有 answer 和 basis。
   * 原样留下的话，界面上是两张长得一样的卡，其中一张是空壳；更要紧的是
   * 渲染层的 key 撞车，列表会错位。自检里「检查项 id 重复」那条抓的就是这个，
   * 而它抓到的第一份真实报告正是这个形态。
   *
   * 不简单「保留第一条」：第一条常常是空壳，真正的判断在第二条。
   * 也不合并——两条的 basis 说的是不同的事，硬拼会造出一句谁也没说过的话。
   */
  {
    const byId = new Map<string, CheckItem>();
    const order: string[] = [];
    const score = (c: CheckItem) => (c.answer === 'passed' || c.answer === 'violated' ? 2 : 0) + (c.basis.trim() ? 1 : 0);
    for (const it of items) {
      const prev = byId.get(it.id);
      if (!prev) {
        byId.set(it.id, it);
        order.push(it.id);
        continue;
      }
      const winner = score(it) > score(prev) ? it : prev;
      const loser = winner === it ? prev : it;
      diagnostics.push({
        level: 'warn',
        code: 'CHECK_ID_DUP',
        message: `检查项 ${it.id} 出现了两次，已保留信息更全的那一条。丢弃的那条是「${loser.label}」（${loser.answer}，依据${loser.basis.trim() ? '有' : '空'}）。`,
      });
      byId.set(it.id, winner);
    }
    items.length = 0;
    for (const id of order) items.push(byId.get(id)!);
  }

  // G7：固定清单必须列全。缺的不假装答过，标「未覆盖」。
  const fixedIds = theory === 'pragma' ? PRAGMA_IDS : theory === 'toulmin' ? TOULMIN_IDS : null;
  if (fixedIds && items.length) {
    const have = new Set(items.map((x) => x.id));
    const missing = fixedIds.filter((id) => !have.has(id));
    if (missing.length) {
      diagnostics.push({
        level: 'warn',
        code: 'CHECKLIST_INCOMPLETE',
        message: `本应逐条过 ${fixedIds.length} 项，实际只评了 ${items.length} 项。缺的 ${missing.join('、')} 已补为「未覆盖」，不代表已通过。`,
      });
      const TOULMIN_LABEL: Record<string, string> = {
        'T-claim': '主张在场',
        'T-grounds': '理由在场',
        'T-warrant': '担保在场',
        'T-backing': '支援在场',
        'T-qualifier': '限定在场',
        'T-rebuttal': '例外在场',
      };
      for (const id of missing) {
        const label =
          theory === 'pragma'
            ? `第 ${id.replace(/^R/, '')} 条 ${PRAGMA_RULES.find((r) => `R${r.n}` === id)?.name ?? ''}`.trim()
            : (TOULMIN_LABEL[id] ?? id);
        items.push({
          id,
          system: expected,
          label,
          question: '',
          meta: false,
          answer: 'not-applicable',
          basis: '本次分析未覆盖此项，不代表它已通过。',
          guards: '',
          landsOn: null,
        });
      }
    }
  }

  return items;
}

/* ─────────── 透镜负载 ─────────── */

function normalizeLens(raw: any, theory: TheoryId, diagnostics: Diagnostic[], passage: string): LensDetail {
  const l = raw?.lens ?? raw ?? {};

  switch (theory) {
    case 'walton': {
      const schemeId = str(l.schemeId, 'none');
      const known = schemeId === 'none' || SCHEMES_BY_ID.has(schemeId);
      if (!known) {
        diagnostics.push({
          level: 'warn',
          code: 'UNKNOWN_SCHEME',
          message: `型式「${schemeId}」不在库内（库中 ${SCHEMES_BY_ID.size} 个），已降为 none。请勿把索引外的型式名当判定依据。`,
        });
      }
      const detail: WaltonLens = {
        kind: 'walton',
        family: oneOf(l.family, ['pragmatic', 'causal', 'source', 'comparison', 'mixed', 'none'] as const, 'none'),
        familyBasis: str(l.familyBasis),
        schemeId: known ? schemeId : 'none',
        schemeName: known ? str(l.schemeName, schemeId) : '未识别型式',
        skeleton: str(l.skeleton),
        alternativeFamily: (['pragmatic', 'causal', 'source', 'comparison', 'mixed', 'none'] as const).includes(
          l.alternativeFamily
        )
          ? l.alternativeFamily
          : null,
        alternativeNote: str(l.alternativeNote),
      };
      return detail;
    }

    case 'pragma': {
      const detail: PragmaLens = {
        kind: 'pragma',
        aimedAtResolution: l.aimedAtResolution !== false,
        aimedBasis: str(l.aimedBasis),
        stageBasis: str(l.stageBasis),
        blockedBy: oneOf(l.blockedBy, ['proponent', 'respondent', 'both', 'unclear'] as const, 'unclear'),
      };
      return detail;
    }

    case 'ars': {
      const detail: ArsLens = {
        kind: 'ars',
        burdenStandard: str(l.burdenStandard),
        sufficiencyNote: str(l.sufficiencyNote),
        gapAt: oneOf(l.gapAt, ['premise', 'link', 'missing-premise', 'none'] as const, 'none'),
      };
      if (!detail.burdenStandard.trim()) {
        diagnostics.push({
          level: 'warn',
          code: 'NO_BURDEN_STANDARD',
          message: '未写明论证负担。缺这一项，「充分性」判断没有参照，只应视为印象。',
        });
      }
      return detail;
    }

    case 'pta': {
      const detail: PtaLens = {
        kind: 'pta',
        order: oneOf(l.order, ['first', 'second', 'undetermined'] as const, 'undetermined'),
        axis: oneOf(l.axis, ['predicate', 'subject', 'undetermined'] as const, 'undetermined'),
        premiseType: oneOf(l.premiseType, ['fact', 'value', 'policy', 'undetermined'] as const, 'undetermined'),
        conclusionType: oneOf(l.conclusionType, ['fact', 'value', 'policy', 'undetermined'] as const, 'undetermined'),
        ptaType: optStr(l.ptaType),
        ptaName: optStr(l.ptaName),
        waltonId: optStr(l.waltonId),
        featureNotes: {
          order: str(l.featureNotes?.order),
          axis: str(l.featureNotes?.axis),
          statementType: str(l.featureNotes?.statementType),
        },
      };
      const allUndetermined =
        detail.order === 'undetermined' && detail.axis === 'undetermined' && detail.premiseType === 'undetermined';
      if (allUndetermined) {
        diagnostics.push({
          level: 'warn',
          code: 'PTA_NO_FEATURE',
          message: '三个特征全部未定。此时定位没有信息量，应视为「本透镜在本文本上失效」，不要读成中性结论。',
        });
      }
      return detail;
    }

    case 'toulmin': {
      const detail: ToulminLens = {
        kind: 'toulmin',
        grounds: arr<string>(l.grounds).filter((x) => typeof x === 'string' && x.trim()),
        warrant: optStr(l.warrant),
        warrantStated: l.warrantStated === true,
        warrantType: oneOf(
          l.warrantType,
          ['generalization', 'causal', 'definitional', 'authority', 'analogy', 'value', 'none'] as const,
          'none'
        ),
        backing: optStr(l.backing),
        qualifier: optStr(l.qualifier),
        rebuttals: arr<string>(l.rebuttals).filter((x) => typeof x === 'string' && x.trim()),
        gapBetween: str(l.gapBetween),
      };
      if (detail.warrant && !detail.warrantStated && !detail.gapBetween.trim()) {
        diagnostics.push({
          level: 'warn',
          code: 'WARRANT_UNMARKED',
          message: '给出了担保但未标明是原文所述还是推定补出，也未说明跳跃位置。补出的担保属推定，必须标注。',
        });
      }
      return detail;
    }

    case 'copi': {
      const detail: CatalogLens = {
        kind: 'copi',
        candidates: normalizeLabels(l.candidates ?? raw?.labels, diagnostics, passage),
        whatItMisses: str(l.whatItMisses),
      };
      return detail;
    }
  }
}

/* ─────────── 命名候选：三条门槛 ─────────── */

function normalizeLabels(raw: unknown, diagnostics: Diagnostic[], passage: string): LabelCandidate[] {
  const out: LabelCandidate[] = [];
  const seen = new Set<string>();
  for (const f of arr<any>(raw)) {
    const id = str(f?.id);
    const def = FALLACIES_BY_ID.get(id);
    if (!def) {
      diagnostics.push({
        level: 'warn',
        code: 'UNKNOWN_LABEL',
        message: `「${str(f?.name, id) || '未命名条目'}」不在名录内，已丢弃。索引外的名字不许用。`,
      });
      continue;
    }
    /*
     * 同一个条目名出现两次，是模型把同一处硬拆成两条候选。
     * 界面上两个一模一样的标签并排，用户会以为这是两处问题、两处都要回应——
     * 而实际只有一处。合并掉第一个之后的所有重复，并留痕。
     */
    if (seen.has(id)) {
      diagnostics.push({
        level: 'info',
        code: 'LABEL_DUPLICATED',
        message: `「${def.name}」在同一份报告里出现了两次，已合并为一条。`,
      });
      continue;
    }
    const condition = str(f?.condition).trim();
    const legit = str(f?.whenLegitimate).trim();
    const risk = str(f?.riskOfError).trim();
    if (!condition || !legit || !risk) {
      const miss = [!condition && '成立条件', !legit && '何时其实合法', !risk && '误判风险']
        .filter(Boolean)
        .join('、');
      diagnostics.push({
        level: 'warn',
        code: 'NAMING_GATE',
        message: `「${def.name}」缺 ${miss}，按规则不予显示。贴标签不付代价，是这类工具最常见的堕落方式。`,
      });
      continue;
    }
    out.push({
      id,
      name: def.name,
      nameEn: def.nameEn,
      quote: optStr(f?.quote),
      span: locate(passage, optStr(f?.quote)),
      condition,
      whenLegitimate: legit,
      riskOfError: risk,
      landsOnCheck: optStr(f?.landsOnCheck),
      tradition: str(f?.tradition, def.tradition),
      tag: tag(f?.tag),
      confidence: conf(f?.confidence, 'low'),
    });
    seen.add(id);
  }
  return out.slice(0, 3);
}

/* ─────────── 主归一化 ─────────── */

/**
 * 报告 id。时间前缀保证按文件名排序就是按时间排序，
 * 随机后缀防止同一毫秒内连跑两次撞号（快速连点「分析」会发生）。
 */
export function newReportId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 「谁跑的」三项齐全才写，否则整条不写。
 *
 * 为什么不是逐项兜底（缺温度就只写模型名）：同题复跑要把这一栏当身份读，
 * 半条记录会让读的人以为「这三份是同一个模型、同一个温度」，而温度其实是空的。
 * 空着并说「没记」是诚实的；补一半是最坏的那种诚实——它看起来完整。
 */
function normalizeEngine(raw: Diagnosis['engine']): Diagnosis['engine'] {
  if (!raw) return undefined;
  const model = typeof raw.model === 'string' ? raw.model.trim() : '';
  const host = typeof raw.host === 'string' ? raw.host.trim() : '';
  const t = typeof raw.temperature === 'number' ? raw.temperature : NaN;
  if (!model || !host || !Number.isFinite(t) || t < 0 || t > 2) return undefined;
  return { model, host, temperature: t };
}

export function normalizeDiagnosis(
  raw: any,
  passage: string,
  theory: TheoryId,
  opts: {
    mode?: AnalysisMode;
    parentId?: string | null;
    id?: string;
    createdAt?: number;
    prompt?: { version: string; fingerprint: string };
    /**
     * 跑出这份报告的模型、供应商主机与生效温度。
     *
     * 由调用方给，不在这里从设置里读：`normalizeDiagnosis` 是纯解析（重放也用它，
     * 而重放不重新发请求，那时读到的设置与当初那次毫无关系）。
     * 谁真的发了请求，谁才对「是谁跑的」有答案。
     */
    engine?: Diagnosis['engine'];
  } = {}
): Diagnosis {
  const diagnostics: Diagnostic[] = [];
  /*
   * 模式在这里归一，不在调用处用三元判断。
   * `mode === 'redteam' ? 'redteam' : 'diagnose'` 这种写法在只有两个模式时是对的，
   * 加到四个之后它会对不认识的模式**静默返回 diagnose**：
   * 界面照常出报告，报告上写着「诊断」，而用户以为自己在重构。
   */
  const mode: AnalysisMode = normalizeMode(opts.mode);
  /** 三个模式不给档位（查谬误／重构／提问）。这一条在下面 G8 处由代码强制，不靠模型自觉。 */
  const givesVerdict: boolean = MODE_META[mode].givesVerdict;

  if (!raw || typeof raw !== 'object') {
    throw new LlmError('BAD_SHAPE', '模型返回的结构不是对象。');
  }

  /* 语境 */
  const c = raw.context ?? {};
  const grounding = normalizeGrounding(c.grounding, passage);
  const context = {
    issue: strNonEmpty(c.issue, '（未能确定争议之点）'),
    speakerPosition: str(c.speakerPosition),
    opposingPosition: optStr(c.opposingPosition),
    dialogueType: oneOf(
      c.dialogueType,
      [
        'persuasion',
        'inquiry',
        'negotiation',
        'deliberation',
        'information-seeking',
        'eristic',
        'mixed',
        'unknown',
      ] as const,
      'unknown'
    ),
    dialogueTypeBasis: str(c.dialogueTypeBasis),
    stage: oneOf(c.stage, ['confrontation', 'opening', 'argumentation', 'concluding', 'unknown'] as const, 'unknown'),
    audience: str(c.audience),
    audienceKind: oneOf(
      c.audienceKind,
      ['general', 'specialist', 'adversarial', 'supportive', 'unknown'] as const,
      'unknown'
    ),
    contextGaps: arr<string>(c.contextGaps).filter((x) => typeof x === 'string'),
    /*
     * 语境出处。这一段是本轮新加的：报告其余部分都能回原文，只有语境九格是裸断言，
     * 而它们在最上游（ARS 的可接受性从听众出发，walton 的 CQ 从对话类型出发）。
     * 校验与降级都在 shared 里做，这里只负责把结果接上，并在降级时留一条诊断——
     * 不留痕的话，界面会显示一份「全部都能从原文指出」的报告，而那是假的。
     */
    grounding: grounding.grounding,
  };
  for (const p of grounding.problems) {
    if (p.kind === 'basis-not-in-text' || p.kind === 'bad-source') {
      diagnostics.push({
        level: 'warn',
        code: 'CONTEXT_GROUNDING',
        message: `语境「${p.field}」${p.detail}`,
      });
    }
  }

  /* 范围门 */
  const sc = raw.scope ?? {};
  const scope = {
    applicable: sc.applicable !== false,
    reason: str(sc.reason),
    outOfScopeAt: optStr(sc.outOfScopeAt),
    partialNote: optStr(sc.partialNote),
  };

  /* 重构 */
  const conclusion = normalizeConclusion(raw.conclusion, passage);
  const premises = arr<any>(raw.premises).map((p, i) => normalizeClaim(p, passage, 'premise', `P${i + 1}`));
  let intermediate = arr<any>(raw.intermediate).map((p, i) =>
    normalizeClaim(p, passage, 'intermediate', `M${i + 1}`)
  );

  // 显式主张定位失败 → 降级为推定，并留痕
  for (const cl of [conclusion as Claim, ...premises, ...intermediate]) {
    if (!cl.implicit && cl.span && cl.span.quality === 'failed') {
      cl.implicit = true;
      cl.implicitBasis = cl.implicitBasis ?? '原文中未能定位该引文，按推定处理。';
      diagnostics.push({
        level: 'warn',
        code: 'QUOTE_NOT_FOUND',
        message: `「${cl.text.slice(0, 24)}」的引文在原文中未能定位，已降级为「推定」处理。`,
      });
    }
  }

  /*
   * 占位结论不该挂引文。
   *
   * 判了「透镜不适用」时，结论栏常常只剩一句给程序看的占位文字
   * （「无结论可规范化：文本未提出任何可检验的主张」），而模型仍会顺手给它
   * 找一个 quote。于是报告上出现「结论：无结论……「没有人说话。」」——
   * 一句话自己否定自己，读者只会以为界面坏了。它确实坏了，只是坏在数据层。
   *
   * 清引文这件事与 scope 无关，所以这里不再要求 !scope.applicable：
   * 占位文字不是主张，它不指向原文任何位置，挂着 quote 在任何情况下都是自相矛盾。
   * 真实账上就有这样一份——透镜判为适用、结论栏却是占位文字、引文照样挂到了原文上。
   * 那种情形本身还多一层矛盾（适用意味着能分析，却一条结论都没抽出来），
   * 所以额外留一条 G10。
   */
  const PLACEHOLDER_CONCLUSION = /^无结论|^（未能|^未提出|^文本未/;
  if (PLACEHOLDER_CONCLUSION.test(conclusion.text)) {
    const hadQuote = Boolean(conclusion.quote || conclusion.span);
    conclusion.quote = null;
    conclusion.span = null;
    if (scope.applicable) {
      diagnostics.push({
        level: 'warn',
        code: 'APPLICABLE_BUT_NO_CLAIM',
        message: `这副透镜在本文本上判为适用，却没有抽出一条可检验的结论（结论栏是「${conclusion.text.slice(0, 20)}」）。适用与无结论不能同时成立：要么这份文本其实不适用，要么结论没被抽出来。引文已清掉，档位已打回「判不了」。`,
      });
    } else if (hadQuote) {
      diagnostics.push({
        level: 'info',
        code: 'PLACEHOLDER_QUOTE_CLEARED',
        message: '结论栏是占位文字，原本挂着的原文引文已清除——占位文字不指向原文任何位置。',
      });
    }
  }

  /*
   * G9：同一句既当依据又当中间结论。
   *
   * 这不是格式问题，是结构造假：图上多出一级，读者会以为结论被两级撑住，
   * 实际只有一句原话，中间那一级是同一句的改写。评测里真出现过
   * （「职业教育扩张会通过挤占师资……」同时是 P3 和 I1）。
   *
   * 处理方式是合并，不是丢弃：指向中间结论的支撑关系改指那条依据，
   * 再把中间结论删掉。删完必须留痕——用户看到的图少了一级，
   * 得知道少的那一级原本长什么样。
   */
  const byStart = new Map<number, Claim>();
  for (const p of premises) {
    if (!p.implicit && p.span && p.span.quality !== 'failed') byStart.set(p.span.start, p);
  }
  const redirect = new Map<string, string>();
  for (const m of intermediate) {
    if (!m.span || m.span.quality === 'failed') continue;
    const host = byStart.get(m.span.start);
    if (!host) continue;
    redirect.set(m.id, host.id);
    diagnostics.push({
      level: 'warn',
      code: 'RESTATED_STEP',
      message: `中间结论 ${m.id} 与依据 ${host.id} 引的是同一句「${(m.quote ?? '').slice(0, 20)}」，已合并为一步——同一句话不能既当理由又当推导结果。`,
    });
  }
  if (redirect.size) {
    for (const c of [conclusion as Claim, ...premises, ...intermediate]) {
      c.supports = Array.from(new Set(c.supports.map((s) => redirect.get(s) ?? s)));
    }
    intermediate = intermediate.filter((m) => !redirect.has(m.id));
  }

  /* 结构连线：界面按它画思维导图 */
  resolveSupports([conclusion as Claim, ...premises, ...intermediate], diagnostics);

  /* 透镜负载 */
  const lens = normalizeLens(raw, theory, diagnostics, passage);

  /* 检查项 */
  let checks = normalizeChecks(raw.checks, theory, diagnostics);

  // G2：范围门判不适用却仍有检查项 → 清空
  if (!scope.applicable && checks.length) {
    diagnostics.push({
      level: 'warn',
      code: 'SCOPE_CHECKS_DROPPED',
      message: `已判本透镜不适用（${scope.reason || '未说明理由'}），但模型仍给了 ${checks.length} 条检查项。已清空——不适用的尺子量出来的刻度是假的。`,
    });
    checks = [];
  }

  /* 击败 */
  const d = raw.defeat ?? {};
  const defeat = {
    kind: oneOf(d.kind, ['undermining', 'rebutting', 'none'] as const, 'none'),
    checkId: optStr(d.checkId ?? d.cqId),
    cuts: str(d.cuts),
    explanation: str(d.explanation),
    tag: tag(d.tag),
    confidence: conf(d.confidence),
  };

  /* 结论 */
  const v = raw.verdict ?? {};
  let level: VerdictLevel = oneOf<VerdictLevel>(v.level, LEVELS, 'undetermined');
  let whatIsRefuted = oneOf(v.whatIsRefuted, ['argument-only', 'conclusion', 'nothing'] as const, 'argument-only');

  // G3：削弱性击败不许写成「结论为假」
  if (level === 'fails' && whatIsRefuted === 'conclusion' && defeat.kind !== 'rebutting') {
    whatIsRefuted = 'argument-only';
    diagnostics.push({
      level: 'warn',
      code: 'OVERRUN_CORRECTED',
      message: '检测到「削弱性击败」被写成「结论为假」，已改回「仅否证论证」。截断前提与结论的联结，不否证结论。',
    });
  }

  // G1：名录透镜不产生判定
  if (theory === 'copi' && level !== 'undetermined') {
    diagnostics.push({
      level: 'warn',
      code: 'CATALOG_OVERREACH',
      message: '名录透镜给出了终局判定，已强制打回「判不了」。只给候选、不给结论，是这副透镜能存在的前提。',
    });
    level = 'undetermined';
    whatIsRefuted = 'nothing';
  }

  // 范围门：不适用即判不了
  if (!scope.applicable) {
    if (level !== 'undetermined') {
      diagnostics.push({
        level: 'info',
        code: 'SCOPE_LEVEL_FORCED',
        message: '透镜不适用，结论档位已统一为「判不了」。',
      });
    }
    level = 'undetermined';
    whatIsRefuted = 'nothing';
  }

  /*
   * G8：不给档位的模式（查谬误 / 重构 / 提问）不给判定。
   *
   * 提示词里已经明写了，这里再强制一遍，因为提示词是**请求**，这里是**保证**：
   * 模型照样会顺手给一个档位，界面会照常把它渲染成一份判定，
   * 用户切到重构模式要的就是「别判」，结果拿到一个「fails」——这个模式就白切了。
   *
   * 强制必须留痕。静默把档位改掉，用户看到的是一份「判不了」的报告，
   * 而不知道模型其实判过了；那种安静比报告本身更糟。
   */
  if (!givesVerdict) {
    if (level !== 'undetermined') {
      diagnostics.push({
        level: 'warn',
        code: 'MODE_NO_VERDICT',
        message: `本次是「${MODE_META[mode].label}」模式，该模式不给判定档位；模型给出的是「${level}」，已强制打回「判不了」。这不是解析错误，是模式定义：${MODE_META[mode].allowsLabels ? '指出几处推理不成立，不等于这段话的结论是错的' : '先判了再重构，重构就会往最弱的读法上靠'}。`,
      });
    }
    level = 'undetermined';
    whatIsRefuted = 'nothing';
    defeat.kind = 'none';
    defeat.checkId = null;
  }

  /*
   * G10：判为适用、却抽不出一条结论 → 档位打回「判不了」。
   *
   * 上面清引文那一处已经留了痕，这里补最后一刀：档位也不能当真。
   * 「这副透镜适用于本文本」与「本文本没有可检验的结论」不能同时成立——
   * 适用范围是拿来判定结论的，结论都不存在，判定就没有落点。
   *
   * 放在 G8 之后：模式本身不给档位时，档位已经回未定，这一条就没别的事可做。
   * 不单独再push一条：同一次生成里两条说同一件事的警告，
   * 只会让人以为出了两个问题。
   */
  if (scope.applicable && PLACEHOLDER_CONCLUSION.test(conclusion.text) && level !== 'undetermined') {
    level = 'undetermined';
    whatIsRefuted = 'nothing';
  }

  const verdict = {
    scale: strNonEmpty(v.scale, THEORY_BY_ID[theory].scale),
    scaleValue: str(v.scaleValue),
    level,
    statement: strNonEmpty(v.statement, '在目前给出的信息下，无法给出可靠判断。'),
    qualification: str(v.qualification),
    whatIsRefuted,
  };

  /* 修补 */
  const r = raw.repair ?? {};
  const repair = {
    missingPremise: optStr(r.missingPremise),
    alternativeReading: optStr(r.alternativeReading),
    answerable: arr<string>(r.answerable ?? r.answerableCQ).filter((x) => typeof x === 'string'),
    burdenStatus: str(r.burdenStatus),
    repairedForm: optStr(r.repairedForm),
  };

  /*
   * 命名候选：名录透镜从 lens 取，其余从顶层取。
   *
   * 门控用 allowsLabels，不再用 givesVerdict。
   *
   * 原先那行是 `givesVerdict ? … : []`——在四个模式下它是对的，因为「不给档位的」
   * 恰好就是「不命名的」。加了查谬误模式之后这两件事分开了：它给名字，但不给档位。
   * 沿用旧写法会把它的主输出整个清空，而报告看起来完全正常——只有一张空白的命名栏，
   * 用户会以为自己这段文本干干净净。一个开关管两件事，就会在只需要改一件时改错另一件。
   *
   * 重构 / 提问两个模式仍然不命名：命名是评价，与「只描述」冲突。
   */
  const rawLabelCount =
    theory === 'copi' ? (lens as CatalogLens).candidates.length : arr<any>(raw.labels).length;
  let labels: LabelCandidate[] = MODE_META[mode].allowsLabels
    ? theory === 'copi'
      ? (lens as CatalogLens).candidates
      : normalizeLabels(raw.labels, diagnostics, passage)
    : [];
  if (!MODE_META[mode].allowsLabels && rawLabelCount > 0) {
    diagnostics.push({
      level: 'warn',
      code: 'MODE_NO_LABELS',
      message: `本次是「${MODE_META[mode].label}」模式，该模式不命名；模型给了 ${rawLabelCount} 条命名候选，已清空。命名是评价，与「只描述」冲突。`,
    });
  }

  /*
   * G11：查谬误模式下，每条命名必须指得出原文哪一句、落得了一条检查项。
   *
   * 为什么只在查谬误模式下执行：其他三个模式里名字是末端注释，注释不必指出位置；
   * 而在这个模式里名字就是主输出——用户要拿它去对质，第一句就会问「我哪句话这样了」。
   * 答不上来，这条名字对他只有负作用：他不是多知道了一件事，是多背了一个标签。
   *
   * 两条判据分开处理，因为它们的性质不同：
   *
   *   位置（quote + 能定位）：硬要求，任何情况下都执行。说不出是哪一句，名字作废。
   *   落点（landsOnCheck）：只在**本透镜确实产生检查项**时才要求。
   *     名录透镜与 PTA 透镜按设计不产生检查项（checks 为空），
   *     这时候要求落点，等于让这两个透镜下的查谬误模式永远交白卷。
   *     检查项为空时不假装有条可落，改留一条 info 说明「这份名字只有位置、没有落点」。
   *
   * 丢弃一律留痕，并且说出丢的是哪一条、缺的是哪一样——静默丢弃会让用户以为
   * 模型什么都没找到，那是另一种撒谎。
   */
  if (mode === 'fallacy' && labels.length) {
    const checkIds = new Set(checks.map((c) => c.id));
    const kept: LabelCandidate[] = [];
    for (const l of labels) {
      const located = Boolean(l.quote && l.span && l.span.quality !== 'failed');
      if (!located) {
        diagnostics.push({
          level: 'warn',
          code: 'LABEL_NO_LOCATION',
          message: `「${l.name}」${l.quote ? '的引文在原文里找不到' : '没有给出原文引文'}，已不显示。查谬误模式下，说不清是原文哪一句的名字只是贴标签。`,
        });
        continue;
      }
      if (checkIds.size && (!l.landsOnCheck || !checkIds.has(l.landsOnCheck))) {
        diagnostics.push({
          level: 'warn',
          code: 'LABEL_NO_CHECK',
          message: `「${l.name}」${l.landsOnCheck ? `挂在 ${l.landsOnCheck} 上，但这份报告没有这一条检查项` : '没有挂在任何检查项上'}，已不显示。名字是末端注释，落到检查项上才算分析。`,
        });
        continue;
      }
      kept.push(l);
    }
    if (checkIds.size === 0 && kept.length) {
      diagnostics.push({
        level: 'info',
        code: 'LABEL_WITHOUT_CHECK',
        message: `本次透镜不产生检查项，所以这 ${kept.length} 条名字只有原文位置、没有落点。名字能对上原文，但它不挂在任何一条逐关检查上——判读时请以原文那一句为准。`,
      });
    }
    labels = kept;
  }

  /* 此处合法 */
  const legitimateMoves: LegitimateMove[] = arr<any>(raw.legitimateMoves)
    .filter((m) => typeof m?.why === 'string' && m.why.trim())
    .map((m) => ({
      targetId: str(m?.targetId, 'C'),
      quote: str(m?.quote),
      what: str(m?.what),
      why: str(m.why),
      tag: tag(m?.tag),
      confidence: conf(m?.confidence, 'low'),
    }));

  /*
   * 判了不适用时不再提醒「没找到此处合法」。
   *
   * 那一条提示的用意是防止清单法偷懒，适用范围是「有论证可评」的文本。
   * 在一段描写文上它只会制造噪音：本来就没有论证，当然没有「此处合法」，
   * 而用户看到的是一句暗示「可能没认真找」的黄条——把免责声明变成了指控。
   */
  if (!legitimateMoves.length && scope.applicable) {
    diagnostics.push({
      level: 'info',
      code: 'NO_LEGITIMATE_FOUND',
      message: '本次未找到「此处合法」的位置。这可能是因为确实没有，也可能是因为没认真找——后者是清单法的老毛病。',
    });
  }

  /* 反驳。提问模式下这些条目换一个含义：不是「对手会怎么说」，是「你要问什么」。 */
  let refutations: Refutation[] = arr<any>(raw.refutations)
    .filter((x) => typeof x?.script === 'string' && x.script.trim())
    .map((x, i) => ({
      id: str(x?.id, `R${i + 1}`),
      targetId: str(x?.targetId, 'C'),
      checkId: optStr(x?.checkId ?? x?.cqId),
      strategy: oneOf<RefutationStrategy>(
        x?.strategy,
        [
          'premise-false',
          'premise-unsupported',
          'missing-premise',
          'counterexample',
          'distinguo',
          'alternative-explanation',
          'scheme-mismatch',
          'burden-shift',
          'procedure-violation',
        ] as const,
        'premise-unsupported'
      ),
      claim: str(x?.claim),
      script: str(x.script).slice(0, 200),
      steelman: str(x?.steelman),
      reply: str(x?.reply),
      evidenceNeeded: arr<string>(x?.evidenceNeeded).filter((y) => typeof y === 'string'),
      burdenAfter: oneOf(x?.burdenAfter, ['proponent', 'respondent'] as const, 'proponent'),
      tag: tag(x?.tag),
      confidence: conf(x?.confidence, 'low'),
    }));

  /*
   * 哪些模式清空反驳。提问模式**保留**——那里它是主输出（问题清单）。
   * 一个模式清、一个模式留，不看「是不是判定模式」，看这一栏在该模式下有没有意义。
   *
   * 写成一张小表而不是两段 if：加第三个要清的模式时，只可能改这张表，
   * 不可能出现「复制了一段 if 却忘了改里面的模式名」——那种错的后果是
   * 某一份报告里混着两套输出，而报告本身看起来毫发无损。
   */
  const REFUTATION_OFF: Partial<Record<AnalysisMode, string>> = {
    reconstruct: '攻击路线属于红队模式，画结构属于这里。',
    fallacy: '攻击路线属于红队模式。这一份里混进攻击路线，用户会把它读成「这段有谬误」的证据。',
  };
  const refutationOffReason = REFUTATION_OFF[mode];
  if (refutationOffReason && refutations.length > 0) {
    diagnostics.push({
      level: 'warn',
      code: 'MODE_NO_REFUTATIONS',
      message: `本次是「${MODE_META[mode].label}」模式，不产出攻击路线；模型给了 ${refutations.length} 条，已清空。${refutationOffReason}`,
    });
    refutations = [];
  }

  const noSteelman = refutations.filter((x) => !x.steelman.trim());
  if (noSteelman.length) {
    diagnostics.push({
      level: 'warn',
      code: 'NO_STEELMAN',
      message: `${noSteelman.length} 条${mode === 'interrogate' ? '问题' : '反驳'}缺 steelman。${mode === 'interrogate' ? '没想到对方会怎么答，就不知道他答完之后你该接什么。' : '没有对方最强版本的回应，用户拿着它去说，大概率被打回。'}`,
    });
  }

  /* 自检 */
  const s = raw.selfCheck ?? {};
  const e = s.epi ?? {};
  const clamp02 = (n: unknown): 0 | 1 | 2 => (n === 1 || n === 2 ? n : 0);
  const p1 = clamp02(e.P1_source);
  const p2 = clamp02(e.P2_context);
  const p3 = clamp02(e.P3_position);
  const p4 = clamp02(e.P4_withdrawal);
  const p5 = clamp02(e.P5_selfApply);
  const p6 = clamp02(e.P6_openness);
  const p7 = clamp02(e.P7_steelman);
  const total = p1 + p2 + p3 + p4 + p5 + p6 + p7;
  const vetoed = p3 === 0 && p4 === 0;

  const underOtherLens = str(s.underOtherLens);
  if (!underOtherLens.trim()) {
    diagnostics.push({
      level: 'warn',
      code: 'NO_LENS_CONTRAST',
      message: '未写出「换另一副透镜会怎样」。缺这一栏，用户会以为眼前这份分析是唯一答案。',
    });
  }

  const selfCheck = {
    epi: {
      P1_source: p1,
      P2_context: p2,
      P3_position: p3,
      P4_withdrawal: p4,
      P5_selfApply: p5,
      P6_openness: p6,
      P7_steelman: p7,
      total,
      vetoed,
      reading: (vetoed ? 'labelling' : total >= 10 ? 'legitimate' : total >= 5 ? 'overreach' : 'labelling') as
        | 'legitimate'
        | 'overreach'
        | 'labelling',
      notes: arr<string>(e.notes).filter((x) => typeof x === 'string'),
    },
    ruleAudit: arr<string>(s.ruleAudit).filter((x) => typeof x === 'string'),
    unknowns: arr<string>(s.unknowns).filter((x) => typeof x === 'string'),
    opennessNote: str(s.opennessNote),
    withdrawIf: arr<string>(s.withdrawIf).filter((x) => typeof x === 'string'),
    underOtherLens,
  };

  /*
   * 合并掉中间结论之后，正文里的旧编号就成了悬空引用。
   *
   * defeat.cuts 这类字段是模型写的自由文本，里面会写「P1、P2 到 I1」。
   * 一旦 I1 被合并进 P3，那句话指的就是一个不存在的东西——
   * 读者在结构图上找不到 I1，会以为界面漏画了一级。
   * 所以合并必须连带改正文：把被合并的编号按同一张对照表换成合并后的编号。
   */
  const reId = (t: string): string =>
    redirect.size ? t.replace(/\b([PIM]\d+)\b/g, (m) => redirect.get(m) ?? m) : t;

  if (redirect.size) {
    defeat.cuts = reId(defeat.cuts);
    defeat.explanation = reId(defeat.explanation);
    verdict.statement = reId(verdict.statement);
    verdict.qualification = reId(verdict.qualification);
    repair.missingPremise = repair.missingPremise ? reId(repair.missingPremise) : repair.missingPremise;
    repair.repairedForm = repair.repairedForm ? reId(repair.repairedForm) : repair.repairedForm;
    repair.alternativeReading = repair.alternativeReading ? reId(repair.alternativeReading) : repair.alternativeReading;
    selfCheck.unknowns = selfCheck.unknowns.map(reId);
    for (const r of refutations) r.targetId = redirect.get(r.targetId) ?? r.targetId;
    for (const m of legitimateMoves) m.targetId = redirect.get(m.targetId) ?? m.targetId;
  }

  const report: Diagnosis = {
    version: 2,
    id: opts.id ?? newReportId(),    parentId: opts.parentId ?? null,
    /*
     * 存归一化后的 mode，不是 opts.mode。
     *
     * `opts.mode ?? 'diagnose'` 只兜住了 undefined，兜不住非法字符串：
     * 传进来 'redteam2' 时它会把原样存进报告，而上面所有与模式有关的裁决
     * 走的是归一化后的 mode。于是报告自称一种模式、行为按另一种走——
     * 这正是 normalizeMode 当初要消灭的那种静默不一致，只是换了个位置复发。
     */
    mode,
    theory,
    createdAt: opts.createdAt ?? Date.now(),
    passage,
    context,
    scope,
    conclusion,
    premises,
    intermediate,
    checks,
    lens,
    defeat,
    verdict,
    repair,
    labels,
    legitimateMoves,
    refutations,
    selfCheck,
    diagnostics,
    prompt: opts.prompt,
    engine: normalizeEngine(opts.engine),
  };

  /*
   * 自检：九道裁决全部跑完之后，报告还得自己过一遍。
   *
   * 为什么放在最后：前面几道裁决各自修一处，修完会互相影响——G9 把中间结论合并了，
   * 正文里的编号就要跟着换；换漏一处就是悬空引用。只有全部跑完，才知道整体是否自洽。
   *
   * 为什么不能吞掉：不变量破了意味着这份报告有结构性缺陷，用户拿它做的判断可能是错的。
   * 他不知道这件事，比看到一条警告糟得多。但这里也不拦着不让看——
   * 报告仍然可读，只是要带着这个前提读。
   *
   * 两级的严重性不同，所以分开记：
   *   SELF_AUDIT  结构自相矛盾（warn）——照着改会改错地方
   *   REPORT_GAP  该写没写（info）——判断本身成立，只是缺了下一步
   * 混成一级的话，79 条「这条反驳没写证据」会把 3 条「引用了不存在的 P3」淹掉。
   *
   * 这套检查原本只活在评测脚本里，跑一次要六分钟、十七万 token。
   * 现在每份报告都过一遍：本地计算，不花钱，不联网。
   */
  const audit = auditReport(report);
  for (const issue of audit.invariants) {
    diagnostics.push({
      level: 'warn',
      code: 'SELF_AUDIT',
      message: `报告自相矛盾：${issue}。其余部分不受影响，但涉及这一处的判读请自行核对原文。`,
    });
  }
  for (const gap of audit.gaps) {
    diagnostics.push({
      level: 'info',
      code: 'REPORT_GAP',
      message: `这一栏没写全：${gap}。判断本身不受影响。`,
    });
  }

  return report;
}

/* ─────────── 入口 ─────────── */

/**
 * 格式修复的追问。
 *
 * 只修格式，不追问内容。把解析错误原样喂回去，让模型自己把 JSON 闭合——
 * 这一步的实际收益是：截断/围栏/尾逗号这一类机械错误不必让用户重跑一次完整的分析，
 * 而重跑一次要再付一遍钱。
 *
 * 明确不许在这里说「你上一版分析得不对」：那会让第二次输出变成另一次判定，
 * 两次判定不一致时，用户手里的报告是哪一次的就再也说不清了。
 */
function repairMessage(err: string): string {
  return `上一次输出无法解析为 JSON：${err}

这不是文本的问题，是格式的问题。请把同一个分析结果重新输出一遍，只输出一个 JSON 对象：
- 不要 markdown 围栏，不要前言后记，不要解释
- 如果内容太长，删掉次要字段（例如 refutations 只留最强的一条），但必须保证 JSON 完整闭合
- 字符串内的引号要转义，末尾不要留逗号`;
}

export async function runAnalysis(
  passageRaw: string,
  theoryRaw: TheoryId,
  onProgress: Progress,
  opts: {
    mode?: AnalysisMode;
    parentId?: string | null;
    /**
     * 用户按「停」时由主进程 abort。
     *
     * 一路穿到 chat 的 fetch 上，不在中间任何一层「先跑完再丢掉」——
     * 那种做法看起来也能让界面立刻空出来，但请求还在跑、token 还在生成、
     * 钱还在花，而用户以为自己已经停了。停就要真的停。
     */
    signal?: AbortSignal;
    /**
     * 立案（A1 取材 / A2 准入）。由渲染层填，主进程只负责贴到报告上。
     *
     * 这里收 `unknown` 而不是 `Brief`：IPC 那头什么都可能传过来（旧版渲染层、
     * 手滑的调试脚本、被改过的 localStorage），收口放在 `normalizeBrief` 一处，
     * 它认不出来就返回 null——报告照常产出，只是流程账上写着「没立案」。
     */
    brief?: unknown;
    /** v1.1 分歧账：同 brief，收 unknown，由 normalizeDivergence 一处收口。 */
    divergence?: unknown;
  } = {}
): Promise<{ diagnosis: Diagnosis; usage: UsageRecord }> {
  const passage = passageRaw.trim();
  const theory = isTheoryId(theoryRaw) ? theoryRaw : DEFAULT_THEORY;
  const mode: AnalysisMode = normalizeMode(opts.mode);

  if (!passage) {
    throw new LlmError('EMPTY_INPUT', '文本为空。');
  }
  if (passage.length > MAX_LEN) {
    throw new LlmError('TOO_LONG', `文本过长（${passage.length} 字）。当前上限 ${MAX_LEN} 字，请分段分析。`);
  }

  const profile = THEORY_BY_ID[theory];
  const meta = MODE_META[mode];

  onProgress('scope', `按「${profile.name}」${meta.stageScope}`, 10);
  onProgress('reconstructing', '重构论证与隐含前提', 25);

  const build = buildPrompt(theory, mode);
  const { system: sys, user } = renderPrompt(build, passage);

  onProgress('checking', `逐条走${profile.unit}`, 50);

  const cfg = readSettings();
  const plan = SAMPLING[mode];
  /*
   * 温度取「用户设置」与「本模式上限」中更低的一个。
   * 上限存在的理由是一致性：温度高了，同一段文本两次分析结果不同，
   * 「修订后再判一次」这个功能就失去了参照系——那正是本工具唯一的闭环。
   * 裁剪必须留痕（diagnostics），静默改用户的设置是另一种越界。
   */
  const userTemp = Number.isFinite(cfg.temperature) ? cfg.temperature : plan.temperature;
  const temperature = Math.min(userTemp, plan.temperature);
  const clamped = userTemp - temperature > 1e-9;

  const ledger = {
    theory,
    model: cfg.model,
    host: hostOf(cfg.baseUrl),
    chars: passage.length,
  };

  const calls: { rec: UsageRecord; text: string }[] = [];
  const followUps: string[] = [];
  let parsed: any = null;
  let parseError = '';

  for (let attempt = 1; attempt <= 2; attempt++) {
    const startedAt = Date.now();
    let res: ChatResult;
    try {
      res = await chat(sys, user, {
        json: true,
        maxTokens: plan.maxTokens,
        temperature,
        followUps,
        signal: opts.signal,
      });
    } catch (err) {
      /*
       * 失败也记一条，但记 ok=false：钱大概率已经花了（尤其是超时和解析失败），
       * 只是拿不到准确的 usage。金额记 0 而不是估一个数——记账里最忌讳
       * 把猜的数字混进真账，用户对不上就会连整本账都不信。
       * 这一条的价值是让「失败率」可见：连续失败往往不是文本问题，是 Key 或余额问题。
       */
      recordChatUsage({
        ok: false,
        ...ledger,
        promptTokens: estimateTokens(sys + user),
        completionTokens: 0,
        estimated: true,
        ms: Date.now() - startedAt,
      });
      throw err;
    }

    /*
     * 记账要放在解析之前。chat 一返回，token 就已经花掉了；
     * 后面无论 JSON 解析失败还是归一化抛错，这笔钱都追不回来。
     * 放在函数末尾记，等于「只有分析成功才记账」——那是最容易亏钱的那种记法。
     * 修复重跑是第二次真实调用，所以流水里会有两条：钱确实花了两次。
     */
    const u = res.usage;
    const measured = typeof u?.prompt_tokens === 'number' || typeof u?.completion_tokens === 'number';
    /*
     * 缓存命中数两种形态都收：DeepSeek 给 prompt_cache_hit_tokens，
     * OpenAI 给 prompt_tokens_details.cached_tokens。都没有就留 undefined——
     * 记成 0 会把「这家不说」写成「一次没命中」，那正是这个字段当初要防的误读。
     */
    const cacheHit =
      typeof u?.prompt_cache_hit_tokens === 'number'
        ? u.prompt_cache_hit_tokens
        : typeof u?.prompt_tokens_details?.cached_tokens === 'number'
          ? u.prompt_tokens_details.cached_tokens
          : undefined;
    const rec = recordChatUsage({
      ok: true,
      ...ledger,
      promptTokens: typeof u?.prompt_tokens === 'number' ? u.prompt_tokens : estimateTokens(sys + user),
      completionTokens: typeof u?.completion_tokens === 'number' ? u.completion_tokens : estimateTokens(res.text),
      estimated: !measured,
      cacheHitTokens: cacheHit,
      ms: Date.now() - startedAt,
    });
    calls.push({ rec, text: res.text });

    try {
      parsed = extractJson(res.text);
      break;
    } catch (e) {
      parseError = (e as Error).message;
      if (attempt === 2) break;
      followUps.push(repairMessage(parseError));
      onProgress('verdict', '输出格式损坏，要求模型重出一次', 70);
    }
  }

  if (parsed === null) {
    throw new LlmError('BAD_JSON', parseError);
  }

  // 多次调用时，界面上显示的「本次用量」是各次之和——账本里也是这几笔，两边必须能对上
  const usage: UsageRecord =
    calls.length === 1
      ? calls[0].rec
      : (() => {
          const last = calls[calls.length - 1].rec;
          /*
           * 命中数跟着输入 token 一起求和，不能沿用最后一笔。
           *
           * 修复重跑时，第二笔常常整段前缀都命中（system 与原文没变），
           * 只取最后一笔会把「总输入里有多少是命中的」算高；反过来若第一次命中、第二次没有，
           * 又会算低。这个字段唯一的用途就是看命中率，口径错了它就没有意义。
           * 供应商没报的那些不参与求和——把「不说」当 0 会造出假的低命中。
           */
          const hits = calls.map((c) => c.rec.cacheHitTokens).filter((n): n is number => typeof n === 'number');
          return {
            ...last,
            promptTokens: calls.reduce((s, c) => s + c.rec.promptTokens, 0),
            completionTokens: calls.reduce((s, c) => s + c.rec.completionTokens, 0),
            cost: calls.reduce((s, c) => s + c.rec.cost, 0),
            cacheHitTokens: hits.length ? hits.reduce((s, n) => s + n, 0) : undefined,
            ms: calls.reduce((s, c) => s + c.rec.ms, 0),
            estimated: calls.some((c) => c.rec.estimated),
          };
        })();

  onProgress('verdict', meta.stageVerdict, 80);

  onProgress('self-check', '自检与回填原文位置', 92);
  /*
   * 记下这份报告是「谁」跑出来的。
   *
   * 只有这里知道答案：模型名与供应商来自当时的设置，温度是裁剪之后真正发出去的那个。
   * 存 host 而不是 baseUrl——报告会被导出，路径与 Key 都不该跟着走。
   * 模型名为空（用户清空了设置）时整条不写，由 normalizeEngine 兜住。
   */
  const engine = { model: cfg.model, host: hostOf(cfg.baseUrl), temperature };
  const diagnosis = normalizeDiagnosis(parsed, passage, theory, {
    mode,
    parentId: opts.parentId ?? null,
    prompt: { version: build.version, fingerprint: build.fingerprint },
    engine,
  });

  /*
   * 把模型原文一并存下。
   *
   * 放在 normalizeDiagnosis 之后，是因为这里才确定「哪一次的输出被采用了」——
   * 解析失败时会重出，前面那些原文不该覆盖掉真正生效的那一份。
   * 这段代码对报告内容没有任何影响，它是留给出事后核对用的：
   * 有了它，才可能在不调模型的前提下重跑整条解析与裁决链路。
   */
  diagnosis.raw = {
    text: calls[calls.length - 1].text,
    attempts: calls.length,
  };

  /*
   * 立案：贴上去，但**不改报告一个字**。
   *
   * 它放在解析与裁决之后，是个位置声明：这份报告的所有判定都已经做完了，
   * 这一段只是「评的是谁」的备注。它不参与提示词、不参与重放、不参与同题复跑，
   * 所以不会让两次分析的差异多出一处来（那正是同题复跑要量东西）。
   */
  const brief = normalizeBrief(opts.brief);
  if (brief) diagnosis.brief = brief;

  /*
   * 分歧账：与立案贴在同一处（解析与裁决之后），同一个理由——它不改判定、
   * 不进提示词、不参与重放与同题复跑。v1.1 要的是「分歧有固定位置」，
   * 不是让模型多写一段散文；这一段只是那份存档。
   */
  const divergence = normalizeDivergence(opts.divergence);
  if (divergence) diagnosis.divergence = divergence;

  /* 运行时的工程事实也要留痕：模型调用了几次、温度有没有被裁、提示词是否超预算 */
  if (calls.length > 1) {
    diagnosis.diagnostics.push({
      level: 'info',
      code: 'JSON_REPAIRED',
      message: `第一次输出无法解析为 JSON，已要求模型重出一次（共 ${calls.length} 次调用）。用量按 ${calls.length} 笔记录，可在「用量」页逐笔核对。`,
    });
  }
  if (clamped) {
    diagnosis.diagnostics.push({
      level: 'info',
      code: 'TEMPERATURE_CLAMPED',
      message: `本次温度按「${meta.label}」模式上限 ${temperature} 执行（设置为 ${userTemp}）。温度越高，同一段文本两次分析的差异越大，修订对照就失去参照。`,
    });
  }
  if (build.overBudget) {
    diagnosis.diagnostics.push({
      level: 'warn',
      code: 'PROMPT_OVER_BUDGET',
      message: `本次提示词 ${build.chars} 字符，超出预算上限。提示词越长，留给输出的空间越小，而输出被截断是整份分析作废。`,
    });
  }

  onProgress('done', '完成', 100);
  return { diagnosis, usage };
}
