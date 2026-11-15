import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { THEORIES } from '@shared/theories';
import { ANALYSIS_MODES, MODE_META } from '@shared/types';
import { buildPrompt, renderPrompt, BUDGET, SAMPLING, missingBlocks, PROMPT_VERSION } from '../src/main/prompt';
import { DOC_DIR, SAMPLE_PASSAGE, DELIM_PLACEHOLDER } from './prompt-facts';

/**
 * 把六副透镜 × 五种模式装配后的完整提示词导出为文件，便于逐份核对。
 *
 * 这一步不是锦上添花。提示词是这个产品的全部实质，它必须能被读、被 diff、
 * 被挑错。如果它只存在于运行时，就没有人能对它负责。
 *
 * 顺带做三件静态检查，因为它们都属于「装配完才知道」的事：
 *   1. 索引交叉污染——甲透镜的索引出现在乙透镜的提示词里
 *   2. 必需块缺失——某条规则在某个模式下没被装配进去
 *   3. 预算——提示词长到会挤掉输出空间
 */

/*
 * 目录、占位文本、分隔符替身都从 prompt-facts 取。
 * 导出件与 check:prompt-drift 必须用同一套约定，否则「重新导出一遍」
 * 反而会把检查器要验的那句话改掉，两边各自都对、合起来错。
 */
const OUT = DOC_DIR;

/**
 * 每副透镜的身份标记：索引段的标题。用于检查是否有交叉污染。
 *
 * 标记里刻意**不带数量**（不写「型式索引（14 个」）。数量会随库扩充而变，
 * 一改就让这项检查变成假警报——而假警报比没有检查更坏，它教人忽略报警。
 * 判据应当是「这段索引在这份提示词里出现了没有」，不是「它有几个条目」。
 */
const MARKERS: Record<string, string> = {
  walton: '## 型式索引',
  pragma: '## 十规则索引',
  ars: '三标准参考表',
  pta: '三特征判定参考',
  toulmin: '六要素速查',
  copi: '## 名录（',
};

const MODES = [...ANALYSIS_MODES];

/**
 * 模式归到哪一类，只由 MODE_META 的两个开关决定。
 *
 * 这里刻意不列模式名：加一个新模式时，它归哪一类由它自己的 givesVerdict /
 * allowsLabels 说了算，文档跟着变，不会出现「加了模式、类别还写着三种」。
 */
function kindOf(m: (typeof MODES)[number]): string {
  return MODE_META[m].givesVerdict ? '判定' : MODE_META[m].allowsLabels ? '命名' : '描述';
}

mkdirSync(OUT, { recursive: true });

const rows: string[] = [];
let hasCrossContamination = false;
let hasMissingBlock = false;
let hasOverBudget = false;

for (const t of THEORIES) {
  for (const m of MODES) {
    const b = buildPrompt(t.id, m);
    const built = renderPrompt(b, SAMPLE_PASSAGE);
    /*
     * 导出时把随机分隔符换回字面 `<文本>`。
     * 不换的话，每次导出分隔符都不同，git diff 会被这一行淹没——
     * 而这份文件的唯一用途就是让人看 diff。
     * 文件里注明「实际运行时随机」，避免读文档的人以为边界是固定的。
     */
    const user = built.user.split(built.delim).join(DELIM_PLACEHOLDER);

    const hits = Object.entries(MARKERS)
      .filter(([, mk]) => b.system.includes(mk))
      .map(([k]) => k);
    const clean = hits.length === 1 && hits[0] === t.id;
    if (!clean) hasCrossContamination = true;

    const missing = missingBlocks(m, b.blockIds);
    if (missing.length) hasMissingBlock = true;

    const over = b.overBudget;
    if (over) hasOverBudget = true;

    const flag = b.chars > BUDGET.warnChars ? (over ? '超上限' : '接近上限') : '正常';

    const md = [
      `# 提示词：${t.name}（${MODE_META[m].label}模式）`,
      '',
      `> ${t.nameEn}｜模式：${MODE_META[m].label}（${m}）｜版本：v${b.version}`,
      `> ${MODE_META[m].givesVerdict ? '判定类：给档位。' : MODE_META[m].allowsLabels ? '命名类：不给档位，给名字；level 恒为 undetermined，由代码强制。' : '描述类：不给档位，也不给名字；level 恒为 undetermined，由代码强制。'}`,
      `> 这一份问的是：${MODE_META[m].hint}`,
      `> 判定单元：${t.unit}`,
      `> 原生刻度：${t.scale}`,
      `> 出处：${t.source}`,
      '',
      `指纹 \`${b.fingerprint}\`（内容变则指纹变，可用于判断两份报告是否同一把尺子量的）`,
      `内核指纹 \`${b.coreFingerprint}\``,
      '',
      `字符 ${b.chars}（预算：警戒 ${BUDGET.warnChars}／上限 ${BUDGET.maxChars}，当前${flag}）`,
      `估算 ${b.estTokens} token｜采样温度上限 ${SAMPLING[m].temperature}｜输出上限 ${SAMPLING[m].maxTokens} token`,
      `规则块（${b.blockIds.length}）：${b.blockIds.join('、')}`,
      '',
      '---',
      '',
      '## system',
      '',
      '```text',
      b.system,
      '```',
      '',
      '## user（模板，`{passage}` 处填入原文）',
      '',
      '> 分隔符只出现在 user 的第一行（`守卫：…`）。导出时统一写成「文本」，便于 diff。',
      '> **实际运行时每次随机**（形如 `文本-a3f9c1`）：待分析文本常常是粘来的别人的文字，',
      '> 固定边界等于把闭合权交给对方。',
      '> **system 里一个随机字符都没有**，这是刻意的：前缀要逐字节相同，才能命中接口的自动缓存。',
      '> 随机串挂在 system 里的时候，它之后的 88% 提示词每次都按未命中价计费（v2.4.0 修）。',
      '',
      '```text',
      user,
      '```',
      '',
    ].join('\n');

    writeFileSync(resolve(OUT, `${t.id}.${m}.md`), md, 'utf-8');
    rows.push(
      `| ${t.id} | ${MODE_META[m].label} | ${kindOf(m)} | ${b.chars} | ${b.estTokens} | ${b.system.split('\n').length} | ${
        clean ? '✓' : `✗ ${hits.join('/')}`
      } | ${missing.length ? `✗ 缺 ${missing.join('、')}` : '✓'} | ${flag} | \`${b.fingerprint.slice(0, 8)}\` |`
    );
  }
}

const index = [
  '# 三十份提示词',
  '',
  `提示词版本 **v${PROMPT_VERSION}**。六副透镜 × 五种模式 = 30 份。`,
  '',
  '同一段文本，换一副透镜，就是另一次分析。这不是同一次分析换个说法——',
  '六副透镜问的问题不同，判定单元不同，原生刻度不同，适用范围也不同。',
  '',
  '换模式再换一层。五种模式分成三类，判据是「给不给档位」与「给不给名字」两条——',
  '这两件事不是一回事：查谬误模式给名字但从不给档位，',
  '因为指出一处推理不成立，不等于这段话的结论是错的。',
  '',
  '- **判定类**（给档位）：诊断（它站得住吗）、红队（对手会从哪儿打）。',
  '- **命名类**（不给档位，给名字）：查谬误（哪些位置对得上教材里的名字）。',
  '- **描述类**（不给档位，不给名字）：重构（结构是什么）、提问（我该问他什么）。',
  '',
  '档位一律由代码强制，不是模型自觉：level 恒为 undetermined，模型填了也会被改回去。',
  '不判的理由各不同：先判了再重构，重构就会往最弱的读法上靠；先判了再问，问出来的全是诱导句；',
  '而查谬误模式一旦给档位，用户会把「有谬误」直接读成「他说的是错的」。',
  '',
  '| 透镜 | 模式 | 类别 | 字符 | 估 token | 行数 | 索引隔离 | 必需块 | 预算 | 指纹 |',
  '|---|---|---|---|---|---|---|---|---|---|',
  ...rows,
  '',
  `预算：${BUDGET.warnChars} 字符报警，${BUDGET.maxChars} 字符为上限。`,
  '提示词越长，留给输出的空间越小；输出被截断是整份分析作废，不是少几栏。',
  '',
  '生成方式：`npm run prompts`（脚本在 `scripts/dump-prompts.ts`）。',
  '改动 `src/main/prompt/` 下任何文件后重跑，用 git diff 看提示词的实际变化，',
  '并跑 `npm run prompt:lint`。',
  '',
].join('\n');

writeFileSync(resolve(OUT, 'README.md'), index, 'utf-8');

console.log(index);
if (hasCrossContamination) console.log('⚠ 存在索引交叉污染，见上表');
if (hasMissingBlock) console.log('⚠ 存在必需块缺失，见上表');
if (hasOverBudget) console.log('⚠ 存在超预算提示词，见上表');
if (!hasCrossContamination && !hasMissingBlock && !hasOverBudget) {
  console.log('✓ 索引隔离、必需块、预算三项均通过');
}
