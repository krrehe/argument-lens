import type { LabelCandidate } from './types';

/**
 * 谬误落点图的计算层。
 *
 * 为什么是纯函数：界面上「这句犯了哪个谬误」必须是可检验的——
 * 检查脚本在纯 node 里真跑这份数据，而不是只看组件渲染没渲染。
 * 图只是把这里算出的关系画出来；算错的关系画得再好看也是错的。
 *
 * 坐标系：start/end 都是 UTF-16 下标，与 Span 一致，不换算。
 */

export interface MapSentence {
  index: number;
  start: number;
  end: number;
  text: string;
}

/**
 * 切句。按句末标点（。！？；）与换行切，紧随其后的收尾引号并入本句。
 *
 * 为什么不用 segmentPassage：那是「切段」，切的是论证单元，一篇短文往往只有一段；
 * 落点图要的是「句」，粒度完全不同。这里刻意独立实现，两头各守各的边界。
 */
export function mapSentences(passage: string): MapSentence[] {
  const out: MapSentence[] = [];
  let start = 0;
  for (let i = 0; i < passage.length; i++) {
    const ch = passage[i];
    const isEnd = '。！？；\n'.includes(ch);
    if (!isEnd) continue;
    // 收尾引号跟着句子走：「……早读。」的句号在引号里，但整句到 」 才算完
    let end = i + 1;
    while (end < passage.length && '」』）〉》'.includes(passage[end])) end++;
    const text = passage.slice(start, end).trim();
    if (text) out.push({ index: out.length, start, end, text });
    start = end;
  }
  if (start < passage.length) {
    const text = passage.slice(start).trim();
    if (text) out.push({ index: out.length, start, end: passage.length, text });
  }
  return out;
}

export type LabelHit =
  | { labelId: string; at: number[] }
  | { labelId: string; at: null; reason: 'failed' | 'missing' };

/**
 * 每条命名落到哪些句子上。
 *
 * 规则只有一条：**span 与句子有交集就算命中**。不做模糊匹配、不猜最近句——
 * 猜出来的位置比没有位置更糟（用户会拿着错的句子去质问原文）。
 * 所以 quality=failed 的不画位置（failed），模型压根没给 span 的也不画（missing），
 * 两类都留在图下明说，绝不静默。
 */
export function fallacyHits(passage: string, labels: LabelCandidate[]): LabelHit[] {
  const sentences = mapSentences(passage);
  return labels.map((l) => {
    if (!l.span || l.span.quality === 'failed') {
      return { labelId: l.id, at: null, reason: l.span?.quality === 'failed' ? 'failed' : 'missing' };
    }
    const at: number[] = [];
    for (const s of sentences) {
      if (l.span.start < s.end && s.start < l.span.end) at.push(s.index);
    }
    return { labelId: l.id, at };
  });
}
