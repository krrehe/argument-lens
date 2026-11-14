import { app } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Objection, ObjectionAnchor, ObjectionStat } from '@shared/types';
import type { TheoryId } from '@shared/theories';
import { anchorRefId, normalizeAnchor, objectionKey } from '@shared/objection';
import { appendJsonl, readJsonl, rewriteJsonl } from './jsonl';

/**
 * 用户异议的存放处。
 *
 * 只追加，一行一条。删除是唯一的改写操作，走临时文件 + rename，
 * 因为「写到一半断电」会把整份异议记录变成半截 JSON——
 * 这不是理论问题，是真实发生过的事。
 *
 * 为什么不存进报告文件里：报告可能被删（用户清理历史），
 * 但「我对这条判定有意见」这件事本身有价值，不该跟着报告一起消失。
 * 异议自带 excerpt，所以报告没了它仍然能独立读。
 *
 * 写失败一律往上抛，不在这一层兜。
 * 以前这里吞掉写盘的异常，后果是用户点了「记下」、界面回到原样，
 * 他以为自己留了意见，下一次打开什么都没有——而这恰恰是这个功能唯一的产品价值：
 * 把「我不同意」留下来。留不下来却说成功了，比不提供这个功能更糟。
 */

function objDir(): string {
  const dir = join(app.getPath('userData'), 'objections');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function objectionsDirPath(): string {
  return objDir();
}

function objFile(): string {
  return join(objDir(), 'objections.jsonl');
}

function isObjection(o: any): o is Objection {
  return (
    o &&
    typeof o === 'object' &&
    typeof o.key === 'string' &&
    typeof o.diagId === 'string' &&
    typeof o.theory === 'string' &&
    typeof o.field === 'string' &&
    typeof o.refId === 'string' &&
    typeof o.at === 'number'
  );
}

/** 一行文本 → 一条异议。认不出来返回 null，由 jsonl 层计进坏行数。 */
function parseLine(line: string): Objection | null {
  const o = JSON.parse(line);
  if (!isObjection(o)) return null;
  /* 老记录没有 anchor；坏掉的 anchor 只丢锚点，不丢这一条异议的理由。 */
  const anchor = normalizeAnchor(o.anchor);
  return {
    key: o.key,
    diagId: o.diagId,
    at: o.at,
    theory: o.theory,
    field: o.field,
    refId: o.refId,
    refLabel: String(o.refLabel ?? ''),
    excerpt: String(o.excerpt ?? ''),
    reason: String(o.reason ?? ''),
    ...(anchor ? { anchor } : {}),
  };
}

/**
 * 最近一次读出来的坏行数。
 *
 * 坏行仍然跳过——不因为一行坏掉整份记录，用户看不见一条胜过看不见全部。
 * 但「有几行坏」必须留个痕迹：否则一份正在损坏的文件会一直显示成「完好」，
 * 等人发现时已经丢了一片。这里打到主进程日志，界面不打扰用户。
 */
let lastBadLines = 0;

export function objectionsBadLines(): number {
  return lastBadLines;
}

function readAll(): Objection[] {
  const { items, badLines } = readJsonl(objFile(), parseLine);
  if (badLines > 0 && badLines !== lastBadLines) {
    // @allow-silent: 单行损坏不影响其余记录，坏行数记进 lastBadLines 并打到日志，不当成错误抛给用户
    console.warn(`[objections] 有 ${badLines} 行读不出来，已跳过：${objFile()}`);
  }
  lastBadLines = badLines;
  return items;
}

function writeAll(list: Objection[]): void {
  rewriteJsonl(objFile(), list);
}

/** 全部异议，新的在前。 */
export function listObjections(): Objection[] {
  return readAll().sort((a, b) => b.at - a.at);
}

/** 某一份报告里的异议。界面上哪几处已经标过，靠它。 */
export function objectionsOf(diagId: string): Objection[] {
  return readAll().filter((o) => o.diagId === diagId);
}

export interface ObjectionInput {
  diagId: string;
  theory: TheoryId;
  field: Objection['field'];
  refId: string;
  refLabel: string;
  excerpt: string;
  reason: string;
  /** 工作台自记异议带来的位置；主程序里每处判定不传，key 保持原样。 */
  anchor?: ObjectionAnchor;
}

/**
 * 记一条异议。同一条判定在同一份报告里只留一条——重复点等于刷票，
 * 会把「最常被反对」这个统计做成假象。
 *
 * 写失败会抛：由 IPC 层翻成界面上看得见的一句话。
 *
 * 带锚点的自记异议：位置由锚点说了算，渲染层传来的 refId/refLabel/excerpt
 * 不参与定位，免得界面拼错一个字就把同一处判成两处（或反过来把两处并成一处）。
 */
export function addObjection(input: ObjectionInput): Objection[] {
  const anchor = normalizeAnchor(input.anchor);
  const refId = anchor ? anchorRefId(anchor) : input.refId;
  const refLabel = anchor ? anchor.label : input.refLabel;
  const excerpt = anchor ? anchor.quote : input.excerpt;
  const key = objectionKey(input.theory, input.field, refId, excerpt, anchor);
  const all = readAll();
  const dup = all.findIndex((o) => o.diagId === input.diagId && o.key === key);
  const record: Objection = {
    key,
    diagId: input.diagId,
    at: Date.now(),
    theory: input.theory,
    field: input.field,
    refId,
    refLabel,
    excerpt: excerpt.slice(0, 200),
    reason: input.reason.trim().slice(0, 500),
    ...(anchor ? { anchor } : {}),
  };

  if (dup >= 0) {
    all[dup] = record;
    writeAll(all);
  } else {
    appendJsonl(objFile(), record);
  }
  return listObjections();
}

export function removeObjection(diagId: string, key: string): Objection[] {
  const all = readAll();
  const kept = all.filter((o) => !(o.diagId === diagId && o.key === key));
  if (kept.length !== all.length) writeAll(kept);
  return listObjections();
}

/**
 * 按判定归并的统计。
 *
 * 这是这一层真正想要的东西：跑够几十次之后，哪几条判定最常被反对，
 * 就是这个工具自己的系统性偏差所在。单个用户的一次不同意只是意见，
 * 同一个位置上反复被反对，那就是工具的毛病。
 */
export function objectionStats(): ObjectionStat[] {
  const map = new Map<string, ObjectionStat>();
  for (const o of readAll()) {
    const cur = map.get(o.key);
    if (cur) {
      cur.count += 1;
      cur.lastAt = Math.max(cur.lastAt, o.at);
      if (o.reason && !cur.reasons.includes(o.reason)) cur.reasons.push(o.reason);
    } else {
      map.set(o.key, {
        key: o.key,
        theory: o.theory,
        field: o.field,
        refId: o.refId,
        refLabel: o.refLabel,
        excerpt: o.excerpt,
        ...(o.anchor ? { anchor: o.anchor } : {}),
        count: 1,
        lastAt: o.at,
        reasons: o.reason ? [o.reason] : [],
      });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}
