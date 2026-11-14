/**
 * 异议的身份规则。
 *
 * 一条异议要回答两个不同的问题，所以需要两个身份：
 *
 *   在这一份报告里是哪一处  → diagId + field + refId
 *   跨报告还是不是同一条    → objectionKey（不看 diagId）
 *
 * 第二个才是统计的依据。同一段文本重跑一次，报告 id 变了，
 * 但「CQ2 未答」还是那一处判定——用户对它的反对当然还是同一条。
 * 如果按 diagId 归并，统计出来的只会是「用户重跑了三次」。
 *
 * 所以 key 里带上了被反对那句话的开头几十字：同一副透镜、同一条检查项，
 * 但内容不同（比如另一段文本），那其实是两处判定，不该合并。
 */

import type { ObjectionAnchor, ObjectionField } from './types';
import type { TheoryId } from './theories';

/** 摘录长度。太短会把不同判定并成一条，太长则改一个字就断了关联。 */
const EXCERPT_KEY_LEN = 32;

/** 字段路径只认报告里真实可能出现的形状，不接受任意字符串拼进 key。 */
const PATH_RE = /^[A-Za-z_$][\w$]*(?:\.\w+|\[\d+\])*$/;

/**
 * 渲染层传来的锚点一律过这道闸：它是要写进本机文件、还要拼进 key 的。
 * 认不出来就当「没有锚点」，而不是把整条异议丢掉——用户的理由比位置重要。
 */
export function normalizeAnchor(raw: unknown): ObjectionAnchor | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const a = raw as Record<string, unknown>;
  const kind = a.kind;
  if (kind !== 'field' && kind !== 'sentence' && kind !== 'report') return undefined;
  const label = typeof a.label === 'string' ? a.label.trim().slice(0, 80) : '';
  const quote = typeof a.quote === 'string' ? a.quote.trim().slice(0, 200) : '';
  if (!label) return undefined;
  if (kind === 'field') {
    const path = typeof a.path === 'string' ? a.path.trim() : '';
    if (!path || path.length > 160 || !PATH_RE.test(path)) return undefined;
    return { kind, path, label, quote };
  }
  if (kind === 'sentence') {
    const n = Number(a.sentence);
    if (!Number.isInteger(n) || n < 1 || n > 100000) return undefined;
    return { kind, sentence: n, label, quote };
  }
  return { kind, label, quote };
}

/** 锚点 → refId。同一个位置给出同一个 id，跨报告归并才不会散。 */
export function anchorRefId(a: ObjectionAnchor): string {
  if (a.kind === 'field') return `field:${a.path ?? ''}`;
  if (a.kind === 'sentence') return `sentence:${a.sentence ?? 0}`;
  return 'report:whole';
}

const FIELD_NAME: Record<ObjectionField, string> = {
  verdict: '判读',
  defeat: '击败类型',
  check: '检查项',
  label: '命名候选',
  legitimate: '此处合法',
  anchor: '读者锚点',
};

/**
 * 第 5 个参数是可选的：主程序里每处判定本来就有 refId，不传锚点，
 * 生成的历史 key 逐字不变（已有的统计和「你不同意」标记不能因为这次改动
 * 突然对不上）。只有工作台那种「一句话没地方钉」的异议才带锚点，
 * 不同的字段 / 句子因此有不同的 key——这是同一份报告能留下多条异议的前提。
 */
export function objectionKey(
  theory: TheoryId,
  field: ObjectionField,
  refId: string,
  excerpt: string,
  anchor?: ObjectionAnchor
): string {
  const tail = excerpt.replace(/\s+/g, '').slice(0, EXCERPT_KEY_LEN);
  const base = `${theory}|${field}|${refId}|${tail}`;
  return anchor ? `${base}|@${anchorRefId(anchor)}` : base;
}

export function objectionFieldName(f: ObjectionField): string {
  return FIELD_NAME[f];
}

/**
 * 异议能说明什么，不能说明什么。
 * 界面上每次都要把这句话显示出来，否则「我不同意」会长成「我改判」。
 */
export const OBJECTION_SCOPE_NOTE =
  '这条只记录你的判断，不改报告。报告仍然按它自己的标准写，你保留不同意见——两者并列，才看得出分歧在谁那边。';
