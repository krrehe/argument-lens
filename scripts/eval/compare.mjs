/**
 * 生成并排盲看页 + 机器可算的对照指标。
 *
 * 输入两条腿的产物：
 *   scripts/.out/eval/<id>.json       产品侧（全套提示词 + 本地裁决后的成品报告）
 *   scripts/.out/eval-bare/<id>.json  对照组（同一模型、一句普通请求的原始回答）
 *
 * 输出到 eval-A/：
 *   blind.html    并排盲看页，左右随机、不标来源，选完可揭盲
 *   blind-key.json 揭盲表（与页面分开存，先看答案再看表）
 *   metrics.json / metrics.md 机器能算的那几项
 *
 * 关于「机器能算什么」：机器能算引用有没有落回原文、有没有给出档位、篇幅多长。
 * 机器**不能**算「哪个判断更对」——那正是要人来盲看的部分。所以这里只产出
 * 可复核的结构指标，不合成一个总分。合成分数就是把人的判断伪装成算术。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
/* 三个目录都允许用环境变量顶掉：只为在临时目录里验证这个生成器本身能跑通，
   免得为了测模板把假数据写进真正的对照目录。 */
const PROD = process.env.EVAL_PROD_DIR ?? resolve(ROOT, 'scripts/.out/eval');
const BARE = process.env.EVAL_BARE_DIR ?? resolve(ROOT, 'scripts/.out/eval-bare');
const OUT = process.env.EVAL_OUT_DIR ?? resolve(ROOT, '../eval-A');
mkdirSync(OUT, { recursive: true });

const read = (dir, id) => {
  const p = resolve(dir, `${id}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
};

const idsOf = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.json') && !f.includes('.error.'))
        .map((f) => f.replace(/\.json$/, ''))
    : [];

const prodIds = idsOf(PROD);
const bareIds = new Set(idsOf(BARE));
const pairs = prodIds.filter((id) => bareIds.has(id)).map((id) => ({ id, p: read(PROD, id), b: read(BARE, id) }));

if (!pairs.length) {
  console.error(
    `没有可配对的样本。\n  产品侧 ${prodIds.length} 份（${PROD}）\n  对照组 ${bareIds.size} 份（${BARE}）\n` +
      `先跑：npm run eval  与  npm run eval:bare`
  );
  process.exit(1);
}

/* ── 引用锚点：从文本里抽出被引号包住的片段，看它是否逐字存在于原文 ── */
const QUOTE_RE = /[「『“"]([^」』”"]{4,120})[」』”"]/g;
function quotesOf(text) {
  const out = [];
  let m;
  while ((m = QUOTE_RE.exec(text))) out.push(m[1].trim());
  return out;
}
function anchorStats(text, passage) {
  const qs = quotesOf(text);
  const hit = qs.filter((q) => passage.includes(q)).length;
  return { quotes: qs.length, anchored: hit, unanchored: qs.length - hit };
}

/* ── 产品侧渲染成可读文本（与报告里的字同源，不做改写） ── */
function renderProduct(d) {
  const g = d.diagnosis ?? d;
  const lines = [];
  const v = g.verdict ?? {};
  lines.push(`【判读】${v.level ?? '?'}｜${v.scaleValue ?? ''}`);
  lines.push(v.statement ?? '');
  if (v.qualification) lines.push(`限定：${v.qualification}`);
  const claims = [g.conclusion, ...(g.premises ?? []), ...(g.intermediate ?? [])].filter(Boolean);
  lines.push(`\n【拆出的主张 ${claims.length} 条】`);
  for (const c of claims) lines.push(`· ${c.id} ${c.role}｜${c.text}${c.quote ? `（原句：「${c.quote}」）` : ''}`);
  const cks = g.checks ?? [];
  if (cks.length) {
    lines.push(`\n【关卡 ${cks.length} 项】`);
    for (const c of cks) lines.push(`· ${c.label ?? c.id}：${c.answer}——${c.basis ?? ''}`);
  }
  if (g.repair?.missingPremise) lines.push(`\n【要补的前提】${g.repair.missingPremise}`);
  if (g.selfCheck?.unknowns?.length) lines.push(`\n【还没确定的】${g.selfCheck.unknowns.join('；')}`);
  return lines.join('\n');
}

/* ── 可用性指标：两侧各算一遍 ── */
const rows = [];
for (const { id, p, b } of pairs) {
  const passage = p.diagnosis?.passage ?? p.passage ?? '';
  const pText = renderProduct(p);
  const bText = b.output ?? '';
  const pLevel = p.diagnosis?.verdict?.level ?? p.verdict?.level ?? '';
  const bLevel = /站不住|不能成立|不成立/.test(bText)
    ? '明说站不住'
    : /削弱|不足以|尚不能/.test(bText)
      ? '说被削弱'
      : /站得住|成立/.test(bText)
        ? '说明成立'
        : '未给档位';
  const pa = anchorStats(pText, passage);
  const ba = anchorStats(bText, passage);
  rows.push({
    id,
    title: p.title ?? b.title ?? id,
    chars: passage.length,
    prodLen: pText.length,
    bareLen: bText.length,
    prodQuotes: pa.quotes,
    prodAnchored: pa.anchored,
    prodUnanchored: pa.unanchored,
    bareQuotes: ba.quotes,
    bareAnchored: ba.anchored,
    bareUnanchored: ba.unanchored,
    prodLevel: pLevel,
    bareLevel: bLevel,
    prodChecks: (p.diagnosis?.checks ?? p.checks ?? []).length,
    bareTok: b.usage?.completion_tokens ?? null,
    prodTok: p.usage?.completion_tokens ?? null,
  });
}

writeFileSync(resolve(OUT, 'metrics.json'), JSON.stringify(rows, null, 1), 'utf-8');

const sum = (k) => rows.reduce((s, r) => s + (r[k] ?? 0), 0);
const md = [];
md.push('# 并排对照：机器可算的那几项', '');
md.push(`样本 ${rows.length} 段。`, '');
md.push('| 指标 | 产品侧 | 对照组（一句请求） |');
md.push('|---|---|---|');
md.push(`| 引号引用总数 | ${sum('prodQuotes')} | ${sum('bareQuotes')} |`);
md.push(`| 其中逐字落回原文 | ${sum('prodAnchored')} | ${sum('bareAnchored')} |`);
md.push(`| 落不回原文（疑似编引） | ${sum('prodUnanchored')} | ${sum('bareUnanchored')} |`);
md.push(`| 回答总字数 | ${sum('prodLen')} | ${sum('bareLen')} |`);
md.push('');
md.push('> 这一页只做结构对照，不判「谁更对」。哪个更有用，要人读完再定。');
writeFileSync(resolve(OUT, 'metrics.md'), md.join('\n'), 'utf-8');

/* ── 盲看页：左右随机、按 id 定种子（同一份数据两次打开顺序不变，便于复核） ── */
function seedOf(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const key = {};
const cards = pairs.map(({ id, p, b }) => {
  const leftProd = seedOf(id) % 2 === 0;
  key[id] = { 甲: leftProd ? '产品侧' : '对照组', 乙: leftProd ? '对照组' : '产品侧', title: p.title ?? id };
  const L = leftProd ? renderProduct(p) : b.output ?? '';
  const R = leftProd ? b.output ?? '' : renderProduct(p);
  return `<section class="card" data-id="${esc(id)}">
  <header><b>${esc(p.title ?? id)}</b><span class="meta">${esc(p.genre ?? '')} · 原文 ${esc(
    (p.diagnosis?.passage ?? p.passage ?? '').length
  )} 字</span></header>
  <div class="pair">
    <div class="side"><div class="tag">甲</div><pre>${esc(L)}</pre></div>
    <div class="side"><div class="tag">乙</div><pre>${esc(R)}</pre></div>
  </div>
  <div class="pick">
    <button data-pick="甲">甲更有用</button>
    <button data-pick="乙">乙更有用</button>
    <button data-pick="平">差不多</button>
  </div>
</section>`;
});

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>论证镜 · 并排盲看</title>
<style>
:root{--bg:#fbf9f4;--ink:#2c2823;--ink2:#5c5449;--line:#e6e0d3;--hi:#8a6d3b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.75 "Microsoft YaHei",system-ui,sans-serif}
.top{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:12px 20px;z-index:9;display:flex;gap:14px;align-items:baseline}
.top h1{font-size:15px;margin:0;font-weight:600}
.top .s{font-size:12px;color:var(--ink2)}
.wrap{max-width:1500px;margin:0 auto;padding:16px 20px 80px}
.card{border:1px solid var(--line);border-radius:10px;background:#fff;margin:14px 0;overflow:hidden}
.card header{display:flex;justify-content:space-between;gap:12px;padding:10px 14px;background:#f6f1e7;border-bottom:1px solid var(--line);font-size:13px}
.meta{color:var(--ink2);font-size:12px}
.pair{display:grid;grid-template-columns:1fr 1fr}
.side{padding:12px 14px;border-right:1px solid var(--line);min-width:0}
.side:last-child{border-right:0}
.tag{display:inline-block;font-size:11px;color:#fff;background:var(--hi);border-radius:3px;padding:0 6px;margin-bottom:6px}
pre{white-space:pre-wrap;word-break:break-word;font:13px/1.8 "Microsoft YaHei",system-ui,sans-serif;margin:0;max-height:520px;overflow:auto}
.pick{display:flex;gap:10px;padding:10px 14px;border-top:1px solid var(--line);background:#fdfbf6}
.pick button{border:1px solid var(--line);background:#fff;border-radius:6px;padding:5px 14px;font-size:13px;color:var(--ink2);cursor:pointer}
.pick button.on{background:var(--hi);border-color:var(--hi);color:#fff}
.pick .done{margin-left:auto;font-size:12px;color:#3f7a4a}
</style></head>
<body>
<div class="top"><h1>并排盲看</h1><span class="s">左右来源随机、不标注。读完再选；全部选完再揭盲。</span><span class="s" id="cnt"></span></div>
<div class="wrap" id="wrap">${cards.join('\n')}</div>
<script>
const KEY = ${JSON.stringify(key)};
const STORE = 'blindPicks.v1';
const picks = JSON.parse(localStorage.getItem(STORE) || '{}');
function paint(){
  document.querySelectorAll('.card').forEach(c=>{
    const id=c.dataset.id, p=picks[id];
    c.querySelectorAll('[data-pick]').forEach(b=>b.classList.toggle('on', p && b.dataset.pick===p));
    let d=c.querySelector('.done');
    if(p && !d){ d=document.createElement('span'); d.className='done'; c.querySelector('.pick').appendChild(d); }
    if(d && p){ const who = p==='平' ? '平' : (KEY[id] && KEY[id][p]); d.textContent = p==='平' ? '已选：平' : '已选：'+p+'（揭盲后可知来源）'; }
  });
  const n=Object.keys(picks).length;
  document.getElementById('cnt').textContent = n+' / '+document.querySelectorAll('.card').length+' 已选';
}
document.getElementById('wrap').addEventListener('click', e=>{
  const b=e.target.closest('[data-pick]'); if(!b) return;
  const id=b.closest('.card').dataset.id;
  picks[id]=b.dataset.pick; localStorage.setItem(STORE, JSON.stringify(picks)); paint();
});
paint();
</script>
</body></html>`;

writeFileSync(resolve(OUT, 'blind.html'), html, 'utf-8');
writeFileSync(resolve(OUT, 'blind-key.json'), JSON.stringify(key, null, 1), 'utf-8');

console.log(`配对 ${pairs.length} 段 → ${OUT}`);
console.log(readFileSync(resolve(OUT, 'metrics.md'), 'utf-8'));
