import { runTs } from '../ts-runner.mjs';
await runTs({ entry: 'scripts/eval/audit.ts', outName: 'eval-audit.mjs' });
