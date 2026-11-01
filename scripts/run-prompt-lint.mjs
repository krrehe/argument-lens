import { runTs } from './ts-runner.mjs';

/**
 * 提示词静态检查。跑法：npm run prompt:lint
 */
await runTs({ entry: 'scripts/prompt-lint.ts', outName: 'prompt-lint.mjs' });
