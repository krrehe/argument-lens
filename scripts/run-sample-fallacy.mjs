import { runTs } from './ts-runner.mjs';

// 生成一份查谬误模式的示例导出件，供人工通读。跑法：npm run sample:fallacy
await runTs({ entry: 'scripts/sample-fallacy-export.ts', outName: 'sample-fallacy-export.mjs' });
