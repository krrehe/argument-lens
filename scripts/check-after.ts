/**
 * 「报告出来之后」的三件事：拿走、跳回、重跑。
 *
 * 一份报告读完之后，用户手里通常只剩三个动作：把它带走（复制 / 导出 / 打开文件）、
 * 回到自己记过意见的那一处再看一眼、换一副透镜对同一段字重跑一次。
 * 这三件事以前都只有半截：导出只显示一个会被截断的路径，异议记完就散在十万像素里，
 * 「需要重新运行」那句提示下面一个按钮都没有。
 *
 * 所以这里守的不是文案，是四个「看起来做了、其实没接上」的失败方式：
 *   1. 异议账把别的报告的记录算进来，或同一处重复记两条就数成两条；
 *   2. 组顺序随「今天先记了哪一条」变，第二天找不到昨天那条；
 *   3. 「复制」另拼一份 Markdown，与导出的 .md 迟早不一样；
 *   4. 「打开文件」变成打开本机任意路径的通道，或按钮点了没有任何反应也照样绿。
 *
 * 防恒真写在样本里：主样本**故意不是时间有序的**、**故意含一条认不出位置的旧记录**、
 * **故意让同一 key 出现两次且理由不同**——去掉去重或排序，对应断言立刻红。
 *
 * 跑法：npm run check:after
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Diagnosis, Objection } from '@shared/types';
import { digestLine, digestOf } from '@shared/objection-digest';
import { findInReport, highlightParts, parseTerms, WHERE_LABEL } from '@shared/archive-search';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}
const src = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');

/* ─────────── 一 · 样本：故意打乱、故意重复、故意有一条认不出位置 ─────────── */

const T = Date.UTC(2026, 10, 12, 9, 0);
const obj = (p: Partial<Objection> & { key: string }): Objection => ({
  diagId: 'd1',
  at: T,
  theory: 'toulmin',
  field: 'check',
  refId: 'CQ1',
  refLabel: 'CQ1 相关性',
  excerpt: '这一条的依据',
  reason: '',
  ...p,
});

const LIST: Objection[] = [
  /* 不是时间有序：第一条是最晚的，最后一条是其次 */
  obj({ key: 'k-legit', field: 'legitimate', refId: 'P2', refLabel: '此处合法', at: T + 5000, reason: '这里是转述，不是拿权威压人。' }),
  obj({ key: 'k-verdict', field: 'verdict', refId: 'verdict', refLabel: '判读', at: T + 1000 }),
  /* 同一处写了两遍，后写的理由是用户最后的意思 */
  obj({ key: 'k-cq2', field: 'check', refId: 'CQ2', refLabel: 'CQ2 因果方向', at: T + 2000, reason: '旧理由：样本只有一届。' }),
  obj({ key: 'k-cq2', field: 'check', refId: 'CQ2', refLabel: 'CQ2 因果方向', at: T + 3000, reason: '新理由：那一年同时换了教材。' }),
  obj({ key: 'k-cq3', field: 'check', refId: 'CQ3', refLabel: 'CQ3 替代解释', at: T + 2500 }),
  /* 旧版本写下的、field 认不出来的记录：不许静默丢掉 */
  obj({ key: 'k-old', field: 'ancient' as Objection['field'], refId: 'x', refLabel: '旧记录', at: T + 400 }),
  /* 别的报告：一条都不该算进来 */
  obj({ key: 'k-other', diagId: 'd2', field: 'verdict', refId: 'verdict', refLabel: '判读', at: T + 9000 }),
  /* 工作台里钉在句子上的：同属这份报告，但没有可跳的区块 */
  obj({ key: 'k-anchor', field: 'anchor', refId: 'workbench', refLabel: '原文第 2 句', at: T + 3500 }),
];

const SNAPSHOT = JSON.stringify(LIST);
const dg = digestOf(LIST, 'd1');

/* ─────────── 二 · 纯函数 ─────────── */

ok(dg.total === 6, '一份报告里的异议总数按 key 去重（6 条，不是 7 条）', String(dg.total));
ok(dg.sections.map((s) => s.title).join('|') === '判读|逐关检查|此处合法|在工作台里钉的|位置不明', '分组顺序固定，与阅读顺序一致', dg.sections.map((s) => s.title).join('|'));
ok(dg.sections[1].items.length === 2, '「逐关检查」里两条不同的检查项都在', String(dg.sections[1].items.length));
ok(dg.sections[1].items[0].key === 'k-cq2' && dg.sections[1].items[0].reason === '新理由：那一年同时换了教材。', '同一 key 留最新那条的理由（后写的覆盖先写的）');
ok(dg.sections[1].items[1].key === 'k-cq3', '组内按时间倒序：最近记的在前');
ok(!JSON.stringify(dg).includes('k-other'), '别的报告里的异议一条都不算进来');
ok(dg.unknown === 1, '认不出位置的旧记录单独计数', String(dg.unknown));
const odd = dg.sections.find((s) => s.unknown);
ok(!!odd && odd.title === '位置不明' && odd.sectionId === null, '认不出的记录进「位置不明」，不给一个假的区块 id');
ok(!!odd && odd.items[0].key === 'k-old', '「位置不明」里就是那条旧记录');
ok(dg.sections.find((s) => s.title === '在工作台里钉的')?.sectionId === null, '工作台里的记录没有可跳的区块（sectionId 为 null）');
ok(dg.sections.filter((s) => s.title === '命名' || s.title === '击败类型').length === 0, '空组不出现（不摆空壳）');
ok(dg.sections.reduce((n, s) => n + s.items.length, 0) === dg.total, '守恒：各组条数之和 = 总数');

/* 确定性：把输入顺序打乱，账必须逐字节一样 */
const shuffled = [LIST[4], LIST[0], LIST[7], LIST[2], LIST[5], LIST[1], LIST[6], LIST[3]];
ok(JSON.stringify(digestOf(shuffled, 'd1')) === JSON.stringify(dg), '输入顺序打乱后整份账不变（分组与排序都有定序）');
ok(JSON.stringify(LIST) === SNAPSHOT, '纯函数不改输入：调用前后原始列表逐字节相同');

/* 边界：空 id 不许把所有历史记录都吞进来 */
ok(digestOf(LIST, '').total === 0, '空 diagId 得到空账（不把「没有报告 id」的历史记录算到当前这份上）');
ok(digestOf([], 'd1').total === 0, '空列表得到空账');
ok(digestOf(LIST, 'nope').total === 0, '不存在的报告得到空账');

/* 同一时刻按 key 定序：两条时间相同的记录顺序不能取决于输入顺序 */
const tie = [
  obj({ key: 'b', at: T, refId: 'CQ9', refLabel: 'b' }),
  obj({ key: 'a', at: T, refId: 'CQ8', refLabel: 'a' }),
];
const tie2 = [tie[1], tie[0]];
ok(
  JSON.stringify(digestOf(tie, 'd1').sections[0].items.map((x) => x.key)) ===
    JSON.stringify(digestOf(tie2, 'd1').sections[0].items.map((x) => x.key)),
  '同一时刻的两条记录，顺序由 key 决定，与输入顺序无关',
);

/* 文案：只数事实，不评价这些异议对不对 */
ok(/6 条/.test(digestLine(dg)), '总述带着条数', digestLine(dg));
ok(/3 处/.test(digestLine(dg)), '总述带着「分布在哪几处」（工作台那条与位置不明的都不算一处报告区块）', digestLine(dg));
ok(!/建议|应该|最好|不妨|推荐|务必|证明|可见/.test(digestLine(dg)), '总述不劝告、不下判断');
ok(digestLine(digestOf([], 'd1')) === '这份报告里没有记下不同意见。', '零条时有一句明确的话（组件不显示它，但常量本身不许说谎）');

/* ─────────── 三 · 内核守则 ─────────── */

const kernel = src('src/shared/objection-digest.ts');
ok(!/from ['"]electron['"]|from ['"]node:|from ['"].*main/.test(kernel), '内核不碰 electron / node / 主进程');
ok(/from '\.\/types'/.test(kernel), '只借 types 的类型，不 import 判定逻辑');
ok(!/\bscore\b|\brecommend\b|\brating\b|\blevel\b/.test(kernel.replace(/\/\*[\s\S]*?\*\//g, '')), '内核没有评分、推荐、档位字段（verdict 只是字段名，不算判定）');
ok(/sectionId: 'sec-verdict'/.test(kernel) && /sectionId: 'sec-checks'/.test(kernel), '区块 id 只有一个来源（这里），界面不另抄一份');

/* ─────────── 四 · 界面接线（防「只剩 import 也绿」） ─────────── */

const comp = src('src/renderer/src/components/ObjectionDigest.tsx');
const diagTsx = src('src/renderer/src/components/Diagnosis.tsx');
const nav = src('src/main/report-nav.ts');
const app = src('src/renderer/src/App.tsx');
const mock = src('src/renderer/src/mock.tsx');
const flow = src('src/renderer/src/styles-flow.css');

ok(/<ObjectionDigest diagId=\{d\.id\} \/>/.test(diagTsx), '报告主体里真的渲染了异议账（不是只有 import）');
ok(
  /<ObjectionCtx\.Provider value=\{objCtx\}>[\s\S]*<DiagnosisView/.test(app),
  '异议账在真应用里确实长在异议上下文中（上下文挂了、账没挂，界面会永远空白）',
);
ok(/import \{ ObjectionDigest \} from '\.\/ObjectionDigest'/.test(diagTsx), '主报告组件引了它');
ok(/if \(!ctx \|\| !dg \|\| !dg\.total\) return null/.test(comp), '零条时整块不渲染（不摆「暂无异议」的空壳）');
ok(/useMemo\(\(\) => \(ctx \? digestOf\(ctx\.list, diagId\) : null\)/.test(comp), '界面用纯函数算，不另写一套分组');
ok(/data-obj-digest=\{dg\.total\}/.test(comp), '探针带着条数');
ok(/data-obj-digest-item="1"/.test(comp), '逐条留了探针');
ok(/data-obj-jump=\{s\.sectionId\}/.test(comp), '「跳到这一节」的按钮带着区块 id');
ok(/new CustomEvent\('al:unfold'/.test(comp), '跳转先派事件让目录把那一节展开');
ok(/window\.addEventListener\('al:unfold'/.test(nav), '目录那边真的接了这个事件');
ok(/setFold\(i, 0\)/.test(nav), '接到事件后是「展开这一节」，不是删 DOM 属性');
ok(/scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/.test(comp), '跳转真的滚过去');
ok(/ctx\.remove\(o\.key\)/.test(comp), '撤销走的是异议那一层同一个删除');
ok(/报告不改，你的意见与它并列留着/.test(comp), '写明「报告不改」（不许写成「按你的意见重算」）');
ok(!/按你的意见|重算|改判/.test(comp), '界面上没有「按我的意见改判」这种话');
ok(/\.odg\b/.test(flow) && /\.odg-head\b/.test(flow) && /\.odg-item\b/.test(flow) && /\.odg-jump\b/.test(flow), '样式表里有这一栏的容器、头、行与跳转按钮');
ok(/\.al-jump-hit\{/.test(nav), '跳过去的落点有短暂高亮（只看滚动落点分不清跳到了哪一节）');

/* ─────────── 五 · 拿走：复制 / 打开 / 定位 ─────────── */

const exp = src('src/main/report-export.ts');
const mainTs = src('src/main/index.ts');
const preload = src('src/preload/index.ts');

ok(/clipboard\.writeText\(text\)/.test(exp), '复制真的写进剪贴板');
ok(/const text = reportToMarkdown\(d\)/.test(exp), '复制走的是与导出同一个 reportToMarkdown（不另拼一份）');
ok(/if \(!d \|\| typeof d\.id !== 'string' \|\| !d\.verdict\) return \{ ok: false/.test(exp), '没有报告时不写一段空内容进剪贴板');
ok(/const SAVED_PATHS = new Set<string>\(\)/.test(exp), '只记本次真的写出过的路径');
ok(/SAVED_PATHS\.add\(r\.filePath\)/.test(exp) && (exp.match(/SAVED_PATHS\.add/g) ?? []).length >= 2, '文本与字节两条导出路径都登记了');
ok(/!SAVED_PATHS\.has\(path\)/.test(exp), '打开 / 定位只认名单里的路径（不给界面开「打开任意文件」的口子）');
ok(/existsSync\(path\)/.test(exp), '文件被移走时说「文件不在了」，不静默失败');
ok(/shell\.showItemInFolder\(path\)/.test(exp), '「在文件夹中显示」用的是系统定位');
ok(/const msg = await shell\.openPath\(path\)/.test(exp) && /return msg \? \{ ok: false/.test(exp), '打开失败把系统原因带回来');

ok(/'report:copyMarkdown'/.test(mainTs) && /'report:openSaved'/.test(mainTs) && /'report:revealSaved'/.test(mainTs), '三个 IPC 都注册了');
ok(/copyMarkdown: \(d: Diagnosis\)/.test(preload) && /openSaved: \(path: string\)/.test(preload) && /revealSaved: \(path: string\)/.test(preload), 'preload 三条通道都暴露了');
ok(/data-copy-markdown="1"/.test(diagTsx), '报告页有「复制 Markdown」按钮');
ok(/data-open-saved="1"/.test(diagTsx) && /data-reveal-saved="1"/.test(diagTsx), '导出成功后真的有「打开文件」与「在文件夹中显示」');
ok(/setActErr\(r\.reason/.test(diagTsx), '打开失败要说出来，不能点了没反应');
ok(/\.exp-act\b/.test(src('src/renderer/src/styles.css')), '这两个按钮有样式（没有样式的按钮在长报告里像一行灰字）');

/* ─────────── 六 · 换透镜之后：说得出就要按得动 ─────────── */

ok(/data-stale="1"/.test(app) && /data-stale-retry="1"/.test(app), '「需要重新运行」那条提示下真的有一个按钮');
ok(/run\(\{ text: diag\.passage, parentId: null \}\)/.test(app), '重跑用的是这份报告的原文，且不与上一版做修订对照');
ok(/不是框里现在那段/.test(app), '写明重跑的不是输入框里现在那段字（可能已被改过）');

/* ─────────── 七 · 预览入口（没人见过的界面等于没做） ─────────── */

ok(/get\('digest'\)/.test(mock) && /DIGEST_ON/.test(mock), '?digest=1 是这一栏的截图入口');
ok(/DIGEST_Q === 'open'/.test(mock) && /data-obj-digest-toggle/.test(mock), '?digest=open 把逐条展开也纳入同一个入口（展开态只有点过才出现）');
ok(/function MaybeDigest/.test(mock), '预览页有一层只在 ?digest=1 时才挂的上下文');
ok(/field: 'anchor'/.test(mock), '演示数据里含工作台那条（证明没有区块可跳时不会渲染跳转按钮）');
ok(/field: 'verdict'/.test(mock) && /field: 'check'/.test(mock), '演示数据覆盖判读与检查项两组');

/* ─────────── 八 · 「跳到」条：新加的两栏得进得去 ─────────── */

/*
 * 这一段守的不是文案，是「做完就藏起来」：命题账与枢纽在真报告里落在一万像素以下，
 * 而首屏那条「跳到」是整页唯一的紧凑索引。不进这条，等于只有滚到底的人才看得见。
 * 两种坏法都要红：①格子没加（读者找不到）；②格子加了但正文里没有那个 id（点了没反应，
 * 看起来像软件卡了一下）。
 */
const ov = src('src/renderer/src/components/Overview.tsx');

ok(/function sectionsFor\(d: Diagnosis\)/.test(ov), '跳转条按这一份的数据现算，不是一张写死的表');
ok(/if \(propositionsOf\(d\)\.total > 0\) extra\.push\(\{ id: 'sec-props'/.test(ov), '有命题才给「命题账」那一格');
ok(/if \(pivotOf\(d\)\.rows\.length > 0\) extra\.push\(\{ id: 'sec-pivot'/.test(ov), '有枢纽才给「枢纽」那一格');
ok(/props\.total > 0/.test(diagTsx) && /pivot\.rows\.length > 0/.test(diagTsx), '正文那边用的是同一个判据（两边判错方向就成了死入口）');
ok(/BASE_SECTIONS\.slice\(0, 3\),\s*\.\.\.extra,\s*\.\.\.disp,\s*\.\.\.BASE_SECTIONS\.slice\(3\)/.test(ov), '两格插在「判读」之后——与正文从上往下的顺序一致');
ok(/return \[\s*\{ id: 'sec-flow', label: '全流程' \}/.test(ov), '「全流程」那一格排在最前（正文里它也在最前）');
ok(/data-qnav=\{s\.id\}/.test(ov), '每格带着要跳去的区块 id（探针不靠按钮文字认）');

const chipTargets = [...ov.matchAll(/id: '(sec-[a-z]+)'/g)].map((m) => m[1]);
const dead = chipTargets.filter((id) => !diagTsx.includes(`id="${id}"`));
ok(chipTargets.length >= 8 && dead.length === 0, '跳转条里的每个 id 在报告里都有落点', dead.join(',') || `只找到 ${chipTargets.length} 格`);
ok(chipTargets.includes('sec-props') && chipTargets.includes('sec-pivot'), '这两格确实在这份清单里', chipTargets.join(','));

/* ─────────── 九 · 接着读：重开时那句话不说假话 ─────────── */

/*
 * 「上次停在第七节」是这个软件里少数**只有本地知道**的事——报告里没有这一句。
 * 所以它一旦说错，读者没有办法从别处发现。四条规矩各守一种说错的方式：
 *   ① 换一份报告沿用了上一份的位置 → 说成「B 的第七节」，其实那是 A 的；
 *   ② 报告一打开停在第一节就记下 → 把上一次真读到的地方抹掉；
 *   ③ 记录指向的节已经不在 → 说「第 12 节」，而这份报告只有 9 节；
 *   ④ 打开就自动滚过去 → 读者从此没有「先看看标题」这个动作。
 * 另外两条是成本：记录不能无限长；平滑滚动穿过好几节时不能逐节写盘。
 */
ok(/var POS_KEY = 'alPos\.v1'/.test(nav), '位置记录有固定的键名');
ok(/MARKS\[LAST_ID\] = \{\s*i: i,\s*t: Date\.now\(\)/.test(nav), '按这一份报告的 id 分开记（不沿用上一份的位置）');
ok(/if \(i <= 0 \|\| i >= HEADS\.length\) return;/.test(nav), '停在第一节不记（记下来等于抹掉上一次真读到的地方）');
ok(/var i = GOTO_I >= 0 && Date\.now\(\) < GOTO_UNTIL \? GOTO_I : CUR;/.test(nav), '刚点过目录就以点的哪一节为准（平滑滚动途中不记中间站）');
ok(/m\.i > 0\) \|\| m\.i >= HEADS\.length/.test(nav), '记录越界时不说话（报告只有 9 节就别说第 12 节）');
ok(/POS_MAX = 40/.test(nav) && /MARKS\[a\]\.t \|\| 0\) - \(MARKS\[b\]\.t \|\| 0\)/.test(nav), '只留最近 40 份，按时间丢最旧');
ok(/setTimeout\(recordPos, 350\)/.test(nav), '滚动穿过几节时只落一次盘（不把中间站记成「读到哪」）');

/** 只截 syncResume 这一段：它紧接在 setFold 之前，边界稳定。 */
const resumeAt = nav.indexOf('function syncResume(');
const resumeEnd = nav.indexOf('function setFold(', resumeAt);
const resumeBody = resumeAt >= 0 && resumeEnd > resumeAt ? nav.slice(resumeAt, resumeEnd) : '';
ok(resumeBody.length > 200 && /data-resume/.test(resumeBody), '截到了「接着读」那一段（截不到时下面的断言不许静默通过）');
ok(!/scrollIntoView/.test(resumeBody), '打开报告时不自动滚过去（只有点了才跳）');
ok(/resume\.onclick = function\(\)\{ goTo\(m\.i(, segEl)?\); \}/.test(resumeBody), '点那句才走 goTo（有那一段时连那一段一起给）');
ok(/上次读到这里/.test(resumeBody) && !/建议|应当先|从这里开始读/.test(resumeBody), '措辞是回忆，不是指令');
ok(/syncResume\(\);/.test(nav.slice(nav.indexOf('function scan(fresh)'), nav.indexOf('window.__alNavToggle'))), 'scan 结尾真的调了它（否则那句话永远不会出现）');

/*
 * 节内那一段：多记一层「读到哪一块」，多出来的是三种新的说错方式。
 *   ⓐ 只记序号 → 报告重跑后整体后移，把读者带到下一段去（它读起来完全正常）；
 *   ⓑ 只记开头几个字 → 两段开头一样就认错，还说得很肯定；
 *   ⓒ 记过、这次找不到 → 悄悄退回节首，人只看见位置不对，不知道为什么。
 * 另外两条是「不记」的边界：只有一块的节不必记；刚点过目录时没读过节内任何一块。
 */
const segAt2 = nav.indexOf('/* ── 节内哪一段');
const segEnd = nav.indexOf('function recordPos(', segAt2);
const segBody = segAt2 >= 0 && segEnd > segAt2 ? nav.slice(segAt2, segEnd) : '';
ok(segBody.length > 400, '截到了「节内哪一段」那一段（截不到时下面的断言不许静默通过）');
ok(/return x \? \{ k: k, x: x \} : null;/.test(segBody), '记的是「序号 + 开头几个字」两样，不是其中一样');
ok(/if \(s\.length < 2\) return -1;/.test(segBody), '正文只有一块的节不记（那里「第 1 段」等于「这一节」）');
ok(/segText\(n\)\.slice\(0, SEG_TXT\) === String\(m\.seg\.x\)/.test(segBody), '找回时逐字比开头（序号对上了、字对不上也不算找到）');
ok(/seg: byClick \? \(GOTO_SEG \? segMarkOf\(GOTO_SEG, i\) : segMark\(i, 1\)\) : segMark\(i\)/.test(nav), '刚点过目录时第一块不算读过；同一次里往下滚到某一块照记');
ok(/if \(k < 0 \|\| k < \(minK \|\| 0\)\) return null;/.test(segBody), '「第一块不算」是这条判据，不是把整段位置一起抹掉');
ok(/var SEG_TXT = 24;/.test(segBody) && /var SEG_SHOW = 12;/.test(segBody), '认的比给人看的长（面板 250px 宽，24 字要占两行）');
ok(/那一段这次没找到/.test(resumeBody), '记过却找不到时说出来，不悄悄退回节首');
ok(/if \(sk !== LAST_SEG\) \{ LAST_SEG = sk; schedulePos\(\); \}/.test(nav), '同一节里换块也记（只看节号变化会整节都不更新）');
ok(/function topLine\(\)/.test(nav) && !/MAIN\.getBoundingClientRect\(\)\.top \+ 72/.test(nav.slice(nav.indexOf('function update('))), '判节与判块用同一条顶线（两处各写一个 72 迟早会分家）');
const focusAt = nav.indexOf('function focusSection(');
const focusEnd = nav.indexOf('function enterRead(', focusAt);
const focusBody = focusAt >= 0 && focusEnd > focusAt ? nav.slice(focusAt, focusEnd) : '';
ok((focusBody.match(/\.scrollIntoView\(\{/g) || []).length === 1, '只滚一次就落到终点（先跳节首再跳段会「滑过去又滑回来」）');

/* ─────────── 十 · 历史检索：按字面找，别把「没找到」说成「没有」 ─────────── */

/*
 * 一百多份报告之后，滚动条已经不是找东西的办法。这一组守四件事：
 *   ① 多词是「都要有」，且不许把两条前提的接缝当成一句话（拼接串会让「乙丙」命中）；
 *   ② 一份报告只出一条结果，片段必须**带得走**（含命中词、截断处有省略号、空白折过、
 *      字没改）；`count` 与片段是两件事，只出现一次与出现九次不是同一条线索；
 *   ③ 顺序不按相关度：相关度本地算不出来，按它排等于替用户判断「这份更像」；
 *   ④ 「没搜到」与「有 N 份读不出来」必须是两句话——合成一句就变成「确实没有」。
 */
const rep = (o: Record<string, unknown>): Diagnosis =>
  ({ id: 'r1', createdAt: 1, passage: '', ...o }) as unknown as Diagnosis;

const S0 = rep({
  passage: '学校上周取消了早读。家长们认为这会影响成绩，因为早读能提高记忆。',
  conclusion: { text: '成绩会下降' },
  premises: [{ text: '早读能提高记忆' }],
  intermediate: [],
  repair: { missingPremise: null, repairedForm: null },
  checks: [{ basis: '原文只给了一个因果断言，没有数据。' }],
  verdict: { statement: '论证被削弱。', qualification: '仅就文中所给' },
});

/* 词法与切分 */
ok(JSON.stringify(parseTerms('  预算  ')) === '["预算"]', '首尾空白不算词');
ok(JSON.stringify(parseTerms('A a A')) === '["a"]', '折小写之后去重（同一个词敲两遍不改变语义）');
ok(JSON.stringify(parseTerms('预算　前提')) === '["预算","前提"]', '全角空格也切词（中文输入法下常打出来的是它）');
ok(JSON.stringify(parseTerms('')) === '[]' && JSON.stringify(parseTerms('   ')) === '[]', '空查询切成空数组，不切成一个空词');

/* 命中与计数 */
const twice = rep({ passage: '早读有用。早读能提高记忆。' });
const h0 = findInReport(twice, ['早读'])!;
ok(h0.count === 2, '同一个词出现两次就数两处', String(h0?.count));
ok(JSON.stringify(h0.where) === '["passage"]', '两次都在原文里');
ok(h0.snippet.includes('早读'), '片段里必须带着搜的那个词，否则它带不走');
ok(h0.snippetWhere === 'passage', '片段取自原文');
const hS0 = findInReport(S0, ['早读'])!;
ok(hS0.count === 3 && JSON.stringify(hS0.where) === '["passage","premise"]', '跨原文与前提命中时，处数相加、类别按固定顺序', `${hS0.count}/${JSON.stringify(hS0.where)}`);
ok(findInReport(S0, ['早读', '预算']) === null, '多词是「都要有」：有一个词全篇没有就不算命中');
const hC = findInReport(S0, ['成绩会下降'])!;
ok(hC.snippetWhere === 'conclusion' && hC.count === 1, '只落在结论里时说得出来是结论', hC.snippetWhere);
const hBoth = findInReport(S0, ['成绩'])!;
ok(hBoth.snippetWhere === 'passage', '两处都有时片段取原文（先让人认出自己的字）');
ok(hBoth.where.length === 2 && hBoth.count >= 2, '命中的类别与处数分开数', `${hBoth.where}/${hBoth.count}`);
const hv = findInReport(S0, ['削弱'])!;
ok(JSON.stringify(hv.where) === '["verdict"]', '只落在判读里时也能找到', JSON.stringify(hv?.where));
ok(JSON.stringify(findInReport(S0, ['上周', '学校'])?.where) === '["passage"]', '两个词落同一类时 where 不重复');
ok(findInReport(rep({ passage: '早读提高成绩' }), ['早读', '成绩'])?.count === 2, '两个词各数一次（同一段里两个词各出现一次）');

/* 不许把两条前提的接缝当成一句话 */
const seam = rep({ passage: '无关', premises: [{ text: '甲乙' }, { text: '丙丁' }] });
ok(findInReport(seam, ['乙丙']) === null, '两条前提的接缝不算命中（拼接串会把「乙丙」认成一句话）');
ok(findInReport(seam, ['丙丁'])?.snippetWhere === 'premise', '单条前提照常找得到');

/* 片段 */
const far = rep({ passage: `${'甲'.repeat(60)}目标${'乙'.repeat(60)}` });
const hf = findInReport(far, ['目标'])!;
ok(hf.snippet.startsWith('…') && hf.snippet.endsWith('…'), '两头都截断时两头都要有省略号');
ok(hf.snippet.includes('目标') && hf.snippet.length < 60, '片段是片段，不是整段原文', String(hf.snippet.length));
const hStart = findInReport(rep({ passage: '目标在开头' }), ['目标'])!;
ok(!hStart.snippet.startsWith('…'), '命中就在开头时不加前省略号');
const hWs = findInReport(rep({ passage: '第一行\n\n   第二行有目标' }), ['目标'])!;
ok(!/[\n\r]/.test(hWs.snippet) && hWs.snippet.includes('第二行'), '片段里的连续空白折成一个空格（列表才不会被撑成五行）');
ok(findInReport(rep({ passage: 'GDP 增长' }), ['gdp'])?.count === 1, '英文不分大小写');

/* 旧存档缺字段时不许抛 */
const bare = rep({ passage: '', conclusion: undefined, premises: undefined, intermediate: undefined, repair: undefined, checks: undefined, verdict: undefined });
let threw = false;
try {
  if (findInReport(bare, ['甲']) !== null) threw = true;
} catch {
  threw = true;
}
ok(!threw, '缺 conclusion / verdict 的旧存档不抛异常，只是搜不到');
ok(findInReport(S0, []) === null, '没有词就没有结果（空查询不返回「全部命中」）');

/* 加亮 */
const parts = highlightParts('早读能提高成绩', ['早读']);
ok(parts.map((p) => p.t).join('') === '早读能提高成绩', '加亮不许改字：切完拼回去必须与原文逐字相同');
ok(parts.filter((p) => p.hit).length === 1 && parts.find((p) => p.hit)?.t === '早读', '只加亮命中的那一截');
const longer = highlightParts('早读能提高成绩', ['早', '早读']);
ok(longer.find((p) => p.hit)?.t === '早读', '长词先试（同时出现「早」与「早读」时别只亮一个字）');
ok(highlightParts('GDP 增长', ['gdp']).some((p) => p.hit && p.t === 'GDP'), '英文加亮不分大小写，但亮的仍是原文那三个字母');
ok(highlightParts('无关文字', ['目标']).every((p) => !p.hit), '找不到就不加亮，也不返回空数组');
ok(JSON.stringify(highlightParts('', ['甲'])) === '[{"t":"","hit":false}]', '空片段不炸');
ok(Object.keys(WHERE_LABEL).length === 7, '七类文字的说明各有一条', String(Object.keys(WHERE_LABEL).length));

/* 接线：纯函数算的东西，界面必须真的在用 */
const hist = src('src/renderer/src/components/History.tsx');
ok(/data-hs-q/.test(hist) && /onChange=\{\(e\) => setQ\(e\.target\.value\)\}/.test(hist), '搜索框是受控的，敲进去就算数（没有「搜索」按钮）');
ok(/parseTerms\(q\)/.test(hist), '切词调纯函数，界面不自己 split');
ok(/\}, 220\);/.test(hist), '延后 220ms 再读盘（每按一键扫一百个文件会顿）');
ok(/alive = false;/.test(hist) && /clearTimeout/.test(hist), '慢的那次回来时不许盖掉快的那次');
ok(/setFinding\(true\);\s*setFound\(null\);/.test(hist), '新查询一出现就清掉旧结果（否则「0 份」可能属于上一句话）');
ok(/list\.filter\(\(m\) => hitById\.has\(m\.id\)\)/.test(hist), '结果只在原列表里筛，不重排');
ok(!/\.sort\(/.test(hist), '界面不排序：先后仍是时间，不是相关度');
ok(/hit \? <Snippet text=\{hit\.snippet\} terms=\{terms\} \/> : m\.excerpt/.test(hist), '命中那一行换成片段，没命中仍是摘要');
ok(/data-hs-excerpt=\{hit \? 'hit' : 'head'\}/.test(hist), '片段与摘要有探针分得开');
ok(/data-hs-line/.test(hist) && /data-hs-state=\{findState\}/.test(hist), '状态条有稳定的读数，不靠猜文案');
ok(/findState[\s\S]{0,400}'none'/.test(hist) && /'pending'/.test(hist), '「还没回来」与「一份都没有」是两个状态');
ok(/不认同义词/.test(hist) && /多个词要都有/.test(hist), '界面上写明按字面找、多词是都要有');
ok(/检查依据/.test(hist) && /中间结论/.test(hist), '界面上写明搜的是哪几类文字');
ok(/words|拼音/.test(hist) === false, '不承诺没做的事（没有拼音检索）');
ok(/outOfList/.test(hist) && /不在列表里/.test(hist), '命中了但列表里没有时说出来（不把两处数字凑成一个）');
ok(!/m\.excerpt\.toLowerCase/.test(hist), '界面不另写一套匹配规则（两套规则迟早给出两种加亮）');

const pre = src('src/preload/index.ts');
ok(/invoke\('archive:find'/.test(pre), 'preload 通了 archive:find');
const mainIndexTs = src('src/main/index.ts');
ok(/ipcMain\.handle\('archive:find'/.test(mainTs) && /typeof q === 'string'/.test(mainTs), '主进程只认字符串（渲染层传来什么都要挡一下）');

const arch = src('src/main/archive.ts');
const findAt = arch.indexOf('export function findReports(');
const findEnd = arch.indexOf('export function getReport(', findAt);
const findBody = findAt >= 0 && findEnd > findAt ? arch.slice(findAt, findEnd) : '';
ok(findBody.length > 300, '截到了 findReports（截不到时下面的断言不许静默通过）');
ok(/const scan = scanDir\(\)/.test(findBody) && !/readdirSync/.test(findBody), '与样本账共用同一次目录扫描（不另写一份循环，否则坏文件份数会两处不一样）');
ok(/unreadable: scan\.issues\.length/.test(findBody), '读不出来的份数照实带回去');
ok(/if \(scan\.dirError\) return \{ \.\.\.empty, dirError: scan\.dirError \}/.test(findBody), '目录打不开时给原因，不给一张「没有」的空表');
ok(/hits\.sort\(\(a, b\) => b\.at - a\.at \|\| a\.id\.localeCompare\(b\.id\)\)/.test(findBody), '按时间倒序，时间相同时按 id 定序（顺序不能随目录读取顺序变）');
ok(/if \(!terms\.length\) return empty/.test(findBody), '空查询不扫盘');

const mockTs = src('src/renderer/src/mock.tsx');
ok(/find: async \(q: string\)/.test(mockTs), '预览页也接了替身，否则一敲字就报错');

/* ─────────── 收口 ─────────── */


if (failed.length) {
  for (const f of failed) console.error(`✗ ${f}`);
  console.error(`\n✗ 报告之后的三件事 ${failed.length} 条没过（共 ${passed + failed.length} 条）`);
  process.exit(1);
}
console.log(`✓ 报告之后的三件事：${passed} 条全部通过｜异议账去重与定序、复制同源、打开只认自己写出的路径、换透镜可重跑`);
