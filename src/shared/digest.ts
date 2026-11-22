import type { Claim, Diagnosis } from './types';
import { MODE_META } from './types';
import { LEVEL_LABEL, THEORY_BY_ID } from './theories';
import { GRADE_LABEL } from './grading';
import { DIALOGUE_TYPE_LABEL } from './context-use';
import { pivotOf } from './pivot';
import { pinOf } from './verdict-trail';
import { ANSWER_LABEL } from './labels';

/**
 * 全文总结与论证逻辑链。
 *
 * 这一层回答的是读者打开报告后的第一个问题：**这段话到底在说什么、它是怎么推的**。
 * 此前首屏直接给「为什么这个论证有问题」（spine 的五环），跳过了「它是什么」。
 * 对第一次读原文的人来说，先判后述等于让人在不知道对方说了什么的情况下接受判决。
 *
 * 所以这里按「内容 → 结构 → 评价」的顺序取四组事实：
 *
 *   1. 说的什么：争议之点、说话者立场、结论；
 *   2. 怎么推的：前提、中间结论、supports 连出来的层级；
 *   3. 推得怎么样：档位、断点、承重那一句；
 *   4. 读的时候能信到哪：只压缩报告已落盘的字段，不新增判断。
 *
 * 逻辑链的层级不是按「重要程度」排的，是按 supports 的真实方向排的：
 * 结论在最上，直接支撑它的理由在第二层，再往下的支撑在第三层。
 * 一条理由若同时支撑多处，树里只挂在第一处（完整连线在「关系图」里），
 * 并在节点上标「另支撑 N 处」——不让读者以为它只支撑这一处。
 *
 * 三条硬边界：
 *
 * 1. **不新增判断。** 所有文字都来自 `conclusion` / `premises` / `intermediate` /
 *    `context` / `verdict` / `checks` / `pivot`，这里只做压缩与排序。
 * 2. **接不回结论的，不藏。** supports 指向不存在的主张、或成环走不到结论的，
 *    单独列成「接不回结论」，并计数。藏起来会让结构图看起来比实际完整。
 * 3. **不把摘要写成第二份判定。** 档位与断点原样引用报告字段；没有档位的模式
 *    就说「不判档位」，不适用就说「不适用」，不拿一句「整体不错」糊过去。
 */

export interface DigestNode {
  id: string;
  role: Claim['role'];
  roleLabel: string;
  text: string;
  quote: string | null;
  implicit: boolean;
  /** 离结论几步。结论为 0。 */
  depth: number;
  parentId: string | null;
  children: DigestNode[];
  /**
   * 节点旁的短标记：承重 / 隐含 / 被反驳 / 不可接受 / 可疑 / 另支撑 2 处。
   *
   * 「断点」不在这里——它曾经挂在结论上，界面于是写着「结论 C［未答］」，
   * 读起来像「结论没人答」。断点是一条**推理边上**的事实（某一关没答、
   * 某一步断了），不属于任何一条主张，所以单独一行，见 `breakLine`。
   */
  marks: string[];
  tone: 'ok' | 'warn' | 'bad' | 'none';
}

export interface DigestGist {
  /** 左侧那两个字：说的什么 / 要你信什么 / 怎么推的 / 推到哪。 */
  key: string;
  text: string;
}

export interface DigestView {
  thesis: string;
  issue: string;
  stance: string;
  gist: DigestGist[];
  conclusion: DigestNode;
  /** 接不回结论的主张。它们不进树，但不能消失。 */
  orphans: DigestNode[];
  counts: {
    premises: number;
    intermediate: number;
    direct: number;
    total: number;
    orphan: number;
    failed: number;
    unanswered: number;
  };
  /**
   * 能真的改变画面的颗粒度档位。界面按这个渲染按钮，不在组件里另写一套。
   *
   * 只有一层链时这里是**空的**，不是三个按钮——六份基准全是「结论 + 三条直接理由」，
   * 三档点哪个都一样，摆在那儿就是三个点了没反应的按钮。空数组让界面去说那句话。
   */
  levels: { n: number; label: string; hint: string }[];
  /** 链的最大层数（结论算第 0 层）。界面用它选默认档，测试用它断档位是不是按数据给的。 */
  maxDepth: number;
  /** 没有可切换的档位时，界面显示这一句；有档位时为空串。 */
  levelNote: string;
  /**
   * 推理断在哪一步。没有明确断点时为 null（不是「没有断点」，是报告没说）。
   *
   * 分成两格而不是一整句：界面要把「切断了哪一步」加重、把「哪一关」放在括号里，
   * 测试也要能分别断言这两格，而不必去比对一句拼好的中文。
   */
  breakLine: { cuts: string; check: string } | null;
  boundary: string;
}

const ROLE_LABEL: Record<Claim['role'], string> = {
  premise: '前提',
  intermediate: '中间结论',
  conclusion: '结论',
};

/** 已经套在一层「」里的文字，把内部引号降一级；否则会出现「…「…」…」。 */
function inner(s: string) {
  return s.replace(/「/g, '“').replace(/」/g, '”');
}

/** 比一句话是否同一句时用：空白差异不算不同。 */
function norm(s: string) {
  return s.replace(/\s+/g, ' ').trim();
}

function clip(s: string | null | undefined, n: number) {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/**
 * 放进「」里的一段：内部引号降一级，截断切掉的右引号补回来。
 *
 * `inner` 解决「引文套引文」，但一截断就可能把成对的引号切成一个：
 * 真实报告里有一句写着「…也未辩护“制度偏向以男性为标准”」，截到 80 字时
 * 正好停在引号里面，屏幕上于是出现一个没有收口的 “。补一个右引号，
 * 读者至少看得出这句话是被截断的，而不是标点坏了。
 */
function quoted(s: string | null | undefined, n: number) {
  const t = inner(clip(s, n));
  const open = (t.match(/“/g) ?? []).length;
  const close = (t.match(/”/g) ?? []).length;
  return close < open ? `${t}”` : t;
}

/** 引来的句子自带句末标点就不再补一个，免得出现「…。 。」或与下一句粘住。 */
function endSentence(s: string) {
  return /[。！？；…]$/.test(s) ? s : `${s}。`;
}

export function digestOf(d: Diagnosis): DigestView {
  const premise = d.premises ?? [];
  const mid = d.intermediate ?? [];
  const all = [...premise, ...mid];
  const byId = new Map(all.map((c) => [c.id, c]));
  const pivot = pivotOf(d);
  const pin = pinOf(d);
  const refuted = new Set((d.refutations ?? []).map((r) => r.targetId));

  /** 一条主张的父节点：supports 里能落到本文本内的 id；supports 为空按最朴素重构处理。 */
  function parentsOf(c: Claim): string[] {
    const ps = (c.supports ?? []).filter((s) => s === d.conclusion.id || byId.has(s));
    return ps.length ? ps : [d.conclusion.id];
  }

  const nodes = new Map<string, DigestNode>();
  const make = (c: Claim, depth: number, parentId: string | null): DigestNode => {
    const marks: string[] = [];
    let tone: DigestNode['tone'] = 'none';
    if (pivot.top?.id === c.id) {
      marks.push('承重');
      tone = 'warn';
    }
    if (c.implicit) {
      marks.push('隐含');
      if (tone === 'none') tone = 'warn';
    }
    if (refuted.has(c.id)) {
      marks.push('被反驳');
      tone = 'bad';
    }
    if (c.acceptability?.status === 'unacceptable') {
      marks.push('不可接受');
      tone = 'bad';
    } else if (c.acceptability?.status === 'questionable' && tone === 'none') {
      marks.push('可疑');
      tone = 'warn';
    }
    const ps = parentsOf(c);
    if (ps.length > 1) marks.push(`另支撑 ${ps.length - 1} 处`);
    return {
      id: c.id,
      role: c.role,
      roleLabel: ROLE_LABEL[c.role],
      text: c.text,
      /*
       * 引文只在「与主张文字不同」时保留。
       *
       * 很多报告的 quote 就是 text 本身（样本工厂造出来的一律如此）。照抄到「取证」
       * 那一档，就是同一句话在上面一遍、下面引号里又一遍，读者会以为漏了什么。
       * 这一档要给人看的是**原文怎么说的**，与概括一致时它没有新信息。
       */
      quote:
        c.quote && norm(c.quote) !== norm(c.text) ? c.quote : null,
      implicit: c.implicit,
      depth,
      parentId,
      children: [],
      marks,
      tone,
    };
  };

  const root = make(d.conclusion, 0, null);
  nodes.set(root.id, root);
  const depthOf = new Map<string, number>([[root.id, 0]]);
  const parentOf = new Map<string, string>();

  /* 先按父节点分组。多父只取第一个，另在节点上标「另支撑 N 处」。 */
  const kids = new Map<string, Claim[]>();
  for (const c of all) {
    const p = parentsOf(c)[0];
    const list = kids.get(p) ?? [];
    list.push(c);
    kids.set(p, list);
    parentOf.set(c.id, p);
  }

  /* BFS 从结论往下建树。走不到的（环、指向不存在 id）进 orphan。 */
  const queue: DigestNode[] = [root];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const c of kids.get(cur.id) ?? []) {
      if (depthOf.has(c.id)) continue;
      const depth = (depthOf.get(cur.id) ?? 0) + 1;
      if (depth > 6) continue;
      const n = make(c, depth, cur.id);
      cur.children.push(n);
      nodes.set(n.id, n);
      depthOf.set(n.id, depth);
      queue.push(n);
    }
  }

  const orphans: DigestNode[] = all
    .filter((c) => !depthOf.has(c.id))
    .map((c) => make(c, 1, null))
    .map((n) => ({ ...n, marks: [...n.marks, '接不回结论'] }));

  const direct = (kids.get(root.id) ?? []).filter((c) => depthOf.has(c.id)).length;
  const failed = (d.checks ?? []).filter((c) => c.answer === 'violated').length;
  const unanswered = (d.checks ?? []).filter((c) => c.answer === 'unanswered').length;

  const theory = THEORY_BY_ID[d.theory]?.name ?? d.theory;
  const level = LEVEL_LABEL[d.verdict.level] ?? d.verdict.level;
  const grade = d.verdict.grade;
  const gives = MODE_META[d.mode]?.givesVerdict !== false;

  const maxDepth = [...nodes.values()].reduce((m, n) => Math.max(m, n.depth), 0);
  const implicitCount = all.filter((c) => c.implicit).length;

  /*
   * 断点单独一行，不挂在任何节点上。
   *
   * 原来它挂在结论上（`d.conclusion.id === c.id` 时打「断点」或「未答」），
   * 界面于是显示「结论 C［未答］」——读者读成「结论没人答」，
   * 而实际意思是「某一关没答，P1 → C 那一步没有支撑」。报告自己把这件事
   * 说得很清楚（`defeat.cuts`：切断的是哪一步），这里照抄它。
   */
  const cuts = (d.defeat?.cuts ?? '').trim();
  const breakLine =
    d.defeat && d.defeat.kind !== 'none' && cuts
      ? {
          /*
           * 报告里这一句常写成「切断了 P1 与 C 之间的因果联结」，而界面这儿已经写着
           * 「推理断在这一步：」——照抄就连读成「断在……切断……」。
           * 只摘掉句首那个动词，不动后面的内容。
           */
          cuts: (cuts.replace(/[。；]+$/, '').replace(/^切(断|掉)了?/, '').trim() || cuts),
          check: pin ? `${pin.id} ${ANSWER_LABEL[pin.answer] ?? pin.answer}` : '',
        }
      : null;

  /*
   * 档位是按「点了会不会变」给的，不是按名义上的三档给的。
   *
   * 骨架只有在有第二层时才与展开不同；取证只有在「还有更深的层」或「有原文引用可看」
   * 时才与展开不同。否则那两个按钮就是装饰——点了没反应，读者会以为软件坏了，
   * 或者以为自己点错了。宁少一个按钮，不多一个假动作。
   */
  const anyQuote = [...nodes.values()].some((n) => !!n.quote);
  const levels =
    maxDepth >= 2
      ? [
          { n: 1, label: '骨架', hint: '只看结论和直接理由' },
          { n: 2, label: '展开', hint: '加上中间结论' },
          ...(maxDepth >= 3 || anyQuote
            ? [{ n: 3, label: '取证', hint: '连原文引用一起看' }]
            : []),
        ]
      : [];
  const levelNote = levels.length
    ? ''
    : all.length
      ? '只有一层，没有可展开的中间结论。'
      : '报告没拆出依据，这条链只有结论本身。';

  const gist: DigestGist[] = [
    {
      key: '说的什么',
      text: `这段话在争「${quoted(d.context.issue, 60) || '报告没写争议之点'}」；说话者站在「${
        quoted(d.context.speakerPosition, 40) || '报告没写立场'
      }」。${
        d.context.dialogueType
          ? `对话类型是「${DIALOGUE_TYPE_LABEL[d.context.dialogueType] ?? d.context.dialogueType}」${
              /*
               * 受众这一格常常比 24 字长，截断之后原先直接写「说给……听」，
               * 省略号落在句子中间，读成「说给一些可能持不同看法的…听」——
               * 像是话说了一半。给它加一层「」，省略号就明显是「引文被截断」，
               * 而不是这个句子没写完。
               */
              d.context.audience ? `，说给「${quoted(d.context.audience, 24)}」听` : ''
            }。`
          : ''
      }`,
    },
    {
      key: '要你信什么',
      text: `结论是「${quoted(d.conclusion.text, 90)}」。${
        all.length
          ? `为了让你信它，他给了 ${premise.length} 条依据${mid.length ? `、${mid.length} 条中间结论` : ''}。`
          : '报告没从这段话里拆出依据——结论是直接摆出来的。'
      }`,
    },
    {
      /*
       * 这一行说的是**推法的形状**，不是「报告拆出几个节点」。
       * 上一版写「报告按 supports 拆出 3 个节点」——那是数据结构，
       * 读者要知道的是：全靠直接理由，还是中间转了几道；有没有隐含前提；
       * 有没有哪条根本接不回去。
       */
      key: '怎么推的',
      text: all.length
        ? `这 ${all.length} 条${implicitCount ? `（其中 ${implicitCount} 条是隐含的，原文没有明说）` : ''}${
            maxDepth <= 1
              ? '都直接接到结论，中间没有中转'
              : `分 ${maxDepth} 层接到结论${mid.length ? '，中间过了中间结论' : ''}`
          }${orphans.length ? `；另有 ${orphans.length} 条接不回结论，在下面单列` : ''}。`
        : '报告没拆出前提或中间结论，这一步的推法无从展开。',
    },
    {
      key: '推到哪',
      text: !d.scope.applicable
        ? `这副透镜判了不适用：${endSentence(clip(d.scope.reason, 80))}所以不判档位。`
        : !gives
          ? `本次用「${theory}」量；这个模式不给档位，只给检查与问题。`
          : `本次用「${theory}」量，判到「${level}」${
              grade ? `（${grade.level} ${GRADE_LABEL[grade.level]}）` : ''
            }：${endSentence(clip(d.verdict.statement, 90))}`,
    },
    {
      key: '最要紧的一处',
      text: `${pivot.top ? `整段压在「${quoted(pivot.top.text, 46)}」上` : '报告没有指出唯一的承重句'}${
        pin
          ? `；断在「${quoted(pin.label, 28)}」：${quoted(pin.basis, 80) || '报告没写依据'}`
          : '；没有找到明显断点'
      }。`,
    },
  ];

  return {
    thesis: d.conclusion.text,
    issue: d.context.issue,
    stance: d.context.speakerPosition,
    gist,
    conclusion: root,
    orphans,
    counts: { premises: premise.length, intermediate: mid.length, direct, total: all.length, orphan: orphans.length, failed, unanswered },
    levels,
    maxDepth,
    levelNote,
    breakLine,
    boundary:
      '总结只压缩报告已经落盘的结论、前提、语境与判定，不新增一句评价；每条都能在下面的逻辑链或正文里找到出处。一条理由同时支撑多处时，树里只挂在第一处，完整连线见「关系图」。',
  };
}
