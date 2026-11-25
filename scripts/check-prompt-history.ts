/**
 * 「这把尺子」：提示词版本、指纹与变更注记的只读追溯层。
 *
 * 这一关最要紧的不是「有没有这一栏」，而是**别让它假装能复核历史**。
 * 报告里存着三个月前那次装配的指纹，可本机只留有当前装机版的全文与 36 份指纹；
 * 拿今天的指纹去比旧报告，比出来的「不一致」是废话，还容易读成旧报告坏了。
 * 四种坏法逐条守：
 *
 *   1. 版本相同就宣称「同一把尺子」——指纹没对上时，这只说明版号没换；
 *   2. 版本不同却拿当前版指纹硬比——必须有 `not-checked` 这条状态，并说清为什么；
 *   3. 界面自己抄一份注记或解析一遍版本号——基线换了界面不换，用户读到旧记录；
 *   4. 少了「旧版全文没有存档」这句边界——这一栏就从追溯变成了背书。
 *
 * 防恒真：造「一致 / 另一版 / 没记版本 / 版号同指纹不同 / 组合不存在 / 注记里没这版」
 * 六组对照，任何一条行为断言在至少一组上必须为假。
 *
 * 跑法：npm run check:prompt-history（已进 verify）
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ANALYSIS_MODES } from '@shared/types';
import { THEORIES } from '@shared/theories';
import {
  PROMPT_BASELINE,
  parsePromptNotes,
  promptHistoryMarkdown,
  promptHistoryOf,
} from '@shared/prompt-history';
import { PROMPT_VERSION, PROMPT_VERSION_NOTE, buildPrompt } from '../src/main/prompt';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, extra = ''): void {
  if (cond) passed++;
  else failed.push(extra ? `${label}（${extra}）` : label);
}
function src(p: string): string {
  return readFileSync(resolve(process.cwd(), p), 'utf-8');
}

/* ─────────── 现场事实与六组样本 ─────────── */

const COMBO = 'walton.diagnose';
const CUR_FP = PROMPT_BASELINE.fingerprints[COMBO];
const CUR = { version: PROMPT_BASELINE.version, fingerprint: CUR_FP };

type HInput = {
  prompt?: { version: string; fingerprint: string };
  theory: string;
  mode: string;
};
const H = (p: HInput) =>
  promptHistoryOf(p as Parameters<typeof promptHistoryOf>[0]);

const same = H({ prompt: CUR, theory: 'walton', mode: 'diagnose' });
const diff = H({ prompt: { version: '2.0.0', fingerprint: 'aaaaaaaaaaaa' }, theory: 'walton', mode: 'diagnose' });
const noRec = H({ theory: 'walton', mode: 'diagnose' });
const mismatch = H({ prompt: { version: CUR.version, fingerprint: 'ffffffffffff' }, theory: 'walton', mode: 'diagnose' });
const noCombo = H({ prompt: CUR, theory: 'nope', mode: 'nope' });
const notListed = H({ prompt: { version: '9.9.9', fingerprint: 'cccccccccccc' }, theory: 'walton', mode: 'diagnose' });

ok(!!CUR_FP, '基线里真的有 walton.diagnose 这一组合的指纹（样本不是空对空）');
ok(same.relation === 'same', '版本与指纹都对上 → same');
ok(same.fingerprintState === 'match', 'same 的指纹状态是 match');
ok(same.currentFingerprint === CUR_FP && same.reportFingerprint === CUR_FP, 'same 两边指纹取的是同一个字段');
ok(same.combination === COMBO, '组合名按「透镜.模式」拼');

ok(diff.relation === 'different', '报告版本与当前不同 → different');
ok(diff.fingerprintState === 'not-checked', '版本不同时**不比**指纹，不是 mismatch');
ok(diff.currentFingerprint === CUR_FP, 'not-checked 不是因为本机没指纹（样本要能区分这两种）');
ok(/不是当前装机版/.test(diff.line), 'different 的总述点名「不是当前装机版」');
ok(diff.noteFound && /2\.0\.0/.test(diff.noteText ?? ''), '变更史里找得到 v2.0.0 那一行注记');

ok(noRec.relation === 'no-record', '报告没记版本 → no-record');
ok(noRec.fingerprintState === 'no-record', '没记版本时指纹状态是 no-record');
ok(noRec.reportVersion === null && noRec.reportFingerprint === null, '没记版本不回填假值');
ok(/没记提示词版本与指纹/.test(noRec.line) && /不能和任何一版对回/.test(noRec.line), '没记版本说清「不能对回」，不留空白');
ok(!noRec.noteFound && noRec.noteText === null, '没记版本时没有注记可给');
ok(/没有版本号/.test(noRec.noteLine), '没记版本时说明「没有版本号」');

ok(mismatch.relation === 'version-only', '版号相同、指纹不同 → version-only');
ok(mismatch.fingerprintState === 'mismatch', 'mismatch 与 same 必须分得开');
ok(/不能只按版本号认定/.test(mismatch.line), '版号同而指纹不同，不许宣称「同一把尺子」');
ok(mismatch.noteFound, '版号没变时仍查得到这一行注记');

ok(noCombo.relation === 'version-only', '指纹表里没有这个组合 → version-only');
ok(noCombo.fingerprintState === 'no-current', '缺当前指纹单独一个状态，不冒充 mismatch');
ok(noCombo.currentFingerprint === null, 'no-current 的当前指纹确实是 null');
ok(/没有.*这一组合/.test(noCombo.line), '缺组合时说清没法逐字核对');

ok(notListed.relation === 'different', '注记里没有的那一版仍是 different');
ok(!notListed.noteFound && notListed.noteText === null, '注记里没有 v9.9.9 就不编一条');
ok(/不能凭版本号推断/.test(notListed.noteLine), '找不到注记时明说「不能凭版本号推断」');

/* 防恒真：六组在关键字段上必须真的不同。 */
ok(same.relation !== mismatch.relation, 'same 与 mismatch 不是同一个关系（断言不是恒真）');
ok(diff.fingerprintState !== mismatch.fingerprintState, 'not-checked 与 mismatch 不是同一个状态');
ok(noRec.line !== same.line, '没记版本与一致是两句话');
ok(new Set([same, diff, noRec, mismatch, noCombo, notListed].map((v) => v.line)).size >= 5, '六组至少五句不同的总述');

/* ─────────── 边界话 ─────────── */

for (const [name, v] of [
  ['same', same],
  ['different', diff],
  ['no-record', noRec],
  ['version-only', mismatch],
  ['no-current', noCombo],
  ['not-listed', notListed],
] as const) {
  ok(v.caveats.length === 3, `${name}：三条边界一条不少`, String(v.caveats.length));
  ok(v.caveats.some((c) => /更早版本的全文没有存档/.test(c)), `${name}：明说旧版全文没存档`);
  ok(v.caveats.some((c) => /不能把旧指纹重算一遍/.test(c)), `${name}：明说不能重算旧指纹`);
  ok(v.caveats.some((c) => /不是对那一版效果的评价/.test(c)), `${name}：注记不是效果评价`);
  ok(v.caveats.some((c) => /证明不了那次判定对不对/.test(c)), `${name}：指纹不等于判对了`);
}

/* ─────────── 注记解析 ─────────── */

ok(parsePromptNotes(['2.5.0 改了什么'])[0].version === '2.5.0', '注记首行三段版本号认得出');
ok(parsePromptNotes(['  1.2.3 前有空格'])[0].version === '1.2.3', '前导空格不影响认版本');
ok(parsePromptNotes(['没有版本号的一句话'])[0].version === null, '认不出就记 null，不猜');
ok(parsePromptNotes(['1.2.3.4 四段'])[0].version === null, '四段版本号不认，不截断成三段');
ok(parsePromptNotes(['12.5.0x 尾巴不合法'])[0].version === null, '版本号后面接字母不认');
ok(parsePromptNotes([]).length === 0, '空注记返回空表');
ok(parsePromptNotes(['x', '2.0.0 y'])[1].version === '2.0.0', '第二行照样按自己的首字认');
ok(same.rows.length === PROMPT_BASELINE.noteCount, '界面拿到的行数 == 基线注记行数', String(same.rows.length));
ok(same.rows.every((r) => r.version !== null), '本机这 8 行注记每行都写清了版本号');
ok(same.rows[0].version === PROMPT_VERSION, '第一行是当前版本');

/* ─────────── 基线必须与源码、现场装配同源 ─────────── */

ok(PROMPT_BASELINE.version === PROMPT_VERSION, '基线版本 == 源码 PROMPT_VERSION');
ok(PROMPT_BASELINE.noteCount === PROMPT_VERSION_NOTE.length, '基线注记行数 == 源码行数');
ok(PROMPT_BASELINE.notes.length === PROMPT_BASELINE.noteCount, '基线注记全文行数与 noteCount 一致');
for (let i = 0; i < PROMPT_VERSION_NOTE.length; i++) {
  ok(PROMPT_BASELINE.notes[i] === PROMPT_VERSION_NOTE[i], `基线注记第 ${i + 1} 行与源码逐字相同`);
}
ok(PROMPT_BASELINE.notes[0]?.startsWith(PROMPT_VERSION) === true, '基线注记首行以当前版本号开头');
ok(Object.keys(PROMPT_BASELINE.fingerprints).length === 36, '基线正好 36 份指纹');
for (const t of THEORIES) {
  for (const m of ANALYSIS_MODES) {
    const key = `${t.id}.${m}`;
    ok(
      PROMPT_BASELINE.fingerprints[key] === buildPrompt(t.id, m).fingerprint,
      `基线 ${key} 的指纹是现场那一把尺子`,
      `${PROMPT_BASELINE.fingerprints[key]}`
    );
  }
}

/* ─────────── 导出件同源 ─────────── */

const mdSame = promptHistoryMarkdown(same).join('\n');
const mdDiff = promptHistoryMarkdown(diff).join('\n');
const mdNone = promptHistoryMarkdown(noRec).join('\n');
ok(mdSame.includes('## 这把尺子'), '导出件有这一段');
ok(mdSame.includes(same.line) && mdSame.includes(same.noteLine), '导出件写的是同一个纯函数算出来的话');
for (const c of same.caveats) ok(mdSame.includes(c), '导出件把三条边界一起带走');
ok(mdSame.includes('v2.5.0') && mdSame.includes('本机版本变更史'), '导出件列了本机变更史');
ok(mdDiff.includes('内核切成带出处的块'), '另一版的注记全文跟着导出件走');
ok(mdNone.includes(noRec.line) && !/>\s*2\.0\.0/.test(mdNone), '没记版本时导出件不塞一条别人的注记');
ok(promptHistoryMarkdown(same).join('\n') === mdSame, '同一份报告两次导出逐字相同');
ok(!mdSame.includes('建议') && !mdSame.includes('推荐'), '导出件不趁机给人建议');

/* ─────────── 接线 ─────────── */

const historyTs = src('src/shared/prompt-history.ts');
const cardTsx = src('src/renderer/src/components/PromptHistory.tsx');
const diagTsx = src('src/renderer/src/components/Diagnosis.tsx');
const overviewTsx = src('src/renderer/src/components/Overview.tsx');
const mdTs = src('src/shared/report-markdown.ts');
const mockTsx = src('src/renderer/src/mock.tsx');
const css = src('src/renderer/src/styles-procedure.css');
const pkg = src('package.json');

ok(/from '\.\.\/\.\.\/docs\/prompts\/BASELINE\.json'/.test(historyTs), '纯函数层读的是落盘基线，不是自己抄一份');
ok(!/'2\.5\.0'/.test(historyTs), '纯函数层不硬编码版本号');
ok(!/新增查谬误/.test(historyTs), '纯函数层不硬编码注记正文');
ok(/export const PROMPT_BASELINE/.test(historyTs), '基线是唯一导出的落盘事实来源');
ok(!/\bscore\b|\bverdict\b|\blevel\b\s*=/.test(historyTs), '纯函数层不打分、不给档位、不改判定');
const PURE_RE = new RegExp('write' + 'FileSync|' + 'append' + 'FileSync|' + 'mkdir' + 'Sync');
ok(!PURE_RE.test(historyTs), '纯函数层一个字节都不写');

ok(/promptHistoryOf\(d\)/.test(cardTsx), '界面调的是同一个纯函数');
ok(!/parsePromptNotes|VERSION_HEAD/.test(cardTsx), '界面不自己解析版本号');
ok(/data-ph=/.test(cardTsx) && /data-ph-line/.test(cardTsx), '栏里带关系与总述探针');
ok(/data-ph-caveats/.test(cardTsx) && /data-ph-note/.test(cardTsx), '边界与注记带探针');
ok(/data-ph-toggle/.test(cardTsx) && /data-ph-rows/.test(cardTsx), '变更史折叠带探针');
ok(/useState/.test(cardTsx), '折叠状态由界面保管，不写进报告');

ok(/import \{ PromptHistoryCard \} from '\.\/PromptHistory'/.test(diagTsx), '报告正文导入这一栏');
ok(/id="sec-prompt-history"/.test(diagTsx), '报告里有可跳的锚点');
ok(
  diagTsx.indexOf('id="sec-divergence"') < diagTsx.indexOf('id="sec-prompt-history"') &&
    diagTsx.indexOf('id="sec-prompt-history"') < diagTsx.indexOf('title="程序裁定"'),
  '这一栏排在分歧账之后、程序裁定之前'
);

ok(/\{ id: 'sec-prompt-history', label: '这把尺子' \}/.test(overviewTsx), '首屏索引有固定一格');
ok(
  overviewTsx.indexOf("{ id: 'sec-divergence'") < overviewTsx.indexOf("{ id: 'sec-prompt-history'"),
  '索引顺序与正文一致'
);

ok(/promptHistoryMarkdown\(promptHistoryOf\(d\)\)/.test(mdTs), '导出件与界面同源，不另拼一段');
ok(
  mdTs.indexOf('out.push(...promptHistoryMarkdown') > 0 &&
    mdTs.indexOf('out.push(...promptHistoryMarkdown') < mdTs.indexOf('/* ── 程序裁定'),
  '导出件这一段排在程序裁定之前（盯调用点，不是 import 行）'
);

ok(/function withPromptHistory/.test(mockTsx), '预览页配了四种状态');
for (const q of ['old', 'unknown', 'none', 'mismatch']) {
  ok(mockTsx.includes(`q === '${q}'`), `预览参数 ?ph=${q} 有对应分支`);
}
ok(/PROMPT_BASELINE\.fingerprints\[combo\]/.test(mockTsx), '预览夹具的指纹取自基线，不写死数字');
for (const cls of ['.ph-note', '.ph-caveats', '.ph-rows', '.ph-line', '.ph-toggle']) {
  ok(css.includes(cls), `样式里有 ${cls}`);
}
ok(/"check:prompt-history"/.test(pkg), '关卡已注册进 package.json');

/* ─────────── 提示词一个字没动 ─────────── */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(resolve(process.cwd(), dir))) {
    const p = `${dir}/${n}`;
    if (statSync(resolve(process.cwd(), p)).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}
const promptFiles = walk('src/main/prompt');
const leaked = promptFiles.filter((p) => /PromptHistory|prompt-history|这把尺子|sec-prompt-history/.test(src(p)));
ok(leaked.length === 0, '提示词一个字没动：版本追溯不进模型上下文', leaked.join(','));
const docFiles = readdirSync(resolve(process.cwd(), 'docs/prompts')).filter((n) => n.endsWith('.md'));
const leakedDocs = docFiles.filter((n) => /这把尺子|sec-prompt-history/.test(src(`docs/prompts/${n}`)));
ok(leakedDocs.length === 0, '三十六份导出全文里没有这一栏的字', leakedDocs.join(','));

/* ─────────── 检查器自身 ─────────── */

/*
 * 这个守卫自己不能写文件。上一轮在这里吃过一次亏：正则字面量把自己那行也匹配了，
 * 于是整条断言恒红；这里把关键字拆开拼，源码里不出现完整的敏感词。
 */
const WRITE_RE = new RegExp('write' + 'FileSync|' + 'append' + 'FileSync|' + 'mkdir' + 'Sync');
const selfSrc = src('scripts/check-prompt-history.ts');
ok(!WRITE_RE.test(selfSrc), '检查器一个字节都不写（只读源码与基线）');
ok(/ok\(passed >=/.test(selfSrc), '有断言总数兜底');

/* ─────────── 收口 ─────────── */

ok(passed >= 130, '断言总数兜底（至少 130 项）', String(passed));

if (failed.length) {
  console.error(`\n✗ 这把尺子：${failed.length} 条没过\n`);
  for (const f of failed.slice(0, 40)) console.error(`  · ${f}`);
  if (failed.length > 40) console.error(`  · 其余 ${failed.length - 40} 条见上`);
  process.exit(1);
}
console.log(`✓ 这把尺子：${passed} 条（v${PROMPT_VERSION}、${PROMPT_BASELINE.noteCount} 行注记）`);
