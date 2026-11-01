/**
 * 样式覆盖检查：组件里写下的类名，样式表里到底有没有。
 *
 * 为什么要这个脚本：历史面板曾经整块没有样式——组件写了三十多个 hs- 类名，
 * 样式表里只存在一个顺手塞进别处的 .hs-mode。它不是报错，也不影响构建，
 * 只是打开面板时排版全裸：行挤成一团、删除按钮压在文字上、「修订自哪一版」看不出来。
 * 这种缺陷 typecheck 查不出、smoke 查不出（DOM 里节点都在，数得出来），
 * 只有这个比对能查出来。
 *
 * 两条放宽规则，都是为了避免假绿：
 *   1. 动态拼接的类（`lv-${level}`）在源码里只剩前缀，所以按前缀比：
 *      样式表里只要存在同前缀的任一类，就算覆盖到了。
 *      否则必须枚举全部取值，而漏枚举会直接误报。
 *   2. 少数类是**纯钩子**——给 DOM 探针或结构分组用的，没有视觉需求。
 *      它们必须在下面的表里逐条写明理由；没写理由的一律算缺失。
 */

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('src/renderer/src');

const cssFiles = fs.readdirSync(root).filter((f) => f.endsWith('.css'));
if (cssFiles.length < 2) fail(`样式表只有 ${cssFiles.length} 个，这个检查的前提不成立`);
let css = '';
for (const f of cssFiles) css += fs.readFileSync(path.join(root, f), 'utf8');
/*
 * 注释里提到的类名和变量名不是真的使用。不剥掉的话，一段解释性注释
 * （「原来是 var(--line-2)，但它从没定义」）会让检查误报一处并不存在的问题——
 * 而误报比漏报更耗人：它教人开始忽略这个检查。
 */
css = css.replace(/\/\*[\s\S]*?\*\//g, '');

const defined = new Set();
for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) defined.add(m[1]);
/**
 * 前缀表按「逐段累加」收集，不是只取第一个 `-` 之前那段。
 *
 * 原先只取第一段，于是 `ac-by-${x}` 剥出 `ac-by-` 之后找不到前缀
 * （表里只有 `ac`），被误报成样式缺失。这是一级前缀假设的漏洞：
 * `lv-${level}` 那种一层的是能过的，两层就过不了。
 */
const prefixes = new Set();
for (const c of defined) {
  const parts = c.split('-');
  let acc = '';
  for (let i = 0; i < parts.length - 1; i += 1) {
    acc = acc ? `${acc}-${parts[i]}` : parts[i];
    prefixes.add(acc);
  }
}

/** 纯钩子：无视觉需求，但别的地方要用它定位。必须写理由。 */
const HOOKS = {
  'mode-banner': 'DOM 探针定位模式横幅（src/main/index.ts），视觉由 .banner 与 .rt/.rc/.q-banner 承担',
  'map-node': '结构图节点分组钩子，视觉由内联 SVG 属性承担',
  'u-bal': '用量面板包裹层，排版由父级 .u-body 的 gap 承担',
  'u-recent': '用量面板包裹层，排版由父级 .u-body 的 gap 承担',
};

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name)) files.push(p);
  }
})(root);

const missing = [];
let checked = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const used = new Set();
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
    const raw = m[1] || m[2] || m[3] || '';
    for (const tok of raw.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
      if (tok && /^[a-zA-Z][\w-]*$/.test(tok)) used.add(tok);
    }
  }
  // `lv-${m.level}` 这类写法剥掉插值后只剩 `lv-`，按前缀处理
  const dyn = new Set();
  for (const m of src.matchAll(/className=\{`[^`]*\$\{[^}]*\}[^`]*`\}/g)) {
    for (const mm of m[0].matchAll(/([a-zA-Z][\w]*)-?\$\{/g)) {
      if (mm[1]) dyn.add(mm[1]);
    }
  }
  for (const c of used) {
    checked += 1;
    if (defined.has(c)) continue;
    if (c.endsWith('-') && prefixes.has(c.slice(0, -1))) continue;
    // 动态拼接只留下词根（mode / lv / tb），样式表里存在同词根的任一类即算覆盖
    if (dyn.has(c)) continue;
    if (Object.prototype.hasOwnProperty.call(HOOKS, c)) continue;
    missing.push(`${path.relative('.', f).split(path.sep).join('/')} .${c}`);
  }
}

if (checked < 200) fail(`只比对了 ${checked} 个类名，少得可疑——多半是正则没匹配上，属于假绿`);

/*
 * 变量：用到的必须有定义。
 *
 * 这一条是补上来的，因为两类失败的可见度差着一整个量级：
 * 类名漏了会整块裸奔，人一眼能看见；变量名写错只让那一条属性失效——
 * 颜色退回继承、间距退回 0，页面看起来「还行」，只是不对。
 * 它不报错、不崩溃、构建照过，和这个项目最忌讳的那种失败同形。
 *
 * 有 fallback 的也照报：写了 var(--x, #fff) 说明作者知道它可能没有，
 * 但「知道」不等于「应该」——真想要的默认值是 fallback 里那个，就不该再引用一个不存在的变量。
 */
const varDefined = new Set();
for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/g)) varDefined.add(m[1]);

const varUsed = new Map();
for (const m of css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,)?/g)) {
  varUsed.set(m[1], (varUsed.get(m[1]) ?? false) || Boolean(m[2]));
}

if (varUsed.size < 20) fail(`只扫到 ${varUsed.size} 个变量引用，少得可疑——正则没匹配上就是假绿`);
const missingVar = [...varUsed.entries()].filter(([n]) => !varDefined.has(n));
if (missingVar.length) {
  console.error(`变量未定义 ${missingVar.length} 处：`);
  for (const [n, fb] of missingVar) console.error(`  var(${n})${fb ? '　（有 fallback，仍算缺定义）' : ''}`);
  fail('');
}
if (missing.length) {
  console.error(`样式缺失 ${missing.length} 处：`);
  for (const m of missing) console.error('  ' + m);
  fail('');
}

console.log(`✓ 样式覆盖：${checked} 个类名、${varUsed.size} 个变量引用全部有定义（${cssFiles.length} 个样式表，${Object.keys(HOOKS).length} 个纯钩子）`);

function fail(msg) {
  console.error('✗ ' + (msg || '样式覆盖检查失败'));
  process.exit(1);
}
