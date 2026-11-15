/**
 * 提示词导出件的新鲜度与版本锁（只读）。
 *
 * 这个产品对用户承诺「有权看到自己被什么标准在衡量」，落点是 docs/prompts/ 下
 * 三十份可 diff 的全文，以及界面上的「提示词版本 vX.Y.Z」。在此之前，两件事
 * 都只靠人记得：
 *
 *   1. 改了 blocks.ts 却忘了跑 npm run prompts → 三十份全文是旧尺子，
 *      而 prompt:lint 验的是运行时装配（新的），verify 全绿，没人发现；
 *   2. 改了内容却忘了改 PROMPT_VERSION / PROMPT_VERSION_NOTE →
 *      界面上同一个版本名指着两把不同的尺子，旧报告的可比性无从判断。
 *
 * 这里的做法不是「重新生成一遍再比」——那等于自己验自己。检查器只读磁盘，
 * 把三十份 md 里的 system / user 代码块与抬头字段抽出来，和现场装配逐字对；
 * 再对索引表的指纹、BASELINE.json 的指纹与版本注记行数。它一个字节都不写。
 *
 * 反证见本轮记录：改坏一个块、一份落盘 md、锁里一个指纹、删一行注记、
 * 只改版本不加注记、直接重跑 lock 绕过版本号，各自都要红在对应的那条上。
 *
 * 跑法：npm run check:prompt-drift（已进 verify）
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BASELINE_PATH,
  DOC_DIR,
  INDEX_PATH,
  NOTE_COUNT,
  NOTE_HEAD,
  VERSION,
  currentFacts,
  type Baseline,
  type PromptFact,
} from './prompt-facts';

let passed = 0;
const failed: string[] = [];
const ok = (cond: boolean, what: string, detail = ''): void => {
  if (cond) passed += 1;
  else failed.push(`${what}${detail ? ` — ${detail}` : ''}`);
};
const read = (p: string): string => readFileSync(p, 'utf-8');
const src = (p: string): string => read(resolve(process.cwd(), p));

const facts = currentFacts();
ok(facts.length === 30, '现场装配出 30 份', String(facts.length));

/* ─────────── 路径锚：独立验一次，不吃共享层给的那份 ─────────── */

/*
 * 这几条是上面那段注释的具体兑现。检查器如果也用 DOC_DIR 去问「文件在不在」，
 * 那么共享层把三处一起带错时，它照样全绿——那次真的发生过。
 * 这里从 process.cwd() 重新拼一次路径，与共享层的结果对着比。
 */
const anchored = resolve(process.cwd(), 'docs/prompts');
ok(DOC_DIR === anchored, '导出目录锚在项目根的 docs/prompts，不是打包产物旁边', DOC_DIR);
ok(BASELINE_PATH === resolve(anchored, 'BASELINE.json'), '基线路径锚在同一处', BASELINE_PATH);
ok(existsSync(resolve(anchored, 'BASELINE.json')), '项目根的 docs/prompts/ 里真有基线文件');
ok(existsSync(resolve(anchored, 'README.md')), '项目根的 docs/prompts/ 里真有索引表');
ok(
  existsSync(resolve(process.cwd(), 'scripts/docs')) === false,
  '打包产物旁边没有第二套影子导出目录（第一版就错在这里）'
);

/* 锚错了就停：后面几十条都建立在「读的是项目根那套文件」上，读错目录时全无意义。 */
if (DOC_DIR !== anchored || !existsSync(resolve(anchored, 'BASELINE.json'))) {
  console.error(`\n✗ 提示词导出目录锚错了\n  实际 ${DOC_DIR}\n  应该 ${anchored}`);
  console.error('  三处共用一份错路径时会互相验证、整套断言假绿，所以这里直接停。\n');
  process.exit(1);
}

/* ─────────── 落盘全文 ─────────── */

/** 从 md 的某个标题往后取第一个 ```text 代码块。取不到返回 null，不静默当空。 */
function codeBlockAfter(md: string, heading: string): string | null {
  const i = md.indexOf(heading);
  if (i < 0) return null;
  const m = /```text\n([\s\S]*?)\n```/.exec(md.slice(i));
  return m ? m[1] : null;
}

interface DocCheck {
  cond: boolean;
  what: string;
}

/**
 * 一份导出件拆成七条独立断言，不合成一句「有问题」。
 * 新鲜度坏掉的时候，最要紧的是能一眼看出「是全文没重导出」还是
 * 「只改了版本号忘了留注记」——合成一条就又得人手去 diff 一遍。
 */
function docChecks(md: string, f: PromptFact): DocCheck[] {
  const system = codeBlockAfter(md, '## system');
  const user = codeBlockAfter(md, '## user（模板');
  const version = /版本：v([\d.]+)/.exec(md)?.[1];
  const fp = /(?:^|\n)指纹 `([0-9a-f]{12})`/m.exec(md)?.[1];
  const core = /内核指纹 `([0-9a-f]{12})`/.exec(md)?.[1];
  const chars = /字符 (\d+)（预算/.exec(md)?.[1];
  const blockLine = /规则块（(\d+)）：([^\n]+)/.exec(md);
  const listed = blockLine?.[2]?.split('、') ?? [];

  return [
    { cond: system !== null && system === f.system, what: 'system 代码块与现场装配逐字一致' },
    { cond: user !== null && user === f.user, what: 'user 代码块与现场装配逐字一致' },
    { cond: version === f.version, what: '版本行是当前版本' },
    { cond: fp === f.fingerprint, what: '指纹是当前那把尺子' },
    { cond: core === f.coreFingerprint, what: '内核指纹与现场一致' },
    { cond: chars === String(f.chars), what: '字符数与现场一致' },
    {
      cond: Number(blockLine?.[1] ?? -1) === f.blockIds.length && listed.join('、') === f.blockIds.join('、'),
      what: '规则块清单与现场装配一致',
    },
  ];
}

const docIssues = (md: string, f: PromptFact): string[] =>
  docChecks(md, f).filter((c) => !c.cond).map((c) => c.what);

for (const f of facts) {
  const p = resolve(DOC_DIR, `${f.key}.md`);
  if (!existsSync(p)) {
    ok(false, `${f.key}.md 不在`);
    continue;
  }
  for (const c of docChecks(read(p), f)) ok(c.cond, `${f.key}.md：${c.what}`);
}

/* 目录里不许混进别的东西：多出一份旧版全文，人就会 diff 错对象。 */
const mdFiles = readdirSync(DOC_DIR).filter((n) => n.endsWith('.md'));
ok(mdFiles.length === 31, 'docs/prompts/ 下正好 30 份全文 + 1 份索引', String(mdFiles.length));
ok(
  mdFiles.filter((n) => n !== 'README.md').every((n) => facts.some((f) => `${f.key}.md` === n)),
  '没有多余的旧版全文'
);

/* ─────────── 索引表 ─────────── */

const index = read(INDEX_PATH);
ok(index.includes(`提示词版本 **v${VERSION}**`), '索引表写的是当前版本', VERSION);
const tableRows = index.split(/\r?\n/).filter((l) => /^\| [a-z]+ \|/.test(l));
ok(tableRows.length === 30, '索引表正好 30 行', String(tableRows.length));
for (const f of facts) {
  const row = tableRows.find((l) => l.split('|')[1]?.trim() === f.theory && l.includes(`\`${f.fingerprint.slice(0, 8)}\``));
  ok(!!row, `索引表里 ${f.key} 的指纹对得上`, f.fingerprint.slice(0, 8));
  if (row) {
    const cells = row.split('|').map((c) => c.trim());
    ok(cells[4] === String(f.chars), `索引表里 ${f.key} 的字符数对得上`, `${cells[4]} vs ${f.chars}`);
  }
}

/* ─────────── 版本基线 ─────────── */

let base: Baseline | null = null;
try {
  base = JSON.parse(read(BASELINE_PATH)) as Baseline;
} catch (e) {
  ok(false, 'BASELINE.json 读得出来', String(e));
}
if (base) {
  ok(base.version === VERSION, '基线版本号 == 当前版本号', `${base.version} vs ${VERSION}`);
  ok(base.noteCount === NOTE_COUNT, '基线注记行数 == 当前注记行数', `${base.noteCount} vs ${NOTE_COUNT}`);
  ok(!!base.fingerprints && typeof base.fingerprints === 'object', '基线里有一张指纹表');
  const keys = Object.keys(base.fingerprints ?? {});
  ok(keys.length === 30, '基线正好 30 个键', String(keys.length));
  ok(
    keys.every((k) => facts.some((f) => f.key === k)) && facts.every((f) => keys.includes(f.key)),
    '基线的键集合恰等于 30 份提示词'
  );
  for (const f of facts) {
    ok(base.fingerprints?.[f.key] === f.fingerprint, `基线 ${f.key} 的指纹是现场那一把尺子`, `${base.fingerprints?.[f.key]} vs ${f.fingerprint}`);
  }
}

/* 注记本身也验形状：首行必须以当前版本号开头，否则「加了一行」可能只是凑数。 */
ok(NOTE_HEAD.startsWith(VERSION), '变更注记首行以当前版本号开头', NOTE_HEAD.slice(0, 20));
ok(NOTE_COUNT >= 1, '变更注记至少一行', String(NOTE_COUNT));

/* ─────────── 源码守卫：别让检查变成自己验自己 ─────────── */

const drift = src('scripts/check-prompt-drift.ts');
const lock = src('scripts/prompt-lock.ts');
const factsSrc = src('scripts/prompt-facts.ts');
const dump = src('scripts/dump-prompts.ts');
const entry = src('src/main/prompt/index.ts');
const pkg = JSON.parse(src('package.json')) as { scripts?: Record<string, string> };

/*
 * 守卫自身不能触发守卫。字面串用字符类打断：正则仍认得出真实的写文件调用，
 * 却不会把「这行正则自己」读成「检查器在写文件」——第一版就栽在这里，
 * 一条本该绿的断言红得莫名其妙。
 */
const WRITE_APIS = /writeFileSyn[c]|appendFileSyn[c]|mkdirSyn[c]/;
ok(!WRITE_APIS.test(drift), '检查器一个字节都不写（新鲜度只能靠读落盘件验）');
ok(!/from '\.\/(dump-prompts|prompt-lock)'/.test(drift), '检查器不调生成器、不调锁生成器');
ok(/readFileSync/.test(drift) && /codeBlockAfter/.test(drift), '检查器真的从 md 里抽代码块');
ok(/'（示例文本占位）'/.test(factsSrc), '占位文本只在共享事实层定义一处');
ok(
  /process\.cwd\(\)/.test(factsSrc) && !/resolve\(import\.meta\.dirname/.test(factsSrc),
  '共享事实层用项目根锚定路径，不靠打包产物的 dirname 往上退'
);
ok(/SAMPLE_PASSAGE|DELIM_PLACEHOLDER/.test(dump) && !/'（示例文本占位）'/.test(dump), '导出器从共享事实层取占位约定，不自己硬编码');
ok(
  /prompt:lock/.test(entry) && /check:prompt-drift/.test(entry) && /PROMPT_VERSION_NOTE/.test(entry),
  '装配入口的注释写着完整的三步，不会把下个会话带回「两件事」的旧流程'
);
ok(/VERSION === old\.version/.test(lock), '锁生成器拦「内容变了但版本没变」');
ok(/NOTE_COUNT <= old\.noteCount/.test(lock), '锁生成器拦「换了版本但没加注记」');
ok(/NOTE_HEAD\.startsWith\(VERSION\)/.test(lock), '锁生成器拦「注记首行不是新版本号」');
ok(/refuse\(/.test(lock) && /process\.exit\(1\)/.test(lock), '三道拦截真的会拒绝写入，不是只打一行警告');
ok(!!pkg.scripts?.['check:prompt-drift'] && !!pkg.scripts?.['prompt:lock'], '两条命令都在 package.json 里');

/* ─────────── 自检：比对函数不是恒真 ─────────── */

const first = resolve(DOC_DIR, `${facts[0].key}.md`);
if (existsSync(first)) {
  const whole = read(first);
  const brokenSystem = whole.replace(facts[0].system.slice(0, 40), `${facts[0].system.slice(0, 39)}≠`);
  ok(docIssues(brokenSystem, facts[0]).length > 0, '自检：改坏 system 一个字，比对必须报出来');
  const brokenFp = whole.replace(facts[0].fingerprint, '0'.repeat(12));
  ok(docIssues(brokenFp, facts[0]).length > 0, '自检：改坏指纹行，比对必须报出来');
  ok(docIssues(whole, facts[0]).length === 0, '自检：原样那份比不出问题');
}

/* ─────────── 收口 ─────────── */

/*
 * 项目惯例：结尾再钉一条「本次至少跑了 N 项」。
 * 少了它，某个循环因为文件读不到而整段跳过时，输出仍是一句「✓ 通过 N 项」，
 * 数字悄悄缩水没人会发现——那和断言被静默跳过是同一件事。
 */
ok(passed >= 300, '断言总数兜底（至少 300 项）', String(passed));

if (failed.length) {
  console.error(`\n✗ 提示词导出件新鲜度：${failed.length} 条没过\n`);
  for (const f of failed.slice(0, 40)) console.error(`  · ${f}`);
  if (failed.length > 40) console.error(`  · 其余 ${failed.length - 40} 条见上`);
  console.error('\n  先确认是不是只忘了重导出：npm run prompts → git diff docs/prompts/');
  console.error('  若提示词内容真的改过，还必须走 npm run prompt:lock 的三步留痕。\n');
  process.exit(1);
}
console.log(`✓ 提示词导出件新鲜度与版本锁：${passed} 条（v${VERSION}、30 份全文）`);
