import { runTs } from './ts-runner.mjs';
await runTs({ entry: 'scripts/audit-landing.ts', outName: 'audit-landing.mjs' });
