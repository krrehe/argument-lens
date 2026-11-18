/**
 * 回看台（工作台）左栏与工具条的防腐烂检查（进 verify）。
 *
 * 为什么需要：工作台是一整块 1300 多行的单文件页面，`check:css` 只看 TSX 组件、
 * `check:arch` 只看 `src/**` 的 import，两边都扫不到它。于是它坏起来是无声的：
 * 存档行退回「只有 8 位 id」也照样渲染、省略号少了 `min-width:0` 也只是不生效、
 * 工具条被挤掉两个元素更不会报错——只有人眼截图才看得见。
 *
 * 这里守的是两处已经被人眼确认过的欠账（2026-11-18）：
 *  1. 存档行先给能认出来的字：原文摘录必须是可见文字，不是只躺在 title 里；
 *     第二行给时间 / 模式 / 档位——本机 104 份里 89 份是同一段原文，靠摘录也分不开，
 *     能分开它们的只有「什么时候、哪个模式、判成什么」。
 *  2. 窄窗口不许把工具条挤掉：`1100px` 宽时实测「这份报告」被压成 10px 宽三行、
 *     快捷键提示被推到可视区外，两者都被 34px 的固定行高裁掉，且没有任何报错。
 *
 * 跑法：npm run check:workbench
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const html = readFileSync(path.join(ROOT, 'src/renderer/public/workbench.html'), 'utf8');

const bad = [];
let n = 0;
const ck = (ok, msg) => {
  n += 1;
  if (!ok) bad.push(msg);
};
const grab = (re, what) => {
  const m = html.match(re);
  ck(!!m, `找不到${what}`);
  return m;
};
const cssBlock = (sel, what) => {
  const m = html.match(new RegExp(`\\${'{'}?${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  ck(!!m, `样式表里找不到 ${sel} 这条规则（${what}）`);
  return m?.[1] ?? '';
};

/* ── 1. 存档行：摘录必须是可见文字 ─────────────────────────── */
const rowTpl = grab(/return `<div class="ti arc[\s\S]*?<\/div>`;/, '存档行的模板');
const tplText = rowTpl?.[0] ?? '';

ck(/<span class="arcx">\$\{esc\(line\)\}<\/span>/.test(tplText), '存档行没有把摘录渲染成可见文字（arcx 里必须是 esc(line)）');
ck(!/class="arcx">\$\{esc\(a\.id\.slice/.test(tplText), '存档行又把 id 放回第一行了——id 认不出 89 份同一段原文的报告');

const lineDef = grab(/const line=!ex\?'[^']*':\(ex\.length>(\d+)\?ex\.slice\(0,\1\)\+'…':ex\);/, '摘录截断那一行');
const cap = Number(lineDef?.[1] ?? 0);
ck(cap >= 10 && cap <= 24, `摘录截断在 ${cap} 字，超出 10—24 的可读区间（236px 栏一行约 14—16 字）`);
ck(/const ex=String\(a\.excerpt\|\|''\)\.replace\(\/\\s\+\/g,' '\)\.trim\(\)/.test(html), '摘录没有先折空白再 trim——换行会让行高忽高忽低');
ck(/没有原文摘录/.test(tplText), '没有摘录的旧档没有明写「没有原文摘录」，会留下一行空白');
ck(/没有原文摘录/.test(html.match(/const line=!ex\?'([^']*)'/)?.[1] ?? ''), '「没有原文摘录」不是从 line 这一支出来的');

/* ── 2. 第二行：时间 / 模式 / 档位，三样都要 ───────────────── */
const meta = tplText.match(/<span class="arcmeta">([\s\S]*?)<\/span>/)?.[1] ?? '';
ck(/fmtAt\(a\.at\)/.test(meta), '存档行第二行没有时间——同文复跑的几份只靠摘录分不开');
ck(/a\.mode/.test(meta), '存档行第二行没有模式');
ck(/VZ\[a\.level\]/.test(meta), '存档行第二行没有档位中文（必须走 VZ，不许另写一份翻译）');
ck(/esc\(fmtAt\(a\.at\)\)[\s\S]*esc\(a\.mode\)[\s\S]*VZ\[a\.level\]/.test(meta), '第二行的顺序变了：时间 → 模式 → 档位');
ck(new RegExp(`esc\\(fmtAt\\(a\\.at\\)\\)`).test(meta) && !/arcmeta">\$\{esc\(a\.id/.test(meta), '第二行又把 id 放回来了——三样识别信息会被挤掉');

/* ── 3. 省略号要真生效（三件套 + min-width:0） ─────────────── */
const arcx = cssBlock('.ti.arc .arcx', '摘录那一行');
ck(/white-space:nowrap/.test(arcx), '.arcx 少了 white-space:nowrap，摘录会折行');
ck(/overflow:hidden/.test(arcx), '.arcx 少了 overflow:hidden，省略号不会出现');
ck(/text-overflow:ellipsis/.test(arcx), '.arcx 少了 text-overflow:ellipsis');
const main = cssBlock('.ti.arc .arcmain', '两行文字的容器');
ck(/min-width:0/.test(main), '.arcmain 少了 min-width:0——flex 子项不会收缩，省略号静默失效');
const row = cssBlock('.ti.arc', '两行存档行');
const mh = Number(row.match(/min-height:(\d+)px/)?.[1] ?? 0);
ck(mh >= 32, `存档行 min-height 是 ${mh}px，两行文字（11px + 9.5px）放不下`);
ck(/align-items:flex-start/.test(row), '存档行没有 align-items:flex-start，圆点会掉到两行中间');

/* ── 4. 过滤还能按摘录找 ───────────────────────────────────── */
ck(/const shown=arcAll\.filter\([^;]*a\.excerpt\|\|''/.test(html), '过滤不再匹配原文摘录——搜索框的占位还写着「原文片段」');
ck(/placeholder="过滤存档：id \/ 模式 \/ 原文片段"/.test(html), '过滤框的占位与实现不一致');

/* ── 5. 工具条：窄窗口必须换行，不许裁 ─────────────────────── */
const tb = cssBlock('.toolbar', '工具条');
ck(/flex-wrap:wrap/.test(tb), '工具条不允许换行——1100px 宽时会把元素压成竖排或推出可视区');
const app = cssBlock('.app', '整体网格');
ck(/grid-template-rows:28px auto auto minmax\(0,1fr\) 24px/.test(app), '整体网格第二行不是 auto：工具条换行后会被 34px 的固定行高裁掉');
ck(/\.app\{[\s\S]*?height:100vh/.test(html), '整体网格不再占满视口高度');
const lbl = cssBlock('.toolbar .lbl', '「这份报告」那个标签');
ck(/white-space:nowrap/.test(lbl), '「这份报告」没有 nowrap，窄窗口会变竖排');
ck(/<span class="lbl">这份报告<\/span>/.test(html), '「这份报告」回到了行内样式裸 span（没有 class 就没法被上面那条规则管住）');

/* ── 6. 行的点击与取证入口还在 ─────────────────────────────── */
ck(/querySelectorAll\('\[data-arc\]'\)\.forEach\([^)]*=>[^;]*openArchive/.test(html), '存档行不再可点开（data-arc 的处理器没了）');
ck(/title="\$\{esc\(a\.id\)\}[^"]*\\?\$\{esc\(ex\|\|'没有原文摘录'\)\}/.test(tplText), '悬停提示里没有完整摘录与 id——省略掉的字就没处取证了');

if (bad.length) {
  for (const x of bad) console.error(`  ✗ ${x}`);
  console.error(`\n✗ 回看台左栏与工具条 ${bad.length}/${n} 项不合格`);
  process.exit(1);
}
console.log(`✓ 回看台：存档行按摘录认、窄窗工具条不裁 ${n} 项`);
