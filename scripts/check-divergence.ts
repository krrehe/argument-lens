/**
 * v1.1 分歧内核：二十步里的 F 段与 E4、判定坐标四元组、收束三模式。
 *
 * 这一关最要紧的不是「有没有这一栏」，而是**别让它替人判**。四种坏法逐条守：
 *
 *   1. 软件替评估者默认——四格坐标预填成「经典演绎／型式-CQ／辩证／说服」，
 *      于是 §4.1 那句「四格填不出等于不写法律依据就判决」永远说不出来；
 *   2. 把「登记册为空」当成缺——§E4 只登记三类，收敛且没有犹豫时空册是对的，
 *      判成缺会逼人硬凑几行「这个词用得怪」；
 *   3. 拿一套通用清单量三种收束——收敛报告被要求交举证责任，悬置报告被要求交共同结论；
 *   4. 让它悄悄进提示词——模型会顺着人填的收束模式说话，那不是存档，是诱导。
 *
 * 防恒真：样本里造「收敛 / 分叉 / 悬置 / 缺格 / 全空」五组对照，
 * 任何一条断言在至少一组上必须为假。改坏一处（见本轮反证）对应断言立刻红。
 *
 * 跑法：npm run check:divergence
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Diagnosis, Divergence, DivergenceEntry } from '@shared/types';
import { MOCK } from '../src/renderer/src/mock-data';
import {
  BRANCH_MAX,
  CLOSURE_MODES,
  DIVERGENCE_SOURCES,
  FORK_BANS,
  RANGE_RULES,
  V11_CAVEATS,
  closureLabel,
  divergenceCaveats,
  divergenceGaps,
  divergenceLine,
  divergenceNote,
  divergencePending,
  frameGaps,
  frameLine,
  normalizeDivergence,
  normalizeEntry,
  sameDivergence,
  sourceLabel,
} from '@shared/divergence';
import { flowOf } from '@shared/flow';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}
const src = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');

/* ─────────── 样本 ─────────── */

const PASSAGE = '学校去年取消了早读。'.repeat(30); // 300 字以上 → 标准档，走 F 段
const BASE: Diagnosis = {
  ...MOCK,
  id: 'v11',
  passage: PASSAGE,
  brief: undefined,
  divergence: undefined,
};

const ENTRY: DivergenceEntry = { at: 'B2 补 A：宽读与严读', source: 'F2', stakes: 'level' };
const FRAME = { formal: 'classical', criterion: 'scheme-cq', dimension: 'dialectic', protocol: 'persuasion' } as const;

const FORK: Divergence = {
  frame: { ...FRAME },
  closure: 'fork',
  branches: 2,
  entries: [ENTRY, { at: 'C2 型式：专家意见还是例证', source: 'F3', stakes: 'handling' }],
  common: '缺陷位置与方向一致：支持不足，可加固',
  difference: '补出的 A 与选中的型式',
  condition: '给出原始研究出处→只剩宽读；只给二手转述→只剩严读',
  basis: '宽读：原文第 3 句 + 未过 CQ「样例是否典型」；严读：同一句 + 未过 CQ「转述是否准确」',
  decidable: '',
  burden: '',
  at: 1700000000000,
};
const CONVERGE: Divergence = {
  ...FORK,
  closure: 'converge',
  branches: 0,
  entries: [],
  common: '',
  difference: '',
  basis: '',
  decidable: '',
  burden: '',
};
const SUSPEND: Divergence = {
  ...FORK,
  closure: 'suspend',
  branches: 0,
  common: '',
  basis: '',
  decidable: '「去年取消了早读」可由校历核定',
  difference: '「是否应当恢复」是价值选择，不由论证裁定',
  condition: '需拿到校历与原始通知',
  burden: '主张恢复的一方',
};
const HOLLOW: Divergence = {
  ...FORK,
  frame: { ...FRAME, protocol: 'unknown' },
  common: '',
  condition: '',
  entries: [],
};
const dFork = { ...BASE, divergence: FORK };
const dConverge = { ...BASE, divergence: CONVERGE };
const dSuspend = { ...BASE, divergence: SUSPEND };
const dHollow = { ...BASE, divergence: HOLLOW };

/* ─────────── 一 · 空结构不能写进报告 ─────────── */

ok(normalizeDivergence(null) === null, '传 null → 不写空结构');
ok(normalizeDivergence({}) === null, '四格全 unknown、没有登记、文本全空 → 不写空结构');
ok(
  normalizeDivergence({ frame: { formal: 'classical' } }) !== null,
  '只要填了一格就算登记（哪怕四格没齐）'
);
ok(normalizeDivergence({ closure: 'unknown', entries: [{ at: '', source: 'unknown', stakes: 'unknown' }] }) !== null, '点过「加一条」留下的空行也算登记');
ok(normalizeDivergence({ frame: { formal: '不存在的系统' }, closure: '乱写的模式', condition: 'x' })?.frame.formal === 'unknown', '认不出的枚举收敛到 unknown，不抛错');
ok(normalizeDivergence({ frame: { formal: 'classical' }, closure: '乱写的模式' })?.closure === 'unknown', '收束模式认不出也收敛');
ok(normalizeDivergence({ closure: 'fork' })?.closure === 'fork', '认得出的收束模式照收');
ok(normalizeEntry(null) === null, '登记条目不是对象 → 丢掉');
ok(normalizeEntry({})?.at === '' && normalizeEntry({})?.source === 'unknown', '空条目保留成一行待填，不被静默过滤');
ok(normalizeDivergence({ entries: [{ at: 'x'.repeat(500) }] })!.entries[0].at.length === 160, '字段截到 160 字（防把整段贴进一格）');
ok(normalizeDivergence({ branches: 99 })!.branches === 9, '并列数故意留到 9，好让「超过 3」被数出来而不是被截断');
ok(normalizeDivergence({ closure: 'fork', branches: -3 })!.branches === 0, '负数并列数归零');
ok(normalizeDivergence({ entries: Array.from({ length: 20 }, () => ({ at: 'x' })) })!.entries.length === 8, '登记册最多 8 条（§E4：不是给心虚用的）');

/* ─────────── 二 · 判定坐标与五类分歧源 ─────────── */

ok(frameGaps({ ...FRAME }).length === 0, '四格齐 → 没有缺口');
ok(frameGaps({ ...FRAME, protocol: 'unknown' }).join() === '对话协议', '缺哪一格就点哪一格的名字');
ok(frameGaps({ formal: 'unknown', criterion: 'unknown', dimension: 'unknown', protocol: 'unknown' }).length === 4, '四格全空 → 四格都点名');
ok(frameLine({ ...FRAME }).includes('／') && frameLine({ ...FRAME }).includes('说服'), '坐标那一行用文档的四格写法');
ok(DIVERGENCE_SOURCES.filter((x) => x.id !== 'unknown').length === 5, '五类分歧源 F1–F5 都在');
ok(DIVERGENCE_SOURCES.find((x) => x.id === 'F1')?.side === '评估者的活', 'F1 材料归「评估者的活」');
ok(DIVERGENCE_SOURCES.find((x) => x.id === 'F2')?.side === '评估者的活', 'F2 重构归「评估者的活」');
ok(DIVERGENCE_SOURCES.find((x) => x.id === 'F4')?.side === '评估者的活', 'F4 证据归「评估者的活」');
ok(DIVERGENCE_SOURCES.find((x) => x.id === 'F3')?.side === '对象的性质', 'F3 标准归「对象的性质」');
ok(DIVERGENCE_SOURCES.find((x) => x.id === 'F5')?.side === '对象的性质', 'F5 价值框架归「对象的性质」');
ok(DIVERGENCE_SOURCES.find((x) => x.id === 'F3')?.handling.includes('不可消除'), 'F3 的处置是「只能声明」，不是补材料');
ok(DIVERGENCE_SOURCES.find((x) => x.id === 'F5')?.handling.includes('不可消除'), 'F5 同理：不可消除');
ok(sourceLabel('F2') === 'F2 重构' && sourceLabel('unknown') === '没归类', '标签里带着编号，没归类不伪装成某一类');
ok(CLOSURE_MODES.filter((x) => x.id !== 'unknown').length === 3, '收束三模式：收敛 / 分叉 / 悬置');
ok(CLOSURE_MODES.find((x) => x.id === 'converge')!.trigger.includes('只剩一种读法'), '收敛的触发条件照文档');
ok(CLOSURE_MODES.find((x) => x.id === 'fork')!.trigger.includes('互斥'), '分叉要求互斥，不是「两说都摆上」');
ok(CLOSURE_MODES.find((x) => x.id === 'suspend')!.trigger.includes('举证标准'), '悬置的触发条件照文档');
ok(closureLabel('fork').includes('多方案'), '收束标签说人话');
ok(FORK_BANS.length === 4, '并列四条禁止一条不少');
ok(FORK_BANS.some((x) => x.includes('D5')), '档位稀释那条点名 D5 与诚信判定');
ok(RANGE_RULES.length === 4, '档位区间四条同时满足的规则一条不少');
ok(RANGE_RULES.some((x) => x.includes('F2 或 F3')), '区间只许 F2/F3，F1 材料没看清不许给区间');
ok(V11_CAVEATS.length === 3, '反假阳性 v1.1 新增三条（13–15）都在');
ok(V11_CAVEATS.some((x) => x.includes('有分歧 ≠ 有缺陷')), '第 13 条：有分歧不等于有缺陷');
ok(V11_CAVEATS.some((x) => x.includes('出多方案 ≠ 更严谨')), '第 14 条：出多方案不等于更严谨');
ok(V11_CAVEATS.some((x) => x.includes('两说并存 ≠ 都对')), '第 15 条：两说并存不等于都对');

/* ─────────── 三 · 只数填没填齐，不判填得对不对 ─────────── */

ok(divergenceGaps(FORK).length === 0, '分叉账填齐 → 没有缺口');
ok(divergenceGaps(CONVERGE).length === 0, '收敛账填齐 → 没有缺口（登记册为空不算缺）');
ok(divergenceGaps(SUSPEND).length === 0, '悬置账填齐 → 没有缺口');
ok(!divergenceGaps(CONVERGE).some((x) => x.includes('举证责任')), '收敛报告不被要求交举证责任（不用通用清单量三种模式）');
ok(!divergenceGaps(CONVERGE).some((x) => x.includes('共同结论')), '收敛报告不被要求交共同结论');
ok(!divergenceGaps(FORK).some((x) => x.includes('能裁的部分')), '分叉报告不被要求交悬置三件套');
ok(divergenceGaps({ ...CONVERGE, entries: [] }).length === 0, '登记册为空本身不算缺：§E4 只登记三类');
ok(divergenceGaps({ ...HOLLOW }).some((x) => x.includes('对话协议')), '缺第四格 → 点名「对话协议」');
ok(divergenceGaps({ ...FORK, closure: 'unknown' }).some((x) => x.includes('先试收敛')), '没声明收束 → 提醒判定顺序不能反');
ok(divergenceGaps({ ...HOLLOW }).some((x) => x.includes('共同结论')), '分叉缺矩阵尾部三行 → 逐行点名');
ok(divergenceGaps({ ...HOLLOW }).some((x) => x.includes('收敛条件')), '分叉缺收敛条件 → 点名');
ok(divergenceGaps({ ...FORK, branches: 4 }).some((x) => x.includes('≤3')), `并列超过 ${BRANCH_MAX} → 说「回来重做 B1–B2」`);
ok(divergenceGaps({ ...FORK, branches: 4 }).some((x) => x.includes('4 个方案')), '把超出的数目写出来');
ok(divergenceGaps({ ...FORK, branches: 1 }).some((x) => x.includes('至少两个')), '只写一个方案不许叫分叉');
ok(divergenceGaps({ ...SUSPEND, decidable: '' }).some((x) => x.includes('能裁的部分')), '悬置缺「能裁的部分」→ 点名，并说退回重做 A–C');
ok(divergenceGaps({ ...SUSPEND, burden: '' }).some((x) => x.includes('举证责任')), '悬置缺举证责任 → 点名');
ok(divergenceGaps({ ...CONVERGE, condition: '' }).some((x) => x.includes('什么会推翻此判')), '收敛缺降级条件 → 点名');
ok(divergenceGaps({ ...FORK, entries: [{ at: '', source: 'unknown', stakes: 'unknown' }] }).length >= 3, '空登记行：位置 / F 类 / 影响三处都报出来');
ok(divergenceGaps({ ...FORK, closure: 'fork', entries: [] }).some((x) => x.includes('一条都没登记')), '分叉却没登记 → 说「分歧落在哪儿没写下来」');
ok(!divergenceGaps(FORK).some((x) => /错了|不对|判错/.test(x)), '缺口措辞只说「没填」，不说「填错了」');
ok(divergenceNote(FORK).includes('不是「判对了」'), '填齐时仍明说：填齐不等于判对');
ok(divergenceNote(CONVERGE).includes('先试收敛'), '收敛且无登记的提示照 §4.3 写');
ok(divergenceLine(FORK).includes('坐标：') && divergenceLine(FORK).includes('F2 重构'), '抬头一行带坐标、收束与登记类别');
ok(divergenceLine(CONVERGE).includes('没有登记分歧'), '空册在抬头里明说，不写成一句含糊的「已处理」');
ok(divergenceCaveats(FORK).some((x) => x.includes('先试过收敛')), '分叉时把「先试收敛」写在旁边');
ok(divergenceCaveats(FORK).length >= 4 + 4 + 3, '分叉时四条禁止、四条区间规则、三条反假阳性都看得到');
ok(divergenceCaveats(SUSPEND).some((x) => x.includes('悬置不是弃权')), '悬置时把「不是弃权」写在旁边');
ok(divergenceCaveats(CONVERGE).some((x) => x.includes('有分歧 ≠ 有缺陷')), '收敛时仍显示 v1.1 三条反假阳性');

/* ─────────── 四 · 同一份 / 填了还没生效 ─────────── */

ok(sameDivergence(FORK, { ...FORK, at: 999 }), '时间戳不算差别');
ok(!sameDivergence(FORK, { ...FORK, condition: '换一句' }), '改一个字就是另一份');
ok(divergencePending(undefined, FORK), '报告里没有、输入区填了 → 提醒再跑一次');
ok(divergencePending(FORK, null) === false, '报告里有、输入区空着 → 不提醒');
ok(divergencePending(FORK, { ...FORK }) === false, '同一份 → 不说话');
ok(divergencePending(FORK, { ...FORK, common: '改了' }), '改过一格 → 提醒');
ok(divergencePending(undefined, null) === false, '两边都没有 → 不说');

/* ─────────── 五 · 流程账里的 F 段与 E4 ─────────── */

const fFork = flowOf(dFork);
const fNone = flowOf(BASE);
const fConverge = flowOf(dConverge);
const fHollow = flowOf(dHollow);
const row = (f: ReturnType<typeof flowOf>, id: string) => f.rows.find((r) => r.id === id)!;

ok(fFork.rows.length === 20, 'v1.1 二十步', String(fFork.rows.length));
ok(fFork.rows[13].id === 'F-a' && fFork.rows[16].id === 'E1', 'F 在 D 之后、E 之前');
ok(fFork.rows[19].id === 'E4', 'E4 在交付段末尾');
ok(fFork.rows.find((r) => r.id === 'B4')!.name.includes('K'), 'B4 改叫「定枢纽 K」（v1.1 §0.3 术语消歧）');
ok(fFork.defaultClosure.includes('优先收敛'), '标准档的默认收束是「优先收敛」');
const fQuickDefault = flowOf({ ...BASE, passage: '取消早读以后，一本率掉了。', intermediate: [] });
ok(fQuickDefault.defaultClosure.includes('单判'), '速判档的默认收束是「单判」');
ok(fQuickDefault.defaultClosure.includes('另读'), '速判档写明「真有第二种读法只加一行另读」');

ok(row(fFork, 'F-a').status === 'ok', '填齐的分叉账 → F-a 做了');
ok(row(fFork, 'F-b').status === 'ok', 'F-b 做了');
ok(row(fFork, 'F-c').status === 'ok', 'F-c 做了');
ok(row(fFork, 'E4').status === 'ok', 'E4 做了');
ok(row(fNone, 'F-a').status === 'gap', '没分歧账 → F-a 没做');
ok(row(fNone, 'F-b').status === 'gap', '没分歧账 → F-b 没做');
ok(row(fNone, 'F-c').status === 'gap', '没分歧账 → F-c 没做');
ok(row(fNone, 'E4').status === 'gap', '没分歧账 → E4 没做');
ok(row(fNone, 'F-a').note.includes('当场记一笔'), 'F-a 的缺口里写明「F 贯穿全程、当场记」');
ok(row(fNone, 'F-b').note.includes('先试收敛'), 'F-b 的缺口里写明判定顺序不能反');
ok(row(fNone, 'F-c').note.includes('收敛条件'), 'F-c 的缺口里写明没有收敛条件就永远不收敛');
ok(row(fConverge, 'F-a').status === 'ok', '收敛且空册 → F-a 是「做对了」，不是漏了');
ok(row(fConverge, 'F-a').saw.includes('先试了收敛'), '那一格明说为什么空册没问题');
ok(row(fHollow, 'E4').status === 'partial', '登记了但没填齐 → E4 是一半，不是「没做」');
ok(row(fHollow, 'E4').saw.includes('还缺'), 'E4 那一格把缺几格说出来');
ok(row(fFork, 'F-a').saw.includes('F2 重构'), 'F-a 写本地看到了哪几处、归了哪一类');
ok(row(fFork, 'F-a').note.includes('不判归类对不对'), 'F-a 明说只数登记与归类，不判对不对');

const fTiny = flowOf({ ...BASE, passage: '取消早读以后，一本率掉了。', intermediate: [] });
ok(fTiny.depth === 'quick', '短文本单主张 → 速判档');
ok(row(fTiny, 'F-a').status === 'na', '速判档不走 F-a（§0.1 默认单判）');
ok(row(fTiny, 'E4').status === 'na', '速判档不走 E4');
ok(row(fTiny, 'F-a').note.includes('默认'), '不走的理由里带着「默认收束」那一列');
ok(fTiny.counts.gap + fTiny.counts.ok + fTiny.counts.partial + fTiny.counts.na === 20, '速判档四态仍相加为二十');

const fWith = flowOf({ ...BASE, divergence: FORK });
ok(row(fWith, 'F-a').status === 'ok', '做了的步骤不许被档位抹掉（先看证据再看档位）');
ok(fWith.fine.includes('F 段在文档里'), '边界说明写明 F 贯穿全程、这里只看得到收口');
ok(fWith.fine.includes('不替评估者判'), '边界说明写明区间 / 四条禁止 / 反假阳性属判定口径');
const fAudit11 = flowOf({ ...BASE, passage: '早'.repeat(3000) });
ok(fAudit11.fine.includes('台账') && fAudit11.fine.includes('不虚设第 21 格'), '全场审计档提主张台账，且不虚设第 21 格');

/* ─────────── 六 · 接线：界面 / 导出 / IPC / 预览 ─────────── */

const typesTs = src('src/shared/types.ts');
const divTs = src('src/shared/divergence.ts');
const flowTs = src('src/shared/flow.ts');
const cardTsx = src('src/renderer/src/components/DivergenceCard.tsx');
const appTs = src('src/renderer/src/App.tsx');
const ledgerTsx = src('src/renderer/src/components/FlowLedger.tsx');
const diagTsx = src('src/renderer/src/components/Diagnosis.tsx');
const overviewTs = src('src/renderer/src/components/Overview.tsx');
const mdTs = src('src/shared/report-markdown.ts');
const mockTsx = src('src/renderer/src/mock.tsx');
const preloadTs = src('src/preload/index.ts');
const mainTs = src('src/main/index.ts');
const analyzeTs = src('src/main/analyze.ts');

ok(/divergence\?: Divergence/.test(typesTs), 'Diagnosis 上挂着分歧账（旧存档没有就按没登记处理）');
ok(/export interface Divergence\b/.test(typesTs) && /export interface JudgementFrame\b/.test(typesTs), '坐标四元组与分歧账是两个结构');
ok(/F1' \| 'F2' \| 'F3' \| 'F4' \| 'F5'/.test(typesTs) || /'F1' \| 'F2'/.test(typesTs), 'F1–F5 是类型里写死的五类，不是字符串随便填');
ok(divTs.includes('不判') && divTs.includes('只数'), '纯函数文件头写明「只数填没填齐，不判」');
ok(/case 'F-a'/.test(flowTs) && /case 'F-b'/.test(flowTs) && /case 'F-c'/.test(flowTs) && /case 'E4'/.test(flowTs), '四步各有一段证据核算，不是共用一段');
ok(/at: 'divergence-card'/.test(flowTs), 'F 三步的落点是输入区那张卡');
ok(/at: 'sec-divergence'/.test(flowTs), 'E4 的落点是报告里那一栏');
ok(/go: '去登记分歧'/.test(flowTs), '按钮写「去登记分歧」，不写「看这一节」');
ok(/\['A', 'B', 'C', 'D', 'F', 'E'\]/.test(ledgerTsx), '界面分组按 D → F → E，不按字母序');
ok(/al:divergence/.test(ledgerTsx) && /al:divergence/.test(appTs), '「去登记分歧」派事件，App 收下并展开卡片');
ok(/data-flow-closure/.test(ledgerTsx), '界面上真的显示「默认收束」那一列');
ok(/id="divergence-card"/.test(cardTsx), '输入区那张卡有固定 id（账本的落点指它）');
ok(/data-dv-frame=/.test(cardTsx) && /data-dv-closure=/.test(cardTsx), '四格坐标与收束模式都带探针');
/* §7.4「各方案判据每方案一行」：单行 input 会把第二个方案藏在横向滚动后面，
   填的人会以为没写进去。真机截图上确实只看见第一方案，故改成多行框。 */
ok(/<textarea[\s\S]{0,140}data-dv-text=\{tag\}/.test(cardTsx), '矩阵各格是多行文本框，不是单行 input');
ok(/textarea\.dv-in/.test(src('src/renderer/src/styles-procedure.css')), '多行框有可拉高的样式');
ok(/data-dv-gaps=/.test(cardTsx) && /data-dv-pend="1"/.test(cardTsx), '缺口与「填完要再跑一次」都能被读到');
ok(/data-dv-view=/.test(cardTsx) && /没有分歧账/.test(cardTsx), '报告里没登记时明说，不留一片空白');
ok(/DIVERGENCE_SOURCES.filter/.test(cardTsx), 'F 类选项来自同一张表，不在组件里另写一份');
ok(/setDivergence\(\(prev\) =>/.test(appTs), '所有改动走函数式更新（连点两个下拉不互相覆盖）');
/*
 * 坐标四格比别处多一层坑：四格是四个下拉，各自交「整份 frame」时，
 * 那份 frame 仍是渲染时的快照——哪怕外层 setDivergence 已经是函数式，
 * 连着选四下也只会留下最后一格。真机跑道会同步连点四格，这里先把代码形态钉死。
 */
ok(/export type DivergencePatch = Omit<Partial<Divergence>, 'frame'>/.test(typesTs), '改动类型允许只交一格坐标');
ok(!/\.\.\.\(value\?\.frame \?\? EMPTY_FRAME\)/.test(cardTsx), '四个下拉不再按 props 快照展开整份坐标');
ok(
  (cardTsx.match(/onPick=\{\(v\) => onPatch\(\{ frame: \{ \w+: v \} \}\)\}/g) ?? []).length === 4,
  '四个下拉各只交改动的那一格'
);
ok(
  /frame: \{ \.\.\.\(prev\?\.frame \?\? \{\}\), \.\.\.\(p\.frame \?\? \{\}\) \}/.test(appTs),
  '状态层按 prev 合并坐标（连点四格都留得住）'
);
ok(/text === passage\.trim\(\) \? divergence : null/.test(appTs), '只有「跑的就是框里那段字」才带走分歧账');
ok(/setDivergence\(\(v\) => \(v \? null : v\)\)/.test(appTs), '原文一改，分歧账立即作废');
ok(/pending=\{divergencePending\(diag\?\.divergence, divergence\)\}/.test(appTs), '报告里那份与输入区这份比过才提醒');
ok(/id="sec-divergence"/.test(diagTsx) && /<DivergenceView value=\{d\.divergence\} \/>/.test(diagTsx), '报告里有只读栏，读的是同一份字段');
ok(/\{ id: 'sec-divergence', label: '分歧账' \}/.test(overviewTs), '首屏那条索引有这一格（每份报告都有，不按数据现算）');
ok(/默认收束：\$\{flow\.defaultClosure\}/.test(mdTs), '导出件也带默认收束那一列');
ok(/## 分歧与收束/.test(mdTs) && /divergenceLine\(d\.divergence\)/.test(mdTs), '导出件与界面调同一个纯函数，不另写一套');
ok(/divergenceCaveats\(g\)/.test(mdTs), '导出件把硬规矩一起带走（导出件最容易被单独转发）');
ok(/没有记录判定坐标与收束模式/.test(mdTs), '导出件没登记时照写一句，空白不被读成「没有分歧」');
ok(/ipcRenderer\.invoke\('analysis:run'[^\n]*brief, divergence\)/.test(preloadTs), 'preload 把分歧账传过去');
ok(/divergence\?: unknown/.test(mainTs) && /brief, divergence \}/.test(mainTs), '主进程收下它');
ok(/normalizeDivergence\(opts\.divergence\)/.test(analyzeTs) && /diagnosis\.divergence = divergence/.test(analyzeTs), '主进程用同一个收口函数贴上去');
ok(
  analyzeTs.indexOf('diagnosis.raw = {') < analyzeTs.indexOf('normalizeDivergence(opts.divergence)'),
  '贴在解析与裁决之后（不参与任何判定）'
);
ok(/withDivergence\(/.test(mockTsx) && /\?divergence=/.test(mockTsx), '预览页有入口：四种状态都拍得到');

/* 分歧账绝不进提示词：模型会顺着人填的收束模式说话，那就不是存档而是诱导。 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(resolve(process.cwd(), dir))) {
    const p = `${dir}/${name}`;
    if (statSync(resolve(process.cwd(), p)).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}
const promptFiles = walk('src/main/prompt');
const leaked = promptFiles.filter((p) => /divergence|Divergence|收束模式|判定坐标/.test(src(p)));
ok(leaked.length === 0, '提示词一个字没动：分歧账不进模型上下文', leaked.join(','));

/* ─────────── 收口 ─────────── */

if (failed.length) {
  console.error(`\n✗ v1.1 分歧内核：${failed.length} 条没过\n`);
  for (const f of failed) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`✓ v1.1 分歧内核：${passed} 条`);
