import { THEORY_CLAIMS, SUB_LABEL } from '@shared/theory-base';
import { LANDING, LAND_KIND_LABEL, type Land } from '@shared/landing';

/**
 * 生成「主张 → 落点」全表，供 docs/理论支撑/07-理论到代码.md 第十节用。
 *
 * 第十七轮重写。旧版按 decides 里的英文标识符去 src 里碰运气找文件，
 * 找不到就写「（行为层）」——70 条这么写，等于 70 个地址是空的。
 * 旧版还留了一个真错误：代码位置写成 `D:/.../main/objections.ts`，
 * 少了 src/，照它去找文件找不到。地址写错的表比没有表更坏：它让人以为查过了。
 *
 * 现在直接读 landing.ts：那张表由 check:landing 逐条验过存在，
 * 这里只负责排版，不负责判断。
 *
 * 用法：node scripts/run-gen-map.mjs > /tmp/map.md
 * 一次性工具，不接进 npm scripts：表生成后靠 check:theory 的 id 检查防腐。
 */

const cell = (s: string) => s.replace(/\|/g, '\\|');

const title = (l: Land): string => {
  if (l.k === 'code') {
    const [f, id] = l.ref.split('#');
    return `${LAND_KIND_LABEL.code} \`${f.replace(/^src\//, '')}#${id}\``;
  }
  return `${LAND_KIND_LABEL[l.k]} \`${l.ref}\``;
};

const rows: string[] = ['| 主张 | 档 | 细分域 | 落点 | 在那一处变成了什么 |', '|---|---|---|---|---|'];
const byKind: Record<string, number> = {};
let refs = 0;

for (const c of THEORY_CLAIMS) {
  const lands = LANDING[c.id] ?? [];
  if (!lands.length) {
    rows.push(`| ${c.id} | ${c.tier} | ${SUB_LABEL[c.sub!]} | **无落点** | — |`);
    continue;
  }
  for (const l of lands) {
    refs += 1;
    byKind[l.k] = (byKind[l.k] ?? 0) + 1;
  }
  const where = lands.map(title).join('<br>');
  const what = lands.map((l) => cell(l.at)).join('<br>');
  rows.push(`| ${c.id} | ${c.tier} | ${SUB_LABEL[c.sub!]} | ${where} | ${what} |`);
}

console.log(rows.join('\n'));
console.error(
  `总条数 ${THEORY_CLAIMS.length}，落点 ${refs} 处：` +
    Object.entries(byKind)
      .map(([k, n]) => `${LAND_KIND_LABEL[k as keyof typeof LAND_KIND_LABEL]} ${n}`)
      .join('／'),
);
