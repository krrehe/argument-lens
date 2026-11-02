/**
 * 报告 → Argdown 文本（结构导出）。
 *
 * 为什么要有这个：Markdown 导出是给人读的，读完之后结构仍然只活在这个窗口里。
 * Argdown 是一种纯文本的论证语法，图由文本渲染——同一份报告换到任何支持它的
 * 编辑器里都能看见结构，而且**改动能进 git diff**。
 *
 * 它不是第二个判定出口，三条约束写在这里：
 *
 *   1. **只导结构，不导结论。** 档位只出现在注释里，并且带着「不是判决书」这句。
 *      图上一旦出现「站得住／站不住」，离开界面之后就会被当成结论转发。
 *   2. **不替原文加字。** 正文里 `[ ] { } # < >` 换成全角，是因为它们在语法里有
 *      含义（语句引用、元数据、标签、论证引用），不转会把原文切成语法碎片。
 *      代价是导出件与原文有六处字形差异——文件头必须写明，原文以报告为准。
 *   3. **不重算任何判定。** 这里只把已落盘的 supports / defeat / legitimateMoves
 *      排版成文本。导出件与界面显示不同的结构，比不导出更糟。
 *
 * 语法由 `@argdown/core` 的 ParserPlugin 在 `check:argdown` 里验：**解析器不报错**
 * 才算数。没有这一步，「支持 Argdown」就只是一句自我声明。
 */
import { LEVEL_LABEL, THEORY_BY_ID } from './theories';
import { MODE_META, type Claim, type Diagnosis } from './types';

/**
 * Argdown 里有语法含义的字符，换成全角。
 *
 * 只换这六个：`[` `]` 是语句引用，`{}` 是 YAML 元数据，`#` 是标签，`<>` 是论证引用。
 * 中文正文里它们大多出现在「他说『[P1] 是错的』」这类引用上，直出会让解析器
 * 把引文当语法，轻则多出节点，重则整份文件解析失败。
 */
const FULLWIDTH: Record<string, string> = {
  '[': '［',
  ']': '］',
  '{': '｛',
  '}': '｝',
  '#': '＃',
  '<': '＜',
  '>': '＞',
};

/** 单行化 + 语法安全化。换行会把一条语句撑成两段，缩进会被当成关系。 */
function safe(s: string): string {
  return s
    .replace(/\r?\n+/g, ' ')
    .replace(/[\[\]{}#<>]/g, (c) => FULLWIDTH[c] ?? c)
    .replace(/\s+/g, ' ')
    .trim();
}

function stamp(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false }).replace(/[/:]/g, '-');
}

/**
 * 关系表：谁支撑谁。
 *
 * `Claim.supports` 为空时按最朴素的重构处理——直接支撑结论 C。这条规则与
 * 结构图（Diagram.tsx）必须一致，否则同一份报告在图上有线、在导出件里没有。
 */
function relations(claims: Claim[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const c of claims) {
    const targets = c.supports.length ? c.supports : ['C'];
    for (const t of targets) {
      const arr = map.get(t) ?? [];
      arr.push(c.id);
      map.set(t, arr);
    }
  }
  return map;
}

export function reportToArgdown(d: Diagnosis): string {
  const t = THEORY_BY_ID[d.theory];
  const mode = MODE_META[d.mode];
  const out: string[] = [];
  const cmt = (s: string) => out.push(s ? `// ${s}` : '//');

  cmt('论证镜 · 结构导出（Argdown 语法）');
  cmt(`${t.name}｜${mode.label}模式`);
  /*
   * 档位只出现在注释里，而且必须带这一句。
   * 导出的文件会被转发、会被贴进别的文档，而图上没有「这是一把尺子量的」这层意思。
   */
  if (d.scope.applicable) {
    cmt(`档位：${LEVEL_LABEL[d.verdict.level]} —— 用这副尺子量出来的，不是判决书。`);
  } else {
    cmt('本副透镜在此不适用，因此没有档位。');
    if (d.scope.reason) cmt(`不适用之处：${safe(d.scope.reason)}`);
  }
  cmt(d.prompt ? `提示词：v${d.prompt.version}（指纹 ${d.prompt.fingerprint}）` : '提示词：版本未记录');
  cmt(`生成：${stamp(d.createdAt)}`);
  cmt('');
  cmt('这个文件只表达「哪几句支撑哪一句」。判断在报告里，这里不重新判断。');
  cmt('正文里的 [ ] { } # < > 已换成全角，以免被当成语法；原文以报告为准。');
  out.push('');

  /* ── 语句定义 ── */

  out.push(`[C]: ${safe(d.conclusion.text)}`);
  out.push('');

  for (const c of [...d.premises, ...d.intermediate]) {
    const tags = c.implicit ? ' #隐含前提' : '';
    out.push(`[${c.id}]: ${safe(c.text)}${tags}`);
    out.push('');
  }

  /*
   * 「此处合法」是一个独立语句，不连边。
   * 连边等于声称它支撑了某一步——它恰恰是「这一步本来就没问题」，
   * 与被判接不上的那一步是两件事。孤立节点在图上不好看，但它是诚实的形状。
   */
  d.legitimateMoves.forEach((m, i) => {
    out.push(`[L${i + 1}]: ${safe(m.what)} #此处合法`);
    out.push('');
  });

  /* ── 关系 ── */

  const rel = relations([...d.premises, ...d.intermediate]);
  const order = ['C', ...d.premises.map((c) => c.id), ...d.intermediate.map((c) => c.id)];
  let wroteRel = false;
  for (const target of order) {
    const sources = rel.get(target);
    if (!sources || !sources.length) continue;
    out.push(`[${target}]`);
    for (const s of sources) out.push(`    <+ [${s}]`);
    out.push('');
    wroteRel = true;
  }
  if (!wroteRel) {
    /* 一条关系都没有时不写空块，也不假装结构是完整的。 */
    cmt('没有可表达为「支撑」的关系：这份报告没有拆出显式前提，或前提全被判为不支撑结论。');
    out.push('');
  }

  /* ── 断口与合法理由：只做注释 ── */

  if (d.defeat && d.defeat.kind !== 'none') {
    cmt(`接不上：${safe(d.defeat.cuts)}`);
    if (d.defeat.explanation) cmt(`依据：${safe(d.defeat.explanation)}`);
    out.push('');
  }
  d.legitimateMoves.forEach((m, i) => {
    cmt(`L${i + 1} 合法：${safe(m.why)}`);
  });
  if (d.legitimateMoves.length) out.push('');

  out.push('// 由论证镜生成。完整报告（含每一条依据、程序裁定、模型原文）在本机存档里。');

  return out.join('\n');
}

/** 建议文件名。带透镜与时间，理由与 Markdown 导出一致：同一天几份报告很容易混。 */
export function argdownFileName(d: Diagnosis): string {
  const t = THEORY_BY_ID[d.theory];
  const s = new Date(d.createdAt)
    .toLocaleString('zh-CN', { hour12: false })
    .replace(/[/:\s]/g, '-')
    .replace(/-+/g, '-');
  return `论证镜-${t.short ?? t.name}-${s}.ad`;
}
