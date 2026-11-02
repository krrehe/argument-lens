import type { Diagnosis } from './types';

/**
 * 存档重放的比对内核。纯函数，不碰磁盘、不碰模型。
 *
 * 为什么这件事值得单独一个文件：报告是「模型原文 → 解析 → 十一道裁决 → 自检」的产物，
 * 而这条链路是可复算的。存了原文之后，把同一段原文重新跑一遍，和存档逐字段比，
 * 就能回答一个以前答不上的问题——**报告变了，是我改坏了，还是模型这次说的不一样？**
 * 以前两者同时动，不是实验。
 *
 * 判据不是「零差异」。版本升级本来就该有差异。判据是**每一处差异都能被解释**：
 * 要么是这次有意改的，要么是新发现的 bug。所以这个文件只负责把差异**如实列全**，
 * 不做任何「这看起来不重要，忽略掉」的判断——那种判断应该发生在读差异的人手里。
 *
 * 有一类差异必须单列而不是混进去：运行时才决定的诊断（温度被裁、提示词超预算、
 * JSON 修过一次）。它们取决于当时的设置与调用次数，而设置没有随报告存档。
 * 把它们当成普通差异，每次重放都会亮一片永远解释不清的红；直接丢掉，
 * 又是拿「没比对」冒充「没差异」。所以单独一栏，写明为什么没比。
 */

/** 只存输入，不属于「重算出来的产物」。 */
const INPUT_FIELDS = new Set(['raw']);

/**
 * 重放时无法复原的诊断码。
 *
 * 三条都取决于「那次运行的环境」，而环境没有随报告落盘：
 *   - JSON_REPAIRED：模型调用了几次（raw.attempts 记着，但重放不重新调用，也就没有重试这件事）
 *   - TEMPERATURE_CLAMPED：当时的设置温度是多少
 *   - PROMPT_OVER_BUDGET：当时那次 buildPrompt 的字符数（提示词改过就不同）
 *
 * 不猜、不补：列为「未参与比对」，并说清原因。
 */
export const RUNTIME_ONLY_CODES = ['JSON_REPAIRED', 'TEMPERATURE_CLAMPED', 'PROMPT_OVER_BUDGET'] as const;

export interface FieldDiff {
  /** 形如 `verdict.level`、`checks[2].answer` */
  path: string;
  /** 存档里的值（本次重放前） */
  before: string;
  /** 重算出来的值 */
  after: string;
  /** 原值太长时只显示前一段，这两个数说明被省掉了多少 */
  beforeLen?: number;
  afterLen?: number;
}

export interface ReplayDiff {
  /** 值变了，或存档里有的字段现在没了。这一栏才是「回归」的候选。 */
  diffs: FieldDiff[];
  /**
   * 存档里没有、现在有的字段。
   *
   * 单独一栏，因为成因完全不同：这份存档写的时候，那段代码还没有这一栏
   * （`labels[].quote` 就是后加的——加它是为了让「这个名字指的是哪一句」有答案）。
   * 把它和「值被改掉了」混在一起数，后果是这个命令对旧存档永远红，
   * 而永远红的检查等于没有检查。
   *
   * 但它不会被吞掉：照旧逐条列出。**「新增」和「一样」是两件事，和「变坏」也是两件事。**
   * 反过来那一侧不适用——存档有值、现在没了，是真的丢了东西，仍在 diffs 里。
   */
  added: FieldDiff[];
  /**
   * 存档里有、这次没参与比对的诊断。空数组表示「全都比过了」。
   * 有内容时必须打印出来——静默跳过就是假绿。
   */
  uncompared: { code: string; why: string }[];
}

const MAX_SHOW = 110;

function show(v: unknown): { text: string; len?: number } {
  if (v === undefined) return { text: '（无此字段）' };
  if (typeof v === 'string') {
    if (v.length <= MAX_SHOW) return { text: v };
    return { text: `${v.slice(0, MAX_SHOW)}…`, len: v.length };
  }
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return { text: JSON.stringify(v) };
  const s = JSON.stringify(v);
  if (s.length <= MAX_SHOW) return { text: s };
  return { text: `${s.slice(0, MAX_SHOW)}…`, len: s.length };
}

/** 用于判等的规范形式：类型也要区分，`'3'` 与 `3` 不是同一个值。 */
function ident(v: unknown): string {
  return v === undefined ? '\u0000undefined' : JSON.stringify(v) ?? String(v);
}

/**
 * 「空值」的判定，专门给 `added` 那一栏用。
 *
 * 规则：**存档里没有这一栏，而现在是空值**（null / 空串 / 空数组 / 空对象），
 * 才算「那时候还没这一栏」。理由是这样两边说的是同一件事——旧代码在那处也没有内容可说，
 * `labels[0].quote: null` 就是「没定位到位置」，而不是「多出了一个结论」。
 *
 * 只要新增的东西有内容，就一律算变化。这条边界必须收紧，否则会出现一个很坏的洞：
 * 代码开始多报一条裁决留痕（一个新的 `diagnostics[i].code`），
 * 它会落进 `added` 而被读成「只是多了个字段」——报告明明变了，检查却绿着。
 */
function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

function walk(v: unknown, path: string, out: Map<string, unknown>): void {
  if (Array.isArray(v)) {
    /* 长度单独记一条。
       不记的话，「十条检查变成八条」会以两条 `checks[8].x`、`checks[9].x` 的形式散着出现，
       看不出「少了两条」这件事本身。 */
    out.set(`${path}.length`, v.length);
    v.forEach((item, i) => walk(item, `${path}[${i}]`, out));
    return;
  }
  if (v && typeof v === 'object') {
    for (const [k, item] of Object.entries(v)) {
      if (!path && INPUT_FIELDS.has(k)) continue;
      walk(item, path ? `${path}.${k}` : k, out);
    }
    return;
  }
  out.set(path, v);
}

/**
 * 把一份报告摊平成「路径 → 值」。
 *
 * 摊平而不是递归比对，是为了让差异有名字。只报「这份不一样」没有用——
 * 读的人要去几十个字段里找是哪一处，找两次就再也不看了。
 */
export function flatten(d: Partial<Diagnosis>): Map<string, unknown> {
  const out = new Map<string, unknown>();
  walk(d, '', out);
  return out;
}

/**
 * 比对「存档」与「重算」。顺序按存档里的字段顺序，稳定可读。
 */
export function withoutRuntimeOnly(d: Partial<Diagnosis>): Partial<Diagnosis> {
  if (!d.diagnostics) return d;
  return {
    ...d,
    diagnostics: d.diagnostics.filter((x) => !(RUNTIME_ONLY_CODES as readonly string[]).includes(x.code)),
  };
}

export function diffReports(archived: Partial<Diagnosis>, replayed: Partial<Diagnosis>): ReplayDiff {
  /*
   * 两边都先摘掉「运行时才有」的那几条诊断，再比。
   *
   * 只摘一边是不够的：摘掉存档那侧、留着重算那侧，两边长度还是会差一条；
   * 两侧都留着，则每次重放都亮一片永远解释不清的红。
   * 摘掉之后它们不是消失了，而是进了 `uncompared`——「没比」和「比过、一样」必须分开说。
   */
  const a = flatten(withoutRuntimeOnly(archived));
  const b = flatten(withoutRuntimeOnly(replayed));

  const diffs: FieldDiff[] = [];
  for (const [path, av] of a) {
    const bv = b.get(path);
    if (ident(av) === ident(bv)) continue;
    const sb = show(av);
    const sa = show(bv);
    diffs.push({
      path,
      before: sb.text,
      after: sa.text,
      ...(sb.len !== undefined ? { beforeLen: sb.len } : {}),
      ...(sa.len !== undefined ? { afterLen: sa.len } : {}),
    });
  }
  /* 重算里多出来的字段：空的算「那时候还没这一栏」，有内容的算变化。
     只看存档那一侧会漏掉「新加了一栏」，而那一栏里可能正好装着一条新判断。 */
  const added: FieldDiff[] = [];
  for (const [path, bv] of b) {
    if (a.has(path)) continue;
    const sa = show(bv);
    const item: FieldDiff = {
      path,
      before: '（无此字段）',
      after: sa.text,
      ...(sa.len !== undefined ? { afterLen: sa.len } : {}),
    };
    if (isBlank(bv)) added.push(item);
    else diffs.push(item);
  }

  /* 两边都扫：实践中运行时诊断只会留在存档那一侧（重放不调用模型，也就没有重试），
     但只扫一侧是个容易在改动后失灵的假设——漏扫的后果是「没比」被读成「一样」。 */
  const seen = new Set<string>();
  const uncompared: { code: string; why: string }[] = [];
  for (const x of [...(archived.diagnostics ?? []), ...(replayed.diagnostics ?? [])]) {
    if (!(RUNTIME_ONLY_CODES as readonly string[]).includes(x.code) || seen.has(x.code)) continue;
    seen.add(x.code);
    uncompared.push({
      code: x.code,
      why:
        x.code === 'JSON_REPAIRED'
          ? '取决于那次调用了几次，重放不重新调用模型'
          : x.code === 'TEMPERATURE_CLAMPED'
            ? '取决于当时的设置温度，设置没有随报告存档'
            : '取决于当时的提示词长度，提示词改过就不可复现',
    });
  }

  return { diffs, added, uncompared };
}

/**
 * 差异的归处：这几个字段变了，最可能是哪一段代码动的。
 *
 * 不自动判定「改坏了」——它只把注意力引到该看的地方。真正的判定仍然靠人：
 * 判据是「每处差异都能被解释」，而解释只有改代码的人给得出。
 */
export function suspectOf(path: string): string {
  if (path.startsWith('verdict.') || path.startsWith('defeat.')) return 'G1/G3/G8 裁决或档位映射';
  if (path.startsWith('checks')) return '检查表归一（G2/G6/G7）或透镜数据';
  if (path.startsWith('labels')) return 'G4/G11 命名门槛';
  if (path.startsWith('premises') || path.startsWith('intermediate')) return 'G9 中间结论合并';
  if (path.startsWith('conclusion') || path.startsWith('selfCheck')) return '引文定位（locator）或自检';
  if (path.startsWith('diagnostics')) return '裁决留痕条数';
  if (path.startsWith('lens.')) return '透镜负载归一';
  return '归一化（normalizeDiagnosis）';
}
