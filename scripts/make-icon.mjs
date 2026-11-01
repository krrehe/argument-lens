/**
 * 生成应用图标：圆角深底 + 镜环 + 内嵌论证图（两底点向上汇于结论点）。
 *
 * 不引图形库。逐像素算 SDF 再超采样，输出 PNG，再按 ICO 规范封装多尺寸。
 * 之所以自己画而不找现成图标：这个图形要能在 16px 上仍看出「两条理由汇成一个结论」，
 * 通用素材做不到，而这一点正好是产品的主张。
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ── 几何基元 ─────────────────────────────────────────── */

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** 圆角矩形的有符号距离 */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

/** 线段的距离场 */
function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp01((pax * bax + pay * bay) / (bax * bax + bay * bay));
  return Math.hypot(pax - bax * h, pay - bay * h);
}

/** 抗锯齿覆盖率：距离 < -w 全实，> w 全空 */
const cov = (d, w) => clamp01(0.5 - d / w);

/* ── 单个尺寸的绘制 ───────────────────────────────────── */

const BG = [0x22, 0x43, 0x38]; // 深墨绿，与界面 accent 同族
const FG = [0xf7, 0xf6, 0xf3]; // 纸白
const ACCENT = [0xc9, 0xa8, 0x6a]; // 结论点用暖金，指明「结论」

function render(size) {
  const S = size;
  const buf = Buffer.alloc(S * S * 4);
  const cx = S / 2;
  const cy = S / 2;

  // 小尺寸换版式而不是等比缩小：环 + 三点挤在 16px 里必然糊成一团。
  // 24px 及以下丢掉镜环，只留论证图，并把它撑满版面——可辨识优先于完整。
  const tiny = S <= 24;
  const k = S <= 48 ? 1.2 : 1;
  const ringR = S * 0.355;
  const ringW = Math.max(S * 0.052 * k, S * 0.045);
  const nodeR = tiny ? S * 0.135 : Math.max(S * 0.052 * k, S * 0.038);
  const linkW = tiny ? S * 0.115 : Math.max(S * 0.046 * k, S * 0.04);

  // 论证图三点：结论在上，两前提在下。小尺寸时按比例外扩
  const spread = tiny ? 0.245 : 0.185;
  const top = { x: cx, y: cy - S * (tiny ? 0.19 : 0.135) };
  const bl = { x: cx - S * spread, y: cy + S * (tiny ? 0.215 : 0.175) };
  const br = { x: cx + S * spread, y: cy + S * (tiny ? 0.215 : 0.175) };

  const SS = 3; // 每轴 3 次采样，共 9 采样做抗锯齿
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let aBg = 0;
      let aFg = 0;
      let aAcc = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;

          // 底板
          const dRect = sdRoundRect(px, py, cx, cy, S * 0.5, S * 0.5, S * (tiny ? 0.19 : 0.215));
          const cRect = cov(dRect, 1);
          aBg += cRect;

          // 镜环（小尺寸省略）
          if (!tiny) {
            const dRing = Math.abs(Math.hypot(px - cx, py - cy) - ringR) - ringW / 2;
            aFg += cov(dRing, 1) * cRect;
          }

          // 两条连线：前提 → 结论
          const dLink = Math.min(
            sdSegment(px, py, bl.x, bl.y, top.x, top.y),
            sdSegment(px, py, br.x, br.y, top.x, top.y)
          );
          aFg += cov(Math.abs(dLink) - linkW / 2, 1) * cRect;

          // 前提节点：实心白
          aFg += cov(Math.hypot(px - bl.x, py - bl.y) - nodeR, 1) * cRect;
          aFg += cov(Math.hypot(px - br.x, py - br.y) - nodeR, 1) * cRect;

          // 结论节点：实心金，且略大，压过连线端头
          aAcc += cov(Math.hypot(px - top.x, py - top.y) - nodeR * 1.18, 1) * cRect;
        }
      }

      const n = SS * SS;
      const bg = aBg / n;
      const fg = (aFg / n) * (1 - aAcc / n);
      const acc = aAcc / n;

      // 先铺底，再叠白，最后叠金
      let r = BG[0] * bg;
      let g = BG[1] * bg;
      let b = BG[2] * bg;
      let al = bg;

      r = r * (1 - fg) + FG[0] * fg;
      g = g * (1 - fg) + FG[1] * fg;
      b = b * (1 - fg) + FG[2] * fg;

      r = r * (1 - acc) + ACCENT[0] * acc;
      g = g * (1 - acc) + ACCENT[1] * acc;
      b = b * (1 - acc) + ACCENT[2] * acc;

      const i = (y * S + x) * 4;
      buf[i] = Math.round(clamp01(r / 255) * 255);
      buf[i + 1] = Math.round(clamp01(g / 255) * 255);
      buf[i + 2] = Math.round(clamp01(b / 255) * 255);
      buf[i + 3] = Math.round(clamp01(al) * 255);
    }
  }
  return buf;
}

/* ── PNG 封装 ─────────────────────────────────────────── */

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function toPng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // 每行前置 filter byte 0
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── ICO 封装（Vista 起允许内嵌 PNG） ─────────────────── */

function toIco(entries) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2); // 1 = icon
  head.writeUInt16LE(entries.length, 4);

  const dirs = [];
  let offset = 6 + entries.length * 16;
  for (const e of entries) {
    const d = Buffer.alloc(16);
    d[0] = e.size >= 256 ? 0 : e.size;
    d[1] = e.size >= 256 ? 0 : e.size;
    d[2] = 0;
    d[3] = 0;
    d.writeUInt16LE(1, 4); // planes
    d.writeUInt16LE(32, 6); // bpp
    d.writeUInt32LE(e.png.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += e.png.length;
    dirs.push(d);
  }

  return Buffer.concat([head, ...dirs, ...entries.map((e) => e.png)]);
}

/* ── 产出 ─────────────────────────────────────────────── */

const SIZES = [256, 128, 64, 48, 32, 16];
const outDir = resolve(root, 'build');
mkdirSync(outDir, { recursive: true });

const entries = SIZES.map((size) => {
  const png = toPng(render(size), size);
  return { size, png };
});

// 大图单独留一份 PNG，README 和 electron-builder 都能用
writeFileSync(resolve(outDir, 'icon.png'), entries[0].png);
writeFileSync(resolve(outDir, 'icon.ico'), toIco(entries));

console.log('icon.png', entries[0].png.length, 'bytes');
console.log('icon.ico', toIco(entries).length, 'bytes');
for (const e of entries) console.log(`  ${e.size}x${e.size}  ${e.png.length} bytes`);
