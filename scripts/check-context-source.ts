/**
 * 语境出处的断言。
 *
 * 这一层的价值押在一件事上：**报告里终于有一处肯承认「这是猜的」**。
 * 所以这里验的全是构造性质，不是文案：
 *
 *   1. 三档枚举与七格清单对得上，`contextGaps` 不在其中（它写的就是「不知道什么」，
 *      再给它标出处只会得到「这条猜测本身是猜的」这种废话）；
 *   2. 说 known 却指不出原文的，本地降级为 inferred 并留痕——不猜它本来想说什么，
 *      也不静默放过（静默放过会让界面显示一份「全部都能回原文」的报告，而那是假的）；
 *   3. 旧存档没有这一层时，空对象、七条 missing、不抛错；
 *   4. 规则真的进了全部 36 份提示词，不是只写在 schema 里；
 *   5. 界面照实说旧档没有标注，且不把版本号硬编码进去（硬编码必然会过时）。
 *
 * 反证另做（改源码逐条看红），因为这里改不了自己脚下踩的文件。
 *
 * 跑法：npm run check:context-source
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONTEXT_FIELDS } from '@shared/types';
import { ANALYSIS_MODES, type AnalysisMode } from '@shared/types';
import { THEORIES, type TheoryId } from '@shared/theories';
import { describeGrounding, foldText, normalizeGrounding } from '@shared/context-grounding';
import { SHARED_SCHEMA, buildPrompt } from '../src/main/prompt';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}
const src = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf-8');

const PASSAGE =
  '我们学校去年取消了早读，今年高考一本率下降了 6 个百分点。这说明取消早读是错的。' +
  '王校长在一份公开材料里说，早读能提高记忆效率，学生就该早起读书。';

/* ── 一、七格清单 ─────────── */
ok(CONTEXT_FIELDS.length === 7, '需要标出处的语境格是七格', `实际 ${CONTEXT_FIELDS.length}`);
ok(!(CONTEXT_FIELDS as readonly string[]).includes('contextGaps'), 'contextGaps 不在要标出处的格子里');
ok(
  ['issue', 'speakerPosition', 'opposingPosition', 'dialogueType', 'stage', 'audience', 'audienceKind'].every((k) =>
    (CONTEXT_FIELDS as readonly string[]).includes(k)
  ),
  '七格里一个都没少',
);

/* ── 二、降级：说 known 却指不出原文 ─────────── */
const realQuote = '我们学校去年取消了早读';
const fine = normalizeGrounding(
  { audience: { source: 'known', basis: realQuote }, issue: { source: 'guess', basis: '看不出争什么', ifChanged: '换个说法' } },
  PASSAGE,
);
ok(fine.grounding.audience?.source === 'known', '依据真在原文里，known 保留');
ok(!fine.grounding.audience?.downgraded, '正常保留的 known 不带降级标记');
ok(fine.tally.known === 1 && fine.tally.guess === 1, '三档分档计数对得上');
ok(fine.problems.filter((p) => p.kind === 'missing').length === 5, '没标的五格各记一条 missing', `${fine.problems.filter((p) => p.kind === 'missing').length}`);

const fake = normalizeGrounding(
  { audience: { source: 'known', basis: '这段话是写给教育局看的内部汇报' } },
  PASSAGE,
);
ok(fake.grounding.audience?.source === 'inferred', '依据在原文里找不到，known 降为 inferred');
ok(fake.grounding.audience?.downgraded === true, '降级留下 downgraded 痕迹');
ok(
  fake.problems.some((p) => p.kind === 'basis-not-in-text' && p.field === 'audience'),
  '降级同时记一条 problem，供诊断留痕',
);

const short = normalizeGrounding({ audience: { source: 'known', basis: '家长' } }, PASSAGE);
ok(short.grounding.audience?.source === 'inferred', '依据太短（两字必然命中任何原文）也降级');
ok(
  short.problems.some((p) => p.kind === 'basis-not-in-text' && p.detail.includes('2 个字')),
  '太短的情形在问题说明里写出实际字数',
);

/* 归一化：全角/半角、引号、空白都算命中，否则「引了一句原文」会被误判成编造 */
const messyQuote = '这说明取消早读是错的';
ok(foldText(PASSAGE).includes(foldText(messyQuote)), '归一化后能对上');
const fullWidth = normalizeGrounding({ issue: { source: 'known', basis: '这说明取消早读是错的　' } }, PASSAGE);
ok(fullWidth.grounding.issue?.source === 'known', '原文片段带全角空格也算命中，不误降级');

/* ── 三、其它坏形状 ─────────── */
const noIf = normalizeGrounding({ audienceKind: { source: 'guess', basis: '文本没说' } }, PASSAGE);
ok(noIf.grounding.audienceKind?.source === 'guess', 'guess 缺 ifChanged 仍然保留（guess 本身是最诚实的档位）');
ok(
  noIf.problems.some((p) => p.kind === 'guess-without-ifchanged'),
  '缺 ifChanged 记一条 problem，界面据此能提示',
);

const badSrc = normalizeGrounding({ stage: { source: 'sure', basis: '看着像' } }, PASSAGE);
ok(badSrc.grounding.stage === undefined, '三档之外的值直接丢掉，不顺着猜');
ok(badSrc.problems.some((p) => p.kind === 'bad-source'), '丢掉的时候说清是档位写错');

const emptyBasis = normalizeGrounding({ stage: { source: 'inferred', basis: '   ' } }, PASSAGE);
ok(emptyBasis.grounding.stage === undefined, '有档位没依据的也丢掉');
ok(emptyBasis.problems.some((p) => p.kind === 'basis-empty'), '空依据记一条');

const stray = normalizeGrounding({ contextGaps: { source: 'known', basis: 'x' }, color: { source: 'known' } }, PASSAGE);
ok(
  stray.problems.filter((p) => p.kind === 'unknown-field').length === 2,
  '不存在的格被点名，不当成正常字段收下',
);
ok(stray.tally.known === 0, '被点名的格不计入分档');
ok(!('contextGaps' in stray.grounding), 'contextGaps 不会被收进 grounding');

/* ── 四、旧存档 ─────────── */
for (const [name, input] of [
  ['没这个字段', undefined],
  ['这是个字符串', 'known'],
  ['这是个数组', [{ source: 'known' }]],
  ['字段是 null', null],
] as [string, unknown][]) {
  const r = normalizeGrounding(input, PASSAGE);
  ok(Object.keys(r.grounding).length === 0, `旧档（${name}）不产生任何出处`);
  ok(r.problems.every((p) => p.kind === 'missing'), `旧档（${name}）只报 missing，不报别的`);
  ok(describeGrounding(r).includes('没有标注'), `旧档（${name}）的一句话说明照实说没标注`);
}

ok(describeGrounding(fine).includes('1 格能从原文指出'), '一句话说明会报出能从原文指出的格数');
ok(describeGrounding(fake).includes('1 格是推的'), '一句话说明会报出推的格数');
ok(describeGrounding(fine).endsWith('。'), '一句话说明以句号收尾，界面拼接时不会缺标点');

/* ── 五、规则真的进了提示词 ─────────── */
ok(SHARED_SCHEMA.includes('"grounding"'), 'schema 里承诺了 grounding');
ok(SHARED_SCHEMA.includes('"ifChanged"'), 'schema 里承诺了 ifChanged');
ok(SHARED_SCHEMA.includes('known|inferred|guess'), 'schema 里写明了三档取值');

const missingHint: string[] = [];
for (const t of THEORIES) {
  for (const m of ANALYSIS_MODES as readonly AnalysisMode[]) {
    const p = buildPrompt(t.id as TheoryId, m);
    const all = p.system + p.userTemplate;
    if (!all.includes('context.grounding 里每一格')) missingHint.push(`${t.id}.${m}`);
  }
}
ok(missingHint.length === 0, '36 份提示词都带上了语境出处那条规则', missingHint.slice(0, 5).join('、'));

/* ── 六、接进了解析 ─────────── */
const an = src('src/main/analyze.ts');
ok(/normalizeGrounding\(c\.grounding,\s*passage\)/.test(an), 'analyze 把模型的 grounding 交给本地校验');
ok(/grounding:\s*grounding\.grounding/.test(an), '校验结果被接进 context');
ok(an.includes("code: 'CONTEXT_GROUNDING'"), '降级会留一条诊断，不静默');

/* ── 七、界面 ─────────── */
const wb = src('src/renderer/public/workbench.html');
ok(/function contextRows\(/.test(wb), '语境区有自己的渲染，不走通用 kv 表');
ok(/id:'context',nm:'语境 \/ Context',get:r=>r\.context,kind:'context'/.test(wb), '语境区按 context 类型渲染');
/* 这两条不能只查「ctxif 这个词在不在」——把三元条件改成 false 时，词还在源码里，
   渲染却已经死了，那种断言会稳绿。要查的是它是否仍挂在 gr 的判断上。 */
ok(/const ifc=gr\.ifChanged\?`<span class="ctxif">/.test(wb), 'assumed 的 ifChanged 真的会显示出来');
ok(/const down=gr\.downgraded\?`<span class="ctxdown">/.test(wb), '被降级的 known 会在界面上说明，不静默');
ok(
  /CTX_NO_MARK=\{contextGaps:/.test(wb) && wb.includes("dialogueTypeBasis:'这是上一格的「凭什么」，不单独标'"),
  '两格不标出处，且各自写了为什么',
);
ok(/没有一处能回到原文核对/.test(wb), '旧档照实说没有出处，不补一条假的');
ok(!/早于 v\d+\.\d+\.\d+/.test(wb), '旧档提示里不硬编码版本号（写死的号必然过时）');
ok(/R\.prompt&&R\.prompt\.version/.test(wb), '旧档版本号取报告自己记的那一个');

/* 三档的中文必须来自同一处，不在这里再写一遍翻译 */
for (const [key, zh] of [['known', '原文'], ['inferred', '推出'], ['guess', '假定']] as const) {
  ok(wb.includes(`${key}:{zh:'${zh}'`), `三档中文「${zh}」在 CTX_SRC 里定义（键 ${key}）`);
}

/* ── 汇总 ─────────── */
if (failed.length) {
  console.error(`✗ check:context-source 红了 ${failed.length} 处（通过 ${passed} 条）\n`);
  for (const f of failed) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(
  `✓ check:context-source 通过 ${passed} 条｜三档可验、指不出原文就降级、旧档不补假、36 份提示词都带规则`,
);
