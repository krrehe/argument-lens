/**
 * 架构检查：把「只写在文档里的边界」变成会红的断言。
 *
 * 为什么要有这一关：AGENTS.md 写着「src/shared/ 里的东西不许 import electron」，
 * 可那只是一句话。今天量出来 40 个 shared 文件一条违规都没有，但明天有人加一行
 * `import { app } from 'electron'`，34 项 verify 照样全绿——而那些纯函数从此再也不能
 * 在纯 node 里单测，检查脚本会在 require 阶段就崩。**干净的边界没人守着，一定会烂。**
 *
 * 这一关只读源码，不跑应用、不联网。每条断言都对应一次真实的架构决定，
 * 且都能被「故意改坏一处」单独点名（见 scripts/.out/prove-arch.mjs）。
 *
 * 边界（写在前面，免得被当成全面检查）：只认静态 import / require 的字面量路径；
 * 认不出的动态拼路径、`import type` 造成的类型环不算违规。它守的是进程边界与
 * 纯函数层，不是包依赖图。
 */
import fs from 'node:fs';
import path from 'node:path';

const fails = [];
let passed = 0;
function ok(cond, name, detail = '') {
  if (cond) passed += 1;
  else fails.push(`${name}${detail ? '：' + detail : ''}`);
}

const read = (p) => fs.readFileSync(p, 'utf8');
function walk(dir, filter) {
  const out = [];
  (function rec(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) rec(p);
      else if (filter(e.name)) out.push(p.replace(/\\/g, '/'));
    }
  })(dir);
  return out;
}
const tsFiles = walk('src', (n) => /\.tsx?$/.test(n));
const layer = (p) => {
  if (p.startsWith('src/shared/')) return 'shared';
  if (p.startsWith('src/main/')) return 'main';
  if (p.startsWith('src/preload/')) return 'preload';
  if (p.startsWith('src/renderer/')) return 'renderer';
  return 'other';
};
/** 所有 import / require / 动态 import 的字面量路径（含 type-only，单独标出）。 */
function specsOf(s) {
  const out = [];
  for (const m of s.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)) {
    out.push({ spec: m[1], typeOnly: false });
  }
  return out;
}
const filesOf = (l) => tsFiles.filter((p) => layer(p) === l);

/* ─────────── 0. 这一关自己有没有真的扫到东西 ─────────── */
/* 少了这几条，正则坏了、目录空了都会「全部通过」——那是最坏的一种绿。 */
const allSpecs = tsFiles.flatMap((p) => specsOf(read(p)));
ok(tsFiles.length >= 80, '扫到的 TS/TSX 文件数够多', String(tsFiles.length));
ok(filesOf('shared').length >= 30, 'shared 层文件数够多', String(filesOf('shared').length));
ok(allSpecs.length >= 200, '扫到的 import 总数够多', String(allSpecs.length));

/* ─────────── 1. 纯函数层的进程边界（AGENTS.md 第 181 行） ─────────── */
const electronInShared = [];
const hostInShared = [];
for (const p of filesOf('shared')) {
  for (const { spec } of specsOf(read(p))) {
    if (/^electron(\/|$)/.test(spec)) electronInShared.push(`${p} → ${spec}`);
    else if (/^node:/.test(spec) || /\/(main|renderer|preload)\//.test(spec)) hostInShared.push(`${p} → ${spec}`);
  }
}
ok(electronInShared.length === 0, 'shared 不 import electron', electronInShared.join(' | '));
ok(hostInShared.length === 0, 'shared 不碰 node: / main / renderer / preload', hostInShared.join(' | '));

/* ─────────── 2. 渲染层与预加载层不直接碰主进程 ─────────── */
const rendererToMain = [];
for (const l of ['renderer', 'preload']) {
  for (const p of filesOf(l)) {
    for (const { spec } of specsOf(read(p))) {
      if (/\/(main)\//.test(spec) || /^src\/main\//.test(spec)) rendererToMain.push(`${p} → ${spec}`);
    }
  }
}
ok(rendererToMain.length === 0, 'renderer 与 preload 不直接 import main', rendererToMain.join(' | '));

/* ─────────── 3. 主进程不反向依赖渲染层 ─────────── */
const mainToRenderer = [];
for (const p of filesOf('main')) {
  for (const { spec } of specsOf(read(p))) {
    if (/\/(renderer)\//.test(spec) || /^src\/renderer\//.test(spec)) mainToRenderer.push(`${p} → ${spec}`);
  }
}
ok(mainToRenderer.length === 0, 'main 不反向 import renderer', mainToRenderer.join(' | '));

/* ─────────── 4. 值 import 不许成环 ─────────── */
const resolve = (from, spec) => {
  let p;
  if (spec.startsWith('@shared/')) p = 'src/shared/' + spec.slice(8);
  else if (spec.startsWith('.')) p = path.join(path.dirname(from), spec).replace(/\\/g, '/');
  else return null;
  for (const c of [p + '.ts', p + '.tsx', p + '/index.ts', p + '/index.tsx']) {
    if (fs.existsSync(c)) return c;
  }
  return null;
};
const graph = new Map();
for (const p of tsFiles) {
  const deps = [];
  const s = read(p);
  for (const m of s.matchAll(/^\s*import\s+(?!type)([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/gm)) {
    if (/^\s*type\s/.test(m[1])) continue;
    const t = resolve(p, m[2]);
    if (t) deps.push(t);
  }
  graph.set(p, deps);
}
const cycles = [];
const state = new Map();
const stack = [];
(function () {
  function dfs(n) {
    if (state.get(n) === 1) {
      cycles.push(stack.slice(stack.indexOf(n)).concat(n).join(' → '));
      return;
    }
    if (state.get(n) === 2) return;
    state.set(n, 1);
    stack.push(n);
    for (const d of graph.get(n) || []) dfs(d);
    stack.pop();
    state.set(n, 2);
  }
  for (const p of tsFiles) dfs(p);
})();
ok(cycles.length === 0, '值 import 不成环', cycles.join(' | '));

/* ─────────── 5. 一个约定只留一个家 ─────────── */
/* 「28」原来在 agreement 与 portfolio 各写一份，注释还互相指着对方说「与那一栏同长」。 */
const constDefs = new Map();
for (const p of filesOf('shared')) {
  for (const m of read(p).matchAll(/^export const ([A-Z_][A-Z0-9_]*)\s*=/gm)) {
    if (!constDefs.has(m[1])) constDefs.set(m[1], []);
    constDefs.get(m[1]).push(p);
  }
}
const dupConsts = [...constDefs.entries()].filter(([, ps]) => ps.length > 1);
ok(dupConsts.length === 0, 'shared 里同名 export const 只有一个家', dupConsts.map(([n, ps]) => `${n}: ${ps.join(' + ')}`).join(' | '));
ok(constDefs.size >= 12, '常量定义扫得够多', String(constDefs.size));
ok(constDefs.get('EXCERPT_LEN')?.[0] === 'src/shared/excerpt.ts', '摘录长度住在 @shared/excerpt', String(constDefs.get('EXCERPT_LEN')));

/* ─────────── 6. 样式变量只有一个主题源 ─────────── */
const cssFiles = walk('src/renderer/src', (n) => n.endsWith('.css'));
const rootDefs = cssFiles.filter((p) => /^\s*:root\s*\{/m.test(read(p)));
ok(cssFiles.length >= 8, '样式表数量够多', String(cssFiles.length));
ok(rootDefs.length === 1, 'CSS :root 只在一处定义', rootDefs.join(' + '));

/* ─────────── 7. 界面组件「一人一块」，不许整屏回到巨石里 ─────────── */
const compDir = 'src/renderer/src/components';
const compFiles = fs.readdirSync(compDir).filter((n) => /\.tsx$/.test(n)).map((n) => `${compDir}/${n}`);
const componentCount = (p) => (read(p).match(/^(?:export )?function [A-Z]/gm) || []).length;
const screens = [
  { fn: 'RereadScreen', file: `${compDir}/RereadScreen.tsx`, probe: 'data-reread' },
  { fn: 'RescaleScreen', file: `${compDir}/RescaleScreen.tsx`, probe: 'data-rescale' },
  { fn: 'ConditionScreen', file: `${compDir}/ConditionScreen.tsx`, probe: 'data-conditions' },
];
ok(compFiles.length >= 20, '组件目录文件数够多', String(compFiles.length));
for (const s of screens) {
  ok(fs.existsSync(s.file) && new RegExp(`export function ${s.fn}`).test(read(s.file)), `${s.fn} 住在自己的文件里`, s.file);
  ok(new RegExp(s.probe + '(?![-\\w])').test(read(s.file)), `${s.file} 里有整屏根探针`, s.probe);
}
const DIAG = `${compDir}/Diagnosis.tsx`;
const diagSrc = read(DIAG);
const probesBack = screens.filter((s) => new RegExp(s.probe + '(?![-\\w])').test(diagSrc)).map((s) => s.probe);
ok(probesBack.length === 0, '整屏根探针没有回到 Diagnosis.tsx', probesBack.join(' | '));
/* 冻结线不是目标：只允许继续拆，不允许继续往巨石里塞。 */
const diagCount = componentCount(DIAG);
const fat = compFiles.filter((p) => p !== DIAG && componentCount(p) > 10).map((p) => `${p}=${componentCount(p)}`);
ok(diagCount <= 18, 'Diagnosis.tsx 的组件数冻结在 18 以内', String(diagCount));
ok(fat.length === 0, '其它组件文件不超过 10 个组件', fat.join(' | '));

/* ─────────── 输出 ─────────── */
if (fails.length) {
  console.error(`✗ 架构检查 ${fails.length} 处不满足：`);
  for (const f of fails) console.error('  ' + f);
  process.exit(1);
}
console.log(`✓ 架构检查：${passed} 条全部通过（${tsFiles.length} 个源码文件、${allSpecs.length} 条 import、${compFiles.length} 个组件）`);
