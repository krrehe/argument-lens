import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LEDGER_VERSION,
  ledgerIdFromHash,
  type LongItem,
  type LongLedger,
} from '@shared/longform';

/**
 * 长文台账的落盘。
 *
 * 只存**索引**：每段一条，记着它跑成的报告 id、档位、字数与失败原因。
 * 报告本体在 archive/ 里，这里不复制——复制两份，迟早有一份是旧的，
 * 而读者分不清看到的是哪一份。
 *
 * 为什么值得落盘：批跑是「一次操作产生 N 份报告」，而报告在历史里是分开的。
 * 不记账，关掉窗口之后那 N 份报告就只剩 N 个孤立的文件名，
 * 「它们来自同一篇文章、分别是第几段」这件事再也拼不回来。
 *
 * 形状：
 *   longform/<id>.json   一条账，一份一个文件
 * 不做索引文件：账的数量是「一人一天几篇」，扫目录足够快，
 * 少一份索引就少一处可能与文件不同步的地方（archive 的索引是不得已，
 * 它要按时间排几十上百份；这里不需要）。
 */

function longformDir(): string {
  const dir = join(app.getPath('userData'), 'longform');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function longformDirPath(): string {
  return longformDir();
}

function ledgerPath(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '');
  return join(longformDir(), `${safe}.json`);
}

/** 只保留台账要用的字段：界面传来什么就存什么，等于把渲染层的临时状态也写进磁盘。 */
function cleanItem(raw: unknown): LongItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const it = raw as Partial<LongItem>;
  const job = it.job;
  if (!job || typeof job !== 'object') return null;
  if (typeof job.index !== 'number' || typeof job.chars !== 'number') return null;
  if (typeof job.text !== 'string') return null;
  const status = it.status;
  if (
    status !== 'idle' &&
    status !== 'running' &&
    status !== 'ok' &&
    status !== 'failed' &&
    status !== 'stopped' &&
    status !== 'skipped'
  ) {
    return null;
  }
  return {
    job: {
      index: job.index,
      chars: job.chars,
      kind: job.kind === 'argument' || job.kind === 'aside' ? job.kind : 'plain',
      cutBasis:
        job.cutBasis === 'blank' || job.cutBasis === 'wrap' || job.cutBasis === 'cue' || job.cutBasis === 'length'
          ? job.cutBasis
          : 'whole',
      text: job.text,
      preview: typeof job.preview === 'string' ? job.preview : '',
      previewTruncated: job.previewTruncated === true,
    },
    // running 不该落盘：那是「此刻正在跑」，重启后不可能还在跑。按没跑完处理。
    status: status === 'running' ? 'stopped' : status,
    reportId: typeof it.reportId === 'string' && it.reportId ? it.reportId : null,
    level:
      it.level === 'withstands' || it.level === 'weakened' || it.level === 'fails' || it.level === 'undetermined'
        ? it.level
        : null,
    error: typeof it.error === 'string' ? it.error.slice(0, 300) : null,
  };
}

/**
 * 写一条账。id 由调用方给（带原文指纹与时间），同一个 id 覆盖同一个文件。
 *
 * 先写临时文件再改名：和存档、账本、设置三处同一种写法。
 * 直接写目标文件，写到一半断电会留下半截 JSON——读的时候解不开，
 * 而界面上只会显示「这份报告没有台账」，看不出是坏了。
 */
export function saveLedger(raw: unknown): { ok: boolean; id?: string; error?: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: '台账内容不是一条记录' };
  const l = raw as Partial<LongLedger>;
  const items = Array.isArray(l.items) ? l.items.map(cleanItem).filter((x): x is LongItem => !!x) : [];
  if (!items.length) return { ok: false, error: '台账里没有任何一段' };
  if (typeof l.passageHash !== 'string' || !l.passageHash) return { ok: false, error: '台账缺少原文指纹' };

  const id =
    typeof l.id === 'string' && l.id
      ? l.id.replace(/[^a-zA-Z0-9_-]/g, '')
      : ledgerIdFromHash(String(l.passageHash), typeof l.createdAt === 'number' ? l.createdAt : Date.now());

  const body: LongLedger = {
    version: LEDGER_VERSION,
    id,
    createdAt: typeof l.createdAt === 'number' ? l.createdAt : Date.now(),
    passageChars: typeof l.passageChars === 'number' ? l.passageChars : 0,
    passageHash: l.passageHash,
    items,
  };

  try {
    const p = ledgerPath(id);
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, JSON.stringify(body), 'utf-8');
    renameSync(tmp, p);
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? '写不进台账目录' };
  }
}

function readLedgerFile(p: string): LongLedger | null {
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf-8')) as Partial<LongLedger>;
    if (!parsed || !Array.isArray(parsed.items)) return null;
    const items = parsed.items.map(cleanItem).filter((x): x is LongItem => !!x);
    if (!items.length) return null;
    return {
      version: typeof parsed.version === 'number' ? parsed.version : LEDGER_VERSION,
      id: typeof parsed.id === 'string' ? parsed.id : '',
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
      passageChars: typeof parsed.passageChars === 'number' ? parsed.passageChars : 0,
      passageHash: typeof parsed.passageHash === 'string' ? parsed.passageHash : '',
      items,
    };
  } catch {
    // @allow-silent: 坏掉的账当作没有——它不是真相来源，报告本体在 archive/ 里完好。
    // 界面上会表现为「这份报告没有台账」，而不是「应用坏了」。
    return null;
  }
}

/**
 * 按报告 id 反查它属于哪一条账。
 *
 * 为什么从报告这一头找：用户从历史里点开第 3 段的报告，那时他手上只有报告 id。
 * 让他先去翻台账、再从台账里点回来，是把顺序倒过来用。
 *
 * 多条账里同一份报告只可能属于一条（一份报告只由一次分析产生），
 * 取最新的一条即可；真出现两条（手工复制文件），取新的那条并接受这个含糊。
 */
export function ledgerOfReport(reportId: string): LongLedger | null {
  if (!reportId) return null;
  let files: string[] = [];
  try {
    files = readdirSync(longformDir()).filter((f) => f.endsWith('.json'));
  } catch {
    // @allow-silent: 目录还没有，就是「没有台账」，不是错误。
    return null;
  }
  const hits: LongLedger[] = [];
  for (const f of files) {
    const l = readLedgerFile(join(longformDir(), f));
    if (l && l.items.some((it) => it.reportId === reportId)) hits.push(l);
  }
  if (!hits.length) return null;
  return hits.sort((a, b) => b.createdAt - a.createdAt)[0];
}
