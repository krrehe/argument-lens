/**
 * 长文覆盖账的断言。
 *
 * 这一块最容易坏在几种不报错的地方：
 *   1. 句子带着段间空行，用 s.start 归段会把第 2 段首句算进第 1 段——
 *      「哪段没被碰到」整体偏一格，而守恒断言照样绿；
 *   2. 短文本也摆一条 100% 的账，看着正常，其实是一块空面板；
 *   3. 界面另写一份抬头／边界、或干脆只剩 import，纯函数绿着却一个字看不见；
 *   4. 本地顺手写一句「建议切分」「分析漏了」，把位置事实说成判断。
 *
 * 防恒真写在样本里：长文本必须同时有被钉住的段与没被钉住的段，且
 * **第 2 段的首句被钉住**——退回 s.start 归段时这一条立刻红。
 *
 * 跑法：npm run check:coverage
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Diagnosis } from '@shared/types';
import {
  COVERAGE_LABEL,
  COVERAGE_PREVIEW_CHARS,
  coverageOf,
  coverageScopeText,
} from '@shared/coverage';
import { SEGMENT_HINT_CHARS, segmentPassage } from '@shared/segment';
import { sentenceBounds, rereadOf } from '@shared/reread';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}
const src = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');

/* ─────────── 一 · 构造样本：坐标全部实算，不心算 ─────────── */

const para = (n: number, count = 3): string =>
  Array.from({ length: count }, (_, j) => `这是第${n}段第${j + 1}句话，说明一件事情。`).join('');
/* 最后一段只有两句（34 字）：短于预览上限，保证样本里也有「没截断」的预览。 */
const LONG = Array.from({ length: 20 }, (_, i) => para(i + 1, i === 19 ? 2 : 3)).join('\n\n');
const SHORT = '我们学校去年取消了早读。今年一本率下降了六个百分点。所以早读该恢复。';
const BLANK = '   \n\n  ';

const segs = segmentPassage(LONG);
const bounds = sentenceBounds(LONG);
ok(bounds.map((s) => s.text).join('').replace(/\s/g, '') === LONG.replace(/\s/g, ''), '构造样本自洽：句子逐字拼回原文');
ok(LONG.length >= SEGMENT_HINT_CHARS, '构造样本够长，覆盖账该出现');
ok(segs.length === 20, '构造样本切出 20 段');
ok(bounds.length === 59, '构造样本 59 句（最后一段两句）');
ok(segs.every((s, i) => i === 0 || s.start > segs[i - 1].end), '段区间递增且不重叠');
ok(segs.every((s) => LONG.slice(s.start, s.end) === s.text), '每段区间切出来的字与段文本逐字相同');

/** 第 2 段首句前面带着 \n\n：用它反证「不能用 s.start 归段」。 */
const at2 = LONG.indexOf('这是第2段第1句话');
const at0 = LONG.indexOf('这是第1段第2句话');
ok(at0 >= 0 && at2 >= 0, '两个定位串都在原文里');
ok(bounds[3].text.startsWith('\n\n这是第2段第1句话'), '第 2 段首句的原文确实带着段间空行');
ok(bounds[3].start < segs[1].start, '第 2 段首句的 start 落在第 2 段之前（这就是 off-by-one 的来源）');

type SpanLite = { start: number; end: number };
function diag(passage: string, spans: SpanLite[]): Diagnosis {
  const mk = (s?: SpanLite) =>
    s ? { start: s.start, end: s.end, quote: '', quality: 'exact' as const } : null;
  return {
    passage,
    conclusion: { id: 'c0', text: '结论', quote: '', span: mk(spans[0]) },
    premises: spans.slice(1).map((s, i) => ({ id: `p${i}`, text: '前提', quote: '', span: mk(s) })),
    intermediate: [],
    labels: [],
    legitimateMoves: [],
  } as unknown as Diagnosis;
}
const lenOf = (s: string) => s.length;
const D_LONG = diag(LONG, [
  { start: at0, end: at0 + lenOf('这是第1段第2句话') },
  { start: at2, end: at2 + lenOf('这是第2段第1句话') },
]);

/* ─────────── 二 · 纯函数 ─────────── */

const v = coverageOf(D_LONG);
ok(v.long === true, '长文本 long=true');
ok(v.chars === LONG.length, '字数取自原文长度');
ok(v.sentences === bounds.length, '句数与 sentenceBounds 一致');
ok(v.pinned === rereadOf(D_LONG).sentences.filter((s) => !s.quiet).length, '钉住数与 rereadOf 的 quiet 口径一致');
ok(v.pinned === 2, '构造样本恰好两句被钉住');
ok(v.quiet === v.sentences - v.pinned, 'quiet = 总句数 − 钉住数');
ok(v.segmentCount === segs.length, '段数取自切分条');
ok(v.segments.reduce((n, s) => n + s.sentences, 0) === v.sentences, '守恒：各段句数之和 = 总句数');
ok(v.segments.reduce((n, s) => n + s.pinned, 0) === v.pinned, '守恒：各段钉住之和 = 钉住总数');
ok(v.untouched === 18, '20 段里 18 段一句都没被落上');
ok(v.segments[0].pinned === 1, '第 1 段被钉住一句');
ok(v.segments[1].pinned === 1, '第 2 段被钉住一句（退回 s.start 归段时这条会红）');
ok(v.segments[2].pinned === 0, '第 3 段一句都没被钉住');
ok(v.segments.every((s, i) => s.index === i), '段 index 与切分条一致、连续且不重排');
ok(v.segments.every((s, i) => s.chars === segs[i].chars), '各段字数取自切分条');
ok(
  v.segments.every((s, i) => s.preview === segs[i].text.replace(/\s+/g, ' ').trim().slice(0, COVERAGE_PREVIEW_CHARS)),
  '段落预览逐字取自原文（只归一空白、不改写）',
);
ok(v.segments.every((s, i) => s.previewTruncated === (segs[i].text.replace(/\s+/g, ' ').trim().length > COVERAGE_PREVIEW_CHARS)), '截断标记按原段长度算（与 preview 是否被改写无关）');
ok(v.segments.some((s) => s.previewTruncated) && v.segments.some((s) => !s.previewTruncated), '样本里既有截断的预览也有没截断的');
ok(JSON.stringify(coverageOf(D_LONG)) === JSON.stringify(v), '同一输入两次调用结果相同（纯函数）');
ok(v.sharePct === Math.round((v.pinned / v.sentences) * 100), '百分比由句数实算，不写死');
ok(v.sharePct === 3, '构造样本 2/59 句 = 3%');
ok(v.partial === true, '长文有句子没落上时 partial=true（判定那一栏要带范围）');

/* 范围句：只在长文且未全覆盖时用；数字与「检查依据不计入」都必须写出来 */
const ADVICE = /建议|应该|最好|不妨|请|值得一试|推荐|务必/;
const scope = coverageScopeText(v.pinned, v.sentences, v.untouched);
ok(scope.includes('2 句') && scope.includes('59 句'), '范围句带着钉住句数与总句数');
ok(scope.includes('3%'), '范围句带着百分比');
ok(scope.includes('57 句') && scope.includes('18 段'), '范围句带着未落上的句数与段数');
ok(/自由文字/.test(scope) && /不在这个数里/.test(scope), '范围句明写检查依据不计入');
ok(!ADVICE.test(scope), '范围句不劝告、不写「建议」');
ok(!/漏了|错误|失败/.test(scope), '范围句不替报告判「漏了」');

/* 全覆盖样本：一句一句都被钉住时 partial=false，界面不该再补一句废话 */
const FULL = '甲'.repeat(SEGMENT_HINT_CHARS);
const D_FULL = diag(FULL, [{ start: 0, end: FULL.length }]);
const full = coverageOf(D_FULL);
ok(full.pinned === full.sentences && full.sentences === 1, '全覆盖样本：唯一一句被钉住');
ok(full.partial === false, '全覆盖时 partial=false');

/* 阈值两侧：不能只在够长的样本上验 long */
const justUnder = diag('甲'.repeat(SEGMENT_HINT_CHARS - 1), []);
const justOver = diag('甲'.repeat(SEGMENT_HINT_CHARS), []);
ok(coverageOf(justUnder).long === false, `短于 ${SEGMENT_HINT_CHARS} 字不摆账`);
ok(coverageOf(justOver).long === true, `达到 ${SEGMENT_HINT_CHARS} 字才摆账`);
ok(coverageOf(diag(SHORT, [])).long === false, '短文本不摆账（不是空面板，是根本不出现）');

/* 没有条目钉住 / 空文本 / 全空白：不崩、不说假话 */
const none = coverageOf(diag(LONG, []));
ok(none.pinned === 0 && none.untouched === 20, '没有任何条目时，20 段都算没被落上');
ok(!/没问题|一切正常|全部覆盖/.test(none.headline), '缺口满屏时不写「没问题」');
const empty = coverageOf(diag('', []));
ok(empty.long === false && empty.sentences === 0 && empty.segmentCount === 0, '空原文不崩、不给数字');
const blank = coverageOf(diag(BLANK, []));
ok(
  blank.segments.reduce((n, s) => n + s.sentences, 0) === blank.sentences,
  '全空白原文（切不出段但仍算一句）守恒仍然成立',
);
ok(blank.segmentCount === 1 && blank.segments[0].chars === BLANK.length, '全空白时补了一段覆盖全文的兜底段');

/* ─────────── 三 · 文案与边界 ─────────── */

ok(!ADVICE.test(COVERAGE_LABEL.note), '边界说明不劝告');
ok(!ADVICE.test(v.headline), '总述不劝告');
ok(!/漏了|错误|不对|失败/.test(v.headline), '总述不写判断词');
ok(!/不等于分析漏了/.test(COVERAGE_LABEL.note), '不再用「没被落上 ≠ 漏了」替模型打包票');
ok(/本地分不出来/.test(COVERAGE_LABEL.note), '明写本地分不出未落上的段是不是推理');
ok(/检查项/.test(COVERAGE_LABEL.note) && /不计入/.test(COVERAGE_LABEL.note), '明写检查项的自由文字不计入这个数');
ok(/本地不改判定/.test(COVERAGE_LABEL.note), '明写本地不改判定');
ok(v.headline.includes(String(v.sentences)) && v.headline.includes(String(v.pinned)), '总述带着句数与钉住数');
ok(v.headline.includes(String(v.segmentCount)) && v.headline.includes(String(v.untouched)), '总述带着段数与未碰段数');
ok(typeof COVERAGE_LABEL.title === 'string' && COVERAGE_LABEL.title.length > 0, '抬头常量存在');
ok(typeof COVERAGE_LABEL.empty === 'string' && COVERAGE_LABEL.empty.length > 0, '「全被碰上」那一档也有说法');

const kernel = src('src/shared/coverage.ts');
ok(/import \{ rereadOf \} from '@shared\/reread'/.test(kernel), '句子与钉住口径复用 rereadOf，不另切一次');
ok(/import \{ segmentPassage, SEGMENT_HINT_CHARS/.test(kernel), '段落与阈值复用切分条，不另写一个 800');
ok(/trimStart\(\)/.test(kernel), '归段前剥掉句子前导空白（防 off-by-one 的那一行在）');
ok(!/\bscore\b|\bverdict\b|\brecommend\b/.test(kernel), '内核不产生评分、判定或推荐字段');
ok(/!segs\.length && sentences\.length/.test(kernel), '切不出段时的兜底在');

/* ─────────── 四 · 界面接线（源码守卫，防「只剩 import 也绿」） ─────────── */

const bar = src('src/renderer/src/components/CoverageBar.tsx');
const diagTsx = src('src/renderer/src/components/Diagnosis.tsx');
const mainTsx = src('src/renderer/src/main.tsx');
const mockTsx = src('src/renderer/src/mock.tsx');
const css = src('src/renderer/src/styles-coverage.css');

ok(/<CoverageBar d=\{d\} \/>/.test(diagTsx), '报告主体里真的渲染了覆盖账（不是只有 import）');
ok(/import \{ CoverageBar \} from '\.\/CoverageBar'/.test(diagTsx), '主报告组件引了它');
ok(/if \(!v\.long\) return null/.test(bar), '短文本时组件整块不渲染');
ok(/useMemo\(\(\) => coverageOf\(d\)/.test(bar), '界面用纯函数算，不另写一份口径');
ok(/COVERAGE_LABEL\.title/.test(bar) && /COVERAGE_LABEL\.note/.test(bar), '抬头与边界逐字取自常量');
ok(!/>\s*长文覆盖账\s*</.test(bar), '界面没有硬编码一份抬头');
ok(/onClick=\{\(\) => setOpen\(\(x\) => !x\)\}/.test(bar), '展开是用户点的，不是默认展开');
ok(/data-coverage="1"/.test(bar) && /data-coverage-toggle=/.test(bar), 'data 属性都带 =，探针抓得到');
ok(/data-coverage-row=\{r\.index\}/.test(bar) && /data-coverage-note="1"/.test(bar), '清单行与边界都留了探针');
ok(/pinned === 0 && s\.sentences > 0/.test(bar), '只列「一句都没被落上」且确实含句子的段');
ok(/previewTruncated \? '…' : ''/.test(bar), '截断的预览有省略号，不冒充完整段落');
ok(/\.cv-bar/.test(css) && /\.cv-row/.test(css) && /\.cv-note/.test(css) && /\.cv-scroll/.test(css), '样式表里有收起栏、行、边界与滚动区');
/*
 * 原来钉的是「样式表里得有 font-size: 11px」——那是上一代苹果阶梯的下限。
 * 换成 Notion 六档（12/14/16/20/24/32）之后，最小一档是 12px，比 11 更大、
 * 更安全；但「查某个字面值在不在」这种探针挡不住有人把字改回 10px：
 * 只要别处还有一处 11px，它就照绿。改成把这一栏所有字号读出来逐个比，
 * 顺带要求落在阶梯内——下限与阶梯一起守，才是真的收紧。
 */
const covSizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
ok(covSizes.length >= 4 && covSizes.every((s) => [12, 14, 16, 20, 24, 32].includes(s)),
  '覆盖账的字号都在 Notion 六档内且不小于 12px（整页截图里 10px 糊成黑块）');
ok(/import '\.\/styles-coverage\.css'/.test(mainTsx) && /import '\.\/styles-coverage\.css'/.test(mockTsx), '真应用与预览页都引了样式');

/*
 * 判定的适用范围。守卫要查「还挂在 cov.partial 上」，不是查「data-verdict-scope 这个词还在」——
 * 把条件改成 false 后词仍会在，而那一行已经不渲染了。第 66 轮踩过这个假绿。
 */
const overviewTsx = src('src/renderer/src/components/Overview.tsx');
const cssMain = src('src/renderer/src/styles.css');
ok(/import \{ coverageOf, coverageScopeText \} from '@shared\/coverage'/.test(diagTsx), '主报告组件用纯函数算范围');
ok(/cov\.partial && \([\s\S]{0,200}data-verdict-scope/.test(diagTsx), '范围句还挂在 cov.partial 判断上，不是只剩一个词');
ok(/coverageScopeText\(cov\.pinned, cov\.sentences, cov\.untouched\)/.test(diagTsx), '范围句的三个数字来自纯函数，不写死');
ok(/\.verdict-scope \{/.test(cssMain), '范围句有自己的样式，不是裸文字');
ok(/import \{ coverageOf \} from '@shared\/coverage'/.test(overviewTsx), '速览也读同一份覆盖口径');
/*
 * 「引文 N/M 句」从速览的行内拼串搬进了主线的第④环（share/spine.ts）。
 * 守的东西没变：长文上这个范围数字必须跟着判定一起出现，不能只剩「削弱」两个字。
 * 第二条防的是「算了但没挂上」——变量写在函数里、join 里没接，断言若只看变量名会假绿。
 */
const spineTs = src('src/shared/spine.ts');
ok(
  /if \(cov\.partial\) rangeBits\.push\(`引文 \$\{cov\.pinned\}\/\$\{cov\.sentences\} 句`\)/.test(spineTs),
  '主线第④环在长文上带「引文 N/M 句」',
);
ok(/from: rangeBits\.join\(' · '\)/.test(spineTs), '范围数字真的挂进第④环的出处行，不是只算不用');
ok(/data-quick-cover=\{r\.to === 'sec-verdict' && cov\.partial/.test(overviewTsx), '速览的覆盖标记挂在 partial 上，可被探针抓');

/* 预览入口：一份长文本、一个锚点，两者都挂上 */
ok(/QS\.get\('coverage'\)/.test(mockTsx) && /<CoverageAnchor \/>/.test(mockTsx), '?coverage=1 预览入口挂上了');
ok(/LONG_DEMO/.test(mockTsx) && /D0\.passage/.test(mockTsx), '演示长文以原报告原文逐字开头，span 仍对得上');
ok(/SAMPLES\.slice\(1\)/.test(mockTsx), '演示长文由仓库内示例文本拼接，不编新字、不拿真文本进仓库');
ok(/data-coverage\]/.test(mockTsx) && /data-coverage-toggle/.test(mockTsx), '预览锚点滚到这一栏并点开');

/* 端到端与包内：以下三条在补探针之前应当先红 */
const smokeTs = src('src/main/smoke.ts');
const smokeMjs = src('scripts/smoke.mjs');
const packMjs = src('scripts/pack-smoke.mjs');
ok(/COVERAGERESULT/.test(smokeTs) && /data-coverage/.test(smokeTs), '真应用探针真的读了这一栏');
ok(/jOfLine\('COVERAGERESULT'\)/.test(smokeMjs), '端到端真的接了这一栏的探针');
ok(/includes\('COVERAGERESULT'\)/.test(packMjs), '包内断言真的接了这一栏的探针');

/* ─────────── 五 · 从「看见了」到「能动手」 ─────────── */

/*
 * 判定区那句「引文只钉住 3 句」如果只到「知道了」为止，读者下一步得自己想起来：
 * 切分条在输入区，隔着一整份报告。所以给它一个动作。
 *
 * 守卫要查「还挂在段数判断上」，不是查「data-verdict-segment 这个词还在」——
 * 第 66 轮踩过：把条件改成恒真后词照样在，而短文本上会冒出一个点了没用的按钮。
 */
const segTsx = src('src/renderer/src/components/SegmentBar.tsx');
const cssFlow = src('src/renderer/src/styles-flow.css');
ok(
  /cov\.segmentCount > 1 &&[\s\S]{0,260}data-verdict-segment/.test(diagTsx),
  '「切给我看」挂在段数 > 1 上，不是无条件渲染'
);
ok(
  /window\.dispatchEvent\(new CustomEvent\('al:segment'\)\)/.test(diagTsx),
  '按下派的是 al:segment，与切分条约定同一个名字'
);
ok(/window\.addEventListener\('al:segment'/.test(segTsx), '切分条真的接住了这个事件（不是只有派发端）');
ok(
  /pickedIndex === null && segs\.length >= 2\) setOpen\(true\)/.test(segTsx),
  '接住后展开列表；已载入某一段时不假装展开（那一屏没有列表）'
);
ok(/scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/.test(segTsx), '接住后滚过去，不让人自己找');
ok(/setHit\(true\)/.test(segTsx) && /1400/.test(segTsx), '滚过去之后闪一下然后撤掉');
ok(/\.vscope-act \{/.test(cssMain), '按钮有线框样式，不是裸文字');
ok(/\.sg-bar\.sg-hit \{/.test(cssFlow), '切分条被跳中时的高亮样式在');
ok(/切给我看（\{cov\.segmentCount\} 段）/.test(diagTsx), '按钮文案带段数，读者知道要点开的是什么');
/*
 * 只说「切给我看」这件事。这一格里不许出现花钱入口——批跑有它自己的确认流
 * （几次调用、每段各存一份），在判定旁边再放一个「跑」会绕开那道确认。
 */
ok(!/runBatch|onRunBatch|longformPlan/.test(diagTsx), '判定区不放花钱入口，批跑仍只在切分条上发起');

/* ─────────── 收口 ─────────── */

if (failed.length) {
  for (const f of failed) console.error(`✗ ${f}`);
  console.error(`\n✗ 长文覆盖账 ${failed.length} 条没过（共 ${passed + failed.length} 条）`);
  process.exit(1);
}
console.log(`✓ 长文覆盖账：${passed} 条全部通过｜长文才出现、口径复用三处、守恒、不劝不判`);
