import { runTs } from './ts-runner.mjs';

// 语境依赖：三副透镜读语境、三副不读且各有理由、每条依赖指得出出处、旧档不说假定。
// 跑法：npm run check:context-use
await runTs({ entry: 'scripts/check-context-use.ts', outName: 'check-context-use.mjs' });
