/**
 * 「这一圈的词」的断言。
 *
 * 这一块最容易坏在几种不报错的地方：
 *   1. 词表由本地「自动认词」——先量过：15 段学术体裁里显式定义词 0 命中，
 *      这条路做出来必是空面板，所以纯函数里不许再长出一张启发式词表；
 *   2. 把报告文字当成原文（实测 406/407 条主张的 text 与 quote 不同），
 *      于是「结论里出现」被写成「原文里出现」；
 *   3. 空词表或全不命中时写「0 处」「没问题」——恒真样本上怎么改都绿；
 *   4. 界面另写一份抬头／边界，慢慢与纯函数说成两件事；
 *   5. 只剩 import、样式没引、预览入口没挂，纯函数绿着却一个字看不见。
 *
 * 防恒真写在样本里：构造的原文必须有词命中、有词不命中、有词只在报告里出现、
 * 有 quiet 句也有非 quiet 句；任何一条「算得对」都不允许在空样本上成立。
 *
 * 跑法：npm run check:terms
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FIELD_TERMS_CAVEAT,
  FIELD_TERMS_PLAIN,
  FIELD_TERMS_SPLIT,
  FIELD_TERMS_TITLE,
  fieldTermsOf,
  parseWords,
  type FieldSentence,
} from '@shared/field-terms';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}
const src = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');

/* ─────────── 一 · 词表解析 ─────────── */

ok(parseWords('资本, 剩余价值、劳动').length === 3, '逗号与顿号混合切词');
ok(parseWords('资本\n剩余价值 劳动').length === 3, '换行与空格混合切词');
ok(parseWords('资本，资本，劳动').length === 2, '重复词去重');
ok(parseWords('资本，资本，劳动').join('|') === '资本|劳动', '去重后保序');
ok(parseWords('  资本  ').join('|') === '资本', '首尾空白去掉');
ok(parseWords('').length === 0 && parseWords('  \n ').length === 0, '空输入得空表');
ok(parseWords('Value, value').length === 2, '不改写词本身：大小写照字面保留');
ok(parseWords('劳动，资本').join('|') === '劳动|资本', '输入顺序不被排序（倒序样本）');

/* ─────────── 二 · 构造样本：位置全部实算过，不心算 ─────────── */

/*
 * passage = 资本是指一种社会关系。资本不是物。因此，剩余价值来自劳动。
 * 句 0 [0,11)  句 1 [11,17)  句 2 [17,29)
 * 「资本」在 0、11；「剩余价值」在 20；「劳动」在 26。
 * 报告文字故意与原文不同：结论「剩余价值来自劳动，剥削率上升」，
 * 前提「资本是一种社会关系」——「剥削率」只在报告里，原文没有。
 */
const PASSAGE = '资本是指一种社会关系。资本不是物。因此，剩余价值来自劳动。';
const SENTENCES: FieldSentence[] = [
  { index: 0, start: 0, end: 11, text: '资本是指一种社会关系。' },
  { index: 1, start: 11, end: 17, text: '资本不是物。' },
  { index: 2, start: 17, end: 29, text: '因此，剩余价值来自劳动。' },
];
ok(
  SENTENCES.map((s) => s.text).join('') === PASSAGE,
  '构造样本自洽：三句逐字拼回原文（否则下面所有坐标断言都不可信）',
);
const BASE = {
  passage: PASSAGE,
  sentences: SENTENCES,
  conclusion: '剩余价值来自劳动，剥削率上升',
  premises: ['资本是一种社会关系'],
  quietSentences: [2],
};

const words = ['资本', '剩余价值', '劳动', '剥削率', '全不在'];
const snapshot = JSON.stringify({ BASE, words });
const v = fieldTermsOf({ ...BASE, words });

ok(JSON.stringify({ BASE, words }) === snapshot, '算一遍不改输入（只读）');
ok(v.rows.length === 5, '每个词一行，一个不少', String(v.rows.length));
ok(v.rows.map((r) => r.word).join('|') === words.join('|'), '行序＝词表顺序，不按命中数排序');
ok(v.state === 'ok', '样本非平凡：应落到 ok 状态', v.state);

const byWord = Object.fromEntries(v.rows.map((r) => [r.word, r]));

ok(byWord['资本']?.count === 2, '「资本」原文出现 2 次', String(byWord['资本']?.count));
ok(byWord['资本']?.firstAt === 0, '「资本」首现在第 0 字');
ok(byWord['资本']?.sentences.join(',') === '0,1', '「资本」落在第 1、2 句', byWord['资本']?.sentences.join(','));
ok(byWord['资本']?.onQuietOnly === false, '「资本」不是只落在没被钉住的句子');
ok(byWord['剩余价值']?.count === 1, '「剩余价值」原文出现 1 次');
ok(byWord['剩余价值']?.firstAt === 20, '「剩余价值」首现在第 20 字');
ok(byWord['剩余价值']?.sentences.join(',') === '2', '「剩余价值」落在第 3 句');
ok(byWord['剩余价值']?.inConclusion === true, '「剩余价值」在报告结论文字里');
ok(byWord['剩余价值']?.inPremises === false, '「剩余价值」不在报告前提文字里');
ok(byWord['剩余价值']?.onlyInConclusion === true, '「剩余价值」只在结论文字里出现');
ok(byWord['剩余价值']?.onQuietOnly === true, '「剩余价值」只落在没被钉住的句子');
ok(byWord['劳动']?.onQuietOnly === true, '「劳动」也只落在没被钉住的句子');
ok(v.missing.join('|') === '剥削率|全不在', '原文里找不到的两个词单独列出', v.missing.join('|'));
ok(byWord['剥削率']?.count === 0, '「剥削率」原文里 0 次');
ok(byWord['剥削率']?.firstAt === -1, '没出现的词首现下标为 -1');
ok(byWord['剥削率']?.inConclusion === true, '「剥削率」在报告结论文字里（报告文字可以与原文不同）');
ok(byWord['剥削率']?.onlyInConclusion === true, '只在报告里出现的词也被标出来');
ok(byWord['全不在']?.facts[0]?.includes('一次都没出现'), '没命中的词明说，不给静默空行');

/* 数字不能是写死的：用另一组坐标独立复算一遍，换 passage 期望值就得跟着变。 */
const alt = fieldTermsOf({
  ...BASE,
  passage: '资本。资本。资本。',
  sentences: [
    { index: 0, start: 0, end: 3, text: '资本。' },
    { index: 1, start: 3, end: 6, text: '资本。' },
    { index: 2, start: 6, end: 9, text: '资本。' },
  ],
  words: ['资本'],
  quietSentences: [],
});
ok(alt.rows[0]?.count === 3, '换一段原文，「资本」命中数跟着变（不是常量）');
ok(alt.rows[0]?.sentences.join(',') === '0,1,2', '换一段原文，落句跟着变');
ok(alt.rows[0]?.onQuietOnly === false, '没有 quiet 句时不标 quiet-only');

/* 倒序 id 样本：句子按原文位置排，但 index 故意倒着给（2/1/0），
 * 于是「资本」两次命中的原始 id 序列是 2,1——不排序就会露出来。
 * 只把数组顺序打乱不够：区间不重叠时命中顺序仍由位置决定，断言会恒真。 */
const shuffled = fieldTermsOf({
  ...BASE,
  sentences: [
    { index: 2, start: 0, end: 11, text: '资本是指一种社会关系。' },
    { index: 1, start: 11, end: 17, text: '资本不是物。' },
    { index: 0, start: 17, end: 29, text: '因此，剩余价值来自劳动。' },
  ],
  words: ['资本'],
  quietSentences: [],
});
ok(shuffled.rows[0]?.sentences.join(',') === '1,2', '传入倒序 id 的句子后，落句仍按 index 升序');

/* 互相包含的两个词各算各的——不许吞词。 */
const overlap = fieldTermsOf({ ...BASE, words: ['资本', '资本家'], quietSentences: [] });
ok(overlap.rows[0]?.count === 2 && overlap.rows[1]?.count === 0, '包含关系各算各的，不互相吞');

/* ─────────── 三 · 边界状态：空表与全不命中不许说假话 ─────────── */

const empty = fieldTermsOf({ ...BASE, words: [] });
ok(empty.state === 'empty' && empty.rows.length === 0, '空词表落 empty 状态');
ok(empty.note.includes('你还没填词'), '空词表说「还没填」，不写 0 处');
ok(!empty.note.includes('没问题') && !empty.note.includes('0 处'), '空词表不许说「没问题」');

const none = fieldTermsOf({ ...BASE, words: ['甲', '乙'], quietSentences: [2] });
ok(none.state === 'none-hit', '全不命中落 none-hit 状态');
ok(none.note.includes('一个都没出现'), '全不命中照实说');
ok(!none.note.includes('没问题'), '全不命中不许说「没问题」');
ok(none.rows.length === 2 && none.rows.every((r) => r.facts.length > 0), '全不命中时每行仍有事实，不给空表');
ok(none.missing.join('|') === '甲|乙', '全不命中时两个词都在 missing 里');

/* ─────────── 四 · 常量与源码边界 ─────────── */

ok(FIELD_TERMS_TITLE.length > 0 && FIELD_TERMS_PLAIN.length > 20, '抬头与说明常量有内容');
ok(FIELD_TERMS_CAVEAT.includes('不判术语有没有换义'), '边界明写不判换义');
ok(FIELD_TERMS_CAVEAT.includes('不存盘'), '边界明写不落盘');
ok(FIELD_TERMS_CAVEAT.includes('可能已被模型改写'), '边界明写报告文字与原文分开');
ok(FIELD_TERMS_SPLIT.includes('一行一个'), '分隔说明在常量里');

const core = src('src/shared/field-terms.ts');
/* 先量过：学术体裁上显式定义词 0 命中。启发式词表不许偷偷长回来。 */
ok(!/是指|所谓|称为|定义为|DEFINITION_CUES/.test(core), '纯函数里没有自动认词／定义标志词表');
ok(!/换义了|报告漏了|应当|建议|站不住/.test(core.replace(/\/\*[\s\S]*?\*\//g, '')), '纯函数的代码里不写判定或劝告');

/* ─────────── 五 · 界面接线 ─────────── */

const bar = src('src/renderer/src/components/FieldTermsBar.tsx');
const diag = src('src/renderer/src/components/Diagnosis.tsx');
const css = src('src/renderer/src/styles-field-terms.css');
const main = src('src/renderer/src/main.tsx');
const mock = src('src/renderer/src/mock.tsx');

ok(/fieldTermsOf\(\{/.test(bar), '组件真的调用纯函数，不是只剩 import');
ok(/parseWords\(raw\)/.test(bar), '词表走 parseWords，不在组件里另切一遍');
ok(/rereadOf\(d\)/.test(bar) && /sentenceBounds\(/.test(bar), 'quiet 句与切句复用已有纯函数');
ok(/FIELD_TERMS_TITLE/.test(bar) && /FIELD_TERMS_PLAIN/.test(bar), '抬头与说明取自常量');
ok(/FIELD_TERMS_CAVEAT/.test(bar) && /FIELD_TERMS_SPLIT/.test(bar), '边界与分隔说明取自常量');
ok(
  !bar.includes(FIELD_TERMS_CAVEAT) && !bar.includes(FIELD_TERMS_PLAIN) && !bar.includes(FIELD_TERMS_SPLIT),
  '界面没有另抄一份常量文案',
);
ok(/data-terms-bar/.test(bar) && /data-terms-panel/.test(bar), '收起栏与展开面板都有 DOM 探针');
ok(/data-terms-input/.test(bar) && /data-terms-note/.test(bar), '输入框与总述都有 DOM 探针');
ok(/data-terms-row=\{r\.word\}/.test(bar), '每行带可点名的词');
ok(/data-terms-state=\{view\.state\}/.test(bar), '状态来自纯函数，不是界面自己判');
ok(/data-terms-caveat/.test(bar) && /data-terms-toggle/.test(bar), '边界与展开按钮都在');
ok(/useState\(initialOpen\)/.test(bar) && /useState\(initialWords\)/.test(bar), '预览页能直接给展开状态与演示词');
ok(!/判定在本地|换义了|报告漏了|术语错了|建议|应当/.test(bar.replace(/\/\*[\s\S]*?\*\//g, '')), '组件里不写判定或劝告');

/* 只剩 import 也绿是老坑：必须真的在 JSX 里渲染，且传的是当前报告 d。 */
ok(/<FieldTermsBar d=\{d\} initialOpen=\{!!initialTerms\} initialWords=\{initialTermsWords\} \/>/.test(diag), '学术分析区块里真的渲染了这一栏');
ok(/import \{ FieldTermsBar \} from '\.\/FieldTermsBar'/.test(diag), '组件 import 接上');
ok(/initialTerms\?: boolean/.test(diag) && /initialTermsWords\?: string/.test(diag), '预览页参数在签名里');
ok(main.includes('styles-field-terms.css') && mock.includes('styles-field-terms.css'), '真应用与预览页都引入样式表');
ok(/\.ft-bar/.test(css) && /\.ft-row/.test(css) && /\.ft-caveat/.test(css), '样式表里有收起栏、行与边界的样式');
ok(/QS\.get\('terms'\)/.test(mock) && /<TermsAnchor \/>/.test(mock), '?terms=1 预览入口挂上了');
ok(/initialTerms=\{QS\.get\('terms'\) === '1'\}/.test(mock), '预览入口把这一栏展开');
ok(/initialTermsWords=/.test(mock), '预览入口预填演示词');
ok(/data-terms-bar/.test(mock), '预览锚点滚到这一栏');

/* 端到端与包内：源码守卫本身也要接上，否则纯函数绿着、包里那一块整块消失。 */
const smokeTs = src('src/main/smoke.ts');
const smokeMjs = src('scripts/smoke.mjs');
const packMjs = src('scripts/pack-smoke.mjs');
ok(/TERMSRESULT/.test(smokeTs) && /data-terms-input/.test(smokeTs), '真应用探针真的读了这一栏');
ok(/jOfLine\('TERMSRESULT'\)/.test(smokeMjs), '端到端真的接了这一栏的探针');
ok(/includes\('TERMSRESULT'\)/.test(packMjs), '包内断言真的接了这一栏的探针');

/* ─────────── 收口 ─────────── */

if (failed.length) {
  for (const f of failed) console.error(`✗ ${f}`);
  console.error(`\n✗ 这一圈的词 ${failed.length} 条没过（共 ${passed + failed.length} 条）`);
  process.exit(1);
}
console.log(`✓ 这一圈的词：${passed} 条全部通过｜词表由人给、原文与报告分开、空表不说假话、界面文字来自常量`);
