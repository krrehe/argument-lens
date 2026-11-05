/**
 * 「谁跑的」这一栏的断言：报告里记下模型、供应商主机与生效温度。
 *
 * 为什么值得单开一条检查：上一轮「同题复跑」第一次跑出真数据时，v2.0.0 有一组
 * 8 份报告相差 279 个字段，而存档里没有模型名也没有温度——差异被看见了，
 * 却永远说不清是我换了模型，还是模型自己在抖。这一栏就是补那个洞：
 * **从下一份报告开始，同一组里的差异至少能被分成「换了模型」与「同一个模型」两类。**
 *
 * 这一块最容易犯的错，恰好都是「看起来更完整」的那种：
 *   - 缺温度就只写模型名 → 读的人以为温度也是同一个，比空着更误导；
 *   - 模型名为空也照写 → 同一组里出现一个叫 '' 的「模型」，把所有旧报告骗成一组；
 *   - 把整个设置对象塞进来 → 路径与 Key 跟着报告被导出；
 *   - 让 engine 进重放比对 → 每份新报告重放都亮一处永远解释不清的红；
 *   - 让 engine 进字段计数 → 「245 个字段每次都一样」这个数字悄悄变大，
 *     而那三个字段从来没有「一样不一样」这回事（它们不参与判定）。
 *
 * 防恒真写在样本里，不写在注释里：
 *   - 「温度 0 要写进去」：0 是合法温度，用 falsy 判断的实现会把它当缺失；
 *   - 「重放带 engine 不报差异」配一条「改掉 verdict.level 必须报差异」，
 *     否则前一条在「什么都没比」的实现下也绿；
 *   - 「两个模型并列时顺序固定」配一份倒序输入，两份结果必须逐字节相同。
 *
 * 跑法：npm run check:engine
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeDiagnosis } from '../src/main/analyze';
import { agreementLine, agreementOf, engineNote, cellLine, type AgreementItem } from '@shared/agreement';
import { diffReports, flatten } from '@shared/replay';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}

const ANALYZE = readFileSync(resolve('src/main/analyze.ts'), 'utf-8');
const AGREE = readFileSync(resolve('src/shared/agreement.ts'), 'utf-8');
const ARCHIVE = readFileSync(resolve('src/main/archive.ts'), 'utf-8');

/* ─────────── 一、落盘：三项齐全才写 ─────────── */

const P = '我们学校去年取消了早读，今年高考一本率下降了六个百分点。这说明取消早读是错的。';
const RAW = {};

/* id 与时间固定：重放比对会逐字段比它们，随机 id 会让这条测的变成「id 不一样」。 */
const FIX = { mode: 'diagnose' as const, id: 'r1', createdAt: 1000 };
const withEngine = normalizeDiagnosis(RAW, P, 'walton', {
  ...FIX,
  engine: { model: 'deepseek-chat', host: 'api.deepseek.com', temperature: 0.2 },
});
ok(withEngine.engine?.model === 'deepseek-chat', '模型名原样落进报告');
ok(withEngine.engine?.host === 'api.deepseek.com', '主机原样落进报告');
ok(withEngine.engine?.temperature === 0.2, '温度原样落进报告');

/* 不传就不写：旧报告的样子，不许凭空多出一栏。 */
const noEngine = normalizeDiagnosis(RAW, P, 'walton', { mode: 'diagnose' });
ok(!JSON.stringify(noEngine).includes('"engine"'), '不传 engine 时报告里没有这一栏（不凭空造）');

/* 空白名字不算「记了」：写进去会让同题复跑把一堆旧报告骗成同一组。 */
const blankModel = normalizeDiagnosis(RAW, P, 'walton', {
  mode: 'diagnose',
  engine: { model: '   ', host: 'api.deepseek.com', temperature: 0.2 },
});
ok(blankModel.engine === undefined, '模型名只有空格时整条不写');

/* 半条记录也不写：读的人会以为温度也是同一个。 */
const half = normalizeDiagnosis(RAW, P, 'walton', {
  mode: 'diagnose',
  engine: { model: 'deepseek-chat', host: 'api.deepseek.com' } as never,
});
ok(half.engine === undefined, '缺温度时整条不写（半条记录比空着更误导）');
const halfHost = normalizeDiagnosis(RAW, P, 'walton', {
  mode: 'diagnose',
  engine: { model: 'deepseek-chat', host: '', temperature: 0.2 },
});
ok(halfHost.engine === undefined, '缺主机时整条不写');

/* 0 是合法温度。用 `if (!temperature)` 的实现会把它当缺失——这条专门抓那种写法。 */
const zero = normalizeDiagnosis(RAW, P, 'walton', {
  mode: 'diagnose',
  engine: { model: 'm', host: 'h', temperature: 0 },
});
ok(zero.engine?.temperature === 0, '温度 0 是合法值，照写（不是「没填」）');

const nan = normalizeDiagnosis(RAW, P, 'walton', {
  mode: 'diagnose',
  engine: { model: 'm', host: 'h', temperature: NaN },
});
ok(nan.engine === undefined, '温度不是有限数时不写');
const tooHot = normalizeDiagnosis(RAW, P, 'walton', {
  mode: 'diagnose',
  engine: { model: 'm', host: 'h', temperature: 2.5 },
});
ok(tooHot.engine === undefined, '温度越界（>2）时不写');
const negative = normalizeDiagnosis(RAW, P, 'walton', {
  mode: 'diagnose',
  engine: { model: 'm', host: 'h', temperature: -0.1 },
});
ok(negative.engine === undefined, '温度为负时不写');

/* 前后空格要去掉：同一个模型名带着空格会被算成两个模型。 */
const padded = normalizeDiagnosis(RAW, P, 'walton', {
  mode: 'diagnose',
  engine: { model: ' deepseek-chat ', host: ' api.deepseek.com ', temperature: 0.2 },
});
ok(padded.engine?.model === 'deepseek-chat' && padded.engine?.host === 'api.deepseek.com', '前后空格去掉，免得同名算两个');

/* 不许把整个设置塞进来：这份报告会被导出。 */
ok(
  !/apiKey|Bearer|baseUrl/.test(JSON.stringify(withEngine.engine)),
  '这一栏里只有模型、主机、温度，没有 Key 与路径',
);

/* ─────────── 二、重放：环境不是产物 ─────────── */

const replayed = normalizeDiagnosis(RAW, P, 'walton', { ...FIX });
const d1 = diffReports(withEngine as never, replayed as never);
ok(d1.diffs.length === 0 && d1.added.length === 0, '重放不把 engine 报成差异（它是环境，不是判断）', JSON.stringify(d1.diffs));

/* 换了模型记录也不该算「判断变了」——否则每份新报告重放都红。 */
const otherEngine = normalizeDiagnosis(RAW, P, 'walton', {
  ...FIX,
  engine: { model: 'gpt-4o-mini', host: 'api.openai.com', temperature: 0.7 },
});
ok(diffReports(withEngine as never, otherEngine as never).diffs.length === 0, '两份 engine 不同的报告，重放比对也不亮差异');

/* 防恒真：同一套比对在「判断真的变了」时必须红，否则上面两条是白绿。 */
const changed = { ...replayed, verdict: { ...replayed.verdict, level: 'unclear' as const } };
ok(diffReports(replayed as never, changed as never).diffs.length > 0, '判断真的变了时比对会红（上一条不是恒真）');

ok(
  ![...flatten(withEngine).keys()].some((k) => k.startsWith('engine')),
  '摊平后 engine 不产生任何路径（否则它会挤进字段计数）',
);

/* ─────────── 三、同题复跑：谁跑的要单独报出来 ─────────── */

const ENG = (model: string, temperature = 0.2, host = 'api.deepseek.com'): Record<string, unknown> => ({
  verdict: { level: 'weakened' },
  engine: { model, host, temperature },
});
const R0: Record<string, unknown> = { verdict: { level: 'weakened' } };

const item = (id: string, at: number, report: Record<string, unknown>, fp = 'fpA'): AgreementItem => ({
  id,
  at,
  mode: 'diagnose',
  theory: 'walton',
  version: '2.5.0',
  fingerprint: fp,
  passage: P,
  report,
});

/* engine 不进字段计数：同一份报告加不加这一栏，fields 必须一样。 */
const noEng = agreementOf([item('x1', 10, R0), item('x2', 9, R0)]);
const withEng = agreementOf([item('x1', 10, ENG('m')), item('x2', 9, ENG('m'))]);
ok(
  noEng.repeat[0].fields === withEng.repeat[0].fields,
  'engine 不进字段计数（flatten 跳过 + INPUT_KEYS 跳过，两道网都挡）',
  `${noEng.repeat[0].fields} / ${withEng.repeat[0].fields}`,
);
/* 两道网各有一条断言：只验「字段数没变」的话，删掉其中一道仍然绿——
   这一步是反证时发现的，所以它单独算一条。 */
ok(/INPUT_KEYS = new Set\(\[[\s\S]*?'engine'/.test(AGREE), '这一栏自己记着「engine 不算字段」，不靠重放那个文件替它记');
ok(withEng.repeat[0].spreads.length === 0, '同一模型的两次报告：「没变过」');

/* 一组里两家模型：这是「差异最可能的解释」，必须被点名。 */
/* 输入顺序故意与字典序相反：否则「按名字定序」这条在不排序的实现下也绿（第 38 轮栽过）。 */
const swapped = agreementOf([item('s1', 10, ENG('gpt-4o-mini')), item('s2', 9, ENG('deepseek-chat'))]);
const sc = swapped.repeat[0];
ok(sc.engine.models.length === 2, '两家模型被数成两个', String(sc.engine.models.length));
ok(sc.engine.models.map((m) => m.model).join(',') === 'deepseek-chat,gpt-4o-mini', '并列按名字定序，不按输入顺序', sc.engine.models.map((m) => m.model).join(','));
ok(swapped.modelSwitched === 1, '视图层数出「这一组里换过模型」的组数');
ok(engineNote(sc.engine).includes('（换过）'), '明细行把「换过」说出来', engineNote(sc.engine));
ok((agreementLine(swapped) ?? '').includes('1 组里不止一个模型'), '总述说出「不止一个模型」');
ok(!/建议|应该|稳定|可靠|结论|证明|因此|所以/.test(agreementLine(swapped) ?? ''), '总述仍然不评稳定、不劝人');

/* 同一个模型、两个温度：也是「换了环境」，但不是换了模型。 */
const tempSwapped = agreementOf([item('t1', 10, ENG('m', 0.7)), item('t2', 9, ENG('m', 0.2))]);
ok(tempSwapped.repeat[0].engine.models.length === 1, '同一模型两个温度：模型仍是一个');
ok(
  engineNote(tempSwapped.repeat[0].engine).includes('温度 0.2 / 0.7'),
  '温度换过时按升序列出（不是按输入顺序）',
  engineNote(tempSwapped.repeat[0].engine),
);

/* 供应商换过：同一个模型名，两个老家。 */
const hostSwapped = agreementOf([
  item('h1', 10, ENG('m', 0.2, 'api.deepseek.com')),
  item('h2', 9, ENG('m', 0.2, 'proxy.example.com')),
]);
ok(engineNote(hostSwapped.repeat[0].engine).includes('供应商'), '供应商换过时也说出来', engineNote(hostSwapped.repeat[0].engine));

/* 部分没记：新报告与旧报告混在一组。 */
const mixed = agreementOf([item('m1', 10, ENG('m')), item('m2', 9, R0)]);
ok(mixed.repeat[0].engine.missing === 1, '没记的份数单独数出来');
ok(engineNote(mixed.repeat[0].engine).includes('另有 1 份没记'), '混着时说清还有几份没记', engineNote(mixed.repeat[0].engine));
ok(mixed.modelKnown === 1 && mixed.modelMissing === 1, '视图层分别数「记了」与「没记」', `${mixed.modelKnown}/${mixed.modelMissing}`);

/* 两个模型 + 有没记的：两句都要出现，否则读的人会以为这一组已经全部对上号。 */
const twoPlusMissing = agreementOf([item('z1', 10, ENG('aaa')), item('z2', 9, ENG('bbb')), item('z3', 8, R0)]);
ok(
  engineNote(twoPlusMissing.repeat[0].engine).includes('另有 1 份没记'),
  '换过模型且有没记的份数时，两件事都说',
  engineNote(twoPlusMissing.repeat[0].engine),
);

/* 整组都没记：也得说话。沉默会被读成「知道了」。 */
const none = agreementOf([item('n1', 10, R0), item('n2', 9, R0)]);
ok(engineNote(none.repeat[0].engine) === '没记模型', '整组都没记时说「没记模型」，不沉默');
ok((agreementLine(none) ?? '').includes('本机 2 份报告没记模型（旧存档没有这一栏）'), '总述说出全机有多少份没记（带范围，免得被读成「比过的那几份」）');
ok(none.modelSwitched === 0, '没记不等于「换过模型」（不许拿空值当差异）');

/* 位置：engine 那一段在「最近一次」之前，且不挤掉原文摘录。 */
const line = cellLine(sc, String);
ok(line.indexOf('模型') < line.indexOf('最近一次'), '明细行里「谁跑的」排在时间之前', line);
ok(line.endsWith(P.slice(0, 28) + '…'), '原文摘录仍在行尾，一个字都不改', line);

/* 顺序与确定性：倒序输入，整份视图逐字节相同。 */
const FORWARD = [
  item('q1', 10, ENG('aaa', 0.2)),
  item('q2', 9, ENG('zzz', 0.2)),
];
const REVERSED = [...FORWARD].reverse();
ok(
  JSON.stringify(agreementOf(FORWARD)) === JSON.stringify(agreementOf(REVERSED)),
  '输入倒过来，模型并列的顺序与整份视图都不变',
);

/* ─────────── 四、真接线：谁发请求，谁才写这一栏 ─────────── */

/*
 * 名字出现在文件里，和它被用来做事，是两件事（第 40 轮踩过）。
 * 所以这里盯调用点：engine 的字面量必须由 cfg.model 与 hostOf(cfg.baseUrl) 组成。
 */
ok(
  /engine\s*=\s*\{\s*model:\s*cfg\.model,\s*host:\s*hostOf\(cfg\.baseUrl\),\s*temperature\s*\}/.test(ANALYZE),
  'engine 由当时的设置与生效温度组成（不是从别处抄来的）',
);
ok(/normalizeDiagnosis\(parsed, passage, theory, \{[\s\S]{0,200}engine,/.test(ANALYZE), '它真的被传进 normalizeDiagnosis（不只是定义了）');
ok(!/host:\s*cfg\.baseUrl\b/.test(ANALYZE), '不存 baseUrl 原样（路径与 Key 不跟着报告走）');
ok(!/delete report\.engine/.test(ARCHIVE), '报告扫描不把 engine 删掉（删了就永远是「没记」）');

/* ─────────── 五、结论 ─────────── */

if (failed.length) {
  console.error(`\ncheck:engine 失败 ${failed.length} 条：`);
  for (const f of failed) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`✓ check:engine 通过 ${passed} 条｜三项齐全才落盘、环境不入重放、换过模型要点名`);
