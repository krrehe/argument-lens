/**
 * 外部学术样本 · 词汇层字面账。
 *
 * 回答上一轮欠着的那条证据：「这一圈的词」在真实学术写作上有没有可复算的信号？
 * 三段真文本见 `scripts/fixtures/field-samples.ts`（2026-11-09 从公开期刊页逐字抄录）。
 *
 * **只采信原文侧四个字段**（word / count / firstAt / sentences / missing）。
 * 报告侧四项（结论文字、前提文字、只在结论里、quiet 句）一律不读：
 * 这三段只有原文，没有真模型报告；把空报告传进去，`fieldTermsOf` 会写出
 * 「报告结论文字里没有这个词」——那不是事实，是缺输入。宁可明说量不了，不写假话。
 *
 * 口径不另写一份：切句用界面的 `sentenceBounds`，数词用界面的 `fieldTermsOf`。
 * 不进 `verify`：它依赖一组固定在仓库里的外部文本，换一段字就该换一份账；
 * 命令自带硬断言自检，失败真实退出 1，不静默跳过。
 */
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { FIELD_SAMPLES } from './fixtures/field-samples';
import { fieldTermsOf, type FieldTermRow } from '@shared/field-terms';
import { sentenceBounds } from '@shared/reread';

let bad = 0;
function must(cond: boolean, label: string, detail = ''): void {
  if (!cond) {
    console.error(`✗ 自检失败：${label}${detail ? `（${detail}）` : ''}`);
    bad += 1;
  }
}

const NO_REPORT = { conclusion: '', premises: [] as string[], quietSentences: [] as number[] };

/* ───── 自检一：判据本身没坏 ─────
 * 「全部没命中」既可能是事实为零，也可能是切句／数词写坏了。先造一段已知答案的字。
 * 全用可选链，坏掉时要报出一条清楚的红，而不是抛 TypeError 让脚本看起来「跑过了」。 */
{
  const text = '甲词出现在第一句。第二句里没有它。甲词又在第三句露面。';
  const sentences = sentenceBounds(text);
  const view = fieldTermsOf({
    passage: text,
    words: ['甲词', '乙词'],
    sentences,
    ...NO_REPORT,
  });
  must(sentences.length === 3, '构造样本切出 3 句', `实得 ${sentences.length}`);
  must(view.rows[0]?.count === 2, '命中词数对', `实得 ${view.rows[0]?.count}`);
  must(view.rows[0]?.sentences.join(',') === '0,2', '落句按 index 升序且不按下标', `实得 ${view.rows[0]?.sentences.join(',')}`);
  must(view.rows[1]?.count === 0, '未命中词数对', `实得 ${view.rows[1]?.count}`);
  must(view.state === 'ok', '有命中就不该判成 none-hit', `实得 ${view.state}`);
}

/* ───── 自检二：样本本身没坏 ─────
 * 防三种不会报错的绿：样本被删光、词表全抄错却照样有输出、对照词恰好命中
 * 让「没出现」那一列永远空着。 */
must(FIELD_SAMPLES.length >= 3, '至少三段外部样本（少于三段这个账没有意义）', `实得 ${FIELD_SAMPLES.length}`);
const ids = new Set<string>();
const fields = new Set<string>();
const urls = new Set<string>();
const texts = new Set<string>();
const views: { sample: (typeof FIELD_SAMPLES)[number]; sentences: ReturnType<typeof sentenceBounds>; rows: FieldTermRow[] }[] = [];

for (const s of FIELD_SAMPLES) {
  ids.add(s.id);
  fields.add(s.field);
  urls.add(s.url);
  texts.add(s.text);
  const tag = `[${s.id}]`;
  must(
    !!(s.title && s.authors && s.venue && s.date && s.url && s.license && s.kind && s.wordsFrom && s.text),
    `${tag} 出处与来源字段齐全`,
  );
  must(s.kind === '期刊摘要', `${tag} 体裁标的是期刊摘要，不冒充论证正文`, s.kind);
  must(s.text.length >= 100, `${tag} 文本够长`, `实得 ${s.text.length}`);
  must(s.words.length >= 4 && !s.words.includes(s.control), `${tag} 词表够长且不含对照词`);
  must(s.words.every((w) => w.trim() === w && w.length >= 2), `${tag} 每个词都是去空白的字面词`);

  const sentences = sentenceBounds(s.text);
  must(sentences.length >= 3, `${tag} 切出至少三句（一句就谈不上跨句分布）`, `实得 ${sentences.length}`);

  /* 对照词一起喂进去，这样「没出现」那一列必然有话说。 */
  const words = [...s.words, s.control];
  const view = fieldTermsOf({ passage: s.text, words, sentences, ...NO_REPORT });
  const hit = view.rows.filter((r) => r.count > 0).length;
  must(hit >= 3, `${tag} 至少三个词按字面命中（词表抄错时这里会红）`, `实得 ${hit}/${words.length}`);
  must(
    view.rows.find((r) => r.word === s.control)?.count === 0,
    `${tag} 对照词确实没出现（否则「没出现」那一列是空的）`,
    s.control,
  );
  views.push({ sample: s, sentences, rows: view.rows });
}
must(ids.size === FIELD_SAMPLES.length, '样本 id 不重复');
must(fields.size === FIELD_SAMPLES.length, '三段跨三个不同学科标签');
must(urls.size === FIELD_SAMPLES.length, '三段出处不是同一页抄三遍');
must(texts.size === FIELD_SAMPLES.length, '三段文本互不相同');

/* ───── 自检三：文档里的引用块与这份数据逐字相同 ─────
 * 踩过一次：文档用 ASCII 直引号、数据文件用中文弯引号，三段字数一模一样，
 * 看起来完全正常，但「逐字抄自出处页」是假的。长度相等最容易掩盖这种错。
 * 引用块与 `text` 必须逐字相同（含标点）；改一处另一处就得跟着改，这里钉住不漂。 */
{
  const doc = readFileSync(resolve(process.cwd(), 'docs/外部学术样本.md'), 'utf8');
  const quoted = [...doc.matchAll(/^> (.+)$/gm)]
    .map((m) => m[1].replace(/\r$/, ''))
    .filter((s) => s.length >= 200);
  must(quoted.length === FIELD_SAMPLES.length, '文档里有三段逐字引用块', `实得 ${quoted.length}`);
  for (const [i, s] of FIELD_SAMPLES.entries()) {
    must(quoted[i] === s.text, `[${s.id}] 文档引用块与数据文件逐字一致（含标点）`);
  }
}

/* 守着「不伪造报告」：这个脚本不许把报告侧字段写进输出。
 * 只读本文件原文，不读打包产物——产物里会有 bundle 进来的字段名，验不出这件事。 */
{
  const self = readFileSync(resolve(process.cwd(), 'scripts/audit-field-samples.ts'), 'utf8');
  /* 定位串必须拼出来：写成一整个字面量时，indexOf 会先命中这一行自己，
   * out 里就带着守卫源码，`/.facts/` 误伤自己（第一版真这么红过一次）。 */
  const mark = ['/*', ' ───── 输出 ───── ', '*/'].join('');
  const at = self.lastIndexOf(mark);
  const out = at >= 0 ? self.slice(at) : '';
  /* 定位失效时 slice(-1) 只剩一个字符，下面两条守卫会全部恒真；更进一步，
   * 若 at 落在守卫块自己那一行，out 会带着后面的 `.test(out)` 源码，
   * 那两条守卫会「误伤自己」而红——看着像抓住了，其实定位已经错了。
   * 所以这里要求切出来的是纯输出区：既含末尾的合计，也不含守卫代码。 */
  must(
    at >= 0 && out.includes('合计：') && !out.includes('.test(out)'),
    '确实切到了输出区（切错时下面两条会恒真或误伤自己）',
  );
  must(!/\b(inConclusion|inPremises|onlyInConclusion|onQuietOnly)\b/.test(out), '输出区没有读报告侧字段');
  must(!/\.facts\b/.test(out), '输出区没有打印纯函数写给「有报告」看的 facts');
}

if (bad) {
  console.error(`\n${bad} 条自检失败，下面的数字不可信。`);
  process.exit(1);
}

/* ───── 输出 ───── */
const sentencesLabel = (ids: number[]): string =>
  ids.length ? ids.map((i) => `第 ${i + 1} 句`).join('、') : '—';
/* 终端里中文占两格、ASCII 占一格；按显示宽度用半角空格补齐，别让 Bartik 那行错位。 */
const displayWidth = (s: string): number =>
  [...s].reduce((n, ch) => n + (/^[\x00-\xff]$/.test(ch) ? 1 : 2), 0);
const padDisp = (s: string, width: number): string =>
  s + ' '.repeat(Math.max(1, width - displayWidth(s)));

console.log('外部学术样本 · 词汇层字面账');
console.log(`文本：${FIELD_SAMPLES.length} 段公开期刊摘要，逐字抄自出处页（抓取日 2026-11-09）`);
console.log('自检通过：构造样本切出 3 句、命中词 2 次落第 1/3 句、对照词 0 次；样本出处齐全、词表有命中也有落空。\n');

let totalWords = 0;
let totalHit = 0;
let totalCross = 0;
let totalSentences = 0;

for (const [i, { sample: s, sentences, rows }] of views.entries()) {
  const hitRows = rows.filter((r) => r.count > 0);
  const cross = hitRows.filter((r) => r.sentences.length >= 2);
  totalWords += s.words.length;
  totalHit += rows.filter((r) => s.words.includes(r.word) && r.count > 0).length;
  totalCross += cross.filter((r) => s.words.includes(r.word)).length;
  totalSentences += sentences.length;

  console.log(`── [${i + 1}] ${s.field} ── ${s.title}`);
  console.log(`   作者/出处：${s.authors}｜${s.venue}｜${s.date}`);
  console.log(`   页面：${s.url}${s.doi ? `｜DOI ${s.doi}` : ''}`);
  console.log(`   体裁：${s.kind}（不是论文正文里的论证段落）｜原文 ${sentences.length} 句 / ${s.text.length} 字`);
  console.log(`   词表（${s.words.length} 个 + 对照 1 个）：${s.words.join('、')}｜对照：${s.control}`);
  console.log(`   词表来源：${s.wordsFrom}`);
  for (const r of rows) {
    const tail = r.word === s.control ? '（对照词）' : '';
    console.log(
      `     ${padDisp(r.word, 18)} ${String(r.count).padStart(2)} 次 · ` +
        `${sentencesLabel(r.sentences)} · 首现第 ${r.firstAt < 0 ? '—' : r.firstAt + 1} 字${tail}`,
    );
  }
  console.log(
    `   命中 ${hitRows.filter((r) => s.words.includes(r.word)).length}/${s.words.length} 个词 · ` +
      `没出现 ${rows.filter((r) => r.count === 0).length} 个（含对照词） · ` +
      `跨 ≥2 句的词 ${cross.filter((r) => s.words.includes(r.word)).length} 个`,
  );
  console.log('   报告侧（结论文字 / 前提文字 / 只在结论里 / quiet 句）：未计 —— 没有真模型报告，见边界 5。\n');
}

console.log(
  `合计：${views.length} 段、${totalSentences} 句、词表 ${totalWords} 个，按字面命中 ${totalHit} 个，` +
    `其中跨 ≥2 句 ${totalCross} 个。以上数字由本命令当场算，不写进文档。`,
);
console.log(`
边界（这几条决定了上面的数能被读成什么）：
  1. 这是从网上找来的公开期刊摘要，不是用户自己专业里的文本，不是本机存档，
     不是真实使用证据，也不是 P2 的输入。本机 103 份存档里带学术字面线索的仍是 0 份。
  2. 摘要是「本文做了什么」的元陈述，不是论文正文里的论证段落；这里量的是专业词的
     字面分布，不是论证结构，更不是「这段论证站不站得住」。把它当论证文本就是造假。
  3. 词表由本次分析按出处页关键词与正文挑，不是领域专家给的、不是软件内置词库；
     每段另放一个该圈常见但本文没用的对照词，用来确认「没出现」那一列不是空的。
  4. 逐字依赖转录：不同站点标点不同（半角/全角逗号），url 是口径的一部分；
     换一页抄，字面次数可能变。互相包含的两个词各算各的，不做分词与归一。
  5. 报告侧四项**未计**：这三段只有原文，没有真模型报告。把空报告传进去，纯函数
     会写出「报告结论文字里没有这个词」——那是缺输入，不是事实，所以本脚本只采信
     count / firstAt / sentences / missing 四个原文字段。要验那一半得先有一次真模型
     分析（本机无 Key、无本地模型、余额为空）。
  6. 结论只是「原文侧有可复算的字面信号」，不是「主线有进展」：本地独立判定点占比
     仍是 4.8%，「不按学科切换标准」没有被推翻，人填完这几个词是不是更会读自己
     那一行，仍是零证据。`);
