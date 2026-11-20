/**
 * 回看台「界面规则」检查（进 verify）。
 *
 * 这一轮界面整体换成 Notion 风格，依据是一份《Notion 风格 — 风格参考》里
 * 能被机器量的那几条，外加这个项目一直守着的可用性底线：
 *
 *   1. 普通文字对比度 ≥ 4.5:1（WCAG AA），两套主题、所有实际底色组合；
 *   2. 字号只留 12 / 14 / 16 / 20 / 24 / 32 六档——靠字重与颜色分层级；
 *   3. 圆角只留 4px（卡片/按钮/输入框）与 999px（胶囊）；1px 与 50% 是
 *      圆点形状，不算圆角；
 *   4. 状态不能只靠颜色：圆点用形状区分，并且把形状的含义写在界面上；
 *   5. 一块区域只有一个实心主按钮；
 *   6. 密集列表用隔行底色而不是每行拉线；
 *   7. 空状态要有标题与一个真能点的动作；
 *   8. 正文行宽有上限，说明条不再是一整段长文；
 *   9. 主窗口调色板自身逐对过对比度（底 × 前景的笛卡尔积），实心底上的白字另算；
 *  10. 主窗口样式表里不许出现 `:root` 之外的色值——颜色只能来自契约层；
 *  11. 契约层的精确值逐项对表（米纸、暖墨、发丝线、链接蓝、标记红、
 *      字阶、间距、圆角、布局、字体）；语义层只准 var() 引用，不准自带 hex；
 *  12. 无渐变背景、无毛玻璃、无重投影（弹层那一个除外）；
 *  13. 无 translate / scale 动画：transition 只许颜色类且 ≤150ms，
 *      hover 不许位移、缩放、描边或阴影跳变；
 *  14. 次按钮全站共用一套 Ghost Button 皮（透明底、hover 才铺灰）；
 *  15. 状态底色只有一种中性灰——语义交给字色与形状；
 *  16. 首屏高频标签不许带底色与圆角框；彩色 3px 左边条清零、横幅不许铺底；
 *  17. 原味 Link Blue / Marker Red 保留为点缀色，但**不许**被用作文字色。
 *
 * 边界（必须说清，否则会被当成它管不了的保证）：
 *  - 它读的是源码里的 CSS 文本与模板字符串，不是浏览器里的实际渲染。
 *    真正挤压、错位、字被裁，只有 CDP 量或人眼看图才发现得了。
 *  - 对比度按十六进制字面值算，算不到 rgba、渐变、图片背景上的文字。
 *  - 「实心主按钮只有一个」只按类名与背景色判断，判断不了人眼觉得哪个更显眼。
 *  - 字号与圆角两条同时罩 React 主窗口的样式表（src/renderer/src/*.css）
 *    与 workbench.html：只罩住一半界面的规则，会让人以为另一半也是干净的。
 *  - 「hover 只变背景色」按选择器规则体文本判定，判断不了 transition 的
 *    实际缓动曲线，也判断不了 JS 里临时加的内联样式。
 *
 * 跑法：npm run check:ui-rules
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

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

/* ── 1. 双主题对比度 ───────────────────────────────────────── */
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
  for (const f of FG) for (const b of BG) {
    const r = ratio(p[f], p[b]);
    if (r < 4.5) fails.push(`${f} 落在 ${b} 上只有 ${r.toFixed(2)}:1`);
  }
  ck(fails.length === 0,
    `${name}主题有 ${fails.length} 组文字低于 4.5:1（WCAG AA）：${fails.slice(0, 3).join('；')}`);
}
/* 默认主题是 light：风格参考只定义浅色，深色是系统偏好的兜底。 */
ck(/<html lang="zh-CN" data-theme="light">/.test(html),
  '回看台默认不是 light：Notion 风格是米纸浅色，深色只作系统兜底');

/* ── React 主窗口的样式表也纳入字号与圆角 ───────────────────── */
const reactDir = path.join(ROOT, 'src/renderer/src');
const reactCss = readdirSync(reactDir)
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(path.join(reactDir, f), 'utf8'))
  .join('\n');
const both = html + '\n' + reactCss;
ck(reactCss.length > 20000,
  `React 主窗口的样式表没读进来（只读到 ${reactCss.length} 字符）：字号与圆角会漏掉整个主界面`);

/* ═══════ 解析 :root 的 var() 引用链 ═══════ */
/*
 * 上一代的 :root 是「一个变量一个 hex」的平铺表，脚本直接抓 `--x: #hex`。
 * Notion 契约层把真值收在 --color-* 上，语义层（--bg / --ink / --accent…）
 * 全是 var() 引用。抓不到语义层，对比度与图表色表对表就会一起哑掉——
 * 那正是这个项目最忌讳的假绿。所以这里先把整条引用链解出来。
 */
const stylesCss = readFileSync(path.join(ROOT, 'src/renderer/src/styles.css'), 'utf8');
const rootBlock = (stylesCss.match(/:root\s*\{([\s\S]*?)\}/) ?? ['', ''])[1];
const decl = {};
for (const m of rootBlock.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) decl[m[1]] = m[2].trim();
const resolved = {};
const rawHex = {};
for (const m of rootBlock.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{6})\s*;/g)) rawHex[m[1]] = m[2].toLowerCase();
const resolve = (name, seen = new Set()) => {
  if (resolved[name] !== undefined) return resolved[name];
  if (seen.has(name)) return undefined;              // 循环引用，判失败
  const v = decl[name];
  if (!v) return undefined;
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return (resolved[name] = v.toLowerCase());
  const m = v.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/);
  if (m) return (resolved[name] = resolve(m[1], new Set([...seen, name])));
  return undefined;                                  // 非颜色值（阴影/字距/字体栈）
};
for (const k of Object.keys(decl)) resolve(k);
const rootVars = resolved;
ck(Object.keys(decl).length >= 60, `:root 只读到 ${Object.keys(decl).length} 个声明，契约层像是被削掉了`);

/* ── 1b. 图表调色板与 :root 对表 ────────────────────────────── */
/*
 * SVG 的 fill= / stroke= 不认 var()，Diagram.tsx 里那张 C 表是 :root 的手抄影子。
 * 手抄的东西必走样：主界面换成米纸墨色后，这张表还留着旧苹果灰，
 * 结构图上每一条线都是另一个时代的样子，而没有任何检查会红。
 * 这里逐项对表，并额外要求「C 的每个键都在映射里」——漏映射等于漏检查。
 */
const VAR_OF = {
  ink: 'ink', ink2: 'ink-2', ink3: 'ink-3', line: 'line', lineStrong: 'line-strong',
  edge: 'edge', accent: 'accent', accentBg: 'accent-bg', strong: 'strong',
  strongBg: 'strong-bg', weak: 'weak', weakBg: 'weak-bg', invalid: 'invalid',
  invalidBg: 'invalid-bg', panel: 'panel', panel2: 'panel-2',
};
const diagramTsx = readFileSync(path.join(ROOT, 'src/renderer/src/components/Diagram.tsx'), 'utf8');
const cTable = (diagramTsx.match(/export const C = \{([\s\S]*?)\};/) ?? ['', ''])[1];
const cEntries = [...cTable.matchAll(/(\w+):\s*'(#[0-9a-fA-F]{6})'/g)].map((m) => [m[1], m[2].toLowerCase()]);
ck(cEntries.length >= 14, `图表调色板只读到 ${cEntries.length} 项，对表失去意义`);
const unmapped = cEntries.map(([k]) => k).filter((k) => !VAR_OF[k]);
ck(unmapped.length === 0, `图表调色板里有 ${unmapped.join('、')} 没有对应变量，等于没被检查`);
for (const [k, v] of cEntries) {
  const varName = VAR_OF[k];
  if (!varName) continue;
  ck(rootVars['--' + varName] === v,
    `图表调色板 C.${k} 是 ${v}，:root 的 --${varName} 解出来是 ${rootVars['--' + varName] ?? '（缺）'}——两处对不上`);
}

/* ── 1c. 主窗口调色板的对比度（解析引用链之后） ───────────── */
const RFG = ['ink', 'ink-2', 'ink-3', 'strong', 'weak', 'invalid', 'legal', 'accent'];
const RBG = ['bg', 'panel', 'panel-2', 'muted-bg', 'muted-bg-2', 'strong-bg', 'weak-bg', 'invalid-bg', 'legal-bg', 'accent-bg'];
const missingVars = [...RFG, ...RBG, 'on-solid'].filter((k) => !rootVars['--' + k]);
ck(missingVars.length === 0, `styles.css 的 :root 解不出 ${missingVars.map((k) => '--' + k).join('、')}，主窗口的对比度没法算`);
if (missingVars.length === 0) {
  const fails = [];
  for (const f of RFG) for (const b of RBG) {
    const r = ratio(rootVars['--' + f], rootVars['--' + b]);
    if (r < 4.5) fails.push(`--${f} 落在 --${b} 上只有 ${r.toFixed(2)}:1`);
  }
  ck(fails.length === 0, `主窗口有 ${fails.length} 组文字低于 4.5:1：${fails.slice(0, 3).join('；')}`);
  const solids = ['accent', 'accent-press', 'strong', 'weak', 'invalid', 'legal', 'ink', 'ink-3'];
  const onFails = solids.filter((k) => ratio(rootVars['--on-solid'], rootVars['--' + k]) < 4.5);
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

/* ── 1d. 调色板外不许有色值 ───────────────────────────────── */
/*
 * 主窗口的样式表里，颜色只能来自 :root 的契约层。白也是颜色，所以它有名字。
 * 这一条连 rgba 一起收：上一代隔行底与滚动条用的是 12 处 rgba(60,79,99,.03)
 * 这种「不算 hex 就绕过去」的写法，整屏不齐但没有任何检查会红。
 * 注释不算——注释里的色值是对历史的记录。
 */
const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const reactBare = stripCssComments(reactCss).replace(/:root\s*\{[^}]*\}/g, '');
const strayHex = [...reactBare.matchAll(/#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])/g)].map((m) => m[0]);
const strayRgba = [...reactBare.matchAll(/rgba?\([^)]*\)/g)].map((m) => m[0]);
ck(strayHex.length === 0 && strayRgba.length === 0,
  `主窗口样式表里有 ${strayHex.length} 处 hex、${strayRgba.length} 处 rgba 调色板外的色值（${[...new Set([...strayHex, ...strayRgba])].slice(0, 4).join('、')}）：颜色只能来自 :root`);

/* ── 1e. Notion 契约层：精确值逐项对表 ───────────────────── */
/*
 * 「换成 Notion 风格」不是一句观感：纸面、墨色、发丝线、原味蓝与红，
 * 以及字阶、间距、圆角、布局、字体，都得是参考里给的那些数。
 * 只查「有没有这个变量」是假绿——把 #f7f6f3 改成 #ffffff 照样绿。
 */
const CONTRACT = {
  '--color-ink': '#37352f', '--color-paper': '#f7f6f3', '--color-page': '#ffffff',
  '--color-hover-grey': '#efedea', '--color-press-grey': '#e3e1db',
  '--color-hairline': '#e9e7e4', '--color-link-blue': '#2eaadc',
  '--color-marker-red': '#eb5757',
  '--text-display': '32px', '--text-heading': '24px', '--text-subheading': '20px',
  '--text-body-lg': '16px', '--text-body': '14px', '--text-label': '12px',
  '--leading-body': '1.6', '--tracking-display': '-0.01em',
  '--spacing-unit': '4px', '--spacing-8': '8px', '--spacing-16': '16px',
  '--spacing-48': '48px', '--page-max-width': '708px', '--section-gap': '48px',
  '--card-padding': '16px', '--element-gap': '8px', '--density': 'compact',
  '--radius-cards': '4px', '--radius-buttons': '4px', '--radius-inputs': '4px',
  '--radius-pills': '999px', '--surface-paper': '#f7f6f3',
  '--surface-white-page': '#ffffff', '--surface-hover-grey': '#efedea',
};
for (const [k, want] of Object.entries(CONTRACT)) {
  const got = decl[k];
  /* 值可能是 hex 字面，也可能是 var(--color-*) 引用；两种都解成最终值再比。 */
  const final = /^#/.test(want) ? (got?.startsWith('#') ? got.toLowerCase() : resolve(got?.match(/var\((--[\w-]+)\)/)?.[1])) : got;
  ck(final === want, `契约令牌 ${k} 是 ${got ?? '（缺）'}，参考要求 ${want}`);
}

/* 语义层只准引用，不准自带 hex：真值只能有一处。 */
const SEMANTIC_COLOR = ['bg', 'panel', 'panel-2', 'ink', 'ink-2', 'ink-3', 'line',
  'line-strong', 'edge', 'hair', 'strong', 'strong-bg', 'weak', 'weak-bg',
  'invalid', 'invalid-bg', 'legal', 'legal-bg', 'accent', 'accent-bg',
  'muted-bg', 'muted-bg-2', 'on-solid', 'accent-press', 'accent-off'];
const selfHex = SEMANTIC_COLOR.filter((k) => /^#[0-9a-fA-F]{6}$/i.test(decl['--' + k] ?? ''));
ck(selfHex.length === 0,
  `语义层 ${selfHex.map((k) => '--' + k).join('、')} 自己写了 hex：真值必须只留在契约层，语义层一律 var() 引用`);
ck(SEMANTIC_COLOR.every((k) => /^var\(--[\w-]+\)$/.test(decl['--' + k] ?? '')),
  '语义层有变量既不是 var() 引用也不是别的合法值：颜色只能从契约层来');

/* 原味点缀色不许被用作文字色 */
const TEXT_KEYS = ['ink', 'ink-2', 'ink-3', 'accent', 'accent-press', 'invalid', 'strong', 'weak', 'legal'];
const rawLeak = TEXT_KEYS.filter((k) => {
  const v = decl['--' + k] ?? '';
  return v.includes('--color-link-blue') || v.includes('--color-marker-red');
});
ck(rawLeak.length === 0,
  `文字色 ${rawLeak.map((k) => '--' + k).join('、')} 直接用了原味 Link Blue / Marker Red：它们在白底只有 2.66 / 3.48:1`);
ck(rootVars['--accent'] !== rootVars['--color-link-blue'] && rootVars['--invalid'] !== rootVars['--color-marker-red'],
  '--accent / --invalid 必须走压深一档的可读版，原味色只做点缀');

/* ── 1f. 字体栈唯一、无衬线 ───────────────────────────────── */
const sans = decl['--font-sans'] ?? '';
ck(/ui-sans-serif/.test(sans) && /system-ui/.test(sans) && /PingFang SC/.test(sans),
  '--font-sans 不是参考给的系统栈（ui-sans-serif / system-ui / PingFang SC）');
/* 按逗号切成字族再逐个判断：ui-sans-serif / sans-serif 里的 serif 是系统栈的一部分，
 * 用裸 /serif/ 会把参考要求的字号栈自己判红。这里只拦真正的衬线字族与旧字族。 */
const sansFamilies = (decl['--font-sans'] ?? '').split(',')
  .map((f) => f.trim().replace(/^['"]|['"]$/g, ''));
const serifFamilies = sansFamilies.filter((f) => /^(Georgia|Times|Times New Roman|Songti SC|SimSun|宋体|Noto Serif\S*|Source Han Serif\S*|SF Pro Text|Helvetica Neue|serif)$/i.test(f));
ck(serifFamilies.length === 0,
  `--font-sans 里混进了衬线或上一代字族（${serifFamilies.join('、') || '无'}）：Notion 全站只有一套字体`);
ck((decl['--sans'] ?? '').includes('--font-sans') && (decl['--display'] ?? '').includes('--font-sans'),
  '--sans 与 --display 没有都指回 --font-sans：标题不该另起一套字族');

/* ── 1g. 无渐变、无毛玻璃、无重投影 ───────────────────────── */
const bare = stripCssComments(both);
ck(!/gradient\(/.test(bare), '界面里还有渐变背景：Notion 的纸面是纯色，渐变会把纸面变成海报');
ck(!/backdrop-filter/.test(bare), '界面里还有 backdrop-filter 毛玻璃：文档工具没有漂浮的材质层');
const shadows = [...bare.matchAll(/box-shadow:\s*([^;}]+)/g)].map((m) => m[1].trim());
const heavy = shadows.filter((v) => {
  if (v === 'none' || v === 'var(--shadow-1)' || v === 'var(--shadow-2)'
    || v === 'var(--shadow-popover)' || v === 'var(--shade)' || v === 'var(--focus)') return false;
  /* 0 blur / 0 offset 的 1~2px 描边环等价于线，不算投影 */
  if (/^0 0 0 \d+px /.test(v)) return false;
  return true;
});
ck(heavy.length === 0,
  `还有 ${heavy.length} 处投影阴影（${heavy.slice(0, 3).join('；')}）：除弹层外一律无阴影`);
ck(/--shadow-popover:\s*0 8px 24px rgba\(15,\s*15,\s*15,\s*0\.12\)/.test(rootBlock),
  '弹层阴影不是参考给的 0 8px 24px rgba(15,15,15,0.12)');
ck(decl['--shadow-1'] === 'none' && decl['--shadow-2'] === 'none',
  '--shadow-1 / --shadow-2 不再是 none：卡片又浮起来了');

/* ── 1h. 无位移缩放动效 ───────────────────────────────────── */
/* 回看台是单文件 HTML，样式写在 <style> 里；不并进来的话 hover/动效守卫
 * 只管主窗口，回看台改回带边框跳变的旧样式也不会红。 */
const wbStyle = (html.match(/<style>([\s\S]*?)<\/style>/) ?? ['', ''])[1];
const cssNoRoot = stripCssComments(reactCss + '\n' + wbStyle).replace(/:root\s*\{[^}]*\}/g, '');
const transforms = [...cssNoRoot.matchAll(/(?:^|[;{\s])(?<!text-)transform:\s*([^;}]+)/g)].map((m) => m[1].trim());
ck(transforms.length === 0,
  `主窗口样式表里还有 ${transforms.length} 处 transform（${transforms.slice(0, 3).join('、')}）：禁止任何 translate / scale 动画`);
const keyframeBlocks = [...cssNoRoot.matchAll(/@keyframes[\s\S]*?\}\s*\}/g)].map((m) => m[0]);
ck(keyframeBlocks.every((b) => !/transform|scale\(|translate/.test(b)),
  '@keyframes 里还有位移或缩放：进度提示只许变颜色/透明度，不许呼吸式缩放');
const transitions = [...cssNoRoot.matchAll(/transition:\s*([^;}]+)/g)].map((m) => m[1].trim());
const badTrans = transitions.filter((v) => {
  if (v === 'none') return false;
  /* 时长必须是 150ms（或等价的 .15s），属性只能是颜色类 + 开关 left + 进度条 width */
  if (!/150ms|\.15s/.test(v) || /[\d.]+(?!150)ms|[1-9]\.\d+s/.test(v.replace(/150ms/g, ''))) {
    if (!/(?:^|,)\s*[a-z-]+\s+150ms/.test(v)) return true;
  }
  return /transform|box-shadow|all\b|top\b|right\b|bottom\b|margin|height/.test(v);
});
ck(badTrans.length === 0,
  `还有 ${badTrans.length} 处 transition 不是「颜色类 ≤150ms」（${badTrans.slice(0, 3).join('；')}）：hover 只让背景变色`);
const TRANS_PROPS = ['color', 'background', 'background-color', 'border-color', 'opacity', 'width', 'left'];
const badProp = transitions.filter((v) => v !== 'none' &&
  [...v.matchAll(/([a-z-]+)\s+150ms/g)].some((m) => !TRANS_PROPS.includes(m[1])));
ck(badProp.length === 0, `transition 里出现了颜色/宽度之外的属性（${badProp.slice(0, 2).join('；')}）`);
/* hover 规则里不许出现 transform / box-shadow / 描边跳变 */
const hoverRules = [...cssNoRoot.matchAll(/([^{}]+:hover[^{}]*)\{([^}]*)\}/g)];
const badHover = hoverRules.filter(([, , body]) =>
  /transform|box-shadow|border(?:-color|-width|-style)?\s*:|translate|scale\(/.test(body));
ck(badHover.length === 0,
  `还有 ${badHover.length} 条 :hover 规则带了位移/缩放/阴影/描边跳变（${badHover.slice(0, 2).map((m) => m[1].trim()).join('、')}）：hover 只变背景色`);

/* ── 1i. 字号阶梯（六档）与区段标题 ───────────────────────── */
const sizes = [...new Set([...both.matchAll(/font-size:\s*([0-9.]+)px/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
const ALLOWED_SIZE = [12, 14, 16, 20, 24, 32];
const extraSize = sizes.filter((s) => !ALLOWED_SIZE.includes(s));
ck(extraSize.length === 0, `字号多出 ${extraSize.join('、')}px：只留 ${ALLOWED_SIZE.join(' / ')} 六档`);
ck(Math.min(...sizes) >= 12, `最小的字是 ${Math.min(...sizes)}px：Notion 的 label 是 12px，10px 在 1x 屏上糊成黑块`);
ck(sizes.filter((s) => ALLOWED_SIZE.includes(s)).length >= 4, '六档里实际用上的不足四档，字阶像没真正落地');
const blockTitleRule = cssRule(reactCss, '.block-head .t');
ck(blockTitleRule.length > 0, '找不到 .block-head .t 这条规则，区段标题的字号无从核对');
ck(/font-size:\s*20px/.test(blockTitleRule), '区段标题不是 20px（subheading 档）：与正文同号时报告会读成一片');

/* ── 1j. 圆角只 4px / 999px，形状不算 ─────────────────────── */
const radii = [...both.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim());
const uniqRadii = [...new Set(radii)].sort();
const OK_RADIUS = ['4px', '999px', '50%', '1px', '0', '0 4px 4px 0', '4px 4px 0 0'];
const oddRadius = uniqRadii.filter((r) => !OK_RADIUS.includes(r));
ck(oddRadius.length === 0,
  `圆角还有 ${oddRadius.join('、')}：卡片/按钮/输入框 4px、胶囊 999px，混着来就是「AI 手笔」`);
ck(uniqRadii.includes('4px') && uniqRadii.includes('999px'),
  '圆角两档（4px / 999px）没有同时出现，收敛没做完整');
const onePx = [...html.matchAll(/(?:^|[}\n])\s*([.\w-]+)\s*\{([^}]*border-radius:1px[^}]*)\}/g)]
  .map((m) => m[1].trim()).filter((sel) => !sel.includes('.dot'));
ck(onePx.length === 0, `1px 圆角出现在非圆点规则 ${onePx.join('、')} 上`);

/* ── 1k. 布局契约：阅读列不超过 708px ─────────────────────── */
ck(decl['--page-max-width'] === '708px' && decl['--read-measure'],
  '正文读列没有同时受 708px 硬上限与行长度量约束');
const mx = (r) => Number((r.match(/max-width:\s*(\d+)px/) || [])[1] || 0);
ck(mx(need('.ov', '速览页')) > 0 && mx(need('.ov', '速览页')) <= 708,
  `速览页正文宽 ${mx(need('.ov', '速览页')) || '不限'}px 超过 708px`);
ck(mx(need('.sr', '检索页')) > 0 && mx(need('.sr', '检索页')) <= 708,
  `检索页正文宽 ${mx(need('.sr', '检索页')) || '不限'}px 超过 708px`);

/* ── 1l. 次按钮共用一套 Ghost Button 皮 ───────────────────── */
for (const [file, sel] of [
  ['src/renderer/src/styles.css', '.ghost-btn'],
  ['src/renderer/src/styles.css', '.exp-btn'],
  ['src/renderer/src/styles-flow.css', '.rr-open'],
]) {
  const src = readFileSync(path.join(ROOT, file), 'utf8');
  const r = cssRule(src, sel);
  ck(r.length > 0, `找不到次按钮 ${sel} 的规则`);
  if (!r) continue;
  ck(/background:\s*transparent/.test(r), `${sel} 常态不是透明底：Ghost Button 只有 hover 才铺灰`);
  ck(!/border:\s*1px solid/.test(r), `${sel} 又描边了：一屏七个描边小方框就是这样攒出来的`);
  ck(!/box-shadow:\s*(?!none)/.test(r), `${sel} 带投影了：文档里的按钮不浮起来`);
}

/* ── 1m. 状态底色只有一种中性灰 ───────────────────────────── */
const STATE_BG = ['strong-bg', 'weak-bg', 'invalid-bg', 'legal-bg'];
const neutral = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(...c) - Math.min(...c) <= 8;   /* 米纸与 hover 灰本身带一点暖，仍算低饱和 */
};
const stateBgFails = STATE_BG.filter((k) => !rootVars['--' + k] || !neutral(rootVars['--' + k]));
ck(stateBgFails.length === 0,
  `状态底色 ${stateBgFails.join('、')} 不是低饱和灰：一屏回到四种彩色块，减法白做了`);
ck(STATE_BG.every((k) => rootVars['--' + k] === rootVars['--muted-bg']),
  '四个状态底色不都等于 --muted-bg：状态不该靠底色分家，要靠字色');

/* ── 1n. 彩色 3px 左边条清零 ───────────────────────────────── */
const thickLeft = [...reactCss.matchAll(/border-left:\s*3px/g)].length;
ck(thickLeft === 0, `主窗口还有 ${thickLeft} 处 3px 左边条：满屏彩色竖带又回来了`);
const blueLeft = [...reactCss.matchAll(/border-left:\s*[23]px\s+solid\s+var\(--accent\)/g)].length;
ck(blueLeft === 0, `还有 ${blueLeft} 处蓝色实线左边条：那是模板网站的强调手法`);
const insetLeft = [...reactCss.matchAll(/box-shadow:\s*inset\s+[23]px/g)].length;
ck(insetLeft === 0, `还有 ${insetLeft} 处 inset 2/3px 左边条：换成 1px 发丝线`);

/* ── 1o. 首屏高频标签不许带底色与圆角框 ────────────────────── */
const LIGHT_TAGS = [
  ['src/renderer/src/styles.css', '.qx', '四句话卡右端徽章'],
  ['src/renderer/src/styles.css', '.qn-chip', '跳转目录'],
  ['src/renderer/src/styles-source.css', '.src-tag', '判断数徽章'],
  ['src/renderer/src/styles-procedure.css', '.wf-go', '流程账行末链接'],
];
for (const [file, sel, why] of LIGHT_TAGS) {
  const r = cssRule(readFileSync(path.join(ROOT, file), 'utf8'), sel);
  ck(r.length > 0, `找不到 ${sel} 这条规则（${why}）`);
  if (!r) continue;
  ck(!/background:\s*var\(--(?:strong|weak|invalid|legal|accent|muted)-bg\)/.test(r),
    `${sel} 又铺上状态底色了：${why} 只能是文字`);
  ck(!/border-radius:\s*(?:8px|12px|999px)/.test(r),
    `${sel} 又变成圆角药丸了：${why} 不该是一排小方块`);
}

/* ── 1p. 整条横幅不许铺底 ─────────────────────────────────── */
for (const [file, sel, why] of [
  ['src/renderer/src/styles-procedure.css', '.wf-breach', '流程账缺口横幅'],
  ['src/renderer/src/styles-procedure.css', '.wf-closure', '流程账收口横幅'],
]) {
  const r = cssRule(readFileSync(path.join(ROOT, file), 'utf8'), sel);
  ck(r.length > 0, `找不到 ${sel}（${why}）`);
  if (!r) continue;
  ck(!/background:\s*var\(--(?:strong|weak|invalid|legal|accent)-bg\)/.test(r),
    `${sel} 又整条铺彩色底了：${why} 用红字与左边细线就够`);
}

/* ═══════ 与风格无关的可用性守卫（原样保留） ═══════ */
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
const tbtn = need('.tlink.btn', '顶栏那个「回去分析文本」');
ck(!/background:var\(--accentbg\)/.test(tbtn), '顶栏的「回去分析文本」又有实心底色了：它和速览页那个主按钮是同一件事');
ck(/background:var\(--accentbg\)/.test(need('.ovbtn.primary', '速览页主按钮')), '速览页的主按钮不再是唯一的实心按钮');
const row = need('.row', '字段行');
ck(!/border-bottom/.test(row), '.row 又在每行拉横线了——十几行下来就是一片网');
ck(/background:var\(--panel2\)/.test(need('.row:nth-child(even)', '字段行隔行底色')), '字段行没有隔行底色，去掉横线后行与行会糊在一起');
const td = need('table.t td', '表格单元');
ck(!/border-bottom/.test(td), '表格单元又拉横线了');
ck(/background:var\(--panel2\)/.test(need('table.t tbody tr:nth-child(even) td', '表格隔行底色')), '表格没有隔行底色');
ck((html.match(/estate\(/g) || []).length >= 2, '检索页的空状态没走 estate()：又退回一句话了');
ck(/\.estate \.ett\{/.test(html), '空状态没有标题样式 .ett');
ck(/\.estate \.eacts\{/.test(html), '空状态没有动作区 .eacts');
const estateTpl = html.match(/const estate=\([^`]*`([\s\S]*?)`;/);
ck(!!estateTpl && /class="eic"/.test(estateTpl[1]) && /class="ett"/.test(estateTpl[1]) && /class="ehh"/.test(estateTpl[1]) && /class="eacts"/.test(estateTpl[1]),
  'estate() 的模板没有同时吐出符号 / 标题 / 说明 / 动作四层');
ck(/data-sq="\$\{esc\(q\)\}"/.test(html), '未输入时没有示例词按钮，空状态只说不做');
ck(/data-sqclear="1"/.test(html), '搜空时没有「清空关键词与过滤」这个动作');
ck(/res\.addEventListener\('click'[\s\S]{0,220}data-sq/.test(html), '示例词没有事件委托，点了不会搜');
ck(/max-width:\d+px/.test(need('.guide>span', '顶部说明条')), '说明条没有限宽，会一行铺满整屏');
const guide = html.match(/这里是回看台<\/b><span>([\s\S]*?)<\/span>/);
ck(!!guide, '找不到说明条的正文');
if (guide) {
  const text = guide[1].replace(/<br\s*\/?>/g, '').replace(/<[^>]+>/g, '');
  ck(text.length <= 150, `说明条正文 ${text.length} 字，又长回去了（超过 150 字没人读完）`);
  ck(/<br\s*\/?>/.test(guide[1]), '说明条没有断行，还是一整段铺到底');
}
const st = need('.status', '状态栏');
ck(!/background:var\(--accentbg\)/.test(st), '状态栏又整条铺强调色了：屏幕最大的一块颜色不该是最不重要的一行');

if (bad.length) {
  for (const x of bad) console.error(`  ✗ ${x}`);
  console.error(`\n✗ 界面规则 ${bad.length}/${n} 项不合格`);
  process.exit(1);
}
console.log(`✓ 界面规则：Notion 契约、对比度、色彩真值、字阶圆角、无阴影无动效、次按钮、隔行底色、空状态、行宽、降噪 ${n} 项`);
