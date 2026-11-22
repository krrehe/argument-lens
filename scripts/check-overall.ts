/**
 * 整体分析与三种改法的断言。
 *
 * 这一层最容易出的错不是崩，而是**看起来有一栏、其实什么都没挂上**：
 * 摘要空着却渲染一个标题、最弱的一处指着一个不存在的编号、
 * 三种改法里有一条没写代价却照样排在列表里。三种坏法都不会报错，
 * 读者只会照着错的位置去改。
 *
 * 所以这里守四件事：
 *   1. 形状核对：空、错类型、指错落点，各有各的说法，不静默吞掉；
 *   2. 代价是硬门槛：没写代价的改法不显示，本地也不替它补；
 *   3. 导出与界面同源：旧报告没有这一栏时，两处都不许多出一段；
 *   4. 界面真的挂上了：组件、条件、目录顺序、样式，一处没接都不算完成。
 *
 * 跑法：npm run check:overall
 */
import { readFileSync } from 'node:fs';
import {
  OVERALL_NOTE,
  REVISIONS_NOTE,
  expectsOverall,
  expectsRevisions,
  locationLabel,
  normalizeOverall,
  normalizeRevisions,
  revisionShortfall,
} from '@shared/overall';
import { reportToMarkdown } from '@shared/report-markdown';
import { checkItem, claim, diag } from './fixture-report';

let passed = 0;
const failed: string[] = [];

function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}

const ids = new Set(['C', 'P1', 'P2', 'M1', 'CQ1', 'CQ2']);

/* ── 一 · 整体分析的形状 ── */

{
  const r = normalizeOverall(
    {
      summary: '  第一段。\n\n第二段。  ',
      strongest: { at: 'P1', what: '最实的一处', why: '有数字' },
      weakest: { at: 'CQ2', what: '最虚的一处', why: '没答' },
      ifOneChange: { at: 'P2', change: '把结论说弱一点', because: '只改这一句就够' },
    },
    ids
  );
  ok(r.value !== null, '完整的一栏能解析出来');
  ok(r.value?.summary === '第一段。\n\n第二段。', '摘要去掉首尾空白，段间空行保留', JSON.stringify(r.value?.summary));
  ok(r.value?.strongest?.at === 'P1' && r.value?.strongest?.what === '最实的一处', '最强的一处带位置与内容');
  ok(r.value?.weakest?.at === 'CQ2', '最弱的一处能指到检查项');
  ok(r.value?.ifOneChange?.change === '把结论说弱一点', '只改一处带改法');
  ok(r.problems.length === 0, '完整的一栏不产生问题', r.problems.join('；'));
}

{
  const r = normalizeOverall({ summary: '   ' }, ids);
  ok(r.value === null, '摘要为空时整栏不成立');
  ok(r.problems.some((p) => p.includes('没有正文')), '摘要为空要说出来，不留一个空标题');
}

{
  const r = normalizeOverall({ summary: '正文。', weakest: { at: 'P9', what: '某处', why: '某因' } }, ids);
  ok(r.value?.weakest?.at === null, '报告里不存在的编号：位置丢掉');
  ok(r.value?.weakest?.what === '某处', '文字照常保留，不因为位置错就吞掉整条');
  ok(r.problems.some((p) => p.includes('P9')), '丢掉位置要留痕，并点出是哪个编号');
}

{
  const r = normalizeOverall({ summary: '正文。', strongest: { what: '', why: '' } }, ids);
  ok(r.value?.strongest === null, '既没内容也没理由的一格不成立');
}

{
  const r = normalizeOverall({ summary: '正文。', ifOneChange: { at: 'P1', because: '理由' } }, ids);
  ok(r.value?.ifOneChange === null, '没写怎么改的「只改一处」不成立');
  ok(r.problems.some((p) => p.includes('怎么改')), '不成立时说清缺的是「怎么改」');
}

{
  ok(normalizeOverall(undefined, ids).value === null && normalizeOverall(undefined, ids).problems.length === 0, '旧报告没有这一栏：安静地没有');
  ok(normalizeOverall([], ids).value === null, '数组不是整体分析');
}

/* ── 二 · 三种改法 ── */

const good = [
  {
    kind: '补前提',
    change: '补一句可核查的桥',
    keeps: '保住因果方向',
    cost: '要真的拿到对照数据',
    fixes: ['P1', 'CQ2'],
    leaves: '仍然支持不了价值判断',
  },
  {
    kind: '降强度',
    change: '把结论改成「可能有关」',
    keeps: '保住数据价值',
    cost: '失去动员力',
    fixes: ['C'],
    leaves: '没回答该不该恢复',
  },
  {
    kind: '换证据',
    change: '把引语挪到背景，另找对照',
    keeps: '保住读者对象',
    cost: '要重新找材料',
    fixes: ['P2'],
    leaves: '解决不了标准问题',
  },
];

{
  const r = normalizeRevisions(good, ids);
  ok(r.value?.length === 3, '三种改法都能解析', `实得 ${r.value?.length ?? 0}`);
  ok(r.problems.length === 0, '完整的三条不产生问题', r.problems.join('；'));
  ok(revisionShortfall(r.value) === null, '正好三条时不说缺');
  ok(revisionShortfall(r.value?.slice(0, 2))?.includes('只给了 2 种'), '少给时照实说少给，不补第三种');
}

{
  const r = normalizeRevisions([good[0], { ...good[1], cost: '  ' }], ids);
  ok(r.value?.length === 1, '没写代价的改法被丢掉');
  ok(r.problems.some((p) => p.includes('没有写代价')), '丢掉代价要说出来，不静默少一条');
}

{
  const r = normalizeRevisions([{ ...good[0], fixes: ['P1', 'P9', 'CQ9'] }], ids);
  ok(r.value?.[0]?.fixes.join(',') === 'P1', '不存在的落点从 fixes 里去掉');
  ok(r.problems.filter((p) => p.includes('P9') || p.includes('CQ9')).length === 2, '每去掉一个都留痕');
}

{
  const r = normalizeRevisions([{ cost: '有代价', change: '' }], ids);
  ok(r.value === null, '没写怎么改的改法不成立');
  ok(r.problems.some((p) => p.includes('怎么改')), '不成立时点出缺的是「怎么改」');
}

{
  ok(normalizeRevisions(undefined, ids).value === null, '旧报告没有改法：安静地没有');
  ok(normalizeRevisions({}, ids).value === null, '对象不是改法列表');
}

/* ── 三 · 导出与界面同源 ── */

const full = diag({
  premises: [claim('P1', 'premise', '去年取消早读，今年一本率降了 6 个点', 0)],
  checks: [checkItem('CQ2', 'unanswered', '因果这一步', 'CQ2 因果方向')],
  overall: {
    summary: '第一段整体判断。\n\n第二段说代价。',
    strongest: { at: 'P1', what: '有一个可核查的数字', why: '它能被校方统计口径验证' },
    weakest: { at: 'CQ2', what: '因果这一步没答', why: '没有对照数据' },
    ifOneChange: { at: 'P1', change: '把结论改成「可能有关」', because: '只改这一句就够' },
  },
  revisions: good,
});

/*
 * 编号翻人话：读者不该为了知道 C 是结论、CQ2 是哪一关而回正文翻。
 * 这里只验翻译，不验「翻得对不对」——那由报告里的角色与标签决定。
 */
ok(locationLabel(full, 'C') === '结论 C', '结论编号翻成「结论 C」');
ok(locationLabel(full, 'P1') === '前提 P1', '前提编号翻成「前提 P1」');
ok(locationLabel(full, 'CQ2') === '检查 CQ2 因果方向', '检查编号带上它自己的显示名');
ok(locationLabel(full, 'X9') === 'X9', '找不到的编号原样返回，不猜它属于哪一类');
ok(locationLabel(full, null) === '', '没有位置时返回空串');

{
  const md = reportToMarkdown(full);
  ok(md.includes('## 整体分析'), '导出件有整体分析一节');
  ok(md.includes('第一段整体判断。') && md.includes('第二段说代价。'), '摘要分段都进了文件');
  ok(md.includes('**最强的一处（P1）**'), '最强的一处带位置');
  ok(md.includes('**最弱的一处（CQ2）**'), '最弱的一处带位置');
  ok(md.includes('**如果只改一处（P1）**'), '只改一处带位置');
  ok(md.includes('## 三种改法与代价'), '导出件有三种改法一节');
  ok(md.includes('### 1. 补前提') && md.includes('### 3. 换证据'), '三种改法按顺序逐条列出');
  ok(md.includes('- 代价：要真的拿到对照数据'), '代价进了文件，不是只留在界面');
  ok(md.includes('仍然没解决'), '改完仍然没解决什么也进了文件');
  ok(!md.includes('建议补充证据'), '导出件不出现本地补写的许愿句');
}

{
  const plain = diag({});
  const md = reportToMarkdown(plain);
  ok(!md.includes('## 整体分析'), '没有这一栏的旧报告：导出件不多一段空标题');
  ok(!md.includes('## 三种改法与代价'), '没有改法的旧报告：导出件不多一段空标题');
}

/*
 * 失败可见：新报告「本应有」这一栏却没有时，界面要照实说，而不是让整栏消失。
 * 旧存档没有这一栏是历史事实，不该补一段空标题——两件事必须分开。
 */
{
  const fresh = diag({ prompt: { version: '3.0.0', fingerprint: 'x' } });
  ok(expectsOverall(fresh), 'v3.0.0 的诊断报告本应有整体分析');
  ok(expectsRevisions(fresh), 'v3.0.0 的诊断报告本应有三种改法');
  const legacy = diag();
  legacy.prompt = undefined;
  ok(!expectsOverall(legacy), '旧报告没有版本：不补一段空标题');
  const fallacy = diag({ mode: 'fallacy', prompt: { version: '3.0.0', fingerprint: 'x' } });
  ok(!expectsOverall(fallacy), '不给档位的模式不要求整体分析');
  const reconstruct = diag({ mode: 'reconstruct', prompt: { version: '3.0.0', fingerprint: 'x' } });
  ok(!expectsRevisions(reconstruct), '重构模式不要求三种改法');
}

/* ── 四 · 界面真的挂上了 ── */

const read = (p: string): string => readFileSync(p, 'utf-8');
const diagnosis = read('src/renderer/src/components/Diagnosis.tsx');
const overview = read('src/renderer/src/components/Overview.tsx');
const overallCard = read('src/renderer/src/components/OverallCard.tsx');
const revisionsCard = read('src/renderer/src/components/RevisionsCard.tsx');
const css = read('src/renderer/src/styles-digest.css');

ok(overallCard.includes('OVERALL_NOTE'), '整体分析卡抬头逐字取自共用常量');
ok(overallCard.includes('data-overall="1"'), '整体分析卡有可探针的挂载点');
ok(overallCard.includes("o.summary\n    .split"), '摘要按空行分段渲染');
ok(revisionsCard.includes('REVISIONS_NOTE'), '改法卡抬头逐字取自共用常量');
ok(revisionsCard.includes('data-revisions="1"'), '改法卡有可探针的挂载点');
ok(revisionsCard.includes('revisionShortfall'), '少给改法时照实说，不补第三种');
ok(overallCard.includes('locationLabel(d, o.strongest.at)'), '整体分析的最强处用「前提 / 结论 / 检查」人话位置');
ok(revisionsCard.includes('r.fixes.map((id) => locationLabel(d, id))'), '改法的落点也用同一套人话位置');
ok(/<dt>代价<\/dt>/.test(revisionsCard), '每条改法都把代价印出来');

ok(/import \{ OverallCard \}/.test(diagnosis) && /<OverallCard d=\{d\} \/>/.test(diagnosis), '报告页挂上了整体分析卡');
ok(/import \{ RevisionsCard \}/.test(diagnosis) && /<RevisionsCard d=\{d\} \/>/.test(diagnosis), '报告页挂上了改法卡');
ok(diagnosis.includes('{(d.overall || expectsOverall(d)) && ('), '整体分析只在有数据或新版应有时渲染');
ok(diagnosis.includes('{(d.revisions?.length || expectsRevisions(d)) && ('), '改法只在有数据或新版应有时渲染');
ok(diagnosis.includes('data-overall-missing="1"'), '新版缺整体分析时写一句「这次没给」，不静默消失');
ok(diagnosis.includes('data-revisions-missing="1"'), '新版缺改法时写一句「这次没给」，不静默消失');
ok(diagnosis.includes('id="sec-overall"') && diagnosis.includes('id="sec-revisions"'), '两栏各有稳定的锚点');

ok(overview.includes('d.overall || expectsOverall(d)'), '目录只在有整体分析（或新版应有）时给一格');
ok(
  overview.includes('(d.revisions && d.revisions.length > 0) || expectsRevisions(d)'),
  '目录只在有改法（或新版应有）时给一格'
);
ok(overview.indexOf('...overall') < overview.indexOf('...pivot'), '目录顺序：整体分析在承重之前');
ok(overview.indexOf('...revisions') < overview.indexOf("{ id: 'sec-repair'"), '目录顺序：改法在修补之前');

ok(/\.ov\s*\{/.test(css) && /\.rv\s*\{/.test(css), '两栏的容器类都有样式，不会裸奔');
ok(OVERALL_NOTE.includes('本地只核对'), '共用抬头写明本地只核落点');
ok(REVISIONS_NOTE.includes('不替它补第三种改法'), '共用抬头写明本地不补第三种改法');

/* ── 五 · 断言总数兜底 ── */

ok(passed >= 45, '断言总数不少于 45 项', `实际 ${passed}`);

if (failed.length) {
  console.error(`\n✗ 整体分析与改法检查失败 ${failed.length} 项（通过 ${passed} 项）`);
  for (const f of failed) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ 整体分析与改法：${passed} 条全部通过｜落点核对、代价是门槛、导出同源、界面接线`);
