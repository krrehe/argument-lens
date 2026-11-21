import { LEVEL_LABEL } from './theories';
import { GRADE_LABEL } from './grading';
import { coverageOf } from './coverage';
import { pivotOf } from './pivot';
import { ANSWER_LABEL, WHAT_REFUTED_LABEL } from './labels';
import { MODE_META, type CheckItem, type Diagnosis } from './types';
import { pinOf } from './verdict-trail';

/**
 * 论证主线。
 *
 * 这一层要回答的不是「报告有哪几栏」，而是**为什么这个论证有问题**。
 * 一份报告有二十来栏，逐栏读下来，读者知道了很多局部事实，却常说不出一句
 * 「所以他到底哪儿错了」。缺的不是信息，是**把信息串起来的顺序**。
 *
 * 所以这里只做一件事：从报告已经写下的字段里，按一条因果链取五处——
 *
 *   他让你信什么 → 这一步靠哪一条 → 哪一处接不上 → 所以算到什么程度 → 要救得补什么
 *
 * 三条硬边界：
 *
 * 1. **不新增判断。** 每一环的字都来自报告字段或本地已落盘的结构事实
 *    （`verdict.statement`、`defeat.*`、`checks[].basis`、`repair.missingPremise`、
 *    以及 `pivot` 按 supports 走出来的承重关系）。这里不评价、不打分、不改档位。
 * 2. **断点不许乱指。** 模型点名的那一关优先，其次「没过」，再次「文中没交代」；
 *    三者都没有时，若承重那一句本身是争点，就说断在那儿，而不是随便找一关凑数。
 * 3. **空着就说空着。** 没有补法、没有承重路径、模式本来就不给档位——
 *    各有各的说法，不拿一句「未发现明显问题」把三种情况糊成一种。
 *
 * 一句话：这条主线是**读完报告的人会画的那条线**，不是第六副透镜。
 */

/** 主线的一环。 */
export interface SpineRing {
  key: 'claim' | 'ground' | 'break' | 'verdict' | 'repair';
  n: number;
  /** 环节名，四到六个字，读起来像一句话的半截。 */
  title: string;
  /** 这一环说了什么。人话，不带术语（术语留在详细栏）。 */
  text: string;
  /** 这是从哪儿读来的。让「软件在复述」与「软件在下判断」分得开。 */
  from: string;
  /** 右端一格：徽章或短标签。 */
  tag?: string;
  tone: 'ok' | 'warn' | 'bad' | 'none';
  /** 点这一环跳到哪一栏。id 必须真实存在，否则是死入口。 */
  to: string;
  toLabel: string;
  /**
   * 断点环挂着的那一关。
   *
   * 主线说「断在 CQ2」，点过去若只是滚到「逐关检查」的开头，读者还得在
   * 一整张表里自己找 CQ2——那一秒里「跳转」和「没跳对」长得一模一样。
   * 让接收方据此把那一行选中。
   */
  checkId?: string;
}

export interface SpineView {
  /** 顶部第一句：因果骨架，读到这一句就知道「哪儿断了、所以算到什么程度」。 */
  lead: string;
  /** 第二句：出路。与第一句分开，因为它答的是另一个问题。 */
  outlet: string;
  rings: SpineRing[];
  /** 这条主线自身的边界。 */
  note: string;
  /** 这一份有没有档位（查谬误／重构／提问没有）。 */
  givesVerdict: boolean;
}

function clip(s: string | null | undefined, n: number) {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** 检查项标签去掉开头的编号：「CQ2 领域相关性」→「领域相关性」。编号单独显示。 */
function bare(label: string) {
  return label.replace(/^[A-Za-z0-9-]+\s*/, '') || label;
}

/**
 * 断点落在哪一关。
 *
 * 与 `verdictTrail` 用同一个 `pinOf`，不另写一套顺序——两处顺序一旦不同，
 * 主线说「倒在 CQ3」而判读栏说「倒在 CQ5」，读者只会信更靠前的那句。
 */
function breakCheck(d: Diagnosis): CheckItem | null {
  return pinOf(d);
}

export function spineOf(d: Diagnosis): SpineView {
  const cov = coverageOf(d);
  const pv = pivotOf(d);
  const top = pv.top;
  const bad = breakCheck(d);
  const meta = MODE_META[d.mode];
  const givesVerdict = !!meta?.givesVerdict;
  const outOfScope = !d.scope.applicable;
  const level = d.verdict.level;
  const grade = d.verdict.grade;

  /* ── ① 他让你信什么 ───────────────────────────────── */
  const claim: SpineRing = {
    key: 'claim',
    n: 1,
    title: '他让你信的是',
    text: clip(d.conclusion.text, 160) || '报告没有拆出结论句。',
    from: d.premises.length
      ? `他摆了 ${d.premises.length} 条依据${d.intermediate.length ? `、${d.intermediate.length} 条中间结论` : ''}`
      : '报告里一条依据都没列出来',
    tone: 'none',
    to: 'sec-structure',
    toLabel: '看结构图',
  };

  /* ── ② 这一步靠哪一条 ─────────────────────────────── */
  let ground: SpineRing;
  if (top) {
    const paths =
      top.steps === 1 ? '直接支撑结论' : `到结论要经过 ${top.steps} 步`;
    const subs =
      top.substitutes === 0
        ? '，这一步没有别的支撑者'
        : top.substitutes != null
          ? `，这一步另有 ${top.substitutes} 条可以替代`
          : '';
    ground = {
      key: 'ground',
      n: 2,
      title: '这一步要靠',
      text: clip(top.text, 160),
      from: `按报告写下的支撑关系走：${paths}${subs}`,
      tag: top.badge,
      tone: top.kind === 'pivot' ? 'warn' : top.kind === 'sole' ? 'warn' : 'none',
      to: 'sec-pivot',
      toLabel: '看枢纽',
    };
  } else {
    ground = {
      key: 'ground',
      n: 2,
      title: '这一步要靠',
      text: '报告没有给出能追到结论的承重路径——图上的线接不上，或者这一份没有记支撑关系。',
      from: '本地只按 supports 走，不替你补线',
      tone: 'none',
      to: 'sec-structure',
      toLabel: '看结构图',
    };
  }

  /* ── ③ 哪一处接不上 ───────────────────────────────── */
  let brk: SpineRing;
  if (outOfScope) {
    /*
     * 不适用时不许再去找「最薄的一处」——尺子都不用了，报出来的断点是假刻度。
     * 这一环改成说清「为什么这副尺子量不了」，出路在报告顶部的换透镜提示里。
     */
    brk = {
      key: 'break',
      n: 3,
      title: '断在这儿',
      text: `这副尺子在这段话上不适用：${clip(d.scope.reason, 140) || '报告没写原因'}`,
      from: '范围门：判了不适用就不量，不拿刻度凑数',
      tone: 'none',
      to: 'sec-verdict',
      toLabel: '看范围',
    };
  } else if (bad) {
    const dead = bad.answer === 'violated';
    brk = {
      key: 'break',
      n: 3,
      title: '断在这儿',
      text: `这一关问「${bare(bad.label)}」——${clip(bad.basis, 150) || '报告没写依据'}`,
      from: `倒在 ${bad.id} · ${ANSWER_LABEL[bad.answer] ?? bad.answer}${
        d.defeat.kind === 'undermining'
          ? ' · 削弱：切断这一步，不否证结论'
          : d.defeat.kind === 'rebutting'
            ? ' · 反驳：直接给出结论为假的理由'
            : ''
      }`,
      tag: bad.answer === 'violated' ? '没过' : '没答',
      tone: dead ? 'bad' : 'warn',
      to: 'sec-checks',
      toLabel: '看这一关',
      checkId: bad.id,
    };
  } else if (d.defeat.kind !== 'none') {
    brk = {
      key: 'break',
      n: 3,
      title: '断在这儿',
      text: clip(d.defeat.explanation || d.defeat.cuts, 160) || '报告没有写清断在哪一步。',
      from: `击败类型：${d.defeat.kind === 'undermining' ? '削弱（不否证结论）' : '反驳（给出结论为假的理由）'}`,
      tone: 'bad',
      to: 'sec-defeat',
      toLabel: '看击败类型',
    };
  } else if (top && (top.kind === 'pivot' || top.kind === 'sole')) {
    /*
     * 没有一关钉住它，但承重那一句本身有人争。这时断点就在那一句上——
     * 硬去找一关「最像的」凑数，会把读者的注意力从真正的争点上引开。
     */
    brk = {
      key: 'break',
      n: 3,
      title: '断在这儿',
      text: `报告没有把断点归到某一关；断在承重那一句本身——「${clip(top.text, 80)}」。`,
      from: top.kind === 'sole' ? '它是必经的唯一一道门，而现在没有一条记录在质疑它' : '这一句被当成起点用了，而它本身是争点',
      tone: 'warn',
      to: 'sec-pivot',
      toLabel: '看这一条',
    };
  } else {
    brk = {
      key: 'break',
      n: 3,
      title: '断在这儿',
      text: '把每一关都问了一遍，没有找到明显的断裂处。这不等于论证正确，只等于这套问题它都答上了。',
      from: '报告逐关给了答案，本地没有另算一遍',
      tone: 'ok',
      to: 'sec-checks',
      toLabel: '看逐关',
    };
  }

  /* ── ④ 所以算到什么程度 ───────────────────────────── */
  const rangeBits: string[] = [];
  /*
   * 这一格是枚举（argument-only / conclusion / nothing），印原值等于让读者读 JSON。
   * 中文口径只从 labels 取一处——导出用的也是同一张表，界面与文件不许各说一套。
   */
  rangeBits.push(WHAT_REFUTED_LABEL[d.verdict.whatIsRefuted] ?? d.verdict.whatIsRefuted);
  if (cov.partial) rangeBits.push(`引文 ${cov.pinned}/${cov.sentences} 句`);

  const verdict: SpineRing = givesVerdict
    ? {
        key: 'verdict',
        n: 4,
        title: '所以只能算',
        text: clip(d.verdict.statement, 220) || '报告没有给出判读句。',
        from: rangeBits.join(' · '),
        tag: grade ? `${grade.level} ${GRADE_LABEL[grade.level]}` : LEVEL_LABEL[level],
        tone: level === 'withstands' ? 'ok' : level === 'fails' ? 'bad' : level === 'weakened' ? 'warn' : 'none',
        to: 'sec-verdict',
        toLabel: '看判读',
      }
    : {
        key: 'verdict',
        n: 4,
        title: '所以只能算',
        text: `这个模式不给档位：它只${
          meta?.allowsLabels ? '指出问题在哪一处' : '拆结构或提问'
        }，不判这段话成不成立。这是模式定义，不是没判出来。`,
        from: `${meta?.label ?? d.mode}模式`,
        tag: LEVEL_LABEL[level],
        tone: 'none',
        to: 'sec-verdict',
        toLabel: '看这一栏',
      };

  /* ── ⑤ 要救它得补什么 ─────────────────────────────── */
  const fix = d.repair.missingPremise || d.repair.repairedForm;
  const repair: SpineRing = {
    key: 'repair',
    n: 5,
    title: '要站住得先补',
    text: fix
      ? clip(fix, 200)
      : '报告没有给出补法——这本身是一种结论：可能补不上，也可能这不是一个能补的论证。',
    from: d.repair.missingPremise ? '来自「修补」栏写下的缺前提' : '来自「修补」栏',
    tone: fix ? 'ok' : 'none',
    to: 'sec-repair',
    toLabel: '看修补',
  };

  /* ── 一句主线 ───────────────────────────────────────
   * 只拼五种零件的名字与计数，不添评价词：
   * 主张、依据条数、承重那一句、断点那一关、档位、缺的前提。
   */
  const head: string[] = [`他拿 ${d.premises.length} 条依据推「${clip(d.conclusion.text, 32)}」`];
  if (top) head.push(`整段压在「${clip(top.text, 24)}」上`);
  if (outOfScope) head.push('这副尺子在这段话上不适用');
  else if (bad) head.push(`可「${bare(bad.label)}」这一关${bad.answer === 'violated' ? '没过' : '文中没交代'}`);
  else if (d.defeat.kind !== 'none') head.push(`可它${d.defeat.kind === 'undermining' ? '在中间被切断了' : '的结论被直接反驳了'}`);
  else head.push('逐关都答上了');
  if (outOfScope || !givesVerdict) head.push('所以不判档位');
  else head.push(`所以只判到「${LEVEL_LABEL[level]}」`);
  const outlet = d.repair.missingPremise
    ? `要站住，得先补「${clip(d.repair.missingPremise, 30)}」。`
    : d.repair.repairedForm
      ? `报告给出的修补形式是：${clip(d.repair.repairedForm, 60)}`
      : '报告没有给出补法——这可能意味着补不上，也可能这不是一个能补的论证。';

  return {
    lead: `${head.join('；')}。`,
    outlet,
    rings: [claim, ground, brk, verdict, repair],
    note: '这条线是把报告里已经写下的判断按「主张 → 承重 → 断点 → 档位 → 出路」串起来；不新增判断，每一环都写明从哪一栏读来。',
    givesVerdict,
  };
}
