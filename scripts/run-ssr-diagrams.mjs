import { runTs } from './ts-runner.mjs';

/*
 * 透镜图与走向图的渲染断言。跑法：npm run check:lens
 *
 * 渲染用 react-dom/server 做 SSR，再用正则数图元。为什么不用无头浏览器：
 * file:// 下 ES module 会被 CORS 拦，而 --dump-dom 会去联网查更新，卡死 30 秒。
 */
const mod = await runTs({
  entry: 'scripts/ssr-diagrams.tsx',
  outName: 'ssr-diagrams.mjs',
});

/*
 * failed 必须声明在任何断言之前。
 *
 * 这里踩过一个坑：它原先声明在中间某段断言之后，而 let 有暂时性死区——
 * 排在它前面的断言一旦真的失败，`failed += 1` 抛的是 ReferenceError 而不是
 * 打印「失败」。脚本崩在半路，既不计失败也不退出非零，
 * 而平时那条分支走不到，看起来一直是绿的。失败分支不可达，就等于没有这条检查。
 */
let failed = 0;

/* 每张图的身份就是它的 aria-label——改了组件名这里会失败，这是故意的 */
const EXPECT = [
  { lens: 'walton', label: '型式族收窄路径', minRect: 4, minText: 8 },
  { lens: 'toulmin', label: '图尔敏六零件布局', minRect: 6, minText: 14 },
  { lens: 'ars', label: 'ARS 缺口位置', minRect: 3, minText: 8 },
  { lens: 'pta', label: 'PTA 三特征定位', minRect: 4, minText: 10 },
];

/*
 * 元问题闸门。示例的 walton 数据里没有 meta 检查项，所以端到端永远看不到那道「闸」——
 * 图尔敏 / ARS / PTA 三份里都有 meta:true，正好拿它们验这个分支。
 * 少了这一段，这个特性会一直「存在但从未被走过」。
 */
{
  const gates = ['toulmin', 'ars', 'pta']
    .map((k) => (mod.out?.[k] ?? '').match(/class="si-gate"/g)?.length ?? 0)
    .reduce((a, b) => a + b, 0);
  const pass = gates > 0;
  console.log(`${pass ? '通过' : '失败'}  元问题闸门：三份带 meta 的数据共渲染出 ${gates} 个「闸」标记`);
  if (!pass) failed += 1;
}

/* 走向图：挂在 App 层（不是 DiagnosisView 里），所以单独渲染单独验 */
const FLOW = { key: 'revflow', label: '修订走向', minPath: 3, minText: 8 };

/* 走向图 */
{
  const html = mod.out?.[FLOW.key] ?? '';
  const meta = JSON.parse(mod.out?.['revflow-meta'] ?? '{}');
  if (html.startsWith('ERROR')) {
    console.log(`失败  走向图：渲染抛错 ${html.slice(0, 160)}`);
    failed += 1;
  } else if (!html.includes(`aria-label="${FLOW.label}"`)) {
    // 图没画出来，多半是这份 diff 被判为不可比——那本身就是要报告的事实
    console.log(`失败  走向图：没画出来（comparable=${meta.comparable} trend=${meta.trend}）`);
    failed += 1;
  } else {
    const paths = (html.match(/<path/g) ?? []).length;
    const texts = (html.match(/<text/g) ?? []).length;
    const hasLegend = html.includes('class="legend"');
    const pass = paths >= FLOW.minPath && texts >= FLOW.minText && hasLegend;
    console.log(
      `${pass ? '通过' : '失败'}  走向图：连线 ${paths}（≥${FLOW.minPath}）· 文字 ${texts}（≥${FLOW.minText}）· 图例 ${hasLegend ? '有' : '无'}`
    );
    if (!pass) failed += 1;
  }
}

for (const c of EXPECT) {
  const html = mod.out?.[c.lens] ?? '';
  if (html.startsWith('ERROR')) {
    console.log(`失败  ${c.lens}：渲染抛错 ${html.slice(0, 160)}`);
    failed += 1;
    continue;
  }
  const i = html.indexOf(`aria-label="${c.label}"`);
  if (i < 0) {
    console.log(`失败  ${c.lens}：没有「${c.label}」这张图`);
    failed += 1;
    continue;
  }
  const start = html.lastIndexOf('<svg', i);
  const end = html.indexOf('</svg>', i);
  const svg = html.slice(start, end);
  const rects = (svg.match(/<rect/g) ?? []).length;
  const texts = (svg.match(/<text/g) ?? []).length;
  const hasLegend = html.slice(end, end + 3000).includes('class="legend"');
  const pass = rects >= c.minRect && texts >= c.minText && hasLegend;
  console.log(
    `${pass ? '通过' : '失败'}  ${c.lens}／${c.label}：方格 ${rects}（≥${c.minRect}）· 文字 ${texts}（≥${c.minText}）· 图例 ${hasLegend ? '有' : '无'}`
  );
  if (!pass) failed += 1;
}

console.log(failed ? `\n${failed} 张图有问题。` : '\n四张透镜图都渲染出来了，且都带图例。');
process.exit(failed ? 1 : 0);
