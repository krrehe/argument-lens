import { app } from 'electron';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Objection, ObjectionStat } from '@shared/types';
import type { TheoryId } from '@shared/theories';
import { objectionKey } from '@shared/objection';

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

function readAll(): Objection[] {
  const p = objFile();
  if (!existsSync(p)) return [];
  let raw: string;
  try {
    raw = readFileSync(p, 'utf-8');
  } catch {
    return [];
  }
  const out: Objection[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t);
      if (isObjection(o)) {
        out.push({
          key: o.key,
          diagId: o.diagId,
          at: o.at,
          theory: o.theory,
          field: o.field,
          refId: o.refId,
          refLabel: String(o.refLabel ?? ''),
          excerpt: String(o.excerpt ?? ''),
          reason: String(o.reason ?? ''),
        });
      }
    } catch {
      // 坏行跳过，不因为一行坏掉整份记录。用户看不见这条，胜过看不见全部。
    }
  }
  return out;
}

function writeAll(list: Objection[]): void {
  const p = objFile();
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, list.map((o) => JSON.stringify(o)).join('\n') + (list.length ? '\n' : ''), 'utf-8');
  renameSync(tmp, p);
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
}

/**
 * 记一条异议。同一条判定在同一份报告里只留一条——重复点等于刷票，
 * 会把「最常被反对」这个统计做成假象。
 */
export function addObjection(input: ObjectionInput): Objection[] {
  const key = objectionKey(input.theory, input.field, input.refId, input.excerpt);
  const all = readAll();
  const dup = all.findIndex((o) => o.diagId === input.diagId && o.key === key);
  const record: Objection = {
    key,
    diagId: input.diagId,
    at: Date.now(),
    theory: input.theory,
    field: input.field,
    refId: input.refId,
    refLabel: input.refLabel,
    excerpt: input.excerpt.slice(0, 200),
    reason: input.reason.trim().slice(0, 500),
  };

  if (dup >= 0) {
    all[dup] = record;
    writeAll(all);
  } else {
    appendFileSync(objFile(), `${JSON.stringify(record)}\n`, 'utf-8');
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
        count: 1,
        lastAt: o.at,
        reasons: o.reason ? [o.reason] : [],
      });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}
