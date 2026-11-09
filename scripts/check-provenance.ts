/**
 * 「来源账」的断言：让「模型给出的判断」与「本地复算」在界面上分得开。
 *
 * 这一块最容易坏在几种不报错的地方：
 *   1. 判定点口径悄悄少了检查项或反驳，界面上的数就和 audit:provenance 对不上；
 *   2. 某一类本地复算被写死成 0，样本上恰好也是 0 时整条断言恒真；
 *   3. 界面另写一句抬头，慢慢与纯函数的口径说成两件事；
 *   4. 抬头把「判定在本地」之类的旧宣称又写回来——第 50 轮刚修掉；
 *   5. 组件只剩 import、样式没引入、预览入口没挂，纯函数绿着却一个字看不见。
 *
 * 防恒真写在样本里：判定点必须 > 2，本地四类里至少两类 > 0，
 * 否则「数得对」在空样本上怎么改都成立。
 *
 * 跑法：npm run check:provenance
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { provenanceOf, SOURCE_HEADLINE, SOURCE_LABEL, SOURCE_NOTE } from '@shared/provenance';
import { rewriteOf } from '@shared/rewrite';
import { skeletonOf } from '@shared/skeleton';
import { toneAudit } from '@shared/modal';
import type { Diagnosis } from '@shared/types';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}

const src = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const norm = (s: string) => String(s ?? '').replace(/[\s\u3000]/g, '');

/* ─────────── 样本：仓库里冻住的一份完整报告，不是本机存档 ─────────── */

const d: Diagnosis = JSON.parse(src('scripts/fixtures/replay/mvxedky1-anvqj9.json'));
const snapshot = JSON.stringify(d);
const claims = [d.conclusion, ...(d.premises || []), ...(d.intermediate || [])].filter(Boolean);

const p = provenanceOf(d);
ok(JSON.stringify(d) === snapshot, '算一遍不改报告（只读）');

/* ─────────── 判定点：独立实算，与 audit:provenance 同口径 ─────────── */

let want = 2; // 评级档位 + 被否证的是谁
for (const c of claims) {
  if (c.acceptability) want++;
  if (c.burden) want++;
}
for (const k of d.checks || []) if (k && k.answer) want++;
for (const rf of d.refutations || []) {
  if (rf && rf.confidence) want++;
  if (rf && rf.burdenAfter) want++;
}
if (d.conclusion && typeof d.conclusion.modalOverreach === 'boolean') want++;

ok(want > 2, '样本非平凡：判定点不止两处（否则口径断言恒真）', String(want));
ok(p.modelPoints === want, '判定点处数与 audit:provenance 同口径', `${p.modelPoints} / ${want}`);
ok(p.modelPoints > p.localPoints, '这份报告里模型判定点多于本地复算处数', `${p.modelPoints} / ${p.localPoints}`);

/* ─────────── 本地四类：逐类独立复算，不拿 0 凑 ─────────── */

const byKey = Object.fromEntries(p.localRows.map((r) => [r.key, r]));
ok(p.localRows.length === 4 && Object.keys(byKey).length === 4, '本地复算恰好四类，键不重复');
ok(p.localRows.filter((r) => r.count > 0).length >= 2, '样本上至少两类非零（否则写死 0 也绿）', JSON.stringify(p.localRows.map((r) => r.count)));
ok(p.localRows.every((r) => r.from === 'local'), '四类都标成「本地复算」，没有混进模型判定');
ok(byKey.rewrite?.count === claims.filter((c) => rewriteOf(c)?.kind === 'fragments').length, '逐字比处数独立复算', String(byKey.rewrite?.count));
ok(byKey.skeleton?.count === skeletonOf(d).gaps.filter((g) => g.from === 'local').length, '骨架缺口处数独立复算', String(byKey.skeleton?.count));
ok(byKey.tone?.count === toneAudit(d).diffs.length, '结论口气处数独立复算', String(byKey.tone?.count));
ok(
  byKey.quote?.count === claims.filter((c) => c.quote && norm(d.passage || '').includes(norm(c.quote))).length,
  '引文定位处数独立复算',
  String(byKey.quote?.count)
);
ok(p.localPoints === p.localRows.reduce((n, r) => n + r.count, 0), '本地总处数等于四类之和');

/* ─────────── 措辞：一个家，且不许把旧宣称写回来 ─────────── */

ok(p.headline === SOURCE_HEADLINE && p.note === SOURCE_NOTE, '抬头与边界逐字取自常量');
ok(SOURCE_HEADLINE.includes('由模型写出') && SOURCE_HEADLINE.includes('不改判定'), '抬头明说判断来自模型、本地不改判定');
for (const w of ['评级', '可接受度', '举证责任', '检查项答案', '反驳']) {
  ok(SOURCE_HEADLINE.includes(w), `抬头点名「${w}」这一类判定来自模型`);
}
const OLD_CLAIMS = /判定在本地|判定全在本地|全部本地|本地独立判定|判定由软件给出|本地给出判定/;
ok(!OLD_CLAIMS.test(SOURCE_HEADLINE + SOURCE_NOTE), '旧宣称「判定在本地」不许写回来');
ok(!/建议|应该|一定能|最好是|更可靠/.test(SOURCE_HEADLINE + SOURCE_NOTE), '这一层不写劝告，也不替报告背书');
ok(SOURCE_LABEL.model.includes('模型') && SOURCE_LABEL.local.includes('本地'), '两类标签各自点名来源');

/* ─────────── 界面：真的挂上了，且文字来自纯函数 ─────────── */

const sb = src('src/renderer/src/components/SourceBar.tsx');
const diag = src('src/renderer/src/components/Diagnosis.tsx');
const main = src('src/renderer/src/main.tsx');
const mock = src('src/renderer/src/mock.tsx');
const css = src('src/renderer/src/styles-source.css');

ok(/import \{ SourceBar \} from '\.\/SourceBar';/.test(diag), '报告主体 import 了来源条');
ok(/<SourceBar d=\{d\} \/>/.test(diag), '来源条真的挂在报告主体上（不是只剩 import）');
ok(sb.includes('provenanceOf(d)'), '组件调用来源分类纯函数');
ok(/\{p\.headline\}/.test(sb) && /\{p\.note\}/.test(sb), '抬头与边界来自纯函数返回值');
ok(!sb.includes(SOURCE_HEADLINE) && !sb.includes(SOURCE_NOTE), '界面不另写一份抬头／边界');
ok(/data-source-bar/.test(sb) && /data-source-headline/.test(sb), '来源条与抬头有 DOM 探针');
ok(/data-source-toggle/.test(sb) && /data-source-list/.test(sb), '展开按钮与清单都在');
ok(/data-source-row=\{r\.key\}/.test(sb), '清单每行带可点名的键');
ok(/SOURCE_LABEL\[r\.from\]/.test(sb), '来源标签取自常量，不另写词');
ok(/data-source-model-count=\{p\.modelPoints\}/.test(sb), '模型判定点数来自实算，不是写死的');
ok(!OLD_CLAIMS.test(sb), '组件里不许出现「判定在本地」这类旧宣称');
ok(main.includes('styles-source.css') && mock.includes('styles-source.css'), '真应用与预览页都引入样式表');
ok(/\.src-bar/.test(css) && /\.src-list/.test(css) && /\.src-note/.test(css), '样式表里有来源条、清单与边界的样式');
ok(/QS\.get\('source'\)/.test(mock) && /<SourceAnchor \/>/.test(mock), '?source=1 预览入口挂上了');
ok(/data-source-toggle/.test(mock), '预览入口会点开默认收起的清单');

/* 端到端与包内：源码守卫本身也要接上，否则纯函数绿着、包里那一块整块消失。 */
const smokeTs = src('src/main/smoke.ts');
const smokeMjs = src('scripts/smoke.mjs');
const packMjs = src('scripts/pack-smoke.mjs');
ok(/SOURCERESULT/.test(smokeTs) && /data-source-toggle/.test(smokeTs), '真应用探针真的读了来源账');
ok(/jOfLine\('SOURCERESULT'\)/.test(smokeMjs), '端到端真的接了来源账探针');
ok(/includes\('SOURCERESULT'\)/.test(packMjs), '包内断言真的接了来源账探针');

/* ─────────── 收口 ─────────── */

if (failed.length) {
  for (const f of failed) console.error(`✗ ${f}`);
  console.error(`\n✗ 来源账 ${failed.length} 条没过（共 ${passed + failed.length} 条）`);
  process.exit(1);
}
console.log(`✓ 来源账：${passed} 条全部通过｜口径与 audit:provenance 对齐、界面文字来自纯函数、旧宣称不许回来`);
