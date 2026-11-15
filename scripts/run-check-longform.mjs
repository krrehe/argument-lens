import { runTs } from './ts-runner.mjs';

// 长文逐段分析：只读比对计划／状态机／台账／界面接线与文档，不调模型、不碰 electron。
await runTs({ entry: 'scripts/check-longform.ts', outName: 'check-longform.mjs' });
