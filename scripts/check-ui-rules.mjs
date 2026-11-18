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
 *   8. 正文行宽有上限，说明条不再是一整段长文。
 *
 * 边界（必须说清，否则会被当成它管不了的保证）：
 *  - 它读的是源码里的 CSS 文本与模板字符串，不是浏览器里的实际渲染。
 *    真正挤压、错位、字被裁，只有 CDP 量或人眼看图才发现得了。
 *  - 对比度按十六进制字面值算，算不到 rgba、渐变、图片背景上的文字。
 *  - 「实心主按钮只有一个」只按类名与背景色判断，判断不了人眼觉得哪个更显眼。
 *
 * 跑法：npm run check:ui-rules
 */
import { readFileSync } from 'node:fs';
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

/* ── 2. 字号阶梯 ───────────────────────────────────────────── */
const sizes = [...new Set([...html.matchAll(/font-size:\s*([0-9.]+)px/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
const ALLOWED_SIZE = [10, 11, 12, 22];
const extraSize = sizes.filter((s) => !ALLOWED_SIZE.includes(s));
ck(extraSize.length === 0, `字号多出 ${extraSize.join('、')}px：只留 ${ALLOWED_SIZE.join(' / ')} 四档（层级靠字重与颜色，不靠字号）`);
ck(Math.min(...sizes) >= 10, `最小的字是 ${Math.min(...sizes)}px，10px 以下在 1x 屏上读不清`);

/* ── 3. 圆角 ───────────────────────────────────────────────── */
const radii = [...html.matchAll(/border-radius:\s*([0-9.]+)(px|%)/g)].map((m) => m[1] + m[2]);
const uniqRadii = [...new Set(radii)].sort();
const oddRadius = uniqRadii.filter((r) => !['1px', '3px', '6px', '50%'].includes(r));
ck(oddRadius.length === 0, `圆角还有 ${oddRadius.join('、')}：控制件统一 3px、大块 6px，混着来就是「AI 手笔」`);
ck(uniqRadii.includes('3px') && uniqRadii.includes('6px'), '圆角两档（3px / 6px）没有同时出现，收敛没做完整');
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
console.log(`✓ 界面规则：对比度、字号、圆角、状态形状、主按钮、隔行底色、空状态、行宽 ${n} 项`);
