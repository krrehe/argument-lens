/**
 * 重放检查。跑法：npm run check:replay
 *
 * 两件事，缺一不可：
 *
 * 一、**比对内核本身要被验**。它会「说两份一样」——而一个永远说「一样」的比对器
 *    比没有比对器更坏：它给出一片绿，让人以为改坏的东西没坏。所以先故意造几种差异，
 *    确认它一种都没漏，再看它对「真的一样」的两份是否闭嘴。
 *
 * 二、**拿基准存档跑一遍真链路**。`scripts/fixtures/replay/` 里冻着六份报告（都带模型原文），
 *    跑解析 → 十一道裁决 → 自检，产物必须与存档一致。
 *    它们进了 `verify`，所以从此改裁决之后一秒就知道动没动过别人的结论。
 *
 * 基准的局限必须说清：六份都是**同一段原文、同一副透镜**。
 * 它们全绿只说明这一段没被改坏。这不是覆盖面，这是一个哨兵。
 * 唯一被刻意拉开的是模式——「给档位」与「不给档位」两条路各有人守，因为 G8 只在前者之外生效。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffReports, flatten, suspectOf, withoutRuntimeOnly } from '@shared/replay';
import { MODE_META, type Diagnosis } from '@shared/types';
import { loadArchives, replayOne } from './replay-lib';

let passed = 0;
const failed: string[] = [];

function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) {
    passed += 1;
  } else {
    failed.push(detail ? `${label}（${detail}）` : label);
  }
}

/* ── 1. 比对内核：先确认它抓得住 ── */

/* 一份最小的报告骨架。只放会被用到的字段，其余留空——
   比对器若依赖某个没放进去的字段，下面的断言会立刻暴露。 */
const base = (): Partial<Diagnosis> => ({
  id: 'r1',
  mode: 'diagnose',
  theory: 'walton',
  createdAt: 1,
  passage: '原文',
  verdict: { scale: '尺', scaleValue: 'A', level: 'weakened', statement: 's', qualification: 'q', whatIsRefuted: 'argument-only' },
  checks: [
    { id: 'CQ1', answer: 'passed', basis: 'b' },
    { id: 'CQ2', answer: 'violated', basis: 'b' },
  ],
  diagnostics: [{ level: 'warn', code: 'G6_CHECK_SYSTEM_FIXED', message: 'm' }],
  labels: [{ id: 'x', name: '事后归因' }],
} as unknown as Partial<Diagnosis>);

ok(diffReports(base(), base()).diffs.length === 0, '同一份和自己比：零差异');

const lv = base();
(lv.verdict as any).level = 'fails';
const lvDiff = diffReports(base(), lv);
ok(lvDiff.diffs.length === 1, '改一个档位：正好一处差异', `实得 ${lvDiff.diffs.length}`);
ok(lvDiff.diffs[0]?.path === 'verdict.level', '差异带路径名', `实得 ${lvDiff.diffs[0]?.path ?? '（无）'}`);
ok(lvDiff.diffs[0]?.before === 'weakened' && lvDiff.diffs[0]?.after === 'fails', '差异记得两侧原值');

const cut = base();
(cut.checks as any).pop();
const cutDiff = diffReports(base(), cut);
ok(
  cutDiff.diffs.some((d) => d.path === 'checks.length' && d.before === '2' && d.after === '1'),
  '少一条检查项：数组长度单独成一条差异'
);

const more = base();
more.diagnostics = [...(more.diagnostics ?? []), { level: 'warn', code: 'G7_CHECKLIST_FILLED', message: 'm' }];
const moreDiff = diffReports(base(), more);
ok(
  moreDiff.diffs.some((d) => d.path.startsWith('diagnostics[') && d.after.includes('G7_CHECKLIST_FILLED')),
  '多一条裁决留痕：抓得到具体是哪个码'
);

/*
 * 「新增字段」与「值被改掉」必须分开。
 * 存档写在那个字段存在之前（labels[].quote 就是后加的），这不是回归；
 * 混在一起数的后果是这条命令对旧存档永远红，而永远红的检查等于没有。
 */
const newer = base();
(newer.labels as any)[0].quote = null;
const addDiff = diffReports(base(), newer);
ok(addDiff.diffs.length === 0, '存档没有、现在有的字段：不算回归', `实得差异 ${addDiff.diffs.length}`);
ok(addDiff.added.length === 1 && addDiff.added[0].path === 'labels[0].quote', '但它必须被列出来');

/* 反方向不适用：存档有值、现在没了，是真的丢了东西 */
const older = base();
(older.labels as any)[0].name = undefined;
const dropDiff = diffReports(base(), older);
ok(dropDiff.diffs.length === 1, '存档有、现在没有：仍算差异（方向不对称是故意的）');

/* 输入字段不参与比对：raw 是喂进去的原文，不是重算出来的产物 */
const withRaw = base();
withRaw.raw = { text: '模型原文', attempts: 1 };
ok(diffReports(base(), withRaw).diffs.length === 0, 'raw 是输入，不参与比对');

/* 运行时诊断单列，不进差异 */
const rt = base();
rt.diagnostics = [...(rt.diagnostics ?? []), { level: 'info', code: 'JSON_REPAIRED', message: '出过一次格式损坏' }];
const rtDiff = diffReports(base(), rt);
ok(rtDiff.diffs.length === 0, '运行时诊断不算差异（它是那次运行的产物，重放复现不了）');
ok(rtDiff.uncompared.length === 1 && rtDiff.uncompared[0].code === 'JSON_REPAIRED', '但要写明为什么没比');
ok(withoutRuntimeOnly(rt).diagnostics?.length === 1, '摘掉运行时诊断后只剩可复算的那条');

/* 长值截断，但长度要留下——否则「改了两个字」和「整段换掉」长得一样 */
const long1 = base();
(long1 as any).verdict.statement = '甲'.repeat(300);
const long2 = base();
(long2 as any).verdict.statement = '乙'.repeat(301);
const longDiff = diffReports(long1, long2);
ok(longDiff.diffs[0]?.beforeLen === 300 && longDiff.diffs[0]?.afterLen === 301, '长文本差异记得两侧字数');

/* 摊平不能让不存在的路径凭空出现 */
ok(!flatten(base()).has('raw'), '摊平时跳过输入字段');
ok(flatten(base()).get('checks.length') === 2, '数组长度进摊平结果');

/* 差异要指向最可能动它的那段代码，否则读的人得自己去几十个字段里找 */
ok(suspectOf('verdict.level').includes('裁决'), '档位差异指向裁决');
ok(suspectOf('checks[3].answer').includes('检查表'), '检查项差异指向检查表归一');
ok(suspectOf('labels[0].quote').includes('命名'), '命名差异指向 G4/G11');

/* ── 2. 基准存档跑真链路 ── */

const DIR = 'scripts/fixtures/replay';
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
ok(files.length >= 3, '基准存档至少三份', `实得 ${files.length} 份`);

const loaded = loadArchives(DIR);
ok(loaded.ready.length === files.length, '每一份基准都有模型原文（否则根本没法重放）', `${loaded.ready.length}/${files.length}`);
ok(loaded.broken.length === 0, '基准文件都解得出', loaded.broken.map((b) => b.file).join('、'));

/* 基准里那几份的提示词版本要留着：真有人改了提示词，它们不会因此变红
   （重放不跑提示词），但「这份基准出自哪一版」是该被看见的事实 */
ok(
  loaded.ready.every((e) => Boolean(e.report.prompt?.version)),
  '每份基准都记着提示词版本'
);

/*
 * 基准的覆盖面本身也要有人守。
 *
 * 删掉一份同时也能让它变绿——这是基线类检查的通病，所以把「必须有哪几类」写成断言：
 * 「给档位」与「不给档位」两条路必须都有人。G8 只在后者生效，
 * 只有诊断模式那几份的时候，把 G8 整段删掉也照样全绿（这一点是真发生过的形状）。
 */
const modes = new Set(loaded.ready.map((e) => e.report.mode));
ok(modes.size >= 2, '基准覆盖至少两种模式', `实得 ${[...modes].join('、')}`);
ok(
  [...modes].some((m) => MODE_META[m].givesVerdict),
  '基准里有「给档位」的模式（诊断 / 红队）'
);
ok(
  [...modes].some((m) => !MODE_META[m].givesVerdict),
  '基准里有「不给档位」的模式（查谬误 / 重构 / 提问）——G8 只在这一类里生效'
);

for (const entry of loaded.ready) {
  const out = replayOne(entry.report);
  const tag = entry.report.id;
  ok(out.ok, `重放跑得完：${tag}`, out.failed ? `${out.failed.stage}：${out.failed.why}` : '');
  if (!out.ok) continue;

  const d = out.diff!;
  /* 这一条是整份文件的重点：改坏任何一条裁决，它就会红在这里。 */
  ok(
    d.diffs.length === 0,
    `产物与存档一致：${tag}`,
    d.diffs.map((x) => `${x.path} ${x.before} → ${x.after}`).join('；')
  );
  /* 「一致」不能靠「什么都没比」换来：重算出来的必须是一份完整的报告。
     一个空壳也能和另一份空壳「完全一致」。 */
  ok(
    out.replayed ? flatten(out.replayed).size > 60 : false,
    `重算出来的是完整报告，不是空壳：${tag}`,
    `摊平后只有 ${out.replayed ? flatten(out.replayed).size : 0} 个字段`
  );
}

/* 断言总数兜底：少跑就是静默跳过 */
ok(passed >= 26, '断言总数不少于 26 项', `实际 ${passed}`);

if (failed.length) {
  console.error(`\n✗ 重放检查失败 ${failed.length} 项（通过 ${passed} 项）`);
  for (const f of failed) console.error(`  - ${f}`);
  process.exit(1);
}

const rawBytes = files.map((f) => readFileSync(join(DIR, f), 'utf-8').length);
console.log(
  `✓ 重放检查通过 ${passed} 项（基准 ${files.length} 份，共 ${Math.round(rawBytes.reduce((a, b) => a + b, 0) / 1024)} KB）`
);
