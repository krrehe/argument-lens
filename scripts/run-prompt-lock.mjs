import { runTs } from './ts-runner.mjs';

// 更新提示词基线。内容变了却没换版本号 / 没留注记，会在写文件之前被拒绝。
await runTs({ entry: 'scripts/prompt-lock.ts', outName: 'prompt-lock.mjs' });
