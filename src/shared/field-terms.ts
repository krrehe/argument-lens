/**
 * 圈内词：把「这个学术圈自己的词」接进本地复算。
 *
 * 为什么词表必须由人给：先量过 40 段评测语料——15 段学术/准学术体裁里，
 * 命中显式定义词的是 **0 段**（全语料也只 1 段，是网络科普）；
 * 引号里 2–14 字的词共 32 个，跨 ≥2 句出现的只有 3 个，学术体裁里只有 1 个。
 * 也就是说：让本地去「自动认出术语」或「自动判断有没有定义过」，
 * 在真实感的文本上就是一块空面板。哪个词是术语，只有在这个圈里的人才知道。
 *
 * 所以这一层只做**逐字确定性的事**，不依赖原文提供任何可识别的信号：
 *   1. 你填的词，在原文里出现几次、落在哪几句、第一次出现在哪个字；
 *   2. 它在报告的结论文字 / 前提文字里有没有出现（这两者**不是原文**，模型可能改写过）；
 *   3. 它出现的句子，是不是全都没被任何报告条目落点钉住（复用「骨架缺口」的 quiet 句）；
 *   4. 哪些词在原文里一次都没出现。
 *
 * 四条硬边界：
 *   - **不判换义。** 上面第 3 条只摆位置，不说「报告漏了」「这里换了意思」——
 *     那是读的人自己下的判断，不是本地能写的字。
 *   - **不换标准。** 不按学科切换任何检查项、档位或举证责任；软件仍然只有一把尺子。
 *     词表是输入，不是一套学科规范。
 *   - **不调模型、不编词表、不落盘。** 词表只活在这一屏，刷新即清。
 *   - **不做同义 / 分词 / 词形归一。** 只认字面；互相包含的两个词各算各的，并在边界里写明。
 *
 * 与 `@shared/reread` 的切句、与 `@shared/skeleton` 的 quiet 句都由**调用方**传进来，
 * 这个模块不 import 任何项目模块——它是纯字面函数，断言可以直接喂构造数据。
 */

export interface FieldSentence {
  start: number;
  end: number;
  text: string;
  index: number;
}

export interface FieldTermInput {
  passage: string;
  words: string[];
  /** 报告结论文字（不是原文；可能已被改写） */
  conclusion: string;
  /** 报告前提文字（同上） */
  premises: string[];
  /** sentenceBounds(passage) 的结果 */
  sentences: FieldSentence[];
  /** 骨架缺口里「没有任何条目落点」的句子 index */
  quietSentences: number[];
}

export interface FieldTermRow {
  word: string;
  /** 原文里逐字出现的次数 */
  count: number;
  /** 第一次出现的字符下标；没出现为 -1 */
  firstAt: number;
  /** 落在哪几句（句子 index） */
  sentences: number[];
  inConclusion: boolean;
  inPremises: boolean;
  /** 只在报告结论文字里出现，前提文字里没有 */
  onlyInConclusion: boolean;
  /** 原文里出现了，且所在的句子全都没被任何报告条目落点钉住 */
  onQuietOnly: boolean;
  /** 逐字事实，不写判断 */
  facts: string[];
}

export type FieldTermState = 'empty' | 'none-hit' | 'ok';

export interface FieldTermView {
  rows: FieldTermRow[];
  /** 词表里在原文一次都没出现的 */
  missing: string[];
  state: FieldTermState;
  note: string;
}

/** 抬头、边界、分隔说明只有这一份，界面不许另写一套（同来源账的规矩）。 */
export const FIELD_TERMS_TITLE = '这一圈的词';
export const FIELD_TERMS_PLAIN =
  '哪个词是术语，只有在这个圈里的人才知道。填几个，本地按字面把它们摆到原文与报告里；' +
  '不替你认词，也不替你判它有没有换义。';
export const FIELD_TERMS_SPLIT = '一行一个，或用逗号、顿号、空格分开。';
export const FIELD_TERMS_CAVEAT =
  '本地只认字面：不做同义、不分词、不认词形变化，也不判术语有没有换义；词表里互相包含的两个词各算各的。' +
  '原文与报告文字分开数——报告里的结论与前提可能已被模型改写过，那一列看的是报告的字，不是原文的字。' +
  '「只在结论文字里出现」和「出现的句子没有条目落点」都只是位置事实，不是判定。' +
  '词表只活在这一屏，刷新即清，不存盘。';

/**
 * 把输入框里的字切成词表。
 * 保留输入顺序、去重、去掉空项；不改写任何一个词（大小写、空格、标点都按字面）。
 */
export function parseWords(raw: string): string[] {
  const parts = raw.split(/[\n\r,，、;；\t ]+/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const w = p.trim();
    if (!w || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

/** 逐字数出现次数与位置。indexOf 前进一个词长，重叠匹配各算一次。 */
function occurrences(passage: string, word: string): number[] {
  const out: number[] = [];
  let at = passage.indexOf(word);
  while (at !== -1) {
    out.push(at);
    at = passage.indexOf(word, at + Math.max(1, word.length));
  }
  return out;
}

function sentenceOf(sentences: FieldSentence[], at: number): number {
  for (const s of sentences) {
    if (at >= s.start && at < s.end) return s.index;
  }
  // 切句没覆盖到的尾部字符：归到最后一句，不静默丢掉
  return sentences.length ? sentences[sentences.length - 1].index : -1;
}

function listSentences(ids: number[]): string {
  if (!ids.length) return '';
  return ids.map((i) => `第 ${i + 1} 句`).join('、');
}

export function fieldTermsOf(input: FieldTermInput): FieldTermView {
  const { passage, words, conclusion, premises, sentences, quietSentences } = input;
  if (words.length === 0) {
    return {
      rows: [],
      missing: [],
      state: 'empty',
      note: '你还没填词。这一栏不替你猜哪些是术语——填了才算。',
    };
  }

  const rows: FieldTermRow[] = words.map((word) => {
    const ats = occurrences(passage, word);
    const ids = [...new Set(ats.map((a) => sentenceOf(sentences, a)))].filter((i) => i >= 0).sort((a, b) => a - b);
    const inConclusion = conclusion.includes(word);
    const inPremises = premises.some((p) => p.includes(word));
    const onlyInConclusion = inConclusion && !inPremises;
    const onQuietOnly =
      ats.length > 0 && ids.length > 0 && ids.every((i) => quietSentences.includes(i));

    const facts: string[] = [];
    if (ats.length === 0) {
      facts.push('原文里一次都没出现这个词。');
    } else {
      facts.push(`原文出现 ${ats.length} 次，落在${listSentences(ids)}。`);
    }
    facts.push(inConclusion ? '报告结论文字里有这个词。' : '报告结论文字里没有这个词。');
    facts.push(inPremises ? '报告前提文字里有这个词。' : '报告前提文字里没有这个词。');
    if (onlyInConclusion) facts.push('它只在报告结论文字里出现，前提文字里没有。');
    if (onQuietOnly) facts.push('它出现的句子都没有被任何报告条目落点钉住。');

    return {
      word,
      count: ats.length,
      firstAt: ats.length ? ats[0] : -1,
      sentences: ids,
      inConclusion,
      inPremises,
      onlyInConclusion,
      onQuietOnly,
      facts,
    };
  });

  const missing = rows.filter((r) => r.count === 0).map((r) => r.word);
  const hit = rows.length - missing.length;
  if (hit === 0) {
    return {
      rows,
      missing,
      state: 'none-hit',
      note: `你填的 ${rows.length} 个词，原文里一个都没出现。这不等于是不是术语出了问题，只说明按字面没找到。`,
    };
  }

  const onlyC = rows.filter((r) => r.onlyInConclusion).length;
  const quiet = rows.filter((r) => r.onQuietOnly).length;
  return {
    rows,
    missing,
    state: 'ok',
    note:
      `${rows.length} 个词，${hit} 个在原文里出现，${missing.length} 个一次没出现；` +
      `${onlyC} 个只在报告结论文字里出现，${quiet} 个只落在没有条目落点的句子里。`,
  };
}
