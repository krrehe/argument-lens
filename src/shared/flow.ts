/**
 * 全流程账：把《论证分析全流程 v1.0》的十六步，在这份报告上逐条对一遍。
 *
 * 这一层要回答的不是「这段论证好不好」——那是报告本身的事——而是
 * **「这份报告是按流程走出来的，还是跳着走的」**。这是一个纯本地问题：
 * 每一步做没做，报告里都有痕迹（命题账有没有分栏、有没有标型式、有没有过 CQ、
 * 有没有可推翻条件……），数得出来，也不必问模型。
 *
 * 三条设计约束，都是为了让这一栏不至于变成又一块「到处都是红」的板子：
 *
 *   1. **先看证据，再看档位。** 一步做了就写「做了」，哪怕它不在当前档位的要求里；
 *      只有「没做」才去问档位要不要它。反过来写的话，一份 128 字的速判报告
 *      会被要求交出修辞审计与自审四问——那不是严格，是拿标准档的尺子量速判。
 *   2. **只数做没做，不判做得对不对。** 「型式标了」与「型式标对了」是两件事，
 *      后者本地算不出来。混在一起写，读者会把「走了 12 步」读成「这份报告对了 12 处」。
 *   3. **顺序是硬约束，单独说。** 文档 §1 写着「A 阶段任何一个环节没做完，不得进入 B」。
 *      一份没有立案记录却给了档位的报告，缺的不是一格，是前提——这句话必须自己一行。
 *
 * 它不改报告一个字，也不产生任何关于原文的判断。
 */
import type { Diagnosis } from './types';
import { MODE_META } from './types';
import { THEORY_BY_ID } from './theories';
import { propositionsOf } from './propositions';
import { pivotOf } from './pivot';
import { briefGaps, objectLabel, objectRoute, sourceLabel } from './brief';
import { toneAudit } from './modal';

export type FlowDepth = 'quick' | 'standard' | 'audit';
export type FlowStatus = 'ok' | 'partial' | 'gap' | 'na';
export type FlowGroup = 'A' | 'B' | 'C' | 'D' | 'E';

export interface FlowRow {
  /** 文档里的编号：A1 / B3 / C2 …… */
  id: string;
  group: FlowGroup;
  /** 文档里的名字：取材 / 准入 / 判结构 …… */
  name: string;
  status: FlowStatus;
  /** 本地在报告里看到了什么。看得到才写，看不到就写看不到。 */
  saw: string;
  /** 缺什么、缺了会怎样。na 时写「为什么这一档不走它」。 */
  note: string;
  /** 下一步能做什么。没有可做的事就空着，不硬凑。 */
  next: string;
  /** 报告里的落点（滚动用）。null = 这一栏在报告里没有对应区块。 */
  at: string | null;
  /**
   * 那个按钮上写什么。
   *
   * A 那两步的落点不在报告里，在输入区的立案卡——所以按钮必须写「去填立案」，
   * 写「看这一节」会让人以为报告里还有一栏没读到。其余各步都写「看这一节」。
   */
  goLabel: string;
}

export interface FlowView {
  depth: FlowDepth;
  depthLabel: string;
  depthWhy: string;
  rows: FlowRow[];
  counts: Record<FlowStatus, number>;
  /** 总述一行 */
  line: string;
  /** 顺序硬约束被破坏时的那句话；没破坏为 null */
  breach: string | null;
  /** 边界说明：这一栏量的是什么、量不到什么 */
  fine: string;
}

/* ─────────── 档位（§0.1） ─────────── */

const DEPTH_LABEL: Record<FlowDepth, string> = {
  quick: '速判',
  standard: '标准',
  audit: '全场审计',
};

/**
 * 档位要哪几步。
 *
 * 速判四步照抄文档：A2 准入 → B1 编主张 → B4 找枢纽 → 一句话判据（本软件里是 D1 的档位）。
 * 标准与全场审计都是 A–E 全程；全场审计多出来的那件事是**主张台账**，
 * 而台账不在这十六步里（它在 §0.1），所以只在那句档位说明里提，不虚设一格。
 */
const REQUIRED: Record<FlowDepth, ReadonlySet<string>> = {
  quick: new Set(['A2', 'B1', 'B4', 'D1']),
  standard: new Set(['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'D1', 'D2', 'D3', 'E1', 'E2', 'E3']),
  audit: new Set(['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'D1', 'D2', 'D3', 'E1', 'E2', 'E3']),
};

/**
 * 十六步的骨架。顺序就是文档 §1 的顺序，不另排。
 * `at` 是落点：报告里的哪一栏，或者输入区的立案卡（A 那两步在报告里没有对应区块）。
 * 落点存不存在由渲染层当场看一眼再说（见 FlowLedger），不在这里猜：
 * 同一件事在报告里有六七个分支，把分支抄进纯函数，改一处就会让这里说假话。
 */
const STAGES: { id: string; group: FlowGroup; name: string; at: string | null; go?: string }[] = [
  { id: 'A1', group: 'A', name: '取材', at: 'brief-card', go: '去填立案' },
  { id: 'A2', group: 'A', name: '准入', at: 'brief-card', go: '去填立案' },
  { id: 'A3', group: 'A', name: '路由', at: 'sec-props' },
  { id: 'B1', group: 'B', name: '编 P', at: 'sec-structure' },
  { id: 'B2', group: 'B', name: '补 A', at: 'sec-structure' },
  { id: 'B3', group: 'B', name: '判结构', at: 'sec-structure' },
  { id: 'B4', group: 'B', name: '定枢纽', at: 'sec-pivot' },
  { id: 'C1', group: 'C', name: '三问 ARS', at: 'sec-checks' },
  { id: 'C2', group: 'C', name: '标型式', at: 'sec-lens' },
  { id: 'C3', group: 'C', name: '逐 CQ', at: 'sec-checks' },
  { id: 'D1', group: 'D', name: '分档', at: 'sec-verdict' },
  { id: 'D2', group: 'D', name: '命题账', at: 'sec-props' },
  { id: 'D3', group: 'D', name: '修辞审计', at: 'sec-verdict' },
  { id: 'E1', group: 'E', name: '反方最强一击', at: 'sec-refute' },
  { id: 'E2', group: 'E', name: '加固版', at: 'sec-repair' },
  { id: 'E3', group: 'E', name: '自审', at: 'sec-selfcheck' },
];

/* ─────────── B3：结构判定（本地读 supports） ─────────── */

export type Shape = 'chain' | 'confluence' | 'single' | 'none';

export interface ShapeRead {
  kind: Shape;
  /** 直接指向结论的有几条 */
  direct: number;
  /** 指向中间结论（不直接到结论）的有几条 */
  via: number;
  line: string;
}

/**
 * 链式 / 合流 / 单线。
 *
 * 判据只用一个：`supports` 指向哪里。直接指到结论的多于一条，就是合流
 * （打掉一路不致命，按 §B3，不得因单点缺陷宣布整体失效）；
 * 只有一条直接到结论、其余都要经过它，就是链式（断一环全塌）；
 * 一条都没有，就是「结构读不出来」——不替它猜。
 *
 * 文档里的第三种「分流」（一个主张撑多个子结论）在本软件的数据结构里无从体现：
 * 一份报告只有一个结论字段。真要判分流，得先让报告装得下多个子结论——
 * 那是另一件事，不在这里假装做了。
 */
export function shapeOf(d: Diagnosis): ShapeRead {
  const cid = d.conclusion?.id;
  const others = [...(d.premises ?? []), ...(d.intermediate ?? [])].filter((c) => !!c && c.id !== cid);
  if (!cid || others.length === 0) {
    return { kind: 'none', direct: 0, via: 0, line: '报告里只有一条结论，没有别的主张可接——结构这一步无从谈起。' };
  }
  const direct = others.filter((c) => (c.supports ?? []).includes(cid)).length;
  const via = others.filter(
    (c) => !(c.supports ?? []).includes(cid) && (c.supports ?? []).some((s) => s !== cid)
  ).length;
  if (direct >= 2) {
    return {
      kind: 'confluence',
      direct,
      via,
      line: `合流：${direct} 条各自直接指向结论，打掉一路不致命——按 §B3，不能因为单点缺陷宣布整体失效。`,
    };
  }
  if (direct === 1 && via > 0) {
    return {
      kind: 'chain',
      direct,
      via,
      line: `链式：只有 1 条直接到结论，另有 ${via} 条要先经过它——断一环全塌。`,
    };
  }
  if (direct === 1) {
    return { kind: 'single', direct, via, line: '单线：一条前提直接撑住结论，中间没有别的环节。' };
  }
  return {
    kind: 'none',
    direct: 0,
    via,
    line: '没有一条主张接得到结论——要么报告的结构字段是空的，要么这些线断了。',
  };
}

/* ─────────── 每一步的证据 ─────────── */

function claimStats(d: Diagnosis) {
  const all = [d.conclusion, ...(d.premises ?? []), ...(d.intermediate ?? [])].filter(Boolean);
  const placed = all.filter((c) => c.span && c.span.quality !== 'failed');
  const implicit = all.filter((c) => c.implicit);
  return { all, placed, implicit };
}

function checkStats(d: Diagnosis, system: string) {
  const list = (d.checks ?? []).filter((c) => c.system === system);
  const answered = list.filter((c) => c.answer !== 'unanswered');
  return { list, answered, passed: list.filter((c) => c.answer === 'passed').length, violated: list.filter((c) => c.answer === 'violated').length };
}

/** 一步的证据核算结果。status 之外的三个字段会原样进 FlowRow。 */
type Evidenced = { status: FlowStatus; saw: string; note: string; next: string };

function evidenceOf(id: string, d: Diagnosis): Evidenced {
  const empty = { next: '' };
  switch (id) {
    case 'A1': {
      const b = d.brief;
      if (!b) {
        return {
          status: 'gap',
          saw: '报告里没有立案记录：谁说的、哪一版、原文还是转述都没记。',
          note: '按 §2 A1，三问没答清时，结论只能算「基于转述的评估」，并且整体按低一档的信任度读。',
          next: '在输入区填写「立案」三问，再跑一次。',
        };
      }
      const gaps = briefGaps(b);
      const head = `${b.speaker || '（没说谁）'}｜${b.version || '（没说哪一版）'}｜${sourceLabel(b.source)}`;
      if (gaps.length === 0) {
        return {
          status: 'ok',
          saw: `三问答清：${head}。`,
          note:
            b.source === 'hearsay'
              ? '这是转述，不是原文：按 §2 A1，结论须标「基于转述的评估」，整体信任度降一档。'
              : '',
          ...empty,
        };
      }
      return {
        status: 'partial',
        saw: `答了一部分：${head}。`,
        note: `还缺 ${gaps.length} 问：${gaps.join(' / ')}。三问没答清时，结论只能算「就文论文」。`,
        next: '补上缺的那几问。',
      };
    }
    case 'A2': {
      const b = d.brief;
      if (!b || b.objectKind === 'unknown') {
        return {
          status: 'gap',
          saw: '没有登记这段话在做什么（说理 / 情绪 / 价值宣示 / 规范文本）。',
          note: '准入这一步要的是一个人做出的决定，不是软件的默认值。跳过它，后面所有判定都不知道自己在量什么。',
          next: '在输入区的「立案」里选一类；选完再跑，报告会按那一类说明自己的处置。',
        };
      }
      const route = objectRoute(b.objectKind);
      return {
        status: 'ok',
        saw: route ? `登记为「${objectLabel(b.objectKind)}」。` : '登记为说理文本：可判，进全流程。',
        note: route ? `${route}。这份报告仍然给了论证分析——按流程这是越界的那一侧，读的时候要记住。` : '',
        ...empty,
      };
    }
    case 'A3': {
      const p = propositionsOf(d);
      if (p.total === 0) {
        return {
          status: 'gap',
          saw: '命题账是空的：报告没有把主张按「可裁 / 不可裁」分栏。',
          note: '不分栏，事实与规范两套标准就会串账——§2 A3 说这是后面必然出的事，不是可能的。',
          ...empty,
        };
      }
      return {
        status: 'ok',
        saw: `${p.total} 条主张已分栏。`,
        note: p.routeLine,
        ...empty,
      };
    }
    case 'B1': {
      const { all, placed } = claimStats(d);
      const n = (d.premises ?? []).length;
      if (n === 0) {
        return {
          status: 'gap',
          saw: '报告没有列出任何前提。',
          note: '§2 B1 要的是「把每句能独立成立的断言编号」；一条都没编，后面就没有可检查的对象。',
          ...empty,
        };
      }
      return {
        status: placed.length === all.length ? 'ok' : 'partial',
        saw: `${n} 条前提 + ${(d.intermediate ?? []).length} 条中间结论，${placed.length}/${all.length} 条有原文落点。`,
        note:
          placed.length === all.length
            ? ''
            : `有 ${all.length - placed.length} 条主张没落到原文上——它们可能是补出来的，也可能引文对不上，两种在报告里长得一样。`,
        ...empty,
      };
    }
    case 'B2': {
      const { implicit } = claimStats(d);
      if (implicit.length > 0) {
        return {
          status: 'ok',
          saw: `补出隐含前提 ${implicit.length} 条（报告标了「补出」）。`,
          note: '补得比原文强是稻草人，比原文弱是放水；这一点本地核不了，要你自己读那几条补出的文字。',
          ...empty,
        };
      }
      if (d.repair?.missingPremise) {
        return {
          status: 'partial',
          saw: '报告在「修补」里指出缺一条中介前提，但没有把它列进主张清单。',
          note: '指出缺什么与补出它是两步。停在指出这一步，C1 的「充分」就无从核起。',
          ...empty,
        };
      }
      return {
        status: 'gap',
        saw: '没有一条主张标了「补出」。',
        note: '可能这段确实不需要补前提，也可能这一步没做——报告里这两种情况看不出区别。',
        ...empty,
      };
    }
    case 'B3': {
      const s = shapeOf(d);
      return { status: s.kind === 'none' ? 'gap' : 'ok', saw: s.line, note: '', ...empty };
    }
    case 'B4': {
      const p = pivotOf(d);
      if (!p.rows.length) {
        return {
          status: 'gap',
          saw: '枢纽这一栏是空的。',
          note: '§2 B4 说这是整条流程的杠杆点：指出十处措辞毛病，不如指出一次「争点当起点」。',
          ...empty,
        };
      }
      return {
        status: 'ok',
        saw: `${p.rows.length} 条候选，最靠前的是 ${p.top?.id ?? '（无）'}${p.top?.badge ? `（${p.top.badge}）` : ''}。`,
        note: p.headline || p.line,
        ...empty,
      };
    }
    case 'C1': {
      const s = checkStats(d, 'ars');
      if (s.list.length === 0) {
        if (d.theory === 'ars') {
          return {
            status: 'gap',
            saw: '用的是 ARS 透镜，但检查表里没有三问的条目。',
            note: '可接受 / 相关 / 充分三问是 §C1 的全部；一条都没有，等于这一步没走。',
            ...empty,
          };
        }
        return {
          status: 'gap',
          saw: `这份报告用的是「${THEORY_BY_ID[d.theory]?.name ?? d.theory}」透镜，里面没有 ARS 三问。`,
          note: '六副透镜各问各的：型式透镜不问「前提可不可接受」。要这一栏，得换 ARS 那一副。',
          next: '用 ARS 透镜重跑这段（报告顶部的换透镜横幅）。',
        };
      }
      return {
        status: s.answered.length === s.list.length ? 'ok' : 'partial',
        saw: `三问 ${s.list.length} 条：过 ${s.passed}、未过 ${s.violated}、文中没交代 ${s.list.length - s.answered.length}。`,
        note: '',
        ...empty,
      };
    }
    case 'C2': {
      if (d.lens?.kind === 'walton') {
        return {
          status: 'ok',
          saw: `型式：${d.lens.schemeName}（${d.lens.family} 族）。`,
          note: d.lens.alternativeNote || '',
          ...empty,
        };
      }
      return {
        status: 'gap',
        saw: `用的是「${THEORY_BY_ID[d.theory]?.name ?? d.theory}」透镜，没有标论证型式。`,
        note: '§C2 的整个方法建立在「先识别型式，再逐条过它的 CQ」上；没有型式，C3 也无从开始。',
        next: '换「型式」透镜重跑这段。',
      };
    }
    case 'C3': {
      const s = checkStats(d, 'walton-cq');
      if (s.list.length === 0) {
        return {
          status: 'gap',
          saw: '检查表里没有 CQ 条目。',
          note: '公共论证的缺陷九成不是形式无效，而是型式用得不完整——那只能靠逐条过 CQ 才看得见。',
          ...empty,
        };
      }
      const unanswered = s.list.length - s.answered.length;
      return {
        status: unanswered === 0 ? 'ok' : 'partial',
        saw: `CQ ${s.list.length} 条：过 ${s.passed}、未过 ${s.violated}、文中没交代 ${unanswered}。`,
        note:
          unanswered === 0
            ? ''
            : `「文中没交代」不是漏答：它是「这段文字里找不到能回答它的东西」，按 §2 C3，这一条就是没过。`,
        ...empty,
      };
    }
    case 'D1': {
      if (!MODE_META[d.mode]?.givesVerdict) {
        return {
          status: 'na',
          saw: `「${MODE_META[d.mode]?.label ?? d.mode}」模式本来就不给档位。`,
          note: '这是模式的设计，不是缺漏：判定类才有档位，命名类与描述类没有。',
          ...empty,
        };
      }
      if (!d.verdict || d.verdict.level === 'undetermined') {
        return {
          status: 'partial',
          saw: `档位停在「无法判断」（本透镜刻度：${d.verdict?.scaleValue ?? '（没给）'}）。`,
          note: '「无法判断」是合法结论，但它与「没判」在报告里长得很像——读的时候要看它有没有写清为什么判不了。',
          ...empty,
        };
      }
      return {
        status: 'ok',
        saw: `本透镜刻度「${d.verdict.scale}」给出 ${d.verdict.scaleValue}，归一化到 ${d.verdict.level}。`,
        note: '文档的 D0–D5 与本软件的归一化四档不是同一套刻度；这一栏说的是后者，不假装两者一一对应。',
        ...empty,
      };
    }
    case 'D2': {
      const p = propositionsOf(d);
      if (p.total === 0) {
        return {
          status: 'gap',
          saw: '命题账是空的。',
          note: '论证质量与命题真假必须分栏、禁止互相转账（§D2 的双向铁律）；没有分栏，这条铁律无从执行。',
          ...empty,
        };
      }
      /* 只有结论一条时，账上没有可分的对象：那不叫「分好了栏」，叫还没开始分。 */
      if (p.total === 1) {
        return {
          status: 'partial',
          saw: '账上只有一条（结论），没有第二条可以对照。',
          note: 'D2 要分的是「这几条各自该由什么来定」；只有一条时，分栏等于没分。',
          ...empty,
        };
      }
      return {
        status: 'ok',
        saw: `${p.total} 条，分 ${Object.values(p.counts).filter((n) => n > 0).length} 组。`,
        note: p.routeLine,
        ...empty,
      };
    }
    case 'D3': {
      const t = toneAudit(d);
      const item = t.diffs.length
        ? `程度与口气：本地在结论那一句上核出 ${t.diffs.length} 处字面差别。`
        : '程度与口气：本地核过结论那一句，没读出字面差别。';
      return {
        status: 'partial',
        saw: item,
        note: '§D3 的四项里，只有「程度夸大」本地核得动（按字面），另外三项——三诉求配比、框架与预设、传播条件——报告没有这一栏，软件也不产出。',
        ...empty,
      };
    }
    case 'E1': {
      const rs = d.refutations ?? [];
      if (!rs.length) {
        return {
          status: 'gap',
          saw: '报告没有构造反方。',
          note:
            d.mode === 'redteam'
              ? '红队模式本该给攻击路线，这一份却是空的。'
              : '§E1 要的是「接受己方全部前提、用同一把尺子量出相反结论」那一版；没有它，判决只听过一面。',
          next: '用「红队」模式再跑一次。',
        };
      }
      const withSteelman = rs.filter((r) => (r.steelman ?? '').trim().length > 0).length;
      return {
        status: 'partial',
        saw: `${rs.length} 条反驳，其中 ${withSteelman} 条附了「对方最可能的反击」。`,
        note: '这是攻击路线，不是 §E1 说的「最强一击」：后者要接受全部前提、只换尺子。两者差一层，报告没做后者。',
        ...empty,
      };
    }
    case 'E2': {
      const r = d.repair?.repairedForm;
      if (!r || !r.trim()) {
        return {
          status: 'gap',
          saw: '「修补」里没有给出改写后的版本。',
          note: '§E2 的加固版要「保留原意、可以成立」，并且标出代价（放弃哪个强主张、降多少结论强度）。',
          ...empty,
        };
      }
      return {
        status: 'ok',
        saw: `给了加固版：${r.trim().slice(0, 46)}${r.trim().length > 46 ? '…' : ''}`,
        note: '',
        ...empty,
      };
    }
    case 'E3': {
      const s = d.selfCheck;
      const w = s?.withdrawIf?.length ?? 0;
      const u = s?.unknowns?.length ?? 0;
      const other = (s?.underOtherLens ?? '').trim().length > 0;
      if (!w && !u && !other) {
        return {
          status: 'gap',
          saw: '自审这一块是空的：没有可推翻条件，也没写自己不知道什么。',
          note: '§8 说得很直：写不出降级条件的判定，说明它只是感觉。',
          ...empty,
        };
      }
      return {
        status: 'partial',
        saw: `可推翻条件 ${w} 条、明确不知道的事 ${u} 条${other ? '、换透镜说明一段' : ''}。`,
        note: '§E3 的第四问（换一个更严苛的评估者，最可能被升档的是哪一条）报告没有答——这一问要人来问，软件答不了。',
        ...empty,
      };
    }
    default:
      return { status: 'na', saw: '', note: '', next: '' };
  }
}

/* ─────────── 汇总 ─────────── */

export function flowOf(d: Diagnosis): FlowView {
  const chars = (d.passage ?? '').trim().length;
  /* 「独立主张」按结论 + 中间结论数：前提是支撑它的理由，不是另一个主张。 */
  const claims = 1 + (d.intermediate ?? []).length;
  const depth: FlowDepth =
    chars >= 3000 || claims >= 3 ? 'audit' : chars < 200 && claims === 1 ? 'quick' : 'standard';

  const rows: FlowRow[] = STAGES.map((s) => {
    const e = evidenceOf(s.id, d);
    /* 先看证据。没做的话，才轮到档位说话：这一档不走它，就不算缺。 */
    let status = e.status;
    let note = e.note;
    let next = e.next;
    if ((status === 'gap' || status === 'partial') && !REQUIRED[depth].has(s.id)) {
      status = 'na';
      note = `「${DEPTH_LABEL[depth]}」这一档不走这一步（§0.1：速判只走 A2 → B1 → B4 → 一句话判据）。`;
      next = '';
    }
    return { id: s.id, group: s.group, name: s.name, status, saw: e.saw, note, next, at: s.at, goLabel: s.go ?? '看这一节' };
  });

  const counts: Record<FlowStatus, number> = { ok: 0, partial: 0, gap: 0, na: 0 };
  for (const r of rows) counts[r.status] += 1;

  const total = rows.length;
  const line = [
    `「${DEPTH_LABEL[depth]}」档 ${total} 步：走了 ${counts.ok} 步`,
    counts.partial ? `${counts.partial} 步只做了一半` : '',
    counts.gap ? `${counts.gap} 步没做` : '',
    counts.na ? `${counts.na} 步这一档不走` : '',
  ]
    .filter(Boolean)
    .join('，')
    .concat('。');

  /*
   * 顺序：A 没做完就进了 B–E。
   *
   * 只在**当前档位要求 A** 的时候说（速判本来就不走 A1，不能拿它算失格）。
   * 而且必须真的已经往后走了才说——一份只走到 A3 的报告没有「抢跑」这回事。
   */
  const later = rows.filter((r) => r.group !== 'A' && r.status === 'ok');
  const firstA = rows.find((r) => r.group === 'A' && r.status !== 'ok' && REQUIRED[depth].has(r.id));
  const breach =
    firstA && later.length > 0
      ? `判在立案之前：${firstA.id}「${firstA.name}」没有做完，而 B–E 已经走了 ${later.length} 步。按 §1，A 阶段没做完不得进入 B；按 §2 A1，三问没答清时结论须标「基于转述的评估」，并整体按低一档的信任度读。`
      : null;

  const fine = [
    '这一栏只数「做没做」，不判「做得对不对」——每一步做得准不准，本地算不出来。',
    `档位是本地按长度与独立主张数估的（${chars} 字 / ${claims} 个主张；文档 §0.1：速判 <200 字单主张，标准 500–3000 字，全场审计为长文多主张）${depth === 'audit' ? '；全场审计还要求先建主张台账，报告里没有这一层' : ''}。`,
    '「分流」（一个主张撑多个子结论）在报告的数据结构里无从体现——这里不假装判了它。',
  ].join(' ');

  return {
    depth,
    depthLabel: DEPTH_LABEL[depth],
    depthWhy: `${chars} 字，${claims} 个独立主张`,
    rows,
    counts,
    line,
    breach,
    fine,
  };
}
