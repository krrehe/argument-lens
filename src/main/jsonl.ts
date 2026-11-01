import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

/**
 * jsonl 的读写。放在 main 而不是 shared，是因为它只被主进程用，
 * 而留在 main 里有一个实际好处：这个模块不 import electron，
 * 于是 scripts 下的检查可以在纯 node 里直接 import 它做运行时断言。
 *
 * 「能被 node 直接测」是这里的硬要求。写盘失败是这个模块唯一真正会发生的故障，
 * 而一个只能靠读代码相信的行为，跟没写一样——它必须能被故意造坏的用例打中。
 *
 * 三条纪律：
 *   1. **失败一律抛。** 调用方（IPC）负责把它变成界面上看得见的一句话。
 *      在这里吞掉，等于让用户以为自己记下了，实际上什么都没发生。
 *   2. **改写走临时文件 + rename。** 写到一半断电会留下半截 JSON，
 *      rename 的原子性把「半份」这个状态整个消掉。
 *   3. **坏行单独数出来。** 一行坏不该毁掉整份记录，但「有几行坏」必须能报出来，
 *      不能被静默成「一切正常」。
 */

export interface JsonlRead<T> {
  items: T[];
  /** 读不出来而跳过的行数。0 表示这份记录完好。 */
  badLines: number;
}

/**
 * 逐行读。`parse` 返回 null 表示这一行不认——坏行跳过的判断交给调用方，
 * 因为「什么算一条合法记录」是各自数据形状的事，不是这个文件格式的事。
 */
export function readJsonl<T>(path: string, parse: (line: string) => T | null): JsonlRead<T> {
  if (!existsSync(path)) return { items: [], badLines: 0 };
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    throw new Error(`读不出 ${path}：${(err as Error)?.message ?? '原因不明'}`);
  }
  const items: T[] = [];
  let badLines = 0;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const parsed = parse(t);
      if (parsed === null) badLines += 1;
      else items.push(parsed);
    } catch {
      badLines += 1;
    }
  }
  return { items, badLines };
}

/** 追加一行。抛错不吞：追加失败就是没记上，这一条必须能传到界面上。 */
export function appendJsonl(path: string, record: unknown): void {
  try {
    appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf-8');
  } catch (err) {
    throw new Error(`写不进 ${path}：${(err as Error)?.message ?? '原因不明'}`);
  }
}

/** 整份重写。先写 .tmp 再改名，避免半截文件。 */
export function rewriteJsonl(path: string, records: unknown[]): void {
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(
      tmp,
      records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''),
      'utf-8'
    );
    renameSync(tmp, path);
  } catch (err) {
    throw new Error(`写不进 ${path}：${(err as Error)?.message ?? '原因不明'}`);
  }
}
