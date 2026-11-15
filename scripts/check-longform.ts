/**
 * 长文逐段分析的只读检查。
 *
 * 这一关要守的不是「功能能用」，是**它没有偷偷变成一件它做不到的事**：
 *   - 计划必须守恒：跑几段 + 跳过几段 = 切出几段，一段都不许凭空空掉；
 *   - 跳过必须带理由，超上限更不许静默截断；
 *   - 汇总只数个数，不许出现「总分」这种把档位相加的东西；
 *   - 台账只存索引，不含报告正文；
 *   - 提示词一个字没动，判定一行没改。
 *
 * 防恒真：同一组断言里必须有真也有假——短文本 calls 必须为 0，
 * 同一函数在六段样本上必须 > 0。只验 true 的断言在「永远返回空」的实现下也会绿。
 *
 * 跑法：npm run check:longform（已进 verify）
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  LEDGER_VERSION,
  LONGFORM_BOUNDS,
  MAX_JOBS,
  indexOfReport,
  ledgerId,
  ledgerLine,
  levelOf,
  longformMarkdown,
  makeItems,
  nextJob,
  passageHash,
  patchItem,
  planLine,
  planLongform,
  resumeIdle,
  stopIdle,
  summarize,
  type LongItem,
  type LongLedger,
} from '@shared/longform';
import type { Diagnosis } from '@shared/types';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, extra = ''): void {
  if (cond) passed++;
  else failed.push(extra ? `${label}（${extra}）` : label);
}
function src(p: string): string {
  return readFileSync(resolve(process.cwd(), p), 'utf-8');
}

/* ─────────── 0. 样本 ─────────── */

/** 六段：三段自带结论、两段是陈述、一段是问句。空行分段，作者自己划的段界。 */
const SIX = [
  '我们学校去年取消了早读，今年高考一本率下降了 6 个百分点。这说明取消早读是错的。',
  '王校长在公开材料里说，早读能提高记忆效率，学生就该早起读书。但他没有给出任何数据。',
  '如果连早读都保证不了，将来上课、自习、考试还能保证什么？',
  '另外，很多家长也反对取消早读，可见取消早读不得人心。',
  '学校的作息安排应当听取家长意见，这一点在教育部文件里有明确规定。',
  '总之，早读必须立刻恢复，否则教学质量会继续下滑。',
].join('\n\n');

const plan = planLongform(SIX);

/* ─────────── 1. 计划：守恒、跳过、上限 ─────────── */

ok(plan.segments === 6, '六段样本真的切出六段', `实际 ${plan.segments}`);
ok(plan.jobs.length + plan.skipped.length === plan.segments, '跑几段 + 跳过几段 = 切出几段（一段都不许凭空消失）');
ok(plan.calls === plan.jobs.length, '调用次数就是可跑段数');
ok(plan.totalChars === plan.jobs.reduce((n, j) => n + j.chars, 0), '总字数按可跑段相加');
ok(plan.jobs.length > 0, '六段样本上至少有一段可跑（否则下面的断言全是空的）');
ok(planLongform('').calls === 0, '空文本没有可跑的段（对照组：同一函数在样本上不是 0）');
ok(planLongform('短短一句话。').calls === 0, '太短的文本不排段（没有可切的段）');
ok(planLongform('短短一句话。').long === false, '太短的文本不标成「长文」');

const skippedIdx = plan.skipped.map((s) => s.index);
ok(skippedIdx.includes(2), '以问号结尾的那一段被跳过');
const askWhy = plan.skipped.find((s) => s.index === 2)?.why ?? '';
ok(askWhy.includes('问句'), '问句段的跳过理由说的是「问句」，不是一句通用话');
ok(plan.jobs.every((j) => j.index !== 2), '被跳过的段没有混进可跑清单');

/* 跳过必须能被用户推翻：?includeAside 时那一段回到可跑清单。 */
const withAside = planLongform(SIX, { includeAside: true });
ok(withAside.jobs.length === plan.jobs.length + 1, '允许跑「不像论证」的段时，那一段真的回来了');
ok(withAside.skipped.length === plan.skipped.length - 1, '允许跑之后，跳过清单少一条');

/* 上限：不许静默截断。 */
const capped = planLongform(SIX, { maxJobs: 2 });
ok(capped.jobs.length === 2, '超过上限时只排 2 段');
ok(capped.jobs.length + capped.skipped.length === capped.segments, '截断之后仍然守恒');
const over = capped.skipped.filter((s) => s.why.includes('上限'));
ok(over.length === capped.segments - capped.jobs.length - 1, '超上限的段逐条写进跳过清单，不是悄悄少跑', `实际 ${over.length}`);
ok(
  capped.jobs.every((j) => j.kind === 'argument'),
  '超上限时优先保留「自带结论」的段',
);
ok(
  capped.jobs.map((j) => j.index).join(',') === [...capped.jobs.map((j) => j.index)].sort((a, b) => a - b).join(','),
  '排出来的段仍按原文顺序，读起来和文章一致',
);
ok(MAX_JOBS >= 2 && MAX_JOBS <= 12, '一次上限落在 2–12 段之间（太少没用，太多就是烧钱）');

/* 警告：硬切、跳过、只剩一段、超长，都必须说出来。 */
ok(plan.warnings.some((w) => w.includes('跳过') || w.includes('不跑')), '跳过这件事出现在警告里');
ok(planLine(plan).includes('次调用'), '「几次调用」写在点之前就能看到');
ok(planLongform(SIX).calls === plan.calls, '同一段文字永远得到同一份计划（计划是纯函数）');

/* ─────────── 2. 状态机 ─────────── */

const items = makeItems(plan);
ok(items.length === plan.segments, '切出几段就有几行（跳过的段也占一行，段号不断）');
ok(items.map((it) => it.job.index).join(',') === items.map((_, i) => i).join(','), '台账的段号是连续的');
ok(items.filter((it) => it.status === 'skipped').length === plan.skipped.length, '跳过的段在台账里标着 skipped');
ok(items.filter((it) => it.status === 'skipped').every((it) => (it.error ?? '').length > 4), '跳过的行带着理由，不是只写「跳过」');
const runnableCount = items.filter((it) => it.status !== 'skipped').length;
ok(runnableCount === plan.jobs.length, '可跑的段数等于计划里的段数');
ok(
  items.filter((it) => it.status !== 'skipped').every((it) => it.status === 'idle'),
  '刚排好的可跑段都是「还没跑」',
);
ok(nextJob(items)?.job.index === plan.jobs[0].index, '下一个要跑的是第一段');
ok(nextJob(items)?.status === 'idle', '排下一个时不会去跑跳过的段');
/*
 * 上一条是假绿：样本里跳过的段排在第 3 位，而 nextJob 的实现要是「谁都返回 items[0]」，
 * 它照样是 idle。必须把跳过的段放到最前面，才验得出「它会不会被当成可跑的」。
 */
const skItem = items.find((it) => it.status === 'skipped');
const idleItem = items.find((it) => it.status === 'idle');
ok(!!skItem && !!idleItem, '样本里既有跳过的段也有待跑的段（否则下一条会空跑）');
ok(
  !!skItem && !!idleItem && nextJob([skItem, idleItem])?.job.index === idleItem.job.index,
  '跳过的段排在最前面也不会被排进批次',
);
ok(nextJob([]) === null, '空清单没有下一段（不抛错）');

const afterOne = patchItem(items, plan.jobs[0].index, { status: 'ok', reportId: 'r1', level: 'weakened' });
ok(afterOne[0].status === 'ok' && afterOne[0].reportId === 'r1', '按段号更新落到正确的那一行');
ok(afterOne.length === items.length, '更新不增不减行');
ok(items[0].status === 'idle', '更新是不可变的（原数组没被改）');
const same = patchItem(items, 999, { status: 'failed' });
ok(same === items, '越界更新原样返回，不抛错、不生成怪行');

const stopped = stopIdle(afterOne);
ok(stopped.filter((it) => it.status === 'stopped').length === runnableCount - 1, '按停之后没跑的段都标成「按停后没跑」');
ok(stopped[0].status === 'ok', '按停不动已经跑成的那一段');
const resumed = resumeIdle(stopped);
ok(resumed.filter((it) => it.status === 'idle').length === runnableCount - 1, '「接着跑」把按停的段退回待跑');

const sum = summarize([...afterOne.slice(1).map((it) => ({ ...it, status: 'failed' as const, error: 'x' })), afterOne[0]]);
ok(sum.done === 1 && sum.failed === sum.total - 1, '汇总数得出跑成几段、失败几段');
ok(sum.skipped >= 0, '汇总里单列跳过的段数');
ok(sum.levels.every((l) => l.count > 0), '汇总里不出现 0 项的档位（补 0 会让分布看起来更满）');
ok(sum.line.includes('份报告'), '汇总句说的是「几份报告」，不是「一个结论」');
ok(!/总分|平均分|综合/.test(sum.line), '汇总句里没有总分、平均分这类把档位相加的说法');

/* ─────────── 3. 台账 ─────────── */

ok(passageHash(SIX) === passageHash(SIX), '同一段文字指纹稳定');
ok(passageHash(SIX) !== passageHash(`${SIX}多一个字`), '改一个字指纹就变');
ok(passageHash(SIX).length === 8, '指纹是 8 位，能贴在 id 里');
ok(ledgerId(SIX, 1000) === ledgerId(SIX, 1000), '同一篇同一秒得到同一条账');
ok(ledgerId(SIX, 1000) !== ledgerId(SIX, 1001), '不同时间的两批是两条账，不互相覆盖');
ok(ledgerId(SIX, 1000).startsWith('lf-'), '台账 id 有固定前缀');
ok(LEDGER_VERSION === 1, '落盘格式有版本号');

const ledger: LongLedger = {
  version: LEDGER_VERSION,
  id: ledgerId(SIX, 1),
  createdAt: 1,
  passageChars: SIX.length,
  passageHash: passageHash(SIX),
  items: afterOne,
};
ok(indexOfReport(ledger, 'r1') === plan.jobs[0].index, '按报告 id 反查得到段号');
ok(indexOfReport(ledger, 'nope') === null, '查不到时返回 null，不落回第 1 段');
ok(ledgerLine(ledger) === summarize(ledger.items).line, '台账摘要与汇总句同源（不各写一份）');

/* 档位读不出时不猜：范围门判不适用，就没有档位。 */
const base = { verdict: { level: 'weakened' }, scope: { applicable: true } } as unknown as Diagnosis;
ok(levelOf(base) === 'weakened', '正常报告里读得出档位');
ok(levelOf({ ...(base as object), scope: { applicable: false } } as Diagnosis) === null, '判不适用的报告不读档位');
ok(levelOf(null) === null, '没有报告时返回 null');

/* 带得走：一份报告能导出，一批报告只能留在窗口里读，那它就不是账。 */
const md = longformMarkdown(ledger);
ok(md.startsWith('# 长文台账'), '台账 Markdown 有自己的标题');
ok(md.split('\n').filter((l) => l.startsWith('| 第 ')).length === ledger.items.length, '每一段在导出件里各占一行');
ok(md.includes('被削弱'), '行里写的是这一段自己的档位');
ok(LONGFORM_BOUNDS.every((b) => md.includes(b)), '三条边界原样带进导出件（剪走这张表的人看不到界面）');
/*
 * 边界原文里本来就有「不给总分」这几个字，所以不能拿 includes('总分') 当判据——
 * 那会把「明说不给」判成「给了」。要抓的是**算出来的分**：`总分：3` 这种。
 */
ok(!/(总分|综合|平均)[：:]\s*\d/.test(md), '导出件里没有把档位相加算出来的分数');

/* 边界三条，一条都不许删。 */
ok(LONGFORM_BOUNDS.length === 3, '三条边界一句不许少');
ok(LONGFORM_BOUNDS.some((b) => b.includes('不把它们合并')), '边界写明不合并成一条总论证');
ok(LONGFORM_BOUNDS.some((b) => b.includes('不能相加')), '边界写明档位不能相加');
ok(LONGFORM_BOUNDS.some((b) => b.includes('判不了')), '边界写明段与段的关系判不了');

/* ─────────── 4. 静态接线 ─────────── */

const app = src('src/renderer/src/App.tsx');
ok(app.includes('planLongform(passage)'), '界面用的是同一份计划函数');
ok(app.includes('.run(job.job.text'), '逐段跑跑的是那一段的原字，不是整篇');
ok(app.includes('patchItem(') && app.includes('nextJob('), '批次按纯函数状态机推进');
ok(app.includes("await window.api.longform.save"), '每跑完一段就落一次账');
ok(app.includes("setLfLedger(null)"), '单独跑新分析时先撤掉上一批台账（不张冠李戴）');
ok(app.includes('.ofReport(d.id)'), '从历史打开某一段时按报告 id 反查台账');
ok(app.includes("['NO_KEY', 'AUTH', 'TOO_LONG', 'EMPTY_INPUT', 'NETWORK', 'RATE_LIMIT']"), '必然失败的错误就地收手，不把同一句错话写 N 遍');
ok(!app.includes('analysis.run(passage'), '逐段跑不许把整篇当一段送进去');

const bar = src('src/renderer/src/components/SegmentBar.tsx');
ok(bar.includes('onRunBatch'), '切分条上真的挂了逐段跑入口');
ok(bar.includes('data-sg-run-go'), '「确认跑」是可以被点到的（不是只写了一句说明）');
ok(bar.includes('会发起 {plan.calls} 次调用'), '跑之前把调用次数摊开说');
ok(bar.includes('skipMap'), '被跳过的段在列表里标着「这次不跑」');

const panel = src('src/renderer/src/components/LongformLedger.tsx');
ok(panel.includes('LONGFORM_BOUNDS.map'), '三条边界印在台账里，不是只在文档里');
ok(panel.includes('data-lf-open'), '每行都能点开那一段的报告');
ok(panel.includes('data-lf-status'), '每行的状态写进 DOM，端到端读得到');
ok(panel.includes('longformMarkdown(ledger)') && panel.includes('data-lf-copy'), '台账能按 Markdown 复制走，且复制失败要回话');
ok(panel.includes('不是一份统摄全篇的判决'), '台账页脚明说它不是总判决');

const main = src('src/main/longform.ts');
ok(main.includes('renameSync'), '台账先写临时文件再改名（不留半截 JSON）');
ok(main.includes("status === 'running' ? 'stopped' : status"), '落盘时「正在跑」按没跑完处理（重启后不可能还在跑）');
ok(!main.includes('diagnostics'), '台账不碰报告内容');
const preload = src('src/preload/index.ts');
ok(preload.includes("'longform:save'") && preload.includes("'longform:ofReport'"), '台账的读写都过 IPC');

const shared = src('src/shared/longform.ts');
ok(!/from '\.\.\/main|from 'electron'|fetch\(/.test(shared), '纯函数层不碰主进程、不发请求');
ok(!/verdict\.level\s*=/.test(shared), '纯函数层不改报告里的档位');

/* 提示词一个字没动：这一层只决定「送哪一段」，不决定「怎么问」。 */
const promptIndex = src('src/main/prompt/index.ts');
ok(!/longform|Longform/.test(promptIndex), '提示词装配里没有长文相关的东西（只换输入，不换问法）');
const mock = src('src/renderer/src/mock.tsx');
ok(mock.includes("QS.get('longform')") && mock.includes("QS.get('seg') === '1'"), '预览页留了台账与切分条两个入口');

const readme = src('README.md');
ok(readme.includes('长文台账') || readme.includes('逐段跑'), 'README 写了这件事');
const agents = src('AGENTS.md');
ok(agents.includes('check:longform'), '交接书点名了这一关');

/* 自检：断言总数兜底，防止哪天被删到只剩几条还全绿。 */
const total = passed + failed.length;
ok(total >= 60, '断言条数没有被砍到失去意义', `实际 ${total}`);

if (failed.length) {
  for (const f of failed) console.error(`✗ ${f}`);
  console.error(`\n✗ 长文逐段分析有 ${failed.length} 处不对（共 ${total} 项）`);
  console.error('  计划必须守恒、跳过必须带理由、档位不许相加、提示词与判定一个字都不许动。');
  process.exit(1);
}
console.log(`✓ 长文逐段分析：${total} 条全部通过｜计划守恒、跳过有理由、档位不相加、只换输入不换问法`);
