/**
 * 语料独立性的断言（P1-1）。
 *
 * 这一关守的不是「文本写得好不好」——那没法机器判。它守的是一件可以被机器判、
 * 而且**一定会腐烂**的事：**每种毛病是不是真的被几段独立的文本踩过。**
 *
 * 为什么要守：23 条语料里，「分母缺失」「多重比较」「不相关属性」各自只有一段。
 * 一段，就分不清「软件抓到了这一类毛病」和「软件认出了这一段文本的写法」。
 * 而这类缺口不会报错——它只会让评测报告看起来覆盖了 18 类，实际是 18 个孤例。
 *
 * 判「独立」用四条，缺一条就不算：
 *   体裁不同（同一体裁的两段，会共享它们的问题写法）——现在是**全部**不同，不只是「大于一种」
 *   字面不同（dice 低于阈值——两段是改稿，不是两个样本）
 *   模式不同（同一类毛病在诊断里抓到，不等于在红队里也抓得到；
 *             而「查谬误」是最容易轻易命名的那一档，它在语料里曾长期零覆盖）
 *   类型不同（同一条语料标两类，不能自己给自己凑数）
 *
 * 这三个门槛都是 2026-11-05 从 2 段涨到 3 段时立的，理由写在路线图 P1-1：
 * 两类样本只能分出「抓到了」与「没抓到」；三类样本里只要有一类换个模式、
 * 换个体裁还站得住，「这段文本太典型」这个解释才开始有对手。
 *
 * 这一关能验的边界：它验不了「这段文本真的埋了那类毛病」——那是人写的判断，
 * 机器读不出来。它只能保证：标注表齐全、词表是闭集、每条语料最多标三类、
 * 每类至少三段体裁互不相同、模式不单一的低重合文本。**标注是否属实，只能靠人读。**
 *
 * 跑法：npm run check:corpus
 */
import { CASES } from './eval/cases';
import { KINDS, KIND_IDS, KINDS_BY_CASE, type KindId } from './eval/kinds';
import { bigrams, dice, normalizePassage } from '@shared/sameness';
import { MODE_META } from '@shared/types';

let passed = 0;
const failed: string[] = [];

function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}

const MAX_KINDS_PER_CASE = 3;
const MIN_CASES_PER_KIND = 3;
/* 每类至少两种模式。同一类毛病在「诊断」里抓到，不等于在「红队」里也抓得到。 */
const MIN_MODES_PER_KIND = 2;
/*
 * 两段文本的字面重合上限。定这个数不是估的：实测「同一段加一句」0.926、
 * 「加一整句因果」0.806、「换词换序重写」0.523，而语料里同类最像的一对是 0.171
 * （统计数据与医院年报，都在讲分子分母）。0.25 落在「改写」与「独立」之间：
 * 改稿过不去，换了说法的真样本过得去。
 */
const MAX_SHARED = 0.25;
const MIN_CHARS = 40;

/* ── 一、标注表与语料表必须一一对应 ───────────────────────── */

const ids = CASES.map((c) => c.id);
const idSet = new Set(ids);

ok(idSet.size === ids.length, '语料 id 唯一', `重复：${ids.filter((x, i) => ids.indexOf(x) !== i).join('、')}`);

const untagged = ids.filter((id) => !KINDS_BY_CASE[id]);
ok(untagged.length === 0, '每条语料都标了毛病类型', `没标：${untagged.join('、')}`);

const ghosts = Object.keys(KINDS_BY_CASE).filter((id) => !idSet.has(id));
ok(ghosts.length === 0, '标注表里没有不存在的语料 id', `多出来：${ghosts.join('、')}`);

/* ── 二、标注本身要合法 ───────────────────────────────────── */

const badKind: string[] = [];
for (const [id, ks] of Object.entries(KINDS_BY_CASE)) {
  if (ks.length === 0) badKind.push(`${id} 一类都没标`);
  if (ks.length > MAX_KINDS_PER_CASE) badKind.push(`${id} 标了 ${ks.length} 类（上限 ${MAX_KINDS_PER_CASE}）`);
  for (const k of ks) {
    if (!(k in KINDS)) badKind.push(`${id} 里的 ${k} 不在闭集内`);
  }
  if (new Set(ks).size !== ks.length) badKind.push(`${id} 有重复的类`);
}
ok(badKind.length === 0, '每条语料的类型标注合法', badKind.join('；'));

/* 闭集里每一项都必须被用过：加了类型却没有任何语料踩到，等于写了一条空规则。 */
const used = new Set<KindId>();
for (const ks of Object.values(KINDS_BY_CASE)) for (const k of ks) used.add(k as KindId);
const unused = KIND_IDS.filter((k) => !used.has(k));
ok(unused.length === 0, '闭集里的每一类都有语料在考它', `没有任何语料踩到：${unused.map((k) => KINDS[k].name).join('、')}`);

/*
 * 五种分析模式都必须有语料在考。
 *
 * 为什么单列这一条：2026-11-05 之前 28 段语料里**没有一段是「查谬误」模式**——
 * 而那一档恰恰最容易把可疑处直接对上名字（`givesVerdict: false`、`allowsLabels: true`），
 * 也是这个项目最反对的「轻易命名」发生的地方。它只在 `check:contract` 里
 * 靠一份假模型夹具间接守着，等于「模式」这个维度在真实语料上一次都没被踩过。
 *
 * 已经从 `MODE_META` 取，不另抄一份清单：加一档新模式时，这条会自己红。
 */
const allModes = Object.keys(MODE_META) as (keyof typeof MODE_META)[];
const coveredModes = new Set(CASES.map((c) => c.mode));
const missingModes = allModes.filter((m) => !coveredModes.has(m));
ok(
  missingModes.length === 0,
  '每一种分析模式都有语料在考',
  `没有任何语料用这些模式跑过：${missingModes.map((m) => `${MODE_META[m].label}（${m}）`).join('、')}`,
);

/* ── 三、语料本身的形状 ───────────────────────────────────── */

const byId = new Map(CASES.map((c) => [c.id, c]));

const short = CASES.filter((c) => normalizePassage(c.text).length < MIN_CHARS).map((c) => c.id);
ok(short.length === 0, `每段语料至少 ${MIN_CHARS} 字（更短的相似度会乱跳）`, short.join('、'));

const noTraps = CASES.filter((c) => c.traps.length < 3).map((c) => c.id);
ok(noTraps.length === 0, '每条语料至少写了 3 条「埋了什么」', noTraps.join('、'));

const dupTrap = CASES.filter((c) => new Set(c.traps).size !== c.traps.length).map((c) => c.id);
ok(dupTrap.length === 0, '同一条语料里没有重复的 traps', dupTrap.join('、'));

const noGenre = CASES.filter((c) => !c.genre.trim()).map((c) => c.id);
ok(noGenre.length === 0, '每条语料都有体裁', noGenre.join('、'));

/* ── 四、每类毛病：至少两段、体裁不同、字面不像 ───────────── */

interface Row {
  kind: KindId;
  cases: string[];
  genres: string[];
  modes: string[];
  worst: number;
  pair: string;
}

const rows: Row[] = [];

for (const kind of KIND_IDS) {
  const cases = Object.entries(KINDS_BY_CASE)
    .filter(([, ks]) => (ks as KindId[]).includes(kind))
    .map(([id]) => id);
  const cs = cases.map((id) => byId.get(id)!).filter(Boolean);
  const genres = [...new Set(cs.map((c) => c.genre))];
  const modes = [...new Set(cs.map((c) => c.mode))];

  /* 最像的一对：只要有两段，就必须量出来，哪怕这一关已经不红了。 */
  let worst = 0;
  let pair = '—';
  for (let i = 0; i < cs.length; i += 1) {
    for (let j = i + 1; j < cs.length; j += 1) {
      const a = normalizePassage(cs[i].text);
      const b = normalizePassage(cs[j].text);
      const d = dice(bigrams(a), bigrams(b));
      if (d > worst) {
        worst = d;
        pair = `${cs[i].id} ↔ ${cs[j].id}`;
      }
    }
  }

  rows.push({ kind, cases, genres, modes, worst, pair });

  ok(
    cs.length >= MIN_CASES_PER_KIND,
    `「${KINDS[kind].name}」至少有 ${MIN_CASES_PER_KIND} 段语料在考`,
    `只有 ${cs.length} 段：${cases.join('、') || '无'}`,
  );
  if (cs.length >= MIN_CASES_PER_KIND) {
    /*
     * 体裁要**全部**不同，不是「至少两种」。
     * 「至少两种」在三段里允许两段同体裁——那两段会共享它们的问题写法，
     * 而这一关存在的理由就是不让「同一段文本的两个版本」冒充两个样本。
     */
    ok(
      genres.length === cs.length,
      `「${KINDS[kind].name}」的 ${cs.length} 段体裁互不相同`,
      `体裁只有 ${genres.length} 种：${cs.map((c) => `${c.id}=${c.genre}`).join('、')}`,
    );
    ok(
      modes.length >= MIN_MODES_PER_KIND,
      `「${KINDS[kind].name}」至少被两种分析模式考过`,
      `只用了${modes.join('/')}——换个模式问，这一类可能整段漏掉`,
    );
    ok(
      worst < MAX_SHARED,
      `「${KINDS[kind].name}」的各段字面不像（dice < ${MAX_SHARED}）`,
      `最像的一对 ${pair} 是 ${worst.toFixed(3)}——这是改稿，不是两个样本`,
    );
  }
}

/* ── 汇总 ─────────────────────────────────────────────────── */

const matrix = rows
  .map((r) => `  ${KINDS[r.kind].name.padEnd(9, '　')} ${String(r.cases.length).padStart(2)} 段｜体裁 ${r.genres.length}｜模式 ${r.modes.length}｜最像 ${r.worst.toFixed(3)}｜${r.cases.join('、')}`)
  .join('\n');

/*
 * 打印顺序是「先矩阵、后汇总」，因为 verify 只取脚本输出的最后一行。
 * 反过来的话，verify 里显示的就成了矩阵的最后一行（「多重比较 2 段…」），
 * 看不出这一关到底过了没有。
 */
if (failed.length) {
  console.error(`✗ check:corpus 红了 ${failed.length} 处（通过 ${passed} 条）\n`);
  for (const f of failed) console.error(`  ✗ ${f}`);
  console.error(`\n覆盖矩阵：\n${matrix}`);
  console.error('\n一条语料只有一段样本时，分不清「软件抓到了这类毛病」和「软件认出了这段文本的写法」。');
  process.exit(1);
}

console.log(matrix);
const thin = rows.filter((r) => r.cases.length === MIN_CASES_PER_KIND).length;
console.log(
  `✓ check:corpus 通过 ${passed} 条｜语料 ${CASES.length} 段｜毛病 ${KIND_IDS.length} 类，每类 ≥${MIN_CASES_PER_KIND} 段、体裁全不同、≥${MIN_MODES_PER_KIND} 种模式（其中 ${thin} 类刚好 ${MIN_CASES_PER_KIND} 段）`,
);
