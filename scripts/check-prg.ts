/**
 * 「导出画布工程」的断言：报告摊成一张图、图压成 `.prg` 的字节，两层都验。
 *
 * 为什么这一条值得单开：它是这个项目里**唯一一个要把字节交给别的软件**的出口。
 * 前两个导出（Markdown / Argdown）对方读不懂顶多是难看；这个读不懂就是
 * 「文件打不开」，而用户看不出是哪一步错了——他会以为报告坏了。
 *
 * 三种失败都不会自己喊出来，所以逐条守住：
 *   1. 节点上的字被改（截断、加前缀、润色）→ 结构还在，内容已经不是你写的那段；
 *   2. 线指到空处（targetId 不存在）→ 对方的打开流程可能整份报错；
 *   3. 字节写歪（msgpack 类型、zip 的 CRC / 偏移）→ CRC 对不上，对方判文件损坏。
 *
 * 防恒真的做法写在样本里：
 *   - 「逐字来自报告」配一份**改了半个字**的副本，它必须红；
 *   - 「连线方向」配一条反向也能通过的样本（两条边反向），只验「有连线」会绿；
 *   - 「容器能被读回来」用**别人的解析器**读（`@msgpack/msgpack`、`@zip.js/zip.js`，
 *     devDependency，不进包）。自己写的解码器读自己写的编码器，两边一起错也全绿。
 *
 * 跑法：npm run check:prg
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decode } from '@msgpack/msgpack';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';
import { normalizeDiagnosis } from '../src/main/analyze';
import type { Claim, Conclusion, Diagnosis, Refutation, Scope } from '@shared/types';
import { graphOf, graphSummary, prgFileName, type PrgNode } from '@shared/prg-graph';
import { PRG_TARGET_VERSION, buildPrg, encodeMsgpack, stageObjects, zipStore } from '@shared/prg-pack';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}

/* ─────────── 样本 ─────────── */

const P = '我们学校去年取消了早读，今年高考一本率下降了六个百分点。这说明取消早读是错的。';
const ACC = { status: 'acceptable' as const, reason: '' };

const claim = (id: string, role: Claim['role'], text: string, supports: string[] = []): Claim => ({
  id,
  role,
  text,
  supports,
  quote: null,
  span: null,
  implicit: false,
  implicitBasis: null,
  burden: 'proponent',
  acceptability: ACC,
});
const conclusion = (id: string, text: string): Conclusion => ({
  ...claim(id, 'conclusion', text),
  modalOverreach: false,
  modalNote: '',
});
const ref = (id: string, targetId: string, claimText: string, checkId: string | null = null): Refutation => ({
  id,
  targetId,
  checkId,
  strategy: 'premise-unsupported',
  claim: claimText,
  script: '话术',
  steelman: '对方会回',
  reply: '我方接法',
  evidenceNeeded: [],
  burdenAfter: 'proponent',
  tag: 'inferred',
  confidence: 'medium',
});

const base = normalizeDiagnosis({}, P, 'walton', { mode: 'diagnose', id: 'p1', createdAt: 1 });

/** 一份什么都有：两个前提、一个中间结论、两条反驳、一个缺口。 */
const FULL: Diagnosis = {
  ...base,
  premises: [
    claim('P1', 'premise', '去年取消了早读', []),
    claim('P2', 'premise', '今年一本率下降六点', ['C']),
  ],
  intermediate: [claim('M1', 'intermediate', '取消早读与一本率下降有关', ['C'])],
  conclusion: conclusion('C', '取消早读是错的'),
  scope: { applicable: true, reason: '是论证', outOfScopeAt: null, partialNote: null } as Scope,
  refutations: [ref('R1', 'P1', '「取消早读」与「一本率下降」之间还差一层'), ref('R2', 'C', '同期另有教学安排变动')],
  repair: {
    missingPremise: '若取消早读，则一本率会下降',
    alternativeReading: null,
    answerable: [],
    burdenStatus: '在提议者',
    repairedForm: 'P1；P2；若取消早读则一本率下降 ∴ C',
  },
};

/** 只有结论：没有前提、没有反驳、没有补法。导出不该抛，也不该画出一堆空节点。 */
const BARE: Diagnosis = { ...base, premises: [], intermediate: [], refutations: [] };

/** 有一条反驳打在不存在的目标上：必须被数出来，而不是画一根指向空处的线。 */
const DANGLING: Diagnosis = {
  ...FULL,
  refutations: [...FULL.refutations, ref('R9', 'P404', '这一条打的是不存在的前提')],
};

/** 有一条前提的文本是空的：不许变出一个空节点。 */
const EMPTY: Diagnosis = {
  ...FULL,
  premises: [...FULL.premises, claim('P9', 'premise', '   ')],
};

const G = graphOf(FULL);

/*
 * 守卫：下面一半断言都建立在「这份样本摊出来是完整的图」上。
 * 对照组破了会连带红一片，读日志的人看不见真正坏掉的那一条。
 */
if (G.nodes.length === 0 || G.edges.length === 0) {
  console.error(`
check:prg 失败：对照组不成立——什么都有的样本摊成了 ${G.nodes.length} 个节点、${G.edges.length} 条线。`);
  process.exit(1);
}

/* ─────────── 一、图：节点的字一个字都不新写 ─────────── */

/** 报告里所有可以成为节点文本的字符串。逐字比对用这个集合，不靠「看起来像」。 */
const REPORT_TEXTS = new Set<string>([
  FULL.conclusion.text,
  ...FULL.premises.map((c) => c.text),
  ...FULL.intermediate.map((c) => c.text),
  ...FULL.refutations.map((r) => r.claim),
  FULL.repair.missingPremise ?? '',
]);

ok(G.nodes.length === 7, '节点数＝结论1＋前提2＋中间1＋反驳2＋缺口1', String(G.nodes.length));
ok(
  G.nodes.every((n) => REPORT_TEXTS.has(n.text)),
  '每个节点的文本都能在报告里找到逐字相同的一处',
  G.nodes.filter((n) => !REPORT_TEXTS.has(n.text)).map((n) => `${n.key}:${n.text}`).join(' | '),
);
/* 反证用：把其中一个字改掉，上面那条必须红——所以这里先证明「改一个字确实不在集合里」。 */
ok(
  !REPORT_TEXTS.has(`${FULL.conclusion.text}。`),
  '对照组：末尾多一个句号就已经不算逐字相同（这条不成立，上面那条就查不出改写）',
);
ok(
  G.nodes.map((n) => n.key).sort().join(',') === ['C', 'M1', 'P1', 'P2', 'R1', 'R2', 'missing-premise'].sort().join(','),
  '节点 key 就是报告里的 id（连线才找得到两端）',
  G.nodes.map((n) => n.key).join(','),
);
ok(
  G.nodes.filter((n) => n.role === 'conclusion').length === 1 &&
    G.nodes.filter((n) => n.role === 'gap').length === 1,
  '结论与缺口各只有一个',
);

/* ─────────── 二、图：线只来自报告里已有的关系 ─────────── */

const has = (from: string, to: string) => G.edges.some((e) => e.from === from && e.to === to);

ok(has('P1', 'C'), 'supports 为空的前提按最朴素的重构连到结论（与结构图、Argdown 导出同一条规则）');
ok(has('P2', 'C'), 'supports 指了结论的前提连到结论');
ok(
  !has('P1', 'P2') && !has('P2', 'P1'),
  '两条前提之间没有被凭空连起来（只验「有线」会让乱连也绿）',
);
ok(has('M1', 'C'), '中间结论连到自己声明的目标');
ok(has('R1', 'P1'), '反驳连到它打的那一处');
ok(has('R2', 'C'), '打在结论上的反驳连到结论');
ok(has('missing-premise', 'C'), '缺口连到结论（补上它才接得上）');
ok(
  G.edges.every((e) => G.nodes.some((n) => n.key === e.from) && G.nodes.some((n) => n.key === e.to)),
  '每条线的两端都是图上存在的节点',
  G.edges.filter((e) => !G.nodes.some((n) => n.key === e.from || n.key === e.to)).map((e) => `${e.from}→${e.to}`).join(','),
);

/* ─────────── 三、图：丢掉的必须数出来 ─────────── */

const gd = graphOf(DANGLING);
ok(gd.stats.dangling === 1, '打在不存在的目标上的反驳被数出来', String(gd.stats.dangling));
ok(
  !gd.edges.some((e) => e.to === 'P404'),
  '没有画出一根指向空处的线（数出来 ≠ 照画不误）',
);
ok(gd.nodes.some((n) => n.key === 'R9'), '那条反驳本身仍在图上——丢掉的是线，不是那句话');
ok(graphSummary(gd).includes('没指到主张'), '统计句把这个丢失说出来', graphSummary(gd));

const ge = graphOf(EMPTY);
ok(ge.stats.empty === 1, '文本为空的前提被数出来', String(ge.stats.empty));
ok(
  ge.nodes.every((n) => n.text.trim() !== ''),
  '图上没有空节点',
);
ok(!graphSummary(ge).includes('undefined'), '统计句里不会漏出 undefined', graphSummary(ge));

const gb = graphOf(BARE);
ok(gb.nodes.length === 1 && gb.edges.length === 0, '只有结论的报告照样能导（1 个节点、0 条线）', `${gb.nodes.length}/${gb.edges.length}`);
ok(graphSummary(gb) === '1 个节点、0 条连线', '没有丢失时统计句不啰嗦', graphSummary(gb));

/* ─────────── 四、图：坐标不叠、可复算 ─────────── */

function overlap(a: PrgNode, b: PrgNode): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
const pairs: string[] = [];
for (let i = 0; i < G.nodes.length; i++) {
  for (let j = i + 1; j < G.nodes.length; j++) {
    if (overlap(G.nodes[i], G.nodes[j])) pairs.push(`${G.nodes[i].key}×${G.nodes[j].key}`);
  }
}
ok(pairs.length === 0, '导出的坐标两两不叠（打开就是一张草图，不是一团）', pairs.join(','));
ok(
  G.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y) && n.w > 0 && n.h > 0),
  '每个节点的坐标与尺寸都是有限正数',
);
ok(JSON.stringify(graphOf(FULL)) === JSON.stringify(G), '同一份报告两次摊出来的图完全一样');
/* 反证用：把两个节点的 x 改成一样，overlap 必须能发现——否则上面的「不叠」是恒真。 */
ok(overlap({ ...G.nodes[0], x: G.nodes[1].x, y: G.nodes[1].y } as PrgNode, G.nodes[1]), '对照组：重叠真的能被检测出来');

/* ─────────── 五、字节：别人的解析器读得回来 ─────────── */

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const ROUND: unknown[] = [
  null,
  true,
  false,
  0,
  127,
  -1,
  -32,
  -33,
  300,
  -70000,
  1.5,
  '一段中文',
  'x'.repeat(200),
  [],
  { nested: { deep: [1, 'two', null] } },
];
ok(same(decode(encodeMsgpack(ROUND)), ROUND), 'msgpack 编完能被 @msgpack/msgpack 解回同一棵树');

const FLOATS = [0.01, 0.99, -0.5, 1e-7];
ok(same(decode(encodeMsgpack(FLOATS)), FLOATS), '小数不被压精度（连接点比例就靠它）');

const ZIP = await (async () => {
  try {
    const bytes = zipStore([
      { name: 'a.txt', data: new TextEncoder().encode('hello') },
      { name: 'b.bin', data: new Uint8Array([0, 1, 2, 255]) },
    ]);
    const reader = new ZipReader(new Uint8ArrayReader(bytes));
    const entries = await reader.getEntries();
    const out: { name: string; data: number[] }[] = [];
    for (const e of entries) {
      const d = await e.getData!(new Uint8ArrayWriter());
      out.push({ name: e.filename, data: Array.from(d) });
    }
    await reader.close();
    return out;
  } catch (e) {
    return [{ name: `读失败：${(e as Error).message}`, data: [] }];
  }
})();
ok(
  same(
    ZIP.map((z) => z.name),
    ['a.txt', 'b.bin'],
  ),
  'zip 的条目名与顺序被 @zip.js/zip.js 读回来',
  ZIP.map((z) => z.name).join(','),
);
ok(same(ZIP[1]?.data, [0, 1, 2, 255]), '条目内容逐字节一致（CRC 与偏移都对）', JSON.stringify(ZIP[1]?.data));

const PRG = buildPrg(G);
const files = await (async () => {
  const reader = new ZipReader(new Uint8ArrayReader(PRG));
  const entries = await reader.getEntries();
  const map = new Map<string, Uint8Array>();
  for (const e of entries) map.set(e.filename, await e.getData!(new Uint8ArrayWriter()));
  await reader.close();
  return map;
})();

ok(
  Array.from(files.keys()).join(',') === 'stage.msgpack,tags.msgpack,reference.msgpack,metadata.msgpack',
  '工程文件里四个条目齐全',
  Array.from(files.keys()).join(','),
);
/*
 * 这里的 `'2.7.0'` 是**第二处独立的真值**，不是 `PRG_TARGET_VERSION`。
 * 第一版写的就是那个常量，于是这条断言等于「自己等于自己」——把常量改成 2.6.0
 * 照样全绿（反证时抓到的）。能守住的写法只有一种：把「对方现在的版本」抄成字面量，
 * 出处是对方仓库 `LATEST_PROJECT_VERSION`（2026-11-08 核）。
 * 它红了意味着两件事之一：我们的常量被改了，或者对方发版了——两种都该有人看一眼。
 */
ok(
  same(decode(files.get('metadata.msgpack')!), { version: '2.7.0' }),
  '版本号写成对方当前的工程格式版本（写错会被当旧文件走升级路径）',
  JSON.stringify(decode(files.get('metadata.msgpack')!)),
);
ok(PRG_TARGET_VERSION === '2.7.0', '代码里的常量与这条断言说的是同一个版本', PRG_TARGET_VERSION);
ok(same(decode(files.get('tags.msgpack')!), []), 'tags 是空数组');
ok(
  same(decode(files.get('reference.msgpack')!), { sections: {}, files: [] }),
  'reference 是空引用表（我们没有附件）',
);

const stage = decode(files.get('stage.msgpack')!) as Record<string, any>[];
const textNodes = stage.filter((o) => o._ === 'TextNode');
const edges = stage.filter((o) => o._ === 'LineEdge');
ok(textNodes.length === G.nodes.length, 'stage 里的文本节点数＝图上的节点数', `${textNodes.length}/${G.nodes.length}`);
ok(edges.length === G.edges.length, 'stage 里的连线数＝图上的连线数', `${edges.length}/${G.edges.length}`);
ok(
  textNodes.every((n, i) => n.text === G.nodes[i].text),
  'stage 里每个节点的文本与图上逐字相同（顺序也一致）',
);
ok(
  stage.every((o) => typeof o._ === 'string'),
  'stage 里每个元素都带类名（没有裸对象混进去）',
  stage.filter((o) => typeof o._ !== 'string').length.toString(),
);

/*
 * 引用：`{ $: "/3" }` 指向数组下标。这一条是「线真的连对了」的全部证据——
 * 只验「有一条线」的话，两端写反、或者指向别人，照样绿。
 */
function resolveRef(r: unknown): Record<string, any> | null {
  const path = (r as { $?: string })?.$;
  if (typeof path !== 'string' || !path.startsWith('/')) return null;
  const idx = Number(path.slice(1));
  return Number.isInteger(idx) && stage[idx] ? stage[idx] : null;
}
const edgeChecks = G.edges.map((e, i) => {
  const s = resolveRef(edges[i]?.associationList?.[0]);
  const t = resolveRef(edges[i]?.associationList?.[1]);
  const fi = G.nodes.findIndex((n) => n.key === e.from);
  const ti = G.nodes.findIndex((n) => n.key === e.to);
  return s === stage[fi] && t === stage[ti];
});
ok(edgeChecks.every(Boolean), '每条线的两端按 from→to 的顺序指向正确的节点', `${edgeChecks.filter((x) => !x).length} 条指错`);

ok(
  same(Array.from(buildPrg(G)), Array.from(PRG)),
  '同一份图两次导出的字节完全相同（zip 时间字段固定，不随运行时刻变）',
);

/* ─────────── 六、字节：能被别的软件读，靠的是这份形状 ─────────── */

/*
 * 这一节不验「他们的应用能不能打开」——那件事本机没法跑（需要他们的运行时与
 * Rust 编译出的所有权 helper）。能验的是**形状的来处**：这几条字段名与顺序，
 * 来自他们自己测试夹具里构造工程文件的写法，`docs/与画布工具互通.md` 记了出处。
 * 形状一改，这几条先红，而不是等用户拿到一个打不开的文件。
 */
ok(
  textNodes.every((n) => typeof n.uuid === 'string' && n.uuid.length === 36),
  '每个文本节点都有 36 个字符的 uuid（对方的对象引用靠它）',
);
ok(
  textNodes.every((n) => n.collisionBox?._ === 'CollisionBox' && Array.isArray(n.collisionBox.shapes)),
  'collisionBox 是 CollisionBox + shapes 数组',
);
ok(
  textNodes.every((n) => n.collisionBox.shapes[0]?._ === 'Rectangle'),
  'shapes[0] 是 Rectangle（有 location / size）',
);
ok(
  textNodes.every(
    (n) => n.collisionBox.shapes[0]?.location?._ === 'Vector' && typeof n.collisionBox.shapes[0].size?.x === 'number',
  ),
  'location 与 size 都是 Vector，x/y 是数',
);
ok(
  edges.every(
    (e) =>
      e.sourceRectangleRate?._ === 'Vector' &&
      e.sourceRectangleRate.x === 0.99 &&
      e.targetRectangleRate?.x === 0.01,
  ),
  '连线的两个连接点比例按「右出左进」写',
);
ok(
  new Set(stage.map((o) => o.uuid)).size === stage.length,
  'uuid 互不重复',
  `${stage.length - new Set(stage.map((o) => o.uuid)).size} 个重复`,
);

/* ─────────── 七、接线：按钮 → 通道 → 主进程 ─────────── */

/*
 * 这一层最容易出的不是算错，是**没接上**：按钮写了、函数写了，中间的通道名
 * 两边拼得不一样。那种坏法的表现是点下去什么也不发生，而所有纯函数断言全绿。
 *
 * 两次反证：把 preload 的通道名改错一个字母，下面第二条必须红；
 * 把按钮里的 'prg' 改成 'prg2'，第一条必须红。
 */
const SRC = (p: string) => readFileSync(resolve(p), 'utf-8');
const DIAG = SRC('src/renderer/src/components/Diagnosis.tsx');
const PRE = SRC('src/preload/index.ts');
const MAIN = SRC('src/main/index.ts');

ok(/doExport\('prg'\)/.test(DIAG), '报告顶部那个按钮真的调用了 prg 导出（不是只画了个按钮）');
const channel = /exportPrg:[\s\S]{0,120}?invoke\('([^']+)'/.exec(PRE)?.[1] ?? '';
ok(channel === 'report:exportPrg', 'preload 暴露的通道名是 report:exportPrg', channel || '（没找到）');
ok(
  MAIN.includes(`ipcMain.handle('${channel}'`),
  '主进程挂的是同一个通道名（两处拼错一个字母，点下去就没有反应）',
  channel,
);
ok(
  /import \{[^}]*exportReportPrg[^}]*\} from '\.\/report-export'/.test(MAIN),
  '主进程把导出的实现 import 进来了（不是挂了一个空壳 handler）',
);
ok(
  /writeFileSync\(r\.filePath, Buffer\.from\(bytes\)\)/.test(SRC('src/main/report-export.ts')),
  '落盘写的是字节而不是字符串（字符串会改写编码，CRC 就对不上）',
);

/* ─────────── 七、文件名 ─────────── */

ok(prgFileName(FULL).endsWith('.prg'), '文件名以 .prg 结尾', prgFileName(FULL));
ok(prgFileName(FULL).includes('论证镜'), '文件名带「论证镜」，下载目录里认得出是谁导的', prgFileName(FULL));

/* ─────────── 收尾 ─────────── */

/*
 * 外部裁判的入口：设了 PRG_SAMPLE_DIR 就把样例写到那里。
 * 它不参与判断——本机的 verify 不能依赖「装好他们的 monorepo」这件事。
 * 人工复核那一步写进了 docs/与画布工具互通.md。
 */
const outDir = process.env.PRG_SAMPLE_DIR;
if (outDir) {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/sample.prg`, Buffer.from(PRG));
  console.log(`样例已写出：${outDir}/sample.prg（拿对方的 CLI 读一遍，见 docs/与画布工具互通.md）`);
}

if (failed.length) {
  for (const f of failed) console.error(`✗ ${f}`);
  console.error(`\n✗ check:prg 失败 ${failed.length} 条（通过 ${passed} 条）`);
  console.error('  这一层坏掉的后果不是难看，是「导出的文件打不开」，而用户看不出哪一步错了。');
  process.exit(1);
}
console.log(`✓ check:prg 通过 ${passed} 条｜节点逐字来自报告、线不指向空处、字节被第三方解析器读得回来`);
