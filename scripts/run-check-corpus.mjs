import { runTs } from './ts-runner.mjs';

// 语料独立性：每种毛病都要有两段不同体裁、字面不像的文本在考。
// 跑法：npm run check:corpus
await runTs({ entry: 'scripts/check-corpus.ts', outName: 'check-corpus.mjs' });
