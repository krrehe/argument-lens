/**
 * 全屏论证地图的断言。
 *
 * 这一层最容易出的错不是崩，而是「图看起来挺像，其实搬错了字或画反了线」：
 * 节点文字多了一个前缀、支撑箭头指反、反驳打到一个不存在的编号、
 * 改法指向的位置根本不在报告里。这些错都不会报错，读者只会照着错的图去改。
 *
 * 所以这里守五件事：
 *   1. 节点与连线只从报告已有字段来，文字逐字相等；
 *   2. 方向不反，落点不存在时不画线并说出来；
 *   3. 版面确定、节点不重叠、都在画布内；
 *   4. 地图内核不出现本地判断词，不碰 renderer/main/electron；
 *   5. 界面与预览入口真的接上了。
 *
 * 跑法：npm run check:map
 */
import { existsSync, readFileSync } from 'node:fs';
import { buildMap, MAP_NOTE, type MapEdge, type MapNode } from '@shared/map';
import type { Diagnosis, RevisionPath } from '@shared/types';
import { checkItem, claim, diag, refutation } from './fixture-report';

let passed = 0;
const failed: string[] = [];

function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}

const read = (p: string): string => (existsSync(p) ? readFileSync(p, 'utf-8') : '');

/* ── 一 · 造一份六类节点齐全的报告 ── */

const p1 = { ...claim('P1', 'premise', '取消早读之后一本率降了 6 个点', 0), supports: ['M1'] };
const p2 = { ...claim('P2', 'premise', '同期没有别的教学安排变化', 20), supports: ['M1'] };
const m1 = { ...claim('M1', 'intermediate', '早读减少导致成绩下降', 40), supports: ['C'] };
const c = claim('C', 'conclusion', '应当恢复早读', 60);

const checks = [
  checkItem('CQ1', 'passed', '前提这一步', 'CQ1 前提成立'),
  checkItem('CQ2', 'violated', '因果这一步', 'CQ2 因果方向'),
];

const refs = [refutation('R1', 'P2', { claim: '同期还改了作息' }), refutation('R2', 'C', { claim: '成绩下降另有解释' })];

const revisions: RevisionPath[] = [
  {
    kind: '补前提',
    change: '补一条排除别的原因',
    keeps: '保住因果方向',
    cost: '要真的拿到对照数据',
    fixes: ['P2', 'CQ2'],
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
    change: '另找一组对照学校',
    keeps: '保住读者对象',
    cost: '要重新找材料',
    fixes: ['CQ1'],
    leaves: '解决不了标准问题',
  },
];

const full: Diagnosis = diag({
  premises: [p1, p2],
  intermediate: [m1],
  conclusion: c,
  checks,
  refutations: refs,
  revisions,
  defeat: {
    kind: 'undermining',
    checkId: 'CQ2',
    cuts: '切断 M1 与 C 之间的因果联结',
    explanation: '缺一环',
    tag: 'argued',
    confidence: 'medium',
  },
});

const map = buildMap(full);
const nodeOf = (m: ReturnType<typeof buildMap>, id: string): MapNode | undefined => m.nodes.find((n) => n.id === id);
const hasEdge = (m: ReturnType<typeof buildMap>, from: string, to: string, kind: MapEdge['kind']): boolean =>
  m.edges.some((e) => e.from === from && e.to === to && e.kind === kind);

/* ── 二 · 节点：六类都在、逐字来自报告 ── */

ok(map.nodes.length === 11, '六类节点齐全（结论 1、前提 2、中间结论 1、检查 2、反驳 2、改法 3）', String(map.nodes.length));
const kinds = new Set(map.nodes.map((n) => n.kind));
ok(
  kinds.size === 6 && ['conclusion', 'premise', 'intermediate', 'check', 'refutation', 'revision'].every((k) => kinds.has(k as MapNode['kind'])),
  '六种节点类型都画出来了',
  [...kinds].join(',')
);
ok(new Set(map.nodes.map((n) => n.id)).size === map.nodes.length, '节点编号不重复');
ok(nodeOf(map, 'C')?.text === c.text, '结论节点文字逐字来自报告的结论');
ok(nodeOf(map, 'P1')?.text === p1.text, '前提节点文字逐字来自报告的前提');
ok(nodeOf(map, 'M1')?.text === m1.text, '中间结论节点文字逐字来自报告的中间结论');
ok(nodeOf(map, 'CQ2')?.text === 'CQ2 因果方向', '检查节点文字用报告自己的显示名');
ok(nodeOf(map, 'R1')?.text === '同期还改了作息', '反驳节点文字逐字来自反驳的说法');
ok(nodeOf(map, 'V1')?.text === '补一条排除别的原因', '改法节点文字逐字来自改法本身');
ok(nodeOf(map, 'CQ2')?.status === 'violated', '检查节点带上报告给的答复，不另判');
ok(!map.nodes.some((n) => /^[（(【]|^(结论|前提|检查|反驳|改法)[:：]/.test(n.text)), '节点正文没有加本地前缀');

/* ── 三 · 版面：确定性、边界、不重叠 ── */

ok(JSON.stringify(buildMap(full)) === JSON.stringify(map), '同一份报告跑两次，结果逐字节相同');
ok(map.nodes.every((n) => n.x >= 0 && n.y >= 0 && n.x + n.w <= map.width && n.y + n.h <= map.height), '每个节点都在画布内');
ok(map.width > 0 && map.height > 0, '画布有实际尺寸');
const overlaps: string[] = [];
for (let i = 0; i < map.nodes.length; i += 1) {
  for (let j = i + 1; j < map.nodes.length; j += 1) {
    const a = map.nodes[i];
    const b = map.nodes[j];
    const cross = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    if (cross) overlaps.push(`${a.id}×${b.id}`);
  }
}
ok(overlaps.length === 0, '节点之间不重叠', overlaps.join('、'));

/* ── 四 · 连线：方向、类型、悬空落点 ── */

ok(hasEdge(map, 'P1', 'M1', 'support') && hasEdge(map, 'P2', 'M1', 'support') && hasEdge(map, 'M1', 'C', 'support'), '支撑线按 supports 的真实方向画');
ok(!hasEdge(map, 'M1', 'P1', 'support'), '支撑线没有画反');
ok(map.edges.filter((e) => e.kind === 'support').length === 3, '支撑线数量与报告写下的 supports 一致');
ok(hasEdge(map, 'R1', 'P2', 'attack') && hasEdge(map, 'R2', 'C', 'attack'), '反驳打向它自己写的目标');
ok(hasEdge(map, 'CQ2', 'C', 'attack'), '报告说击败落在这条检查上时，画「检查 → 结论」');
ok(!hasEdge(map, 'CQ1', 'C', 'attack'), '没被判为击败落点的检查不画攻击线');
ok(hasEdge(map, 'V1', 'P2', 'repair') && hasEdge(map, 'V1', 'CQ2', 'repair'), '改法修哪几处就画到哪几处');
ok(hasEdge(map, 'V2', 'C', 'repair') && hasEdge(map, 'V3', 'CQ1', 'repair'), '三种改法的落点各自有线');
const ids = new Set(map.nodes.map((n) => n.id));
ok(map.edges.every((e) => ids.has(e.from) && ids.has(e.to)), '没有一条线指向不存在的节点');
ok(map.problems.length === 0, '完整报告的落点全都能挂上', map.problems.join('；'));

{
  const bad = buildMap(
    diag({
      premises: [p1],
      conclusion: c,
      checks,
      refutations: [refutation('R9', 'P9', { claim: '打空处' })],
      revisions: null,
    })
  );
  ok(!bad.edges.some((e) => e.from === 'R9'), '反驳指向不存在的编号时不画线');
  ok(bad.problems.some((p) => p.includes('R9') && p.includes('P9')), '画不出来的线要点名来源与缺失目标', bad.problems.join('；'));
}

{
  const bad = buildMap(
    diag({
      premises: [p1],
      conclusion: c,
      checks: [],
      revisions: [{ ...revisions[1], fixes: ['P9'] }],
    })
  );
  ok(!bad.edges.some((e) => e.kind === 'repair'), '改法指向不存在的编号时不画线');
  ok(bad.problems.some((p) => p.includes('P9')), '改法的悬空落点也要留痕', bad.problems.join('；'));
}

{
  const bad = buildMap(
    diag({
      premises: [p1],
      conclusion: c,
      checks: [],
      defeat: { kind: 'undermining', checkId: 'CQ9', cuts: '', explanation: '', tag: 'argued', confidence: 'medium' },
    })
  );
  ok(!bad.edges.some((e) => e.kind === 'attack'), '击败落点不存在时不画攻击线');
  ok(bad.problems.some((p) => p.includes('CQ9')), '击败落点悬空要留痕', bad.problems.join('；'));
}

/* ── 五 · 空报告也能出图，不补假节点 ── */

{
  const bare = buildMap(
    diag({
      premises: [],
      intermediate: [],
      checks: [],
      refutations: [],
      revisions: null,
      defeat: { kind: 'none', checkId: null, cuts: '', explanation: '', tag: 'argued', confidence: 'medium' },
    })
  );
  ok(bare.nodes.length === 1 && bare.nodes[0].id === 'C', '只有结论时也只画结论一个节点');
  ok(bare.edges.length === 0, '没有可画的线时不硬造一条');
  ok(bare.problems.length === 0, '空报告不产生「挂不上」的噪声');
}

/* ── 六 · 内核边界：不写判断、不碰宿主 ── */

const mapSrc = read('src/shared/map.ts');
ok(mapSrc.length > 0, '地图内核住在 src/shared/map.ts');
ok(!/from\s+['"](electron|node:|.*\/main\/|.*\/renderer\/)/.test(mapSrc), '地图内核不 import electron / node: / main / renderer');
const banned = ['建议', '得分', '总分', '最弱', '最强', '站得住', '严重', '评分'];
ok(!banned.some((w) => mapSrc.includes(w)), '内核里没有本地判断词', banned.filter((w) => mapSrc.includes(w)).join('、'));
ok(MAP_NOTE.includes('只读') && MAP_NOTE.includes('逐字'), '共用说明写明「只读」与「逐字来自报告」');
ok(!/推荐|应该改|必须改/.test(MAP_NOTE), '共用说明不劝人、不替模型给方案');

/* ── 七 · 界面与入口真的接上了 ── */

const diagnosis = read('src/renderer/src/components/Diagnosis.tsx');
const mapView = read('src/renderer/src/components/ArgumentMap.tsx');
const css = read('src/renderer/src/styles-map.css');
const mainTsx = read('src/renderer/src/main.tsx');
const mockTsx = read('src/renderer/src/mock.tsx');

ok(diagnosis.includes("from './ArgumentMap'"), '报告页导入了地图组件');
ok(diagnosis.includes('ReportSurfaceSwitch') && diagnosis.includes('ArgumentMapView'), '报告页挂上了开关与地图');
ok(diagnosis.includes('initialMap'), '预览页可以指定开在地图');
ok(diagnosis.includes("surface === 'map'") || diagnosis.includes('surface === "map"'), '地图是文字之外的另一条渲染分支');

ok(mapView.includes('data-arg-map'), '地图有整块探针');
ok(mapView.includes('data-map-node'), '节点有可数的探针');
ok(mapView.includes('data-map-detail'), '右侧详情有探针');
ok(mapView.includes('data-map-zoom-in') && mapView.includes('data-map-zoom-out') && mapView.includes('data-map-zoom-fit'), '三颗缩放控制键都在');
ok(mapView.includes('onWheel') && mapView.includes('onPointerDown'), '滚轮缩放与拖拽接线都在');
ok(mapView.includes('Legend'), '地图带图例');
ok(mapView.includes('MAP_NOTE'), '地图页脚用共用说明');
ok(mapView.includes('data-map-problems'), '挂不上的落点有地方显示');
ok(mapView.includes('data-map-focus'), '选中节点后可以切换「只看相连」');
ok(mapView.includes('data-map-dim'), '无关节点与连线有可探针的淡化标记');
ok(mapView.includes('related'), '淡化范围按与选中节点直接相连算，不推断更远的关系');
ok(mapView.includes('EDGE_LABEL') && mapView.includes('<title>'), '连线悬停能读出类型与两端');
ok(mapView.includes('data-map-count') && mapView.includes('支撑 {edgeCounts.support}'), '顶部计数按三类线分开写');
ok(mapView.includes("claim.role !== 'conclusion'"), '结论详情不显示「它支撑谁」这一行');
ok(mapView.includes('onDoubleClick'), '双击空白回到全图');
ok(mapView.includes('tagName'), '点空白处可以关掉详情');
ok(/\.mp-bar\s*\{[^}]*flex-wrap:\s*wrap/.test(css), '顶部条在窄窗可以换行');

ok(css.includes('.mp-wrap') && css.includes('.mp-side'), '地图容器与详情面板都有样式');
ok(!/#[0-9a-fA-F]{6}/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), '地图样式不带字面色值，颜色只能来自 :root');
ok(mainTsx.includes("styles-map.css"), '真实入口引入了地图样式');
ok(mockTsx.includes("styles-map.css"), '预览入口也引入了地图样式');
ok(mockTsx.includes("QS.get('map') === '1'"), '预览页认 ?map=1');

const pkg = read('package.json');
ok(pkg.includes('"check:map"'), 'package.json 里有 check:map');

/* ── 八 · 断言总数兜底 ── */

ok(passed >= 40, '断言总数不少于 40 项', `实际 ${passed}`);

if (failed.length) {
  console.error(`\n✗ 论证地图检查失败 ${failed.length} 项（通过 ${passed} 项）`);
  for (const f of failed) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ 论证地图：${passed} 条全部通过｜逐字搬运、方向不反、悬空留痕、版面确定、聚焦与收放接线`);
