import { runTs } from './ts-runner.mjs';

// 命题账：D-02 三栏与封闭状态值、不判七项、双向谬误筛查、四层各记各的账、界面接线。
// 跑法：npm run check:ledger
await runTs({ entry: 'scripts/check-ledger.ts', outName: 'check-ledger.mjs' });
