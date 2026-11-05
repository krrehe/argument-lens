/**
 * 报告里有哪些图可以看、这次看哪几张。
 *
 * 为什么需要这一层：报告里的图原来是「写死在正文里」的——结构图、逐关检查、
 * 判读刻度三张必然出现，位置也固定。读者不能关掉任何一张，也不能要求多画一张。
 * 可这个应用的主线恰恰是「你自己决定看哪一层」：同一段话可以只看结构，
 * 也可以只看它倒在哪。图不给选，等于又替用户定了一次阅读顺序。
 *
 * 这一层只做三件事，且都能复算：
 *   1. 这份报告**画得出**哪几张（画不出的说明原因，不静默消失）；
 *   2. 用户上次选了哪几张（存的选择可能被手改成垃圾，要能落地）；
 *   3. 这次实际显示哪几张（可画的 ∩ 用户要的）。
 *
 * 三条纪律：
 *   - **画不出不等于不存在**。清单里照样列出这张图并写明为什么画不出——
 *     直接过滤掉，读者就分不清「这份没有反驳」与「这个功能坏了」。
 *   - **选择不动数据**。用户关了哪张图，不影响报告内容，也不影响存档与导出。
 *   - **空选择是合法的**。五张全关也允许：有人就想读文字。界面把「0/5」说出来，
 *     但不擅自替他把图打开——那等于没给他选。
 */

import type { Diagnosis } from './types';

export type ViewId = 'structure' | 'checks' | 'verdict' | 'refute' | 'repair';

export interface ViewSpec {
  id: ViewId;
  /** 界面上那一行左边的名字。 */
  name: string;
  /** 这张图回答什么问题。一句话，不解释怎么画。 */
  what: string;
  /** 正文里对应的栏，点清单可以跳过去。 */
  where: string;
  /**
   * 画不出来的原因；能画时为 null。
   *
   * 用「原因」而不是布尔值，因为清单要把原因原样显示出来。
   */
  blocked: string | null;
}

/** 顺序固定：清单与正文都按这个顺序，不随用户勾选顺序变。 */
export const VIEW_ORDER: ViewId[] = ['structure', 'checks', 'verdict', 'refute', 'repair'];

/**
 * 默认看三张：结构、逐关检查、判读。
 *
 * 这三张是主线（他在论证什么 → 哪一关没过 → 所以算站得住吗），
 * 也是这一层出现之前正文里本来就有的三张。默认与旧版一致，
 * 升级不会突然把报告拉长或改掉阅读顺序。
 *
 * 新增的两张（反驳落点、修补对照）默认关：它们是「想深挖时再打开」的，
 * 不是每读一份都必须经过。默认关不等于藏起来——选择条上写着总数。
 */
export const DEFAULT_VIEWS: ViewId[] = ['structure', 'checks', 'verdict'];

const isViewId = (v: unknown): v is ViewId => typeof v === 'string' && (VIEW_ORDER as string[]).includes(v);

/**
 * 这份报告能画哪几张。
 *
 * 五张一律返回，`blocked` 说明画不出的原因。判定只用报告里已有的字段，
 * 不看模式、不看透镜——同一份报告在哪个模式下都该给出同一份清单。
 */
export function viewsOf(d: Diagnosis): ViewSpec[] {
  const hasClaims = d.premises.length > 0 || d.intermediate.length > 0;

  return [
    {
      id: 'structure',
      name: '结构图',
      what: '他摆的依据怎么接到结论上，哪一步接不上',
      where: 'sec-structure',
      blocked: hasClaims ? null : '这段文本里没有拆出可用的前提，画不出结构图（这本身是一条结论：没有前提可拆，也就没有论证可评）',
    },
    {
      id: 'checks',
      name: '逐关检查',
      what: '这副透镜要问的每一关，过了、没过，还是他没回答',
      where: 'sec-checks',
      blocked: d.scope.applicable
        ? d.checks.length > 0
          ? null
          : '报告里没有检查项'
        : '这副透镜判了不适用，没有关卡可画',
    },
    {
      id: 'verdict',
      name: '判读刻度',
      what: '这一档落在尺子的哪一格，原生刻度叫什么',
      where: 'sec-verdict',
      /* 判不了也要画：刻度上「指针不出现」本身就是那条结论。 */
      blocked: null,
    },
    {
      id: 'refute',
      name: '反驳落点',
      what: '生成的反驳打在哪几处，每个打法各占一条',
      where: 'sec-refute',
      blocked: d.refutations.length > 0 ? null : '这份报告没有生成反驳',
    },
    {
      id: 'repair',
      name: '修补对照',
      what: '补上缺的那一句之后，这条链接不接得上',
      where: 'sec-repair',
      blocked:
        d.repair.missingPremise || d.repair.repairedForm
          ? null
          : '这份报告既没给缺失前提，也没给补完的写法',
    },
  ];
}

export function specOf(views: ViewSpec[], id: ViewId): ViewSpec | undefined {
  return views.find((v) => v.id === id);
}

/**
 * 把存下来的选择落成这次能用的选择。
 *
 * 规则（每条都有断言守着）：
 *   - 不是数组 → 用默认（存储被手改坏时不该白屏，也不该清空用户的选择）；
 *   - 只留合法 id、去重、按 VIEW_ORDER 排序（顺序稳定，渲染不随勾选顺序变）；
 *   - 空数组原样返回：全关是用户的选择，不是「没存过」；
 *   - 这次画不出的一律不显示，但**不修改存储值**——那份报告没有反驳，
 *     不代表下次遇到有反驳的报告时用户不想看。
 */
export function normalizeViews(saved: unknown, views: ViewSpec[]): ViewId[] {
  if (!Array.isArray(saved)) return [...DEFAULT_VIEWS];
  const want = new Set(saved.filter(isViewId));
  const drawable = new Set(views.filter((v) => v.blocked === null).map((v) => v.id));
  return VIEW_ORDER.filter((id) => want.has(id) && drawable.has(id));
}

/** 只做规范化、不管能不能画。给存储层用：存的是意图，不是本次结果。 */
export function sanitizeViews(saved: unknown): ViewId[] {
  if (!Array.isArray(saved)) return [...DEFAULT_VIEWS];
  const want = new Set(saved.filter(isViewId));
  return VIEW_ORDER.filter((id) => want.has(id));
}

/**
 * 选择条上那一行。
 *
 * 「图 3/5」里的分母是**这次画得出来的**张数，不是固定的五张：
 * 一份没有反驳的报告，分母不该是 5——那会让读者去找一张根本不存在的图。
 */
export function viewCountLine(views: ViewSpec[], picked: ViewId[]): string {
  const drawable = views.filter((v) => v.blocked === null);
  if (drawable.length === 0) return '这份报告没有画得出来的图';
  const shown = drawable.filter((v) => picked.includes(v.id));
  if (shown.length === 0) return `图 0/${drawable.length} · 你把图都关了，文字照常`;
  return `图 ${shown.length}/${drawable.length} · ${shown.map((v) => v.name).join('、')}`;
}

/**
 * 清单里每一项的状态说明。
 *
 * 三态分开写，因为「关着」「开着」与「画不出」是三件事：
 * 前两个是用户的选择，第三个是这份报告没有那个数据。混成一个勾选框，
 * 读者会以为「画不出」是他自己关掉的。
 */
export function viewStateText(v: ViewSpec, picked: ViewId[]): string {
  if (v.blocked !== null) return v.blocked;
  return picked.includes(v.id) ? '显示中' : '已关掉';
}
