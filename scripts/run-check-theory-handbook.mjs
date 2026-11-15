import { runTs } from './ts-runner.mjs';

// 手册核对：只读比对「手册哪一节哪一页」与主张库，不联网、不碰模型。
await runTs({ entry: 'scripts/check-theory-handbook.ts', outName: 'check-theory-handbook.mjs' });
