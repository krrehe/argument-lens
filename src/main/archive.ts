import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type {
  ArchiveHealth,
  ArchiveIndexState,
  ArchiveIssue,
  Diagnosis,
  ReportMeta,
  ReportProbe,
  UsageRecord,
} from '@shared/types';
import type { PriorPassage } from '@shared/sameness';
import type { AgreementItem } from '@shared/agreement';

/**
 * 报告存档。
 *
 * 为什么要有它：这个工具的闭环断在最后一步——它给修补建议，但修补版从来没被重新判过。
 * 「这样补就站得住」于是只是另一句没有依据的话。要接上这段，就必须能把上一份留着，
 * 等新版出来后摆在一起看。所以存档不是「历史记录功能」，是**修订验收的前提**。
 *
 * 存储形状：
 *   archive/<id>.json     完整报告，一份一个文件
 *   archive/index.json    元数据数组，列表页只读它
 *
 * 为什么不把报告塞进一个 jsonl：一份报告几十到几百 KB，列表页要读几十份，
 * 一次 IO 读全部会明显卡；而列表真正需要的只是 level / 字数 / 时间这几项。
 *
 * 为什么索引能重建：索引和文件是两份数据，永远可能不同步（用户手动删文件、
 * 写到一半断电）。规则是「文件是真相，索引是缓存」——索引读不到就扫目录重建，
 * 宁可慢一次，也不要让用户的报告因为一个 json 坏掉就全部消失。
 */

function archiveDir(): string {
  const dir = join(app.getPath('userData'), 'archive');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function archiveDirPath(): string {
  return archiveDir();
}

function indexPath(): string {
  return join(archiveDir(), 'index.json');
}

function reportPath(id: string): string {
  // id 由本程序生成（时间戳-随机），不含路径分隔符；这里再挡一次，防的是将来改 id 规则时引入穿越
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '');
  return join(archiveDir(), `${safe}.json`);
}

/** 错误信息只取一句、截短：不把文件正文或本机路径拼进界面文案。 */
function reasonText(err: unknown, fallback: string): string {
  const msg = (err as Error)?.message ?? fallback;
  return String(msg).replace(/\s+/g, ' ').slice(0, 160) || fallback;
}

/**
 * 一份报告至少要有哪些字段才算「能打开」。
 *
 * 判据来自界面实际会读的东西（`App.tsx` 的 `setDiag(d)` 之后立刻取
 * `passage / theory / mode / verdict`，`metaOf` 还要 `checks`）。判据只有一份：
 * 目录扫描、索引重建、单份探测都用 `reportShapeIssue()`，不然同一个文件
 * 可能在样本账里算好、在历史上点开却是空的——两处看起来都正常。
 */
function reportShapeIssue(d: unknown): string | null {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return '文件能解析，但顶层不是一份报告';
  const x = d as Partial<Diagnosis>;
  if (typeof x.id !== 'string' || !x.id) return '缺少 id';
  if (typeof x.passage !== 'string') return '缺少原文 passage';
  if (typeof x.createdAt !== 'number') return '缺少时间 createdAt';
  if (!x.theory) return '缺少透镜 theory';
  if (!x.verdict) return '缺少判读 verdict';
  if (!Array.isArray(x.checks)) return '缺少检查项 checks';
  return null;
}

/**
 * 本会话里索引有没有坏过。
 *
 * 索引坏了 `readIndex()` 会立刻从磁盘重建（这是有意的设计），重建之后
 * 文件又变成合法 JSON——于是一次「只读体检」如果晚于列表加载跑，
 * 就再也看不出它坏过。留一个本会话的记忆，界面才能说「刚才读到过损坏」，
 * 而不是把已经发生过的自愈伪装成一切如常。
 */
let indexIssueSinceBoot: string | null = null;

function excerptOf(passage: string): string {
  return passage.replace(/\s+/g, ' ').trim().slice(0, 72);
}

function metaOf(d: Diagnosis, cost: number | null, bytes: number): ReportMeta {
  return {
    id: d.id,
    at: d.createdAt,
    theory: d.theory,
    mode: d.mode,
    parentId: d.parentId,
    chars: d.passage.length,
    excerpt: excerptOf(d.passage),
    level: d.verdict.level,
    open: d.checks.filter((c) => c.answer === 'unanswered').length,
    cost,
    bytes,
  };
}

interface IndexRaw {
  state: ArchiveIndexState;
  reason: string | null;
  entries: ReportMeta[];
}

/**
 * 裸读索引：**只读，不重建、不写盘**。
 *
 * 与 `readIndex()` 分开的理由：体检是「看一眼」，看一眼不该改写 index.json。
 * 列表通道仍按老规则自愈（文件是真相，索引是缓存），但自愈发生过要留痕。
 */
function readIndexRaw(): IndexRaw {
  const p = indexPath();
  if (!existsSync(p)) return { state: 'missing', reason: '索引文件不存在', entries: [] };
  let text: string;
  try {
    text = readFileSync(p, 'utf-8');
  } catch (err) {
    return { state: 'invalid', reason: `索引文件读不出来：${reasonText(err, '原因不明')}`, entries: [] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { state: 'invalid', reason: `索引 JSON 解析失败：${reasonText(err, '格式不对')}`, entries: [] };
  }
  if (!Array.isArray(raw)) return { state: 'invalid', reason: '索引不是数组', entries: [] };
  const entries = raw.filter((m: any) => m && typeof m.id === 'string') as ReportMeta[];
  if (!raw.length) return { state: 'empty', reason: null, entries };
  return { state: 'ok', reason: null, entries };
}

function readIndex(): ReportMeta[] {
  const raw = readIndexRaw();
  if (raw.state === 'ok' || raw.state === 'empty') return raw.entries;
  /* 坏过就记住：重建会把文件改成合法 JSON，之后再来体检就看不出这一段了。 */
  indexIssueSinceBoot = raw.reason ?? raw.state;
  return rebuildIndex();
}

function writeIndex(list: ReportMeta[]): void {
  const p = indexPath();
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(list, null, 0), 'utf-8');
  renameSync(tmp, p);
}

/**
 * 从磁盘重建索引。索引丢了不该让报告也跟着「消失」——
 * 文件还在，只是没人记得它们。
 */
function rebuildIndex(): ReportMeta[] {
  const dir = archiveDir();
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');
  } catch {
    // @allow-silent: 目录都列不出来时返回空列表，让调用方照常走完；
    // archiveHealth() 会把 dirError 报给界面，界面因此不会说「还没有报告」。
    return [];
  }
  const out: ReportMeta[] = [];
  for (const f of files) {
    try {
      const d = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Diagnosis;
      /* 与体检、单份探测同一个判据。跳过的文件由 archiveHealth() 逐个点名。 */
      if (reportShapeIssue(d)) continue;
      const bytes = Buffer.byteLength(JSON.stringify(d), 'utf-8');
      out.push(metaOf(d, null, bytes));
    } catch {
      // @allow-silent: 单个坏文件不拖垮整次重建。文件还在磁盘上（没被删），
      // 下次重建仍会扫到它；索引是缓存，文件是真相。
    }
  }
  out.sort((a, b) => b.at - a.at);
  if (out.length) writeIndex(out);
  return out;
}

export function listReports(): ReportMeta[] {
  return readIndex().sort((a, b) => b.at - a.at);
}

/**
 * 所有存档报告的原文。「这段跑过没有」与「样本账」共用这一次扫描。
 *
 * 为什么不走索引：索引里只存了 72 字的摘要，比字面重合度太短了——
 * 两段 72 字的开头能对上，全文可能差了三分之二。所以这里读全文。
 *
 * 要不要缓存：实测 102 份报告、1.8MB，读完解析共 19ms。19ms 不值得为它
 * 引入一个缓存，而缓存一旦漏了失效时机，就会在用户删掉报告之后继续说
 * 「跑过 89 次」——一个只在删过报告的人身上出现的假话。宁可每次重读。
 *
 * 读不出来的文件**要数出来**：以前这里直接跳过，比较时少几份没人知道；
 * 样本账要说的正是「本机一共几份」，跳过任何一个都会让那句话听起来完整，
 * 而它不完整。`badFiles` 沿 IPC 回界面，`dirError` 表示连目录都打不开——
 * 这时数目根本不可信，界面必须说读不出来，而不是显示「还没有报告」。
 */
export interface PassageScan {
  items: PriorPassage[];
  badFiles: number;
  /** 目录打不开时的原因；null 表示读到了目录。 */
  dirError: string | null;
}

interface DirScan {
  diagnoses: Diagnosis[];
  /** 目录里所有 .json（不含 index.json）的文件名，用来和索引交叉比对 */
  files: string[];
  issues: ArchiveIssue[];
  dirError: string | null;
}

/**
 * 扫一遍存档目录，把读得出来的报告都解出来。
 *
 * 三个调用者要的东西不同（样本账要原文、同题复跑要整份报告、体检要点名坏文件），
 * 但「哪些文件读不出来」必须只有一个答案——分开写三份循环，迟早有一份忘了计数，
 * 于是同一台机器上两处说出的份数不一样，而两处看起来都完全正常。
 */
function scanDir(): DirScan {
  const dir = archiveDir();
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');
  } catch (err) {
    return { diagnoses: [], files: [], issues: [], dirError: reasonText(err, '目录读不出来') };
  }
  const diagnoses: Diagnosis[] = [];
  const issues: ArchiveIssue[] = [];
  for (const f of files) {
    let text: string;
    try {
      text = readFileSync(join(dir, f), 'utf-8');
    } catch (err) {
      issues.push({ file: f, kind: 'unreadable', reason: reasonText(err, '文件读不出来'), bytes: 0 });
      continue;
    }
    let d: unknown;
    try {
      d = JSON.parse(text);
    } catch (err) {
      issues.push({
        file: f,
        kind: 'invalid-json',
        reason: `JSON 解析失败：${reasonText(err, '格式不对')}`,
        bytes: Buffer.byteLength(text, 'utf-8'),
      });
      continue;
    }
    const shape = reportShapeIssue(d);
    if (shape) {
      issues.push({ file: f, kind: 'incomplete', reason: shape, bytes: Buffer.byteLength(text, 'utf-8') });
      continue;
    }
    diagnoses.push(d as Diagnosis);
  }
  return { diagnoses, files, issues, dirError: null };
}

export function passageScan(): PassageScan {
  const scan = scanDir();
  if (scan.dirError) return { items: [], badFiles: 0, dirError: scan.dirError };
  return {
    items: scan.diagnoses.map((d) => ({ id: d.id, at: d.createdAt, passage: d.passage })),
    badFiles: scan.issues.length,
    dirError: null,
  };
}

export interface ReportScan {
  items: AgreementItem[];
  badFiles: number;
  dirError: string | null;
}

/**
 * 同题复跑要整份报告。与样本账共用同一次目录扫描与同一套坏文件计数。
 *
 * 版本与指纹缺失时给 null，不给空串：界面要能说「版本未知」，
 * 而空串会被拼成「v」，读起来像一个真的版本号。
 */
export function reportScan(): ReportScan {
  const scan = scanDir();
  if (scan.dirError) return { items: [], badFiles: 0, dirError: scan.dirError };
  const items: AgreementItem[] = scan.diagnoses.map((d) => {
    /* 模型原文不进比对：它比报告长十倍，比它等于把「模型换个说法」与「报告真的变了」
       混成一件事（flatten 也会跳过它，这里先摘掉少传几 MB）。 */
    const report: Record<string, unknown> = { ...d };
    delete report.raw;
    return {
      id: d.id,
      at: d.createdAt,
      mode: d.mode ?? '',
      theory: d.theory ?? '',
      version: d.prompt?.version ?? null,
      fingerprint: d.prompt?.fingerprint ?? null,
      passage: d.passage,
      report,
    };
  });
  return { items, badFiles: scan.issues.length, dirError: null };
}

export function allPassages(): PriorPassage[] {
  return passageScan().items;
}

export function getReport(id: string): Diagnosis | null {
  const p = reportPath(id);
  if (!existsSync(p)) return null;
  try {
    const d = JSON.parse(readFileSync(p, 'utf-8')) as Diagnosis;
    /* 能解析不等于能显示：缺 verdict / passage 的报告会把整屏渲染成空白。
       这里退回 null，至于「文件不在」还是「文件写坏了」由 probeReport() 说清楚。 */
    return reportShapeIssue(d) ? null : d;
  } catch {
    /* 文件存在但读不出来。getReport 的签名只有「报告或 null」（smoke 与多处调用
       都依赖它），原因不能塞进返回值里，改由 archive:probe 单独问一次。 */
    return null;
  }
}

/**
 * 单份探测。只读，不删、不修、不改写。
 *
 * 存在的理由是一个具体症状：点在历史里的一份坏报告上，屏幕毫无变化。
 * `openReport` 原本写 `if (!d) return`，`.catch` 接得住 IPC 抛错却接不住 null，
 * 用户只能以为自己没点中——尽管那段代码的注释正写着「读不出来要说出来」。
 */
export function probeReport(id: string): ReportProbe {
  const p = reportPath(id);
  const file = basename(p);
  if (!existsSync(p)) return { state: 'missing', file, reason: '磁盘上没有这个文件' };
  let text: string;
  try {
    text = readFileSync(p, 'utf-8');
  } catch (err) {
    return { state: 'unreadable', file, reason: reasonText(err, '文件读不出来') };
  }
  let d: unknown;
  try {
    d = JSON.parse(text);
  } catch (err) {
    return { state: 'invalid-json', file, reason: `JSON 解析失败：${reasonText(err, '格式不对')}` };
  }
  const shape = reportShapeIssue(d);
  return shape ? { state: 'incomplete', file, reason: shape } : { state: 'ok', file, reason: null };
}

/**
 * 本机存档的一次只读体检。
 *
 * 它只回答「哪些东西读不出来、索引和文件对不对得上」，**不修任何东西**：
 * 不删坏文件、不重建索引、不覆盖报告。自动修复听起来贴心，但用户还没看清
 * 少了什么就被改了盘，比看到一个红条更糟。要看文件本身用「打开报告文件夹」。
 *
 * `dirError` 非空时任何数字都不可信，因此 missing / orphans 直接留空，
 * 界面必须说「目录读不出来」，不能说「一份报告也没有」。
 */
export function archiveHealth(): ArchiveHealth {
  const scan = scanDir();
  const raw = readIndexRaw();
  const indexState: ArchiveIndexState =
    indexIssueSinceBoot && (raw.state === 'ok' || raw.state === 'empty') ? 'rebuilt' : raw.state;
  const indexReason =
    indexState === 'rebuilt'
      ? `本会话读到过损坏（${indexIssueSinceBoot}），列表已按磁盘文件重建；报告文件没有被改写`
      : raw.reason;
  /* 用文件名而不是报告内的 id 做交叉比对：坏文件根本解不出 id。
     saveReport 写的文件名就是 id，两种口径在正常文件上是一致的。 */
  const diskNames = new Set(scan.files.map((f) => f.replace(/\.json$/, '')));
  const indexIds = raw.entries.map((m) => String(m.id));
  const indexSet = new Set(indexIds);
  return {
    checkedAt: Date.now(),
    dirError: scan.dirError,
    issues: scan.issues,
    healthyFiles: scan.diagnoses.length,
    indexState,
    indexReason,
    indexEntries: raw.entries.length,
    missing: scan.dirError ? [] : indexIds.filter((id) => !diskNames.has(id)),
    orphans: scan.dirError ? [] : [...diskNames].filter((n) => !indexSet.has(n)).sort(),
  };
}

/**
 * 存一份报告。每次分析成功都自动存——不设「手动存档」按钮。
 *
 * 理由：修订对照要求 parent 在场。如果存档靠手点，用户跑修补版时上一版多半没存，
 * 那条最该看的对照就永远看不到了。自动存的代价是占点磁盘，几十 MB 量级，
 * 比「关键对照缺失」便宜得多。
 */
export function saveReport(d: Diagnosis, usage?: UsageRecord | null): ReportMeta[] {
  const p = reportPath(d.id);
  const body = JSON.stringify(d);
  /*
   * 先写临时文件再改名，和索引、账本、设置三处保持同一种写法。
   *
   * 直接写目标文件的话，写到一半断电会留下半截 JSON：getReport 解不开、
   * rebuildIndex 会跳过它，而索引里那条元数据还在——列表上有一行，
   * 点开是空的。改名的原子性把「半份报告」这个状态整个消掉了。
   */
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, body, 'utf-8');
  renameSync(tmp, p);

  const cost = usage && usage.priced ? usage.cost : null;
  const meta = metaOf(d, cost, Buffer.byteLength(body, 'utf-8'));

  const list = readIndex().filter((m) => m.id !== d.id);
  list.unshift(meta);
  list.sort((a, b) => b.at - a.at);
  writeIndex(list);
  return list;
}

export function removeReport(id: string): ReportMeta[] {
  const p = reportPath(id);
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    // @allow-silent: 文件删不掉也要把索引清掉，否则列表里留一条点开是空的幽灵。
    // 删不掉通常是权限或占用，用户会在文件夹里看到那个文件本身。
  }
  const list = readIndex().filter((m) => m.id !== id);
  writeIndex(list);
  return list.sort((a, b) => b.at - a.at);
}

/** 取某一份的上一版。修订对照靠它找 parent。 */
export function getParent(d: Diagnosis): Diagnosis | null {
  return d.parentId ? getReport(d.parentId) : null;
}
