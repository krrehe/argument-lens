import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Diagnosis, ReportMeta, UsageRecord } from '@shared/types';
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

function readIndex(): ReportMeta[] {
  const p = indexPath();
  if (!existsSync(p)) return rebuildIndex();
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8'));
    if (!Array.isArray(raw)) return rebuildIndex();
    return raw.filter((m: any) => m && typeof m.id === 'string') as ReportMeta[];
  } catch {
    return rebuildIndex();
  }
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
    return [];
  }
  const out: ReportMeta[] = [];
  for (const f of files) {
    try {
      const d = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Diagnosis;
      if (!d?.id || !d.theory || !d.verdict) continue;
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
  badFiles: number;
  dirError: string | null;
}

/**
 * 扫一遍存档目录，把读得出来的报告都解出来。
 *
 * 三个调用者要的东西不同（样本账要原文、同题复跑要整份报告、历史列表读索引），
 * 但「哪些文件读不出来」必须只有一个答案——分开写三份循环，迟早有一份忘了计数，
 * 于是同一台机器上两处说出的份数不一样，而两处看起来都完全正常。
 */
function scanDir(): DirScan {
  const dir = archiveDir();
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');
  } catch (err) {
    return { diagnoses: [], badFiles: 0, dirError: (err as Error)?.message ?? '原因不明' };
  }
  const diagnoses: Diagnosis[] = [];
  let badFiles = 0;
  for (const f of files) {
    try {
      const d = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Diagnosis;
      if (!d?.id || typeof d.passage !== 'string' || typeof d.createdAt !== 'number') {
        badFiles += 1;
        continue;
      }
      diagnoses.push(d);
    } catch {
      badFiles += 1;
    }
  }
  return { diagnoses, badFiles, dirError: null };
}

export function passageScan(): PassageScan {
  const scan = scanDir();
  if (scan.dirError) return { items: [], badFiles: 0, dirError: scan.dirError };
  return {
    items: scan.diagnoses.map((d) => ({ id: d.id, at: d.createdAt, passage: d.passage })),
    badFiles: scan.badFiles,
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
  return { items, badFiles: scan.badFiles, dirError: null };
}

export function allPassages(): PriorPassage[] {
  return passageScan().items;
}

export function getReport(id: string): Diagnosis | null {
  const p = reportPath(id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as Diagnosis;
  } catch {
    return null;
  }
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
