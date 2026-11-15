import { runTs } from './ts-runner.mjs';

// 阅读层级：只读比对纯函数表、界面／样式／冒烟接线与文档，不需要 electron。
await runTs({ entry: 'scripts/check-density.ts', outName: 'check-density.mjs' });
