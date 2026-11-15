import { runTs } from './ts-runner.mjs';

// 导出件新鲜度与版本锁：只读比对 docs/prompts/ 与现场装配，不需要 electron。
await runTs({ entry: 'scripts/check-prompt-drift.ts', outName: 'check-prompt-drift.mjs' });
