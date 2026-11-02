import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { extractJson } from '../src/main/llm';
import { normalizeDiagnosis } from '../src/main/analyze';
import { diffReports, suspectOf, type ReplayDiff } from '@shared/replay';
import type { Diagnosis } from '@shared/types';

/**
 * 重放的编排层：读存档 → 重新解析 → 重跑裁决与自检 → 与存档比对。
 *
 * 这一层刻意不联网、不读设置、不记账。它只做一件事：把「同一段模型原文」
 * 再喂一遍**当前的**代码，看产物还是不是存档里那一份。
 *
 * 不重跑提示词、不重新调用模型——那是 `npm run eval` 的事，要花钱、要不来同样的输出。
 * 重放能验的边界也在这里：它验的是解析与裁决，**验不了模型这次会不会说别的**。
 */

export interface ArchiveEntry {
  file: string;
  report: Diagnosis;
}

export interface LoadResult {
  ready: ArchiveEntry[];
  /** 有报告但没有模型原文（P0-1 之前生成的），无法重放 */
  noRaw: { id: string; at: number; mode: string }[];
  /** 文件读不出或解不开 */
  broken: { file: string; why: string }[];
}

export function defaultArchiveDir(): string {
  /* 不 import electron：这条命令要在纯 node 里跑。目录规则与 Electron 的
     `app.getPath('userData')` 一致（Windows 为 %APPDATA%/<name>）。 */
  const app = 'argument-lens';
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), app, 'archive');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', app, 'archive');
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), app, 'archive');
}

export function loadArchives(dir: string): LoadResult {
  const out: LoadResult = { ready: [], noRaw: [], broken: [] };
  if (!existsSync(dir)) return out;

  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json')) {
    let d: Diagnosis;
    try {
      d = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as Diagnosis;
    } catch (e) {
      out.broken.push({ file, why: (e as Error).message });
      continue;
    }
    if (!d?.id || !d.theory || !d.verdict) {
      out.broken.push({ file, why: '缺 id / theory / verdict，不是一份报告' });
      continue;
    }
    if (typeof d.raw?.text !== 'string' || !d.raw.text.trim()) {
      out.noRaw.push({ id: d.id, at: d.createdAt, mode: d.mode });
      continue;
    }
    out.ready.push({ file, report: d });
  }
  out.ready.sort((a, b) => a.report.createdAt - b.report.createdAt);
  return out;
}

export interface ReplayOutcome {
  id: string;
  mode: string;
  theory: string;
  ok: boolean;
  /** 重放本身跑不完（原文解不开、归一化抛错），此时 diffs 无意义 */
  failed?: { stage: '解析' | '归一化'; why: string };
  diff?: ReplayDiff;
  /** 重算出来的那一份。只在「确认差异是有意的、要更新基准」时用到 */
  replayed?: Diagnosis;
}

/**
 * 重放一份。id / createdAt / parentId / prompt 全部从存档回填——
 * 它们是**输入**，不是要重算的东西。不回填的话，重放产物会带上一串
 * 与本次改动无关的差异（新 id、新时间），把真正的变化埋掉。
 */
export function replayOne(report: Diagnosis): ReplayOutcome {
  const head = { id: report.id, mode: report.mode, theory: report.theory };

  let parsed: unknown;
  try {
    parsed = extractJson(report.raw!.text);
  } catch (e) {
    return { ...head, ok: false, failed: { stage: '解析', why: (e as Error).message } };
  }

  let replayed: Diagnosis;
  try {
    replayed = normalizeDiagnosis(parsed, report.passage, report.theory, {
      mode: report.mode,
      parentId: report.parentId,
      id: report.id,
      createdAt: report.createdAt,
      ...(report.prompt ? { prompt: report.prompt } : {}),
    });
  } catch (e) {
    return { ...head, ok: false, failed: { stage: '归一化', why: (e as Error).message } };
  }

  /*
   * 把原文挂回去，和真实链路保持一致（runAnalysis 也是归一化之后再写 raw）。
   *
   * 不只是为了好看：`--accept` 会把这一份写回基准，而写回去的东西必须还能被下一次重放读取。
   * 少了 raw，基准就变成一堆「没有模型原文」的存档——检查从此空跑，且是绿的。
   */
  replayed.raw = report.raw;

  return { ...head, ok: true, diff: diffReports(report, replayed), replayed };
}

/** 覆盖情况。全绿时要一起看：13 份若全是同一段文本，绿只说明这一段没坏。 */
export interface Coverage {
  modes: Record<string, number>;
  theories: Record<string, number>;
  prompts: Record<string, number>;
  passages: number;
}

export function coverageOf(entries: ArchiveEntry[]): Coverage {
  const modes: Record<string, number> = {};
  const theories: Record<string, number> = {};
  const prompts: Record<string, number> = {};
  const seen = new Set<string>();
  for (const { report } of entries) {
    modes[report.mode] = (modes[report.mode] ?? 0) + 1;
    theories[report.theory] = (theories[report.theory] ?? 0) + 1;
    const key = report.prompt ? `${report.prompt.version}（${report.prompt.fingerprint}）` : '未记录（P0-1 之前）';
    prompts[key] = (prompts[key] ?? 0) + 1;
    seen.add(report.passage.trim());
  }
  return { modes, theories, prompts, passages: seen.size };
}

export { suspectOf };
export type { ReplayDiff };
