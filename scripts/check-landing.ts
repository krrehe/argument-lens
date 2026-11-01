import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEORY_CLAIMS, SUB_LABEL } from '@shared/theory-base';
import { LANDING, LAND_KIND_LABEL, type Land } from '@shared/landing';
import { PROMPT_BLOCKS } from '../src/main/prompt/blocks';
import { LENS_MODULES } from '../src/main/prompt/registry';

/**
 * 落点表检查。跑法：npm run check:landing
 *
 * 它守的是一件具体的事：**每条理论主张都必须能指到软件里的某处，而且那个地方真的存在。**
 *
 * 为什么这件事需要检查器：上一版 07 文档把落点写成「（行为层）」，
 * 那是一种静默跳过——70 条都没有可校验的地址，改坏了没人知道，
 * 删掉了也没人知道。而库自己的第一条规矩就是「指不出落点的就不是理论基础」。
 *
 * 检查器能抓的：
 *   - 主张加了但没写落点，或落点写了但主张被删（两边对不上）
 *   - 块改名/删块、透镜片段被清空、函数改名、界面区块改名（ref 失效）
 *   检查器抓不到的：
 *   - ref 还在、但那一处的语义已经变了。这与 check:theory 的最大弱点同源，
 *     只能靠人工对读。at 字段写具体一点，是唯一能延缓它朽掉的办法。
 */
const ROOT = process.cwd();
const errors: string[] = [];
const warn = (m: string) => errors.push(m);

const claimIds = new Set(THEORY_CLAIMS.map((c) => c.id));

/* ── 一、两边对得上 ── */
for (const c of THEORY_CLAIMS) {
  const lands = LANDING[c.id];
  if (!lands || lands.length === 0) {
    warn(`${c.id} 没有落点——按库自己的规矩，它不该留在这里`);
    continue;
  }
  if (lands.length > 2) warn(`${c.id} 写了 ${lands.length} 个落点，超过 2 个通常是在凑数`);
  for (const l of lands) {
    if (l.at.trim().length < 12) {
      warn(`${c.id} 的落点说明太短（「${l.at}」），写不到 12 字通常等于没写`);
    }
    if (/（行为层）|影响措辞|见上文|同上/.test(l.at)) {
      warn(`${c.id} 的落点说明是套话（「${l.at}」）——套话等于没有地址`);
    }
  }
}
for (const id of Object.keys(LANDING)) {
  if (!claimIds.has(id)) warn(`落点表里有 ${id}，但库里没有这一条——表朽了`);
}

/* ── 二、ref 必须真的存在 ── */
const blockIds = new Set(PROMPT_BLOCKS.map((b) => b.id));
const LENS_PARTS = ['worldview', 'procedure', 'rules', 'scopeGuard', 'checksSpec', 'lensShape', 'index'] as const;

const fileCache = new Map<string, string | null>();
const readRel = (rel: string): string | null => {
  if (fileCache.has(rel)) return fileCache.get(rel)!;
  const p = join(ROOT, rel);
  const s = existsSync(p) ? readFileSync(p, 'utf-8') : null;
  fileCache.set(rel, s);
  return s;
};

let refChecked = 0;
const kindCount: Record<string, number> = { block: 0, lens: 0, code: 0, ui: 0 };

const checkOne = (id: string, l: Land) => {
  refChecked += 1;
  kindCount[l.k] += 1;
  if (l.k === 'block') {
    if (!blockIds.has(l.ref)) warn(`${id} 的落点指向提示词块 ${l.ref}，但该块不存在——块改名了，或者被删了`);
    return;
  }
  if (l.k === 'lens') {
    const [theory, part] = l.ref.split('/');
    const frag = (LENS_MODULES as Record<string, unknown>)[theory] as Record<string, unknown> | undefined;
    if (!frag) {
      warn(`${id} 的落点指向透镜 ${theory}，但六副透镜里没有这一副`);
      return;
    }
    if (!LENS_PARTS.includes(part as (typeof LENS_PARTS)[number])) {
      warn(`${id} 的落点写了透镜部分「${part}」，不在 ${LENS_PARTS.join('/')} 之列`);
      return;
    }
    const v = frag[part];
    const empty = v == null || (Array.isArray(v) ? v.length === 0 : typeof v === 'string' ? v.trim() === '' : false);
    if (empty) warn(`${id} 的落点指向 lens:${l.ref}，但那一部分现在是空的`);
    return;
  }
  if (l.k === 'code') {
    const [file, ident] = l.ref.split('#');
    const s = readRel(file);
    if (s == null) {
      warn(`${id} 的落点指向 ${file}，但该文件不存在`);
      return;
    }
    if (!s.includes(ident)) warn(`${id} 的落点指向 ${file}#${ident}，但文件里找不到 ${ident}——标识符改名了，或者落点本就是幻影`);
    return;
  }
  if (l.k === 'ui') {
    const [comp, sec] = l.ref.split('#');
    const s = readRel(join('src/renderer/src/components', comp));
    if (s == null) {
      warn(`${id} 的落点指向组件 ${comp}，但该组件不存在`);
      return;
    }
    if (!s.includes(`id="${sec}"`)) warn(`${id} 的落点指向 ${comp}#${sec}，但组件里没有 id="${sec}" 的区块`);
    return;
  }
};

for (const [id, lands] of Object.entries(LANDING)) for (const l of lands) checkOne(id, l);

/* ── 三、下限与分布 ── */
if (refChecked < THEORY_CLAIMS.length) {
  warn(`全库 ${THEORY_CLAIMS.length} 条只核了 ${refChecked} 处落点，少于条数——有主张没落点`);
}
// 分布本身是信息：若某一编整编只落在边界栏上，说明那一编买的是「声明」不是「行为」。
const byBook: Record<number, Record<string, number>> = {};
for (const c of THEORY_CLAIMS) {
  const lands = LANDING[c.id] ?? [];
  byBook[c.book] ??= {};
  for (const l of lands) byBook[c.book][l.k] = (byBook[c.book][l.k] ?? 0) + 1;
}

if (errors.length) {
  console.error(`✗ 落点表 ${errors.length} 处问题：`);
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}

const bookLine = Object.entries(byBook)
  .map(([b, m]) => {
    const parts = Object.entries(m)
      .sort((a, z) => z[1] - a[1])
      .map(([k, n]) => `${LAND_KIND_LABEL[k as keyof typeof LAND_KIND_LABEL]}${n}`);
    return `第${b}编 ${parts.join('·')}`;
  })
  .join('；');

console.log(
  `✓ 落点表：${THEORY_CLAIMS.length} 条主张全部有落点，${refChecked} 处引用全部存在` +
    `（${Object.entries(kindCount)
      .map(([k, n]) => `${LAND_KIND_LABEL[k as keyof typeof LAND_KIND_LABEL]} ${n}`)
      .join('／')}）`,
);
console.log(`  ${bookLine}`);
// 细分域照样打一遍：它和 check:theory 的统计是同一份数据，这里只用来交叉核对总数没有漏。
const subs = new Set(THEORY_CLAIMS.map((c) => c.sub));
if (subs.size !== Object.keys(SUB_LABEL).length) {
  console.error(`✗ 细分域只用到 ${subs.size} 个，标签表有 ${Object.keys(SUB_LABEL).length} 个——有域一条主张都没有`);
  process.exit(1);
}
