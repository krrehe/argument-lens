import { runTs } from './ts-runner.mjs';

/**
 * 导出六副透镜 × 四种模式的完整提示词，便于逐份核对与版本间 diff。
 * 跑法：npm run prompts
 */
await runTs({ entry: 'scripts/dump-prompts.ts', outName: 'dump-prompts.mjs' });
