import type { Span } from '@shared/types';

/** 全角转半角，统一引号与空白。返回归一化文本与「归一化下标 → 原文下标」映射。 */
function normalizeWithMap(src: string): { text: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < src.length; i++) {
    let ch = src[i];
    const code = ch.charCodeAt(0);
    // 全角 ASCII 区
    if (code >= 0xff01 && code <= 0xff5e) {
      ch = String.fromCharCode(code - 0xfee0);
    }
    if (ch === '\u3000') ch = ' ';
    if (ch === '\u201c' || ch === '\u201d' || ch === '\u300c' || ch === '\u300d' || ch === '\u300e' || ch === '\u300f') {
      ch = '"';
    }
    if (ch === '\u2018' || ch === '\u2019') ch = "'";
    if (ch === '\u2014' || ch === '\u2013') ch = '-';
    if (ch === '\u2026') ch = '~';
    if (/\s/.test(ch)) continue; // 归一化时丢弃空白
    out.push(ch);
    map.push(i);
  }
  return { text: out.join(''), map };
}

function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let inter = 0;
  for (const [g, n] of ga) inter += Math.min(n, gb.get(g) ?? 0);
  const total = Math.max(0, a.length - 1) + Math.max(0, b.length - 1);
  return total === 0 ? 0 : (2 * inter) / total;
}

/**
 * 三级定位。模型给的偏移量一律不信任，只用它给的 quote 反查原文。
 * 定位失败必须如实标记 failed —— 这是防止「凭空指控」的第一道闸门。
 */
export function locate(passage: string, quote: string | null | undefined): Span | null {
  if (!quote || !quote.trim()) return null;

  // L0：精确匹配
  const i0 = passage.indexOf(quote);
  if (i0 !== -1) {
    return { start: i0, end: i0 + quote.length, quote, quality: 'exact' };
  }

  // L1：归一化后匹配
  const { text: norm, map } = normalizeWithMap(passage);
  const { text: nq } = normalizeWithMap(quote);
  if (nq.length >= 4) {
    const i1 = norm.indexOf(nq);
    if (i1 !== -1) {
      const start = map[i1];
      const end = map[i1 + nq.length - 1] + 1;
      return { start, end, quote: passage.slice(start, end), quality: 'normalized' };
    }
  }

  // L2：句窗模糊匹配
  const sentences = splitSentences(passage);
  let best = { score: 0, start: -1, end: -1 };
  for (const s of sentences) {
    const score = dice(s.text, quote);
    if (score > best.score) best = { score, start: s.start, end: s.end };
  }
  if (best.score >= 0.82 && best.start !== -1) {
    return { start: best.start, end: best.end, quote: passage.slice(best.start, best.end), quality: 'fuzzy' };
  }

  // L3：用较长锚点直接定位
  const anchor = quote.replace(/\s/g, '').slice(0, 10);
  if (anchor.length >= 8) {
    const i3 = passage.indexOf(anchor);
    if (i3 !== -1) {
      return {
        start: i3,
        end: Math.min(passage.length, i3 + quote.length),
        quote: passage.slice(i3, Math.min(passage.length, i3 + quote.length)),
        quality: 'fuzzy',
      };
    }
  }

  return { start: -1, end: -1, quote, quality: 'failed' };
}

export function splitSentences(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  const re = /[^。！？；\n!?;\r]+[。！？；!?;\n\r]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0];
    if (raw.trim().length < 2) continue;
    out.push({ text: raw.trim(), start: m.index, end: m.index + raw.length });
  }
  return out;
}
