import type { Diagnosis } from './types';

/**
 * 学术文本的本地分析。
 *
 * 与专题分析、边界栏同一套做法：全部由原文与已落盘字段本地推导，
 * 不进提示词、不加 token、不调模型，因此永远可复现、零成本。
 *
 * 它回答四个问题，顺序也就是它的重要性：
 *
 *   1. 这是什么体裁？（体裁决定规范，不同体裁的举证责任落在不同人身上）
 *   2. 文里哪些话需要你回原文核？（引用、数据、样本、权威转述——这些本工具核不了）
 *   3. 学术规范的那几条，本工具代劳了哪几条、没代劳哪几条？
 *   4. 要反驳，先从哪一层下手？（事实、主张、推理规则三层，可辩性差得远）
 *
 * 三条硬边界：
 *
 *   1. **核不了就说核不了。** 引用是否忠实、数据是否真实、方法是否恰当，
 *      本工具一概无法判断——它看不到原文与数据集。这三条在清单里标 `no`，
 *      且排场与其他条目一致：做不到的事排成小字脚注，等于暗示它不重要。
 *
 *   2. **抽不到不等于没有。** 抽取是正则启发式，抽不到时明说「没抽出」，
 *      不说「没有需要核的」——后者是假绿。
 *
 *   3. **不给判定。** 这里任何一栏都不产生档位。档位只有 verdict 一处。
 */

/* ───────────────── 一 · 体裁 ───────────────── */

export type Genre =
  | 'paper'
  | 'review'
  | 'monograph'
  | 'commentary'
  | 'policy'
  | 'popular'
  | 'unknown';

export const GENRE_LABEL: Record<Genre, string> = {
  paper: '研究论文',
  review: '文献综述',
  monograph: '专著章节',
  commentary: '书评与学术评论',
  policy: '政策报告',
  popular: '科普与媒体转述',
  unknown: '识别不出',
};

/**
 * 体裁的特征词。顺序即具体度：分数相同时取靠前的一类，
 * 因为更具体的体裁带着更具体的规范（书评与论文的举证责任不是一回事）。
 */
const GENRE_CUES: { genre: Genre; cues: { re: RegExp; label: string }[] }[] = [
  {
    genre: 'paper',
    cues: [
      { re: /摘\s*要|内容提要/, label: '有「摘要」' },
      { re: /Abstract/i, label: '有 Abstract' },
      { re: /关键词|Key\s*words/i, label: '有关键词' },
      { re: /本文(?:认为|主张|指出|试图)|本研究|本文的(?:目的|结论)/, label: '自称「本文／本研究」' },
      { re: /研究方法|研究设计|数据来源|变量|回归|显著性|p\s*[<＜]\s*0?\.\d/, label: '有方法或统计术语' },
      { re: /样本(?:量|数)?|问卷|访谈|实验组|对照组|n\s*=\s*\d+/, label: '有样本描述' },
    ],
  },
  {
    genre: 'review',
    cues: [
      { re: /综\s*述|文献回顾|研究现状|已有研究|既有研究/, label: '有综述标志词' },
      { re: /元分析|荟萃分析|meta[\s-]?analysis/i, label: '提到元分析' },
      { re: /(?:学界|研究者)(?:普遍|多数|一般认为)/, label: '转述学界共识' },
    ],
  },
  {
    genre: 'monograph',
    cues: [
      { re: /第[一二三四五六七八九十百\d]+章/, label: '有章号' },
      { re: /本\s*章|本\s*书|本\s*编|下一章|上一章/, label: '自称「本章／本书」' },
      { re: /^(?:导论|绪论|结语|后记|附录)/m, label: '有专著结构标题' },
    ],
  },
  {
    genre: 'commentary',
    cues: [
      { re: /书\s*评|评《|读《|商榷|回应.{0,6}(?:一文|文章)/, label: '有书评或商榷标志' },
      { re: /笔\s*者/, label: '自称「笔者」' },
      { re: /《[^》]{2,40}》/g, label: '书名号引用' },
    ],
  },
  {
    genre: 'policy',
    cues: [
      { re: /政策建议|对策建议|建言|治理(?:路径|对策)/, label: '有政策建议标志' },
      { re: /智库|白皮书|政府(?:应|须|需)|监管(?:部门|框架)/, label: '有政策主体' },
      { re: /(?:实施|落地|试点)(?:方案|路径|成本)/, label: '有实施路径' },
    ],
  },
  {
    genre: 'popular',
    cues: [
      { re: /研究表明|研究发现|科学家(?:发现|称)|专家(?:表示|称)/, label: '转述研究但无出处' },
      { re: /据.{0,8}报道|据悉|有媒体/, label: '媒体转述' },
    ],
  },
];

/** 引用格式：学术文本最硬的形式特征，单独算，因为它几乎不出现在口语里。 */
const CITATION_RES = [
  /（[^（）]{1,18}\d{4}[a-z]?）|\（[^（）]{1,18}\d{4}[a-z]?）/g,
  /\([A-Z][A-Za-z.\-\s&]{1,18}\d{4}[a-z]?\)/g,
  /\[\d{1,3}(?:\s*[-,–]\s*\d{1,3})*\]/g,
  /［\d{1,3}(?:\s*[-,–]\s*\d{1,3})*］/g,
];

function countCitation(passage: string): number {
  let n = 0;
  for (const re of CITATION_RES) {
    const m = passage.match(re);
    if (m) n += m.length;
  }
  return n;
}

export interface GenreResult {
  genre: Genre;
  label: string;
  /** 凭什么这么认。列命中的特征，不列没命中的。 */
  basis: string;
  /** 这一类体裁下，本工具的输出该怎么打折看 */
  caveat: string;
  /** 认出几类分数相同、按更具体的一类记——这种含糊要写出来 */
  tie: string | null;
}

const GENRE_CAVEAT: Record<Genre, string> = {
  paper:
    '研究论文多数是探究型对话：参与者在共同求解，不是一方要说服另一方。靠「对手方」才成立的规则（语用辩证里那几条）在这类文本上大半无从违反，报告里会出现语境缺口——那是体裁的实情，不是文本的毛病。受众按专业算，可接受性门槛相应抬高。',
  review:
    '综述的论证义务不在「引用对不对」，而在「筛选标准说没说清」：为什么收这些不收那些、按什么标准判优劣。单篇引用是否忠实，综述本身给不了答案。',
  monograph:
    '章节的结论常依赖全书的其余部分。单独抽一章出来，前提会显得不足——这不是论证弱，是抽样的边界。要看它在全书里的位置，得读整本。',
  commentary:
    '书评的举证责任在评者手上：说「这本书错了」，需要给出比作者更强的理由，否则只是另一种意见。评者的立场通常也不必交代，这让它的可辩性低于论文。',
  policy:
    '政策报告的缺口通常不在事实层，而在两处：可行性前提（这个方案做得到吗、成本谁承担）与价值排序（凭什么这个目标优先）。这两处它往往默认过去了。',
  popular:
    '媒体转述多经二手：研究结论被简化、限定条件被删掉、样本规模被略去。要判断它说得对不对，得回到被转述的那份研究，而本工具只看得到转述。',
  unknown:
    '认不出体裁，就不按任何体裁的规范去套。这一栏留空比套错一套规范好：体裁决定举证责任落在谁身上，套错等于让该举证的人免责。',
};

export function genreOf(passage: string): GenreResult {
  const cites = countCitation(passage);
  const scored: { genre: Genre; labels: string[]; score: number }[] = [];

  for (const { genre, cues } of GENRE_CUES) {
    const labels: string[] = [];
    for (const c of cues) {
      // 带 g 的正则 test 有 lastIndex 残留，这里统一用 match 判存在
      if (passage.match(new RegExp(c.re.source, c.re.flags.replace('g', '')))) {
        labels.push(c.label);
      }
    }
    scored.push({ genre, labels, score: labels.length });
  }

  // 引用格式是跨体裁的硬特征：命中数 ≥3 时，把 paper 与 review 的分抬起来，
  // 因为口语文本几乎不会出现成串的规范引用。
  if (cites >= 3) {
    for (const s of scored) {
      if (s.genre === 'paper' || s.genre === 'review') {
        s.labels.push(`有 ${cites} 处引用格式`);
        s.score += 1;
      }
    }
  }

  const best = scored.reduce((a, b) => (b.score > a.score ? b : a), scored[0]);
  if (best.score === 0) {
    return {
      genre: 'unknown',
      label: GENRE_LABEL.unknown,
      basis: `原文里没有可识别的体裁特征（无摘要与关键词、无章节标记、无书评标志、无引用格式）。引用格式命中 ${cites} 处。`,
      caveat: GENRE_CAVEAT.unknown,
      tie: null,
    };
  }

  const sameScore = scored.filter((s) => s.score === best.score && s.genre !== best.genre);
  const tie = sameScore.length
    ? `与「${sameScore.map((s) => GENRE_LABEL[s.genre]).join('、')}」的特征数相同（各 ${best.score} 项），按更具体的一类记。`
    : null;

  return {
    genre: best.genre,
    label: GENRE_LABEL[best.genre],
    basis: `命中 ${best.labels.join('、')}${cites ? `；引用格式 ${cites} 处` : ''}。按字面特征判，是启发式，不是体裁鉴定。`,
    caveat: GENRE_CAVEAT[best.genre],
    tie,
  };
}

/* ───────────────── 二 · 待你回原文核 ───────────────── */

export type TraceKind =
  | 'citation-year'
  | 'citation-number'
  | 'secondhand'
  | 'statistic'
  | 'sample'
  | 'authority';

export const TRACE_LABEL: Record<TraceKind, string> = {
  'citation-year': '作者—年份引用',
  'citation-number': '编号引用',
  secondhand: '转引',
  statistic: '百分比与统计量',
  sample: '样本量',
  authority: '研究转述',
};

const TRACE_RULES: { kind: TraceKind; re: RegExp; ask: string }[] = [
  {
    kind: 'citation-year',
    re: /（[^（）]{1,18}\d{4}[a-z]?）|\（[^（）]{1,18}\d{4}[a-z]?）|\([A-Z][A-Za-z.\-\s&]{1,18}\d{4}[a-z]?\)/g,
    ask: '这条引用的原文真的说了这个意思吗？作者、年份、页码对不对？',
  },
  {
    kind: 'citation-number',
    re: /\[\d{1,3}(?:\s*[-,–]\s*\d{1,3})*\]|［\d{1,3}(?:\s*[-,–]\s*\d{1,3})*］/g,
    ask: '编号指向的那篇文献是否支持这句话？编号错位是引用的常见故障。',
  },
  {
    kind: 'secondhand',
    re: /转引自|转引|引自|参见|详见|cited\s+in|as\s+cited\s+in/gi,
    ask: '读的是原文还是转述？二手转述在这一步最容易变形。',
  },
  {
    kind: 'statistic',
    /*
     * 中文的统计表述不止百分号：「下降 6 个百分点」「翻了一倍」「三成」都不带 %。
     * 第一版只认 % 与「百分之」，真实文本里立刻漏掉「下降了 6 个百分点」——
     * 那句正是社论里唯一的量化依据，漏了就等于替它免了核查。
     */
    re: /\d+(?:\.\d+)?\s*[%％]|百分之[一二三四五六七八九十百千万零\d]+|\d+(?:\.\d+)?\s*个?百分点|[一二三四五六七八九十百千\d]+(?:\.\d+)?\s*倍|[一二三四五六七八九]成/g,
    ask: '这个数字出自哪份数据？口径、时间范围、分母分别是什么？',
  },
  {
    kind: 'sample',
    re: /[nN]\s*=\s*\d+|样本(?:量|数)?\s*(?:为|是|达到)?\s*\d+|共\s*\d+\s*(?:人|份|例|个)/g,
    ask: '样本怎么来的、多大、能代表谁？',
  },
  {
    kind: 'authority',
    re: /研究表明|研究显示|研究发现|调查显示|数据显示|统计显示|实验(?:表明|证明)|据.{0,8}报道|专家(?:表示|指出|认为|称)|学者(?:认为|指出)/g,
    ask: '哪项研究？能查到原文吗？结论在转述里有没有被加强？',
  },
];

export interface TraceItem {
  kind: TraceKind;
  label: string;
  /** 原文片段，前后各留一点上下文 */
  snippet: string;
  ask: string;
}

const MAX_TRACES = 14;

function snippetAround(passage: string, at: number, len: number): string {
  const start = Math.max(0, at - 22);
  const end = Math.min(passage.length, at + len + 22);
  const head = start > 0 ? '…' : '';
  const tail = end < passage.length ? '…' : '';
  return head + passage.slice(start, end).replace(/\s+/g, ' ').trim() + tail;
}

/**
 * 抽出「需要回原文核」的位置。
 *
 * 这是这个工具在学术场景里最该做、也最容易做到的一件事：
 * 它核不了，但它能把你必须自己核的地方**指出来**——
 * 而学术写作里最贵的错误，恰恰是拿一个记错的引用当论据用了三年。
 */
export function tracesOf(passage: string): TraceItem[] {
  const raw: { item: TraceItem; at: number }[] = [];
  const seen = new Set<string>();

  for (const rule of TRACE_RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(passage)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      const key = rule.kind + '\u0000' + m[0];
      if (seen.has(key)) continue;
      seen.add(key);
      raw.push({
        at: m.index,
        item: {
          kind: rule.kind,
          label: TRACE_LABEL[rule.kind],
          snippet: snippetAround(passage, m.index, m[0].length),
          ask: rule.ask,
        },
      });
      if (raw.length >= MAX_TRACES * 3) break;
    }
  }

  /*
   * 按原文位置排，不按类型分组。
   * 分组排过一次，结果是三条「研究转述」挤在一起、片段各不相同，
   * 看上去像重复项——读者会以为抽取出错了。照原文顺序走，
   * 这一栏读起来就是「读到哪儿该停下来核一下」，那才是它的用法。
   */
  raw.sort((a, b) => a.at - b.at);
  return raw.slice(0, MAX_TRACES).map((r) => r.item);
}

/* ───────────────── 三 · 学术规范清单 ───────────────── */

/** 本工具能不能代劳。yes＝能，partial＝代劳一半，no＝完全不能。 */
export type ByTool = 'yes' | 'partial' | 'no';

export const BY_TOOL_LABEL: Record<ByTool, string> = {
  yes: '本工具会查',
  partial: '只查一半',
  no: '本工具查不了',
};

export interface NormItem {
  id: string;
  /** 要查什么 */
  ask: string;
  /** 为什么这条要紧 */
  why: string;
  byTool: ByTool;
  /** 依据的理论主张；空数组表示这是程序性检查，不挂文献 */
  claimIds: string[];
  /** 本次分析里已经覆盖到它的地方；null 表示没覆盖 */
  covered: string | null;
}

/** 从检查表里找一条与关键词相关的，作为「本次已覆盖」的证据。 */
function coveredBy(d: Diagnosis, kws: string[]): string | null {
  const hit = d.checks.find((c) => kws.some((k) => c.question.includes(k) || c.label.includes(k)));
  return hit ? `${hit.id} ${hit.label}` : null;
}

const NORM_DEFS: {
  id: string;
  ask: string;
  why: string;
  byTool: ByTool;
  claimIds: string[];
  kws: string[];
}[] = [
  {
    id: 'cite-fidelity',
    ask: '每一处引用，作者原话是不是这个意思？',
    why: '专家型式的默认条件里有一条是「引用真实」。这一条不成立时，型式的担保就换了来源——而换过的担保通常撑不住原来的结论。这是本工具唯一完全无法代劳的几件事之一：它看不到你引的那篇。',
    byTool: 'no',
    claimIds: ['T3-10'],
    kws: ['引用', '权威', '来源', '专家'],
  },
  {
    id: 'data-trace',
    ask: '每个数字，能不能追到原始数据？口径与分母是什么？',
    why: '数字一旦脱离口径就没有真假可言。同一组数据换个分母可以得出相反结论，而两个版本看上去都像「数据显示」。',
    byTool: 'no',
    claimIds: ['T3-15'],
    kws: ['数据', '统计', '数字', '样本'],
  },
  {
    id: 'method-fit',
    ask: '这个方法能回答这个问题吗？结论有没有超出方法的射程？',
    why: '方法选错时，后面的论证可以完全自洽，只是答的不是那个问题。本工具只问样本代表性与替代解释，不问实验设计、统计方法与效度——这是它的射程外。',
    byTool: 'no',
    claimIds: ['T2-06', 'T9-12'],
    kws: ['方法', '样本', '代表'],
  },
  {
    id: 'term-drift',
    ask: '核心术语在前提与结论里是同一个意思吗？',
    why: '含混有三种，只有「一词多义」会在前提与结论之间断掉担保；模糊与笼统不必然断。所以这一条本工具只代劳一半：它能标出可疑处，判不了是不是真的换了义。',
    byTool: 'partial',
    claimIds: ['T5-09'],
    kws: ['定义', '含混', '歧义', '术语', '概念'],
  },
  {
    id: 'corr-causal',
    ask: '相关之外，第三变量、方向反转、巧合排除掉了吗？',
    why: '三种情形能造出一模一样的相关。型式本身不保证因果，它只把排除替代解释的举证责任交给提出者。',
    byTool: 'partial',
    claimIds: ['T3-15', 'T3-08'],
    kws: ['因果', '相关', '替代', '原因'],
  },
  {
    id: 'burden',
    ask: '提出主张的一方，把举证责任推给对方了吗？',
    why: '责任可以转移，但不会消失。常见动作是把它推给「反例还没被解释」——那不是论证，那是催对方干活。',
    byTool: 'partial',
    claimIds: ['T2-07'],
    kws: ['举证', '责任', '前提'],
  },
  {
    id: 'is-ought',
    ask: '从「是这样」走到「应当这样」，中间那个价值前提写出来了吗？',
    why: '事实推不出价值。缺口不补，结论就是悬空的；补了但没写出来，读者就无从检验。',
    byTool: 'partial',
    claimIds: ['T9-09'],
    kws: ['应当', '应该', '价值', '规范', '政策'],
  },
  {
    id: 'exception',
    ask: '作者举了几种例外情形？他自己处理了吗？',
    why: '把一个极个别的情形推及全体，是以偏概全；把「没有例外」当成默认，是绝对化。这一条的做法是先自己列例外，再看对方有没有处理——列不出例外，往往说明还没想清适用条件。',
    byTool: 'partial',
    claimIds: ['T2-06', 'T8-09'],
    kws: ['例外', '特殊', '绝对', '范围'],
  },
];

export function normsOf(d: Diagnosis): NormItem[] {
  return NORM_DEFS.map((n) => ({
    id: n.id,
    ask: n.ask,
    why: n.why,
    byTool: n.byTool,
    claimIds: n.claimIds,
    covered: coveredBy(d, n.kws),
  }));
}

/* ───────────────── 四 · 反驳顺序 ───────────────── */

export type AttackTierId = 'warrant' | 'backing' | 'ground' | 'claim';

export interface AttackTier {
  tier: AttackTierId;
  label: string;
  /** 这一层在本次分析里具体指到什么 */
  target: string;
  /** 为什么可辩／不可辩 */
  why: string;
  /**
   * 可辩度。只有两档，不是三档：
   * 原先写了「中」这一档，但没有任何一处产出它——留一个永不出现的取值，
   * 等于给样式表留一个永远不会被验证的分支。要加第三档，先让它出现。
   */
  contested: 'high' | 'low';
}

/**
 * 反驳顺序。
 *
 * 这一栏的做法借自一个具体的分析传统（B 站「逻辑套圈」系列的拆解顺序）：
 * **不从主张与事实层先反驳，从推理规则层开始**。理由它讲得很清楚——
 * 任何人都可以有主张，每个人也都有自己观察到的社会现实，
 * 这两层争起来只是两种看法的对撞；而推理规则是「从事实走到结论的那座桥」，
 * 桥一断，结论就落不下来，而这一步是可以指出具体错在哪的。
 *
 * 本项目不完全采纳那个传统（它做话语功能与意识形态分析，本项目明令不评动机），
 * 但这个顺序纪律与本项目的三标准结构相容：前提、担保、结论各自独立打分，
 * 谁也不替谁打分。所以这里只借顺序，不借立场。
 */
export function attackOrder(d: Diagnosis): AttackTier[] {
  const lens = d.lens;
  const warrant =
    lens.kind === 'toulmin'
      ? (lens.warrant ?? '本次未抽出担保')
      : lens.kind === 'walton'
        ? `${lens.schemeName}（型式默认的担保）`
        : '本次透镜不单列担保';

  const ground =
    d.premises.length > 0
      ? `${d.premises[0].id}「${d.premises[0].text.slice(0, 40)}${d.premises[0].text.length > 40 ? '…' : ''}」`
      : '本次没有抽出独立前提';

  const out: AttackTier[] = [
    {
      tier: 'warrant',
      label: '推理规则（从事实到结论的那座桥）',
      target: warrant,
      why: '这一层最值得先攻：它默认了什么、这个默认在本次语境里成不成立，都能指到具体位置。桥断了，结论就落不下来，而事实可以全是真的。',
      contested: 'high',
    },
    {
      tier: 'backing',
      label: '底层信念（支撑那座桥的更深假定）',
      target:
        lens.kind === 'toulmin' && lens.backing
          ? lens.backing
          : '本次未单列底层信念；它通常藏在担保的措辞里',
      why: '可辩，但辩起来容易变成立场对撞——这一层往往是价值观，不是事实。要攻它，得先把它从担保里拆出来说清，否则对方会觉得你在攻击他的为人。',
      contested: 'high',
    },
    {
      tier: 'ground',
      label: '事实（对方观察到的那些情况）',
      target: ground,
      why: '可辩度低：对方观察到的情况可以全是真的，而结论仍然错——错在桥，不在事实。先攻事实常常白费力气，还容易滑成「你数据不对」的口水战。',
      contested: 'low',
    },
    {
      tier: 'claim',
      label: '主张（对方的核心结论）',
      target: `「${d.conclusion.text.slice(0, 44)}${d.conclusion.text.length > 44 ? '…' : ''}」`,
      why: '可辩度最低：任何人都可以有主张，直接否定主张只是另一种主张。除非能指出它与桥的关系，否则这一步不产生说服力。',
      contested: 'low',
    },
  ];
  return out;
}

/* ───────────────── 五 · 组装 ───────────────── */

export interface AcademicView {
  genre: GenreResult;
  traces: TraceItem[];
  /** 抽取的诚实说明：抽了多少、抽不到时说什么 */
  traceNote: string;
  norms: NormItem[];
  attack: AttackTier[];
  /** 一句话总结：这个工具在学术场景里代劳了什么、没代劳什么 */
  division: string;
}

export function academicOf(d: Diagnosis): AcademicView {
  const genre = genreOf(d.passage);
  const traces = tracesOf(d.passage);
  const norms = normsOf(d);

  const noCount = norms.filter((n) => n.byTool === 'no').length;
  const partialCount = norms.filter((n) => n.byTool === 'partial').length;

  const traceNote = traces.length
    ? `按字面特征抽出 ${traces.length} 处需要回原文核的位置。这是正则匹配，可能误报也必然漏报——它指方向，不替代核对。`
    : '这一段里没抽出可识别的引用、数据或研究转述。注意：抽不到不等于没有，只等于这套正则没认出。带引号的长句、改写过的人名、口语化的「有研究说」都可能漏掉。';

  return {
    genre,
    traces,
    traceNote,
    norms,
    attack: attackOrder(d),
    division: `八条学术规范里，本工具完全代劳 ${norms.length - noCount - partialCount} 条、代劳一半 ${partialCount} 条、完全不能代劳 ${noCount} 条。做不到的那几条不是遗漏，是射程：引用是否忠实、数据是否真实、方法是否恰当，都需要看到原文与数据集，而它只看得到你贴进来的这段字。`,
  };
}
