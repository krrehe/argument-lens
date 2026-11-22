/**
 * 首屏那一层：全文总结与论证逻辑链。
 *
 * 这一关守的不是「有没有这几行字」，是六种**坏了也照样渲染得出来**的读法：
 *
 *   1. 树不按 supports 长——按字数、按重要性、按报告里的顺序排，看起来也是棵树，
 *      但读者顺着它读到的「谁撑谁」是假的；
 *   2. 多父只挂第一处却不作声——那条理由明明还撑着别处，界面却像只撑这一处；
 *   3. 接不回结论的主张被静默丢掉——结构图于是看起来比实际完整；
 *   4. 成环或超深时无限往下长（或整棵树消失）；
 *   5. 断点挂在结论身上——「结论 C［未答］」读起来像「结论没人答」，
 *      而实际意思是某一关没答、某一步断了；
 *   6. 总结里写死数字（「3 条依据」「2 层」），样本一换就对不上。
 *
 * 全部用**造出来的报告**验，不查源码里有没有某个词。上一轮这里查的是
 * `/orphans: DigestNode\[\]/` 与 /接不回结论/ 的源码匹配——而「接不回结论」
 * 这几个字在提示语里也有，把孤儿身上的标记删掉，检查照绿。行为断言不会这样。
 *
 * 跑法：npm run check:digest
 */
import type { Claim, Diagnosis } from '@shared/types';
import { digestOf } from '@shared/digest';
import type { DigestNode } from '@shared/digest';
import { claim, checkItem, diag, refutation } from './fixture-report';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}

/** 只是给 claim 补 supports；工厂的默认值是空数组。 */
const withSupports = (c: Claim, supports: string[]): Claim => ({ ...c, supports });

const P = (id: string, supports: string[]) => withSupports(claim(id, 'premise', `${id} 的说法`), supports);
const M = (id: string, supports: string[]) => withSupports(claim(id, 'intermediate', `${id} 的说法`), supports);

function walk(n: DigestNode, out: DigestNode[] = []): DigestNode[] {
  out.push(n);
  for (const c of n.children) walk(c, out);
  return out;
}

/* ─────────── 一 · 三层链：中间结论真的占一层，直接理由在第二层 ─────────── */

const cA = claim('C', 'conclusion', '取消早读是错的');
const mA = M('M1', ['C']);
const pA1 = P('P1', ['M1']);
const pA2 = P('P2', ['C']);
/* P3 同时支撑结论与中间结论：树里只挂第一处（C），但要标出来。 */
const pA3 = P('P3', ['C', 'M1']);

const gA = digestOf(diag({ conclusion: cA, premises: [pA1, pA2, pA3], intermediate: [mA] }));
const nodesA = walk(gA.conclusion);

ok(
  gA.conclusion.children.map((n) => n.id).join(',') === 'P2,P3,M1',
  '直接支撑结论的三条都在第一层（顺序按报告里的叙述，不按重要性重排）',
  gA.conclusion.children.map((n) => n.id).join(','),
);
ok(
  gA.conclusion.children.find((n) => n.id === 'M1')?.children[0]?.id === 'P1',
  'P1 支撑的是 M1，所以它挂在 M1 下面，不是直接挂在结论上',
);
ok(
  nodesA.find((n) => n.id === 'P1')?.depth === 2 && nodesA.find((n) => n.id === 'M1')?.depth === 1,
  '深度按 supports 的步数算：结论 0、中间结论 1、它的支撑 2',
);
ok(
  nodesA.find((n) => n.id === 'P3')?.marks.includes('另支撑 1 处') === true,
  '一条理由同时支撑两处时，节点上标出「另支撑 1 处」（不标就是默认它只撑这一处）',
);
ok(
  nodesA.filter((n) => n.id === 'P3').length === 1,
  '多父的那条在树里只出现一次（同一节点挂两处会让层级数虚高）',
);

/* ─────────── 二 · 成环与超深：不能吞掉，也不能无限长 ─────────── */

/* X ↔ Y 成环，谁都走不到结论；它们必须出现在「接不回结论」里。 */
const gB = digestOf(
  diag({
    conclusion: claim('C', 'conclusion', '取消早读是错的'),
    premises: [P('X', ['Y']), P('Y', ['X']), P('P1', ['C'])],
  }),
);
const idsB = walk(gB.conclusion).map((n) => n.id);
ok(
  gB.orphans.map((n) => n.id).sort().join(',') === 'X,Y',
  '成环的主张进「接不回结论」，不进树（循环边不能让 BFS 卡住或丢节点）',
  gB.orphans.map((n) => n.id).join(','),
);
ok(
  !idsB.includes('X') && !idsB.includes('Y'),
  '接不回结论的不混进树里（混进去就等于给它编了一个位置）',
);
ok(
  gB.orphans.every((n) => n.marks.includes('接不回结论')),
  '每一条孤儿都带「接不回结论」标记，不是只给一个总数',
);
ok(
  gB.counts.orphan === gB.orphans.length && gB.counts.total === 3,
  '孤儿计数与列表同源（两个各算一遍，迟早对不上）',
  `${gB.counts.orphan}/${gB.orphans.length} total=${gB.counts.total}`,
);

/* 一条 8 层深的链：第 7 层往下必须停下，被截掉的进孤儿而不是消失。 */
let deep: Claim = P('L1', ['C']);
const layers: Claim[] = [deep];
for (let i = 2; i <= 8; i += 1) {
  deep = P(`L${i}`, [`L${i - 1}`]);
  layers.push(deep);
}
const gC = digestOf(diag({ conclusion: claim('C', 'conclusion', '取消早读是错的'), premises: layers }));
const nodesC = walk(gC.conclusion);
ok(
  Math.max(...nodesC.map((n) => n.depth)) === 6,
  '深度封顶在 6：再深的不往树里堆（不封顶时成环也能一路长下去）',
  `max=${Math.max(...nodesC.map((n) => n.depth))}`,
);
ok(
  gC.orphans.length === 2 && gC.orphans.every((n) => n.marks.includes('接不回结论')),
  '被深度截掉的两条进孤儿，带标记（截掉就丢，等于报告少了两条依据）',
  `orphans=${gC.orphans.length}`,
);

/* ─────────── 三 · 断点：单独一行，不挂在结论身上 ─────────── */

const gD = digestOf(
  diag({
    conclusion: claim('C', 'conclusion', '取消早读是错的'),
    premises: [P('P1', ['C'])],
    checks: [checkItem('CQ2', 'unanswered', 'P1 → C 的因果一步', 'CQ2 因果方向与「不只是同时发生」')],
    defeat: {
      kind: 'undermining',
      checkId: 'CQ2',
      cuts: 'P1 → C 之间的因果这一步',
      explanation: '缺一环',
      tag: 'argued',
      confidence: 'medium',
    },
  }),
);
ok(gD.breakLine?.cuts === 'P1 → C 之间的因果这一步', '断点那一行取的是报告里的 defeat.cuts（切断的是哪一步）', JSON.stringify(gD.breakLine));
ok(gD.breakLine?.check === 'CQ2 未答', '断点行同时写清是哪一关、什么结果', String(gD.breakLine?.check));
ok(
  walk(gD.conclusion).every((n) => !n.marks.includes('断点') && !n.marks.includes('未答')),
  '断点不挂在任何节点上（挂在结论上读起来是「结论没人答」）',
);
ok(
  !/「[^「」]*「/.test(gD.gist[4].text),
  '引用里套引用时降级成 “ ”（「CQ2 …「不只是同时发生」」这种嵌套会被读成两层引文）',
  gD.gist[4].text,
);

/* 报告常把这一句写成「切断了 …」；界面已经写着「断在这一步」，照抄会连读成「断在…切断…」。 */
const gD2 = digestOf(
  diag({
    conclusion: claim('C', 'conclusion', '取消早读是错的'),
    premises: [P('P1', ['C'])],
    checks: [checkItem('CQ2', 'violated', 'P1 → C 的因果一步', 'CQ2 因果方向')],
    defeat: {
      kind: 'undermining',
      checkId: 'CQ2',
      cuts: '切断了 P1 与 C 之间的因果联结',
      explanation: '缺一环',
      tag: 'argued',
      confidence: 'medium',
    },
  }),
);
ok(
  gD2.breakLine?.cuts === 'P1 与 C 之间的因果联结',
  '句首那个「切断了」被摘掉（否则读成「断在这一步：切断了…」）',
  String(gD2.breakLine?.cuts),
);

/* 没有断点时不许编一个。 */
const gE = digestOf(
  diag({
    conclusion: claim('C', 'conclusion', '取消早读是错的'),
    premises: [P('P1', ['C'])],
    defeat: { kind: 'none', checkId: null, cuts: '', explanation: '', tag: 'argued', confidence: 'medium' },
  }),
);
ok(gE.breakLine === null, '报告说没断，就不出现断点那一行（编一句「某处可能有问题」比留白更坏）');

/* ─────────── 四 · 总结里的数字都从字段来，不写死 ─────────── */

const find = (g: typeof gA, key: string) => g.gist.find((x) => x.key === key)?.text ?? '';

ok(
  find(gA, '要你信什么').includes('3 条依据') && find(gA, '要你信什么').includes('1 条中间结论'),
  '「要你信什么」的依据条数取自 premises / intermediate',
  find(gA, '要你信什么'),
);
ok(
  find(gA, '怎么推的').includes('分 2 层') && find(gA, '怎么推的').includes('中间过了中间结论'),
  '「怎么推的」说推法的形状（几层、有没有中转），不说「报告拆出几个节点」',
  find(gA, '怎么推的'),
);
ok(
  find(gA, '怎么推的').includes('接不回结论') === false,
  '没有孤儿时不说「另有 0 条接不回结论」',
  find(gA, '怎么推的'),
);
ok(
  find(gB, '怎么推的').includes('另有 2 条接不回结论'),
  '有孤儿时，总结里明说数量并指到下面的列表',
  find(gB, '怎么推的'),
);

const pImplicit = { ...P('P1', ['C']), implicit: true, implicitBasis: '若不假定 X，则推不出' };
const gF = digestOf(diag({ conclusion: claim('C', 'conclusion', '取消早读是错的'), premises: [pImplicit] }));
ok(find(gF, '怎么推的').includes('1 条是隐含的'), '隐含前提的条数取自 implicit 字段（隐含前提不读出来，读者会以为原文写了）', find(gF, '怎么推的'));
ok(
  find(gF, '要你信什么').includes('1 条依据'),
  '依据只有一条时就说一条（数字写死的话，换个样本就对不上）',
  find(gF, '要你信什么'),
);

/* 空依据：不许崩，也不许编。 */
const gG = digestOf(diag({ conclusion: claim('C', 'conclusion', '取消早读是错的'), premises: [], intermediate: [] }));
ok(
  find(gG, '要你信什么').includes('没从这段话里拆出依据') && find(gG, '怎么推的').includes('无从展开'),
  '一条依据都没有时，两行都直说没有，不拿「论证充分」之类的空话填',
  `${find(gG, '要你信什么')} / ${find(gG, '怎么推的')}`,
);

/* ─────────── 五 · 推到哪：三种出口各说各的，不含糊 ─────────── */

ok(find(gA, '推到哪').includes('被削弱'), '给了档位就说档位', find(gA, '推到哪'));

const gH = digestOf(
  diag({
    conclusion: claim('C', 'conclusion', '取消早读是错的'),
    premises: [P('P1', ['C'])],
    scope: { applicable: false, reason: '这段是广告，说话人不以解决分歧为目标', outOfScopeAt: null, partialNote: null },
  }),
);
ok(
  find(gH, '推到哪').includes('不适用') && find(gH, '推到哪').includes('所以不判档位'),
  '范围门判不适用时，明说不判档位（照量出来的刻度是假的）',
  find(gH, '推到哪'),
);
ok(!find(gH, '推到哪').includes('判到'), '不适用时不能同时出现「判到某档」');

const gI = digestOf(diag({ mode: 'fallacy', conclusion: claim('C', 'conclusion', '取消早读是错的'), premises: [P('P1', ['C'])] }));
ok(find(gI, '推到哪').includes('不给档位'), '查谬误这类模式不给档位，总结里说清这是模式定义而不是「没判出来」', find(gI, '推到哪'));

/* ─────────── 六 · 承重标记来自 pivot，不在这里另判 ─────────── */

const gJ = digestOf(
  diag({
    conclusion: claim('C', 'conclusion', '取消早读是错的'),
    premises: [P('P1', ['C'])],
    refutations: [refutation('R1', 'P1')],
  }),
);
ok(
  walk(gJ.conclusion).find((n) => n.id === 'P1')?.marks.includes('承重') === true,
  '承重标在那条真的垫着结论的主张上（标记复用 pivotOf 的结论，不另判一次）',
  JSON.stringify(walk(gJ.conclusion).find((n) => n.id === 'P1')?.marks),
);

/* ─────────── 七 · 颗粒度是数据，深度是显示 ─────────── */

ok(
  gA.levels.length === 3 && gA.levels.map((l) => l.n).join('') === '123',
  '三档颗粒度（骨架／展开／取证）是数据里的 levels，界面照它渲染按钮',
);
ok(
  gA.levels.every((l) => l.label && l.hint),
  '每档都有一句「这一档给你看什么」（只有名字，读者不知道差在哪）',
);
ok(
  gA.levels[0].label === '骨架' && gA.levels[2].label === '取证',
  '档名固定：骨架 → 展开 → 取证（顺序换了，读者会以为第一档最细）',
);

/* ─────────── 八 · 只压缩，不动报告 ─────────── */

const before = JSON.stringify(diag({ conclusion: cA, premises: [pA1, pA2, pA3], intermediate: [mA] }));
const fresh = diag({ conclusion: cA, premises: [pA1, pA2, pA3], intermediate: [mA] });
const gK = digestOf(fresh);
ok(JSON.stringify(fresh) === before, '摘要不改报告本身（只读一遍字段，不写回、不补齐、不排序）');
ok(gK.conclusion.text === cA.text, '结论原文逐字照搬，不改写');

ok(
  gA.counts.premises === 3 && gA.counts.intermediate === 1 && gA.counts.total === 4,
  '计数来自数组长度，不另算一遍',
  JSON.stringify(gA.counts),
);

/* ─────────── 收口 ─────────── */

if (failed.length) {
  for (const f of failed) console.error(`✗ ${f}`);
  console.error(`\n✗ 总结与逻辑链 ${failed.length} 条没过（共 ${passed + failed.length} 条）`);
  process.exit(1);
}
console.log(`✓ 总结与逻辑链：${passed} 条全部通过｜树按 supports 长、多父作声、孤儿不吞、断点不挂结论、数字不写死、只压缩不改报告`);
