/**
 * 判档：D0–D5 六档，以及「这份判档记录齐不齐」的本地核对。
 *
 * 来源：知识库「逻辑学」→ 论证分析流程 → 04_裁决层 → D-01《分档：D0 至 D5 的判据边界》v2.1。
 * 这不是自创刻度，是把那册的判据搬进本工具的输出契约里。搬的时候只搬了能搬的部分：
 *
 *   - 六档的名字与触发条款编号（4.3–4.6）照抄；
 *   - 判档顺序 D5→D4→D3→D2→D1→D0 照抄（提示词里要求逐档写出触发条款）；
 *   - D5 三道闸门（后果／协同／协议）照抄，协同必须带反事实移除测试的记录；
 *   - 判档记录七项里，本工具落五项：档位、触发条款、缺陷位置、必要证据、共享处置、
 *     降级条件——评估置信度另立字段（三分离），D5 三闸门另立子结构。
 *
 * **本地不改档位。** 这一层只做两件事：
 *   1. 把体系的中文名与触发条款翻出来给界面用；
 *   2. 核这份记录齐不齐、有没有与记录自身矛盾（D0 却有 violated 的检查项、
 *      D5 却没有三闸门记录、缺陷位置指向不存在的 P5）。
 * 档位是模型按 D-01 判的；软件只保证它「挂了三样」，不替它判。
 * 这是 2026-11-12 定下的产品定位（docs/产品定位.md），不因为引进了体系就改。
 *
 * 为什么值得这么较真：D-01 第九节把「档位必须挂原文位置、未过的 CQ、降级条件，
 * 缺一不算判决，只算感觉」写成硬边界。一份只有「D3」两个字的报告，读者无法复核，
 * 与一句「我觉得不太行」没有区别——本工具的价值全在可复核上。
 */

import { MODE_META } from './types';
import { versionAtLeast } from './version';
import type { CheckItem, ConfidenceLevel, Diagnosis, Grade, GradeD5, GradeRecord, VerdictLevel } from './types';

export type { Grade, GradeD5, GradeRecord };

/** 六档。互斥等级，不是六类文体。 */
export const GRADES: readonly Grade[] = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5'];

/** D-01 二节的中文名，一字不改。 */
export const GRADE_LABEL: Record<Grade, string> = {
  D0: '无缺陷',
  D1: '可加固',
  D2: '支持不足',
  D3: '型式误用',
  D4: '结构性失效',
  D5: '操纵',
};

/**
 * 触发条款编号。指向 D-01 第四节的对应小节，读者可据此复核。
 * D0 与 D1 同在 4.3（那一节先写 D0 再写 D1），D2 与 D3 同在 4.4。
 */
export const GRADE_CLAUSE: Record<Grade, string> = {
  D0: '4.3',
  D1: '4.3',
  D2: '4.4',
  D3: '4.4',
  D4: '4.5',
  D5: '4.6',
};

/**
 * 六档落到本工具原来的四档刻度上。
 *
 * 为什么要这张表：界面、存档、回看台、端到端都还在用四档做分桶（颜色、筛选、图例）。
 * 一次全换会把颜色和筛选一起改坏，而它们与「六档」并不冲突——
 * 四档是粗桶，六档是体系档位。**六档是主，四档是它的投影**：
 * 这份投影写在一处，界面不再各算一遍。
 *
 * 投影不是又一种判定：D0/D1 都是「站得住」，D2/D3 都是「削弱」，
 * D4/D5 都是「不成」。分桶会丢掉档内信息，所以界面必须同时显示 D 档本身。
 */
export const GRADE_BUCKET: Record<Grade, VerdictLevel> = {
  D0: 'withstands',
  D1: 'withstands',
  D2: 'weakened',
  D3: 'weakened',
  D4: 'fails',
  D5: 'fails',
};

/* ─────────── 核对 ─────────── */

export type GradeGapKind =
  | 'no-grade'
  | 'clause-missing'
  | 'clause-mismatch'
  | 'at-missing'
  | 'at-unknown'
  | 'at-duplicate'
  | 'evidence-missing'
  | 'fix-missing'
  | 'downgrade-missing'
  | 'd5-gates-missing'
  | 'd5-without-synergy-record'
  | 'grade-on-nongrading-mode'
  | 'level-mismatch'
  | 'shallow-grade-with-violation'
  | 'confidence-missing';

export interface GradeGap {
  kind: GradeGapKind;
  /** block＝按 D-01「缺一不算判决」，这一份还不能当判决读；warn＝能读，但记录有毛病。 */
  severity: 'block' | 'warn';
  text: string;
}

/** 一句人话，说明每个缺口在体系里对应哪条要求。 */
const GAP_TEXT: Record<GradeGapKind, string> = {
  'no-grade':
    '没有 D 档记录。这份报告无法与体系对表——它给的档位是本工具的四档，不是 D0–D5。',
  'clause-missing': '没写触发条款编号。判档要能让人跳到判据复核（D-01 4.2）。',
  'clause-mismatch': '触发条款与档位对不上。',
  'at-missing': 'D2 及以上必须写出缺陷位置（P／A／CQ 编号），否则读者无法回原文复核（D-01 4.4–4.6）。',
  'at-unknown': '缺陷位置指向了报告里不存在的编号。',
  'at-duplicate': '同一处缺陷被记了两次。同一缺陷只计一次，不按名称去重（D-01 二节）。',
  'evidence-missing': '没写必要证据。',
  'fix-missing': '没写共享处置或可执行加固动作。',
  'downgrade-missing': '没写降级条件。D-01 4.8：写不出，视为本判尚未完成。',
  'd5-gates-missing': '判了 D5，却没有记全三道闸门（后果／协同／协议）。缺一不得算 D5（D-01 4.6）。',
  'd5-without-synergy-record': '协同闸门没有反事实移除测试的记录——「各自单独不足、合起来充分」必须逐项验证，否则不叫协同。',
  'grade-on-nongrading-mode': '这个模式不给档位，却出现了 D 档。已按模式定义置空。',
  'level-mismatch': '四档投影与 D 档不一致，已按 D 档重算（四档只是六档的粗桶）。',
  'shallow-grade-with-violation':
    '判了 D0／D1，但报告里有检查项被标为 violated。这两档的触发条件都要求适用 CQ 全过——记录与自身矛盾。',
  'confidence-missing': '没有评估置信度。三分离要求它与档位并列记录，不得折算（D-01 二节）。',
};

function gap(kind: GradeGapKind, severity: 'block' | 'warn', extra?: string): GradeGap {
  return { kind, severity, text: extra ? `${GAP_TEXT[kind]}${extra}` : GAP_TEXT[kind] };
}

/** 报告里真实存在的编号：前提、中间结论、检查项。 */
function knownIds(d: Diagnosis): Set<string> {
  const ids = new Set<string>();
  ids.add(d.conclusion.id || 'C');
  for (const p of d.premises) ids.add(p.id);
  for (const m of d.intermediate) ids.add(m.id);
  for (const c of d.checks) ids.add(c.id);
  return ids;
}

/**
 * 核一份判档记录。
 *
 * 只核「记录与记录自身、记录与报告其余部分」是否一致，不核「档位判得对不对」。
 * 后者要真模型评测，不是本地能给的。
 */
export function auditGrade(d: Diagnosis): GradeGap[] {
  const g = d.verdict.grade;
  const gaps: GradeGap[] = [];

  if (!g) {
    // 不给档位的模式本来就不该有 D 档，这里不报缺口——那是正常状态，不是漏填。
    if (!gradeExpected(d)) return gaps;
    return [gap('no-grade', 'warn')];
  }

  if (!gradeExpected(d)) {
    return [gap('grade-on-nongrading-mode', 'block')];
  }

  if (!g.clause.trim()) gaps.push(gap('clause-missing', 'warn'));
  else if (g.clause.trim() !== GRADE_CLAUSE[g.level]) {
    gaps.push(
      gap(
        'clause-mismatch',
        'warn',
        `（记录写 ${g.clause}，${g.level} 的判据在 ${GRADE_CLAUSE[g.level]}）`,
      ),
    );
  }

  if (g.level !== 'D0' && g.level !== 'D1') {
    if (g.at.length === 0) gaps.push(gap('at-missing', 'block'));
  }

  if (g.at.length > 0) {
    const known = knownIds(d);
    const unknown = g.at.filter((x) => !known.has(x.replace(/[（(].*$/, '').trim()));
    if (unknown.length) {
      gaps.push(gap('at-unknown', 'warn', `（${unknown.join('、')}）`));
    }
    const dup = g.at.filter((x, i) => g.at.indexOf(x) !== i);
    if (dup.length) gaps.push(gap('at-duplicate', 'warn', `（${[...new Set(dup)].join('、')}）`));
  }

  if (!g.evidence.trim()) gaps.push(gap('evidence-missing', 'warn'));
  if (!g.fix.trim()) gaps.push(gap('fix-missing', 'warn'));
  if (!g.downgrade.trim()) gaps.push(gap('downgrade-missing', 'block'));

  if (g.level === 'D5') {
    const gates = g.d5;
    const full = gates && gates.consequence.trim() && gates.synergy.trim() && gates.protocol.trim();
    if (!full) gaps.push(gap('d5-gates-missing', 'block'));
    else if (gates.removed.filter((x) => x.trim()).length < 2) {
      gaps.push(gap('d5-without-synergy-record', 'block'));
    }
  }

  // D0／D1 的触发条件都要求「三问与适用 CQ 全过」。报告里却有 violated 的检查项——
  // 这不是本地在判档，是同一份记录里两句话对不上。
  if ((g.level === 'D0' || g.level === 'D1') && d.checks.some((c) => c.answer === 'violated')) {
    gaps.push(gap('shallow-grade-with-violation', 'warn'));
  }

  if (!d.confidence) gaps.push(gap('confidence-missing', 'warn'));

  return gaps;
}

/**
 * 「本该有 D 档」的条件。与 analyze.ts 里四档的强制逻辑同一组闸门：
 * 模式不给档位、透镜不适用（含名录透镜）——这些情形都不该有 D 档。
 *
 * 用 MODE_META 而不是另列一张模式表：列两遍就会在加第六个模式时只改一处。
 */
export function gradeExpected(d: Diagnosis): boolean {
  return MODE_META[d.mode].givesVerdict && d.theory !== 'copi' && d.scope.applicable;
}

/** 是否算「判决完成」：没有 block 级缺口。 */
export function gradeComplete(d: Diagnosis): boolean {
  return auditGrade(d).every((x) => x.severity !== 'block');
}

/** 界面用的一句话记录，例如「D2 支持不足（触发 4.4）｜缺陷 P2｜降级：若补出分母 → D0」。 */
export function gradeLine(g: GradeRecord): string {
  const parts = [`${g.level} ${GRADE_LABEL[g.level]}（触发 ${GRADE_CLAUSE[g.level]}）`];
  if (g.at.length) parts.push(`缺陷 ${g.at.join('、')}`);
  if (g.fix.trim()) parts.push(`处置：${g.fix.trim()}`);
  if (g.downgrade.trim()) parts.push(`降级：${g.downgrade.trim()}`);
  return parts.join('｜');
}

/** 从哪一版提示词起有 D 档。界面据它区分「旧档没这一层」与「模型这次没给」。 */
export const GRADE_PROMPT_VERSION = '2.8.0';

/**
 * 这一版提示词有没有 D 档层。
 *
 * 与修辞审计共用 `versionAtLeast`（shared/version）。原先这里是就地写的一段比较，
 * 修辞审计又抄一遍——两份比较迟早有一份写成等号，于是 2.10.0 的报告被当成旧档。
 */
export function promptHasGrade(version?: string): boolean {
  return versionAtLeast(version, GRADE_PROMPT_VERSION);
}

/** 四档粗桶。没有 D 档时返回 null，界面据此显示「没有 D 档记录」。 */
export function bucketOf(d: Diagnosis): VerdictLevel | null {
  const g = d.verdict.grade;
  return g ? GRADE_BUCKET[g.level] : null;
}

/** 评估置信度的中文名。与档位并列，不折算。 */
export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  high: '高',
  medium: '中',
  low: '低',
  'very-low': '很低',
  undetermined: '判不出',
};

/**
 * 判档的边界句。放在记录旁边，防止最容易被读错的两件事：
 * 档位只评论证质量，不蕴含结论真假；D5 是门槛，不是「D4 再加一点」。
 */
export const GRADE_BOUNDARY =
  '档位只评论证质量，不蕴含结论真假——由低档推出结论为假，是谬误谬误；' +
  'D5 是门槛，不是 D4 再加一点：要同时有后果、协同、协议三道闸门的记录。';

/** 给检查脚本用：不受 Report 影响的纯文本表。 */
export function checkSummary(items: CheckItem[]): string {
  const violated = items.filter((c) => c.answer === 'violated').length;
  const unanswered = items.filter((c) => c.answer === 'unanswered').length;
  return `检查项 ${items.length} 条：violated ${violated}，unanswered ${unanswered}`;
}
