/**
 * 同题复跑：同一段字跑了很多遍，报告一样吗？
 *
 * 起因是「样本账」的下一个问题。样本账只说了「本机 103 份报告落在 6 组文字上」，
 * 但没说这 6 组里的几十份报告彼此是什么关系——如果同一段字跑十遍得到十份不同的报告，
 * 那么「跑过的样本数」这件事本身要重新理解。
 *
 * 这个问题只有本地存档答得了：云端对话不保存你上次跑的是什么，裸提示词更没有历史。
 * 而它恰好是 P1-2（跨模型一致性）缺的对照组——**先知道同一个模型对自己重复到什么程度，
 * 才谈得上两个模型之间的差异意味着什么。**
 *
 * 分组单位不是「文本相似」，是四件事同时相同：
 *   提示词指纹 + 透镜 + 模式 + 逐字原文
 *
 * 少任何一条都会把别的东西读成「模型这次说得不一样」：
 *   - 少了指纹：提示词改过一版，报告当然变，那不是抖动，是换了输入；
 *   - 少了透镜：六副透镜本来就该给出不同判断，这是设计，不是不稳定；
 *   - 少了模式：诊断与红队问的不是同一件事；
 *   - 少了逐字原文：同一段话加一句就是另一段话（本机那 8 份改稿正是这样）。
 *
 * 前三条是这里分的；第四条由调用方保证——传进来的每份都带自己的原文，
 * 这里用 normalizePassage 精确相等来切，**不沿用样本账的相似度阈值**：
 * 「几乎同一段」够用来数样本，不够用来断言「同一个输入」。
 *
 * 只数事实：多少个字段每次都一样、多少个变过、每种取值出现几次。
 * 不算百分比、不评「稳定 / 不可靠」、不排「最该修的那一组」。
 *
 * 差异从哪来？这条边界在 2026-11-05 之后变了一半：新报告会记下跑它的模型、
 * 供应商主机与生效温度（`Diagnosis.engine`），所以「这一组里换过模型」现在看得出来；
 * 早期存档没有那一栏，那几组仍然分不开「模型每次说得不一样」与「当时换了模型或设置」。
 * 两种情形都必须写在界面上——否则那几个数字会被读成它证明不了的东西。
 */
import { flatten } from './replay';
import { normalizePassage } from './sameness';
import type { Diagnosis } from './types';

/** 明细里给每组留多长的原文，只为让人认出是同一段字。与样本账同长，不多造一个数。 */
export const EXCERPT_LEN = 28;

/** 单个取值显示多长。超出的部分由界面补省略号，数据里不造一个不属于原文的字。 */
export const MAX_VALUE = 110;

/**
 * 不参与比对的顶层字段：身份、输入、以及「由输入决定的东西」。
 *
 * id / createdAt 每份都不同，比它必然全红；passage / mode / theory / prompt 是输入，
 * 它们在同一个单元格里本来就一样，放进来只会把「字段总数」撑大，
 * 让「245 个字段里 245 个一样」这句话显得比实际更了不起。
 * raw 是模型原文（flatten 已经跳过），它比报告长十倍，比它等于把模型换个说法
 * 与报告真的变了混在一起。
 */
const INPUT_KEYS = new Set([
  'id',
  'createdAt',
  'parentId',
  'passage',
  'mode',
  'theory',
  'prompt',
  'version',
  'raw',
  /* engine 是「谁跑的」：模型、供应商、生效温度。它不进字段计数，
     因为它不是判断的一部分；换了模型之后报告变没变，正是这里要量的差异本身。
     它单独成组报出来（见 EngineTally），否则「8 份里 279 个字段不同」会缺一个最可能的解释。

     这一条是**第二道网**：`flatten` 自己就跳过了 engine（见 replay 的 INPUT_FIELDS）。
     两道留在这里，是因为「引擎不算判断」这个取舍不该只由重放那个文件替这一栏记住——
     哪天重放改了取舍，这一栏会静默跟着变，而它看起来完全正常。`check:engine` 守着这一句。 */
  'engine',
]);

export interface AgreementItem {
  id: string;
  at: number;
  mode: string;
  theory: string;
  /** 提示词版本；旧存档没有这一栏时为 null。 */
  version: string | null;
  /** 提示词指纹；没有指纹的报告不参与比对。 */
  fingerprint: string | null;
  passage: string;
  /** 报告的其余部分。这里不依赖具体 schema，摊平后逐路径比。 */
  report: Partial<Diagnosis> | Record<string, unknown>;
}

export interface SpreadValue {
  /** 逐字取自报告，长值只截前 MAX_VALUE 个字。 */
  text: string;
  /** 原值被截断时的总长度；没截断就没有这一栏。 */
  len?: number;
  count: number;
}

export interface FieldSpread {
  /** 形如 `verdict.level`、`checks[2].answer`，与 check:replay 的叫法一致。 */
  path: string;
  /** 按出现次数降序，并列按取值文字排序——否则顺序会随输入顺序变。 */
  values: SpreadValue[];
}

/**
 * 一组里那几份报告，分别是「谁」跑出来的。
 *
 * 为什么单独数：同一段字、同一版提示词、同一个模式，两次报告不一样——可能是模型
 * 这次说得不一样（抖动），也可能是这两次根本不是同一个模型或温度（换了输入环境）。
 * 这一栏把后者从前者里分出来。分不出来的部分（旧存档没记）单列成 missing，不许猜。
 */
export interface EngineTally {
  /** 模型名 → 份数，按份数降序、并列按名字。顺序固定，不随目录顺序变。 */
  models: { model: string; count: number }[];
  /** 供应商主机 → 份数。 */
  hosts: { host: string; count: number }[];
  /** 温度 → 份数，按温度升序。 */
  temps: { temperature: number; count: number }[];
  /** 没记的份数：旧存档没有 engine 这一栏，或模型名为空。 */
  missing: number;
}

export interface AgreementCell {
  /** 第几组，1 起。按份数降序；并列按最近时间降序，再按指纹定序。 */
  index: number;
  reports: number;
  version: string | null;
  /** 有指纹才可能成为单元格：没有指纹的报告不进比对（见 noVersion）。 */
  fingerprint: string;
  mode: string;
  theory: string;
  /** 参与比对的字段数（已排除身份与输入）。 */
  fields: number;
  /** 每次都一样的字段数。 */
  same: number;
  /** 变过的字段，按路径字典序——不按「差得多」排，排序即评价。 */
  spreads: FieldSpread[];
  chars: number;
  excerpt: string;
  truncated: boolean;
  /** 这一组是「谁」跑出来的。旧存档整组 missing，不许补一个假模型名。 */
  engine: EngineTally;
  /** 最近一份的时间。 */
  at: number;
  /** 组内每一份的 id，按时间降序。 */
  ids: string[];
}

export interface AgreementView {
  /** 读得出来、且有原文的报告份数。 */
  reports: number;
  /** 原文为空、没有参与比对的份数。 */
  blanks: number;
  /** 没有提示词指纹（旧存档）、因此没有参与比对的份数。 */
  noVersion: number;
  /** 读不出来的报告文件数，由主进程给。 */
  badFiles: number;
  /** 跑过不止一次的组，按份数降序。 */
  repeat: AgreementCell[];
  /** 只跑过一次的组数：跑一遍看不出会不会一样。 */
  singles: number;
  /** repeat 里有几组的报告每次都一模一样。 */
  identical: number;
  /** repeat 里有几组变过。 */
  spread: number;
  /**
   * repeat 里有几组**没有可比字段**（报告只剩身份与输入那几栏）。
   *
   * 单独数出来，是因为它不能被算进 `identical`：一个字段都没比，
   * 说「每次都一样」是一句没被检验过的话——和恒真的断言同一类错。
   */
  uncomparable: number;
  /** 记了「谁跑的」的份数（新存档才有这一栏）。 */
  modelKnown: number;
  /** 没记的份数。这一栏不进 `identical`，但也不能被吞掉：它决定了那些「一样」能读到多远。 */
  modelMissing: number;
  /** repeat 里有几组不止一个模型名——那些组里的差异不能都算作「同一模型重复自己」。 */
  modelSwitched: number;
  /** 最大一组的份数；没有可比组时为 0。 */
  maxReports: number;
}

interface Bucket {
  fingerprint: string;
  version: string | null;
  mode: string;
  theory: string;
  passage: string;
  items: AgreementItem[];
}

function fingerprintOf(it: AgreementItem): string {
  return typeof it.fingerprint === 'string' && it.fingerprint.trim() !== '' ? it.fingerprint : '';
}

/** 用于判等的规范形式：`'3'` 与 `3` 不是同一个值。 */
function ident(v: unknown): string {
  return v === undefined ? '\u0000undefined' : JSON.stringify(v) ?? String(v);
}

function clip(v: unknown): { text: string; len?: number } {
  if (v === undefined) return { text: '（无此字段）' };
  const s = typeof v === 'string' ? v : JSON.stringify(v) ?? String(v);
  return s.length <= MAX_VALUE ? { text: s } : { text: s.slice(0, MAX_VALUE), len: s.length };
}

/**
 * 从一份报告里取出「谁跑的」。三项缺一项就当没记。
 *
 * 缺一项就整条不认，理由和 `normalizeEngine` 一样：半条记录会让读的人
 * 以为这一组是同一个模型、同一个温度，而温度其实是空的。
 */
function engineOf(it: AgreementItem): { model: string; host: string; temperature: number } | null {
  const e = (it.report as { engine?: unknown } | undefined)?.engine as
    | { model?: unknown; host?: unknown; temperature?: unknown }
    | undefined;
  const model = typeof e?.model === 'string' ? e.model.trim() : '';
  const host = typeof e?.host === 'string' ? e.host.trim() : '';
  const t = typeof e?.temperature === 'number' ? e.temperature : NaN;
  if (!model || !host || !Number.isFinite(t)) return null;
  return { model, host, temperature: t };
}

function tallyEngine(items: AgreementItem[]): EngineTally {
  const models = new Map<string, number>();
  const hosts = new Map<string, number>();
  const temps = new Map<number, number>();
  let missing = 0;
  for (const it of items) {
    const e = engineOf(it);
    if (!e) {
      missing += 1;
      continue;
    }
    models.set(e.model, (models.get(e.model) ?? 0) + 1);
    hosts.set(e.host, (hosts.get(e.host) ?? 0) + 1);
    temps.set(e.temperature, (temps.get(e.temperature) ?? 0) + 1);
  }
  return {
    /* 并列时按名字定序：否则同名份数相同时，顺序会随目录顺序变。 */
    models: [...models.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([model, count]) => ({ model, count })),
    hosts: [...hosts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([host, count]) => ({ host, count })),
    temps: [...temps.entries()].sort((a, b) => a[0] - b[0]).map(([temperature, count]) => ({ temperature, count })),
    missing,
  };
}

function compareCells(a: AgreementCell, b: AgreementCell): number {
  return (
    b.reports - a.reports ||
    b.at - a.at ||
    a.fingerprint.localeCompare(b.fingerprint) ||
    a.mode.localeCompare(b.mode) ||
    a.theory.localeCompare(b.theory)
  );
}

/**
 * 把存档切成单元格，逐单元格数「哪些字段每次都一样」。
 *
 * 输入先按 (时间降序, id 升序) 固定排序：目录顺序不是事实，
 * 拿它当依据会让同一份存档在不同机器上读出不同的组序。
 */
export function agreementOf(items: AgreementItem[], badFiles = 0): AgreementView {
  const bad = Number.isFinite(badFiles) ? Math.max(0, Math.floor(badFiles)) : 0;

  const usable: AgreementItem[] = [];
  let blanks = 0;
  for (const it of items) {
    if (!it || typeof it.passage !== 'string' || typeof it.at !== 'number') {
      // 形状不对的记录由主进程计入 badFiles；这里再挡一次，免得一个坏对象毁掉整份账
      continue;
    }
    if (normalizePassage(it.passage) === '') {
      blanks += 1;
      continue;
    }
    usable.push(it);
  }
  usable.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));

  let noVersion = 0;
  const buckets = new Map<string, Bucket>();
  for (const it of usable) {
    const fp = fingerprintOf(it);
    if (!fp) {
      noVersion += 1;
      continue;
    }
    const passage = normalizePassage(it.passage);
    // \u0000 分隔，避免指纹或文本里恰好有分隔符时两组被并成一组
    const key = [fp, it.theory ?? '', it.mode ?? '', passage].join('\u0000');
    const b = buckets.get(key);
    if (b) b.items.push(it);
    else
      buckets.set(key, {
        fingerprint: fp,
        version: it.version ?? null,
        mode: it.mode ?? '',
        theory: it.theory ?? '',
        passage,
        items: [it],
      });
  }

  const cells: AgreementCell[] = [];
  for (const b of buckets.values()) {
    const flats = b.items.map((it) => flatten(it.report ?? {}));
    const paths = new Set<string>();
    for (const f of flats) {
      for (const p of f.keys()) if (!INPUT_KEYS.has(p.split('.')[0])) paths.add(p);
    }

    const spreads: FieldSpread[] = [];
    for (const path of paths) {
      const seen = new Map<string, SpreadValue>();
      for (const f of flats) {
        const clipped = clip(f.get(path));
        const k = ident(f.get(path));
        const cur = seen.get(k);
        if (cur) cur.count += 1;
        else seen.set(k, { ...clipped, count: 1 });
      }
      if (seen.size <= 1) continue;
      const values = [...seen.values()].sort((x, y) => y.count - x.count || x.text.localeCompare(y.text));
      spreads.push({ path, values });
    }
    spreads.sort((a, b2) => a.path.localeCompare(b2.path));

    const rep = b.items[0];
    cells.push({
      index: 0, // 排完序再编号，否则编号会带着目录顺序
      reports: b.items.length,
      version: b.version,
      fingerprint: b.fingerprint,
      mode: b.mode,
      theory: b.theory,
      fields: paths.size,
      same: paths.size - spreads.length,
      spreads,
      chars: b.passage.length,
      excerpt: b.passage.slice(0, EXCERPT_LEN),
      truncated: b.passage.length > EXCERPT_LEN,
      engine: tallyEngine(b.items),
      at: rep.at,
      ids: b.items.map((x) => x.id),
    });
  }

  const all = cells.sort(compareCells);
  const repeat = all.filter((c) => c.reports >= 2);
  repeat.forEach((c, i) => {
    c.index = i + 1;
  });

  /* 「谁跑的」按份数数，不按组数数：一句话「76 份没记模型」比「9 组都没记」更接近事实。 */
  let modelKnown = 0;
  let modelMissing = 0;
  for (const it of usable) {
    if (engineOf(it)) modelKnown += 1;
    else modelMissing += 1;
  }

  return {
    reports: usable.length,
    blanks,
    noVersion,
    badFiles: bad,
    repeat,
    singles: all.filter((c) => c.reports === 1).length,
    identical: repeat.filter((c) => c.spreads.length === 0 && c.fields > 0).length,
    spread: repeat.filter((c) => c.spreads.length > 0).length,
    uncomparable: repeat.filter((c) => c.fields === 0).length,
    modelKnown,
    modelMissing,
    modelSwitched: repeat.filter((c) => c.engine.models.length > 1).length,
    maxReports: repeat.length ? repeat[0].reports : 0,
  };
}

/* ─────────── 文案：只有模板、数字与原文，没有一句评价 ─────────── */

/**
 * 一行总述。没有可比组时说的也是事实（「看不出」），不是劝人多跑一遍。
 *
 * 空存档返回 null，与样本账一致：首帧不闪一个 0，也不编一句「0 组」。
 */
export function agreementLine(v: AgreementView): string | null {
  if (v.reports === 0 && v.badFiles === 0 && v.blanks === 0) return null;

  if (v.repeat.length === 0) {
    const head =
      v.reports === 0
        ? '本机还没有读得出来的报告，看不出同一段字跑两遍会不会一样。'
        : '本机还没有哪一段字用同一版提示词、同一个模式跑过两遍，所以看不出报告会不会每次一样。';
    return withSideNotes(head, v);
  }

  const max = v.repeat[0];
  /* 「最多的一组」这一句必须与事实对齐：字段数为 0 时不能说「0 个字段每次都一样」，
     那是把「没比」说成了「比过、一样」。 */
  const tail =
    max.fields === 0
      ? `最多的一组跑了 ${max.reports} 遍，那几份里没有可比的字段`
      : max.spreads.length === 0
        ? `最多的一组跑了 ${max.reports} 遍，${max.fields} 个字段每次都一样`
        : `最多的一组跑了 ${max.reports} 遍，${max.fields} 个字段里有 ${max.same} 个每次都一样`;

  const core =
    v.identical === 0 && v.spread === 0
      ? `同一版提示词、同一段字、同一个模式，跑过不止一次的有 ${v.repeat.length} 组，里面没有可比的字段。`
      : `同一版提示词、同一段字、同一个模式，跑过不止一次的有 ${v.repeat.length} 组：` +
        `${v.identical} 组每次报告完全一样` +
        (v.spread > 0 ? `，${v.spread} 组变过` : '') +
        `；${tail}。`;

  return withSideNotes(core, v);
}

/** 没参与比对的份数要说出来，否则「有 9 组」听起来像是全部。 */
function withSideNotes(line: string, v: AgreementView): string {
  const notes: string[] = [];
  if (v.noVersion > 0) notes.push(`${v.noVersion} 份旧报告没记提示词版本，没有放进来比`);
  if (v.blanks > 0) notes.push(`${v.blanks} 份原文是空的`);
  if (v.badFiles > 0) notes.push(`${v.badFiles} 个报告文件读不出来，没有计入`);
  if (v.uncomparable > 0) notes.push(`${v.uncomparable} 组里没有可比的字段`);
  /*
   * 「谁跑的」两句话必须出现在总述里，因为收起状态下只有这一行可见。
   * 少了它们，读者会把「3 组每次报告完全一样」读成「这个模型是确定的」——
   * 而它可能只是在同一个模型上重复；也可能连跑的是什么模型都不知道。
   */
  if (v.modelMissing > 0) {
    notes.push(
      /* 说「本机」：这个数按份数数全机，包含没参与比对的那几份。
         不加这两个字，读者会以为它是「比过的 75 份里没记的」——同一个数字，
         一个说的是全局，一个说的是对照组，差得很远。 */
      v.modelKnown === 0
        ? `本机 ${v.modelMissing} 份报告没记模型（旧存档没有这一栏）`
        : `${v.modelMissing} 份没记模型`,
    );
  }
  if (v.modelSwitched > 0) {
    notes.push(`${v.modelSwitched} 组里不止一个模型，那些差异不能都算作「同一个模型重复自己」`);
  }
  return notes.length ? `${line}另：${notes.join('，')}。` : line;
}

/**
 * 「谁跑的」那一段。整组都没记时也说话——沉默会被读成「知道了」。
 *
 * 只报事实：几个模型、几个温度、几个供应商、几份没记。
 * 不评「该不该换模型」，也不猜「差异是不是它造成的」——那要另一份数据才答得了。
 */
export function engineNote(t: EngineTally): string {
  if (t.models.length === 0) return t.missing > 0 ? '没记模型' : '';
  const names = t.models.map((m) => m.model);
  /* 没记的份数在「一个模型」与「多个模型」两种情形下都要说出来：
     两个模型 + 两份没记时只写「A / B（换过）」，读的人会以为这一组已经全部对上号了。 */
  let out = names.length === 1 ? `模型 ${names[0]}` : `模型 ${names.join(' / ')}（换过）`;
  if (t.missing > 0) out += `，另有 ${t.missing} 份没记`;
  if (t.temps.length > 1) out += `，温度 ${t.temps.map((x) => x.temperature).join(' / ')}`;
  if (t.hosts.length > 1) out += `，供应商 ${t.hosts.map((x) => x.host).join(' / ')}`;
  return out;
}

/** 一组的开头：第几组、几份、哪版、哪个模式、字段情况。 */
export function cellHead(c: AgreementCell): string {
  const ver = c.version === null ? '版本未知' : `v${c.version}`;
  const spread =
    c.spreads.length === 0
      ? `${c.fields} 个字段每次都一样`
      : `${c.fields} 个字段里有 ${c.same} 个每次都一样，${c.spreads.length} 个变过`;
  return `第 ${c.index} 组 · ${c.reports} 份 · ${ver} · 模式 ${c.mode} · ${spread}`;
}

/**
 * 一组的后半截：「谁跑的」+ 时间 + 原文摘录。
 *
 * 为什么和 `cellHead` 分开：界面把这两段摆成两行（`.ag-head` / `.ag-rest`），
 * 模型名就从行首开始，不会在中间被断成「gpt-」/「4o-mini」。
 * 导出仍然把两段用「 · 」拼成一行——同一个事实，两种排版，不是两套说法。
 */
export function cellRest(c: AgreementCell, fmt: (at: number) => string): string {
  const engine = engineNote(c.engine);
  return `${engine ? `${engine} · ` : ''}最近一次 ${fmt(c.at)} · ${c.excerpt}${c.truncated ? '…' : ''}`;
}

/** 一组的明细行（导出与纯文本用）。只由模板、数字与原文摘录拼成。 */
export function cellLine(c: AgreementCell, fmt: (at: number) => string): string {
  return `${cellHead(c)} · ${cellRest(c, fmt)}`;
}

/** 一处差异：路径 + 每种取值出现几次。值逐字来自报告。 */
export function spreadLine(s: FieldSpread): string {
  const vals = s.values.map((v) => `${v.count} 次「${v.text}${v.len !== undefined ? '…' : ''}」`).join(' / ');
  return `${s.path}：${vals}`;
}

/**
 * 可复制的纯文本。第一行就是界面那一行，然后每组一行、每处差异一行。
 *
 * 末尾那两句不是评价，是**这份数据能读到多远**：新报告记了跑它的模型、供应商与生效温度，
 * 早期存档没有这一栏；而记了也只是记了模型名——同一个名字背后是不是同一版权重，
 * 这份存档不知道。这两句不写在数据旁边，那些数字会被当成它证明不了的结论。
 */
export function agreementText(v: AgreementView, fmt: (at: number) => string): string {
  const line = agreementLine(v);
  if (line === null) return '';
  const out: string[] = [line, ''];
  for (const c of v.repeat) {
    out.push(cellLine(c, fmt));
    for (const s of c.spreads) out.push(`  ${spreadLine(s)}`);
  }
  if (v.singles > 0) out.push(`另有 ${v.singles} 组只跑过一次，没有列出来：跑一遍看不出会不会一样。`);
  out.push('报告里记了跑它的模型、供应商主机与生效温度的是新存档；早期存档没有这一栏，明细里写「没记模型」。');
  out.push(
    '同一个模型名不等于同一个版本，供应商什么时候换权重，这份存档不知道；没记模型的组，差别分不开「模型每次说得不一样」与「当时换了模型或设置」。',
  );
  return out.join('\n');
}
