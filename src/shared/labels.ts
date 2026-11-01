/**
 * 界面与导出共用的中文标签。
 *
 * 为什么单独一个文件：同一个枚举在两处各写一遍中文，迟早不一致——界面改了措辞，
 * 导出的文件还是旧的，而拿到文件的人看不到界面。这个项目已经因为「两处各算一遍」
 * 吃过一次亏（用量明细与合计的金额口径），那次是数字对不上，这次会是话对不上。
 *
 * 一个字也没有的枚举不要在这里加占位文案：缺就是缺，宁可显示原文值，
 * 也不要用一个看起来像翻译的猜测把它盖住。
 */
import type { CheckItem } from './types';

export const ANSWER_LABEL: Record<CheckItem['answer'], string> = {
  passed: '通过',
  violated: '未过',
  unanswered: '未答',
  'not-applicable': '不适用',
};

/** 只给界面用（样式类名）。导出是纯文本，没有它的位置。 */
export const ANSWER_CLASS: Record<CheckItem['answer'], string> = {
  passed: 'passed',
  violated: 'violated',
  unanswered: 'unanswered',
  'not-applicable': 'na',
};

export const ACCEPT_PILL: Record<string, string> = {
  acceptable: 'ok',
  questionable: 'mid',
  unacceptable: 'bad',
  unknown: '',
};

/** 前提的可接受性。与 ACCEPT_PILL 一一对应，一个是样式类名，一个是给人和文件看的字。 */
export const ACCEPT_LABEL: Record<string, string> = {
  acceptable: '可接受',
  questionable: '可疑',
  unacceptable: '不可接受',
  unknown: '未判',
};

export const BURDEN_LABEL: Record<string, string> = {
  proponent: '在提议方',
  respondent: '在回应方',
  both: '双方',
  unclear: '不清',
};

export const STRATEGY_LABEL: Record<string, string> = {
  'premise-false': '攻前提为假',
  'premise-unsupported': '前提未获担保',
  'missing-premise': '隐含前提不成立',
  counterexample: '构造反例',
  distinguo: '区分情形',
  'alternative-explanation': '另有更好解释',
  'scheme-mismatch': '型式／定位不当',
  'burden-shift': '证明责任错置',
  'procedure-violation': '程序规则被违反',
};

export const CONF_LABEL: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
  'very-low': '很低',
  undetermined: '未定',
};

export const TAG_LABEL: Record<string, string> = {
  known: '有据',
  computed: '算出',
  inferred: '推论',
  general: '常识',
  framework: '框架内',
  guess: '猜测',
};

/**
 * 「被驳倒的是什么」。
 *
 * 这个字段一直在报告里，但从没被显示过——它是「结论被驳倒」与「论证被驳倒」
 * 之间的分界，而这两件事对写作者的意义完全不同：前者说明你写错了，
 * 后者只说明你没写够。所以导出的文件里必须有它。
 */
export const WHAT_REFUTED_LABEL = {
  nothing: '没有被驳倒',
  'argument-only': '只驳倒了论证，结论本身未必为假',
  conclusion: '驳倒了结论本身',
} as const;
