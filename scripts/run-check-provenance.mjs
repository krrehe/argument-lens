import { runTs } from './ts-runner.mjs';

// 「来源账」：模型给出的判断与本地复算分开。纯函数 + 界面源码守卫，不需要 electron。
await runTs({ entry: 'scripts/check-provenance.ts', outName: 'check-provenance.mjs' });
