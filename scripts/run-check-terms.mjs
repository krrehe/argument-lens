import { runTs } from './ts-runner.mjs';

// 「这一圈的词」：词表由人给，本地只按字面复算。纯函数 + 界面源码守卫，不需要 electron。
await runTs({ entry: 'scripts/check-terms.ts', outName: 'check-terms.mjs' });
