import { LEVEL_LABEL, THEORY_BY_ID } from './theories';
import { ANSWER_LABEL } from './labels';
import { MODE_META, type CheckItem, type Diagnosis, type VerdictLevel } from './types';

/**
 * 判读的推导链：从「问了几关」到「落在哪一格」。
 *
 * 为什么要单独做这一层：判读栏原来只给两样东西——指针「在这里」，和一句
 * 「同一档换一副透镜意思会变」。中间那一步（凭什么在这儿、不凭什么是别的格）
 * 一直缺着。而缺的那一步恰恰是这份报告里最可学的东西：
 * **判读不是算出来的，是一关一关问出来的。**
 *
 * 三个人为约束：
 *
 * 1. **不许自己立法。** 档位的定义只从 theories.ts 的 levelMeaning 取，这里不新写规则。
 *    模型的判断与程序的强制改写都照实说，不替它圆场。
 * 2. **不猜。** 钉住它的是哪一关，只认 defeat.checkId 与检查项的 answer；
 *    三者都没有时就说「没有一关钉住它」，不找个最像的凑数。
 * 3. **只给三个真档。** 「判不了」不在这三格里，它是尺子量不了，不是量出来的结果——
 *    混进去，等于把「没量」说成一个刻度。
 */

export interface TrailStep {
  /** 环节：点数 → 落点 → 定义 → 档位。 */
  k: 'count' | 'pin' | 'rule' | 'level';
  head: string;
  body: string;
  tone: 'ok' | 'warn' | 'bad' | 'none';
  /** 能指回逐关检查的那一关，点了就跳过去。 */
  checkId?: string | null;
}

export interface LadderCell {
  level: Exclude<VerdictLevel, 'undetermined'>;
  label: string;
  meaning: string;
  current: boolean;
}

const LEVELS3: Exclude<VerdictLevel, 'undetermined'>[] = ['withstands', 'weakened', 'fails'];

/** 会改档位的三处裁决。G3 改的是 whatIsRefuted，不动档位，所以不在此列。 */
const LEVEL_FORCING = new Set(['CATALOG_OVERREACH', 'SCOPE_LEVEL_FORCED', 'MODE_NO_VERDICT']);

/** 检查项标签去掉开头的编号（「CQ2 为何…」→「为何…」），编号单独显示。 */
export function stripId(label: string) {
  return label.replace(/^[A-Za-z0-9-]+\s*/, '') || label;
}

function tally(checks: CheckItem[]) {
  return {
    total: checks.length,
    passed: checks.filter((c) => c.answer === 'passed').length,
    violated: checks.filter((c) => c.answer === 'violated').length,
    unanswered: checks.filter((c) => c.answer === 'unanswered').length,
    na: checks.filter((c) => c.answer === 'not-applicable').length,
  };
}

/**
 * 钉住判定的那一关。
 *
 * 顺序是「模型点名的」→「没过的」→「没答的」。前两个谁先谁后是有讲究的：
 * 模型点名的那一关是它自己认的因果，比我按类型挑一条更可信；但它可能没点名
 * （defeat.checkId 为空），那时才退回按答案找。找不到任何一关，就说没有。
 */
function pinOf(d: Diagnosis): CheckItem | null {
  const byId = d.defeat?.checkId ? d.checks.find((c) => c.id === d.defeat.checkId) : undefined;
  if (byId) return byId;
  return (
    d.checks.find((c) => c.answer === 'violated') ??
    d.checks.find((c) => c.answer === 'unanswered') ??
    null
  );
}

function meaningOf(d: Diagnosis, level: Exclude<VerdictLevel, 'undetermined'>) {
  const t = THEORY_BY_ID[d.theory];
  /* 理论库里没写这一档的释义时给空串，界面上这一格就只显示档位名——
     编一句「大概是这样」比留白更坏。 */
  return t?.levelMeaning?.[level] ?? '';
}

/**
 * 「判不了」的原因。顺序：模式 → 范围 → 程序改写 → 兜底。
 *
 * 模式排在最前：查谬误／重构／提问这三个模式本来就不给档位，
 * 那不是「模型没判」，是设计。把它们说成「信息不足」是把设计说成缺陷。
 */
function undeterminedReason(d: Diagnosis): { body: string; forced: { code: string; message: string } | null } {
  const gate = [...d.diagnostics].reverse().find((x) => LEVEL_FORCING.has(x.code)) ?? null;
  const forced = gate ? { code: gate.code, message: gate.message } : null;

  const meta = MODE_META[d.mode];
  if (!meta?.givesVerdict) {
    return {
      body: `「${meta?.label ?? d.mode}」模式不给档位：它只做${meta?.allowsLabels ? '指出位置' : '拆结构或提问'}，不判这段话成不成立。这是模式定义，不是没判出来。`,
      forced,
    };
  }
  if (!d.scope.applicable) {
    /* 原因句自带句号，直接接下一句会出现「。 。」——截图审出来的。 */
    const reason = (d.scope.reason || '未写原因').replace(/[。；;，,\s]+$/, '');
    return {
      body: `这副尺子在这段话上不适用：${reason}。不适用就不量——量出来的刻度是假的。`,
      forced,
    };
  }
  if (forced) return { body: forced.message, forced };
  return { body: '这副尺子适用，但这次给出的信息不足以量出一个档位。缺什么写在下面「下一步」里。', forced };
}

export function verdictTrail(d: Diagnosis): {
  steps: TrailStep[];
  ladder: LadderCell[];
  note: string | null;
  forced: { code: string; message: string } | null;
} {
  const t = tally(d.checks);
  const lv = d.verdict.level;
  const steps: TrailStep[] = [];

  const ladder: LadderCell[] = LEVELS3.map((level) => ({
    level,
    label: LEVEL_LABEL[level],
    meaning: meaningOf(d, level),
    current: lv === level,
  }));

  if (lv === 'undetermined') {
    const { body, forced } = undeterminedReason(d);
    steps.push({
      k: 'pin',
      head: '为什么给不出档位',
      body,
      tone: 'none',
    });
    steps.push({
      k: 'level',
      head: '所以',
      body: '判不了 —— 它不在下面三格之内',
      tone: 'none',
    });
    return { steps, ladder, note: null, forced };
  }

  steps.push({
    k: 'count',
    head: '这副尺子问了几关',
    body: t.total
      ? `${t.total} 关：过 ${t.passed} · 没过 ${t.violated} · 没答 ${t.unanswered}${t.na ? ` · 不适用 ${t.na}` : ''}`
      : '没有检查项',
    tone: 'none',
  });

  const pin = pinOf(d);
  /*
   * 不说「削弱」两个字：档位本身就叫「被削弱」，在这里再用它标注击败类型，
   * 两个不同的东西会共用一个词。说它切断了什么，比给它一个名字清楚。
   */
  const kindTail =
    d.defeat?.kind === 'rebutting'
      ? '（反驳：直接打结论）'
      : d.defeat?.kind === 'undermining'
        ? '（切断的是支撑，不是结论）'
        : '';
  steps.push(
    pin
      ? {
          k: 'pin',
          head: '钉住它的是哪一关',
          body: `${pin.id} ${stripId(pin.label)} —— ${ANSWER_LABEL[pin.answer]}${kindTail}`,
          tone: pin.answer === 'violated' ? 'bad' : 'warn',
          checkId: pin.id,
        }
      : {
          k: 'pin',
          head: '钉住它的是哪一关',
          body: '没有一关钉住它：每一关都答上了，也没有哪一步被切断',
          tone: 'ok',
        }
  );

  /*
   * 第三步（「按定义落到这一格」）由三格对照那块承担，不在这里再写一行：
   * 同一句释义在一屏里出现两次，读者会以为是两件事。
   */

  /*

  /*
   * 一句「没答 ≠ 没过」。这两个符号在界面上只差一个笔画，含义差得很远：
   * 没过是攻击成立，要改主张；没答是材料缺了，还能补。这张表里两者并排出现，
   * 不说清楚，读者会把它们当成同一种「不好」。
   */
  const note =
    t.unanswered > 0 && t.violated > 0
      ? '「没过」与「没答」不是一回事：没过是人家给了理由而理由不成立，要改主张；没答是他没给出这一环，还能补。两者同时出现时，先看没过的那一关。'
      : t.unanswered > 0
        ? '「没答」不等于「没过」：这一关他没给出依据，不等于他给出的依据错了。差别在于——前者还有补的余地，后者要改主张。'
        : t.violated > 0
          ? '「没过」是攻击真的成立：这一关不是缺材料，是材料立不住。'
          : null;

  return { steps, ladder, note, forced: null };
}
