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

import type { ObjectionField } from './types';
import type { TheoryId } from './theories';

/** 摘录长度。太短会把不同判定并成一条，太长则改一个字就断了关联。 */
const EXCERPT_KEY_LEN = 32;

const FIELD_NAME: Record<ObjectionField, string> = {
  verdict: '判读',
  defeat: '击败类型',
  check: '检查项',
  label: '命名候选',
  legitimate: '此处合法',
};

export function objectionKey(
  theory: TheoryId,
  field: ObjectionField,
  refId: string,
  excerpt: string
): string {
  const tail = excerpt.replace(/\s+/g, '').slice(0, EXCERPT_KEY_LEN);
  return `${theory}|${field}|${refId}|${tail}`;
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
