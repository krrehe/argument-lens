import { useState } from 'react';
import type { Diagnosis } from '@shared/types';
import { auditGrade } from '@shared/grading';
import { coverageOf } from '@shared/coverage';
import { disputesIn } from '@shared/disputes';
import { propositionsOf } from '@shared/propositions';
import { pivotOf } from '@shared/pivot';
import { spineOf } from '@shared/spine';
import { digestOf, type DigestNode } from '@shared/digest';
import { StructureMap } from './Diagram';

/**
 * 报告最前面的「全文总结 + 论证逻辑链」。
 *
 * 这份报告此前一打开就是「为什么这个论证有问题」（spine 的五步判断链）。
 * 对已经读过原文的人，那样最省时间；对第一次读的人，等于在不知道对方说了什么
 * 的情况下先接受判决。这一屏把顺序倒回来：**先说他说的是一件什么事、怎么推的，
 * 再给判断**。
 *
 * 三块内容，颗粒度从粗到细：
 *
 *   1. 五句总结：争议之点 / 结论 / 依据 / 论证方式 / 档位与断点。全部来自报告字段。
 *   2. 逻辑链：按 supports 从结论往下长出来的树。三档颗粒度——骨架（结论+直接理由）、
 *      展开（加中间结论）、取证（连原文引用）。
 *   3. 五步判断链：原来的主线，收进折叠层。它答的是「为什么这样判」，
 *      不该和「这段说了什么」抢第一屏。
 *
 * 为什么把「跳到」拆成阶段与细目两层：一份报告有二十来节，十几个胶囊排成一行，
 * 读者看到的是一条工具栏，不是目录；先给六个阶段，细目收进「细目」里。
 * 所有 `data-qnav` 仍逐节保留，端到端探针照旧能验「每格都落得到、顺序不错」。
 */

const STAGES = [
  { id: 'part-summary', label: '总结' },
  { id: 'part-items', label: '逐条' },
  { id: 'part-overall', label: '整体' },
  { id: 'part-repair', label: '修补' },
  { id: 'part-more', label: '补充' },
  { id: 'part-appendix', label: '附录' },
];

/**
 * 「细目」里那几格。
 *
 * 顺序必须与正文的 DOM 顺序一致：端到端拿 `compareDocumentPosition` 逐对验，
 * 顺序错了读者按索引走会来回折返。所以这里不按「模块重不重要」排，按正文排。
 * 命题账、枢纽、修辞、争议都有数据才进；分歧账与尺子每份都有。
 */
function sectionsFor(d: Diagnosis) {
  const after: { id: string; label: string }[] = [];
  if (propositionsOf(d).total > 0) after.push({ id: 'sec-props', label: '命题账' });
  if (d.rhetoric && d.rhetoric.rows.length > 0) after.push({ id: 'sec-rhetoric', label: '修辞审计' });
  const nDisp = disputesIn(d).length;
  const disp = nDisp ? [{ id: 'sec-disputes', label: `争议 ${nDisp}` }] : [];
  const pivot = pivotOf(d).rows.length > 0 ? [{ id: 'sec-pivot', label: '承重' }] : [];
  /*
   * 顺序必须与正文 DOM 完全一致：先逻辑链，再承重、检查、判读，
   * 判读之后才是命题账 / 修辞 / 争议，最后修补与附录。
   * 这里不按「模块重不重要」排——端到端会逐对比较目标节点的先后。
   */
  return [
    { id: 'sec-structure', label: '逻辑链' },
    ...pivot,
    { id: 'sec-checks', label: '逐关检查' },
    { id: 'sec-verdict', label: '判读' },
    ...after,
    ...disp,
    { id: 'sec-repair', label: '修补' },
    { id: 'sec-flow', label: '全流程' },
    { id: 'sec-divergence', label: '分歧账' },
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

function ChainNode({
  n,
  max,
  sel,
  onPick,
}: {
  n: DigestNode;
  max: number;
  sel?: string | null;
  onPick?: (id: string) => void;
}) {
  const shown = n.depth <= max;
  if (!shown) return null;
  const more = n.depth === max && n.children.length > 0;
  return (
    <li className={`dg-node tone-${n.tone}`} data-digest-node={n.id} data-digest-depth={n.depth}>
      <button
        className={`dg-node-main ${sel === n.id ? 'on' : ''}`}
        onClick={() => onPick?.(n.id)}
        title="在原文与主张卡里定位这一条"
      >
        <span className="dg-id">{n.id}</span>
        <span className="dg-role">{n.roleLabel}</span>
        <span className="dg-body">
          <span className="dg-text">{n.text}</span>
          <span className="dg-marks">
            {n.marks.map((m) => (
              <span
                key={m}
                className={`dg-mark ${m === '承重' ? 'pivot' : m === '断点' || m === '被反驳' ? 'bad' : ''}`}
              >
                {m}
              </span>
            ))}
          </span>
        </span>
      </button>
      {max >= 3 && n.quote && <blockquote className="dg-quote">「{n.quote}」</blockquote>}
      {n.children.length > 0 && !more && (
        <ol className="dg-kids">
          {n.children.map((c) => (
            <ChainNode key={c.id} n={c} max={max} sel={sel} onPick={onPick} />
          ))}
        </ol>
      )}
      {more && <div className="dg-more">下一层还有 {n.children.length} 条；点「展开」或「取证」继续</div>}
    </li>
  );
}

export function QuickRead({
  d,
  onGotoCheck,
  sel,
  onPick,
  structureOn = true,
  structureBlocked = null,
  onOpenStructure,
}: {
  d: Diagnosis;
  onGotoCheck?: (id: string) => void;
  sel?: string | null;
  onPick?: (id: string) => void;
  /** 用户这次有没有打开「结构图」。关掉不等于没有：仍留一行占位。 */
  structureOn?: boolean;
  /** 画不出来的原因；能画时为 null。 */
  structureBlocked?: string | null;
  onOpenStructure?: () => void;
}) {
  const v = spineOf(d);
  const g = digestOf(d);
  const cov = coverageOf(d);
  const sections = sectionsFor(d);
  const [depth, setDepth] = useState(2);
  const grade = d.verdict.grade;
  /* 判档记录缺项时不改档位，只在这里说一句「记录不全」——它解释的是「凭什么」，不是「几档」。 */
  const gradeGap = grade ? auditGrade(d).filter((x) => x.severity === 'block').length : 0;

  return (
    <section className="quick spine digest" data-spine="1" data-digest="1">
      <div className="dg-gist" data-digest-gist="1">
        {g.gist.map((x, i) => (
          <div className="dg-gist-row" data-digest-gist-row={i} key={x.key}>
            <span className="dg-gist-k">{x.key}</span>
            <span className="dg-gist-t">{x.text}</span>
          </div>
        ))}
      </div>

      <section className="dg-chain" id="sec-digest-chain" data-digest-chain="1" data-spine-no={1}>
        <div className="dg-chain-head">
          <span className="dg-chain-t">论证逻辑链</span>
          <span className="dg-chain-sub">结论在上，理由往下；点节点可在正文里定位</span>
          <div className="dg-depth" role="group" aria-label="逻辑链颗粒度">
            {g.levels.map((l) => (
              <button
                key={l.n}
                className={`dg-depth-b ${depth === l.n ? 'on' : ''}`}
                data-digest-depth={l.n}
                onClick={() => setDepth(l.n)}
                title={l.hint}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <ol className="dg-tree">
          <ChainNode n={g.conclusion} max={depth} sel={sel} onPick={onPick} />
        </ol>

        {g.orphans.length > 0 && (
          <div className="dg-orphans" data-digest-orphans={g.orphans.length}>
            <div className="dg-orphan-t">接不回结论的 {g.orphans.length} 条</div>
            {g.orphans.map((n) => (
              <div className="dg-orphan" key={n.id}>
                <span className="dg-id">{n.id}</span>
                <span className="dg-text">{n.text}</span>
              </div>
            ))}
            <p className="dg-orphan-note">
              它们可能在支撑一条报告没拆出来的中间结论，也可能 supports 写错了——两种都值得回原文核。
            </p>
          </div>
        )}

        <p className="dg-chain-note">{g.boundary}</p>
      </section>

      {/*
        关系图是同一批主张的另一种读法：树看层级，图看连线。
        收进折叠层，是因为第一屏要回答「说了什么」，不是「画得全不全」；
        需要核结构的人点开即可。`sec-structure` 这个 id 留在这里，
        五步判断链的第一环「看结构图」仍然有落点。
      */}
      <details className="dg-graph" id="sec-structure" data-view-gate="structure">
        <summary>看关系图：谁支撑谁</summary>
        {structureOn ? (
          <StructureMap
            d={d}
            sel={sel ?? null}
            onPick={(id) => {
              if (id) onPick?.(id);
            }}
          />
        ) : structureBlocked ? (
          /* 画不出来：把原因原样摆出来，不给「打开」按钮——
             读者会去找一个他从来没关过的东西。 */
          <div className="dg-off">
            <span>{structureBlocked}</span>
          </div>
        ) : (
          /* 读者自己关掉的。`data-view-off` 是给外面核对的记号：
             挑图那一栏与端到端按它认「哪一张被关了」，只写一句人话认不出来。 */
          <div className="dg-off" data-view-off="structure">
            <span>结构图这次关着。关掉不影响报告内容，只是不画这张图。</span>
            <button className="dg-off-btn" data-view-off-open="structure" onClick={onOpenStructure}>
              打开这张图
            </button>
          </div>
        )}
      </details>

      {/*
        原来的五步判断链收在这里。
        它答的是「为什么这样判」，与上面「这段说了什么」是两个问题；
        同屏并列会让读者把判断当成内容摘要。折叠不等于删除：
        `data-spine-*` 探针仍在，点「为什么这样判」的人能完整看到五环。
      */}
      <details className="dg-why">
        <summary>为什么这样判：五步判断链</summary>
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
                  <span className="qt">
                    {r.title}
                    <span
                      className={`qx ${r.tone === 'bad' ? 'bad' : r.tone === 'warn' ? 'mid' : r.tone === 'ok' ? 'ok' : ''}`}
                      data-quick-cover={r.to === 'sec-verdict' && cov.partial ? '1' : undefined}
                    >
                      {r.tag ?? ''}
                    </span>
                  </span>
                  <span className="qb">
                    <span className="qb-say">{r.text}</span>
                    <span className="qb-from">
                      {r.from}
                      {r.key === 'verdict' && gradeGap > 0 && ` · 判档记录不全 ${gradeGap} 处`}
                      <span className="sp-go">{r.toLabel} →</span>
                    </span>
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
      </details>

      <nav className="quick-nav" aria-label="报告目录">
        <span className="qn-label">跳到</span>
        {STAGES.map((s) => (
          <button key={s.id} className="qn-stage" data-stage={s.id} onClick={() => jumpTo(s.id)}>
            {s.label}
          </button>
        ))}
        <details className="qn-more">
          <summary>细目</summary>
          <div className="qn-chips">
            {sections.map((s) => (
              <button key={s.id} className="qn-chip" data-qnav={s.id} onClick={() => jumpTo(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        </details>
      </nav>
    </section>
  );
}
