import { runTs } from './ts-runner.mjs';

// 长文覆盖账：纯函数 + 界面源码守卫，不需要 electron。
await runTs({ entry: 'scripts/check-coverage.ts', outName: 'check-coverage.mjs' });
