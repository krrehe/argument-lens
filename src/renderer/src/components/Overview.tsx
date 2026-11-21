import type { Diagnosis } from '@shared/types';
import { auditGrade } from '@shared/grading';
import { coverageOf } from '@shared/coverage';
import { disputesIn } from '@shared/disputes';
import { propositionsOf } from '@shared/propositions';
import { pivotOf } from '@shared/pivot';
import { spineOf } from '@shared/spine';

/**
 * 报告开头的「主线」。
 *
 * 一整页报告有二十来栏，用户第一次打开时不知道从哪读起，最常见的结局是滚两下就关掉。
 * 原先这里是「四句话」：他要你信什么、哪里最薄、这说明到什么程度、怎么补。
 * 四句都是对的，但它们是**四件并列的事**，不是一条能复述的推理——
 * 读者读完了仍然说不清「所以他到底哪儿错了」。
 *
 * 现在换成一条线：主张 → 承重 → 断点 → 档位 → 出路，五环之间是因果，不是并列。
 * 顶上那句是把五环压成一句人话的地方；说不清的时候，读者至少能带走这一句。
 *
 * 每环都能点，点了直接滚到对应的栏。目录和正文互为索引——这是「相辅相成」最实在的一层：
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
  /* 修辞审计只在真有表时进索引：旧存档没有这一栏，给一格会点成死入口。 */
  if (d.rhetoric && d.rhetoric.rows.length > 0) extra.push({ id: 'sec-rhetoric', label: '修辞审计' });
  const nDisp = disputesIn(d).length;
  const disp = nDisp ? [{ id: 'sec-disputes', label: `争议 ${nDisp}` }] : [];
  /*
   * 顺序照正文：全流程账在最前（主线之后就是它），判读之后依次是账、柱子、争议，
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
    /* 「这把尺子」同样是固定栏：旧报告没记版本时，这一栏写的是「没记」，
       不是空白。正文排在分歧账之后，索引就也放最后。 */
    { id: 'sec-prompt-history', label: '这把尺子' },
  ];
}

export function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  /*
   * 简洁态里这一栏可能是收起的：先派发「展开」，等 React 把正文放出来再滚，
   * 否则 scrollIntoView 会落在一行 0 高度的标题上。完整态一律同步滚动——
   * 端到端「点目录跳到某节」按这个时序验，不该被新层级拖慢或改坏。
   */
  const reveal = el.getAttribute('data-collapsed') === '1';
  if (reveal) window.dispatchEvent(new CustomEvent('al:reveal', { detail: id }));
  const land = () => {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('flash');
    window.setTimeout(() => el.classList.remove('flash'), 1500);
  };
  if (reveal) window.setTimeout(land, 40);
  else land();
}

export function QuickRead({ d, onGotoCheck }: { d: Diagnosis; onGotoCheck?: (id: string) => void }) {
  const v = spineOf(d);
  const cov = coverageOf(d);
  /** 争议有几处。它决定导航里出不出现那一格——没碰到就不给一个点不动的入口。 */
  const nDisp = disputesIn(d).length;
  const sections = sectionsFor(d);
  const grade = d.verdict.grade;
  /* 判档记录缺项时不改档位，只在这里说一句「记录不全」——它解释的是「凭什么」，不是「几档」。 */
  const gradeGap = grade ? auditGrade(d).filter((x) => x.severity === 'block').length : 0;

  return (
    <section className="quick spine" data-spine="1">
      <div className="quick-head">
        <span className="qh-title">主线</span>
        <span className="qh-sub">
          先读这一句；想核，点每一环去看依据
          {nDisp > 0 && `。另有 ${nDisp} 处判断在学界有分歧，见「争议」`}
        </span>
      </div>

      {/*
        一句主线：不是摘要，是把五环压成一句能被人复述的话。
        它只拼报告里已有的名字与计数，不添评价词——读者若要反驳，反驳的是这句里的某一环。
        出路单起一句：它答的是「那怎么办」，与「哪儿断了」不是同一件事，挤在一行会读丢。
      */}
      <p className="sp-lead" data-spine-lead>
        {v.lead}
      </p>
      <p className="sp-outlet" data-spine-outlet>
        {v.outlet}
      </p>

      {v.segments.map((seg) => (
        <section className="sp-seg" data-spine-seg={seg.key} key={seg.key}>
          <div className="sp-seg-head">
            <span className="sp-seg-n">{seg.label}</span>
            <span className="sp-seg-t">{seg.title}</span>
            <span className="sp-seg-hint">{seg.hint}</span>
            <span className="sp-seg-rule" aria-hidden="true" />
          </div>
          <ol className="quick-list spine-list">
            {seg.rings.map((r) => (
              <li
                key={r.key}
                className={`quick-row spine-row ${r.tone}`}
                data-spine-ring={r.key}
                onClick={() => {
                  /* 先选中那一关再滚：滚过去时表里那一行必须已经是亮的，否则读者还要再找一遍。 */
                  if (r.checkId && onGotoCheck) onGotoCheck(r.checkId);
                  jumpTo(r.to);
                }}
              >
                <span className="qk">{r.n}</span>
                <span className="qt">{r.title}</span>
                <span className="qb">
                  <span className="qb-say">{r.text}</span>
                  <span className="qb-from">
                    <span className="qb-src">
                      {r.from}
                      {r.key === 'verdict' && gradeGap > 0 && ` · 判档记录不全 ${gradeGap} 处`}
                    </span>
                    <span className="sp-go">{r.toLabel} →</span>
                  </span>
                </span>
                <span
                  className={`qx ${r.tone === 'bad' ? 'bad' : r.tone === 'warn' ? 'mid' : r.tone === 'ok' ? 'ok' : ''}`}
                  data-quick-cover={r.to === 'sec-verdict' && cov.partial ? '1' : undefined}
                >
                  {r.tag ?? ''}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ))}

      <div className="spine-foot">
        <span className="sp-note">{v.note}</span>
        <button className="spine-flow" data-spine-flow onClick={() => jumpTo('sec-flow')}>
          这份报告是按流程走出来的吗 →
        </button>
      </div>

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
