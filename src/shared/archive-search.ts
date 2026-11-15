import type { ArchiveFindHit, Diagnosis, SearchWhere } from './types';

/**
 * 存档检索。
 *
 * 为什么要有它：本机存档已经一百多份，而历史面板只有一个滚动条。用户记得的是
 * 「预算」这个词，不是它出现在第几屏；而列表里的摘要只留原文开头 72 字——
 * 按摘要找，等于只允许他找每份报告的第一句。
 *
 * 三条边界写在代码里，因为它们都会被误读成「搜不到就是没有」：
 *   1. **按字面找**：不认同义词、不认拼音、不做词形还原。搜「晨读」找不到「早读」。
 *      要做同义词就得有一份词表，而词表由谁定、定到哪一层，是这个工具无权替用户决定的事。
 *   2. **多词是「都要有」**（AND），每个词可以落在不同字段：「预算 前提」= 既提到预算、
 *      又在前提出处提到过它。
 *   3. **只搜七类文字**（见 `WHERE_ORDER`）。模型写的其余部分（自检、诊断、命名候选、
 *      反驳）不进搜索——不是那些不重要，是本地没有稳定取法，混进来会让「命中」说不清。
 *
 * 排序不在这里做：一份报告只出一条结果，先后由主进程按时间排。相关度本地算不出来，
 * 按它排等于凭空造一个「这份更像你要找的」——那是判断，不是检索。
 */

/** 命中落在哪一类文字上，说给用户听的名字。 */
export const WHERE_LABEL: Record<SearchWhere, string> = {
  passage: '原文',
  conclusion: '结论',
  premise: '前提',
  intermediate: '中间结论',
  repair: '修补',
  check: '检查依据',
  verdict: '判读',
};

/**
 * 固定顺序。两处用它，所以不能是「发现顺序」：
 *   · 片段取哪一处——原文优先，人在列表里先认出的应该是自己的字；
 *   · 界面上「命中在哪儿」怎么排——同一份报告两次搜同一个词，顺序必须一样。
 */
const WHERE_ORDER: SearchWhere[] = [
  'passage',
  'conclusion',
  'premise',
  'intermediate',
  'repair',
  'check',
  'verdict',
];

/** 片段里命中处前后各留几个字。前面留得少，是因为开头那半句通常已经在摘要里见过。 */
const SNIPPET_HEAD = 16;
const SNIPPET_TAIL = 26;

/**
 * 把用户敲的字切成词。
 *
 * 空白（含全角空格）分隔，折成小写，去重。**不设上限**：悄悄丢掉第 9 个词，
 * 与「这个词没搜到」在界面上长得一模一样。
 */
export function parseTerms(raw: string): string[] {
  const out: string[] = [];
  for (const piece of String(raw ?? '').toLowerCase().split(/[\s\u3000]+/)) {
    if (!piece) continue;
    if (!out.includes(piece)) out.push(piece);
  }
  return out;
}

/** 正则里的元字符要挡掉：用户搜「(1)」不该被当成分组。 */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 连续空白折成一个空格。
 *
 * 报告的正文里有换行与缩进，照原样取片段会在列表里撑出七八行。
 * 只动空白，字一个不改——所以片段仍然是「逐字来自报告」，
 * 前提是这句话得写在界面上（见 History 的检索说明）。
 */
function flatten(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * 从 `at` 处取一小段上下文。
 * 两端遇到代理对（emoji 之类）就各让一步，别把一个字切成两个半字符——
 * 显示出来是一个方框，读的人只会以为文件坏了。
 */
function windowOf(text: string, at: number, len: number): string {
  let s = Math.max(0, at - SNIPPET_HEAD);
  let e = Math.min(text.length, at + len + SNIPPET_TAIL);
  const low = (i: number): boolean => {
    const c = text.charCodeAt(i);
    return c >= 0xdc00 && c <= 0xdfff;
  };
  if (s > 0 && low(s)) s -= 1;
  if (e < text.length && low(e)) e += 1;
  return `${s > 0 ? '…' : ''}${text.slice(s, e)}${e < text.length ? '…' : ''}`;
}

/** 一段文字里有几处、第一处在哪。不重叠计数。 */
function occurrences(text: string, term: string): { count: number; first: number } {
  if (!text || !term) return { count: 0, first: -1 };
  const re = new RegExp(escapeRe(term), 'gi');
  let count = 0;
  let first = -1;
  for (const m of text.matchAll(re)) {
    if (first < 0) first = m.index ?? 0;
    count += 1;
  }
  return { count, first };
}

/**
 * 一份报告里能搜的地方。
 *
 * 每一项都给一组字符串：前提有好多条、检查项也有好多条，混成一个拼接串会让
 * 「命中」跨过两条前提的接缝（前一条的尾巴 + 后一条的头，读起来像一句真话）。
 */
function fieldsOf(d: Diagnosis): { where: SearchWhere; texts: string[] }[] {
  /* 老存档可能缺字段（`reportShapeIssue` 只要求 passage / verdict / checks），
     所以这里一律兜底成空串，不假定结构齐全。 */
  return [
    { where: 'passage', texts: [d.passage ?? ''] },
    { where: 'conclusion', texts: [d.conclusion?.text ?? ''] },
    { where: 'premise', texts: (d.premises ?? []).map((p) => p.text ?? '') },
    { where: 'intermediate', texts: (d.intermediate ?? []).map((p) => p.text ?? '') },
    {
      where: 'repair',
      texts: [d.repair?.missingPremise ?? '', d.repair?.repairedForm ?? ''],
    },
    { where: 'check', texts: (d.checks ?? []).map((c) => c.basis ?? '') },
    {
      where: 'verdict',
      texts: [d.verdict?.statement ?? '', d.verdict?.qualification ?? ''],
    },
  ];
}

/**
 * 在一份报告里找这些词。全部命中才算命中（AND），否则返回 null。
 *
 * 返回的片段是**第一处**命中（按 WHERE_ORDER 与词序），`count` 是全部命中的处数。
 * 这两件事分开放：列表里只放得下一段话，但「只出现一次」与「出现九次」
 * 是完全不同的线索，得让人看得见。
 */
export function findInReport(d: Diagnosis, terms: string[]): ArchiveFindHit | null {
  if (!terms.length) return null;
  const fields = fieldsOf(d).map((f) => ({ where: f.where, texts: f.texts.map(flatten) }));

  let count = 0;
  const seen = new Set<SearchWhere>();
  let snippet = '';
  let snippetWhere: SearchWhere = 'passage';

  for (const term of terms) {
    let hitOne = false;
    for (const f of fields) {
      for (const t of f.texts) {
        const r = occurrences(t, term);
        if (!r.count) continue;
        hitOne = true;
        count += r.count;
        seen.add(f.where);
        if (!snippet) {
          snippet = windowOf(t, r.first, term.length);
          snippetWhere = f.where;
        }
      }
    }
    /* 有一个词哪儿都没有，这一份就不算命中。第一处已取到的片段丢掉即可，
       不用回滚计数：直接返回 null，外面拿不到它。 */
    if (!hitOne) return null;
  }

  return {
    id: d.id,
    at: d.createdAt,
    count,
    where: WHERE_ORDER.filter((w) => seen.has(w)),
    snippet,
    snippetWhere,
  };
}

/**
 * 把片段切成「命中 / 不是命中」的几截，给界面加亮用。
 *
 * 为什么不在片段里带下标：片段前面可能加了省略号、空白又被折过，
 * 下标每经过一层格式化就要重算一次——那是三个地方各算一遍、迟早对不上的那种设计。
 * 这里直接按词重新切，切错了最多是加亮位置偏一格，不会指到别的字上。
 */
export function highlightParts(text: string, terms: string[]): { t: string; hit: boolean }[] {
  const list = terms.filter(Boolean);
  if (!list.length || !text) return [{ t: text, hit: false }];
  /* 长的先试：「早读」与「早」同时出现时，别只加亮一个字。 */
  const alts = list
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join('|');
  const re = new RegExp(`(${alts})`, 'gi');
  const out: { t: string; hit: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ t: text.slice(last, i), hit: false });
    out.push({ t: m[0], hit: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last), hit: false });
  return out;
}
