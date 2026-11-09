import { runTs } from './ts-runner.mjs';
import { resolve } from 'node:path';

// 「骨架缺口」：本地对报告本身说「这里接不上」。纯函数，不需要 electron。
const ROOT = resolve(import.meta.dirname, '..');
await runTs({ entry: 'scripts/check-skeleton.ts', outName: 'check-skeleton.mjs', alias: { electron: resolve(ROOT, 'scripts/stubs/electron.ts') } });
