/**
 * 两份对照：同一段字跑了两遍，两份报告**逐处**摆在一起。
 *
 * 起因是一个数字说不清的地方。「同题复跑」只报「这一组 8 份里有 268 处字段变过」——
 * 但 268 这个数不是「到处在抖」，它藏着好几种完全不同的情形：
 *
 *   - 八份里有七份逐字相同，只有一份是另一个东西（本机 v2.0.0 那组正是这样：
 *     七份报告 6.9 KB，第八份 9.7 KB）。汇总数字把它读成「模型不稳定」，
 *     实际是「一次换了个东西跑」。
 *   - 一份里某一段被重写了，另一份只改了一个词。两者都算「1 处」还是「20 处」，
 *     取决于按什么粒度数——而读的人真正需要的是**看**这两段。
 *
 * 所以这一层不做汇总，只做对齐：把两份报告摊成路径，逐条比，把不同的那几条
 * 连着两边的原文一起端出来。数字只留两个（比了多少、几个一样），其余全是原文。
 *
 * 五条边界，与「同题复跑」同源：
 *
 *   1. **不评哪一份更对。** 差异不是错误，也不是「模型在犹豫」的证据。
 *      这一层没有「更好 / 更差 / 更稳」这三个词。
 *   2. **缺失与不同分成两种。** 甲有乙没有，和两边都有但不一样，
 *      是两件事；混成一个「变了」会让「这一栏只在一份里出现」被读成「改过」。
 *   3. **四项相同与否各自说，不合成一句「可比」。** 原文、透镜、模式、提示词指纹
 *      任一不同，下面那张表就不再是「同一个输入跑了两遍」——这句话必须写在表前面，
 *      不能等用户自己看出来。
 *   4. **按 id 对齐，不按下标。** 实测本机 9 组重复报告里，同一段的
 *      `checks` / `premises` / `refutations` 的 id 与顺序都一致；但按下标对齐
 *      只要模型重排一次，整张表就会红成一片假差异。id 缺失时退回下标，
 *      并在类型上标明它是按位置对齐的（`positional`）。
 *   5. **不猜原因。** 两份的模型与温度只照实列出来；没记就说没记。
 */
import type { AnalysisMode, Diagnosis, TheoryId, VerdictLevel } from './types';

/** 单个取值显示多长。超出部分由界面补省略号——数据里不造一个不属于原文的字。 */
export const SIDE_MAX_VALUE = 400;

export type SideSectionId =
  | 'conclusion'
  | 'premises'
  | 'intermediate'
  | 'checks'
  | 'defeat'
  | 'verdict'
  | 'confidence'
  | 'repair'
  | 'refutations'
  | 'labels'
  | 'legitimateMoves'
  | 'selfCheck'
  | 'diagnostics'
  | 'scope'
  | 'context'
  | 'lens'
  | 'other';

/**
 * 区段的固定顺序。
 *
 * 按「一份报告从上往下读」的顺序排，不按「差得多」排——排序即评价，
 * 把变过最多的那一段顶到最前面，等于替用户决定了该看哪里。
 */
export const SECTION_ORDER: { id: SideSectionId; label: string; key: string }[] = [
  { id: 'conclusion', label: '结论', key: 'conclusion' },
  { id: 'premises', label: '前提', key: 'premises' },
  { id: 'intermediate', label: '中间结论', key: 'intermediate' },
  { id: 'checks', label: '检查项', key: 'checks' },
  { id: 'defeat', label: '击败', key: 'defeat' },
  { id: 'verdict', label: '评级', key: 'verdict' },
  /* 把握紧跟在评级后面：同一份判断，一处说「几档」，一处说「这个判断有多把稳」。
     两者不许合并成一段——档位低而把握高（或反过来）本身就是该被看见的形状。 */
  { id: 'confidence', label: '把握', key: 'confidence' },
  { id: 'repair', label: '修补', key: 'repair' },
  { id: 'refutations', label: '反驳', key: 'refutations' },
  { id: 'labels', label: '命名候选', key: 'labels' },
  { id: 'legitimateMoves', label: '合法动作', key: 'legitimateMoves' },
  { id: 'selfCheck', label: '自检', key: 'selfCheck' },
  { id: 'diagnostics', label: '诊断', key: 'diagnostics' },
  { id: 'scope', label: '适用性', key: 'scope' },
  { id: 'context', label: '上下文', key: 'context' },
  { id: 'lens', label: '透镜专属', key: 'lens' },
  /* 兜底：报告里出现了这张表没分类的顶层字段。它会以「其他」出现在表里，
     而不是被悄悄归进「透镜专属」——归错了比露出来更难发现。`check:sideby`
     有一条断言盯着「样本里的每个顶层字段都有归属」，所以这一栏正常应当是空的。 */
  { id: 'other', label: '其他', key: '' },
];

/** 不进比对、只在表头出现的顶层字段：身份、输入、以及「谁跑的」。
 *  `brief` / `divergence` 是人填的立案与分歧账：只在按「分析」那一刻被带走，
 *  不进提示词、不参与判定。把它们列进「其他」差异，会把「人补填了一份账」
 *  读成「模型这次写得不一样」；与 passage / mode 同一条口径，排除。
 */
const HEAD_KEYS = new Set([
  'version', 'id', 'parentId', 'mode', 'theory', 'createdAt', 'passage', 'prompt', 'engine', 'raw',
  'brief', 'divergence',
]);

/**
 * 字段名 → 人话。
 *
 * 这张表**不是文档**，是界面文案的唯一来源：加一个字段却忘了加翻译，
 * 界面上就会露出一个英文单词。`check:sideby` 里有一条断言盯着这件事——
 * 它拿 `NORMALIZED` 样本里出现的每一个字段去查表，查不到就红。
 */
export const FIELD_LABEL: Record<string, string> = {
  text: '那句话',
  quote: '原文引用',
  supports: '支撑谁',
  role: '角色',
  implicit: '是否隐含',
  span: '原文位置',
  start: '起点',
  end: '终点',
  id: '编号',
  label: '名字',
  question: '问题',
  meta: '元问题',
  answer: '答案',
  basis: '依据',
  guards: '守着哪一处',
  landsOn: '落到名录',
  system: '出自哪套问题表',
  level: '档位',
  statement: '说法',
  qualification: '限定语',
  whatIsRefuted: '被否证的是什么',
  scale: '刻度名',
  scaleValue: '档位（原生刻度）',
  kind: '类型',
  checkId: '挂在哪一关',
  cuts: '切断哪一步',
  explanation: '解释',
  tag: '认知标签',
  confidence: '把握',
  missingPremise: '缺的那句前提',
  alternativeReading: '换一副透镜会看到',
  answerable: '还能回答什么',
  burdenStatus: '举证现状',
  repairedForm: '补完的写法',
  targetId: '打的是哪一条',
  strategy: '打法',
  claim: '说的是什么',
  script: '可用的说法',
  steelman: '对方最可能的反击',
  reply: '怎么回',
  evidenceNeeded: '还缺什么证据',
  burdenAfter: '之后谁举证',
  name: '名字',
  why: '为什么是它',
  condition: '成立条件',
  whenLegitimate: '何时其实合法',
  riskOfError: '最可能错在哪',
  move: '这一步',
  note: '附注',
  applicable: '这副透镜适不适用',
  reason: '理由',
  outOfScopeAt: '不适用在哪一处',
  partialNote: '部分适用的说明',
  modalOverreach: '模态是否过头',
  modalNote: '模态说明',
  code: '代码',
  severity: '严重程度',
  message: '说明',
  audience: '写给谁',
  stakes: '赌注',
  genre: '体裁',
  domain: '领域',
  purpose: '目的',
  unanswered: '没答上的',
  overclaimed: '说过了头的',
  weakestLink: '最弱的一环',
  couldBeStronger: '还能更强的地方',
  summary: '小结',
  keywords: '关键词',
  entries: '条目',
  values: '取值',
  /* 上下文（争议之点与对话类型）：语用辩证透镜下这几栏是判定的一部分，不是描述 */
  issue: '争议之点',
  speakerPosition: '说话人的立场',
  opposingPosition: '对方的立场',
  dialogueType: '对话类型',
  dialogueTypeBasis: '判成这一类型的依据',
  stage: '处在哪一阶段',
  audienceKind: '受众类型',
  contextGaps: '上下文缺什么',
  /* 前提的可接受性与举证 */
  implicitBasis: '凭什么算隐含前提',
  burden: '举证在谁',
  acceptability: '可接受性',
  status: '状态',
  forAudience: '对这个受众',
  /* 型式（名录用） */
  family: '型式族',
  familyBasis: '认成这一族的依据',
  schemeId: '型式编号',
  schemeName: '型式名',
  skeleton: '骨架',
  alternativeFamily: '更可能被认成的另一族',
  alternativeNote: '族的误认说明',
  /* 判档记录（D0–D5）。`level` 与四档共用「档位」，这里只补 D 档特有的几栏：
     记录七项各自是一句人话，读的人要在界面上分清「缺哪一项」，不能都印成英文。 */
  grade: 'D 档',
  clause: '触发条款',
  at: '缺陷位置',
  evidence: '凭什么这一档',
  fix: '怎么处置',
  downgrade: '降级条件',
  d5: 'D5 四道记录',
  consequence: '后果闸门',
  synergy: '协同闸门',
  protocol: '协议闸门',
  removed: '反事实移除测试',
  /* EPI 自评的七项与合计 */
  epi: 'EPI 自评',
  P1_source: 'EPI 1 来源',
  P2_context: 'EPI 2 语境',
  P3_position: 'EPI 3 立场',
  P4_withdrawal: 'EPI 4 可撤回',
  P5_selfApply: 'EPI 5 自指',
  P6_openness: 'EPI 6 开放',
  P7_steelman: 'EPI 7 钢人',
  total: 'EPI 合计',
  vetoed: '是否触发单项否决',
  reading: 'EPI 读法',
  ruleAudit: '规则自审',
  unknowns: '还不知道的',
  withdrawIf: '什么情况下该撤回',
  opennessNote: '开放度说明',
  underOtherLens: '换一副透镜会看到',
};

export interface SideHead {
  id: string;
  at: number;
  theory: TheoryId;
  mode: AnalysisMode;
  /** 提示词版本；旧存档没有这一栏时为 null。 */
  version: string | null;
  /** 提示词指纹；没有时为空串，与「同题复跑」同口径。 */
  fingerprint: string;
  /** 「谁跑的」：模型 / 主机 / 温度。三项缺一项就整条不认，与 `Diagnosis.engine` 同规矩。 */
  engine: { model: string; host: string; temperature: number } | null;
  level: VerdictLevel;
  /**
   * 报告的份量：JSON 序列化后的**字符数**（不是字节——汉字一个字三个字节，
   * 混着写会让人以为 6990 是 6.9 KB）。
   */
  chars: number;
}

export type SideRowKind = 'changed' | 'only-left' | 'only-right';

export interface SideRow {
  /** 形如 `check[CQ2].answer`。与 `check:replay`、`同题复跑` 的叫法同源，便于互相对照。 */
  path: string;
  /** 人话标签，如「检查项 CQ2 · 答案」。查不到字段翻译时退化成原字段名，不留空。 */
  label: string;
  section: SideSectionId;
  kind: SideRowKind;
  /** 显示用取值。缺失的一侧写「（这份里没有这一栏）」，不写空串。 */
  left: string;
  right: string;
  /** 值被截断时的原长度。 */
  leftLen?: number;
  rightLen?: number;
}

export interface SideSection {
  id: SideSectionId;
  label: string;
  /** 这一段里不一样的处数。 */
  rows: number;
}

export interface SideBySide {
  a: SideHead;
  b: SideHead;
  /**
   * 四项各自相同与否。**不合成一句「可比」**：原文相同但透镜不同，
   * 与原文不同但透镜相同，是两种完全不同的情形。
   */
  same: { passage: boolean; theory: boolean; mode: boolean; fingerprint: boolean };
  /** 两边路径的并集大小。分母，必须说出来。 */
  fields: number;
  /** 两边都有、且逐字相同的路径数。 */
  equal: number;
  /** 只有甲有的路径数。单项列出，不并进 `equal`。 */
  onlyLeft: number;
  onlyRight: number;
  /** 不一样的那些行，按 `SECTION_ORDER` 再按路径排序。 */
  rows: SideRow[];
  /** 有差异的区段，按 `SECTION_ORDER`。空区段不列。 */
  sections: SideSection[];
}

/**
 * 一个值怎么显示。
 *
 * 三种「没有」必须分开写，混起来会让人读错整张表：
 *   - `undefined`：这一份里根本没有这个字段 → 「这份里没有这一栏」；
 *   - `null`：字段在，值是空的 → 「空值」；
 *   - `''`：字段在，写了个空字符串 → 「空字符串」。
 * 第一版把 `null` 直接 `JSON.stringify`，界面上印出一个英文的 `null`——
 * 截图里那句「乙：null」就是这么来的。它既不像中文，也不像「没有」，
 * 而读的人只会以为哪里坏了。
 */
function clipValue(v: unknown): { text: string; len?: number } {
  if (v === undefined) return { text: '（这份里没有这一栏）' };
  if (v === null) return { text: '（空值）' };
  if (v === '') return { text: '（空字符串）' };
  const s = typeof v === 'string' ? v : JSON.stringify(v) ?? String(v);
  return s.length <= SIDE_MAX_VALUE ? { text: s } : { text: s.slice(0, SIDE_MAX_VALUE), len: s.length };
}

function ident(v: unknown): string {
  return v === undefined ? '\u0000undefined' : JSON.stringify(v) ?? String(v);
}

function headOf(d: Diagnosis): SideHead {
  const e = (d as { engine?: unknown }).engine as
    | { model?: unknown; host?: unknown; temperature?: unknown }
    | undefined;
  const model = typeof e?.model === 'string' ? e.model.trim() : '';
  const host = typeof e?.host === 'string' ? e.host.trim() : '';
  const t = typeof e?.temperature === 'number' ? e.temperature : NaN;
  const fp = typeof d.prompt?.fingerprint === 'string' ? d.prompt.fingerprint : '';
  return {
    id: d.id,
    at: d.createdAt,
    theory: d.theory,
    mode: d.mode,
    version: typeof d.prompt?.version === 'string' ? d.prompt.version : null,
    fingerprint: fp,
    /* 三项齐全才认，与 engineOf 同规矩：半条记录会让读的人以为温度也是同一个 */
    engine: model && host && Number.isFinite(t) ? { model, host, temperature: t } : null,
    level: d.verdict?.level,
    chars: ident(d).length,
  };
}

/** 数组元素的键：有 id 用 id，没有就用位置。第二种会在路径里带 `#`，好认。 */
function elemKey(v: unknown, index: number): string {
  const o = v as { id?: unknown } | null;
  const id = typeof o?.id === 'string' ? o.id.trim() : '';
  return id !== '' ? id : `#${index}`;
}

/**
 * 摊成「语义路径 → 值」。
 *
 * 与 `replay.flatten` 的差别只有一处，但很要紧：数组用**元素自己的 id** 做键，
 * 不用下标。按下标对齐时，只要模型把检查项换了个顺序，整段都会被读成「全变了」——
 * 那不是两份报告的差异，是对齐方式的差异。
 */
export function sideFlat(d: Diagnosis): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const walk = (v: unknown, path: string): void => {
    if (v === null || typeof v !== 'object') {
      out.set(path, v);
      return;
    }
    if (Array.isArray(v)) {
      /*
       * 键里保留**英文原字段名**（`checks[CQ2]`），只在显示时翻成人话。
       * 第一版把中文前缀写进了键里，于是 `topKeyOf` 认不出它属于哪一段，
       * 整张表都掉进兜底段——路径是给机器对齐用的，不是给眼睛看的。
       */
      v.forEach((item, i) => walk(item, `${path}[${elemKey(item, i)}]`));
      return;
    }
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) walk(val, path === '' ? k : `${path}.${k}`);
  };

  for (const [k, v] of Object.entries(d as unknown as Record<string, unknown>)) {
    if (HEAD_KEYS.has(k)) continue;
    walk(v, k);
  }
  return out;
}

/** 路径的顶级字段（`check[CQ2]` → `checks`），用于归段。 */
function topKeyOf(path: string): string {
  return path.split(/[.[]/)[0];
}

function sectionOf(path: string): SideSectionId {
  const arr = path.split(/[.[]/)[0];
  const hit = SECTION_ORDER.find((s) => s.key === arr);
  return hit ? hit.id : 'other';
}

/**
 * 一行的人话标签：`check[CQ2].answer` → 「检查项 CQ2 · 答案」。
 *
 * 查不到字段翻译时**退化成原字段名而不是空串**：空标签会让那条差异变成一行
 * 只看得见值的字，读的人不知道自己在看什么。原字段名难看，但它是真的。
 */
export function rowLabel(path: string): string {
  const m = /^([A-Za-z]+)\[([^\]]*)\]/.exec(path);
  const top = m ? m[1] : path.split('.')[0];
  const head = SECTION_ORDER.find((s) => s.key === top);
  const headLabel = head ? head.label : FIELD_LABEL[top] ?? top;
  const who = m ? m[2] : '';
  const rest = m ? path.slice(m[0].length) : path.slice(top.length);
  const fields = rest
    .split('.')
    .filter(Boolean)
    .map((f) => FIELD_LABEL[f] ?? f);
  const left = who ? `${headLabel} ${who}` : headLabel;
  return fields.length ? `${left} · ${fields.join(' · ')}` : left;
}

/**
 * 两份摆在一起。
 *
 * 任何一份读不出来时调用方必须**不做**这张表（`null`），而不是给一张空表：
 * 一张 0 行的表会被读成「两份完全一样」。
 */
export function sideBySide(a: Diagnosis, b: Diagnosis): SideBySide | null {
  if (!a || !b) return null;

  const fa = sideFlat(a);
  const fb = sideFlat(b);
  const paths = new Set<string>([...fa.keys(), ...fb.keys()]);

  let equal = 0;
  let onlyLeft = 0;
  let onlyRight = 0;
  const rows: SideRow[] = [];

  for (const path of paths) {
    const hasA = fa.has(path);
    const hasB = fb.has(path);
    if (!hasA || !hasB) {
      if (hasA) onlyLeft += 1;
      else onlyRight += 1;
      const one = clipValue(hasA ? fa.get(path) : fb.get(path));
      rows.push({
        path,
        label: rowLabel(path),
        section: sectionOf(path),
        kind: hasA ? 'only-left' : 'only-right',
        left: hasA ? one.text : '（这份里没有这一栏）',
        right: hasA ? '（这份里没有这一栏）' : one.text,
        leftLen: hasA ? one.len : undefined,
        rightLen: hasA ? undefined : one.len,
      });
      continue;
    }
    if (ident(fa.get(path)) === ident(fb.get(path))) {
      equal += 1;
      continue;
    }
    const l = clipValue(fa.get(path));
    const r = clipValue(fb.get(path));
    rows.push({
      path,
      label: rowLabel(path),
      section: sectionOf(path),
      kind: 'changed',
      left: l.text,
      right: r.text,
      leftLen: l.len,
      rightLen: r.len,
    });
  }

  const order = new Map(SECTION_ORDER.map((s, i) => [s.id, i] as const));
  rows.sort((x, y) => (order.get(x.section) ?? 99) - (order.get(y.section) ?? 99) || x.path.localeCompare(y.path));

  const counts = new Map<SideSectionId, number>();
  for (const r of rows) counts.set(r.section, (counts.get(r.section) ?? 0) + 1);
  const sections = SECTION_ORDER.filter((s) => (counts.get(s.id) ?? 0) > 0).map((s) => ({
    id: s.id,
    label: s.label,
    rows: counts.get(s.id) ?? 0,
  }));

  const ha = headOf(a);
  const hb = headOf(b);
  return {
    a: ha,
    b: hb,
    same: {
      passage: (a.passage ?? '') === (b.passage ?? ''),
      theory: ha.theory === hb.theory,
      mode: ha.mode === hb.mode,
      fingerprint: ha.fingerprint !== '' && ha.fingerprint === hb.fingerprint,
    },
    fields: paths.size,
    equal,
    onlyLeft,
    onlyRight,
    rows,
    sections,
  };
}

/* ─────────── 文案：只有模板、数字与原文，没有一句评价 ─────────── */

/** 一行总述。分母永远写出来：只说「268 处不同」，读的人不知道那是 364 里的 268 还是 9000 里的 268。 */
export function sidebyLine(s: SideBySide): string {
  const differs = s.rows.length;
  const parts = [`逐路径比了 ${s.fields} 个字段：${s.equal} 个逐字一样，${differs} 个不一样`];
  if (s.onlyLeft > 0 || s.onlyRight > 0) {
    parts.push(`（其中甲有乙没有 ${s.onlyLeft} 个、乙有甲没有 ${s.onlyRight} 个）`);
  }
  if (differs === 0) return `${parts.join('')}。两份报告在比到的字段上逐字相同。`;
  return `${parts.join('')}。`;
}

/**
 * 四项里哪几项不同。相同的返回 `null`——「一样」不需要提醒，
 * 但**不一样必须提醒**，而且要说清它让下面那张表失去了什么。
 */
export function samenessNote(s: SideBySide): string | null {
  const bad: string[] = [];
  if (!s.same.passage) bad.push('原文不是同一段字');
  if (!s.same.theory) bad.push('用的不是同一副透镜');
  if (!s.same.mode) bad.push('不是同一个分析模式');
  if (!s.same.fingerprint) bad.push('提示词版本不同或有一份没记指纹');
  if (bad.length === 0) return null;
  return `${bad.join('；')}。下面那张表因此不只是「同一个输入跑了两遍」的差异——读它之前先记住这一条。`;
}

/** 「谁跑的」那一行。没记就说没记，不补一个假模型名。 */
export function engineText(h: SideHead): string {
  if (!h.engine) return '没记模型与温度（早期存档没有这一栏）';
  return `${h.engine.model}@${h.engine.host}，温度 ${h.engine.temperature}`;
}

/** 份量对照：这一栏在两份报告差三倍时，比任何形容词都直接。 */
export function sizeText(s: SideBySide): string {
  return `甲 ${s.a.chars} 字 / 乙 ${s.b.chars} 字（整份报告的 JSON 长度）`;
}

/**
 * 可复制的纯文本。与界面同一份数据，不另算一遍。
 *
 * 它存在的理由和别的导出一样：把差异贴进讨论里，比说「感觉不太一样」有用。
 */
export function sidebyText(s: SideBySide, fmt: (at: number) => string): string {
  const out: string[] = [];
  out.push('两份对照（同一段字跑了两遍）');
  out.push(`甲：${fmt(s.a.at)} · ${s.a.theory} · ${s.a.mode} · 提示词 ${s.a.version ?? '未记'} · ${engineText(s.a)}`);
  out.push(`乙：${fmt(s.b.at)} · ${s.b.theory} · ${s.b.mode} · 提示词 ${s.b.version ?? '未记'} · ${engineText(s.b)}`);
  out.push(sizeText(s));
  const note = samenessNote(s);
  if (note) out.push(`注意：${note}`);
  out.push('');
  out.push(sidebyLine(s));
  for (const sec of s.sections) {
    out.push('');
    out.push(`【${sec.label}】${sec.rows} 处`);
    for (const r of s.rows.filter((x) => x.section === sec.id)) {
      out.push(`  ${r.label}`);
      out.push(`    甲：${r.left}${r.leftLen ? `…（共 ${r.leftLen} 字）` : ''}`);
      out.push(`    乙：${r.right}${r.rightLen ? `…（共 ${r.rightLen} 字）` : ''}`);
    }
  }
  out.push('');
  out.push('这张表只列不一样的。它不说哪一份更对，也不说差异从哪来——那两件事都不在这份数据里。');
  return out.join('\n');
}
