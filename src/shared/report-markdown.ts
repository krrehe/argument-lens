/**
 * 报告 → Markdown。
 *
 * 为什么要有这个：报告原先只能在本机窗口里看。而写作者真正动手改稿的地方是
 * Word、LaTeX、笔记软件——他需要的不是「切回应用看一眼」，是一份能放在旁边
 * 逐条对照的清单。带不走的东西，用得再顺手也进不了工作流。
 *
 * 三条自我约束，写在这里免得后来被当成可以通融的风格问题：
 *
 *   1. **不替报告加自信。** 档位照原始枚举译，限定词一个不删。
 *      导出件常常被转发、被贴进别的文档——离开界面之后，它比界面上更容易被当成结论。
 *      所以抬头第一句就是「这不是判决书」，而不是藏在末尾。
 *   2. **不留空壳。** 没有内容的段整段不出现，而不是印一个标题配一行「无」。
 *      空格子会被读成「没问题」，这跟界面上那条 G7 的教训是同一件事。
 *   3. **不重算任何判定。** 这里只做排版。金额、处方、边界一律调用原有模块，
 *      导出件与界面显示不同的判断，比不导出更糟。
 */
import { ACCEPT_LABEL, ANSWER_LABEL, BURDEN_LABEL, CONF_LABEL, STRATEGY_LABEL, WHAT_REFUTED_LABEL } from './labels';
import { limitsOf } from './limits';
import { prescriptionsOf } from './prescriptions';
import { LEVEL_LABEL, THEORY_BY_ID } from './theories';
import { MODE_META, type Claim, type Diagnosis } from './types';

/** 表格与列表里的单行化：换行会把一行撑成一堆，竖线会把表格撑坏。 */
function oneLine(s: string): string {
  return s.replace(/\r?\n+/g, ' ').trim();
}

/** 引用块。多行引文保留分段，但每一行都要带 >，否则后半段会掉出引用。 */
function blockquote(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => `> ${l.trim()}`)
    .join('\n');
}

function claimLine(c: Claim): string {
  const bits: string[] = [];
  if (c.burden) bits.push(`证明责任${BURDEN_LABEL[c.burden] ?? c.burden}`);
  if (c.acceptability?.status) bits.push(ACCEPT_LABEL[c.acceptability.status] ?? c.acceptability.status);
  if (c.implicit) bits.push('隐含前提');
  return `- **${c.id}**　${oneLine(c.text)}${bits.length ? `　（${bits.join('，')}）` : ''}`;
}

export function reportToMarkdown(d: Diagnosis): string {
  const t = THEORY_BY_ID[d.theory];
  const mode = MODE_META[d.mode];
  const out: string[] = [];

  /* ── 抬头 ── */
  out.push(`# 论证分析 · ${t.name} · ${mode.label}`);
  out.push('');
  const head = [
    `> 由论证镜生成于 ${new Date(d.createdAt).toLocaleString('zh-CN')}。`,
    `> 提示词 ${d.prompt ? `v${d.prompt.version}（指纹 ${d.prompt.fingerprint}）` : '版本未记录'}`,
    '> ',
    `> **这不是判决书。** 一个「${LEVEL_LABEL[d.verdict.level]}」的意思是：`,
    `> 用「${t.name}」这副尺子量这段文字，量出来是这个结果。换一副尺子、换一段上下文，结果可能不同。`,
  ];
  /*
   * 查谬误模式要单独加一段，因为这份文件最容易被误读成「他说的是错的」。
   *
   * 界面里有横幅解释，导出件没有——而导出件恰恰是会被转发、贴进群聊的那一份。
   * 所以那句话必须在文件里也写一遍，而且写在抬头，不是藏在末尾的边界段。
   */
  if (d.mode === 'fallacy') {
    head.push(
      '> ',
      '> 这一份只做一件事：把可疑的位置对上教材里的名字。',
      '> **名字挂上了，不等于这段话的结论是错的。** 指出一处推理没撑住，说明的是这一步断了；',
      '> 要不要否定结论，是另一回事（削弱 ≠ 反驳）。'
    );
  }
  head.push('> 每一条判断都附了原文句子；对不上原文的地方，以原文为准，不以本文件为准。');
  out.push(head.join('\n'));
  out.push('');

  /* ── 范围：不适用就到此为止 ── */
  if (!d.scope.applicable) {
    out.push('## 这副透镜在本文本上不适用');
    out.push('');
    out.push(oneLine(d.scope.reason) || '（没有给出理由）');
    out.push('');
    if (d.scope.partialNote) {
      out.push(oneLine(d.scope.partialNote));
      out.push('');
    }
    out.push(
      '> 「不适用」不等于「这段文字没问题」。它只说这副透镜量不了它——' +
        '换一副透镜、或者换一个体裁再试，结论可能是另一回事。'
    );
    out.push('');
    out.push('---');
    out.push('');
    out.push(
      '完整报告（含模型原文与程序裁定）保存在本机，可在「历史」里重新打开。本文件只摘了改动时用得上的部分。'
    );
    return out.join('\n');
  }

  /* ── 判定 ── */
  out.push('## 判定');
  out.push('');
  out.push(`**${LEVEL_LABEL[d.verdict.level]}**　·　${WHAT_REFUTED_LABEL[d.verdict.whatIsRefuted] ?? d.verdict.whatIsRefuted}`);
  out.push('');
  if (d.verdict.scale) {
    out.push(`尺子：${oneLine(d.verdict.scale)}${d.verdict.scaleValue ? `　→　${oneLine(d.verdict.scaleValue)}` : ''}`);
    out.push('');
  }
  if (d.verdict.statement) {
    out.push(oneLine(d.verdict.statement));
    out.push('');
  }
  if (d.verdict.qualification) {
    out.push(`限定：${oneLine(d.verdict.qualification)}`);
    out.push('');
  }

  /* ── 争议之点与结论 ── */
  if (d.context.issue) {
    out.push(`**争议之点**　${oneLine(d.context.issue)}`);
    out.push('');
  }
  out.push('## 结论');
  out.push('');
  out.push(`**${d.conclusion.id}**　${oneLine(d.conclusion.text)}`);
  out.push('');
  if (d.conclusion.quote) {
    out.push(blockquote(d.conclusion.quote));
    out.push('');
    if (d.conclusion.span?.quality === 'failed') {
      out.push('> 注意：这句话在原文里没有定位到，可能被模型改写或拼接了。请自行回原文核对。');
      out.push('');
    }
  }

  /* ── 依据与中间结论 ── */
  const reasoning = [...d.premises, ...d.intermediate];
  if (reasoning.length) {
    out.push('## 依据');
    out.push('');
    for (const c of d.premises) out.push(claimLine(c));
    if (d.premises.length === 0) out.push('（本文没有抽出一条显式依据）');
    out.push('');
    if (d.intermediate.length) {
      out.push('**中间结论**');
      out.push('');
      for (const c of d.intermediate) out.push(claimLine(c));
      out.push('');
    }
  }

  /* ── 检查项 ── */
  if (d.checks.length) {
    out.push('## 检查项');
    out.push('');
    out.push(
      `共 ${d.checks.length} 条：通过 ${d.checks.filter((c) => c.answer === 'passed').length}，` +
        `未答 ${d.checks.filter((c) => c.answer === 'unanswered').length}，` +
        `未过 ${d.checks.filter((c) => c.answer === 'violated').length}。`
    );
    out.push('');
    for (const c of d.checks) {
      /*
       * label 本身常常已经带编号（「CQ1 相关性事实」），再拼一次会变成
       * 「CQ1 CQ1 相关性事实」。截断的界线是「label 以 id 开头」，不是「包含 id」——
       * 包含的情况里有正常的（「第 2 条 CQ2」），那种不该被削掉。
       */
      const label = oneLine(c.label);
      const name = label.startsWith(c.id) ? label : `${c.id} ${label}`;
      out.push(`- **${ANSWER_LABEL[c.answer]}** · ${name}${c.meta ? '（元问题）' : ''}`);
      if (c.guards) out.push(`  - 守着：${oneLine(c.guards)}`);
      if (c.basis) out.push(`  - 依据：${oneLine(c.basis)}`);
      if (c.landsOn) out.push(`  - 名称：${oneLine(c.landsOn)}`);
    }
    out.push('');
  }

  /* ── 倒在哪一关 ── */
  if (d.defeat.kind !== 'none') {
    out.push('## 倒在哪一关');
    out.push('');
    out.push(`类型：${d.defeat.kind}${d.defeat.checkId ? `　（${d.defeat.checkId}）` : ''}`);
    out.push('');
    if (d.defeat.cuts) {
      out.push(`切断处：${oneLine(d.defeat.cuts)}`);
      out.push('');
    }
    if (d.defeat.explanation) {
      out.push(oneLine(d.defeat.explanation));
      out.push('');
    }
  }

  /* ── 下一步：这份文件的主要用途 ── */
  const rx = prescriptionsOf(d);
  out.push('## 下一步');
  out.push('');
  if (rx.missingPremise) {
    out.push(`### 先补这一句`);
    out.push('');
    out.push(`> ${oneLine(rx.missingPremise.text)}`);
    out.push('');
    out.push(`- 验收：${oneLine(rx.missingPremise.accept)}`);
    out.push(`- 不改：${oneLine(rx.missingPremise.cost)}`);
    out.push('');
  }
  if (rx.groups.length) {
    out.push('下面每一条都对应报告里的一条检查项。补完之后重跑一次，「对照」会自动核对它有没有变成「通过」——没变，说明补的不是这一环要的东西。');
    out.push('');
    for (const g of rx.groups) {
      out.push(`### ${g.title}`);
      out.push('');
      if (g.gist) {
        out.push(`${oneLine(g.gist)}`);
        out.push('');
      }
      for (const it of g.items) {
        out.push(`- [ ] **${it.checkLabel}**（${it.state === 'violated' ? '明确没过' : '文中未交代'}）`);
        if (it.ring) out.push(`  - 缺的是：${oneLine(it.ring)}`);
        out.push(`  - 要填什么：${oneLine(it.need)}`);
        out.push(`  - 验收：${oneLine(it.accept)}`);
        out.push(`  - 不改：${oneLine(it.cost)}`);
      }
      out.push('');
    }
  } else if (rx.emptyReason) {
    out.push(oneLine(rx.emptyReason));
    out.push('');
  }

  /* ── 反驳 ── */
  if (d.refutations.length) {
    out.push('## 对方会怎么打');
    out.push('');
    for (const r of d.refutations) {
      out.push(`### ${r.id}${r.targetId ? ` → ${r.targetId}` : ''}　${STRATEGY_LABEL[r.strategy] ?? r.strategy}`);
      out.push('');
      if (r.claim) {
        out.push(oneLine(r.claim));
        out.push('');
      }
      if (r.steelman) {
        /*
         * steelman 常常自带「对方可能答：」这样的引导语。我再加一层标签，
         * 就会变成「对方最可能的反击：对方可能答：……」——两个主语在打架。
         * 自带引导语时就用它自己的，标签让位。
         */
        const s = oneLine(r.steelman);
        out.push(/^对方/.test(s) ? `- ${s}` : `- 对方最可能的反击：${s}`);
      }
      if (r.reply) {
        out.push(`- 你可以这样答：${oneLine(r.reply)}`);
      }
      if (r.evidenceNeeded?.length) {
        out.push(`- 需要什么证据：${r.evidenceNeeded.map(oneLine).join('；')}`);
      }
      if (r.burdenAfter) {
        out.push(`- 打完之后的证明责任：${BURDEN_LABEL[r.burdenAfter] ?? r.burdenAfter}`);
      }
      if (r.confidence) {
        out.push(`- 这条判断的把握：${CONF_LABEL[r.confidence] ?? r.confidence}`);
      }
      out.push('');
    }
  }

  /* ── 命名与「此处合法」 ── */
  if (d.labels.length) {
    out.push(d.mode === 'fallacy' ? '## 对得上的名字' : '## 可以这样称呼它');
    out.push('');
    for (const l of d.labels) {
      out.push(`- **${l.name}**${l.landsOnCheck ? `（对应检查项 ${l.landsOnCheck}）` : ''}`);
      /*
       * 原文位置写在这条名字的第二行，而不是放到末尾。
       *
       * 导出件是拿去对质的：用户会指着这一条问对方，对方会回「我哪句这么说」。
       * 把引文放在最上面，他才答得出来；放在末尾，他得先翻到下面，
       * 而那几秒的停顿在对话里就等于输了。
       */
      if (l.quote) {
        out.push(`  - 原文：${oneLine(l.quote)}`);
        if (l.span?.quality === 'failed') {
          out.push('  - 注意：这句话在原文里没有定位到，可能被模型改写或拼接了。请回原文核对再引用。');
        }
      }
      if (l.condition) out.push(`  - 成立条件：${oneLine(l.condition)}`);
      if (l.whenLegitimate) out.push(`  - 什么时候它反而合法：${oneLine(l.whenLegitimate)}`);
      if (l.riskOfError) out.push(`  - 叫错的风险：${oneLine(l.riskOfError)}`);
    }
    out.push('');
  }
  if (d.legitimateMoves.length) {
    out.push('## 这里没毛病');
    out.push('');
    for (const m of d.legitimateMoves) {
      out.push(`- **${m.targetId}**　${oneLine(m.what)}${m.why ? `
  - 为什么这不构成问题：${oneLine(m.why)}` : ''}`);
    }
    out.push('');
  }

  /* ── 边界 ── */
  const lim = limitsOf(d);
  out.push('## 这份分析的边界');
  out.push('');
  for (const n of lim.thisRun) {
    out.push(`- ${oneLine(n.text)}`);
  }
  if (d.selfCheck?.withdrawIf?.length) {
    out.push('');
    out.push('**什么情况下应当撤回这份分析：**');
    out.push('');
    for (const w of d.selfCheck.withdrawIf) out.push(`- ${oneLine(w)}`);
  }
  out.push('');

  /* ── 程序裁定：只在真有问题时写 ── */
  const warns = d.diagnostics.filter((x) => x.level !== 'info');
  if (warns.length) {
    out.push('## 程序裁定');
    out.push('');
    out.push('下面这些是代码在生成报告时自己发现并修正的问题。它们仍然可读，但涉及这些地方的判读请自行核对原文。');
    out.push('');
    for (const w of warns) {
      out.push(`- ${oneLine(w.message)}`);
    }
    out.push('');
  }

  out.push('---');
  out.push('');
  out.push(
    '完整报告（含模型原文、每一条的判断依据、程序裁定）保存在本机，可在「历史」里重新打开。本文件只摘了改动时用得上的部分。'
  );

  return out.join('\n');
}

/** 建议的文件名。带上透镜与时间，因为同一天的几份报告很容易混。 */
export function markdownFileName(d: Diagnosis): string {
  const t = THEORY_BY_ID[d.theory];
  const stamp = new Date(d.createdAt)
    .toLocaleString('zh-CN', { hour12: false })
    .replace(/[/:\s]/g, '-')
    .replace(/-+/g, '-');
  return `论证镜-${t.short ?? t.name}-${stamp}.md`;
}
