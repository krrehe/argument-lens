import type { Diagnosis } from './types';
import { claimsOfSub, type ClaimSub } from './theory-base';

/**
 * 专题分析。
 *
 * 这是「增加其他分析」的方式，但它不新增第七副透镜，也不新增分析模式：
 * 六个专题各自是一类论证在文献里的共识问题清单（类比、因果与统计、来源与权威、
 * 实践推理、定义与含混、预设与问句）。同一段话落在哪个专题上，决定该多问哪几问。
 *
 * 三条硬边界：
 *
 *   1. 全部由已落盘字段本地推导，不调模型、不加 token（T7-07）。
 *      命中判据用得上什么就用什么：透镜负载里的型式族、担保类型、命题类型，
 *      以及原文的字面线索。字面线索最弱，用它命中的必须写明「按字面线索」。
 *
 *   2. 不给档位。档位只有 verdict 一处。专题分析给的是「这类论证该问什么」，
 *      不是「这类论证有几分」——给分就把清单法的老毛病（把问题清单变成打分表）又带回来了。
 *
 *   3. 未命中也要列出来。只显示命中的，用户就没法区分「没命中」和「没检查」，
 *      后者就是假绿。每个未命中都写明为什么没命中。
 */

export const TOPIC_SUBS: ClaimSub[] = [
  'topic-analogy',
  'topic-causal',
  'topic-source',
  'topic-practical',
  'topic-definition',
  'topic-presupposition',
] as const;

export interface TopicHit {
  sub: ClaimSub;
  name: string;
  /** 为什么命中 / 为什么没命中。照实写依据，包括依据有多弱。 */
  basis: string;
  /** 命中了吗 */
  hit: boolean;
  /** 这类论证在文献上公认该问的问题 */
  asks: string[];
  /** 本工具这一次已经问过的（与 checks 对得上的）。为空就是没问过，明说。 */
  askedInChecks: string[];
  /** 依据的理论主张 id（细分域里那几条） */
  claimIds: string[];
}

const TOPIC_NAME: Record<string, string> = {
  'topic-analogy': '类比',
  'topic-causal': '因果与统计',
  'topic-source': '来源与权威',
  'topic-practical': '实践推理',
  'topic-definition': '定义与含混',
  'topic-presupposition': '预设与问句',
};

/** 用的问法与理论依据（theory-base 的细分域条目）。 */
const TOPIC_ASKS: Record<string, string[]> = {
  'topic-analogy': [
    '已知的差异点里，有没有落在担保链上的？',
    '比的是「同一件事」，还是只比了相似的结果？',
  ],
  'topic-causal': [
    '相关是真的相关，还是巧合或选择偏差？',
    '方向对吗——会不会是果在影响因？',
    '还有什么也能解释这个结果？',
    '样本怎么来的、基数多大、比率跟什么比？',
  ],
  'topic-source': [
    '专家在结论所属的领域内吗？',
    '引用是原话还是转述？',
    '这个领域里有共识，还是一家之言？',
    '专家与这个结论有利益关系吗？',
  ],
  'topic-practical': [
    '有没有替代方案？为什么不用它？',
    '副作用有哪些？谁承担？',
    '价值排序摆出来了吗——凭什么这个目标优先？',
  ],
  'topic-definition': [
    '关键术语从前提走到结论，含义变过没有？',
    '按另一种合理解读读一遍，结论还成立吗？',
  ],
  'topic-presupposition': [
    '这一问里藏着哪个未经同意的假定？',
    '把问句改成陈述句，那个假定还站得住吗？',
  ],
};

/** 与 checks 对账用的关键词。对不上就是没问过——照实写，不装作问过。 */
const TOPIC_KEYWORDS: Record<string, string[]> = {
  'topic-analogy': ['类比', '相似'],
  'topic-causal': ['因果', '相关', '替代解释', '样本'],
  'topic-source': ['专家', '权威', '来源', '可信'],
  'topic-practical': ['替代方案', '副作用', '价值', '成本'],
  'topic-definition': ['定义', '含混', '歧义', '换义'],
  'topic-presupposition': ['预设', '假定', '复杂问语'],
};

const TEXT_CUES: Record<string, RegExp> = {
  // 字面线索最弱：只用来在「没有任何结构信号」时补一问，依据里写明
  'topic-analogy': /就像|好比|如同|同理/,
  'topic-causal': /因为|导致|原因|归因|结果表明|下降|上升/,
  'topic-source': /专家|研究显示|研究表明|据报道|权威|博士|教授/,
  'topic-practical': /应该|应当|建议|必须|我们要|不妨/,
  'topic-definition': /所谓|指的是|定义|说白了就是|本质上/,
  'topic-presupposition': /[？?]/,
};

export function topicsOf(d: Diagnosis): TopicHit[] {
  const lens = d.lens;
  const text = d.passage;

  const strongSignals: Record<string, string[]> = {
    'topic-analogy': [],
    'topic-causal': [],
    'topic-source': [],
    'topic-practical': [],
    'topic-definition': [],
    'topic-presupposition': [],
  };

  if (lens.kind === 'walton') {
    if (lens.family === 'comparison') strongSignals['topic-analogy'].push('型式族认成「比较」');
    if (lens.family === 'causal') strongSignals['topic-causal'].push('型式族认成「因果」');
    if (lens.family === 'source') strongSignals['topic-source'].push('型式族认成「来源」');
    if (lens.family === 'pragmatic') strongSignals['topic-practical'].push('型式族认成「实践」');
  }
  if (lens.kind === 'toulmin') {
    if (lens.warrantType === 'analogy') strongSignals['topic-analogy'].push('担保类型是类比');
    if (lens.warrantType === 'causal') strongSignals['topic-causal'].push('担保类型是因果');
    if (lens.warrantType === 'authority') strongSignals['topic-source'].push('担保类型是权威');
  }
  if (lens.kind === 'pta') {
    if (lens.conclusionType === 'policy') strongSignals['topic-practical'].push('结论是政策命题（该不该做）');
  }

  const out: TopicHit[] = TOPIC_SUBS.map((sub) => {
    const strong = strongSignals[sub];
    const cue = TEXT_CUES[sub].test(text);
    const hit = strong.length > 0 || cue;
    const basis = strong.length
      ? `${strong.join('；')}——来自本次分析已经落盘的判断。`
      : cue
        ? '未命中结构信号，仅按字面线索（用词）命中——这条依据最弱，问题仅供参考。'
        : `未命中：本次分析里没有这类论证的信号，原文也没有「${TOPIC_NAME[sub]}」类的字面线索。`;

    const kws = TOPIC_KEYWORDS[sub];
    const askedInChecks = d.checks
      .filter((c) => kws.some((k) => c.question.includes(k) || c.label.includes(k)))
      .map((c) => `${c.id} ${c.label}`);

    return {
      sub,
      name: TOPIC_NAME[sub],
      basis,
      hit,
      asks: TOPIC_ASKS[sub],
      askedInChecks,
      claimIds: claimsOfSub(sub).map((c) => c.id),
    };
  });

  return out;
}
