/**
 * 语境出处的校验与降级。
 *
 * 这件事的起点是一组实测数字。本机 107 份存档里，同一段「取消早读」被分析了 98 次：
 *
 *   stage（讨论阶段）        1 种写法
 *   audienceKind（听众类型）  1 种写法
 *   speakerPosition          2 种
 *   dialogueType（对话类型）  2 种
 *   issue / audience         各 3 种
 *
 * 稳定得像常量。但这不能证明它读对了——那 41 个字的原文里，没有一处写着「说话人是谁」
 * 「听众是关注升学率的家长与校内决策者」。98 次一致只说明它对某个猜测很有信心。
 * 同一份语料里听众出现三种写法，说明这确实是猜的，而且每次猜得不一样。
 *
 * 麻烦在于语境在最上游：ARS 透镜的可接受性判定从听众出发，walton 的批判性问题排布
 * 从对话类型出发（`prompt/registry.ts` 里自己也写着，类型判错会让靠「对手方」的那几条
 * 整齐地判未违反——报告因此看起来格外干净）。上游猜错，下面一律跟着偏，而报告里
 * 没有一处承认这是猜的。结论和前提都能回原文（quote + span 的 exact/quality 逐字可查），
 * 唯独语境九格是裸断言。
 *
 * 所以这一层的职责很窄：**把「说 known 却指不出原文」这件事抓住并降级**，不替模型
 * 判断它猜得对不对。本地不做的那部分，留给界面显示和人来改。
 *
 * 三条边界，与 span 的做法同构：
 *   1. 只做可复算的对位。known 的 basis 归一化后在原文里找不到 → 降为 inferred，
 *      并带上 downgraded 标记；不猜它本来想说什么。
 *   2. 不因为语境标错就让整份分析失败。语境错不该毁掉报告，只该在报告上留痕——
 *      与 span 定位失败标 'failed' 而不是抛错，是同一条理由。
 *   3. 缺格不补齐。缺就是缺，记一条 missing，界面显示「这一格没标出处」，
 *      不来一条「inferred」冒充有人判过。
 *
 * 跑法：npm run check:context-source
 */
import type { ContextField, ContextGrounding, ContextSource } from './types';
import { CONTEXT_FIELDS } from './types';

const SOURCES: readonly ContextSource[] = ['known', 'inferred', 'guess'];

/** known 的 basis 短到几个字就必然能在任何中文原文里找到，那样的核对等于没核。 */
const MIN_KNOWN_LEN = 4;

export type GroundingProblemKind =
  | 'unknown-field'
  | 'bad-source'
  | 'basis-empty'
  | 'basis-not-in-text'
  | 'guess-without-ifchanged'
  | 'inferred-without-ifchanged'
  | 'missing';

export interface GroundingProblem {
  field: string;
  kind: GroundingProblemKind;
  detail: string;
}

export interface GroundingResult {
  grounding: Partial<Record<ContextField, ContextGrounding>>;
  problems: GroundingProblem[];
  /** 三档各几格。界面和检查都从这里取数，不在两处各数一遍。 */
  tally: Record<ContextSource, number>;
}

/**
 * 归一化：全角转半角、统一引号、丢掉所有空白。
 *
 * 规则与 `main/locator.ts` 的 normalizeWithMap 相同，但这里只判包含、不返回下标——
 * 需要位置的是 span，语境出处不需要知道在第几个字。两处规则一旦分叉，
 * 会出现「同一句话 span 认、grounding 不认」这种自相矛盾，所以 check 里有一组
 * 刁钻字符串对拍这两处。
 */
export function foldText(src: string): string {
  const out: string[] = [];
  for (let i = 0; i < src.length; i++) {
    let ch = src[i];
    const code = ch.charCodeAt(0);
    if (code >= 0xff01 && code <= 0xff5e) ch = String.fromCharCode(code - 0xfee0);
    if (ch === '\u3000') ch = ' ';
    if (ch === '\u201c' || ch === '\u201d' || ch === '\u300c' || ch === '\u300d' || ch === '\u300e' || ch === '\u300f') ch = '"';
    if (ch === '\u2018' || ch === '\u2019') ch = "'";
    if (ch === '\u2014' || ch === '\u2013') ch = '-';
    if (ch === '\u2026') ch = '~';
    if (/\s/.test(ch)) continue;
    out.push(ch);
  }
  return out.join('');
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * 把模型给的 grounding 收成可用结构，并把站不住的 known 降下来。
 *
 * 对每个格：
 *   - source 不在三档内 → 丢弃这一格，记 bad-source。宁可显示「没标」，也不顺着猜。
 *   - known 且 basis 归一化后能在原文里找到 → 保留，这是唯一一种「确实指着原文」的标法。
 *   - known 但找不到（或 basis 太短）→ 降为 inferred + downgraded，记 basis-not-in-text。
 *     降级而不是丢弃：它至少说明了「从哪推的」，这比一句没有强，但不能再冒充原文。
 *   - guess 或 inferred 没写 ifChanged → 保留，各记一条。这两条只提醒，不降级——
 *     档位本身没说谎，缺的是「换掉它有什么用」那句。guess 缺这句时更严重：
 *     它连「这一格是假定的」都不肯往下想一步。
 */
export function normalizeGrounding(raw: unknown, passage: string): GroundingResult {
  const src = asRecord(raw);
  const grounding: Partial<Record<ContextField, ContextGrounding>> = {};
  const problems: GroundingProblem[] = [];
  const tally: Record<ContextSource, number> = { known: 0, inferred: 0, guess: 0 };
  const foldedPassage = foldText(passage);

  for (const [field, value] of Object.entries(src ?? {})) {
    if (!(CONTEXT_FIELDS as readonly string[]).includes(field)) {
      problems.push({ field, kind: 'unknown-field', detail: `「${field}」不是需要标出处的语境格` });
    }
  }

  for (const field of CONTEXT_FIELDS) {
    const entry = asRecord(src?.[field]);
    if (!entry) {
      problems.push({ field, kind: 'missing', detail: '这一格没标出处' });
      continue;
    }

    const source = asString(entry.source) as ContextSource;
    if (!SOURCES.includes(source)) {
      problems.push({ field, kind: 'bad-source', detail: `出处写成「${asString(entry.source)}」，不是三档之一` });
      continue;
    }

    const basis = asString(entry.basis).trim();
    if (!basis) {
      problems.push({ field, kind: 'basis-empty', detail: '这一格有档位却没有依据' });
      continue;
    }

    const item: ContextGrounding = { source, basis };

    if (source === 'known') {
      const foldedBasis = foldText(basis);
      const hit = foldedBasis.length >= MIN_KNOWN_LEN && foldedPassage.includes(foldedBasis);
      if (!hit) {
        item.source = 'inferred';
        item.downgraded = true;
        problems.push({
          field,
          kind: 'basis-not-in-text',
          detail:
            foldedBasis.length < MIN_KNOWN_LEN
              ? `标了 known，但依据只有 ${foldedBasis.length} 个字，短到任何原文都含得下，按推出处理`
              : '标了 known，但这句话在原文里找不到，按推出处理',
        });
      }
    }

    if (source === 'guess' || source === 'inferred') {
      /*
       * 2.7.0 起 inferred 也要写 ifChanged。理由：inferred 是「据原文特征推的」，
       * 推的东西一样可能错，而读者最需要知道的不是「它从哪儿推的」，是
       * 「这一格换个样子，上面那条判定会不会变」。guess 缺这句只是少一句说明，
       * inferred 缺这句则让人误以为「推的＝稳的」。只记问题，不降级——inferred
       * 本身没说谎，缺的是敏感度那一句。
       */
      const ifChanged = asString(entry.ifChanged).trim();
      if (ifChanged) item.ifChanged = ifChanged;
      else
        problems.push({
          field,
          kind: source === 'guess' ? 'guess-without-ifchanged' : 'inferred-without-ifchanged',
          detail:
            source === 'guess'
              ? '标了猜测，却没写换成别的样子会怎样'
              : '标了推出，却没写这一格换成别的样子判定会怎样',
        });
    }

    grounding[field] = item;
    tally[item.source] += 1;
  }

  return { grounding, problems, tally };
}

/** 一句话概括出处分布。界面顶部与检查都念这一句，避免各写一套措辞。 */
export function describeGrounding(result: GroundingResult): string {
  const { known, inferred, guess } = result.tally;
  const total = known + inferred + guess;
  if (total === 0) return '这份报告没有标注语境的出处。';
  const parts: string[] = [];
  if (known) parts.push(`${known} 格能从原文指出`);
  if (inferred) parts.push(`${inferred} 格是推的`);
  if (guess) parts.push(`${guess} 格是假定`);
  return parts.join('，') + '。';
}

/** 该格是否属于「猜的」——界面据此决定要不要把那句 ifChanged 显出来。 */
export function isAssumed(g: ContextGrounding | undefined): boolean {
  return !!g && g.source === 'guess';
}
