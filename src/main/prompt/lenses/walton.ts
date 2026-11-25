import { SCHEMES } from '../../kb/schemes';
import type { LensFragment } from '../fragments';

/**
 * 透镜一：论证型式与批判性问题（Walton）。
 *
 * 理论主张：论证出错不是因为「逻辑无效」，而是套用了惯用型式的骨架，
 * 却没有回答这个型式自带的批判性问题。型式本身无对错，误用才成谬误。
 *
 * 出处：Walton, Reed & Macagno, Argumentation Schemes (2008)；
 *       武宏志《非形式逻辑导论》附录A（四族型式 + CQ + 使用纪律）
 */

const SCHEME_INDEX = `## 型式索引（${SCHEMES.length} 个，索引之外的型式一律不许用）

${SCHEMES.map(
  (s) =>
    `### ${s.id}｜${s.name}（${s.family}）\n骨架：${s.skeleton}\nCQ：${s.criticalQuestions
      .map((c) => `${c.id}${c.meta ? '（元）' : ''} ${c.question}（守：${c.guards}）`)
      .join('；')}`
).join('\n\n')}

型式认不出就写 schemeId="none"。给错名字比不给名字坏得多。

索引里每条 CQ 后面那个「守：」，说明的是它守这一环。每一问都对应这条推理的担保所依赖的一个必要条件——所以它是「合法攻击点」，不是「可以顺便问一句」。回答时请据此写 basis：答 passed 要指出文中哪句话满足了这一环；答 violated 要指出缺的是哪一环；答 unanswered 说明文中确实没有交代过这一环。`;

export const waltonLens: LensFragment = {
  deep: `优先找：族或型式认错；CQ 只答一半、或元问题没先判；担保缺失被写成「前提不足」。
可用 theoryRef：T3-02（CQ 是默认条件）/ T3-06（元问题优先）/ T3-08（排除替代解释）/ T3-12（关键术语换义）。`,
  worldview: `这套透镜认为：论证出错，是它套用了一个惯用型式的骨架，却没有通过这个型式自带的批判性问题。

关键推论有三条：
- **型式本身不是谬误**。诉诸专家意见、类比、滑坡，全都是有正当用法的型式。它们变坏，是因为某条 CQ 未获回答，或适用条件不满足。
- **族要先认对**。前提走到结论靠的是哪一种担保（实效／因果／信息源／比较），决定了该问哪一组 CQ。族认错，后面问什么都失焦——这是日常批评里最常见的失误。
- **CQ 未答通常只切断联结**。它不否证结论。所以多数情况下 kind=undermining，whatIsRefuted=argument-only。

这套做法的道理在于：日常论证几乎都是**可废止的**。它不靠形式有效成立，靠的是一组默认条件（担保成立、无干扰因素、来源可靠）。CQ 就是把这组默认条件逐条摆到台面上——所以问 CQ 等于问「你默认的那些，成立吗」。这也是为什么型式法能替代「找谬误」：前者问条件，后者给名字，而名字随学派变，条件不变。`,

  procedure: [
    '辨对话类型与阶段。同一句威胁在谈判里合法，在说服里是谬误。类型不明写 unknown，不要猜。',
    '认族：从前提走到结论，靠的是「达到目的的手段」还是「因果」还是「信息来源」还是「相似性比较」？',
    '认型式：落到具体 id，写出本论证实际套用的骨架。认不出就 none。',
    '逐条问 CQ：先问元问题（meta=true）。元问题答否，后续全部免除。',
    '仍有疑时用反例法：能不能构造一个「前提都真、结论假」的情形？反例落回哪条 CQ，就记在那条上。',
    '判击败类型：切断联结 → undermining；直接给出结论为假的理由 → rebutting。',
  ],

  rules: [
    '型式无好坏，误用才成谬误。任何「这是 X 谬误」的句子都必须能改写成「CQn 未获回答，因为……」。',
    '族必须先给，且必须说明判据（靠哪一种担保）。族若可能错，在 alternativeFamily 里写出更可能的那个，并说明分歧点。',
    '元问题优先。元问题指的是「此语境用这个型式恰当吗」——它答否时，不要继续逐条评 CQ，那会产生一堆假问题。',
    '只评本型式列出的 CQ。不要自己发明 CQ，也不要漏掉 meta 项。',
    '一个论证可能混用几个型式。挑承担主要推理的那一个给 id，其余在 repair.alternativeReading 或 legitimateMoves 里说明。',
    'CQ 的回答必须落到原文。答 unanswered 是完全正当的答案——它表示「文中无从判断」，比硬答 yes/no 好得多。',
  ],

  scopeGuard: [
    `型式索引里的 ${SCHEMES.length} 个都认不出，且文本确实在做推理（开放论证、多步政策辩论）。此时 applicable=false，并建议改用 ARS 三标准透镜。`,
    '文本里混了三个以上型式，无法分离主次。此时 applicable=false，理由写「结构未定，无法归型」。',
    '对话类型为 eristic（以取胜为目标），或文本根本不是论证。',
    '争议实际在前提是否为真，而不在推理这一步。型式法对此无话可说——它只能告诉你「若接受这些前提，结论是否得到担保」。',
    /*
     * 这一条是评测加的（2026-11）。数学证明样本上，同一段文本两次跑出了
     * 两个相反的范围门判断：一次「适用，全部 CQ 通过，withstands」，
     * 一次「不适用，演绎封闭无不问可问」。两种说法各自都讲得通，
     * 而用户看到的是「同一段证明，同一副透镜，今天判合格，明天说没法判」。
     * 提示词没写清，模型就按自己的理解各走一边——这不是模型不稳，是规格没定。
     */
    '形式化的演绎证明（数学定理证明、纯逻辑推演）：applicable=false。本透镜的每个型式都带一条可废止的担保，' +
      '而演绎证明的每一步由推理规则封闭保证，没有 CQ 可问。outOfScopeAt 写「整段」，' +
      'alternativeReading 必须指向 ARS 三标准——它能评前提可接受性与推理有效性，那才是这类文本该用的尺子。',
  ],

  checksSpec: `checks 由所选型式的 CQ 逐条生成，一条 CQ 一个检查项：

- id：照用型式表里的 CQ 编号（如 "CQ2"）。元问题的编号也要保留。
- system："walton-cq"
- label：如 "CQ2 领域相关性"（编号 + 该 CQ 守的那一处）
- question：照录型式表里的问法，不要改写
- guards：照录
- meta：照录
- answer：文中已给出依据 → passed；依据表明不成立 → violated；文中无从判断 → unanswered；元问题答否导致免除 → not-applicable
- landsOn：若该 CQ 未过会落到名录的哪一条；不该命名的写 null

只列本型式实际有的 CQ。若 schemeId="none"，checks 为空数组。`,

  lensShape: `"lens": {
  "kind": "walton",
  "family": "pragmatic|causal|source|comparison|mixed|none",
  "familyBasis": "族判据：从前提走到结论靠的是哪一种担保",
  "schemeId": "见型式索引；认不出写 none",
  "schemeName": "该型式名",
  "skeleton": "本论证实际套用的骨架，写成 P1 / P2 / ∴C 的形式",
  "alternativeFamily": "族若认错，更可能是哪个；否则 null",
  "alternativeNote": "为什么可能认错，分歧点在哪"
}`,

  index: SCHEME_INDEX,
};
