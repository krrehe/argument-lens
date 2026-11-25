/**
 * 语料的「毛病类型」表。
 *
 * 为什么需要这张表：P1-1 的判据是「每个陷阱至少两条独立文本」。
 * 没有类型标注，这句话**无法执行**——每条语料的 `traps` 都是一段自由描述，
 * 于是「相关当因果」出现了几次，只能靠人一条条去数，而人数出来的东西会腐烂。
 *
 * 分类轴是**毛病**，不是别的三种东西：
 *   - 不是理论（walton / copi / pta…）：理论说的是「用哪套尺子量」，
 *     一段文本用一种尺子，按理论分组天然每条不重复，等于没分组。
 *   - 不是十一道裁决（G1–G11）：那些管的是「模型输出坏了怎么修」，
 *     与文本里埋了什么无关。
 *   - 不是谬误名：名字是**输出**，这个项目反对轻易命名；
 *     用名字当分类，会把「命名」当成「抓到」，而这两件事差得很远。
 *
 * 毛病类型问的是：这段文本里埋了什么，一个够好的分析必须接住它。
 *
 * 表里的条目是从现有语料的 traps 里**归纳**出来的，不是先验列出的清单——
 * 顺序也是按「一个分析最常在哪一步掉下去」排的，不是按字母。
 */

export interface Kind {
  /** 报告里、文档里都用这个中文名，不再另起简称 */
  name: string;
  /** 一句话判据：什么样的文本算踩到这一类。写不清这句，就不该有这一类 */
  rule: string;
}

export const KINDS = {
  causal: {
    name: '相关当因果',
    rule: '把共变、回归系数、时间先后当成原因，没有识别策略，也没排除替代解释',
  },
  sample: {
    name: '样本与代表性',
    rule: '样本小、自选、单点、已被选择，却被用来支持关于更广总体的结论',
  },
  warrant: {
    name: '隐含前提未写出',
    rule: '论证靠一条没写出来的担保（或一条没写出来的引理）才成立，而那条本身可疑',
  },
  normative: {
    name: '事实跳规范',
    rule: '从「是什么」直接推出「应当怎样」，中间那条规范前提没有出现',
  },
  scope: {
    name: '范围门',
    rule: '该判不适用的文本（纯描写、纯演绎、纯协商）被当成可废止论证来评，或反过来',
  },
  dialogue: {
    name: '对话类型',
    rule: '协商、会诊、质疑被当成说服来量，于是把「立场」安到本没有立场的人头上',
  },
  attribution: {
    name: '引述归属',
    rule: '引号里的话、被转述的主张，被当成作者自己的立场去评',
  },
  authority: {
    name: '出处与权威链',
    rule: '权威经三级转述后衰减、来源未发表、引证是占位符、或消极证据的完备性未检验',
  },
  overclaim: {
    name: '结论超出证据',
    rule: '从「不必需」跳到「不重要」、把探索性分析写成确证、或反过来把限定好的结论判成过度概括',
  },
  selection: {
    name: '选择性举证',
    rule: '只举支持自己的例子，不给基数，也不提反例',
  },
  overdiagnosis: {
    name: '过度指控',
    rule: '好论证被扣上谬误名或判为失败；文本里的真实内核被全盘否定',
  },
  concept: {
    name: '概念分歧非事实错误',
    rule: '争的是概念该怎么用（自由、知道、有效），把它判成事实错误就整段错位',
  },
  denominator: {
    name: '分子与分母',
    rule: '只讲数量不讲率、只讲下降不讲基数，于是「变好」可能只是分母变小',
  },
  analogy: {
    name: '类比跳跃',
    rule: '说「情形相同」就把结论搬过来，不说相似性为何在这一议题上重要',
  },
  ambiguity: {
    name: '读法歧义',
    rule: '一句话有两种读法且方向相反；正确做法是写进 unknowns，不是挑一个当结论',
  },
  reversal: {
    name: '自相矛盾',
    rule: '用反例打自己的全称前提，或前后两句直接冲突，而作者没有察觉',
  },
  irrelevant: {
    name: '不相关属性',
    rule: '利益冲突（相关）与人品、口气（不相关）混在同一句里，不拆开就会把有用的信息一起扔',
  },
  multiple: {
    name: '多重比较',
    rule: '在若干亚组、若干指标里挑出显著的，未校正，然后把「显著」当成「有效应」',
  },
} as const;

export type KindId = keyof typeof KINDS;

export const KIND_IDS = Object.keys(KINDS) as KindId[];

/**
 * 每条语料埋了哪几类毛病。键是 `CASES` 里的 id。
 *
 * 一条语料最多标三类：标得越多，「这条接住了」这个结论就越模糊——
 * 一份报告抓到其中一类，也算「接住了这条语料」，于是覆盖矩阵会虚高。
 * 所以只标**这段文本最想考的那几处**，其余写在 `traps` 里当人读的备注。
 */
export const KINDS_BY_CASE: Record<string, KindId[]> = {
  'academic-panel': ['causal', 'normative'],
  'philosophy-gettier': ['warrant', 'concept'],
  'legal-analogy': ['analogy', 'authority'],
  'ad-copy': ['selection', 'warrant'],
  'news-attribution': ['authority', 'sample', 'attribution'],
  'pseudo-science': ['selection', 'authority', 'overdiagnosis'],
  'non-argument': ['scope', 'overdiagnosis'],
  negotiation: ['dialogue', 'scope'],
  'strong-argument': ['overdiagnosis', 'concept'],
  'citation-density': ['causal', 'authority', 'overclaim'],
  'tech-decision': ['warrant', 'overclaim'],
  'long-editorial': ['analogy', 'authority', 'overclaim'],
  'english-remote': ['sample', 'overclaim'],
  'math-proof': ['scope', 'warrant', 'overdiagnosis'],
  'quote-rebuttal': ['attribution', 'normative'],
  'stats-brief': ['denominator', 'causal'],
  'ambiguous-referent': ['ambiguity'],
  'personal-appeal': ['overdiagnosis', 'warrant', 'normative'],
  'self-defeat': ['reversal', 'overclaim'],
  'ad-hominem-real': ['irrelevant'],
  'medical-consult': ['dialogue'],
  'history-inference': ['authority', 'overclaim'],
  'p-hacking': ['multiple', 'overclaim'],

  /* 第三批：补「只有一段」的那五类，各自换了一个场景 */
  'hospital-mortality': ['denominator', 'causal'],
  'contract-scope': ['ambiguity'],
  'retro-conflict': ['reversal', 'selection'],
  'review-irrelevant': ['irrelevant', 'sample'],
  'growth-multimetric': ['multiple', 'overclaim'],

  /*
   * 第四批（2026-11-05）：28 → 40 段。九类刚好卡在两段的各补一段；
   * 另外三段的用处不是「加段数」而是「加模式」——见 cases.ts 里那一段注释。
   *
   * 这三条标了两类，都是文本里真的埋着两处，不是为了凑矩阵：
   *   incident-report 的结论靠一条从未写出的隐含前提（相似现象 ⇒ 相似机理）撑着；
   *   user-interviews 从「4 人说需要」跳到「应当优先排期」，中间那条规范前提没有出现。
   */
  'metric-definition': ['concept'],
  'incident-report': ['analogy', 'warrant'],
  'reading-notes': ['attribution'],
  'mediation-record': ['dialogue'],
  'store-monthly': ['denominator'],
  'internal-notice': ['ambiguity'],
  'training-handout': ['reversal'],
  'tender-review': ['irrelevant'],
  'qc-sampling': ['multiple'],
  'product-manual': ['scope'],
  'user-interviews': ['sample', 'normative'],
  'hoa-letter': ['overdiagnosis'],

  /* 第六个模式（深查）的语料：换两个新场景，避免与已有段共享写法 */
  'deep-lab-meeting': ['causal', 'warrant'],
  'deep-policy-note': ['causal', 'selection'],
};
