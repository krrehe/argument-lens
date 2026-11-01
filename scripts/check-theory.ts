import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import {
  RAW_CLAIMS,
  SUB_BY_ID,
  SUB_LABEL,
  THEORY_BOOKS,
  TIER_LABEL,
  THEORY_CLAIMS,
  lensClaims,
  type ClaimSub,
} from '@shared/theory-base';
import { THEORIES } from '@shared/theories';

/**
 * 理论主张库的断言测试。跑法：npm run check:theory
 *
 * 这个库自己立了两条硬规矩，而规矩没有检查器就只是愿望：
 *
 *   1. 「一条主张若指不出它在代码里改变了什么，它就不该进库」——
 *      于是 decides 里出现的代码标识符必须真的存在于 src/。
 *      这里出过事故：三处 decides 写着 burdenOfProof / speechKind，
 *      字段在代码里根本不存在，库照常编译，读者照常被骗。
 *
 *   2. 「C 档不许标成 A 档」——A 档必须有具体文献，写了「本工具」的一律算假 A。
 */

const errors: string[] = [];
const warn = (m: string) => errors.push(m);
const CLAIM_SUBS = Object.keys(SUB_LABEL) as ClaimSub[];

const ids = new Set<string>();
for (const c of THEORY_CLAIMS) {
  if (!/^T\d{1,2}-\d{2}$/.test(c.id)) warn(`id 格式不对：${c.id}`);
  if (ids.has(c.id)) warn(`id 重复：${c.id}`);
  ids.add(c.id);

  // slice(1, 2) 只对一位数编号成立；第十编进来时 T10-01 会被读成第 1 编。
  // 用第一个连字符定位，编号两位数也照得住。
  const book = Number(c.id.slice(1, c.id.indexOf('-')));
  if (c.book !== book) warn(`${c.id} 的 book=${c.book}，与 id 不符`);

  if (!c.claim.trim()) warn(`${c.id} 主张为空`);
  if (!c.decides.trim()) warn(`${c.id} 缺 decides——没有落点的主张不进库`);
  if (!c.refs.length || !c.refs.every((r) => r.trim())) warn(`${c.id} 出处为空或有空条`);

  if (c.tier === 'A' && c.refs.some((r) => r.includes('本工具'))) {
    warn(`${c.id} 标了 ${TIER_LABEL.A}，出处里却写着「本工具」——C 档不许标成 A 档`);
  }
  if (!c.sub) warn(`${c.id} 缺细分域 sub`);
  else if (!CLAIM_SUBS.includes(c.sub)) warn(`${c.id} 的细分域 ${c.sub} 不在封闭枚举里`);
}

// 每个细分域至少有一条主张，否则筛选器里会有一排空按钮
for (const s of CLAIM_SUBS) {
  if (!THEORY_CLAIMS.some((c) => c.sub === s)) warn(`细分域 ${s}（${SUB_LABEL[s]}）下没有任何主张`);
}

// 每编都要在 THEORY_BOOKS 里有名、有配套文档、条目够数。
// 加编时不写文档就过不了：八、九编是批判性思维与人文方向，
// 这两编最容易写成「读了些书」而不是「读了书之后改了什么」。
for (const b of THEORY_BOOKS) {
  const inBook = THEORY_CLAIMS.filter((c) => c.book === b.n);
  if (!inBook.length) warn(`第 ${b.n} 编「${b.title}」在库里没有任何主张`);
  else if (inBook.length < 6) warn(`第 ${b.n} 编只有 ${inBook.length} 条，少得撑不起一编`);
  if (!existsSync(join(process.cwd(), b.doc))) {
    warn(`第 ${b.n} 编的配套文档 ${b.doc} 不存在`);
  }
  // 一编若全是 C 档，说明这一编是「本工具的判断」而不是文献——
  // 那它就不该用文献编的排场出现，除非它本来就是工程判断编（第七编）。
  if (!b.engineering && inBook.length >= 6 && inBook.every((c) => c.tier === 'C')) {
    warn(`第 ${b.n} 编整编都是 C 档（本工具判断）——这一编没有文献支撑，不该立编`);
  }
}
for (const n of new Set(THEORY_CLAIMS.map((c) => c.book))) {
  if (!THEORY_BOOKS.some((b) => b.n === n)) warn(`库里有第 ${n} 编的主张，但 THEORY_BOOKS 里没有这一编`);
}

// 厚度：细分域只有 1—2 条时，那一栏筛选出来等于没得看。
// 专题域要求更高（≥3）：报告里的专题分析区块直接按这根轴取依据，
// 一个专题只有一条依据，那个区块就只是把那句话换个地方再说一遍。
for (const s of CLAIM_SUBS) {
  const n = THEORY_CLAIMS.filter((c) => c.sub === s).length;
  const floor = s.startsWith('topic-') ? 3 : 2;
  if (n < floor) warn(`细分域 ${s}（${SUB_LABEL[s]}）只有 ${n} 条，少于 ${floor} 条`);
}

// 每副透镜都要有几条专有的主张。侧栏显示「这一栏专有几条」，
// 一副透镜只有一两条时，那一行起不到分辨作用。
for (const t of THEORIES) {
  const n = lensClaims(t.id).length;
  if (n < 4) warn(`透镜 ${t.id}（${t.name}）只有 ${n} 条专有主张，少于 4 条`);
}

/*
 * 近似重复。中文没有空格，按 bigram 比，取重叠系数（交集 / 较小者）——
 * 用 Jaccard 会因为两条长度差很多而偏低，漏掉「把一句话改写一遍充两条」。
 *
 * 阈值 0.45 是量出来的，不是拍的：库里最高的一对是 0.42（T4-03 与 T4-07，
 * 都是讲受众，但确实是两条不同的主张）。再低就会开始误报。
 */
const grams = (s: string) => {
  const t = s.replace(/[\s，。；：、（）「」《》"'’“”,.;:()]/g, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i += 1) out.add(t.slice(i, i + 2));
  return out;
};
const overlap = (a: Set<string>, b: Set<string>) => {
  let n = 0;
  for (const g of a) if (b.has(g)) n += 1;
  return n / Math.min(a.size, b.size);
};
let dupChecked = 0;
for (let i = 0; i < THEORY_CLAIMS.length; i += 1) {
  for (let j = i + 1; j < THEORY_CLAIMS.length; j += 1) {
    const A = THEORY_CLAIMS[i];
    const B = THEORY_CLAIMS[j];
    dupChecked += 1;
    const v = Math.max(
      overlap(grams(A.claim), grams(B.claim)),
      overlap(grams(A.decides), grams(B.decides))
    );
    if (v >= 0.45) {
      warn(`${A.id} 与 ${B.id} 相似度 ${v.toFixed(2)}——同一条主张写了两遍，那是注水不是细分`);
    }
  }
}

// SUB_BY_ID 这张补表不许有幽灵：条目改名/删除后，表里不许留旧 id
for (const id of Object.keys(SUB_BY_ID)) {
  if (!ids.has(id)) warn(`细分域映射表里的 ${id} 在库里不存在（旧条目改名后忘了清表）`);
}

// decides 里的代码标识符必须真的存在。只查混大小写与全大写（≥5 字符）两种，
// 普通小写词（argument / expert / the）不是代码引用，不查。
//
// 一个差点漏掉的洞：不能把 theory-base.ts 自己扫进去——主张文本写什么，
// 库文件里就有什么，幻影字段在「同一份文件」里当然找得到（这里反向验证时真发生过）。
// 所以落点搜索排除库文件本身：一个字段若真实存在，必然还出现在别处（类型、主进程、界面）。
const SRC: string[] = [];
(function walk(dir: string) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx|mjs)$/.test(e) && e !== 'theory-base.ts') SRC.push(readFileSync(p, 'utf-8'));
  }
})(join(process.cwd(), 'src'));

const srcAll = SRC.join('\n');
/*
 * 曾经这里有一张白名单，放行 `CriticalQuestion` 这个词——注释说它「指向 types 里内联的那一组字段」。
 * 那是一句自我开脱：库里写的 `CriticalQuestion.why` 在代码里从来不存在，
 * 真实结构是 `SchemeDefinition.criticalQuestions[].why`。白名单把一个术语错误护了十几轮。
 * 现在没有白名单：decides 里写的标识符，代码里必须真有。
 */
const checkTok = (t: string) => srcAll.toLowerCase().includes(t.toLowerCase());
let checked = 0;

for (const c of THEORY_CLAIMS) {
  const toks = c.decides.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  const interesting = toks.filter((t) => {
    if (t.length < 4) return false;
    const hasLower = /[a-z]/.test(t);
    const hasUpper = /[A-Z]/.test(t);
    return (hasLower && hasUpper) || (!hasLower && t.length >= 5);
  });
  for (const t of interesting) {
    checked += 1;
    if (!checkTok(t)) warn(`${c.id} 的 decides 提到 ${t}，但 src/ 里找不到它——落点是幻影字段`);
  }
}

/*
 * 第七编那张「主张 → 代码」全表会朽：表里列了 96 个 id，主张一改名，
 * 表就指着不存在的条目。所以顺手查一遍文档里出现的主张 id。
 * 这张表是「理论到代码」这一编唯一可查的索引，指错了比没有更坏。
 */
const MAP_DOC = 'docs/理论支撑/07-理论到代码.md';
if (existsSync(join(process.cwd(), MAP_DOC))) {
  const md = readFileSync(join(process.cwd(), MAP_DOC), 'utf-8');
  const inTable = new Set<string>();
  for (const m of md.matchAll(/^\|\s*(T\d{1,2}-\d{2})\s*\|/gm)) inTable.add(m[1]);
  for (const r of inTable) {
    if (!ids.has(r)) warn(`${MAP_DOC} 的映射表里列了 ${r}，但库里没有这一条——表朽了`);
  }
  if (inTable.size < Math.floor(THEORY_CLAIMS.length * 0.9)) {
    warn(`映射表只列了 ${inTable.size} 条，库里有 ${THEORY_CLAIMS.length} 条——新主张加进库却没进表`);
  }
} else {
  warn(`映射表文档 ${MAP_DOC} 不存在`);
}

// 别处引用主张 id 时（比如报告里的边界栏挂 claimId），引用的必须是真条目。
// 这与 decides 的落点检查是同一件事的另一面：幻影字段查的是「它改了什么」，
// 这里查的是「它挂在谁名下」——挂一个不存在的 id，界面上会显示一行空依据。
const refIds = new Set<string>();
for (const s of SRC) {
  for (const m of s.matchAll(/'T\d{1,2}-\d{2}'/g)) refIds.add(m[0].slice(1, -1));
}
for (const r of refIds) {
  if (!ids.has(r)) warn(`代码里引用了主张 ${r}，但库里没有这一条`);
}
if (refIds.size < 5) warn(`只查到 ${refIds.size} 处主张 id 引用，少得可疑——引用检查是不是没扫到`);

/*
 * 边界栏（src/shared/limits.ts）是「本工具明确不做什么」唯一被用户看见的地方。
 * 它有个特别的失败方式：删掉一条不会报错，报告照常出，只是少了一行——
 * 而没有哪份报告会因为少一行边界而显得不对。所以这里点名几条必须一直在的：
 * 它们各自对应一条「不做」类主张，删掉等于悄悄收回了那个承诺。
 */
const MUST_IN_LIMITS: Record<string, string> = {
  'T3-04': '不设动机字段',
  'T8-02': '不评说话者的品格与倾向',
  'T9-01': '只评 logos，不评 ethos / pathos',
  'T9-06': '不评估制度性权力',
  'T9-07': '不声明自己的视角',
  'T9-10': '检查不递归',
  'T9-12': '只做说明，不做理解',
  'T8-07': '不做自我校准',
  'T8-12': '不按领域换标准',
  'T9-08': '不按文化传统切换标准',
};
const limitsSrc = readFileSync(join(process.cwd(), 'src/shared/limits.ts'), 'utf-8');
for (const [id, what] of Object.entries(MUST_IN_LIMITS)) {
  if (!limitsSrc.includes(`'${id}'`)) {
    warn(`边界栏没有挂 ${id}（${what}）——这条「不做」现在只在库里，用户看不见`);
  }
}
// 反向：边界栏挂的 id 必须都真存在（上面 refIds 已覆盖 src，但 limits 的写法是对象字面量，
// 用同一条正则能扫到；这里再验一次条数，防整组被注释掉而 id 仍在注释里）。
const limitRefs = new Set<string>();
for (const m of limitsSrc.matchAll(/'T\d{1,2}-\d{2}'/g)) limitRefs.add(m[0].slice(1, -1));
if (limitRefs.size < 13) {
  warn(`边界栏只挂了 ${limitRefs.size} 条主张，少于 13 条——三类边界每条都该有出处`);
}


if (THEORY_CLAIMS.length < 100) {
  warn(`主张只有 ${THEORY_CLAIMS.length} 条，低于 100——某一编被整块删掉时这里要响`);
}
if (dupChecked < 1000) warn(`近似重复只比了 ${dupChecked} 对，少得可疑——库是不是被整批清空了`);
if (checked < 10) warn(`标识符核对只查了 ${checked} 处，少得可疑——decides 是不是整批换成纯中文了`);

if (errors.length) {
  console.error(`✗ 理论主张库 ${errors.length} 处问题：`);
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log(
  `✓ 理论主张库：${THEORY_CLAIMS.length} 条，细分域 ${CLAIM_SUBS.length} 个全覆盖，` +
    `decides 落点核对 ${checked} 处全部存在`
);
