/**
 * 提示词现场的只读事实层。
 *
 * 为什么要单独抽一层：`npm run prompts`（写导出件）、`npm run prompt:lock`（写基线）、
 * `npm run check:prompt-drift`（只读比对）三处都要知道「当前 36 份提示词到底是什么」。
 * 三处各装配一遍、各写一份指纹算法，迟早会有两处说的不是同一把尺子——
 * 而这类不一致不报错，只会让检查器拿自己算出来的数去验自己，稳稳地绿。
 *
 * 这一层只调装配函数，不读 docs/、不写任何文件。落盘的东西由检查器自己去读。
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { THEORIES } from '@shared/theories';
import { ANALYSIS_MODES } from '@shared/types';
import {
  buildPrompt,
  renderPrompt,
  PROMPT_VERSION,
  PROMPT_VERSION_NOTE,
} from '../src/main/prompt';

/*
 * 锚定项目根，不用 import.meta.dirname 往上退几级。
 *
 * 这不是风格偏好：这些脚本由 vite 打进 scripts/.out/ 再执行，产物的 dirname
 * 与源码的 dirname 不是同一个目录。第一版写成 '../docs/prompts'，生成器、
 * 基线、检查器三处一起指到 scripts/docs/prompts/，彼此完全自洽——
 * 326 条断言全绿，而用户真正会去读的 docs/prompts/ 一个字都没被验到。
 * 共享事实层能防「两处口径不一致」，防不了「三处口径一起错」，
 * 所以路径必须从共享层之外再锚一次（见 check:prompt-drift 的路径断言）。
 */
export const PROJECT_ROOT = process.cwd();
export const DOC_DIR = resolve(PROJECT_ROOT, 'docs/prompts');
export const BASELINE_PATH = resolve(DOC_DIR, 'BASELINE.json');
export const INDEX_PATH = resolve(DOC_DIR, 'README.md');

if (!existsSync(resolve(PROJECT_ROOT, 'package.json'))) {
  throw new Error(`提示词脚本必须从项目根跑（当前 cwd：${PROJECT_ROOT}）`);
}

/** 导出约定：占位文本与随机分隔符的替身。生成器、基线、检查器共用，不许各自硬编码。 */
export const SAMPLE_PASSAGE = '（示例文本占位）';
export const DELIM_PLACEHOLDER = '文本';

export interface PromptFact {
  key: string;
  theory: string;
  mode: string;
  version: string;
  fingerprint: string;
  coreFingerprint: string;
  system: string;
  /** 随机分隔符已换回字面「文本」，与导出件一致 */
  user: string;
  chars: number;
  blockIds: string[];
}

/** 现场装配 36 份。顺序与 docs/prompts/README.md 的表格一致（透镜 × 模式）。 */
export function currentFacts(): PromptFact[] {
  const out: PromptFact[] = [];
  for (const t of THEORIES) {
    for (const m of ANALYSIS_MODES) {
      const b = buildPrompt(t.id, m);
      const rendered = renderPrompt(b, SAMPLE_PASSAGE);
      out.push({
        key: `${t.id}.${m}`,
        theory: t.id,
        mode: m,
        version: b.version,
        fingerprint: b.fingerprint,
        coreFingerprint: b.coreFingerprint,
        system: b.system,
        user: rendered.user.split(rendered.delim).join(DELIM_PLACEHOLDER),
        chars: b.chars,
        blockIds: [...b.blockIds],
      });
    }
  }
  return out;
}

export const VERSION = PROMPT_VERSION;
/*
 * 注记全文也要进基线，不只是行数。
 *
 * 行数只能证明「留了痕」，证明不了「界面上读到的就是源码里那一行」。
 * 报告里「这把尺子」那一栏直接读 BASELINE.json（不新开 IPC、不给预览页造夹具），
 * 所以这里的 notes 是用户真正会读到的文本；check:prompt-drift 逐字比对源码。
 */
export const NOTES: string[] = PROMPT_VERSION_NOTE.map((s) => s);
export const NOTE_COUNT = NOTES.length;
export const NOTE_HEAD = NOTES[0] ?? '';

export interface Baseline {
  version: string;
  noteCount: number;
  /** 与 PROMPT_VERSION_NOTE 逐字相同；界面读的是这一份，不是源码里的另一份抄写。 */
  notes: string[];
  fingerprints: Record<string, string>;
}

export function fingerprintMap(facts: PromptFact[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of facts) out[f.key] = f.fingerprint;
  return out;
}
