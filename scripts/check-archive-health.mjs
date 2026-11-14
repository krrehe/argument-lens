/**
 * 存档体检的防腐烂检查。
 *
 * 为什么需要它：P1-4 的病根不是「少一个功能」，是**默认值把异常吞掉了**——
 * `catch { return null }`、`catch → rebuildIndex()`、`.catch(() => setLoaded(true))`，
 * 每一处单独看都很省事，合起来就是「一份报告坏了，界面说还没有」。
 * 这类改动最容易被后来的重构悄悄改回去，而且改回去之后所有功能测试照样绿：
 * 坏文件在测试机上根本不存在。
 *
 * 所以这一关守的是几件容易被删掉的东西：体检只读、null 分支有话说、
 * 空态在坏盘上不谎报、列表与全文通道的形状没被改（smoke 拿它当独立真值）。
 * 它只读源码，不跑应用、不碰任何人的存档。
 */
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const archive = read('src/main/archive.ts');
const mainIndex = read('src/main/index.ts');
const preload = read('src/preload/index.ts');
const types = read('src/shared/types.ts');
const app = read('src/renderer/src/App.tsx');
const history = read('src/renderer/src/components/History.tsx');
const styles = read('src/renderer/src/styles-history.css');
const workbench = read('src/renderer/public/workbench.html');

let n = 0;
const bad = [];
const ck = (cond, msg) => {
  n += 1;
  if (!cond) bad.push(msg);
};

/** 取一个导出函数的实现体，剥掉注释再查副作用，免得说明文字被当成调用。 */
function bodyOf(src, name) {
  const start = src.indexOf(`export function ${name}(`);
  if (start < 0) return '';
  const next = src.indexOf('\nexport function ', start + 1);
  return (next < 0 ? src.slice(start) : src.slice(start, next)).replace(/\/\*[\s\S]*?\*\//g, '');
}
const noWrite = (body) =>
  !/\b(writeFileSync|renameSync|unlinkSync|mkdirSync|appendFileSync|rebuildIndex|saveReport)\s*\(/.test(body);

/* ── 1. 两条只读通道真的存在，且类型说得上话 ── */
ck(/ipcMain\.handle\('archive:health',\s*\(\)\s*=>\s*archiveHealth\(\)\)/.test(mainIndex), '主进程没有注册 archive:health');
ck(/ipcMain\.handle\('archive:probe'/.test(mainIndex), '主进程没有注册 archive:probe');
ck(/health:\s*\(\):\s*Promise<ArchiveHealth>/.test(preload), 'preload 没有以 ArchiveHealth 暴露 health()');
ck(/probe:\s*\(id:\s*string\):\s*Promise<ReportProbe>/.test(preload), 'preload 没有以 ReportProbe 暴露 probe()');
ck(/export interface ArchiveHealth/.test(types) && /export interface ReportProbe/.test(types), 'shared/types.ts 缺体检类型');

/* ── 2. 「只读」是硬约束：看一眼面板不许改写任何文件 ── */
const healthBody = bodyOf(archive, 'archiveHealth');
const probeBody = bodyOf(archive, 'probeReport');
ck(healthBody.length > 200, '找不到 archiveHealth() 的实现体（检查器本身可能失效了）');
ck(probeBody.length > 200, '找不到 probeReport() 的实现体');
ck(noWrite(healthBody), 'archiveHealth() 里出现了写盘调用；体检必须是纯读');
ck(noWrite(probeBody), 'probeReport() 里出现了写盘调用；探测必须是纯读');
const rawStart = archive.indexOf('function readIndexRaw()');
const rawEnd = archive.indexOf('\nfunction readIndex()', rawStart);
ck(rawStart > 0 && rawEnd > rawStart, '找不到 readIndexRaw()');
ck(noWrite(archive.slice(rawStart, rawEnd).replace(/\/\*[\s\S]*?\*\//g, '')), 'readIndexRaw() 会写盘或触发重建');
ck(/indexIssueSinceBoot\s*=/.test(archive), '索引坏过没有留痕；重建之后就再也报不出来了');
ck(!/join\(dir,\s*f\)/.test(healthBody), '体检把目录路径拼进了返回结构；只能给文件名');

/* ── 3. 判据只有一处，三处读文件的地方都得用它 ── */
const shapeCalls = (archive.match(/reportShapeIssue\(/g) ?? []).length;
ck(shapeCalls >= 5, `reportShapeIssue 调用点只有 ${shapeCalls} 处，疑似又分出了第二套判据（定义 + 4 个调用点）`);
for (const kind of ['unreadable', 'invalid-json', 'incomplete']) {
  ck(archive.includes(`kind: '${kind}'`), `坏文件没有区分 ${kind}`);
}
ck(/state:\s*'missing'/.test(probeBody), '单份探测没有区分「文件不存在」');

/* ── 4. 不能为了让返回值带原因就改掉老通道的形状 ── */
ck(/ipcMain\.handle\('archive:list',\s*\(\)\s*=>\s*listReports\(\)\)/.test(mainIndex), 'archive:list 形状变了，smoke 的独立真值会失效');
ck(/ipcMain\.handle\('archive:get',\s*\(_e,\s*id:\s*string\)\s*=>\s*getReport\(id\)\)/.test(mainIndex), 'archive:get 形状变了');
ck(/health:\s*archiveHealth\(\)/.test(mainIndex), '工作台数据没有带上体检结果');

/* ── 5. 点开坏报告必须有话说，不能退回 `if (!d) return` ── */
const openStart = app.indexOf('const openReport = useCallback');
const openEnd = app.indexOf('const openPair = useCallback', openStart);
const openBody = app.slice(openStart, openEnd);
ck(openStart > 0 && openEnd > openStart, '找不到 openReport 的实现');
ck(/if\s*\(!d\)\s*\{/.test(openBody) && /archive\.probe\(id\)/.test(openBody), 'get() 给 null 时没有补问 probe()');
ck(/setNotice\(/.test(openBody), '打不开时没有把原因显示出来');
ck(!/列表里那一行可以先移除/.test(openBody), '又在劝用户删掉坏存档那一行');
ck(/const PROBE_TEXT: Record<ReportProbe\['state'\]/.test(app), 'PROBE_TEXT 没有覆盖 ReportProbe 的全部状态');

/* ── 6. 历史面板：先体检后列表、空态不谎报、异常不吞 ── */
ck(/await window\.api\.archive\.health\(\)/.test(history), '历史面板没有做体检');
ck(
  history.indexOf('await window.api.archive.health()') < history.indexOf('await window.api.archive.list()'),
  '体检排在列表后面：list() 会重建索引并写盘，坏过这件事就被抹掉了'
);
ck(/data-archive-health/.test(history) && /data-archive-issues/.test(history), '体检结果没有可见的面板与逐条详情');
ck(/data-archive-empty/.test(history) && /dirError\s*\?/.test(history), '空态没有区分「目录读不出来」与「真的还没有」');
ck(!/\.catch\(\(\)\s*=>\s*setLoaded\(true\)\)/.test(history), '列表读失败又被吞成一张空表');
ck(/没有删除、没有改写任何文件/.test(history), '没有明说体检是只读的');
ck(/\.hs-health\s*\{/.test(styles) && /\.hs-health-list\s*\{/.test(styles), '体检条没有样式定义');

/* ── 7. 回看台不能把「少读了几份」说成「本机就这些」 ── */
ck(/data-archive-alert/.test(workbench), '工作台状态栏没有存档异常提示');
ck(/const h=D\.health/.test(workbench), '工作台没有读注入的体检结果');
ck(!/全部正常/.test(workbench), '样张没有 health 时不能宣称「全部正常」');

if (bad.length) {
  for (const x of bad) console.error(`  ✗ ${x}`);
  console.error(`\n✗ 存档体检 ${bad.length}/${n} 项不合格`);
  process.exit(1);
}
console.log(`✓ 存档体检：只读、不吞异常、形状不变 ${n} 项`);
