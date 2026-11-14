/**
 * 把主程序术语表搬进工作台静态页。
 *
 * 为什么是「生成」而不是「再抄一份」：工作台是 file:// 下跑的独立 HTML，
 * import 不了 src/renderer/src/glossary.ts；而回看台偏偏满屏都是学科黑话
 * （burden / undermining / weakened），读者在这里卡住的时间最长。
 * 手工抄一遍，改天 glossary.ts 改了字，两处就会说成两件事——这个仓库里
 * 已经有好几个检查专门防这种漂移，这里不例外。
 *
 * 所以：glossary.ts 是唯一的人话来源，本脚本只做提取与序列化，
 * HTML 里的 <script id="gloss"> 是生成物，check-gloss.mjs 守住它不过期。
 *
 * 跑法：node scripts/gen-workbench-gloss.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src/renderer/src/glossary.ts');
const HTML = path.join(ROOT, 'src/renderer/public/workbench.html');
export const BEGIN = '<!-- GLOSS_BEGIN 由 scripts/gen-workbench-gloss.mjs 生成，勿手改 -->';
export const END = '<!-- GLOSS_END -->';

/** 从一个 `k: '...'` 的对象块里取一个字符串字段。中文里的引号是「」，不会撞 ASCII 单引号。 */
function str(block, key) {
  const m = block.match(new RegExp(`${key}:\\s*'((?:[^'\\\\]|\\\\.)*)'`));
  return m ? m[1].replace(/\\'/g, "'") : '';
}

/** 返回紧凑的术语 JSON 字符串；结构与 glossary.ts 的 G 数组一一对应。 */
export function buildGloss(source = fs.readFileSync(SRC, 'utf8')) {
  const body = source.slice(0, source.indexOf('export const GLOSSARY_LIST'));
  const blocks = body.match(/\{\s*\n\s*k:\s*'[^']+'[\s\S]*?\n\s*\},/g) || [];
  const terms = {};
  for (const b of blocks) {
    const k = str(b, 'k');
    const term = str(b, 'term');
    const plain = str(b, 'plain');
    if (!k || !term || !plain) throw new Error(`术语表里有一条缺 k/term/plain：${b.slice(0, 90)}`);
    if (terms[k]) throw new Error(`术语 key 重复：${k}`);
    terms[k] = [term, plain, str(b, 'more'), str(b, 'eg')];
  }
  const count = Object.keys(terms).length;
  if (count < 30) throw new Error(`只提取到 ${count} 条术语，glossary.ts 的结构可能变了，先别生成`);
  return JSON.stringify({ v: 1, n: count, terms });
}

/** 幂等替换两个标记之间的内容；缺标记直接报错，不猜插入点。 */
export function inject(html, json) {
  const a = html.indexOf(BEGIN);
  const b = html.indexOf(END);
  if (a < 0 || b < 0 || b < a) throw new Error('workbench.html 里找不到 GLOSS_BEGIN / GLOSS_END 标记');
  const block = `<script id="gloss" type="application/json">${json}</script>`;
  return html.slice(0, a) + BEGIN + '\n' + block + '\n' + END + html.slice(b + END.length);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const json = buildGloss();
  const html = fs.readFileSync(HTML, 'utf8');
  const next = inject(html, json);
  if (next !== html) fs.writeFileSync(HTML, next);
  console.log(`✓ 术语表已同步：${JSON.parse(json).n} 条 → src/renderer/public/workbench.html`);
}
