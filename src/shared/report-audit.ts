/**
 * 报告自检：任何一份报告都该满足的东西，破了就是 bug，与文本内容无关。
 *
 * 为什么要把这段逻辑从评测脚本里搬出来：
 *
 * 这些不变量原本只活在 `scripts/eval/audit.ts`，只有跑完一次真模型评测
 * （约六分钟、十七万 token）才被执行一次。于是「报告结构对不对」这件事，
 * 平时没有任何东西在看——它每次都要等一次昂贵的、要花钱的、还得手动发起的
 * 动作才有答案。这是验证的层级错位：最便宜的检查被放在了最贵的位置。
 *
 * 搬出来之后有两处用它，而且是**同一份代码**，不是两处各写一遍：
 *
 *   生产：`analyze.ts` 生成报告后立刻自检，结果进 `Diagnosis.selfAudit`。
 *         破了说明模型给了次品，界面上要告诉用户「这份报告的结论请谨慎使用」，
 *         而不是安静地把它存档。
 *   评测：`audit.ts` 调同一个函数，再叠加我自己写样本时的期望值。
 *
 * 两处各写一遍的话，迟早会有一边改了另一边没改，而「哪边是对的」将无从判断——
 * 那正是这个项目最反对的那种静默不一致。
 *
 * 这里是纯函数：不读文件、不碰 electron、不调模型。所以它能被 check:report
 * 直接拿去跑，也能在任何环境里跑。
 */

import type { Diagnosis } from './types';
import { MODE_META, normalizeMode } from './types';

export interface ReportAudit {
  /**
   * 结构不自洽：指向不存在的东西、同一句话被算成两步、档位与范围门互相打架。
   * 破了就是 bug——用户照这份报告去改，会把力气花在一个不存在的问题上。
   */
  invariants: string[];
  /**
   * 该写没写。不是 bug，是缺口。
   *
   * 为什么必须和上一类分开：真实账上 86 份报告里有 79 份各有一条缺口，
   * 而结构矛盾只有 3 份各一条。混在一起报，79 条「这条反驳没写要什么证据」
   * 会把 3 条「正文引用了不存在的 P3」彻底淹掉——而那 3 条才会让人读错结构。
   * 严重性差一个量级的东西不能共用一个计数器，这是这个项目反复吃过的亏。
   */
  gaps: string[];
  /** 不构成错误、但值得知道的重复占位。 */
  notes: string[];
}

/** 占位结论的识别。判不适用的文本里，结论栏会填一句说明，那不是主张。 */
export const PLACEHOLDER_CONCLUSION = /^无结论|^（未能|^未提出|^文本未/;

/**
 * 全部主张，按「结论 → 前提 → 中间结论」排。
 * 顺序有意义：同一个位置上的两份主张，谁先出现决定了提示里先说谁。
 */
function claimsOf(d: Diagnosis) {
  return [d.conclusion as any, ...d.premises, ...d.intermediate];
}

export function auditReport(d: Diagnosis): ReportAudit {
  const inv: string[] = [];
  const gaps: string[] = [];
  const notes: string[] = [];
  const claims = claimsOf(d);
  const ids = new Set(claims.map((x) => x?.id).filter(Boolean));

  /* ── 一 · 结论 ── */
  if (!d.conclusion?.text?.trim()) inv.push('结论为空');

  /*
   * 引文回填失败：显式主张里的原文引文在 passage 里找不到。
   * 降级过的（diagnostics 里有 QUOTE_NOT_FOUND）不再重复报——那是已经留痕的已知损失。
   */
  const failed = claims.filter((x) => x?.span && x.span.quality === 'failed' && !x.implicit);
  const quoteDiag = d.diagnostics.filter((x) => x.code === 'QUOTE_NOT_FOUND').length;
  if (failed.length) {
    inv.push(`${failed.length} 条显式主张的引文在原文里找不到（另 ${quoteDiag} 条已降级留痕）`);
  }

  /* ── 二 · 同一句被两条主张占用 ── */
  /*
   * 分两种情形，混在一起报会制造假警报：
   *
   *   结论与依据共用一句：合法。权威型式的结论本来就是「那句话可被接受」，
   *   条件型的结论也常常就写在前提那一句里。这类只作提示。
   *   依据与依据（或依据与中间结论）共用一句：真问题——结构图上多出一级，
   *   读者会以为结论被两级撑住，实际只有一句原话。
   */
  {
    const seenSpan = new Map<number, { id: string; role: string; text: string }>();
    for (const c of claims) {
      const k = c?.span?.start;
      if (typeof k !== 'number' || k < 0 || c.span?.quality === 'failed') continue;
      const prev = seenSpan.get(k);
      if (!prev) {
        seenSpan.set(k, { id: c.id, role: c.role, text: c.text });
        continue;
      }
      const line = `${prev.id}（${prev.role}）与 ${c.id}（${c.role}）指向同一句：${String(prev.text).slice(0, 18)}`;
      if (prev.role === 'conclusion' || c.role === 'conclusion') notes.push(`提示｜${line}`);
      else inv.push(`重复占位｜${line}`);
    }
  }

  /*
   * 同一句既当依据又当中间结论，是结构图上的假步骤：
   * 图上多出一级，读者以为结论被两级支撑，实际只有一句原话。
   * 结论与依据同占一句不在此列——权威型式的结论本来就是「那句话可被接受」，
   * 它和「某人说了那句话」指向同一处是结构使然，不是错。
   */
  for (const p of d.premises) {
    for (const m of d.intermediate) {
      if (p.span?.start === m.span?.start && p.span?.quality !== 'failed') {
        inv.push(`「${p.text.slice(0, 18)}」既被当作依据 ${p.id}，又被当作中间结论 ${m.id}——同一句话被算成两步`);
      }
    }
  }

  /*
   * 只抓「占位结论还挂着原文引文」，不是所有不适用文本。
   * 判了不适用、但确实抽出了一条真结论（比如社论）是合法的：
   * 那说明这副透镜不适用，而文本本身有主张——两件事可以同时为真。
   * 要抓的是另一种：结论栏写着「无结论可规范化」，却仍指向原文某一联，
   * 界面上就会出现「结论：无结论…「没有人说话。」」这种自相矛盾的呈现。
   *
   * 不再要求 scope.applicable=false：占位文字不是主张，它不指向原文任何位置，
   * 挂着引文在任何情况下都是自相矛盾。analyze.ts 那边已按这个口径无条件清，
   * 这里留着就是为了验证它真的清了。
   */
  const placeholder = PLACEHOLDER_CONCLUSION.test(d.conclusion?.text ?? '');
  if (placeholder && d.conclusion?.quote && d.conclusion.span?.quality !== 'failed') {
    inv.push(
      `结论栏是占位文字（「${d.conclusion.text.slice(0, 14)}」），却仍挂着原文引文「${d.conclusion.quote.slice(0, 14)}」`
    );
  }

  /*
   * 适用却没有结论：G10 应该已经把档位打回未定。
   * 还能读到非「判不了」的档位，说明那一道没生效。
   */
  if (placeholder && d.scope.applicable && d.verdict.level !== 'undetermined') {
    inv.push(`透镜判为适用，结论栏却是占位文字，档位仍是「${d.verdict.level}」——G10 未生效`);
  }

  /* ── 三 · 检查表 ── */
  for (const k of d.checks) {
    if ((k.answer === 'passed' || k.answer === 'violated') && !k.basis.trim()) {
      inv.push(`检查项 ${k.id} 给了「${k.answer}」却没有依据`);
    }
  }
  if (new Set(d.checks.map((k) => k.id)).size < d.checks.length) inv.push('检查项 id 重复');

  /* ── 四 · 范围门与档位的一致性 ── */
  if (!d.scope.applicable) {
    if (d.checks.length) inv.push('判了不适用却仍有检查项');
    if (d.verdict.level !== 'undetermined') inv.push(`判了不适用却给了档位 ${d.verdict.level}`);
  }

  /*
   * 不给档位的模式（查谬误／重构／提问）不给档位。这里用 MODE_META 而不是写死模式名——
   * 写死的话，将来加一个新模式而忘了改这里，新模式就会静默逃过检查。
   * 那条硬编码的写法在评测脚本里待了很久，正是这个毛病。
   */
  const mode = normalizeMode(d.mode);
  if (!MODE_META[mode].givesVerdict && d.verdict.level !== 'undetermined') {
    inv.push(`${MODE_META[mode].label}模式给了档位 ${d.verdict.level}`);
  }
  /*
   * 命名门控与档位门控是两个开关，必须分开查。
   *
   * 查谬误模式给名字、不给档位。若这里仍用 givesVerdict 当命名门控，
   * 它自己就会把主输出判成矛盾——而那份报告其实是对的。
   * 反过来，重构模式带着一堆名字，说明 G8 那一路的清理没生效，
   * 用户看到的是一份伪装成结构图的判决书。
   */
  if (!MODE_META[mode].allowsLabels && d.labels.length) {
    inv.push(`${MODE_META[mode].label}模式给出了 ${d.labels.length} 条命名候选`);
  }
  /*
   * 查谬误模式下，命名必须有原文位置（G11 的验收）。
   *
   * 只查「有 quote」不够：引文可能压根不在原文里。所以看 span——
   * 那是定位器实际跑出来的结果，quality 为 failed 就是「说过，但指的是空气」。
   * 这一条写在自检里而不是只写在 analyze 里，是因为它要能在**旧报告**上跑：
   * 若哪天有人把 G11 删了，新生成的报告会被这里当场抓住。
   */
  if (MODE_META[mode].allowsLabels && mode === 'fallacy') {
    const noLoc = d.labels.filter((l) => !l.quote || !l.span || l.span.quality === 'failed');
    if (noLoc.length) {
      inv.push(`${noLoc.length} 条命名没有指到原文的哪一句（G11 未生效）`);
    }
  }
  /* 名录透镜只指出谬误名，不判整个论证的档位——名字是末端注释，不是判决。 */
  if (d.theory === 'copi' && d.verdict.level !== 'undetermined') {
    inv.push(`名录透镜给了档位 ${d.verdict.level}`);
  }

  /* ── 五 · 悬空引用 ── */
  /*
   * 正文里提到的 P3 / I1 之类，必须真有。
   * 这一栏曾经是评测里最常破的一条：模型喜欢在 cuts 里写「切断 P1 与 C 之间」，
   * 而它自己只抽了 P1、P2，没抽 C。读者照着去找 P3 会找不到。
   */
  const mentioned = new Set(
    (d.defeat.cuts + ' ' + d.repair.missingPremise + ' ' + d.verdict.statement).match(/\b[PIM]\d+\b/g) ?? []
  );
  const dangling = [...mentioned].filter((x) => !ids.has(x));
  if (dangling.length) inv.push(`正文引用了不存在的主张编号 ${dangling.join('、')}`);

  /* ── 六 · 反驳与命名 ── */
  /*
   * 这三条归 gaps 而不是 invariants，理由要说清：
   *
   * 「这条反驳没写要什么证据」不影响读者对已给出判断的理解——判断已经写了，
   * 只是缺了下一步。而「反驳指向不存在的 P4」会让人在结构图上找不到目标，
   * 那是读错结构。前者是没写完，后者是写错了。分开报，用户才知道先修哪个。
   */
  for (const r of d.refutations) {
    if (!r.steelman?.trim()) gaps.push(`反驳 ${r.id} 没有写对方最可能的反击`);
    /*
     * 这里原本还有一条「没写需要什么证据」的检查，已经删掉——它是错的。
     *
     * 真实账上 79 份报告都在这一条上报警，而逐条看下去，其中大多数是合法的：
     * 「家长支持率不是早读有效的证据」这条反驳指出的是一步推不出来，
     * 确立它不需要任何新材料。只有指向事实性前提的那种（「校长说早读能提高记忆效率」
     * 要问出处）才真的需要证据。代码没有立场替它判断是哪一种。
     *
     * 一条会把合法情况报成缺陷的断言，比没有断言更糟：它会训练人忽略报警。
     * 所以这一栏空着就空着，界面显示「未注明」，不解释、不算缺口。
     */
    if (r.targetId && !ids.has(r.targetId)) inv.push(`反驳 ${r.id} 指向不存在的 ${r.targetId}`);
  }
  /*
   * 命名缺门槛字段：G4 本该拦掉这些条目不让显示，能走到这里说明 G4 漏了。
   * 归 gap 是因为界面反正不渲染它——脏数据在，但用户看不见，
   * 不会因此读错，只是这个工具自己的账本不干净。
   */
  for (const l of d.labels) {
    if (!l.condition?.trim() || !l.whenLegitimate?.trim() || !l.riskOfError?.trim()) {
      gaps.push(`命名「${l.name}」缺门槛字段（G4 本应拦掉它）`);
    }
  }
  for (const m of d.legitimateMoves) {
    if (m.targetId && !ids.has(m.targetId)) inv.push(`「此处合法」指向不存在的 ${m.targetId}`);
  }

  /* ── 七 · 语境 ── */
  if (!d.context.issue.trim() || d.context.issue.startsWith('（未能')) inv.push('争议之点没识别出来');
  if (d.scope.applicable && !d.context.dialogueTypeBasis.trim()) inv.push('对话类型没给依据');

  return { invariants: inv, gaps, notes };
}
