/**
 * 「这把尺子」的只读追溯层。
 *
 * 报告里一直有一行「本次提示词 vX.Y.Z · 指纹 …」，可它是一个孤零零的号：
 * 三个月后回看，用户既不知道那一版和现在差在哪，也不知道本机还有没有那一版的全文。
 * 而 `PROMPT_VERSION_NOTE` 里那八行「上一次为什么这么写」只活在源码里，
 * 只有读代码的人才看得见——留了痕，却没交到人手上。
 *
 * 这一层把两处接起来，并且只说本地能证实的事：
 *   - 版本号能不能在本机变更史里找到对应的一行注记；
 *   - 报告里的指纹能不能与**当前装机版**这一组合（透镜 · 模式）的装配逐字对上；
 *   - 对不上时，到底是对不上、还是本机根本没有可比的那一份。
 *
 * 数据来源是 `docs/prompts/BASELINE.json`，不是新开一条 IPC，也不是给预览页造夹具：
 * 那份基线由 `npm run prompt:lock` 生成，`check:prompt-drift` 逐字比对它与
 * `PROMPT_VERSION_NOTE`、30 份装配指纹。界面、导出件、检查器读的是同一份落盘事实。
 * 改提示词却没跑 lock，这一栏会与源码脱节——由那道关卡当场指出。
 *
 * 三条不可省的边界（少一条，这一栏就在假装能复核历史）：
 *   1. 本机只留有当前装机版的提示词全文与指纹，旧版全文没有存档，
 *      所以历史指纹只能证明「当时算过」，**不能在这里重算一遍**；
 *   2. 注记是人写下的「当时为什么这么改」，不是效果评价；
 *   3. 软件不判哪一版更好、不判这处改动有没有用、不改任何判定。
 */
import baseline from '../../docs/prompts/BASELINE.json';
import type { Diagnosis } from './types';

/** 注记首行必须是三段版本号；认不出就记 `null`，不猜、不按顺序补一个。 */
const VERSION_HEAD = /^\s*(\d+\.\d+\.\d+)(?=\s|$)/;

export interface PromptNote {
  version: string | null;
  text: string;
}

/**
 * no-record  报告没记版本（旧存档里这一栏是后加的）
 * same       版本与指纹都与当前装机版对得上
 * version-only 版本号相同，但指纹没能对上
 * different  报告用的是另一版
 */
export type PromptRelation = 'no-record' | 'same' | 'version-only' | 'different';

export type FingerprintState =
  | 'match'
  | 'mismatch'
  | 'no-current'
  | 'no-record'
  /** 版本不同时不比指纹：拿当前版的指纹去比旧报告，比出来的「不一致」是废话，还容易读成旧报告坏了。 */
  | 'not-checked';

export interface PromptHistorySource {
  version: string;
  noteCount: number;
  notes: string[];
  fingerprints: Record<string, string>;
}

/** 唯一的落盘事实来源。别在别处再抄一份注记或指纹表。 */
export const PROMPT_BASELINE = baseline as PromptHistorySource;

export interface PromptHistoryView {
  rows: PromptNote[];
  currentVersion: string;
  reportVersion: string | null;
  reportFingerprint: string | null;
  /** 透镜 · 模式，指纹表就是按这个组合索引的 */
  combination: string;
  currentFingerprint: string | null;
  relation: PromptRelation;
  fingerprintState: FingerprintState;
  noteFound: boolean;
  noteText: string | null;
  line: string;
  noteLine: string;
  caveats: string[];
}

export function parsePromptNotes(notes: readonly string[]): PromptNote[] {
  const list = Array.isArray(notes) ? notes : [];
  return list.map((raw) => {
    const text = typeof raw === 'string' ? raw : '';
    const m = VERSION_HEAD.exec(text);
    return { version: m ? m[1] : null, text };
  });
}

export function promptHistoryOf(
  d: Pick<Diagnosis, 'prompt' | 'theory' | 'mode'>
): PromptHistoryView {
  const src = PROMPT_BASELINE;
  const rows = parsePromptNotes(src.notes);
  const currentVersion = String(src.version ?? '');
  const combination = `${d.theory}.${d.mode}`;
  const currentFingerprint = src.fingerprints?.[combination] ?? null;

  const hasRecord = !!d.prompt && typeof d.prompt.version === 'string' && d.prompt.version.length > 0;
  const reportVersion = hasRecord ? d.prompt!.version : null;
  const reportFingerprint = d.prompt?.fingerprint ?? null;

  let relation: PromptRelation;
  let fingerprintState: FingerprintState;
  if (!hasRecord) {
    relation = 'no-record';
    fingerprintState = 'no-record';
  } else if (reportVersion !== currentVersion) {
    relation = 'different';
    fingerprintState = 'not-checked';
  } else if (!currentFingerprint) {
    relation = 'version-only';
    fingerprintState = 'no-current';
  } else if (reportFingerprint === currentFingerprint) {
    relation = 'same';
    fingerprintState = 'match';
  } else {
    relation = 'version-only';
    fingerprintState = 'mismatch';
  }

  const hit = reportVersion ? rows.find((r) => r.version === reportVersion) : undefined;
  const noteFound = !!hit;
  const noteText = hit?.text ?? null;

  let line: string;
  switch (relation) {
    case 'no-record':
      line = '这份报告没记提示词版本与指纹（旧存档里这一栏是后加的），不能和任何一版对回。';
      break;
    case 'different':
      line = `这份报告用的是 v${reportVersion}，不是当前装机版 v${currentVersion}。`;
      break;
    case 'same':
      line = `这份报告用的是当前装机版 v${currentVersion}，指纹与本机这一组合（${combination}）的装配逐字对得上。`;
      break;
    case 'version-only':
      line =
        fingerprintState === 'no-current'
          ? `版本号是 v${currentVersion}，但本机指纹表里没有「${combination}」这一组合，没法逐字核对。`
          : `版本号都是 v${currentVersion}，指纹却对不上本机这一组合的装配——同一版号下有过不止一套内容，不能只按版本号认定是同一把尺子。`;
      break;
  }

  const noteLine = !hasRecord
    ? '没有版本号，也就没有对应的一行注记可查。'
    : noteFound
      ? `v${reportVersion} 这一版当时留下的注记在下面，逐字摘自本机基线。`
      : `本机变更史里没有 v${reportVersion} 这一行注记，不能凭版本号推断当时改了什么。`;

  const caveats = [
    `本机只留有当前装机版 v${currentVersion} 的提示词全文与 30 份指纹；更早版本的全文没有存档，所以这里不能把旧指纹重算一遍。`,
    '注记是人写下的「当时为什么这么改」，不是对那一版效果的评价；软件不判哪一版更好，也不判这处改动有没有用。',
    '报告里的指纹是那次装配算出来的，它只能证明当时算过，证明不了那次判定对不对。',
  ];

  return {
    rows,
    currentVersion,
    reportVersion,
    reportFingerprint,
    combination,
    currentFingerprint,
    relation,
    fingerprintState,
    noteFound,
    noteText,
    line,
    noteLine,
    caveats,
  };
}

/**
 * 导出件用的同一份叙述。只列本机变更史的版本号，不把八条长注记全塞进 Markdown——
 * 带走这份文件的人要改的是稿子，版本全文在报告那一栏与 BASELINE.json 里都能读到。
 */
export function promptHistoryMarkdown(v: PromptHistoryView): string[] {
  const out: string[] = [];
  out.push('## 这把尺子（提示词版本与变更史）');
  out.push('');
  out.push(`- ${v.line}`);
  out.push(`- ${v.noteLine}`);
  if (v.noteText) {
    out.push('');
    out.push('> ' + v.noteText.replace(/\s*\n\s*/g, ' '));
  }
  out.push('');
  for (const c of v.caveats) out.push(`- ${c}`);
  out.push('');
  const versions = v.rows.map((r) => (r.version ? `v${r.version}` : '没写版本号'));
  out.push(`本机版本变更史（${versions.length} 行）：${versions.join(' → ')}`);
  out.push('');
  return out;
}
