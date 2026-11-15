/**
 * 更新提示词基线（docs/prompts/BASELINE.json）。
 *
 * 这个命令存在的理由不是「再生成一个 JSON」，而是把 docs/提示词工程.md 第九节里
 * 第 4 步从自觉变成强制：**改了提示词的内容，就必须换版本号、必须留一行注记。**
 * 文档写了两年，一条断言都没守着——改一个字忘了改版本，检查全绿，
 * 而界面上「提示词版本 v2.5.0」会同时指两把不同的尺子。
 *
 * 拦截发生在写入之前。能重跑生成器不能成为绕过留痕的捷径：
 * 指纹变了而版本没变 → 拒绝；版本换了却没加注记 → 拒绝；
 * 加了注记但首行写的不是新版本号（拿旧版本的句子凑数）→ 拒绝。
 *
 * 跑法：npm run prompt:lock
 * 首次建立基线：npm run prompt:lock -- --init（仓库里本来就有，正常改提示词用不到这面旗）
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  BASELINE_PATH,
  NOTE_COUNT,
  NOTE_HEAD,
  NOTES,
  VERSION,
  currentFacts,
  fingerprintMap,
  type Baseline,
} from './prompt-facts';

const facts = currentFacts();
const now = fingerprintMap(facts);
const init = process.argv.includes('--init');

function refuse(reason: string): never {
  console.error(`\n✗ 拒绝更新提示词基线\n`);
  console.error(`  ${reason}\n`);
  console.error('  改提示词要走完整的三步，顺序不能换：');
  console.error('  1. 改 src/main/prompt/registry.ts 的 PROMPT_VERSION');
  console.error('  2. 在 PROMPT_VERSION_NOTE 最前面加一行，以新版本号开头，写清改了什么、为什么');
  console.error('  3. npm run prompts（重导出 30 份）→ npm run prompt:lock（更新基线）');
  console.error('  第 1、2 步是留痕，不是手续：旧报告靠版本号与指纹才能判断可比不可比。\n');
  process.exit(1);
}

if (!existsSync(BASELINE_PATH)) {
  if (!init) {
    refuse('基线文件不存在。它是版本史的一部分，不能凭空重建；确属首次建立请显式加 --init。');
  }
  const fresh: Baseline = { version: VERSION, noteCount: NOTE_COUNT, notes: NOTES, fingerprints: now };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(fresh, null, 2)}\n`, 'utf-8');
  console.log(`✓ 首次建立基线：v${VERSION}、${facts.length} 份指纹、注记 ${NOTE_COUNT} 行`);
  console.log('  再跑一次 npm run prompts 与 npm run check:prompt-drift，确认全文、索引表与基线三处对得上。');
  process.exit(0);
}

let old: Baseline;
try {
  old = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as Baseline;
} catch (e) {
  refuse(`基线读不出来：${String(e)}`);
}

if (!old || typeof old.version !== 'string' || !old.fingerprints || typeof old.noteCount !== 'number') {
  refuse('基线形状不对（要 version / noteCount / notes / fingerprints 四项）。不要手改这个文件，用命令生成。');
}

const changed = facts.filter((f) => old.fingerprints[f.key] !== now[f.key]);

/*
 * 旧格式迁移：第一版基线只存了 noteCount，没存注记全文。
 * 报告里「这把尺子」那一栏现在要读 notes，所以这里允许补写一次。
 *
 * 只加字段，不放行任何内容变更：必须版本相同且 30 份指纹逐字全同，
 * 否则「顺手重跑一次生成器」就会变成绕过版本锁的捷径。
 * 也不许删掉基线再 --init——那条路等于把版本史凭空重建，是上一轮明令禁止的。
 */
const legacy = !Array.isArray(old.notes);
if (legacy && (changed.length || old.version !== VERSION)) {
  refuse(
    '基线是旧格式（缺 notes 字段），但版本号或指纹也和现场不一致。' +
      ' 先按正常三步走完留痕，不要借迁移把内容改动一起洗掉。'
  );
}
if (legacy) {
  console.log('  旧格式基线补写 notes 字段：版本与 30 份指纹逐字未变，只加注记全文。');
}

if (changed.length) {
  if (VERSION === old.version) {
    refuse(
      `${changed.length} 份提示词的内容变了，但 PROMPT_VERSION 仍是 v${VERSION}（基线里也是 v${old.version}）。` +
        ' 先换版本号，否则三个月前的旧报告与今天的新报告会在界面上顶着同一个版本名。'
    );
  }
  if (NOTE_COUNT <= old.noteCount) {
    refuse(
      `版本号换成了 v${VERSION}，但 PROMPT_VERSION_NOTE 仍是 ${NOTE_COUNT} 行（基线记的是 ${old.noteCount} 行）。` +
        ' 没有那一行，半年后没人知道这条别扭的句子替哪次失效打过补丁。'
    );
  }
  if (!NOTE_HEAD.startsWith(VERSION)) {
    refuse(
      `注记首行没写新版本号 v${VERSION}（首行开头是「${NOTE_HEAD.slice(0, 24)}…」）。` +
        ' 拿旧版本的句子凑行数，等于没留痕。'
    );
  }
}

const next: Baseline = { version: VERSION, noteCount: NOTE_COUNT, notes: NOTES, fingerprints: now };
writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');

if (changed.length) {
  console.log(`✓ 基线已更新：v${old.version} → v${VERSION}，${changed.length} 份指纹变了，注记 ${old.noteCount} → ${NOTE_COUNT} 行`);
  for (const f of changed.slice(0, 6)) console.log(`  · ${f.key}: ${old.fingerprints[f.key]} → ${now[f.key]}`);
  if (changed.length > 6) console.log(`  · 其余 ${changed.length - 6} 份同上`);
  console.log('  再确认 docs/prompts/ 下 30 份全文也已重导出（npm run prompts）。');
  console.log('  prompts 与 lock 是两件不同的事，互为替代时 check:prompt-drift 都会红。');
} else {
  console.log(`✓ 基线无需改动：v${VERSION}、${facts.length} 份指纹全部一致（这次只改了与提示词无关的东西）`);
}
