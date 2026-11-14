/**
 * 导出件的断言。
 *
 * 这个功能最危险的失败方式不是报错，是**生成一份看起来正常、内容却缺了一截的文件**。
 * 用户不会发现——他已经关掉应用，在写作软件里对着这份文件改稿，
 * 而缺掉的那一条恰是他该补的那一环。所以这里的断言主要不在「格式对不对」，
 * 在「该出现的是不是都出现了」。
 *
 * 第二类断言：**不适用的时候不许假装分析过。**
 * 判了不适用的报告，导出的文件如果还带着「## 判定」和档位，
 * 那份文件就变成了一个它自己都不同意的结论，而且已经离开界面、无法追溯。
 *
 * 跑法：npm run check:export
 */
import { ANSWER_LABEL, WHAT_REFUTED_LABEL } from '@shared/labels';
import { prescriptionsOf } from '@shared/prescriptions';
import { markdownFileName, reportToMarkdown } from '@shared/report-markdown';
import type { Diagnosis } from '@shared/types';
import { checkItem, claim, diag, labelItem, refutation } from './fixture-report';

let passed = 0;
const failed: string[] = [];

function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}

/* ── 样本：一份「有内容」的报告 ── */

const full: Diagnosis = diag({
  premises: [claim('P1', 'premise', '早读能提高记忆效率', 40), claim('P2', 'premise', '一本率下降了两成', 60)],
  intermediate: [claim('P3', 'intermediate', '取消早读是那次下滑的主因', 80)],
  checks: [
    checkItem('CQ1', 'passed', '相关这一事实本身', 'CQ1 相关性'),
    checkItem('CQ2', 'unanswered', '从相关跨到因果这一步', 'CQ2 因果方向'),
    checkItem('CQ3', 'violated', '有没有第三因素被排除', 'CQ3 替代解释'),
  ],
  refutations: [refutation('R1', 'P1', { steelman: '对方会说样本只有一届', evidenceNeeded: ['校方的统计口径'] })],
  diagnostics: [{ level: 'info', code: 'NOTE', message: '这条只是提示，不该出现在导出件里' }],
  prompt: { version: '9.9.9', fingerprint: 'abcdef123456' },
});

const md = reportToMarkdown(full);

/* ── 一 · 抬头与声明 ── */

ok(md.startsWith('# 论证分析 · '), '抬头是报告标题');
ok(md.includes('沃尔顿') || md.includes('型式'), '抬头带透镜名', '取的是 THEORY_BY_ID 的 name');
ok(/这不是判决书/.test(md), '抬头第一段就声明「这不是判决书」');
ok(md.includes('v9.9.9') && md.includes('abcdef123456'), '带提示词版本与指纹');
ok(/对不上原文的地方/.test(md), '说明以原文为准');

{
  /* 旧存档没有版本字段。这时不能编一个，要写明没记。 */
  const old = diag({ prompt: undefined as unknown as Diagnosis['prompt'] });
  ok(reportToMarkdown(old).includes('版本未记录'), '无版本时写「版本未记录」，不编一个');
}

/* ── 二 · 判定必须带着限定 ── */

ok(md.includes('## 判定'), '有判定段');
ok(md.includes('被削弱'), '档位用中文标签', 'LEVEL_LABEL');
ok(md.includes(WHAT_REFUTED_LABEL['argument-only']), '写明被驳倒的是论证而非结论');
ok(md.includes('尺子：'), '给出用的是哪把尺子');
ok(md.includes('争议之点'), '写出争议之点');

/* ── 二之二 · 命题账（判读管得到哪儿） ── */

ok(md.includes('## 每条主张该由什么来定'), '导出件里有命题账（与界面同一份纯函数）');
ok(/凭什么这么归/.test(md) && /什么条件下改归/.test(md), '命题账每行带依据与改归条件，不是四个类名');
ok(!/score|权重/.test(md.split('## 每条主张该由什么来定')[1]?.split('## 结论')[0] ?? ''), '命题账那一段没有分数');
ok(/\*\*路由\*\*　/.test(md), '导出件里写明这一段是纯事实／纯规范／混合，混合时拆成几栏');

/* ── 三 · 原文引用 ── */

ok(md.includes('> 取消早读是错的'), '结论引文以引用块出现');
ok(md.includes('**P1**') && md.includes('**P2**'), '前提逐条列出');
ok(md.includes('**P3**'), '中间结论也列出');

/* ── 四 · 检查项 ── */

ok(md.includes('通过 1') && md.includes('未答 1') && md.includes('未过 1'), '检查项计数与样本一致');
ok(md.includes(`**${ANSWER_LABEL.unanswered}**`), '检查项用中文结论');
ok(md.includes('守着：'), '每条检查项写出它守着论证的哪一处');
ok(md.includes('CQ2 因果方向'), '检查项用显示名而不是裸 id');

/* ── 五 · 下一步：这是导出件的主要用途 ── */

const rx = prescriptionsOf(full);
ok(rx.groups.length > 0, '样本能推出处方', '否则下面几条覆盖断言是空转');
{
  const items = rx.groups.flatMap((g) => g.items);
  const missingNeed = items.filter((it) => !md.includes(it.need.replace(/\r?\n+/g, ' ').trim()));
  const missingAccept = items.filter((it) => !md.includes(it.accept.replace(/\r?\n+/g, ' ').trim()));
  const missingLabel = items.filter((it) => !md.includes(it.checkLabel));
  ok(items.length > 0 && missingNeed.length === 0, '每条处方的「要填什么」都进了文件', `漏 ${missingNeed.length}/${items.length}`);
  ok(items.length > 0 && missingAccept.length === 0, '每条处方的验收标准都进了文件', `漏 ${missingAccept.length}/${items.length}`);
  ok(items.length > 0 && missingLabel.length === 0, '每条处方都带着它对应的检查项名', `漏 ${missingLabel.length}/${items.length}`);
}
ok(md.includes('- [ ]'), '处方是可勾选的清单，不是一段话');
ok(/不改：/.test(md), '每条处方都写了不改的代价');

/* ── 六 · 反驳 ── */

ok(md.includes('对方会怎么打'), '有反驳段');
ok(md.includes('对方会说样本只有一届'), '反驳带 steelman', '查内容，不查标签——标签会改，内容不该丢');
ok(!/对方最可能的反击：对方/.test(md), 'steelman 自带引导语时不叠第二层主语');
ok(md.includes('校方的统计口径'), '需要什么证据也带出来');

/* ── 七 · 程序裁定只写问题，不写流水账 ── */

ok(!md.includes('这条只是提示'), 'info 级诊断不进导出件', '记流水账会把真问题淹掉');
{
  const warned = diag({
    checks: [checkItem('CQ1', 'passed', '相关', 'CQ1 相关性')],
    diagnostics: [{ level: 'warn', code: 'SELF_AUDIT', message: '报告未通过自检：某处自相矛盾' }],
  });
  ok(reportToMarkdown(warned).includes('程序裁定'), '有 warn 时出现程序裁定段');
  ok(reportToMarkdown(warned).includes('某处自相矛盾'), 'warn 的内容被带出');
}

/* ── 八 · 不适用：不许假装分析过 ── */

{
  const off = diag({
    scope: { applicable: false, reason: '这是一段广告文案', outOfScopeAt: null, partialNote: null },
    checks: [],
  });
  const offMd = reportToMarkdown(off);
  ok(offMd.includes('不适用'), '不适用时明说不适用');
  ok(offMd.includes('这是一段广告文案'), '带上不适用的理由');
  ok(!offMd.includes('## 判定'), '不适用时不出判定段', '否则这份文件会变成一个它自己都不同意的结论');
  ok(/不等于「这段文字没问题」/.test(offMd), '说明「不适用」不等于「没问题」');
  ok(offMd.includes('历史'), '给出回头路：完整报告还在本机');
}

/* ── 十 · 查谬误模式：名字要带得出原文 ── */

/*
 * 查谬误报告是最容易被误读的一份导出件：它满纸名字，读者容易把它当成判决书。
 * 所以这一节验两件事——名字后面跟着原文哪一句，以及那句「名字挂上了不等于结论错了」
 * 有没有真的进文件。界面里的横幅出不了这个门，文件里的那段话是最后一道防线。
 */
{
  const fb = diag({
    mode: 'fallacy',
    labels: [labelItem({ quote: '取消早读是错的', span: null })],
    verdict: { scale: '量表', scaleValue: '', level: 'undetermined', statement: '', qualification: '', whatIsRefuted: 'nothing' },
  });
  const fbMd = reportToMarkdown(fb);
  ok(fbMd.includes('## 对得上的名字'), '查谬误导出件用「对得上的名字」作小节标题');
  ok(fbMd.includes('- 原文：取消早读是错的'), '每条名字都带出原文那一句');
  ok(/名字挂上了，不等于这段话的结论是错的/.test(fbMd), '导出件里写明「有名字 ≠ 结论错」');
  ok(fbMd.includes('查谬误'), '抬头标出这是哪一个模式');
  ok(!md.includes('名字挂上了，不等于这段话的结论是错的'), '诊断报告不背这句话', '每个模式都加一遍，话就白说了');

  const missed = reportToMarkdown(
    diag({
      mode: 'fallacy',
      labels: [labelItem({ quote: '这句话原文里没有', span: { start: 0, end: 3, quote: '这句话', quality: 'failed' } })],
    })
  );
  ok(/没有定位到/.test(missed), '引文没定位到时明说，不让读者以为引对了');
}

/* ── 九 · 确定性与文件名 ── */

ok(reportToMarkdown(full) === md, '同一份报告两次导出全等');
ok(!/[\\/:*?"<>|]/.test(markdownFileName(full)), '文件名不含 Windows 非法字符', markdownFileName(full));
ok(markdownFileName(full).endsWith('.md'), '文件名以 .md 结尾');

/* 空段：连续三个换行意味着中间什么都没有，读者会以为丢内容了 */
ok(!/\n{3,}/.test(md), '没有连续空行堆出的空洞', '空段会被读成「这里本来该有东西」');

/* 断言总数兜底：少跑就是静默跳过 */
ok(passed >= 45, '断言总数不少于 45 项', `实际 ${passed}`);

if (failed.length) {
  console.error(`\n✗ 导出件检查失败 ${failed.length} 项（通过 ${passed} 项）`);
  for (const f of failed) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ 导出件检查通过 ${passed} 项（${md.split('\n').length} 行 Markdown）`);
