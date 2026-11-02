/**
 * 交接文档的防腐烂检查。
 *
 * 为什么需要这个：这个项目打算长期开发，而每一个接手的会话都不带上次的记忆。
 * 于是 AGENTS.md 是唯一稳定的入口——它一旦说谎，后面全错，而且错得完全没有声音：
 * 没人会去核对「文档里让你跑的那条命令还在不在」。
 *
 * 「文档不能比软件更自信」这条规矩对自己也适用：**没有断言守着的说法会烂。**
 * 所以这里不检查文风、不检查措辞，只检查四类能机器判定的东西：
 *
 * 1. 文档点名的 `npm run X`，package.json 里必须真有 X
 * 2. 文档点名的路径，磁盘上必须真存在
 * 3. verify 会跑的每一条，文档必须点到名（新增检查而没写进交接书 = 下个会话不知道它在）
 * 4. README 声明的 verify 项数，必须等于 verify 实际会跑的条数
 * 5. 文档说「十一道裁决」，代码里就必须正好十一道
 *
 * 不检查第 5 类之外的数字（各检查的断言条数）：那些数每天都在变，
 * 写进文档只会让人学会忽略文档里的数字。要实时数，跑命令。
 *
 * 跑法：npm run check:docs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf-8');
const doc = read('AGENTS.md');
const readme = read('README.md');
const pkg = JSON.parse(read('package.json'));
const scripts = Object.keys(pkg.scripts ?? {});

const bad = [];
let n = 0;
const pass = () => {
  n += 1;
};

/* ── 1. 点名的命令要存在 ───────────────────────────────────── */
const cmds = new Set();
for (const m of doc.matchAll(/npm run ([a-zA-Z][\w:.-]*)/g)) cmds.add(m[1]);
for (const c of cmds) {
  if (scripts.includes(c)) pass();
  else bad.push(`让你跑 "npm run ${c}"，但 package.json 里没有这条脚本`);
}

/* ── 2. 点名的路径要存在 ───────────────────────────────────── */
const paths = new Set();
for (const m of doc.matchAll(/`([^`\n]+)`/g)) {
  const t = m[1].trim();
  if (!/^(src|docs|scripts|build|dist|release)\//.test(t)) continue;
  if (/[*<>]/.test(t) || t.includes('...')) continue; // 通配与省略写法不参与
  paths.add(t);
}
for (const p of paths) {
  if (existsSync(p)) pass();
  else bad.push(`让你去看 ${p}，但这个路径不存在`);
}

/* ── 3 & 4. 与 verify 的实际清单对齐 ───────────────────────── */
const listed = spawnSync(process.execPath, ['scripts/verify.mjs', '--list'], { encoding: 'utf-8' });
if (listed.status !== 0) {
  bad.push(`scripts/verify.mjs --list 跑不起来：${(listed.stderr || '').trim().split('\n')[0]}`);
} else {
  const lines = (listed.stdout || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const names = lines.filter((l) => !l.startsWith('共 '));

  for (const name of names) {
    /* 用带边界的匹配，免得 "check:report" 被 "check:report-audit" 之类的子串冒充 */
    const hit = new RegExp(`(^|[^\\w:.-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w:.-]|$)`).test(doc);
    if (hit) pass();
    else bad.push(`verify 会跑 ${name}，但 AGENTS.md 一个字没提——下一个会话不会知道有这一关`);
  }

  const m = readme.match(/全部静态检查（(\d+)\s*项/);
  if (!m) {
    bad.push('README 里找不到「全部静态检查（N 项」这句话，没法核对项数');
  } else if (Number(m[1]) === names.length) {
    pass();
  } else {
    bad.push(`README 写「${m[1]} 项」，verify 实际跑 ${names.length} 项`);
  }
}

/* ── 5. 说的是几道裁决，就得有几道 ─────────────────────────── */
if (doc.includes('十一道裁决')) {
  const src = read('src/main/analyze.ts');
  const gs = new Set([...src.matchAll(/\bG(\d+)\b/g)].map((x) => Number(x[1])));
  const want = 11;
  if (gs.size === want && !gs.has(want + 1)) {
    pass();
  } else {
    const got = [...gs].sort((a, b) => a - b).join(', ');
    bad.push(`AGENTS.md 说十一道裁决（G1–G11），src/main/analyze.ts 里数出来 ${gs.size} 道：G${got}`);
  }
}

/* ── 6. 交接书不能长成一本书 ───────────────────────────────── */
/*
 * 上限 200 行。理由不是审美：这份文件存在的唯一意义是「一个会话开始前能读完」。
 * 一旦它长到需要跳读，它就会和 README 一样，变成「大家都知道有，但没人真的读过」。
 * 超了就往 docs/ 里搬，这里只留「不看会做错」的部分。
 */
const LIMIT = 200;
const lines0 = doc.split(/\r?\n/).length;
if (lines0 <= LIMIT) pass();
else bad.push(`AGENTS.md 有 ${lines0} 行，超过 ${LIMIT} 行上限——太长的交接书等于没有交接书，把细节搬进 docs/`);

if (bad.length) {
  for (const b of bad) console.error(`✗ ${b}`);
  console.error(`\n✗ 交接文档有 ${bad.length} 处与代码不符（共 ${n + bad.length} 项）`);
  console.error('  文档比软件自信，比文档缺失更危险：照着它做，会做到一个不存在的地方。');
  process.exit(1);
}

console.log(`✓ 交接文档与代码一致 ${n} 项`);
