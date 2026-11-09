import { runTs } from './ts-runner.mjs';

// 外部公开学术样本上的词汇层字面账。不进 verify：它依赖仓库里那三段固定文本，
// 换一段字就该换一份账；命令自带硬断言自检，失败真实退出 1。
await runTs({ entry: 'scripts/audit-field-samples.ts', outName: 'audit-field-samples.mjs' });
