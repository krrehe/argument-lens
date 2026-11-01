/**
 * 稳健性契约。
 *
 * 这一份检查的存在理由，是一次代码审查里发现的几处「失败被吞掉」：
 * 异议写不进文件、报告存不进历史、配置不合法也照样保存——三处的共同点是
 * 界面上表现为「什么都没发生」。用户点了一下，屏幕没有变化，他只能以为是自己没点对。
 *
 * 这类问题的特点决定了它必须被断言，不能被记得：审查时修掉了，下一次加功能时
 * 又会照原样写出来，因为「catch 里什么都不做」是最省事的写法。
 * 所以这里定两条规矩，并且让它们各自都能被故意破坏：
 *
 *   1. 写失败必须能传到界面上（运行时：造一个写不进去的路径，看它抛不抛）
 *   2. 静默必须有据（静态：每个空 catch 里必须写 @allow-silent 和一句理由）
 *
 * 跑法：npm run check:robustness
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendJsonl, readJsonl, rewriteJsonl } from '../src/main/jsonl';
import { describeProblems, validateSettingsPatch } from '@shared/settings-check';

let passed = 0;
const failed: string[] = [];

function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}

/* ──────────────────────────────────────────────────────────────
   一、jsonl 读写：真实跑一遍，包括造一个写不进去的路径
   ────────────────────────────────────────────────────────────── */

const sandbox = join(tmpdir(), `al-robust-${Date.now()}`);
mkdirSync(sandbox, { recursive: true });
const good = join(sandbox, 'items.jsonl');

appendJsonl(good, { a: 1 });
appendJsonl(good, { a: 2 });
let read = readJsonl<{ a: number }>(good, (line) => JSON.parse(line));
ok(read.items.length === 2 && read.badLines === 0, 'jsonl 追加两行能读回两行', `读到 ${read.items.length} 行`);

rewriteJsonl(good, [{ a: 3 }]);
read = readJsonl<{ a: number }>(good, (line) => JSON.parse(line));
ok(read.items.length === 1 && read.items[0].a === 3, 'jsonl 重写覆盖旧内容');

// 坏行：不抛、被数出来。一行坏不能毁掉整份记录，但也不能报成「完好」。
writeFileSync(good, '{"a":1}\n{ 坏行\n{"a":2}\n', 'utf-8');
read = readJsonl<{ a: number }>(good, (line) => JSON.parse(line));
ok(read.items.length === 2 && read.badLines === 1, 'jsonl 坏行被跳过并被计数', `items=${read.items.length} bad=${read.badLines}`);

ok(readJsonl(join(sandbox, 'nope.jsonl'), (line) => JSON.parse(line)).items.length === 0, 'jsonl 读不存在的文件返回空');

/*
 * 写失败必须抛。
 *
 * 造两个真实的失败：目录不存在（用户手动删了 userData 下的子目录）、
 * 以及把一个文件当成目录（父路径是文件）。这两件事在真机上都会发生，
 * 而且发生时用户正在点「记下」——不抛，他的意见就没了，界面却什么都不会说。
 */
function throws(label: string, fn: () => void): void {
  let threw = false;
  let msg = '';
  try {
    fn();
  } catch (err) {
    threw = true;
    msg = (err as Error)?.message ?? '';
  }
  ok(threw, label, threw ? '' : '没有抛，写失败被吞了');
  if (threw) ok(msg.length > 0, `${label}（抛出的信息带原因）`, '异常没有 message');
}

const noDir = join(sandbox, '不存在子目录', 'items.jsonl');
throws('jsonl 追加到不存在的目录要抛', () => appendJsonl(noDir, { a: 1 }));
throws('jsonl 重写到不存在的目录要抛', () => rewriteJsonl(noDir, [{ a: 1 }]));

const asFile = join(sandbox, 'file.txt');
writeFileSync(asFile, 'x', 'utf-8');
throws('jsonl 追加到「文件当目录」的路径要抛', () => appendJsonl(join(asFile, 'items.jsonl'), { a: 1 }));

/* ──────────────────────────────────────────────────────────────
   二、设置校验：每一种坏输入都要被挡下来
   ────────────────────────────────────────────────────────────── */

const noProblem = (patch: any, label: string) =>
  ok(validateSettingsPatch(patch).length === 0, label, describeProblems(validateSettingsPatch(patch)));
const hasProblem = (patch: any, label: string) =>
  ok(validateSettingsPatch(patch).length > 0, label, '竟然通过了');

noProblem({}, '空改动不报错');
noProblem({ baseUrl: 'https://api.deepseek.com/v1' }, 'https 地址通过');
noProblem({ baseUrl: 'http://localhost:11434/v1' }, '本地 http 地址通过');
noProblem({ baseUrl: 'http://127.0.0.1:1234/v1/' }, '带尾斜杠通过');
noProblem({ model: 'deepseek-chat', temperature: 0.2, apiKey: 'sk-abcdef' }, '一份正常配置通过');
noProblem({ apiKey: '' }, '空 Key 不报错（表示不动它）');

hasProblem({ baseUrl: 'file:///C:/Windows/System32/cmd.exe' }, 'file:// 地址被挡');
hasProblem({ baseUrl: 'javascript:alert(1)' }, 'javascript: 地址被挡');
hasProblem({ baseUrl: 'ftp://example.com/v1' }, 'ftp:// 地址被挡');
hasProblem({ baseUrl: 'data:text/plain,x' }, 'data: 地址被挡');
hasProblem({ baseUrl: '不是网址' }, '不可解析的地址被挡');
hasProblem({ baseUrl: '' }, '空地址被挡');
hasProblem({ baseUrl: 'https://a b.com/v1' }, '带空格的地址被挡');
hasProblem({ model: '' }, '空模型名被挡');
hasProblem({ model: 'gpt\n4o' }, '带换行的模型名被挡');
hasProblem({ temperature: 3 }, '温度 3 被挡');
hasProblem({ temperature: -0.5 }, '负温度被挡');
hasProblem({ temperature: Number.NaN }, 'NaN 温度被挡');
hasProblem({ temperature: '0.2' as unknown as number }, '字符串温度被挡');
hasProblem({ apiKey: 'sk-abc def' }, '带空格的 Key 被挡');
hasProblem({ apiKey: 'sk-a\nb' }, '带换行的 Key 被挡');

ok(
  validateSettingsPatch({ baseUrl: 'file:///etc/passwd' })[0]?.field === 'baseUrl',
  '问题要指到具体字段（界面才能对准那一栏）'
);

/* ──────────────────────────────────────────────────────────────
   三、源码契约：上面那些保证有没有真的接进应用
   ────────────────────────────────────────────────────────────── */

function src(rel: string): string {
  const p = rel.replace(/\//g, '/');
  if (!existsSync(p)) {
    failed.push(`读不到 ${rel}`);
    return '';
  }
  return readFileSync(p, 'utf-8');
}

const mainIndex = src('src/main/index.ts');
const objections = src('src/main/objections.ts');
const llm = src('src/main/llm.ts');
const html = src('src/renderer/index.html');
const preload = src('src/preload/index.ts');
const appTsx = src('src/renderer/src/App.tsx');

ok(/sandbox:\s*true/.test(mainIndex), '渲染进程开沙箱', 'webPreferences 里不是 sandbox: true');
ok(!/apiKey:\s*s\.apiKey/.test(mainIndex), 'settings:get 不回 Key 明文', '又把解密后的 Key 发回渲染层了');
ok(/validateSettingsPatch\(payload\)/.test(mainIndex), 'settings:save 用校验函数校验这一次的改动');
ok(
  /problems\.length[\s\S]{0,240}?return \{ ok: false, error: describeProblems/.test(mainIndex),
  '校验不通过时不写盘，并返回原因',
  '要么没调用校验，要么校验失败后仍然写了盘'
);
ok(/saved\s*=\s*false/.test(mainIndex), '存档失败要把 saved 置 false', 'catch 里没有记下失败');
ok(/saved,\s*saveError/.test(mainIndex), '存档失败的原因要一并回传');
ok(
  /objections:add[\s\S]{0,400}?ok:\s*false[\s\S]{0,200}?listObjections/.test(mainIndex),
  '异议写入失败要返回 ok:false 并带上现有列表'
);
ok(
  /objections:remove[\s\S]{0,400}?ok:\s*false/.test(mainIndex),
  '异议删除失败要返回 ok:false'
);
ok(/appendJsonl|rewriteJsonl/.test(objections), '异议存储走 jsonl 层', '绕开了 jsonl.ts');
ok(/from '\.\/jsonl'/.test(objections), '异议存储引用的是 main/jsonl');
ok(!/appendFileSync/.test(objections), '异议存储不再直接 appendFileSync（写失败会冒泡）');
ok(/briefOf/.test(llm), '报错回显走 briefOf');
ok(/sk-\[A-Za-z0-9_-\]/.test(llm), '报错回显要抹掉 sk- 开头的凭据');
ok(/Bearer\\s\+/.test(llm), '报错回显要抹掉 Bearer 凭据');
ok(/object-src 'none'/.test(html), 'CSP 禁掉 object-src');
ok(/default-src 'self'/.test(html), 'CSP 还在');
ok(/banner warn/.test(appTsx), '界面上有一条「没做成」的提示位');
ok(/saved === false/.test(appTsx), '界面会读 saved 并把失败说出来');
ok(/r\.ok/.test(appTsx), '异议写入结果按 ok 分支处理');
ok(/saved\?:/.test(preload) && /saveError/.test(preload), 'preload 的 run 声明带 saved/saveError');

/* ──────────────────────────────────────────────────────────────
   四、静默必须有据：每个空 catch 都得写 @allow-silent 和理由
   ────────────────────────────────────────────────────────────── */

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** 去掉注释后的正文。空 = 这个 catch 什么都没做。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').trim();
}

const SILENT_MARK = '@allow-silent';
const offenders: string[] = [];
let silentTotal = 0;

for (const file of [...walk('src/main'), ...walk('src/renderer/src')]) {
  const text = readFileSync(file, 'utf-8');

  // 一、块 catch：catch { … } / catch (e) { … }
  const re = /catch\s*(?:\([^)]*\))?\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close === -1) continue;
    const body = text.slice(open + 1, close);
    if (stripComments(body) !== '') continue;
    silentTotal += 1;
    if (!body.includes(SILENT_MARK)) {
      const line = text.slice(0, open).split('\n').length;
      offenders.push(`${file}:${line} 空 catch 没有写 ${SILENT_MARK} 与理由`);
    }
  }

  // 二、箭头 catch：.catch(() => {})
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (!/\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)?/.test(line)) return;
    silentTotal += 1;
    const near = `${lines[i - 1] ?? ''}\n${line}`;
    if (!near.includes(SILENT_MARK)) offenders.push(`${file}:${i + 1} 空 .catch(() => {}) 没有写 ${SILENT_MARK} 与理由`);
  });
}

ok(offenders.length === 0, `代码里 ${silentTotal} 处静默 catch 全部写明理由`, offenders.join('；'));
ok(silentTotal > 0, '静默 catch 扫描确实扫到了东西（扫描本身没坏）', '扫到 0 处，多半是正则没匹配上');

/* ────────────────────────────────────────────────────────────── */

console.log(`\njsonl 用例目录：${sandbox}（留着便于手查，不自动删）`);

if (failed.length) {
  console.error(`\n✗ 稳健性契约失败 ${failed.length} 项（通过 ${passed} 项）`);
  for (const f of failed) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ 稳健性契约通过 ${passed} 项`);
