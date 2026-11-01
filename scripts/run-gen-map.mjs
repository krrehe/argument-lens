import { runTs } from './ts-runner.mjs';
await runTs({ entry: 'scripts/gen-map.ts', outName: 'gen-map.mjs' });
