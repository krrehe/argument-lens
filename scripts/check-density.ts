/**
 * 阅读层级（简洁 / 完整）的只读检查。
 *
 * 这一关最要紧的不是「有没有收起」，而是**别让收起变成删内容**：
 * 折叠必须只改 class，children 照常渲染；主线栏一栏都不许收；三条边界
 * 一句不许少；端到端默认跑道必须真的点回「完整」，否则一百多条按展开态
 * 写的断言会在一个看不见的地方集体失真。
 *
 * 防恒真：判定函数用「核心 / 核对 / 无 id / 冲突 / 未知」五组对照，
 * 任何一条行为断言在至少一组上必须为假。
 *
 * 跑法：npm run check:density（已进 verify）
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CORE_SECTIONS,
  DEFAULT_DENSITY,
  DENSITY_BOUNDS,
  DENSITY_STORAGE_KEY,
  LEDGER_SECTIONS,
  LEDGER_TITLES,
  PREVIEW_DENSITY,
  densityLine,
  isLedgerSection,
  normalizeDensity,
  sectionKey,
} from '@shared/ui-density';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, extra = ''): void {
  if (cond) passed++;
  else failed.push(extra ? `${label}（${extra}）` : label);
}
function src(p: string): string {
  return readFileSync(resolve(process.cwd(), p), 'utf-8');
}

/* ─────────── 1. 纯函数：五组对照，不许恒真 ─────────── */

ok(DEFAULT_DENSITY === 'compact', '真应用默认简洁');
ok(PREVIEW_DENSITY === 'full', '预览页默认完整，旧截图基准不跟着变');
ok(
  DENSITY_STORAGE_KEY === 'al:density' && DENSITY_STORAGE_KEY.startsWith('al:'),
  '偏好存在本机的独立键上',
);

const values: unknown[] = ['compact', 'full', undefined, null, '', 'FULL', 0, {}, 'garbage'];
for (const v of values) {
  const got = normalizeDensity(v);
  ok(got === 'compact' || got === 'full', `读到的值总能落回两个模式之一：${String(v)}`);
}
ok(normalizeDensity('full') === 'full', '读到 full 就照它显示');
ok(normalizeDensity('compact') === 'compact', '读到 compact 就照它显示');
ok(normalizeDensity('FULL') === 'compact', '不猜大小写，读坏了退回默认');
ok(normalizeDensity({}) === 'compact', '读到对象不猜，退回默认');

/* 两条方向都必须踩到：只验 true 的断言在「永远 true」的实现下照样绿。 */
ok(
  CORE_SECTIONS.every((id) => !isLedgerSection(id)),
  '主线栏一栏都不进核对层',
);
ok(
  LEDGER_SECTIONS.every((id) => isLedgerSection(id)),
  '核对层清单里每一栏都会被收起',
);
ok(
  LEDGER_TITLES.every((t) => isLedgerSection(undefined, t)),
  '没有 id 的核对栏按标题归层',
);
ok(!isLedgerSection('sec-unknown'), '没听过的栏不收起');
ok(!isLedgerSection(undefined, '原文'), '没 id 又不在清单里的栏不收起');
ok(
  CORE_SECTIONS.some((id) => id !== 'sec-verdict') && isLedgerSection('sec-flow'),
  '两组对照里至少有一条为真、一条为假（判定不是恒真也不是恒假）',
);
ok(
  (CORE_SECTIONS as readonly string[]).includes('sec-legit'),
  '「此处合法」属于主线——只列问题的清单不能反过来被收进附注',
);
ok(
  !(CORE_SECTIONS as readonly string[]).some((id) => (LEDGER_SECTIONS as readonly string[]).includes(id)),
  '核心与核对两张清单不相交',
);
ok(sectionKey('sec-flow') === 'sec-flow', '有 id 用 id 作展开键');
ok(sectionKey(undefined, '程序裁定') === '程序裁定', '没 id 用标题作展开键');
ok(sectionKey() === 'unnamed', '两样都没有时给一个固定键，不抛错');
ok(densityLine('compact') !== densityLine('full'), '两种模式在工具条上说的不是同一句');
ok(densityLine('compact').includes('收起'), '简洁态明说收起了东西');
ok(densityLine('full').includes('完整'), '完整态明说全展开');

ok(DENSITY_BOUNDS.length === 3, '三条边界一句不许少');
ok(DENSITY_BOUNDS.some((b) => b.includes('报告') && b.includes('Markdown')), '边界写明报告与导出不变');
ok(DENSITY_BOUNDS.some((b) => b.includes('完整') && b.includes('顺序')), '边界写明完整态一栏不少');
ok(DENSITY_BOUNDS.some((b) => b.includes('跳到') && b.includes('展开')), '边界写明目录点进去会自动展开');

/* ─────────── 2. 常量表与真实界面对得上 ─────────── */

const diag = src('src/renderer/src/components/Diagnosis.tsx');
const ov = src('src/renderer/src/components/Overview.tsx');
for (const id of CORE_SECTIONS) ok(`${diag}${ov}`.includes(`id="${id}"`), `主线 ${id} 真的在报告里`);
for (const id of LEDGER_SECTIONS) ok(diag.includes(`id="${id}"`), `核对层 ${id} 真的在报告里`);
for (const t of LEDGER_TITLES) ok(diag.includes(`title="${t}"`), `按标题归层的 ${t} 真的在报告里`);

/* 折叠只加 class：children 必须无条件渲染，探针才不会跟着一起消失。 */
ok(diag.includes('data-collapsed={collapsed'), '折叠状态写进 DOM，端到端读得到');
ok(diag.includes('data-density-tier={ledger'), '层级写进 DOM，收起与主线分得开');
ok(diag.includes('isLedgerSection(id, title)'), '归层用的是纯函数表，不是界面现写一份');
ok(diag.includes('const { density, isRevealed, toggle } = useDensity()'), 'Block 接了密度状态');
ok(diag.includes('<div className="block-body">{children}</div>'), 'children 无条件渲染');
ok(!diag.includes('{!collapsed && children}'), '不许按条件卸载 children');
ok(!diag.includes('{collapsed ? null : children}'), '不许把折叠的栏渲成 null');
ok(diag.includes('<DensityBar />'), '报告第一行有阅读层级工具条');

/* ─────────── 3. 状态、跳转、入口 ─────────── */

const density = src('src/renderer/src/components/Density.tsx');
ok(density.includes('createContext'), '密度状态走 Context，不靠全局变量');
ok(density.includes('density: PREVIEW_DENSITY'), '没包 Provider 时默认完整（预览页基准）');
ok(density.includes("document.documentElement.dataset.density = density"), '模式写到根上给 CSS 用');
ok(density.includes("localStorage.getItem(DENSITY_STORAGE_KEY)"), '真应用读本机偏好');
ok(density.includes('localStorage.setItem(DENSITY_STORAGE_KEY, next)'), '真应用写回本机偏好');
ok(density.includes("window.addEventListener('al:reveal', onReveal)"), '目录跳转的展开事件有人接');
ok(density.includes('data-density="compact"') && density.includes('data-density="full"'), '两个按钮都按名字可点');
ok(density.includes('DENSITY_BOUNDS.map'), '三条边界印在工具条里，不是只在文档里');
ok(density.includes('@allow-silent:'), '读写本机偏好的 catch 写了理由');
ok(
  density.includes('data-brief-fold') && !density.includes('open={density === PREVIEW_DENSITY}'),
  '透镜说明默认收起，完整态也不再强行展开'
);

const overview = src('src/renderer/src/components/Overview.tsx');
ok(overview.includes("new CustomEvent('al:reveal'"), '点「跳到」会派发展开事件');
ok(overview.includes("el.getAttribute('data-collapsed') === '1'"), '只有真收起的栏才等一帧');
ok(overview.includes('else land();'), '完整态同步滚动，端到端时序不变');

const app = src('src/renderer/src/App.tsx');
ok(app.includes('<DensityProvider persist>'), '真应用包了 Provider 并持久化');
ok(app.includes('<BriefFold>'), '左栏透镜说明收进可展开区');
const main = src('src/renderer/src/main.tsx');
const mock = src('src/renderer/src/mock.tsx');
ok(main.includes("import './styles-density.css'"), '真应用加载了层级样式');
ok(mock.includes("import './styles-density.css'"), '预览页加载了层级样式');
ok(mock.includes('PREVIEW_DENSITY'), '预览页默认完整，不写本机');
ok(mock.includes("QS.get('density') === 'compact'"), '预览页留了简洁态截图入口');
ok(mock.includes('<BriefFold>'), '预览页左栏同样可收起');

const css = src('src/renderer/src/styles-density.css');
ok(css.includes('.block.is-collapsed > .block-body'), '折叠规则指向 block-body');
ok(
  !css.includes(":root[data-density='full'] .brief-fold > .bf-sum"),
  '完整态保留左栏说明的收起入口，不再把标题行藏掉'
);
/*
 * 只查「文件里有没有 display: none」是假绿：同一份样式表里别处也写着它
 * （完整态藏左栏 summary 那一条），折叠规则改成 display: block 照样全绿。
 * 所以正则表达式必须锚在 .block.is-collapsed > .block-body 这一条规则里。
 */
const foldRule = /\.block\.is-collapsed > \.block-body[\s\S]{0,160}?\{([^}]*)\}/.exec(css);
ok(!!foldRule && /display:\s*none/.test(foldRule[1]), '折叠规则里真的写了 display: none');
ok(
  !!foldRule && !/display:\s*block/.test(foldRule[1]),
  '折叠态不许把正文照常显示出来',
);
ok(!css.includes("data-density='full'"), '完整态没有藏内容的专门规则');
ok(!/^\s*:root\s*\{/m.test(css), '没有冒出第二份 :root 变量定义');
for (const cls of [
  'density-bar',
  'db-k',
  'db-switch',
  'db-btn',
  'db-on',
  'db-note',
  'db-bounds',
  'db-bound',
  'bf-sum',
  'brief-fold',
  'block-fold',
  'tier-core',
  'tier-ledger',
  'is-collapsed',
]) {
  ok(css.includes(`.${cls}`), `类名 .${cls} 有样式定义`);
}

/* ─────────── 4. 端到端与文档 ─────────── */

const smokeApp = src('src/main/smoke.ts');
ok(smokeApp.includes("process.env['AL_DENSITY'] === 'compact'"), '端到端留了简洁态跑道');
ok(smokeApp.includes('[data-density="full"]'), '默认跑道点的是「完整」按钮');
ok(
  smokeApp.includes("if (!document.querySelector('.grid')) return 'no-report-yet';"),
  '切换等到报告真落屏才发生（工具条在输入区那一屏并不存在）',
);
ok(smokeApp.includes("add('DENSITY full clicked')"), '切回完整写了日志，冒烟能验');
ok(smokeApp.includes('DENSITYDOM before'), '简洁态有 DOM 读数探针');
ok(smokeApp.includes('textLen'), '探针量了收起前后正文的字数');
/* 简洁态里「分歧账」「这把尺子」是收着的：不先展开，两张整块图会静默地不产出，
   而断言只查「有没有 PHSHOT」，红得没头没脑。展开必须走界面那条路（al:reveal）。 */
ok(
  smokeApp.includes("new CustomEvent('al:reveal'") &&
    smokeApp.includes('add(`DIVREVEAL ') &&
    smokeApp.includes('add(`PHREVEAL '),
  '两张整块截图在简洁态也会先展开那一栏（走 al:reveal，不硬改属性）',
);
const smoke = src('scripts/smoke.mjs');
ok(smoke.includes('SMOKE_DENSITY'), '冒烟脚本认这条跑道');
ok(smoke.includes('AL_DENSITY'), '冒烟脚本把开关传给应用');
ok(smoke.includes('DENSITY full clicked'), '默认跑道验了「确实切回完整」');
ok(smoke.includes("jOfLine('DENSITYDOM before ')"), '简洁态断言读的是真机读数');
ok(smoke.includes('收起前后正文一个字没少'), '断言守着「收起不删内容」');

const readme = src('README.md');
ok(readme.includes('阅读层级') || readme.includes('简洁 · 核对层'), 'README 写了这一层');
ok(readme.includes('SMOKE_DENSITY=compact'), 'README 写了简洁态跑道怎么跑');
const agents = src('AGENTS.md');
ok(agents.includes('check:density'), '交接书点名了这一关');

/* ─────────── 5. 版式：窄窗口不折栏名，宽窗口不拉长正文 ─────────── */

/*
 * 取「某条选择器开头的规则体」。用 indexOf 而不是整块正则，
 * 是因为这些规则会被别的规则包住（媒体查询）或与别的选择器并列。
 */
function ruleBody(text: string, selector: string): string {
  const i = text.indexOf(selector);
  if (i < 0) return '';
  const open = text.indexOf('{', i);
  const close = open < 0 ? -1 : text.indexOf('}', open);
  return open < 0 || close < 0 ? '' : text.slice(open + 1, close);
}

const styles = src('src/renderer/src/styles.css');
/*
 * 窄窗口里真出现过「四句话看懂这份报 / 告」：标题是这一栏的坐标，断成两行就认不出来。
 * 所以标题不许折行、副标题必须能收缩去让位——两条要一起钉，只钉一条会把栏头撑破。
 */
const headT = ruleBody(styles, '.block-head .t');
ok(/white-space:\s*nowrap/.test(headT), '栏名不折行（窄窗口下也不许断成两行）');
const headS = ruleBody(styles, '.block-head .s');
ok(
  /flex:\s*1 1 auto/.test(headS) && /min-width:\s*0/.test(headS),
  '副标题去让位（能收缩，不把栏头撑破）',
);
/*
 * 版式从「宽屏才收 1240px」改成「全宽度一条 708px 读列」。
 * 起因是量出来的错位：文档头左边缘 605、报告正文 433，横向差 170px，
 * 看着像两套皮拼的。现在 .main 的每个子块都收进同一条居中列。
 *
 * 规则住在 styles-docpage.css，所以这里必须同时读那个文件——
 * 只读 styles.css 会看不到真规则，一条都不红（上一版就是这么假绿的）。
 */
const docCss = src('src/renderer/src/styles-docpage.css');
/* 去注释再判：注释里出现「max-width: 708px」只是说明文字，不该判红。
 * 反过来剥掉注释也挡住了「把规则注释掉冒充合规」这条假绿路。 */
const noComment = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
ok(!/(?<!-)max-width:\s*1240px/.test(noComment(styles)), '旧的 1240px 宽屏上限已撤销，不许留下被覆盖的死规则');
const mainCol = (noComment(docCss).match(/\.main > \*\s*\{([^}]*)\}/) ?? [])[1] ?? '';
ok(
  /width:\s*100%/.test(mainCol) &&
    /max-width:\s*var\(--page-max-width\)/.test(mainCol) &&
    /margin-inline:\s*auto/.test(mainCol),
  '主区每个子块都收在同一条 708px 居中读列（文档头与报告才从同一条左边缘起排）',
);
ok(
  /* 前面的 (?<!-) 是必须的：:root 里那句 `--page-max-width: 708px`
   * 本身就以 `max-width: 708px` 结尾，不加这个负向后顾会把变量定义自己判成写死。 */
  !/(?<!-)max-width:\s*(708|1240)px/.test(noComment(docCss) + noComment(styles)),
  '读列宽度必须走 --page-max-width 变量，不许写死 px',
);

/*
 * 连续散文的读列。708px 管的是块容器，不是行长——目录关着时正文
 * 在块里铺满，14px 字体一行仍能排五十来字，换行后找不回行首。
 * 读列用 ch：中文一字约 2ch，舒适区 25—40 字 ⇒ 50—80ch。
 * 钉「变量在舒适区」+「.passage 真用了它」，删掉或拉到极端都当场红。
 */
const measure = Number((styles.match(/--read-measure:\s*(\d+(?:\.\d+)?)ch/) ?? [])[1]);
ok(
  Number.isFinite(measure) && measure >= 50 && measure <= 80,
  `读列在舒适区 50—80ch（≈25—40 中文字），当前 ${Number.isFinite(measure) ? measure : '缺失'}ch`,
);
const passageRule = (styles.match(/\.passage\s*\{([^}]*)\}/) ?? [])[1] ?? '';
ok(
  /max-width:\s*var\(--read-measure\)/.test(passageRule),
  '正文散文 .passage 用读列变量（不是写死 px，也不是没有读列）',
);
ok(
  (styles.match(/max-width:\s*var\(--read-measure\)/g) ?? []).length === 1,
  '读列只作用在连续散文一处，不铺到 pre / 表格 / chips',
);

/*
 * 报告目录（主进程注入的独立脚本）宽度与正文补偿的等式。
 * 目录 fixed 在右侧，正文必须让出同样宽度，否则最后几个字被盖住。
 * 只钉「补偿 = 宽度 + 34（right 18 + 间隙 16）」这个关系，不钉死具体数字——
 * 目录可以再调宽，但两者必须一起动。改宽度不改补偿，或反过来，都当场红。
 */
const nav = src('src/main/report-nav.ts');
const navW = Number((nav.match(/#__alNav\{[^}]*?width:(\d+)px/) ?? [])[1]);
const navPad = Number((nav.match(/body\.al-nav-open \.main\{padding-right:(\d+)px\}/) ?? [])[1]);
ok(Number.isFinite(navW) && navW >= 204, '报告目录有宽度，且不小于原来的 204px（窄栏副标题挤作一团是体检记下的债）');
ok(
  Number.isFinite(navPad) && navPad === navW + 34,
  '正文补偿 = 目录宽度 + 34（right 18 + 间隙 16）：改宽度不改补偿会遮住正文',
  `目录 ${navW}px / 补偿 ${navPad}px`,
);
ok(
  /#__alNav \.ni\{[^}]*?font:11\.5px/.test(nav),
  '目录条目 11.5px：11px 在窄栏里偏小（体检确认项）',
);
ok(
  nav.includes('window.innerWidth < 1200') && nav.includes('fitNav();'),
  '窄窗自动收起目录，正文不再被 232px 的浮层压成一条缝',
);
ok(
  nav.includes('body.al-nav-min .main{padding-right:52px}'),
  '目录收起成竖条后，正文仍让出 52px，最后几个字不被盖住',
);

/* 截断必须配 title：字被省略号吃掉又没有 title，等于把话删了。 */
const hintRule = ruleBody(css, ":root[data-density='compact'] .exp-hint");
ok(/text-overflow:\s*ellipsis/.test(hintRule) && /white-space:\s*nowrap/.test(hintRule), '简洁态把长说明收成一行');
ok(diag.includes('title={expHint}') && diag.includes('data-exp-hint="1"'), '导出说明截断后悬停能读全');
ok(diag.includes('title={rrWhy}') && diag.includes('data-rr-why="1"'), '重读说明截断后悬停能读全');
ok(/const expHint = `[^`]*\$\{prgLine\}/.test(diag), '导出说明里的节点数是算出来的，不是写死的');

if (failed.length) {
  for (const f of failed) console.error(`✗ ${f}`);
  console.error(`\n✗ 阅读层级有 ${failed.length} 处不对（共 ${passed + failed.length} 项）`);
  console.error('  收起只许动显示；少一栏、删了 children、或默认跑道没切回完整，都比不收起更糟。');
  process.exit(1);
}
console.log(`✓ 阅读层级：${passed} 条全部通过｜只收显示不删内容、主线不收、边界三条、默认跑道仍是完整态`);
