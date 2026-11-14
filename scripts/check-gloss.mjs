/**
 * 工作台术语表防腐烂检查（进 verify）。
 *
 * 三件事，都是「静默失效」型的：
 *  1. glossary.ts 改了字，工作台里那份生成的副本没重跑 → 两处人话不一致；
 *  2. 工作台的字段映射引用了一个不存在的术语 key → 界面上解释空白，且不报错；
 *  3. 术语文字里混进 `</script` → 内联 JSON 提前闭合，整页工作台白屏。
 *
 * 跑法：npm run check:gloss
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildGloss, BEGIN, END } from './gen-workbench-gloss.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const HTML = path.join(ROOT, 'src/renderer/public/workbench.html');
const html = fs.readFileSync(HTML, 'utf8');
const bad = [];
let n = 0;
const ck = (ok, msg) => {
  n += 1;
  if (!ok) bad.push(msg);
};

const a = html.indexOf(BEGIN);
const b = html.indexOf(END);
ck(a >= 0 && b > a, 'workbench.html 缺 GLOSS_BEGIN / GLOSS_END 标记');

let embedded = null;
if (a >= 0 && b > a) {
  const m = html.slice(a, b).match(/<script id="gloss" type="application\/json">([\s\S]*?)<\/script>/);
  ck(!!m, '标记之间找不到 <script id="gloss"> 数据块');
  if (m) {
    try {
      embedded = JSON.parse(m[1]);
    } catch (e) {
      ck(false, `内联术语表不是合法 JSON：${String(e)}`);
    }
  }
  ck(!/<\/script/i.test(m?.[1] ?? ''), '术语文字里出现了 </script，会提前闭合脚本标签');
}

const expected = JSON.parse(buildGloss());
ck(embedded?.v === 1, '内联术语表缺版本号');
ck(embedded?.n === expected.n, `条数对不上：glossary.ts 有 ${expected.n} 条，工作台里是 ${embedded?.n ?? '?'} 条`);
if (embedded?.terms && expected.terms) {
  const keys = new Set(Object.keys(expected.terms));
  const drift = [...keys].filter((k) => JSON.stringify(embedded.terms[k]) !== JSON.stringify(expected.terms[k]));
  ck(drift.length === 0, `术语文字与 glossary.ts 不一致（${drift.slice(0, 4).join(', ')}）跑 npm run gloss:sync`);
  const extra = Object.keys(embedded.terms).filter((k) => !keys.has(k));
  ck(extra.length === 0, `工作台里有多余术语：${extra.slice(0, 4).join(', ')}`);
}

/* 字段映射里的 k:'xxx' 必须真能查到术语，否则解释那一格是空的。 */
const refs = [...html.matchAll(/\bk:\s*'([a-z][\w-]*)'/g)].map((m) => m[1]);
const keys = new Set(Object.keys(expected.terms));
const missing = [...new Set(refs)].filter((k) => !keys.has(k));
ck(refs.length > 10, `字段映射里只找到 ${refs.length} 处术语引用，词典可能没接上`);
ck(missing.length === 0, `字段映射引用了不存在的术语 key：${missing.join(', ')}`);

/* 生成物必须真的被渲染层读走，而不是摆在 HTML 里充数。 */
ck(/getElementById\('gloss'\)/.test(html), '渲染层没有读取内联术语表');
ck(/id="gloss-source"/.test(html), '检查器里没有标明人话来自主程序术语表');
ck(/id="gloss-raw"/.test(html), '原始 JSON 没有保留可展开的取证入口');

if (bad.length) {
  for (const x of bad) console.error(`  ✗ ${x}`);
  console.error(`\n✗ 工作台术语表 ${bad.length}/${n} 项不合格`);
  process.exit(1);
}
console.log(`✓ 工作台术语表与 glossary.ts 一致 ${n} 项（${expected.n} 条术语）`);
