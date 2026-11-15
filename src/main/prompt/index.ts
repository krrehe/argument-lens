/**
 * 提示词装配入口。
 *
 * 结构：
 *   registry.ts      版本、指纹、预算、采样、装配函数（事实上的入口）
 *   blocks.ts        内核块：与理论无关的规则，按模式装配，带出处与反面示例登记
 *   fragments.ts     透镜模块的契约
 *   lenses/*.ts      六副透镜，各自独立，互不引用
 *
 * 装配规则：内核块 → 透镜的世界观/程序/硬约束/范围门 → 共享 JSON → 检查项规格
 * → 透镜专属字段 → 透镜索引 → 交付前检查与范围门。
 *
 * 顺序不是排版问题。把范围门放在 JSON 之前，是因为模型写 JSON 时已经
 * 需要决定 applicable；放在后面，它就会先把 JSON 编完再回头补一句「不适用」。
 *
 * 改动提示词后必须走完三件事，顺序不能换：先在 registry.ts 换 PROMPT_VERSION 并
 * 在 PROMPT_VERSION_NOTE 最前面加一行（首行以新版本号开头），再 `npm run prompts`
 * 重新导出三十份全文、`npm run prompt:lock` 更新基线，最后 `npm run prompt:lint`
 * 与 `npm run verify`（含 `check:prompt-drift`）。少一步会由检查器当场指出，
 * 完整理由见 docs/提示词工程.md 第九节。
 */
export {
  buildPrompt,
  renderPrompt,
  missingBlocks,
  fingerprint,
  PROMPT_VERSION,
  PROMPT_VERSION_NOTE,
  BUDGET,
  SAMPLING,
  LENS_MODULES,
  SHARED_SCHEMA,
  checkSpec,
  type PromptBuild,
  type PromptSpan,
} from './registry';

export {
  PROMPT_BLOCKS,
  blocksFor,
  REQUIRED_BLOCKS,
  SHARED_BLOCKS,
  type PromptBlock,
  type PromptSource,
} from './blocks';
export type { LensFragment } from './fragments';
