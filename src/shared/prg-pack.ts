/**
 * 图 → 一个画布工具能打开的文件（`.prg` 的字节）。
 *
 * 为什么自己写编码器而不是装一个：这个应用不往安装包里塞用不上的依赖，
 * 而这两个格式都足够小（msgpack 是「长度 + 类型 + 值」，zip 在这里只用到
 * 不压缩的存储模式）。真正的理由是**它得能被别人验**：`check:prg` 拿
 * `@msgpack/msgpack` 与 `@zip.js/zip.js` 当裁判（devDependency，不进包），
 * 我们编出来的字节必须被对方的解析器读回成同一棵树。自己说「兼容」不算数。
 *
 * 目标格式的事实（2026-11-08 核，来源写在 `docs/与画布工具互通.md`）：
 *
 *   - `.prg` 是一个 zip 容器，里面至少一个 `stage.msgpack`；
 *     `tags` / `reference` / `metadata` / `README.md` / `attachments/` 都是可选的。
 *   - `stage.msgpack` 是一个数组，每个元素是 `{ _: 类名, 字段… }`；
 *     共享对象用 `{ $: "/数组下标/字段/下标" }` 指向先出现的那一份。
 *   - 文本节点只要 `uuid` / `text` / `collisionBox`；连线要
 *     `associationList`（源、目标的引用）与两个连接点比例。
 *
 * 三条边界：
 *
 *   1. **我们不读他们的代码。** 上面的形状来自他们**自己的测试夹具**里构造工程文件的
 *      写法——那是已被他们的 CLI 读通过的形状，不是我们从别处猜的。
 *   2. **不写时间戳。** zip 里的时间字段固定成 1980-01-01，同一份报告两次导出
 *      字节完全一样。可复算的东西才守得住，否则断言只能比「大概一样」。
 *   3. **版本号是承诺。** 写错版本，对方的打开路径会把它当旧文件去升级，
 *      那是我们完全无法预测的一段代码。
 */
import type { PrgGraph } from './prg-graph';

/**
 * 目标工程格式版本。
 *
 * 对方解析时读 `metadata.version`；它自己的常量是 `LATEST_PROJECT_VERSION = "2.7.0"`
 * （2026-11-08 核）。这里写死一个常量而不是从别处推：版本一变，`check:prg`
 * 会红一次，提醒人复核格式，而不是让一份写着旧版本号的导出件悄悄变旧。
 */
export const PRG_TARGET_VERSION = '2.7.0';

/* ───────────── msgpack ───────────── */

class ByteWriter {
  private buf = new Uint8Array(1024);
  private len = 0;

  private grow(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  byte(b: number): void {
    this.grow(1);
    this.buf[this.len++] = b & 0xff;
  }

  bytes(bs: Uint8Array): void {
    this.grow(bs.length);
    this.buf.set(bs, this.len);
    this.len += bs.length;
  }

  u16(n: number): void {
    this.byte(n >> 8);
    this.byte(n);
  }

  u32(n: number): void {
    this.byte(n >>> 24);
    this.byte(n >>> 16);
    this.byte(n >>> 8);
    this.byte(n);
  }

  /*
   * 小端：zip 的每个多字节字段都是小端，msgpack 是大端。
   * 两个方向写在同一个类里，是因为**写错方向不会报错**——生成的文件照样有四段结构，
   * 只有对方读的时候才说「找不到中央目录」。第一版就是这么错的：签名 `06054b50`
   * 该出现在文件末尾，字节序反了以后它落在磁盘上成了 `504b0506`。
   */
  le16(n: number): void {
    this.byte(n);
    this.byte(n >> 8);
  }

  le32(n: number): void {
    this.byte(n);
    this.byte(n >>> 8);
    this.byte(n >>> 16);
    this.byte(n >>> 24);
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.len);
  }

  get length(): number {
    return this.len;
  }
}

const enc = new TextEncoder();

/**
 * 编码一个值。支持报告里会出现的全部形状：null / 布尔 / 数 / 字符串 / 数组 / 普通对象。
 *
 * 非整数一律写 float64——不做「能不能用 float32 省几个字节」的判断：
 * 坐标只需要看起来对，但版本号、比例这类值一旦被压精度，读回来的就不再是同一份文件。
 */
export function encodeMsgpack(v: unknown, w: ByteWriter = new ByteWriter()): Uint8Array {
  if (v === null || v === undefined) {
    w.byte(0xc0);
  } else if (typeof v === 'boolean') {
    w.byte(v ? 0xc3 : 0xc2);
  } else if (typeof v === 'number') {
    if (Number.isSafeInteger(v)) {
      if (v >= 0 && v < 0x80) w.byte(v);
      else if (v < 0 && v >= -32) w.byte(0xe0 | (v + 32));
      else if (v >= -128 && v < 128) {
        w.byte(0xd0);
        w.byte(v & 0xff);
      } else if (v >= -32768 && v < 32768) {
        w.byte(0xd1);
        w.u16(v & 0xffff);
      } else if (v >= -2147483648 && v < 2147483648) {
        w.byte(0xd2);
        w.u32(v >>> 0);
      } else {
        w.byte(0xcb);
        const dv = new DataView(new ArrayBuffer(8));
        dv.setFloat64(0, v);
        w.bytes(new Uint8Array(dv.buffer));
      }
    } else {
      w.byte(0xcb);
      const dv = new DataView(new ArrayBuffer(8));
      dv.setFloat64(0, v);
      w.bytes(new Uint8Array(dv.buffer));
    }
  } else if (typeof v === 'string') {
    const b = enc.encode(v);
    const n = b.length;
    if (n < 32) w.byte(0xa0 | n);
    else if (n < 256) {
      w.byte(0xd9);
      w.byte(n);
    } else if (n < 65536) {
      w.byte(0xda);
      w.u16(n);
    } else {
      throw new RangeError('一段文本超过 64KB，写不进这份工程文件');
    }
    w.bytes(b);
  } else if (Array.isArray(v)) {
    if (v.length < 16) w.byte(0x90 | v.length);
    else {
      w.byte(0xdc);
      w.u16(v.length);
    }
    for (const item of v) encodeMsgpack(item, w);
  } else if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length < 16) w.byte(0x80 | entries.length);
    else {
      w.byte(0xde);
      w.u16(entries.length);
    }
    for (const [k, val] of entries) {
      encodeMsgpack(k, w);
      encodeMsgpack(val, w);
    }
  } else {
    throw new TypeError(`写不进工程文件的值：${typeof v}`);
  }
  return w.result();
}

/* ───────────── zip（只存储，不压缩） ───────────── */

/**
 * CRC32。zip 的每个条目都要带它，读的一侧会拿它验文件有没有坏。
 * 表在第一次用到时算出来，之后复用——单独一条命令跑几毫秒，不值得优化。
 */
let CRC_TABLE: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!CRC_TABLE) {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    CRC_TABLE = t;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = (CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/**
 * 写一个 zip。只用「存储」模式（method 0）：这些文件本来就不大，
 * 而压缩会让同一份输入在不同 zlib 版本上产出不同字节——可复算比省几十 KB 重要。
 *
 * 文件名标记为 UTF-8（通用标志位第 11 位）：条目名都是 ASCII，但把这一位写对，
 * 以后要放中文名的附件才不会变成乱码。
 */
export function zipStore(entries: ZipEntry[]): Uint8Array {
  const w = new ByteWriter();
  const central: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];

  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const offset = w.length;
    w.le32(0x04034b50);
    w.le16(20);
    w.le16(0x0800);
    w.le16(0); // method 0 = 存储
    w.le16(0); // 时间：固定 00:00
    w.le16(0x0021); // 日期：固定 1980-01-01
    w.le32(crc);
    w.le32(e.data.length);
    w.le32(e.data.length);
    w.le16(name.length);
    w.le16(0);
    w.bytes(name);
    w.bytes(e.data);
    central.push({ name, crc, size: e.data.length, offset });
  }

  const cdStart = w.length;
  for (const c of central) {
    w.le32(0x02014b50);
    w.le16(20);
    w.le16(20);
    w.le16(0x0800);
    w.le16(0);
    w.le16(0);
    w.le16(0x0021);
    w.le32(c.crc);
    w.le32(c.size);
    w.le32(c.size);
    w.le16(c.name.length);
    w.le16(0);
    w.le16(0);
    w.le16(0);
    w.le16(0);
    w.le32(0);
    w.le32(c.offset);
    w.bytes(c.name);
  }
  const cdSize = w.length - cdStart;

  w.le32(0x06054b50);
  w.le16(0);
  w.le16(0);
  w.le16(central.length);
  w.le16(central.length);
  w.le32(cdSize);
  w.le32(cdStart);
  w.le16(0);
  return w.result();
}

/* ───────────── stage 对象 ───────────── */

const vec = (x: number, y: number) => ({ _: 'Vector', x, y });
const rect = (n: { x: number; y: number; w: number; h: number }) => ({
  _: 'Rectangle',
  location: vec(n.x, n.y),
  size: vec(n.w, n.h),
});

/**
 * 由下标造一个稳定的 uuid。
 *
 * 不用 `crypto.randomUUID()`：同一份报告两次导出应当得到完全相同的字节，
 * 否则「导出完对比一下」这种最朴素的自查就做不了。
 */
function stableUuid(i: number): string {
  return `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
}

/**
 * 摊平成对方读的那个数组：先是全部节点，再是全部连线。
 *
 * 顺序不能乱：连线的两端写成 `{ $: "/下标" }`，指向**数组里已经出现过**的那一份。
 */
export function stageObjects(g: PrgGraph): unknown[] {
  const index = new Map<string, number>();
  const out: unknown[] = [];

  g.nodes.forEach((n, i) => {
    index.set(n.key, i);
    out.push({
      _: 'TextNode',
      uuid: stableUuid(i),
      text: n.text,
      collisionBox: { _: 'CollisionBox', shapes: [rect(n)] },
      color: { _: 'Color', r: n.color[0], g: n.color[1], b: n.color[2], a: n.color[3] },
    });
  });

  for (const e of g.edges) {
    const from = index.get(e.from);
    const to = index.get(e.to);
    // 端点不在数组里的线直接跳过：一条指向空处的线会让对方的打开流程炸掉，
    // 而炸掉的表现是「文件坏了」，读的人不会想到是某一根线。
    if (from === undefined || to === undefined) continue;
    out.push({
      _: 'LineEdge',
      associationList: [{ $: `/${from}` }, { $: `/${to}` }],
      color: { _: 'Color', r: 0, g: 0, b: 0, a: 0 },
      targetRectangleRate: vec(0.01, 0.5),
      sourceRectangleRate: vec(0.99, 0.5),
      uuid: stableUuid(1000 + out.length),
      text: '',
    });
  }

  return out;
}

/** 四个条目。`tags` / `reference` 给空值是因为它们记的是标签与附件引用，我们没有。 */
export function buildPrg(g: PrgGraph): Uint8Array {
  return zipStore([
    { name: 'stage.msgpack', data: encodeMsgpack(stageObjects(g)) },
    { name: 'tags.msgpack', data: encodeMsgpack([]) },
    { name: 'reference.msgpack', data: encodeMsgpack({ sections: {}, files: [] }) },
    { name: 'metadata.msgpack', data: encodeMsgpack({ version: PRG_TARGET_VERSION }) },
  ]);
}
