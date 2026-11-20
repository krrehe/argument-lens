/**
 * 修辞审计（D-03）：查替代，不查有无。
 *
 * 来源：知识库「逻辑学」→ 论证分析流程 → 04_裁决层 → D-03《修辞审计：替代而非有无》v2.1。
 *
 * 这一册最容易被读反的一句话是标题：**审计对象不是「有没有情绪／权威／故事」**，
 * 而是「在推出结论的那条链上，原本该由理由承担的工作，是不是被它们替掉了」。
 * 悼念文字有情绪、专业说明引权威、政策解释举例子——「有」本身什么都不说明。
 * 所以本地这一层只做三件事：
 *
 *   1. 把 D-03 的封闭词表摆出来（三诉求三值、框架四功能、程度三级、后果三类……），
 *      界面与提示词共用一处，免得两边各说一套；
 *   2. 核这张审计表**做完了没有**：替代成立的行有没有替代链、链上四项缺不缺、
 *      说「移交 D5」的够不够两条手法、有没有把文风评语写进 note；
 *   3. 把「同一缺陷只计一次」的账记下来（与 C-01 结论强度超载重复的处数）。
 *
 * **本地不判「替代是否成立」。** 删去测试要重新走 B-01 至 B-04 的重构，
 * 那是模型的判断，不是本地能复算的。本地只保证：说成立的那一处，必须挂得出
 * 一条四项齐全的替代链；说不出，就不算审计做完了。
 *
 * 也不改档位、不改命题真假：一段话煽情，不等于它说的事实为假（谬误谬误）；
 * 反过来，结论后来被证实，也不等于它的修辞没有替代理由。
 */

import { MODE_META } from './types';
import { versionAtLeast } from './version';
import { mapSentences } from './fallacy-map';
import type {
  CorrectionChannel,
  DegreeLevel,
  Diagnosis,
  FrameHit,
  HarmKind,
  ReplacedReason,
  RhetoricAudit,
  RhetoricFunction,
  RhetoricRow,
  SubstituteChain,
  SubstituteKind,
  SubstituteVerdict,
  VerifiableLevel,
} from './types';

export type {
  CorrectionChannel,
  DegreeLevel,
  FrameHit,
  HarmKind,
  ReplacedReason,
  RhetoricAudit,
  RhetoricFunction,
  RhetoricRow,
  SubstituteChain,
  SubstituteKind,
  SubstituteVerdict,
  VerifiableLevel,
};

/** 审计表八列，顺序即 D-03 4.8 的顺序。界面表头与检查脚本共用。 */
export const RHETORIC_COLUMNS = [
  '句位',
  '三诉求功能',
  '框架四功能',
  '程度',
  '传播条件',
  '替代测试',
  '后果',
  '移交／计次',
] as const;

/** 三诉求按功能位置记「主／辅／无」。不换算分数，不设最优配比。 */
export const FUNC_LABEL: Record<RhetoricFunction, string> = {
  primary: '主',
  secondary: '辅',
  none: '无',
};

export const FRAME_LABEL: Record<FrameHit, string> = {
  problem: '问题界定',
  cause: '归因',
  moral: '道德评价',
  remedy: '对策建议',
};

export const DEGREE_LABEL: Record<DegreeLevel, string> = {
  match: '相符',
  mild: '轻度放大',
  heavy: '重度放大',
};

export const VERIFIABLE_LABEL: Record<VerifiableLevel, string> = {
  yes: '可核',
  partial: '部分可核',
  no: '无可核材料',
};

export const CORRECTION_LABEL: Record<CorrectionChannel, string> = {
  kept: '留了追问入口',
  closed: '入口被关闭',
  unclear: '说不清',
};

export const SUBSTITUTE_LABEL: Record<SubstituteVerdict, string> = {
  substitute: '替代成立',
  accompany: '伴随',
  untested: '没跑测试',
};

export const HARM_LABEL: Record<HarmKind, string> = {
  'fabricated-support': '伪造支持',
  'concealed-counter': '隐瞒反证',
  'closed-inquiry': '剥夺追问',
};

export const REPLACED_LABEL: Record<ReplacedReason, string> = {
  evidence: '证据',
  bridge: '推论桥',
  exception: '例外说明',
};

export const KIND_LABEL: Record<SubstituteKind, string> = {
  ethos: '品格',
  pathos: '情绪',
  story: '故事',
  frame: '框架',
  degree: '程度',
  relay: '转发链',
};

/** 从哪一版提示词起有修辞审计。界面据它区分「旧档没这一层」与「模型这次没做」。 */
export const RHETORIC_PROMPT_VERSION = '2.9.0';

/**
 * 封闭词表。归一化与检查共用这一处：各写一遍，改一处就会有一边悄悄放行。
 * 词表之外的取值一律退回缺省值并留痕，不猜一个近似的。
 */
export const FUNC_VALUES: readonly RhetoricFunction[] = ['primary', 'secondary', 'none'];
export const FRAME_VALUES: readonly FrameHit[] = ['problem', 'cause', 'moral', 'remedy'];
export const DEGREE_VALUES: readonly DegreeLevel[] = ['match', 'mild', 'heavy'];
export const VERIFIABLE_VALUES: readonly VerifiableLevel[] = ['yes', 'partial', 'no'];
export const CORRECTION_VALUES: readonly CorrectionChannel[] = ['kept', 'closed', 'unclear'];
export const TEST_VALUES: readonly SubstituteVerdict[] = ['substitute', 'accompany', 'untested'];
export const HARM_VALUES: readonly HarmKind[] = ['fabricated-support', 'concealed-counter', 'closed-inquiry'];
export const REPLACED_VALUES: readonly ReplacedReason[] = ['evidence', 'bridge', 'exception'];
export const KIND_VALUES: readonly SubstituteKind[] = ['ethos', 'pathos', 'story', 'frame', 'degree', 'relay'];

/**
 * 这一版提示词有没有修辞审计。
 *
 * 与判档共用 `versionAtLeast`（shared/version）：两处各写一份比较，迟早在某一处
 * 写成 `=== '2.9.0'`，于是 2.10.0 的报告被当成旧档——界面会说「当时还没有这一层」，
 * 而它其实有，只是没人给它渲染。
 */
export function promptHasRhetoric(version?: string): boolean {
  return versionAtLeast(version, RHETORIC_PROMPT_VERSION);
}

/**
 * 这份报告该不该有审计表。
 *
 * 与 D 档同一组闸门：不评级模式、透镜不适用（含名录透镜）都没有审计对象——
 * 审计的落脚点是「结论靠什么推出」，而这几类报告根本不走到那一步。
 */
export function rhetoricExpected(d: Diagnosis): boolean {
  return MODE_META[d.mode].givesVerdict && d.theory !== 'copi' && d.scope.applicable;
}

/* ─────────── 核对 ─────────── */

export type RhetoricGapKind =
  | 'no-audit'
  | 'audit-on-nongrading-mode'
  | 'empty-row'
  | 'at-out-of-range'
  | 'row-untested'
  | 'chain-missing'
  | 'chain-incomplete'
  | 'chain-without-row'
  | 'harm-without-substitute'
  | 'substitute-without-harm'
  | 'handoff-single-move'
  | 'chain-duplicate'
  | 'style-words'
  | 'fraction'
  | 'relay-as-causal'
  | 'overlap-undeclared';

export interface RhetoricGap {
  kind: RhetoricGapKind;
  /** block＝按 D-03 第五节「过的判据」，这一份审计没做完；warn＝做完了但有毛病。 */
  severity: 'block' | 'warn';
  text: string;
}

const GAP_TEXT: Record<RhetoricGapKind, string> = {
  'no-audit':
    '没有修辞审计表。D-03 把审计表列为裁决层的交付物之一，没有它，「查替代不查有无」这件事就没被做过。',
  'audit-on-nongrading-mode': '这个模式不走到裁决层，却出现了审计表。已按模式定义置空。',
  'empty-row': '这一行八列全空：既没有功能位置、也没有框架命中、程度又相符——它审计的对象不存在。',
  'at-out-of-range':
    '句位编号指不到原文的任何一句。按原文切句从 1 数（句号／问号／感叹号／分号／换行都算句界）；复核的人拿着这个编号会翻空。',
  'row-untested':
    '这一行没跑四步测试。D-03 第五节的过关判据是「每个可疑成分都跑了四步测试」——没跑不等于没问题，只是还没做。',
  'chain-missing': '这一行判了「替代成立」，却没有对应的替代链。没有替代链的审计表视为未完成（D-03 4.6）。',
  'chain-incomplete': '替代链缺项。一条链必须有：成分、句位、被替代的理由类型、后果类别。',
  'chain-without-row': '替代链指向的句位不在审计表里。链与表必须对得上，否则读的人无法回原文复核。',
  'harm-without-substitute': '这一行判的是「伴随」，却写了后果类别。伴随不记缺陷，也就不该有定损。',
  'substitute-without-harm': '这一行判了「替代成立」，却没有写定损。定损只写文本可观察的后果，不写心理判断。',
  'handoff-single-move': '写了移交 D5，但替代链不足两条。D-03 4.7：只有一个手法不移交，多处伴随也不是协同。',
  'chain-duplicate': '同一句位的同一类成分记了两条链。同一处缺陷只计一次。',
  'style-words': 'note 里出现了文风评语（「语言偏激」「不够客观」这类）。这类话不给句位与替代链，不构成审计。',
  fraction: '出现了配比分数或百分比。三诉求按功能位置记主／辅／无，不换算分数、不设最优配比（D-03 4.2）。',
  'relay-as-causal': '转发链那一格写成了因果断定。D-03 明确：那是支撑而非因果证明，不能据此断言这条文本的实际传播效果。',
  'overlap-undeclared':
    '有「重度放大」，报告里也有结论强度超载，但没标「同一缺陷的修辞侧面」。同一处只计一次，两栏都要能对得上。',
};

function gap(kind: RhetoricGapKind, severity: 'block' | 'warn', extra?: string): RhetoricGap {
  return { kind, severity, text: extra ? `${GAP_TEXT[kind]}${extra}` : GAP_TEXT[kind] };
}

/** 文风评语词表。命中即提醒：它没有句位，也没有替代链。 */
const STYLE_WORDS = /语言偏激|不够客观|缺乏温度|措辞不够克制|行文风格|文笔/;

/** 配比分数：6:3:1、占 60%、配比 2 之类。命中即违反「不换算分数」。 */
const FRACTION = /(\d+\s*[:：]\s*\d+\s*[:：]\s*\d+)|(占\s*\d+\s*%)|(配比\s*\d)/;

/** 把「转发链」写成因果断定。D-03 第六节列为反假阳性条目。 */
const RELAY_CAUSAL = /必然(误导|导致|影响)|证明了传播|因此.{0,6}误导/;

const norm = (s: string): string => s.replace(/\s+/g, '');

/**
 * 核一份审计表。只核「做完了没有、自相矛盾没有」，
 * 不核「这一处到底算不算替代」——那要重跑 B-01 到 B-04 的重构，本地不做。
 */
export function auditRhetoric(d: Diagnosis): RhetoricGap[] {
  const a = d.rhetoric;
  const gaps: RhetoricGap[] = [];

  if (!a || a.rows.length === 0) {
    if (!rhetoricExpected(d)) return gaps;
    return [gap('no-audit', 'warn')];
  }

  if (!rhetoricExpected(d)) return [gap('audit-on-nongrading-mode', 'block')];

  const rowAts = new Set(a.rows.map((r) => norm(r.at)));

  for (const r of a.rows) {
    const silent =
      r.ethos === 'none' &&
      r.pathos === 'none' &&
      r.logos === 'none' &&
      r.frame.length === 0 &&
      r.degree === 'match';
    if (silent) gaps.push(gap('empty-row', 'warn', `（${r.at}）`));
    if (r.test === 'untested') gaps.push(gap('row-untested', 'block', `（${r.at}）`));

    /*
     * 句位编号要指得到原文。D-03 的复核标准是「只凭句位编号重跑四步测试」——
     * 编号越界时那张表看起来完整，复核的人却翻空。切句口径与落点图同一份
     * （`mapSentences`：句末标点与换行，收尾引号并入本句），不另立一套。
     * 只查 S<n> 这种写法：P／C／CQ 等编号由判档那边核，这里不重复。
     */
    const si = /^[Ss](\d+)$/.exec(r.at.trim());
    if (si) {
      const n = Number(si[1]);
      const total = mapSentences(d.passage).length;
      if (n < 1 || n > total) gaps.push(gap('at-out-of-range', 'warn', `（${r.at}：原文只切出 ${total} 句）`));
    }

    const chains = a.chains.filter((c) => norm(c.at) === norm(r.at));
    if (r.test === 'substitute') {
      if (chains.length === 0) gaps.push(gap('chain-missing', 'block', `（${r.at}）`));
      if (r.harm.length === 0) gaps.push(gap('substitute-without-harm', 'block', `（${r.at}）`));
    } else if (r.harm.length > 0) {
      gaps.push(gap('harm-without-substitute', 'block', `（${r.at}）`));
    }

    if (STYLE_WORDS.test(r.note)) gaps.push(gap('style-words', 'warn', `（${r.at}：「${r.note.slice(0, 20)}」）`));
    if (FRACTION.test(r.note)) gaps.push(gap('fraction', 'warn', `（${r.at}）`));
    if (RELAY_CAUSAL.test(r.relay)) gaps.push(gap('relay-as-causal', 'warn', `（${r.at}）`));
  }

  for (const c of a.chains) {
    if (!norm(c.at) || !c.replaced || !c.harm || !norm(c.handoff)) {
      gaps.push(gap('chain-incomplete', 'block', `（${c.at || '未写句位'}）`));
    }
    if (!rowAts.has(norm(c.at))) gaps.push(gap('chain-without-row', 'block', `（${c.at}）`));
  }

  // 同一句位同一类成分只该有一条链：两条等于把同一处缺陷记了两次。
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const c of a.chains) {
    const key = `${norm(c.at)}|${c.kind}`;
    if (seen.has(key)) dup.add(`${c.at}·${KIND_LABEL[c.kind]}`);
    seen.add(key);
  }
  if (dup.size) gaps.push(gap('chain-duplicate', 'warn', `（${[...dup].join('、')}）`));

  /*
   * 移交 D5 的门槛：D-03 4.7 只允许「定损成立且涉及两个以上手法」时移交。
   * 本地不判协同，只核「说要移交的那份记录，有没有两条以上的链」——
   * 一条链就移交，是把单点修辞当成了操纵。
   */
  const handoffs = a.chains.filter((c) => /移交/.test(c.handoff) && !/不移交/.test(c.handoff));
  if (handoffs.length === 1) gaps.push(gap('handoff-single-move', 'block', '（只有一条链）'));

  /* 与 C-01 的去重：有重度放大、报告里也有结论强度超载，却没有一处说明是同一缺陷。 */
  const heavy = a.rows.filter((r) => r.degree === 'heavy');
  const claims = [...d.premises, ...d.intermediate];
  const overreach =
    claims.some((c) => Boolean((c as { modalOverreach?: boolean }).modalOverreach)) ||
    Boolean((d.conclusion as { modalOverreach?: boolean }).modalOverreach);
  const declared = a.rows.some((r) => /同一缺陷/.test(r.note)) || a.overlaps > 0;
  if (heavy.length > 0 && overreach && !declared) {
    gaps.push(gap('overlap-undeclared', 'warn', `（程度放大 ${heavy.length} 处）`));
  }

  return gaps;
}

/** 审计是否算完成：没有 block 级缺口。 */
export function rhetoricComplete(d: Diagnosis): boolean {
  return auditRhetoric(d).every((x) => x.severity !== 'block');
}

/** 界面用的一句话概括，例如「6 行 · 替代成立 2 处 · 移交 2 条」。 */
export function auditLine(a: RhetoricAudit): string {
  const subs = a.rows.filter((r) => r.test === 'substitute').length;
  const handed = a.chains.filter((c) => /移交/.test(c.handoff) && !/不移交/.test(c.handoff)).length;
  const parts = [`${a.rows.length} 行`, `替代成立 ${subs} 处`];
  if (handed) parts.push(`移交 ${handed} 条`);
  if (a.overlaps) parts.push(`与强度超载重合 ${a.overlaps} 处（只计一次）`);
  return parts.join(' · ');
}

/** 一条替代链的人话，例如「情绪／S3／顶掉「推论桥」／剥夺追问 → 移交 D-01」。 */
export function chainLine(c: SubstituteChain): string {
  return `${KIND_LABEL[c.kind]}／${c.at}／顶掉「${REPLACED_LABEL[c.replaced]}」／${HARM_LABEL[c.harm]} → ${c.handoff}`;
}

/**
 * 边界句。三件事必须摆在审计表旁边，否则这张表会被读成第二份判决：
 * 审计只说得清「谁替了谁」，不改档位、不改命题真假；而被识别出替代，
 * 也不等于被主张的事实为假——那是谬误谬误，方向反过来同样成立。
 */
export const RHETORIC_BOUNDARY =
  '审计只回答「谁替了谁」：它不改档位，也不改命题真假。' +
  '一段话被查出修辞替代，不等于它说的事实为假；结论后来被证实，也不等于它的修辞没有替代理由。';

/** 与命题账的隔离声明。D-03 4.8 要求全文末尾写这一句，且不许由模型改写。 */
export const RHETORIC_ISOLATION = '本表未改动任何事实或规范命题状态。';

/** 四项审计的名字，用于「哪几项做了」的核对。 */
export const RHETORIC_ITEMS = ['三诉求配比', '框架预设', '程度夸大', '传播条件'] as const;
