import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NEXT_LINE_HEAD,
  nextLineIssue,
  nextLinesOf,
  parseNextLineRecord,
  type NextLineRecord,
  type NextLineView,
} from '@shared/nextline';
import { appendJsonl, readJsonl, rewriteJsonlRaw } from './jsonl';

/**
 * 「看完报告之后，你下一句想说什么」的存放处。
 *
 * 为什么单独一个文件、不塞进报告里：
 *
 *   1. 报告可能被删。可「我说过什么」这件事比报告本身有价值——它正是路线图
 *      第四节要的那份数据，不该跟着报告一起消失。
 *   2. 塞进 `Diagnosis` 会改变报告的形状。报告的形状一改，`check:replay` 的基准
 *      全要重录，而那份基准锁的是判定，跟这句用户的话没有任何关系。**不成比例。**
 *
 * 只追加；删除是唯一的改写，而且按原样的行重写——读不出来的行原样留着，
 * 删一句不该顺手把别的东西也抹掉。
 *
 * 写失败一律往上抛，由 IPC 层翻成界面上一句能读懂的话：
 * 这个功能唯一的价值是「留下来」，留不下来却说成功了，比没有这个功能更坏。
 */
function nextLinesFile(): string {
  return join(app.getPath('userData'), 'nextlines.jsonl');
}

function parseLine(line: string): NextLineRecord | null {
  return parseNextLineRecord(JSON.parse(line));
}

function readAll(): { items: NextLineRecord[]; badLines: number } {
  return readJsonl(nextLinesFile(), parseLine);
}

/** 账本身。读不出来时会抛：一份读不出来的账不该显示成「还没有记过」。 */
export function listNextLines(): NextLineView {
  const { items, badLines } = readAll();
  return nextLinesOf(items, badLines);
}

export interface NextLineInput {
  text: string;
  diagId: string;
  passageHead: string;
  theory: string;
}

/**
 * 记一句。
 *
 * 先校验再读盘：空的不记、超长的不记，两者都带理由回界面。
 * 入参的形状在这一层收一次，渲染层送什么都不能绕过上限。
 */
export function addNextLine(input: NextLineInput): NextLineView {
  const issue = nextLineIssue(input?.text);
  if (issue) throw new Error(issue);

  const { items, badLines } = readAll();
  const record: NextLineRecord = {
    id: randomUUID(),
    at: Date.now(),
    text: String(input.text).trim(),
    diagId: String(input.diagId ?? ''),
    /* 只留开头，逐字取自原文；报告删了也还认得出来这是哪一次之后说的。 */
    passageHead: String(input.passageHead ?? '').slice(0, NEXT_LINE_HEAD),
    theory: String(input.theory ?? ''),
  };

  appendJsonl(nextLinesFile(), record);
  return nextLinesOf([record, ...items], badLines);
}

/**
 * 删一句。用户的字归用户，删完立刻回一份新的账，界面拿返回值直接替换状态。
 *
 * 按原样的行重写（`rewriteJsonlRaw`），读不出来的行原样留着；
 * 只去掉 id 对上的那一行，别的一行不动。
 */
export function removeNextLine(id: string): NextLineView {
  const { items, badLines } = readAll();
  if (!items.some((r) => r.id === id)) return nextLinesOf(items, badLines);

  const raw = readFileSync(nextLinesFile(), 'utf-8');
  const keep: string[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let parsed: NextLineRecord | null = null;
    try {
      parsed = parseNextLineRecord(JSON.parse(t));
    } catch {
      parsed = null;
    }
    if (parsed?.id === id) continue;
    keep.push(t);
  }
  rewriteJsonlRaw(nextLinesFile(), keep);
  return nextLinesOf(items.filter((r) => r.id !== id), badLines);
}
