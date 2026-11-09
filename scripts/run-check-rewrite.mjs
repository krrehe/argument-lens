import { runTs } from './ts-runner.mjs';
import { resolve } from 'node:path';

// 「逐字比」：原话那一句 vs 报告整理出来的那一句。纯函数 + 界面源码守卫，不需要 electron。
const ROOT = resolve(import.meta.dirname, '..');
await runTs({ entry: 'scripts/check-rewrite.ts', outName: 'check-rewrite.mjs', alias: { electron: resolve(ROOT, 'scripts/stubs/electron.ts') } });
