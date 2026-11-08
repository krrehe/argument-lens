import { app, dialog, type BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { argdownFileName, reportToArgdown } from '@shared/argdown';
import { markdownFileName, reportToMarkdown } from '@shared/report-markdown';
import { buildPrg } from '@shared/prg-pack';
import { graphOf, prgFileName } from '@shared/prg-graph';
import type { Diagnosis } from '@shared/types';

type ExportResult = { ok: boolean; path?: string; canceled?: boolean };

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
  return { ok: true, path: r.filePath };
}
