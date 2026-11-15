/**
 * 长文逐段分析：把「一整篇文章」拆成几次可核对的独立分析。
 *
 * 起因是一份 6268 字的真模型报告：原文 31 段，报告的条目只落在 8 句上。
 * 这不是模型不努力，是这个工具的判定单元本来是「一段论证」，而人贴进来的是社论。
 * 整篇送进去只有两种下场：诚实地判「这不是单一论证」（于是检查表被清空），
 * 或者硬压成一条主论证（于是报告比原文简单得多，而读者看不出来）。
 *
 * 这一层做的事只有三件：
 *   1. 排计划：哪几段值得单独跑、哪几段跳过、跳过的理由是什么；
 *   2. 记结果：每一段跑成了什么（存的是报告 id，不复制报告）；
 *   3. 说清楚它没做什么：不合并、不相加、不判段与段之间的关系。
 *
 * 三条不许越过的边界（界面与导出必须原样显示）：
 *   - 每段各是一份独立报告，软件**不把它们合并成「一条总论证」**；
 *   - 档位**不能相加、不能求平均**，这里只数每段各自判成什么；
 *   - 段与段的关系（第 3 段是不是在反驳第 1 段）**本地判不了**，也不猜。
 *
 * 还有一条不在这三条里、但同样重要：**跳过必须记账**。上限截断是唯一会
 * 悄悄少跑几段的地方，所以超限时按「像论证优先、长的优先」选，剩下的
 * 逐段写进 skipped，并带上理由——不静默截断。
 */
import type { Diagnosis, VerdictLevel } from '@shared/types';
import { LEVEL_LABEL } from '@shared/theories';
import { segmentPassage, type CutBasis, type Segment, type SegmentKind } from '@shared/segment';

/** 一次最多跑几段。默认 8：再多就不是「逐段跑」而是「跑一整本」，费用与等待都会失控。 */
export const MAX_JOBS = 8;

/** 台账落盘格式的版本。字段变了就加一，读旧文件时按缺失处理，不回填假值。 */
export const LEDGER_VERSION = 1;

/** 边界三条。界面、导出、检查器读同一份。 */
export const LONGFORM_BOUNDS = [
  '每段各是一份独立报告。软件不把它们合并成「一条总论证」——整篇的主论点是什么，这里没有答案。',
  '档位不能相加、不能求平均。下面只数每段各自判成什么，不排名、不给总分。',
  '段与段之间的关系（第 3 段是不是在反驳第 1 段）本地判不了。要判，得你自己读，或者另跑一份整篇的报告。',
] as const;

export interface LongJob {
  /** 段序号，与「切给我看」里的第 N 段逐字一致 */
  index: number;
  chars: number;
  kind: SegmentKind;
  cutBasis: CutBasis;
  /** 送给分析的原文（trim 过的整段） */
  text: string;
  /** 段开头若干字，逐字截取，只用于列表显示 */
  preview: string;
  previewTruncated: boolean;
}

export interface LongSkip {
  index: number;
  chars: number;
  /** 一句人话：为什么这一段不跑 */
  why: string;
}

export interface LongPlan {
  /** 够不够长到值得逐段跑 */
  long: boolean;
  /** 原文一共切出几段 */
  segments: number;
  chars: number;
  jobs: LongJob[];
  skipped: LongSkip[];
  /** 这次会发起几次模型调用——点之前就该知道 */
  calls: number;
  totalChars: number;
  /** 必须显示出来的警告：硬切、跳过、只剩一段、超上限 */
  warnings: string[];
}

export type LongStatus =
  | 'idle'
  | 'running'
  | 'ok'
  | 'failed'
  | 'stopped'
  /**
   * 计划里就跳过的段（像问句、或超上限）。
   *
   * 它也要占一行，而且行里必须留着它的段号：台账若只列跑过的段，
   * 「第 2 段」下面直接是「第 4 段」，读者会以为文章只有五段；
   * 而「6 段里跑了 5 段、跳过 1 段」才是这批账的真实形状。
   */
  | 'skipped';

export interface LongItem {
  job: LongJob;
  status: LongStatus;
  /** 跑成的那一份报告在历史里的 id；没跑成是 null */
  reportId: string | null;
  /** 报告里的档位；没跑成或读不出是 null */
  level: VerdictLevel | null;
  /** 失败或停止的一句话原因 */
  error: string | null;
}

export interface LongLedger {
  version: number;
  id: string;
  createdAt: number;
  /** 原文长度，用来在界面上说「这 6,268 字」 */
  passageChars: number;
  /** 原文指纹。只用于「是不是同一篇」，不用于证明没被改过——它算不出这个 */
  passageHash: string;
  items: LongItem[];
}

const PREVIEW_CHARS = 48;

/**
 * 原文指纹。FNV-1a，32 位。
 *
 * 说清它能干什么：只回答「这两次贴的是不是同一段字」。
 * 它证明不了内容没被改过（能构造碰撞），也不进提示词、不进报告、不改判定。
 */
export function passageHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function previewOf(text: string): { preview: string; truncated: boolean } {
  const flat = text.replace(/\s+/g, ' ').trim();
  return {
    preview: flat.slice(0, PREVIEW_CHARS),
    truncated: flat.length > PREVIEW_CHARS,
  };
}

/** 像问句、口号、过渡句的段默认不跑：单独分析它们，多半得到一份空报告，还照样收钱。 */
function skipBecause(seg: Segment): string | null {
  if (seg.kind === 'aside') {
    return seg.text.trim().endsWith('？') || seg.text.trim().endsWith('?')
      ? '这一段是问句，单独分析多半是一份空报告'
      : '这一段像口号或过渡句，没有给出理由，单独分析多半是一份空报告';
  }
  return null;
}

/**
 * 排计划。纯函数：同一段文字永远得到同一份计划。
 *
 * `maxJobs` 只影响「取哪几段」，不影响「跳过几段」——超限的段照样逐条写进 skipped。
 */
export function planLongform(passage: string, opts?: { maxJobs?: number; includeAside?: boolean }): LongPlan {
  const maxJobs = Math.max(1, Math.floor(opts?.maxJobs ?? MAX_JOBS));
  const includeAside = opts?.includeAside === true;
  const segs = segmentPassage(passage ?? '');
  const chars = (passage ?? '').length;

  if (!segs.length) {
    return { long: false, segments: 0, chars, jobs: [], skipped: [], calls: 0, totalChars: 0, warnings: [] };
  }

  const skipped: LongSkip[] = [];
  const candidates: Segment[] = [];
  for (const s of segs) {
    const why = includeAside ? null : skipBecause(s);
    if (why) skipped.push({ index: s.index, chars: s.chars, why });
    else candidates.push(s);
  }

  /*
   * 超限时怎么取：先按「自带结论（argument）→ 字数多」排，取前 maxJobs 段；
   * 输出仍按原文顺序，读起来和文章一致。被挤掉的逐条记账，理由写明是上限。
   */
  let picked = candidates;
  if (candidates.length > maxJobs) {
    const ranked = [...candidates].sort((a, b) => {
      const ka = a.kind === 'argument' ? 0 : 1;
      const kb = b.kind === 'argument' ? 0 : 1;
      if (ka !== kb) return ka - kb;
      return b.chars - a.chars;
    });
    const keep = new Set(ranked.slice(0, maxJobs).map((s) => s.index));
    for (const s of candidates) {
      if (!keep.has(s.index)) skipped.push({ index: s.index, chars: s.chars, why: `超出一次最多 ${maxJobs} 段的上限，这次不跑` });
    }
    picked = candidates.filter((s) => keep.has(s.index));
  }

  const jobs: LongJob[] = picked
    .sort((a, b) => a.index - b.index)
    .map((s) => {
      const { preview, truncated } = previewOf(s.text);
      return {
        index: s.index,
        chars: s.chars,
        kind: s.kind,
        cutBasis: s.cutBasis,
        text: s.text,
        preview,
        previewTruncated: truncated,
      };
    });

  const hardCut = segs.filter((s) => s.cutBasis === 'length').length;
  const warnings: string[] = [];
  if (hardCut) {
    warnings.push(`${hardCut} 处切点按字数硬切，没有语义依据——跑之前先看一眼那几段是不是切在推理中间。`);
  }
  if (skipped.length) {
    const aside = skipped.filter((s) => !s.why.startsWith('超出')).length;
    const over = skipped.length - aside;
    const bits: string[] = [];
    if (aside) bits.push(`${aside} 段像问句或过渡句，默认不跑`);
    if (over) bits.push(`${over} 段超出一次上限，没排进来`);
    warnings.push(`${bits.join('；')}。跳过的每段都在下面逐条列着，理由写着——不是悄悄少跑。`);
  }
  if (jobs.length === 1) {
    warnings.push('只排出一段可跑的。整篇分析也许更合适——那样至少能看见「这不是单一论证」这个判断。');
  }
  if (chars > 15000) {
    warnings.push(`整篇 ${chars} 字，超过单次分析的上限（15,000 字）。逐段跑正是为这种情况准备的。`);
  }

  return {
    long: segs.length >= 2 && chars >= 200,
    segments: segs.length,
    chars,
    jobs,
    skipped: skipped.sort((a, b) => a.index - b.index),
    calls: jobs.length,
    totalChars: jobs.reduce((n, j) => n + j.chars, 0),
    warnings,
  };
}

/** 计划阶段的一句话：点之前先看清「几次调用、多少字」。 */
export function planLine(plan: LongPlan): string {
  if (!plan.calls) return '没有可单独跑的段。';
  return `${plan.calls} 次调用 · ${plan.totalChars.toLocaleString('zh-CN')} 字 · 共 ${plan.segments} 段`;
}

/**
 * 把计划摊成台账的初值。
 *
 * **跳过的段也在里面**，按段号与可跑的段混排。台账要能一眼看出「这篇一共几段、
 * 跑了哪几段、哪几段没跑」，段号断了就等于在隐瞒。
 */
export function makeItems(plan: LongPlan): LongItem[] {
  const runnable: LongItem[] = plan.jobs.map((job) => ({
    job,
    status: 'idle',
    reportId: null,
    level: null,
    error: null,
  }));
  const skipped: LongItem[] = plan.skipped.map((s) => ({
    job: {
      index: s.index,
      chars: s.chars,
      kind: 'plain',
      cutBasis: 'whole',
      text: '',
      preview: '',
      previewTruncated: false,
    },
    status: 'skipped',
    reportId: null,
    level: null,
    error: s.why,
  }));
  return [...runnable, ...skipped].sort((a, b) => a.job.index - b.job.index);
}

/** 下一个该跑的段。没有就返回 null——批次结束与「还没开始」都由调用方看汇总判断。 */
export function nextJob(items: LongItem[]): LongItem | null {
  return items.find((it) => it.status === 'idle') ?? null;
}

/**
 * 按段号更新一条。越界或找不到返回原数组（不改、不抛）：
 * 批跑是异步的，用户中途点开别的报告时可能已经换了对象。
 */
export function patchItem(items: LongItem[], index: number, patch: Partial<Omit<LongItem, 'job'>>): LongItem[] {
  let hit = false;
  const next = items.map((it) => {
    if (it.job.index !== index) return it;
    hit = true;
    return { ...it, ...patch };
  });
  return hit ? next : items;
}

/** 停：把还排着的段标成 stopped，已经跑成的不动。 */
export function stopIdle(items: LongItem[]): LongItem[] {
  return items.map((it) => (it.status === 'idle' ? { ...it, status: 'stopped' as LongStatus } : it));
}

/** 恢复：把 stopped 的段退回 idle，好让「接着跑」能捡起来。 */
export function resumeIdle(items: LongItem[]): LongItem[] {
  return items.map((it) => (it.status === 'stopped' ? { ...it, status: 'idle' as LongStatus } : it));
}

export interface LongSummary {
  total: number;
  done: number;
  failed: number;
  waiting: number;
  stopped: number;
  skipped: number;
  running: boolean;
  /** 各档位各几段。没有的档位不出现——补 0 会让分布看起来比实际更满 */
  levels: { level: VerdictLevel; label: string; count: number }[];
  /** 一句人话，界面与导出共用 */
  line: string;
}

const LEVEL_ORDER: VerdictLevel[] = ['withstands', 'weakened', 'fails', 'undetermined'];

export function summarize(items: LongItem[]): LongSummary {
  const done = items.filter((it) => it.status === 'ok').length;
  const failed = items.filter((it) => it.status === 'failed').length;
  const waiting = items.filter((it) => it.status === 'idle').length;
  const stopped = items.filter((it) => it.status === 'stopped').length;
  const skipped = items.filter((it) => it.status === 'skipped').length;
  const running = items.some((it) => it.status === 'running');

  const levels = LEVEL_ORDER.map((level) => ({
    level,
    label: LEVEL_LABEL[level],
    count: items.filter((it) => it.status === 'ok' && it.level === level).length,
  })).filter((x) => x.count > 0);

  const total = items.length;
  const bits: string[] = [`${total} 段里跑出 ${done} 份报告`];
  if (levels.length) bits.push(levels.map((x) => `${x.label} ${x.count}`).join('、'));
  if (failed) bits.push(`${failed} 段失败`);
  if (stopped) bits.push(`${stopped} 段按停后没跑`);
  if (waiting && !failed && !stopped) bits.push(`${waiting} 段还没跑`);
  if (skipped) bits.push(`${skipped} 段没排进来（像问句或过渡句，理由见行内）`);
  return { total, done, failed, waiting, stopped, skipped, running, levels, line: `${bits.join('；')}。` };
}

/**
 * 台账 id。带原文指纹与时间：同一篇文章跑两批，是两条账，不互相覆盖。
 * 不用随机数——同一个输入在同一秒里再跑一次本来就该得到同一条账。
 */
export function ledgerIdFromHash(hash: string, at: number): string {
  return `lf-${hash}-${at}`;
}

export function ledgerId(passage: string, at: number): string {
  return ledgerIdFromHash(passageHash(passage), at);
}

/** 从报告读回「这一段判成什么」，读不出就当 null：不猜、不回填。 */
export function levelOf(d: Diagnosis | null): VerdictLevel | null {
  if (!d || !d.verdict || !d.scope?.applicable) return null;
  const lv = d.verdict.level;
  return lv === 'withstands' || lv === 'weakened' || lv === 'fails' || lv === 'undetermined' ? lv : null;
}

/** 台账里这一份报告是第几段。找不到返回 null——界面上不该把「找不到」画成「第 1 段」。 */
export function indexOfReport(ledger: LongLedger, reportId: string): number | null {
  const hit = ledger.items.find((it) => it.reportId === reportId);
  return hit ? hit.job.index : null;
}

/**
 * 台账的一句话摘要，给报告顶部与 Markdown 导出共用。
 * 用 summarize 的口径，不另写一份——两处各写一遍，迟早有一处说错。
 */
export function ledgerLine(ledger: LongLedger): string {
  return summarize(ledger.items).line;
}

/**
 * 台账的 Markdown。
 *
 * 带得走是这一栏的基本要求：一份报告能导出，一批报告却只能留在窗口里读，
 * 那它就不是一份账。每行保留段号与**那一段自己**的档位，边界三条原样附在后面——
 * 剪走这张表的人看不到界面，只能看到这段文字。
 *
 * 不写文件、不落盘：复制走剪贴板，与报告里「复制 Markdown」同一种交代方式。
 */
export function longformMarkdown(ledger: LongLedger): string {
  const sum = summarize(ledger.items);
  const rows = ledger.items.map((it) => {
    const state =
      it.status === 'ok'
        ? it.level
          ? LEVEL_LABEL[it.level]
          : '档位读不出'
        : it.status === 'failed'
          ? `失败：${it.error ?? '原因不明'}`
          : it.status === 'stopped'
            ? '按停后没跑'
            : it.status === 'running'
              ? '正在跑'
              : '还没跑';
    const seg = `第 ${it.job.index + 1} 段`;
    const prev = it.job.preview.replace(/\|/g, '\\|');
    return `| ${seg} | ${it.job.chars} | ${state} | ${prev}${it.job.previewTruncated ? '…' : ''} |`;
  });

  return [
    `# 长文台账`,
    '',
    ledger.passageChars ? `原文 ${ledger.passageChars} 字，切出 ${sum.total} 段。${sum.line}` : sum.line,
    '',
    '| 段 | 字数 | 这一段自己的判读 | 开头 |',
    '|---|---|---|---|',
    ...rows,
    '',
    '每行都是那一段单独跑出来的一份报告，各自存在历史里。',
    '',
    ...LONGFORM_BOUNDS.map((b) => `- ${b}`),
    '',
    '台账只记索引（报告 id 与档位），不复制报告正文；本地不改判定、不调模型。',
    '',
  ].join('\n');
}
