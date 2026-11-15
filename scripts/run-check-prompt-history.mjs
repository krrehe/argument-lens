import { runTs } from './ts-runner.mjs';

// 「这把尺子」：只读比对基线、现场装配、纯函数行为与界面／导出接线，不需要 electron。
await runTs({ entry: 'scripts/check-prompt-history.ts', outName: 'check-prompt-history.mjs' });
