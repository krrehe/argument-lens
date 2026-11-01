import type { UsageRecord } from './types';

/**
 * 用量明细的表格形状。
 *
 * 单独成一个文件，不是因为这几行代码多，是因为它**必须能被断言**。
 * 放在 `main/usage.ts` 里的话，那个文件 import electron，脚本跑不起来，
 * 于是「表头列数 == 数据列数」这件事就只能靠人看。
 *
 * 这一处曾经真的少了一列：行尾多出一个「按现价回填」的备注，表头只有 13 项，
 * 那一列掉到表头之外——Excel 打开是一列没有名字的数据。不报错、不崩、没人发现，
 * 只有拿到文件的人会以为导出坏了。
 */

/**
 * 导出的表头。
 *
 * 新增列一律加在「备注」之前：备注是最后一列这个位置已经被上面的教训绑定了，
 * 它一动，历史上导出的文件与新的就对不上。
 */
export const CSV_HEAD = [
  '时间',
  '是否完成',
  '透镜',
  '模型',
  '供应商',
  '输入token',
  '输出token',
  'token来源',
  '费用',
  '单价(输入/M)',
  '单价(输出/M)',
  '耗时ms',
  '原文长度',
  '备注',
] as const;

/**
 * 一行明细。
 *
 * `cost` 由调用方算好传进来，不在这里重新取价——面板与导出必须显示同一个数字，
 * 各自算一遍就迟早算得不一样。`backfilled` 同理：它说明这个金额是按今天的价
 * 回填的，不是当时冻结的价。
 */
export function csvRow(r: UsageRecord, cost: number, backfilled: boolean): (string | number)[] {
  return [
    new Date(r.at).toLocaleString('zh-CN'),
    r.ok ? '完成' : '未完成',
    r.theory ?? '',
    r.model,
    r.host,
    r.promptTokens,
    r.completionTokens,
    r.estimated ? '估算' : '接口返回',
    cost.toFixed(6),
    r.priceIn || '',
    r.priceOut || '',
    r.ms,
    r.chars,
    backfilled ? '按现价回填' : '',
  ];
}

/** 一个单元格。逗号、引号、换行都要包起来，否则整行会错位。 */
export function csvCell(v: string | number | boolean): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
