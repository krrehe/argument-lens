/**
 * 回看台「界面规则」检查（进 verify）。
 *
 * 依据是一份 UI 检查清单（《Refactoring UI》读书笔记）里能被机器量的那几条：
 *   1. 普通文字对比度 ≥ 4.5:1（WCAG AA），两套主题、所有实际底色组合；
 *   2. 字号阶梯不超过四档、最小不小于 10px——靠字重与颜色分层级，不靠字号；
 *   3. 圆角只有控制件 3px 与大块 6px 两档（圆点的 1px 是形状，不算）；
 *   4. 状态不能只靠颜色：圆点用形状区分，并且把形状的含义写在界面上；
 *   5. 一块区域只有一个实心主按钮；
 *   6. 密集列表用隔行底色而不是每行拉线；
 *   7. 空状态要有标题与一个真能点的动作；
 *   8. 正文行宽有上限，说明条不再是一整段长文；
 *   9. 主窗口调色板自身逐对过对比度（底 × 前景的笛卡尔积），实心底上的白字另算；
 *  10. 主窗口样式表里不许出现 :root 之外的色值——颜色只能来自变量；
 *  11. 区段标题单独一档 17px，与正文分得开；
 *  12. 次按钮全站只有一种皮（浅灰底、无描边）。
 *
 * 边界（必须说清，否则会被当成它管不了的保证）：
 *  - 它读的是源码里的 CSS 文本与模板字符串，不是浏览器里的实际渲染。
 *    真正挤压、错位、字被裁，只有 CDP 量或人眼看图才发现得了。
 *  - 对比度按十六进制字面值算，算不到 rgba、渐变、图片背景上的文字。
 *  - 「实心主按钮只有一个」只按类名与背景色判断，判断不了人眼觉得哪个更显眼。
 *  - 字号与圆角两条同时罩 React 主窗口的样式表（src/renderer/src/*.css）：
 *    此前只读 workbench.html，于是那一侧积了 20 种字号、13 种圆角，规则一条没管——
 *    只罩住一半界面的规则，会让人以为另一半也是干净的。
 *
 * 跑法：npm run check:ui-rules
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readdirSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const html = readFileSync(path.join(ROOT, 'src/renderer/public/workbench.html'), 'utf8');

let n = 0;
const bad = [];
const ck = (ok, msg) => { n += 1; if (!ok) bad.push(msg); };

/* ── 取样式规则 ─────────────────────────────────────────────── */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rule = (sel) => {
  const m = html.match(new RegExp(`(?:^|[}\\n])\\s*${esc(sel)}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
};
const need = (sel, why) => {
  const r = rule(sel);
  ck(r !== null, `样式表里找不到 ${sel} 这条规则（${why}）`);
  return r ?? '';
};

/* ── 1. 对比度 ─────────────────────────────────────────────── */
const palette = (blockRe) => {
  const m = html.match(blockRe);
  const out = {};
  if (m) for (const x of m[1].matchAll(/--([a-z0-9]+)\s*:\s*(#[0-9A-Fa-f]{6})/g)) out[x[1]] = x[2];
  return out;
};
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const THEMES = [
  ['深色', /:root,\[data-theme="dark"\]\{([\s\S]*?)\}/],
  ['浅色', /\[data-theme="light"\]\{([\s\S]*?)\}/],
];
const FG = ['text', 'text2', 'muted', 'accent', 'warn', 'ok', 'danger'];
const BG = ['bg', 'panel', 'panel2', 'panel3', 'sel', 'accentbg', 'warnbg', 'okbg'];

for (const [name, re] of THEMES) {
  const p = palette(re);
  const missFg = FG.filter((k) => !p[k]);
  const missBg = BG.filter((k) => !p[k]);
  ck(missFg.length === 0, `${name}主题缺前景色 ${missFg.join('、')}，对比度没法算`);
  ck(missBg.length === 0, `${name}主题缺底色 ${missBg.join('、')}，对比度没法算`);
  if (missFg.length || missBg.length) continue;

  const fails = [];
  for (const f of FG) {
    for (const b of BG) {
      const r = ratio(p[f], p[b]);
      if (r < 4.5) fails.push(`${f} 落在 ${b} 上只有 ${r.toFixed(2)}:1`);
    }
  }
  ck(
    fails.length === 0,
    `${name}主题有 ${fails.length} 组文字低于 4.5:1（WCAG AA）：${fails.slice(0, 3).join('；')}`,
  );
}

/* ── React 主窗口的样式表也纳入这两条 ───────────────────────── */
const reactDir = path.join(ROOT, 'src/renderer/src');
const reactCss = readdirSync(reactDir)
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(path.join(reactDir, f), 'utf8'))
  .join('\n');
const both = html + '\n' + reactCss;
/*
 * 这一条是防「规则只罩一半」的回退。读不到 React 的样式表时，下面的字号与圆角
 * 只会在 html 上通过——那正是这套界面曾经的状态：html 那边干干净净，
 * React 那边 20 种字号、13 种圆角，一条规则都没管。
 */
ck(reactCss.length > 20000, `React 主窗口的样式表没读进来（只读到 ${reactCss.length} 字符）：字号与圆角会漏掉整个主界面`);

/* ── 1b. 图表调色板与 :root 对表 ────────────────────────────── */
/*
 * SVG 的 fill= / stroke= 不认 var()，Diagram.tsx 里那张 C 表是 :root 的手抄影子。
 * 手抄的东西必走样：主界面换成了苹果色板，这张表还留着旧的土黄与墨绿，
 * 结构图上每一条线都是另一个时代的样子，而没有任何检查会红。
 * 这里逐项对表，并额外要求「C 的每个键都在映射里」——
 * 漏映射等于漏检查，那种情况下表里加一项新颜色不会有人发现。
 */
const VAR_OF = {
  ink: 'ink', ink2: 'ink-2', ink3: 'ink-3', line: 'line', lineStrong: 'line-strong',
  edge: 'edge', accent: 'accent', accentBg: 'accent-bg', strong: 'strong',
  strongBg: 'strong-bg', weak: 'weak', weakBg: 'weak-bg', invalid: 'invalid',
  invalidBg: 'invalid-bg', panel: 'panel', panel2: 'panel-2',
};
const stylesCss = readFileSync(path.join(ROOT, 'src/renderer/src/styles.css'), 'utf8');
const rootVars = Object.fromEntries(
  [...(stylesCss.match(/:root \{([\s\S]*?)\}/) ?? ['', ''])[1].matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{6})/g)]
    .map((m) => [m[1], m[2].toLowerCase()]),
);
const diagramTsx = readFileSync(path.join(ROOT, 'src/renderer/src/components/Diagram.tsx'), 'utf8');
const cTable = (diagramTsx.match(/export const C = \{([\s\S]*?)\};/) ?? ['', ''])[1];
const cEntries = [...cTable.matchAll(/(\w+):\s*'(#[0-9a-fA-F]{6})'/g)].map((m) => [m[1], m[2].toLowerCase()]);
ck(cEntries.length >= 14, `图表调色板只读到 ${cEntries.length} 项，对表失去意义`);
const unmapped = cEntries.map(([k]) => k).filter((k) => !VAR_OF[k]);
ck(unmapped.length === 0, `图表调色板里有 ${unmapped.join('、')} 没有对应变量，等于没被检查`);
for (const [k, v] of cEntries) {
  const varName = VAR_OF[k];
  if (!varName) continue;
  ck(rootVars[varName] === v, `图表调色板 C.${k} 是 ${v}，:root 的 --${varName} 是 ${rootVars[varName] ?? '（缺）'}——两处对不上`);
}

/* ── 1c. 主窗口调色板的对比度 ─────────────────────────────── */
/*
 * 上一轮换色板时算过一遍 56 组，但那是一次性的脚本，没留下。没留下的验算
 * 等于没有：下一次改一个色值，没有人会重跑它。
 *
 * 这里接进 verify：底 × 前景的笛卡尔积，逐对 ≥ 4.5:1。之所以用笛卡尔积
 * 而不是「实际出现过的组合」，是因为实际组合随时会变（同一个 --ink-3
 * 今天在白卡上，明天就可能被挪到浅灰条上），而漏掉的那一对不会有任何提示。
 */
const RFG = ['ink', 'ink-2', 'ink-3', 'strong', 'weak', 'invalid', 'legal', 'accent'];
const RBG = ['bg', 'panel', 'panel-2', 'muted-bg', 'muted-bg-2', 'strong-bg', 'weak-bg', 'invalid-bg', 'legal-bg', 'accent-bg'];
const missingVars = [...RFG, ...RBG, 'on-solid'].filter((k) => !rootVars[k]);
ck(missingVars.length === 0, `styles.css 的 :root 缺 ${missingVars.join('、')}，主窗口的对比度没法算`);
if (missingVars.length === 0) {
  const fails = [];
  for (const f of RFG) {
    for (const b of RBG) {
      const r = ratio(rootVars[f], rootVars[b]);
      if (r < 4.5) fails.push(`--${f} 落在 --${b} 上只有 ${r.toFixed(2)}:1`);
    }
  }
  ck(fails.length === 0, `主窗口有 ${fails.length} 组文字低于 4.5:1：${fails.slice(0, 3).join('；')}`);

  /* 实心底上的白字：主按钮、状态点、深色块。它们不在上面的笛卡尔积里，
     因为 --on-solid 不是「一种底色」，是「实心上的字」。 */
  const solids = ['accent', 'accent-press', 'strong', 'weak', 'invalid', 'legal', 'ink', 'ink-3'];
  const onFails = solids.filter((k) => ratio(rootVars['on-solid'], rootVars[k]) < 4.5);
  ck(onFails.length === 0, `--on-solid 落在 ${onFails.join('、')} 上低于 4.5:1`);
}

/*
 * 从样式表里取一条规则体。不用正则拼选择器：选择器里有 . { } 这些字符，
 * 一层层转义之后写出来的东西，比它要解决的问题更难读。
 */
const cssRule = (src, sel) => {
  const at = src.indexOf(sel + ' {');
  if (at < 0) return '';
  const end = src.indexOf('}', at);
  return end < 0 ? '' : src.slice(at + sel.length + 2, end);
};
/* ── 1d. 调色板外不许有 hex ───────────────────────────────── */
/*
 * 上一轮按十六进制字面值批量换色，漏掉的那批不会红：它们不在 :root 里，
 * 所以不进对比度验算；不在图表 C 表里，所以不进对表。于是 22 个旧世代的
 * 蓝灰与土黄留在九个样式表里，每次渲染都在用——边框比别处淡一点、标签底
 * 比别处暖一点。说不出哪里不对，但整屏就是「不齐」。
 *
 * 这条把后门关上：主窗口的样式表里，颜色只能来自变量。白也是颜色，
 * 所以它有名字（--on-solid）。注释不算——注释里的色值是对历史的记录。
 */
const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const reactBare = stripCssComments(reactCss).replace(/:root\s*\{[^}]*\}/g, '');
const strayHex = [...reactBare.matchAll(/#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])/g)].map((m) => m[0]);
ck(
  strayHex.length === 0,
  `主窗口样式表里有 ${strayHex.length} 处调色板外的色值（${[...new Set(strayHex)].slice(0, 4).join('、')}）：颜色只能来自 :root 的变量`,
);

/* ── 1e. 区段标题单独一档 ─────────────────────────────────── */
/*
 * 报告里二十来个区段原来与正文同为 13px，只差一个字重。字重已经用到 600，
 * 再往上就是黑体；层级只剩字号这一条路。17px 是苹果阶梯里的 title3——
 * 这一档不是新增的花样，是把 11/12/13/15/17/22 里缺的那一格补回来。
 */
const blockTitleRule = cssRule(reactCss, '.block-head .t');
ck(blockTitleRule.length > 0, '找不到 .block-head .t 这条规则，区段标题的字号无从核对');
ck(/font-size:\s*17px/.test(blockTitleRule), '区段标题不是 17px：与正文同号时，报告会读成一片，找不到「这一栏从哪开始」');

/* ── 1f. 次按钮只有一种皮 ─────────────────────────────────── */
/*
 * 导出、重读入口、浅灰按钮是同一类东西：都排在内容前面，都不是主按钮。
 * 原来它们各写一套（白底描边 / 浅底描边 / 浅灰无描边），一屏里七个按钮
 * 三种长相，读者会以为权重不同。这条规则要求它们共用一套皮：
 * 浅灰底、无描边——描边是这一页里最容易被滥用的分隔手段。
 */
for (const sel of ['.ghost-btn', '.exp-btn', '.rr-open']) {
  const r = cssRule(reactCss, sel);
  ck(r.length > 0, `找不到次按钮 ${sel} 的规则`);
  if (!r) continue;
  ck(/background:\s*var\(--muted-bg\)/.test(r), `${sel} 不是浅灰底：次按钮全站只用一种皮`);
  ck(!/border:\s*1px solid/.test(r), `${sel} 又描边了：一屏七个描边小方框就是这样攒出来的`);
}

/* ── 2. 字号阶梯 ───────────────────────────────────────────── */
/*
 * 七档：10（等宽元数据）/ 11（辅助）/ 12（次级正文）/ 13（正文）/ 15（卡标题）
 *      / 17（区段标题）/ 22（页标题）。
 * 原来写的是四档 10/11/12/22，装不下 13 与 11 的区分，于是源码里长出
 * 10.5 / 11.5 / 12.5 / 13.5 这些半像素台阶——四个档位守不住，就会变成二十个。
 * 17 是后来补的：先说「去掉 17 也够」，直到区段标题与正文同为 13px、
 * 整份报告读成一片，才发现缺的不是四个半像素台阶，是这一格。
 */
const sizes = [...new Set([...both.matchAll(/font-size:\s*([0-9.]+)px/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
const ALLOWED_SIZE = [10, 11, 12, 13, 15, 17, 22];
const extraSize = sizes.filter((s) => !ALLOWED_SIZE.includes(s));
ck(extraSize.length === 0, `字号多出 ${extraSize.join('、')}px：只留 ${ALLOWED_SIZE.join(' / ')} 六档（层级靠字重与颜色，不靠字号）`);
ck(Math.min(...sizes) >= 10, `最小的字是 ${Math.min(...sizes)}px，10px 以下在 1x 屏上读不清`);

/* ── 3. 圆角 ───────────────────────────────────────────────── */
const radii = [...both.matchAll(/border-radius:\s*([0-9.]+)(px|%)/g)].map((m) => m[1] + m[2]);
const uniqRadii = [...new Set(radii)].sort();
const oddRadius = uniqRadii.filter((r) => !['1px', '8px', '12px', '50%', '999px'].includes(r));
ck(oddRadius.length === 0, `圆角还有 ${oddRadius.join('、')}：控制件 8px、大块 12px、药丸 999px，混着来就是「AI 手笔」`);
ck(uniqRadii.includes('8px') && uniqRadii.includes('12px'), '圆角两档（8px / 12px）没有同时出现，收敛没做完整');
/* 1px 只属于圆点的方/空心方，别的地方不该有 */
const onePx = [...html.matchAll(/(?:^|[}\n])\s*([.\w-]+)\s*\{([^}]*border-radius:1px[^}]*)\}/g)]
  .map((m) => m[1].trim())
  .filter((sel) => !sel.includes('.dot'));
ck(onePx.length === 0, `1px 圆角出现在非圆点规则 ${onePx.join('、')} 上`);

/* ── 4. 状态不只靠颜色 ─────────────────────────────────────── */
const dOk = need('.dot.ok', '站得住');
const dWarn = need('.dot.warn', '被削弱');
const dDanger = need('.dot.danger', '不成');
const dUnd = need('.dot.und', '未定');
ck(/background:var\(--ok\)/.test(dOk) && !/border:/.test(dOk), '「站得住」不是实心圆');
ck(/background:\s*transparent/.test(dWarn) && /border:/.test(dWarn), '「被削弱」只是换了个颜色，没有换成空心圈——色弱的人分不出');
ck(/border-radius:1px/.test(dDanger), '「不成」没有换成方形，四档里它和别的档只差颜色');
ck(/background:\s*transparent/.test(dUnd) && /border-radius:1px/.test(dUnd), '「未定」没有做成空心方');
ck(/const DMAP=\{[^}]*upheld:'ok'[^}]*weakened:'warn'[^}]*refuted:'danger'[^}]*undetermined:'und'/.test(html),
  '档位到圆点的映射表 DMAP 缺项或顺序变了（refuted 曾经和 undetermined 一起画成绿点）');
ck(/DMAP\[a\.level\]\|\|'und'/.test(html), '存档行没有走 DMAP，认不出的档位会退回某个默认色');
ck(!/a\.level==='weakened'\?'warn':'ok'/.test(html), '存档行又回到「不是削弱就是绿点」的两分法');
ck(/class="leg"/.test(html), '界面上没有圆点图例');
for (const zh of ['站得住', '削弱', '不成', '未定']) {
  ck(new RegExp(`<i class="dot [a-z]+"></i>${zh}`).test(html), `图例里没有「${zh}」这一项，形状的含义就没写出来`);
}

/* ── 5. 一块区域一个实心主按钮 ─────────────────────────────── */
const tbtn = need('.tlink.btn', '顶栏那个「回去分析文本」');
ck(!/background:var\(--accentbg\)/.test(tbtn), '顶栏的「回去分析文本」又有实心底色了：它和速览页那个主按钮是同一件事，两个实心在抢注意力');
ck(/background:var\(--accentbg\)/.test(need('.ovbtn.primary', '速览页主按钮')), '速览页的主按钮不再是唯一的实心按钮');

/* ── 6. 密集列表用底色，不是每行拉线 ───────────────────────── */
const row = need('.row', '字段行');
ck(!/border-bottom/.test(row), '.row 又在每行拉横线了——十几行下来就是一片网');
ck(/background:var\(--panel2\)/.test(need('.row:nth-child(even)', '字段行隔行底色')), '字段行没有隔行底色，去掉横线后行与行会糊在一起');
const td = need('table.t td', '表格单元');
ck(!/border-bottom/.test(td), '表格单元又拉横线了');
ck(/background:var\(--panel2\)/.test(need('table.t tbody tr:nth-child(even) td', '表格隔行底色')), '表格没有隔行底色');

/* ── 7. 空状态 ─────────────────────────────────────────────── */
ck((html.match(/estate\(/g) || []).length >= 2, '检索页的空状态没走 estate()：又退回一句话了');
ck(/\.estate \.ett\{/.test(html), '空状态没有标题样式 .ett');
ck(/\.estate \.eacts\{/.test(html), '空状态没有动作区 .eacts');
/* 光有样式不算：模板里必须真的吐出这三层，否则样式在、界面还是那句话 */
const estateTpl = html.match(/const estate=\([^`]*`([\s\S]*?)`;/);
ck(!!estateTpl && /class="eic"/.test(estateTpl[1]) && /class="ett"/.test(estateTpl[1]) && /class="ehh"/.test(estateTpl[1]) && /class="eacts"/.test(estateTpl[1]),
  'estate() 的模板没有同时吐出符号 / 标题 / 说明 / 动作四层');
ck(/data-sq="\$\{esc\(q\)\}"/.test(html), '未输入时没有示例词按钮，空状态只说不做');
ck(/data-sqclear="1"/.test(html), '搜空时没有「清空关键词与过滤」这个动作');
ck(/res\.addEventListener\('click'[\s\S]{0,220}data-sq/.test(html), '示例词没有事件委托，点了不会搜');

/* ── 8. 行宽与说明条 ───────────────────────────────────────── */
const ov = need('.ov', '速览页');
const sr = need('.sr', '检索页');
const mx = (r) => Number((r.match(/max-width:(\d+)px/) || [])[1] || 0);
ck(mx(ov) > 0 && mx(ov) <= 900, `速览页正文宽 ${mx(ov) || '不限'}px，超过 900px 一行就过长了`);
ck(mx(sr) > 0 && mx(sr) <= 900, `检索页正文宽 ${mx(sr) || '不限'}px，超过 900px 一行就过长了`);
ck(/max-width:\d+px/.test(need('.guide>span', '顶部说明条')), '说明条没有限宽，会一行铺满整屏');
const guide = html.match(/这里是回看台<\/b><span>([\s\S]*?)<\/span>/);
ck(!!guide, '找不到说明条的正文');
if (guide) {
  const text = guide[1].replace(/<br\s*\/?>/g, '').replace(/<[^>]+>/g, '');
  ck(text.length <= 150, `说明条正文 ${text.length} 字，又长回去了（超过 150 字没人读完）`);
  ck(/<br\s*\/?>/.test(guide[1]), '说明条没有断行，还是一整段铺到底');
}

/* ── 9. 状态栏不许铺满强调色 ───────────────────────────────── */
const st = need('.status', '状态栏');
ck(!/background:var\(--accentbg\)/.test(st), '状态栏又整条铺强调色了：屏幕最大的一块颜色不该是最不重要的一行');

if (bad.length) {
  for (const x of bad) console.error(`  ✗ ${x}`);
  console.error(`\n✗ 界面规则 ${bad.length}/${n} 项不合格`);
  process.exit(1);
}
console.log(`✓ 界面规则：对比度、调色板、字号、圆角、状态形状、主按钮、次按钮、隔行底色、空状态、行宽 ${n} 项`);
