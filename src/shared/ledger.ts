/**
 * 命题账（两本账隔离）：三栏状态值，以及「这份账记得全不全」的本地核对。
 *
 * 来源：知识库「逻辑学」→ 论证分析流程 → 04_裁决层 → D-02《命题账：两本账隔离》v2.1，
 * 栏位名称与允许值同时对齐 01_立案层 → A-03《路由：事实规范混合三分》。
 *
 * 搬进来的只有能搬的部分：
 *
 *   - 三栏（事实·可裁／事实·不可裁／规范·不可裁）与各自的封闭状态值；
 *   - 每行六项字段（栏位、原文位置、状态值、依据或缺失材料、复核触发条件、条件式结论）；
 *   - 「不判」七项登记（对象、栏位、状态、理由类型、举证责任、定案条件、复核人）；
 *   - 条件式结论三要素（价值前提内容、事实前提状态、证成结果）；
 *   - 双向禁令：谬误谬误与反向谬误谬误，各查有无，也查隐性版本。
 *
 * **本地不改任何状态值。** 与判档、修辞审计同一条产品边界（docs/产品定位.md）：
 * 「事实是否已证真」「这条规范证成强不强」由模型按 D-02 写出，本地只核
 * 「这行记得齐不齐、有没有越界（规范栏写真假、账里出现 D0–D5）」。
 * 本地唯一自己算的是**归栏**——而且只按用词算（见 propositions.ts），
 * 算出来与账上不一致时登记成一条分歧，不静默取一。
 *
 * 为什么这么较真：D-02 第九节把「不判也是判决」写成硬边界——宣布「这里不判」
 * 等于选了栏、给了状态、指定了责任与回栏条件，那就必须可复核。
 * 账外的一句「此处不判」，与一句「我觉得不太好」没有区别。
 */

import { MODE_META, type Claim, type Diagnosis } from './types';
import { propositionsOf } from './propositions';
import { versionAtLeast } from './version';

/** 三栏。不是三个分数段，也不能相互转账。 */
export type LedgerColumn = 'fact-decidable' | 'fact-undecidable' | 'norm-undecidable';

export const LEDGER_COLUMNS: readonly LedgerColumn[] = [
  'fact-decidable',
  'fact-undecidable',
  'norm-undecidable',
] as const;

/** A-03 与 D-02 用同一套栏位名，一个字都不改（A-03 五节：两册不得各造一套栏位名称）。 */
export const COLUMN_LABEL: Record<LedgerColumn, string> = {
  'fact-decidable': '事实·可裁',
  'fact-undecidable': '事实·不可裁',
  'norm-undecidable': '规范·不可裁',
};

/** 每一栏允许的状态值。**封闭**：越栏写就是串账，不是措辞问题。 */
export type FactStatus = 'true' | 'false' | 'open';
export type UndecidableStatus = 'undecidable';
export type NormStatus = 'strong' | 'weak' | 'unjustified';
export type LedgerStatus = FactStatus | UndecidableStatus | NormStatus;

export const STATUS_LABEL: Record<LedgerStatus, string> = {
  true: '已证真',
  false: '已证伪',
  open: '未决',
  undecidable: '不可裁（材料不足）',
  strong: '证成强',
  weak: '证成弱',
  unjustified: '未证成',
};

export const COLUMN_STATUSES: Record<LedgerColumn, readonly LedgerStatus[]> = {
  'fact-decidable': ['true', 'false', 'open'],
  'fact-undecidable': ['undecidable'],
  'norm-undecidable': ['strong', 'weak', 'unjustified'],
};

/**
 * 「没判」的三个状态。它们都算判决，都得按 D-02 4.5 写七项。
 *
 * 为什么「未决」也算没判：它选定了可裁栏、说明了现在判不了、指定了定案条件。
 * 三件事都做了，就不是「账外的沉默」。
 */
export const NOT_JUDGED: readonly LedgerStatus[] = ['open', 'undecidable', 'unjustified'];

/** 不判的第④项：理由类型。D-02 4.5 给了三类，不许写「其他」。 */
export type NoJudgeReason = 'material' | 'value-premise' | 'protocol';

export const REASON_LABEL: Record<NoJudgeReason, string> = {
  material: '材料不足',
  'value-premise': '价值前提未明示',
  protocol: '当前对话协议不允许裁定',
};

/** 规范栏必填的事实前提状态。三值，不写「有依据」这种模糊说法。 */
export type FactState = 'verified' | 'checkable' | 'unavailable';

export const FACT_STATE_LABEL: Record<FactState, string> = {
  verified: '已核验',
  checkable: '可核验未核',
  unavailable: '不可得',
};

/** 不判的七项里，除对象／栏位／状态之外的另外四项。 */
export interface NoJudge {
  /** ④ 理由类型 */
  reason: NoJudgeReason;
  /** ⑤ 举证责任归属：没定就写 unclear，别写成「双方」 */
  burden: Claim['burden'];
  /** ⑦ 复核人 */
  reviewer: string;
}

export interface LedgerRow {
  /** ① 对象：报告里真实存在的 P 编号（结论用 C） */
  at: string;
  /** ② 栏位 */
  column: LedgerColumn;
  /** ③ 状态值 */
  status: LedgerStatus;
  /** ④ 依据位置，或（不可裁时）缺什么材料 */
  basis: string;
  /** ⑥ 复核触发条件／定案条件：什么材料到了就回栏重判 */
  reentry: string;
  /** 规范栏：价值前提 A_v 的内容（标「补出」），不写「通常价值下」 */
  av: string;
  /** 规范栏：事实前提状态 */
  factState: FactState | null;
  /** 规范栏：条件式结论原文 */
  conditional: string;
  /** 没判时必须有；判了就必须是 null */
  noJudge: NoJudge | null;
}

/** 谬误谬误筛查的一行。两个方向各一行，缺一行就是没筛。 */
export interface FallacyScreen {
  direction: 'forward' | 'reverse';
  found: boolean;
  /** found 时说清在哪一句；没发现也要写查过的范围 */
  at: string;
  /** 处置：改法是什么；没发现时说明隐性版本怎么查的 */
  note: string;
}

export interface Ledger {
  rows: LedgerRow[];
  fallacies: FallacyScreen[];
}

/** 账行在 schema 里承诺的字段。导出给 prompt-lint：清单跟着读它的代码走，不另抄一份。 */
export const LEDGER_FIELDS: readonly string[] = [
  'ledger',
  'rows',
  'fallacies',
  'at',
  'column',
  'status',
  'basis',
  'reentry',
  'av',
  'factState',
  'conditional',
  'noJudge',
  'reason',
  'reviewer',
  'direction',
  'found',
];

export interface LedgerGap {
  kind: string;
  severity: 'block' | 'warn';
  text: string;
}

/**
 * 这一版提示词有没有命题账。版本比较与判档、审计共用一份（version.ts）。
 * 解析不出版本号时按「没有」处理：旧档确实没有，新档会带。
 */
export const LEDGER_PROMPT_VERSION = '2.10.0';

export function promptHasLedger(version?: string): boolean {
  return versionAtLeast(version, LEDGER_PROMPT_VERSION);
}

/** 两本账的隔离声明。界面与文档共用一句，免得两处说得不一样。 */
export const LEDGER_ISOLATION =
  '档位不改真假，真假不改档位；置信度只降自己那一格；情绪与权威只进修辞审计。' +
  '允许的动作只有一个：判决理由里写「该 P 位于命题账第 X 行」，不许接一句「故该 P 为真」。';

/** 账页的硬边界：一串「这里不该判」不算记录，七项齐了才算。 */
export const LEDGER_BOUNDARY =
  '不判也是判决：选了栏、给了状态、指定了责任与回栏条件，就要能被人拿材料推翻。' +
  '只写「此处不判」而不写缺什么、谁举证、什么时候回栏的，判为漏记，不是中立。';

const MESSAGE: Record<string, string> = {
  'no-ledger': '这份报告没有命题账。结论、前提各归哪一栏、状态值是什么，一处也没记——读者只能自己去猜哪条该由证据定。',
  'empty-ledger': '账是空的：有命题却没有一行归栏记录。',
  'ledger-on-nongrading-mode': '本模式不走到裁决层，命题账不该有；已有记录会被置空。',
  'missing-row': '有命题没上账：账页不齐，第二位分析者无法只凭账页重填。',
  'orphan-row': '账上有一行指向报告里不存在的编号。',
  'duplicate-row': '同一条命题在账上出现了两次。',
  'two-columns': '同一条命题同时落在两栏。三栏物理隔离，一条只能有一栏；宽读严读不同栏时按双读各占一行并注明不合并，不许取其一。',
  'status-not-in-column': '状态值不在该栏的允许值里——这是串账。规范栏写「已证真」、事实栏写「证成强」都算。',
  'no-basis': '没写依据位置，也没写缺什么材料。没有依据的状态值就是一句断言。',
  'av-missing': '规范栏没写价值前提。价值前提藏在括注里（「在通常价值下」）等于没写：读者无法知道这条结论靠哪条桥站着。',
  'fact-state-missing': '规范栏没写事实前提状态（已核验／可核验未核／不可得）。条件式结论少这一项，条件就说不清。',
  'conditional-missing': '规范栏没写条件式结论。规范命题只能输出「若接受 V 且 F 处于某状态，则 C 得到／未得到证成」，不能写成无条件的「因此应当」。',
  'conditional-not-conditional': '条件式结论里没有「若／如果」这类条件词——它读起来仍是一句无条件判决。',
  'truth-in-norm-column': '规范栏里出现了真假判决。规范命题不以真假为合适性条件，只能写证成强／弱／未证成。',
  'reentry-missing': '没写定案条件。写不出定案条件的「不可裁／未决」，是把举证义务丢给对方而不留记录。',
  'no-judge-record': '这条没判，却没有不判七项。宣布「这里不该判」本身就是判决，必须写清理由、责任与回栏条件。',
  'no-judge-on-judged': '这条已经给出状态值，却仍挂着「不判」七项——要么状态写错，要么记录是照着模板抄的。',
  'reason-missing': '不判记录缺理由类型（材料不足／价值前提未明示／协议不允许裁定）。',
  'burden-unclear': '不判记录里举证责任是「未分配」。那就是这一步没人做——照实写出来，别用「双方」盖过去。',
  'reviewer-missing': '不判记录没写复核人。',
  'grade-in-ledger': '账页上出现了 D0–D5。档位属于论证质量账，写进命题账就是串账（D-02 4.8 明写：命题账内出现档位即视为串账）。',
  'confidence-in-ledger': '账页上出现了置信度。取材不详只降评估置信度，不改命题状态——除非缺的那份材料正是该断言的核验对象。',
  'rhetoric-in-ledger': '事实栏的状态理由是修辞评语。情绪、权威叙事只在修辞审计里登记，不改事实栏状态值。',
  'fallacy-screen-missing': '谬误谬误筛查没做全。正向（推理差→结论假）与反向（结论真→推理没问题）各要一行，缺一个方向就等于只禁一边。',
  'fallacy-note-missing': '筛查行没写处置。发现了要说改成什么，没发现要说隐性版本怎么查的。',
  'fallacy-implicit-unchecked': '反向筛查没提隐性版本。「事实就是如此，论证自然成立」与「结论为真所以推理没问题」是同一条禁令。',
  'column-disagreement': '本地按用词归的栏与账上写的不是同一栏。要么用词与语义不符，要么有一方读错了；登记分歧，不静默取一。',
};

function gap(kind: string, severity: 'block' | 'warn', extra = ''): LedgerGap {
  return { kind, severity, text: `${MESSAGE[kind] ?? kind}${extra}` };
}

const SOFT_REVIEWER = /^(未指定|未填|无|none|null|待定|不详|-{1,2})$/i;

function claimsOf(d: Diagnosis): Claim[] {
  return [d.conclusion, ...(d.premises ?? []), ...(d.intermediate ?? [])].filter(
    (c): c is Claim => !!c && typeof c.id === 'string',
  );
}

/** 这一份报告该不该有命题账。与判档同一口径：走得到裁决层、透镜适用。 */
export function ledgerExpected(d: Diagnosis): boolean {
  return MODE_META[d.mode].givesVerdict && d.theory !== 'copi' && d.scope.applicable;
}

/** 本地读出来的那一栏（只按用词，见 propositions.ts）。找不到该命题时返回 null。 */
function localColumn(d: Diagnosis, at: string): LedgerColumn | null {
  const row = propositionsOf(d).rows.find((r) => r.id === at);
  return row ? row.decidability : null;
}

/**
 * 核一份命题账。
 *
 * 只核「记录齐不齐、有没有越界、与报告对不对得上」，不核「这条到底该判什么」。
 * 每一处缺口都点名到行，因为一份「本页有 3 处不合规」的提示，用户改不动。
 */
export function auditLedger(d: Diagnosis): LedgerGap[] {
  const l = d.ledger;
  const gaps: LedgerGap[] = [];
  const claims = claimsOf(d);

  if (!l) {
    if (!ledgerExpected(d) || !claims.length) return gaps;
    return [gap('no-ledger', 'warn')];
  }
  if (!ledgerExpected(d)) return [gap('ledger-on-nongrading-mode', 'block')];
  if (!l.rows.length) return claims.length ? [gap('empty-ledger', 'block')] : [];

  const known = new Set(claims.map((c) => c.id));
  const byAt = new Map<string, LedgerRow[]>();
  for (const r of l.rows) {
    if (!byAt.has(r.at)) byAt.set(r.at, []);
    byAt.get(r.at)!.push(r);
  }

  /* 账页与报告对得上：逐条命题都要有一行，账上也不许有点不出来的编号。 */
  const missing = [...known].filter((id) => !byAt.has(id));
  if (missing.length) gaps.push(gap('missing-row', 'block', `（${missing.join('、')}）`));
  const orphan = [...byAt.keys()].filter((id) => !known.has(id));
  if (orphan.length) gaps.push(gap('orphan-row', 'warn', `（${orphan.join('、')}）`));

  for (const [at, rows] of byAt) {
    if (rows.length > 1) {
      const cols = new Set(rows.map((r) => r.column));
      gaps.push(cols.size > 1 ? gap('two-columns', 'block', `（${at}）`) : gap('duplicate-row', 'warn', `（${at}）`));
    }
  }

  for (const r of l.rows) {
    const at = r.at || '（未标位置）';
    if (!COLUMN_STATUSES[r.column].includes(r.status)) {
      gaps.push(
        gap(
          'status-not-in-column',
          'block',
          `（${at}：${COLUMN_LABEL[r.column]}栏写了「${STATUS_LABEL[r.status] ?? r.status}」）`,
        ),
      );
    }

    const basis = r.basis.trim();
    if (basis.length < 6) gaps.push(gap('no-basis', 'block', `（${at}）`));

    const prose = `${basis} ${r.reentry} ${r.av} ${r.conditional}`;
    if (/\bD[0-5]\b/.test(prose)) gaps.push(gap('grade-in-ledger', 'block', `（${at}）`));
    if (/置信度?/.test(prose)) gaps.push(gap('confidence-in-ledger', 'warn', `（${at}）`));
    if (r.column !== 'norm-undecidable' && /情绪|语气|煽情|修辞|煽动|权威叙事/.test(basis)) {
      gaps.push(gap('rhetoric-in-ledger', 'warn', `（${at}）`));
    }

    if (r.column === 'norm-undecidable') {
      if (r.av.trim().length < 4 || /通常价值|一般价值|公认价值/.test(r.av)) {
        gaps.push(gap('av-missing', 'block', `（${at}）`));
      }
      if (!r.factState) gaps.push(gap('fact-state-missing', 'block', `（${at}）`));
      if (r.conditional.trim().length < 6) {
        gaps.push(gap('conditional-missing', 'block', `（${at}）`));
      } else if (!/若|如果|倘若|假如/.test(r.conditional)) {
        gaps.push(gap('conditional-not-conditional', 'warn', `（${at}）`));
      }
      if (/为真|为假|是真的|是假的|该规范是假/.test(prose)) {
        gaps.push(gap('truth-in-norm-column', 'block', `（${at}）`));
      }
    }

    if (r.column === 'fact-undecidable' && !r.reentry.trim()) {
      gaps.push(gap('reentry-missing', 'block', `（${at}）`));
    }

    if (NOT_JUDGED.includes(r.status)) {
      if (!r.noJudge) gaps.push(gap('no-judge-record', 'block', `（${at}）`));
      else {
        if (!REASON_LABEL[r.noJudge.reason]) gaps.push(gap('reason-missing', 'block', `（${at}）`));
        if (r.noJudge.burden === 'unclear') gaps.push(gap('burden-unclear', 'warn', `（${at}）`));
        if (!r.noJudge.reviewer.trim() || SOFT_REVIEWER.test(r.noJudge.reviewer.trim())) {
          gaps.push(gap('reviewer-missing', 'warn', `（${at}）`));
        }
      }
      if (r.column !== 'fact-undecidable' && !r.reentry.trim()) {
        gaps.push(gap('reentry-missing', 'block', `（${at}）`));
      }
    } else if (r.noJudge) {
      /* 判了却挂着「不判」七项：要么状态写错，要么记录是模板抄来的。 */
      gaps.push(gap('no-judge-on-judged', 'warn', `（${at}）`));
    }

    const local = localColumn(d, r.at);
    if (local && local !== r.column) {
      gaps.push(
        gap('column-disagreement', 'warn', `（${at}：本地按用词归「${COLUMN_LABEL[local]}」，账上归「${COLUMN_LABEL[r.column]}」）`),
      );
    }
  }

  /* 双向筛查：两个方向各一行。缺一个方向，就是只禁一边。 */
  const dirs = new Set(l.fallacies.map((f) => f.direction));
  if (!dirs.has('forward') || !dirs.has('reverse')) {
    gaps.push(gap('fallacy-screen-missing', 'block', `（已查：${[...dirs].join('、') || '无'}）`));
  }
  for (const f of l.fallacies) {
    const note = f.note.trim();
    if (note.length < 6) gaps.push(gap('fallacy-note-missing', 'warn', `（${f.direction}）`));
    if (f.direction === 'reverse' && !f.found && !/隐性|站不住|事实就是|改写/.test(note)) {
      gaps.push(gap('fallacy-implicit-unchecked', 'warn'));
    }
  }

  return gaps;
}

/** 是否算「账记完」：没有 block 级缺口。 */
export function ledgerComplete(d: Diagnosis): boolean {
  return auditLedger(d).every((g) => g.severity !== 'block');
}

/** 界面用的一句话记录：分布 + 谬误筛查。 */
export function ledgerLine(l: Ledger): string {
  const by = (c: LedgerColumn) => l.rows.filter((r) => r.column === c).length;
  const notJudged = l.rows.filter((r) => NOT_JUDGED.includes(r.status)).length;
  const found = l.fallacies.filter((f) => f.found).length;
  const parts = [
    `共 ${l.rows.length} 条`,
    `可裁 ${by('fact-decidable')}`,
    `不可裁 ${by('fact-undecidable')}`,
    `规范 ${by('norm-undecidable')}`,
    `其中不判 ${notJudged}`,
  ];
  parts.push(found ? `谬误谬误 ${found} 处` : '两个方向的谬误谬误筛查均未发现');
  return parts.join('｜');
}

/** 账页上的那一行：给界面与 Markdown 共用，免得两处写法不一致。 */
export function rowLine(r: LedgerRow): string {
  const bits = [`${r.at} → ${COLUMN_LABEL[r.column]}｜${STATUS_LABEL[r.status]}`];
  if (r.column === 'norm-undecidable') {
    bits.push(`A_v：${r.av}`);
    if (r.factState) bits.push(`事实前提${FACT_STATE_LABEL[r.factState]}`);
    bits.push(`条件式：${r.conditional}`);
  } else {
    bits.push(r.basis);
  }
  if (r.noJudge) {
    bits.push(`不判：${REASON_LABEL[r.noJudge.reason]}｜举证${r.noJudge.burden}｜复核${r.noJudge.reviewer}`);
  }
  if (r.reentry) bits.push(`回栏：${r.reentry}`);
  return bits.join('｜');
}
