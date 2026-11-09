/**
 * 「逐字比」的断言：原话那一句 vs 报告整理出来的那一句。
 *
 * 这一层最容易坏在「说了句看起来对的话」：
 *   1. 按下标对齐而不是最长公共子序列——中间插两个字，后面全被算成改动；
 *   2. 把纯标点 / 单个字的噪声当成一处改动；
 *   3. 比不出来时给一张空表，读的人分不清「没改」与「本地没比」；
 *   4. 顺手替报告下判断（「改错了」「越界」）——这一层只列字面；
 *   5. 界面根本没把它贴到主张上，纯函数绿着却一个字也看不见。
 *
 * 防恒真写在样本里：片段顺序用两处删除的样本验（只有一处时怎么排都对）；
 * 「不把后面全算成改动」用中间插字的样本验；只读用全新样本验（被调用过的样本量不出污染）。
 *
 * 跑法：npm run check:rewrite
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REWRITE_MAX_CHARS, REWRITE_NOTE, rewriteOf, rewriteSummary } from '@shared/rewrite';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}

const src = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');

/* ─────────── 样本 ─────────── */

const MAIN = { quote: '这说明取消早读是错的', text: '取消早读是错的，应当恢复早读' };
const SAME = { quote: '取消早读是错的', text: '取消早读是错的' };
const NO_QUOTE = { quote: null, text: '取消早读是错的' };
const EMPTY_TEXT = { quote: '取消早读是错的', text: '' };
const EMPTY_QUOTE = { quote: '', text: '取消早读是错的' };
const ONE_CHAR = { quote: '取消早读是错的', text: '取消早读是对的' };
const PUNCT_ONLY = { quote: '取消早读是错的', text: '取消早读是错的。' };
const MIDDLE_INSERT = { quote: '甲支持乙反对丙', text: '甲支持并且乙反对丙' };
const TWO_GONE = { quote: '第一步因为甲所以乙并且因此丙', text: '第一步甲乙丙' };
const WHITESPACE = { quote: '取消 早读　是错的', text: '取消早读是错的' };
const TOO_LONG = { quote: '甲'.repeat(REWRITE_MAX_CHARS + 1), text: '乙'.repeat(8) };

/* ─────────── 主样本：两处连续改动 ─────────── */

const m = rewriteOf(MAIN);
ok(m !== null, '两句不同 → 有得比');
ok(m?.kind === 'fragments', '主样本读得出连续片段', String(m?.kind));
ok(m?.quoteChars === 10 && m?.textChars === 14, '字数按去空白后的字算（10 / 14）', `${m?.quoteChars}/${m?.textChars}`);
ok(JSON.stringify(m?.gone) === JSON.stringify(['这说明']), '原话没接上的那段逐字列出来', JSON.stringify(m?.gone));
ok(JSON.stringify(m?.added) === JSON.stringify(['应当恢复早读']), '这一句里对不上原话的那段逐字列出来', JSON.stringify(m?.added));
ok(m?.line === '本地逐字比：原话 10 字、这一句 14 字；1 段没接上、1 段对不上。', '总述逐字核，数字带单位', String(m?.line));
ok(m?.detail === '原话里有、这一句没接上：「这说明」；这一句里、原话对不上：「应当恢复早读」', '明细逐字核', String(m?.detail));
ok(m?.gone.every((g) => m.quote.includes(g)) === true, '「没接上」的片段逐字来自原话');
ok(m?.added.every((a) => m.text.includes(a)) === true, '「对不上」的片段逐字来自这一句');

/* ─────────── LCS：中间插字不许把后面全算成改动 ─────────── */

const ins = rewriteOf(MIDDLE_INSERT);
ok(ins !== null && ins.gone.length === 0, '中间插两个字，原话一段都不该被算成没接上（按下标对齐会红）', JSON.stringify(ins?.gone));
ok(JSON.stringify(ins?.added) === JSON.stringify(['并且']), '只多出插进去那一段', JSON.stringify(ins?.added));

/* ─────────── 片段顺序：两处删除，按原话出现顺序 ─────────── */

const two = rewriteOf(TWO_GONE);
ok(two !== null && two.gone.length >= 2, '两处删除的样本确实读得出两段（否则顺序断言恒真）', JSON.stringify(two?.gone));
ok(
  two !== null && two.gone.length >= 2 && two.quote.indexOf(two.gone[0]) < two.quote.indexOf(two.gone[1]),
  '片段按原话里的先后顺序排，不是倒着给',
  JSON.stringify(two?.gone)
);
ok(two !== null && two.added.length === 0, '只删没加的样本，不许凭空造出「对不上」的片段', JSON.stringify(two?.added));

/* ─────────── 噪声：单字与纯标点 ─────────── */

const one = rewriteOf(ONE_CHAR);
ok(one?.kind === 'one-char', '只差一个字 → 单列一档', String(one?.kind));
ok(one?.gone.length === 0 && one?.added.length === 0, '单字差异不凑成一段', JSON.stringify([one?.gone, one?.added]));
ok(one?.line === '本地逐字比：原话 7 字、这一句 7 字；只差单个字，读不出连续的片段。', '比不出来时明说，不给空表', String(one?.line));
ok(one?.detail === null, '没片段就不给明细', String(one?.detail));
const pun = rewriteOf(PUNCT_ONLY);
ok(pun?.kind === 'one-char' && pun.gone.length === 0 && pun.added.length === 0, '只多一个句号不算一处改动', JSON.stringify([pun?.kind, pun?.gone, pun?.added]));

/* ─────────── 四种「没有」各归各 ─────────── */

ok(rewriteOf(SAME) === null, '两句逐字相同 → 整行不显示');
ok(rewriteOf(NO_QUOTE) === null, '没有引文（隐含前提）→ 整行不显示');
ok(rewriteOf(EMPTY_TEXT) === null, '这一句为空 → 整行不显示');
ok(rewriteOf(EMPTY_QUOTE) === null, '引文为空 → 整行不显示');
ok(rewriteOf(WHITESPACE) === null, '只差空格不算改写（比的是去空白后的字面）');

const long = rewriteOf(TOO_LONG);
ok(long?.kind === 'too-long', '超上限单列一档', String(long?.kind));
ok(long?.line === `本地没比完：原话 ${REWRITE_MAX_CHARS + 1} 字、这一句 8 字，超过本地逐字比上限 ${REWRITE_MAX_CHARS} 字。`, '超上限明说「没比完」，不悄悄按前 400 字算', String(long?.line));
ok(long?.gone.length === 0 && long?.added.length === 0 && long?.detail === null, '没比完就不给片段');

/* ─────────── 不下判断 ─────────── */

const JUDGEMENT = /越界|改错|改对|错误|建议|应该|最好|合理|不合理|不该|务必|一定得/;
ok(!JUDGEMENT.test(one?.line ?? '') && !JUDGEMENT.test(m?.line ?? '') && !JUDGEMENT.test(long?.line ?? ''), '总述里不替报告下判断');
ok(!JUDGEMENT.test(REWRITE_NOTE), '界面说明里不替报告下判断', REWRITE_NOTE);
ok(REWRITE_NOTE === '只比字面，不判改写对不对；这两句都是报告自己写下的。', '说明逐字核', REWRITE_NOTE);
ok(m?.detail?.includes('应当恢复早读') === true, '片段是逐字照抄的，不因为原话里有「应当」就把它删掉', String(m?.detail));

/* ─────────── 只读：用全新样本，不量被前面调用污染过的对象 ─────────── */

const fresh = { quote: '这说明取消早读是错的', text: '取消早读是错的，应当恢复早读' };
const before = JSON.stringify(fresh);
rewriteOf(fresh);
rewriteSummary([fresh]);
ok(JSON.stringify(fresh) === before, '核一遍不改入参里的任何一个字段');

/* ─────────── 整份报告的一句总述 ─────────── */

ok(rewriteSummary([]) === null, '一条主张都没有 → 不写「0 条」');
ok(rewriteSummary([SAME, NO_QUOTE]) === null, '全都没被整理过 → 不写「0 条」');
const sum = rewriteSummary([MAIN, SAME, MIDDLE_INSERT, ONE_CHAR]);
ok(sum === '4 条主张里，3 条被整理成另一句话；2 条读得出连续的改动。', '总述只数事实，不挑哪一条最值得看', String(sum));
const sumLong = rewriteSummary([MAIN, TOO_LONG]);
ok(sumLong === '2 条主张里，2 条被整理成另一句话；1 条读得出连续的改动，其中 1 条本地没比完。', '有没比完的条数要点名', String(sumLong));

/* ─────────── 源码守卫：这一块必须真的贴到主张上 ─────────── */

const diagnosis = src('src/renderer/src/components/Diagnosis.tsx');
const mainTsx = src('src/renderer/src/main.tsx');
const mockTsx = src('src/renderer/src/mock.tsx');
const css = src('src/renderer/src/styles-rewrite.css');

ok(/rewriteOf\(claim\)/.test(diagnosis), 'ClaimCard 里真的调用了 rewriteOf（盯调用点，不是 import 那一行）');
ok(diagnosis.indexOf('data-rewrite') > diagnosis.indexOf('claim-quote'), '逐字比显示在引文那一行之后（不是报告外面另起一栏）');
ok(/data-rewrite=/.test(diagnosis), '界面上有这一块可点名');
ok(/data-rewrite-line=/.test(diagnosis) && /data-rewrite-detail=/.test(diagnosis), '界面上有可读的行与可点名的明细行');
ok(/data-rewrite-note=/.test(diagnosis), '说明单独成行，不混进片段里');
ok(diagnosis.includes('>{REWRITE_NOTE}<'), '界面把「不判改写对不对」这句说明印出来（盯渲染点，不是 import 那一行）');
const cardStart = diagnosis.indexOf('function ClaimCard');
const cardEnd = diagnosis.indexOf('/* ═══════', cardStart);
const cardBody = cardStart >= 0 ? diagnosis.slice(cardStart, cardEnd > cardStart ? cardEnd : cardStart + 2600) : '';
ok(cardBody.length > 400, '源码守卫真的截到了 ClaimCard 这一段（截不到时下面几条会全绿）', String(cardBody.length));
ok(!/改错|越界|建议改成|应该改成/.test(cardBody), 'ClaimCard 这一块不替报告下判断');
ok(/styles-rewrite\.css/.test(mainTsx) && /styles-rewrite\.css/.test(mockTsx), '样式在应用与预览页两处都引入了');
ok(/\.claim-rewrite/.test(css), '样式表里真有这一块');
ok(/QS\.get\('rewrite'\)/.test(mockTsx), '预览页留了 ?rewrite=1 的截图入口');

const smokeMjs = src('scripts/smoke.mjs');
const packMjs = src('scripts/pack-smoke.mjs');
const pkg = JSON.parse(src('package.json'));
ok(/jOfLine\('REWRITERESULT'\)/.test(smokeMjs), '端到端真的接了逐字比探针（源码里跑的断言，包坏不坏它不知道）');
ok(/includes\('REWRITERESULT'\)/.test(packMjs), '包内断言真的接了逐字比探针');
ok(typeof pkg.scripts['check:rewrite'] === 'string', 'check:rewrite 已注册进 package.json');

/* ─────────── 输出 ─────────── */

if (failed.length) {
  console.error(`逐字比：${passed} 条通过，${failed.length} 条失败`);
  for (const f of failed) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`逐字比：${passed} 条全部通过`);
