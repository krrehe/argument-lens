import type { Diagnosis } from '@shared/types';
import { LEVEL_LABEL } from '@shared/theories';
import { disputesIn } from '@shared/disputes';
import { propositionsOf } from '@shared/propositions';
import { pivotOf } from '@shared/pivot';

/**
 * 报告开头的「四句话」。
 *
 * 一整页报告有十几栏，用户第一次打开时不知道从哪读起，最常见的结局是滚两下就关掉。
 * 这四句是整页的目录，也是整页的摘要：他要你信什么、哪里最薄、这说明到什么程度、怎么补。
 *
 * 每句都能点，点了直接滚到对应的栏。目录和正文互为索引——这是「相辅相成」最实在的一层：
 * 不是再加一段说明文字，而是让读者随时能在「结论」和「依据」之间来回跳。
 */

const BASE_SECTIONS = [
  { id: 'sec-structure', label: '结构图' },
  { id: 'sec-checks', label: '逐关检查' },
  { id: 'sec-verdict', label: '判读' },
  /*
   * 「透镜产物」在正文里排在「重构」之后、「反驳」之前——不是最末。
   * 这一格此前一直放在最后，读者按索引走会跳过它再折回来；顺序错了不报错，
   * 只有把格子与正文的先后对着比才看得出来（冒烟里那条就是这么抓到的）。
   */
  { id: 'sec-lens', label: '透镜产物' },
  { id: 'sec-refute', label: '反驳' },
  { id: 'sec-repair', label: '修补' },
];

/**
 * 「跳到」那条上的格子。
 *
 * 前六格是与透镜无关的固定栏。中间两格（命题账 / 枢纽）是本地算出来的，有数据才存在，
 * 位置在判读之后——一份真报告里大约在一万像素以下。而这条是整页唯一的紧凑索引：
 * 不进这条，那两栏基本只有滚到那里的人才会看见，等于做完就藏起来了。
 *
 * 「有没有」与正文用同一对纯函数判断，不在这里另写一套：判错方向就会出现
 * 一格点了没有反应的死入口，而跳转失败最像是「软件卡了一下」。
 */
function sectionsFor(d: Diagnosis) {
  const extra: { id: string; label: string }[] = [];
  if (propositionsOf(d).total > 0) extra.push({ id: 'sec-props', label: '命题账' });
  if (pivotOf(d).rows.length > 0) extra.push({ id: 'sec-pivot', label: '枢纽' });
  const nDisp = disputesIn(d).length;
  const disp = nDisp ? [{ id: 'sec-disputes', label: `争议 ${nDisp}` }] : [];
  /*
   * 顺序照正文：全流程账在最前（四句话之后就是它），判读之后依次是账、柱子、争议，
   * 然后才是透镜产物、反驳与修补。这一格不按数据现算——流程账每份报告都有，
   * 它是这一页的方位，不是可选栏。
   */
  return [
    { id: 'sec-flow', label: '全流程' },
    ...BASE_SECTIONS.slice(0, 3),
    ...extra,
    ...disp,
    ...BASE_SECTIONS.slice(3),
    /* v1.1 E4：这一栏每份报告都有（没登记时也显示「没有分歧账」及理由），
       所以是固定格，不按数据现算。正文里排在自检之后，索引就放最后。 */
    { id: 'sec-divergence', label: '分歧账' },
  ];
}

export function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('flash');
  window.setTimeout(() => el.classList.remove('flash'), 1500);
}

function clip(s: string, n: number) {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

export function QuickRead({ d }: { d: Diagnosis }) {
  const bad = d.checks.find((c) => c.answer === 'violated') ?? d.checks.find((c) => c.answer === 'unanswered');
  /** 争议有几处。它决定导航里出不出现那一格——没碰到就不给一个点不动的入口。 */
  const nDisp = disputesIn(d).length;
  const sections = sectionsFor(d);
  const levelClass =
    d.verdict.level === 'withstands' ? 'ok' : d.verdict.level === 'fails' ? 'bad' : d.verdict.level === 'weakened' ? 'mid' : '';

  const rows = [
    {
      k: '①',
      title: '他想让你信的是',
      body: d.conclusion.text,
      to: 'sec-structure',
      extra: d.premises.length ? `他摆了 ${d.premises.length} 条依据` : '没有摆出依据',
    },
    {
      k: '②',
      title: '最薄的一处',
      body: d.scope.applicable === false
        ? `这把尺子在这段话上不适用：${clip(d.scope.reason, 70)}`
        : bad
          ? `${bad.label} —— ${clip(bad.basis || '未写依据', 80)}`
          : '把每一关都过了一遍，没有找到明显的断裂处。这不等于论证正确，只等于这一套问题它都答上了。',
      to: 'sec-checks',
      extra: bad ? `${bad.id} · ${bad.answer === 'violated' ? '没过' : '没答'}` : '未发现断点',
    },
    {
      k: '③',
      title: '所以这算说明到什么程度',
      body: clip(d.verdict.statement, 110),
      to: 'sec-verdict',
      extra: LEVEL_LABEL[d.verdict.level],
      extraClass: levelClass,
    },
    {
      k: '④',
      title: '想让它站住，得补上',
      body: d.repair.missingPremise ?? d.repair.repairedForm ?? '未给出补法——这本身是一种结论：可能补不上，也可能这不是个能补的论证。',
      to: 'sec-repair',
      extra: '修补',
    },
  ];

  return (
    <section className="quick">
      <div className="quick-head">
        <span className="qh-title">四句话看懂这份报告</span>
        <span className="qh-sub">
          不想读整页，读这四句就够；想核，点进去看依据
          {nDisp > 0 && `。另有 ${nDisp} 处判断在学界有分歧，见「争议」`}
        </span>
      </div>
      <ol className="quick-list">
        {rows.map((r) => (
          <li key={r.k} onClick={() => jumpTo(r.to)} className="quick-row">
            <span className="qk">{r.k}</span>
            <span className="qt">{r.title}</span>
            <span className="qb">{r.body}</span>
            <span className={`qx ${r.extraClass ?? ''}`}>{r.extra}</span>
          </li>
        ))}
      </ol>
      <nav className="quick-nav">
        <span className="qn-label">跳到</span>
        {sections.map((s) => (
          <button key={s.id} className="qn-chip" data-qnav={s.id} onClick={() => jumpTo(s.id)}>
            {s.label}
          </button>
        ))}
      </nav>
    </section>
  );
}
