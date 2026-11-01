import { runTs } from './ts-runner.mjs';

// 处方层断言：覆盖、验收指向、空态理由、位置归类。跑法：npm run check:prescriptions
await runTs({ entry: 'scripts/check-prescriptions.ts', outName: 'check-prescriptions.mjs' });
