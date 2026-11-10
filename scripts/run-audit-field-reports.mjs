import { runTs } from './ts-runner.mjs';

// 手动审计：量本机真实报告上「这一圈的词」报告侧四项是不是空面板。
// 不进 verify —— 它依赖使用者自己的存档，换一台机器没有存档就该明说量不了。
await runTs({ entry: 'scripts/audit-field-reports.ts', outName: 'audit-field-reports.mjs' });
