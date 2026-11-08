import { runTs } from './ts-runner.mjs';
import { resolve } from 'node:path';

// 「口气复核」：本地拿原文那一句，核报告那一句。纯函数，不需要 electron。
const ROOT = resolve(import.meta.dirname, '..');
await runTs({ entry: 'scripts/check-modal.ts', outName: 'check-modal.mjs', alias: { electron: resolve(ROOT, 'scripts/stubs/electron.ts') } });
