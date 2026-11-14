import { runTs } from './ts-runner.mjs';

// 报告出来之后的三件事：异议账（纯函数）+ 复制/打开/定位与换透镜重跑的源码守卫，不需要 electron。
await runTs({ entry: 'scripts/check-after.ts', outName: 'check-after.mjs' });
