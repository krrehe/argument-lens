import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { THEORY_CLAIMS } from '@shared/theory-base';
import { PROMPT_BLOCKS } from '../src/main/prompt/blocks';
import { LENS_MODULES } from '../src/main/prompt/registry';

/**
 * 落点体检（一次性工具，不接 npm scripts）。
 *
 * 想回答的问题只有一个：96 条主张里，有多少条能在提示词或源码里**指出一句对应的话**，
 * 有多少条其实只在文档里。
 *
 * 为什么要问：07 文档把 70 条标成「行为层」。那个词把两种完全不同的情况混在一起——
 * 真的有提示词指令（只是没有字段），和根本没有落点（只有库里那一行字）。
 * 混着的后果是：一批「装饰性条目」藏在「行为层」这个听起来中性的词下面。
 *
 * 这不是判据，是线索。bigram 重叠只能提示「这条大概落在哪一块」，
 * 相似度高不代表真有对应指令（可能是同一个词反复出现），低也不代表没有（可能换了说法）。
 * 所以它只用来排优先级，最终要人逐条读。
 */

/** 去掉标点与空白，按相邻两字切。中文短文本比对用这个，比词切分稳。 */
const bigrams = (s: string): Set<string> => {
  const t = s.replace(/[\s，。、；：「」『』（）()《》【】—…·“”"'`!？?,.!;:/\\-]+/g, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i += 1) out.add(t.slice(i, i + 2));
  return out;
};

const overlap = (a: Set<string>, b: Set<string>): number => {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const x of a) if (b.has(x)) hit += 1;
  return hit / Math.min(a.size, b.size);
};

const SLASH = String.fromCharCode(92);
const FILES: { p: string; s: string }[] = [];
(function walk(dir: string) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e)) FILES.push({ p: p.split(SLASH).join('/').replace('src/', ''), s: readFileSync(p, 'utf-8') });
  }
})(join(process.cwd(), 'src'));

/**
 * 落点候选池 = 内核块 + 六副透镜片段。
 *
 * 只扫内核块会漏掉一半：门槛 T₂、CQ 顺序、三档判定这些都在透镜片段里。
 * 第一版就是这么漏的，把 T2-06 报成「疑似无落点」——它是全项目最扎实的一条。
 */
const POOL: { id: string; text: string }[] = [
  ...PROMPT_BLOCKS.map((b) => ({ id: b.id, text: b.body })),
  ...Object.entries(LENS_MODULES).map(([k, v]) => ({
    id: `lens:${k}`,
    text: JSON.stringify(v),
  })),
];

const lines: string[] = ['id\ttier\tsub\tbest\tscore\tsecond\tscore2\tthird\tscore3\tidents'];
const weak: string[] = [];

for (const c of THEORY_CLAIMS) {
  const d = c.decides;
  const A = bigrams(d);
  const scored = POOL.map((b) => ({ id: b.id, s: overlap(A, bigrams(b.text)) })).sort(
    (x, y) => y.s - x.s,
  );
  const idents = [...new Set(d.match(/[A-Za-z_][A-Za-z0-9_.]{2,}/g) ?? [])];
  const found = idents
    .map((t) => ({ t, f: FILES.filter((f) => f.s.includes(t)).map((f) => f.p) }))
    .filter((x) => x.f.length)
    .map((x) => `${x.t}@${x.f[0]}`);
  lines.push(
    [
      c.id,
      c.tier,
      c.sub ?? '',
      scored[0].id,
      scored[0].s.toFixed(3),
      scored[1].id,
      scored[1].s.toFixed(3),
      scored[2].id,
      scored[2].s.toFixed(3),
      found.slice(0, 2).join(' ') || '-',
    ].join('\t'),
  );
  if (scored[0].s < 0.15 && !found.length) weak.push(`${c.id} (${scored[0].s.toFixed(2)}) ${d.slice(0, 46)}`);
}

console.log(lines.join('\n'));
console.error(`\n=== 疑似无落点 ${weak.length} 条 ===`);
for (const w of weak) console.error(w);
