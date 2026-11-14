import { app, clipboard, dialog, shell, type BrowserWindow } from 'electron';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { argdownFileName, reportToArgdown } from '@shared/argdown';
import { markdownFileName, reportToMarkdown } from '@shared/report-markdown';
import { buildPrg } from '@shared/prg-pack';
import { graphOf, prgFileName } from '@shared/prg-graph';
import type { Diagnosis } from '@shared/types';

type ExportResult = { ok: boolean; path?: string; canceled?: boolean };

/**
 * 本次运行里真的写到磁盘上的路径。
 *
 * 为什么留一份名单、而不是让渲染层传什么就打开什么：那等于给界面开了一个
 * 「打开本机任意文件」的通道，而这里没有任何功能需要它。存下来之后，
 * 「打开文件」「在文件夹中显示」只认自己刚写出的那几份。
 *
 * 名单只在内存里：重启之后路径还显示在界面上，但按钮会明说「不是这次导出的」——
 * 比假装能打开、点了一下什么也不发生要好。
 */
const SAVED_PATHS = new Set<string>();

/**
 * 把报告写成一份文本文件。
 *
 * 为什么不在渲染层直接拼字符串再交给浏览器下载：那样拿不到「用户到底存到哪了」，
 * 也拿不到取消与失败的区别。而对一份要拿去改稿的文件来说，「存在哪」这件事
 * 用户是要知道的——他下一步就是去那个目录打开它。
 *
 * 不写 BOM：CSV 加 BOM 是因为 Excel 不认无 BOM 的 UTF-8，而 Markdown / Argdown 的
 * 编辑器与渲染器普遍认 UTF-8；加了 BOM 反而会在某些解析器里变成文件开头的三个乱码字符。
 */
async function saveText(
  parent: BrowserWindow | null,
  d: Diagnosis,
  text: string,
  defaultName: string,
  size: { title: string; name: string; ext: string }
): Promise<ExportResult> {
  /*
   * 只做最小校验。这里挡的不是恶意输入——渲染层就在同一个进程边界内；
   * 挡的是「没有报告的界面状态被误传进来」，那种情况下会生成一份文件名是
   * undefined 的空文件，而用户会以为导出成功了。
   */
  if (!d || typeof d.id !== 'string' || !d.verdict) return { ok: false };

  const opts = {
    title: size.title,
    defaultPath: join(app.getPath('downloads'), defaultName),
    filters: [{ name: size.name, extensions: [size.ext] }],
  };
  const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };

  writeFileSync(r.filePath, text, 'utf-8');
  SAVED_PATHS.add(r.filePath);
  return { ok: true, path: r.filePath };
}

/** 导出为 Markdown：给人读、照着改稿。 */
export function exportReportMarkdown(parent: BrowserWindow | null, d: Diagnosis): Promise<ExportResult> {
  return saveText(parent, d, reportToMarkdown(d), markdownFileName(d), {
    title: '导出为 Markdown',
    name: 'Markdown',
    ext: 'md',
  });
}

/**
 * 导出为 Argdown：给工具读。
 *
 * Markdown 回答了「我该改哪一句」，Argdown 回答「谁支撑谁」——它是一份纯文本的
 * 论证图，换到任何支持这套语法的编辑器里都能渲染，改动还能进 git diff。
 * 两者导的是同一份报告、同一套 supports，不存在第三种结构。
 */
export function exportReportArgdown(parent: BrowserWindow | null, d: Diagnosis): Promise<ExportResult> {
  return saveText(parent, d, reportToArgdown(d), argdownFileName(d), {
    title: '导出为 Argdown',
    name: 'Argdown',
    ext: 'ad',
  });
}

/**
 * 导出为画布工程（`.prg`）。
 *
 * 与前两种不一样的地方只有一个：它写的是**字节**，不是文本。所以要多做两件
 * 前两种不需要做的事：
 *
 *   - 写 `Buffer` 而不是字符串，并且**不加 BOM、不做换行转换**：zip 里任何
 *     一个字节被改，CRC 就对不上，对方的解析器会直接判文件损坏——而用户的
 *     感受是「导出的文件打不开」，看不出是编码问题。
 *   - 失败要抛到界面：这个文件里装的是他刚才那份报告的全部结构，写了一半
 *     留在磁盘上比没有更糟。`saveBinary` 不吞异常，调用方按 catch 处理。
 */
export async function exportReportPrg(parent: BrowserWindow | null, d: Diagnosis): Promise<ExportResult> {
  if (!d || typeof d.id !== 'string' || !d.conclusion) return { ok: false };

  const bytes = buildPrg(graphOf(d));
  const opts = {
    title: '导出为画布工程（Project Graph）',
    defaultPath: join(app.getPath('downloads'), prgFileName(d)),
    filters: [{ name: 'Project Graph 工程', extensions: ['prg'] }],
  };
  const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };

  writeFileSync(r.filePath, Buffer.from(bytes));
  SAVED_PATHS.add(r.filePath);
  return { ok: true, path: r.filePath };
}

/* ─────────── 拿走这份报告：复制、打开、定位 ─────────── */

/**
 * 把 Markdown 全文放进剪贴板。
 *
 * 与「导出为 Markdown」走**同一个生成函数**：如果这里另拼一份，两份文件迟早
 * 会长得不一样，而用户看不出哪一份才是报告。复制不弹保存框——它服务的是
 * 「贴到聊天窗口里问一句」「粘进自己的稿子」这类不需要落盘的用法。
 *
 * 关于写剪贴板这件事：`capture` 那一侧刻意没有 `write()`（能写就能悄悄改掉
 * 用户复制的文字）。这里的边界不一样：这是用户按下的一个按钮，写进去的是
 * 软件自己刚生成的报告全文，不是替谁伪造一段剪贴板内容。
 */
export async function copyReportMarkdown(
  d: Diagnosis
): Promise<{ ok: boolean; chars?: number; reason?: string }> {
  if (!d || typeof d.id !== 'string' || !d.verdict) return { ok: false, reason: '当前没有可以复制的报告。' };
  const text = reportToMarkdown(d);
  /*
   * Electron 45 起剪贴板改成异步的：写是「已提交到系统剪贴板」才 resolve。
   * 所以这里必须等它——不等就回一句「已复制」，而写失败（被别的程序占着、
   * 系统拒绝）时界面已经说了成功。宁可晚 10ms 报成功。
   */
  try {
    await clipboard.writeText(text);
  } catch (err) {
    return { ok: false, reason: `没能写进剪贴板：${(err as Error)?.message ?? '原因不明'}` };
  }
  return { ok: true, chars: text.length };
}

/** 打开刚导出的那份文件（用系统默认程序）。 */
export async function openExported(path: string): Promise<{ ok: boolean; reason?: string }> {
  if (typeof path !== 'string' || !SAVED_PATHS.has(path)) {
    return { ok: false, reason: '这个路径不是本次运行里导出的文件，界面不替你打开别的文件。' };
  }
  if (!existsSync(path)) return { ok: false, reason: '文件不在了（可能被移动或删除）。' };
  const msg = await shell.openPath(path);
  return msg ? { ok: false, reason: msg } : { ok: true };
}

/** 在资源管理器里定位到那份文件——比「打开」更稳：没有默认程序也能看见它。 */
export function revealExported(path: string): { ok: boolean; reason?: string } {
  if (typeof path !== 'string' || !SAVED_PATHS.has(path)) {
    return { ok: false, reason: '这个路径不是本次运行里导出的文件，界面不替你在别处定位。' };
  }
  if (!existsSync(path)) return { ok: false, reason: '文件不在了（可能被移动或删除）。' };
  shell.showItemInFolder(path);
  return { ok: true };
}
