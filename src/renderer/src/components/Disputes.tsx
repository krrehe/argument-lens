import { useEffect, useState } from 'react';
import {
  DISPUTES,
  DISPUTE_BY_ID,
  DISPUTE_SECTION,
  type Dispute,
  type DisputeHit,
  type DisputeId,
} from '@shared/disputes';
import { jumpTo } from './Overview';

/**
 * 争议栏。
 *
 * 它要回答的是一个很具体的不信任：「你凭什么这么判？」
 * 只答「书里写的」等于把权威当理由，而这个工具反对的正是这件事。
 *
 * 所以每一张卡固定三层：
 *   1. 争点（问句）+ 一条尺：两派站在哪、本工具在哪一格
 *   2. 每派的主张与代价 —— 只写主张不写代价，是在替自己那一边说话
 *   3. 为什么这一份会碰到它（具体理由，不是通用说明）
 *
 * 「本工具站这里」用蓝灰（--accent），不用红绿：站边不是好坏，是位置。
 */

/**
 * 从报告某栏跳到「这一处争议」。
 *
 * 不能只 scrollIntoView 到争议栏：那条争议可能被折在「还有 N 处」后面，
 * 跳过去会落在栏顶却看不到它——那比不跳更糟，用户会以为链接是坏的。
 * 所以先请争议栏展开，再定位到那一张卡。
 */
export function focusDispute(id: DisputeId) {
  window.dispatchEvent(new CustomEvent('al:dispute', { detail: id }));
}

function flash(el: HTMLElement | null) {
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('dp-flash');
  window.setTimeout(() => el.classList.remove('dp-flash'), 1500);
}

function DisputeCard({
  d,
  hit,
  index,
  compact,
}: {
  d: Dispute;
  hit?: DisputeHit;
  index?: number;
  /** 报告里的紧凑态：先给「这一份为什么碰到它」，把通用说明收进展开区。 */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const sec = DISPUTE_SECTION[d.id];
  const stanceCamp = d.camps.find((c) => c.id === d.stance.camp);
  const rival = d.camps.filter((c) => c.id !== d.stance.camp);

  return (
    // id 只在报告栏里给。对话框里也会渲染同一条争议，两处并存时 id 会撞，
    // getElementById 会取到背后那一张——跳转就跳到看不见的东西上去了。
    <article className={`dp-card ${hit ? 'hit' : ''}`} id={compact ? `dp-${d.id}` : undefined}>
      <header className="dp-head" onClick={() => setOpen((v) => !v)}>
        {index !== undefined && <span className="dp-n">{index}</span>}
        <span className="dp-title">{d.title}</span>
        <span className="dp-short">{d.short}</span>
        <span className="dp-caret">{open ? '−' : '+'}</span>
      </header>

      {/* 一条尺：每派一格，本工具那一格填色并在下面标出来。格子一样宽——不暗示哪边更对。 */}
      <div className="dp-ruler" title="格子的宽窄不代表支持度，只表示有几派">
        {d.camps.map((c) => (
          <div key={c.id} className={`dp-col ${c.id === d.stance.camp ? 'on' : ''}`}>
            <div className="dp-seg">{c.name}</div>
            {c.id === d.stance.camp && <div className="dp-tag">▲ 本工具站这里</div>}
          </div>
        ))}
      </div>

      {!compact && <p className="dp-stake">{d.stake}</p>}

      {hit && (
        <div className="dp-because">
          <span className="dp-because-k">这一份为什么碰到它</span>
          {hit.because}
        </div>
      )}

      {open && (
        <div className="dp-body">
          {compact && <p className="dp-stake">{d.stake}</p>}
          <div className="dp-camps">
            {d.camps.map((c) => (
              <div key={c.id} className={`dp-camp ${c.id === d.stance.camp ? 'mine' : ''}`}>
                <div className="dp-camp-h">
                  <b>{c.name}</b>
                  {c.id === d.stance.camp && <span className="dp-pin">本工具</span>}
                </div>
                <div className="dp-camp-holds">{c.holds}</div>
                <div className="dp-camp-cost">
                  <span>代价</span>
                  {c.cost}
                </div>
                {c.who && <div className="dp-camp-who">{c.who}</div>}
              </div>
            ))}
          </div>

          <div className="dp-stance">
            <b>本工具站「{stanceCamp?.name}」</b>
            {d.stance.why}
            {rival.length > 0 && (
              <span className="dp-dim">
                「{rival.map((r) => r.name).join('」「')}」那一派的批评并没有被解决，只是这一份输出选择不靠它。
              </span>
            )}
          </div>

          <div className="dp-foot">
            <span className="dp-refs">{d.refs.join('；')}</span>
            <button className="qn-chip" onClick={() => jumpTo(sec.id)}>
              报告里的「{sec.label}」→
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

/**
 * 报告里的那一栏。只列这次真的碰到的，其余在「争议地图」里。
 *
 * 默认先露三张：七张连排下来又是一屏，而这一栏的作用是「让你发现原来这里有分歧」，
 * 不是「把九条争论一次讲完」。剩下的折起来，但数目照写——不能有悄悄藏起来的部分。
 */
export function DisputeStrip({ hits }: { hits: DisputeHit[] }) {
  const [all, setAll] = useState(false);

  // 板块标题上的「争议 N」通过事件找到这里：先展开到能看见那一张，再滚过去。
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent).detail as DisputeId;
      if (!hits.some((h) => h.id === id)) return;
      setAll(true);
      // 展开是异步的：等一帧再定位，否则拿到的还是折叠时的布局
      window.setTimeout(() => flash(document.getElementById(`dp-${id}`)), 80);
    };
    window.addEventListener('al:dispute', on);
    return () => window.removeEventListener('al:dispute', on);
  }, [hits]);

  if (!hits.length) return null;
  const head = all ? hits : hits.slice(0, 3);
  const rest = hits.length - head.length;

  return (
    <div className="dp-strip">
      {head.map((h, i) => (
        <DisputeCard key={h.id} d={DISPUTE_BY_ID[h.id]} hit={h} index={i + 1} compact />
      ))}
      {rest > 0 && (
        <button className="dp-more" onClick={() => setAll(true)}>
          还有 {rest} 处（第 {head.length + 1}–{hits.length} 处）——都在这份判断里，点开看
        </button>
      )}
      {all && hits.length > 3 && (
        <button className="dp-more" onClick={() => setAll(false)}>
          收起，只看前三处
        </button>
      )}
    </div>
  );
}

/** 顶栏的「争议地图」：这次碰到的排在前面，没碰到的也列出来备查。 */
export function DisputeDialog({ hits, onClose }: { hits: DisputeHit[]; onClose: () => void }) {
  const [onlyHit, setOnlyHit] = useState(hits.length > 0);
  const hitIds = new Set(hits.map((h) => h.id));
  const list = onlyHit ? hits : DISPUTES.map((d) => ({ id: d.id, because: '' }));

  return (
    <div className="mask" onClick={onClose}>
      <div className="dialog dp-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          理论争议地图
          <span className="dp-dialog-sub">
            这些是学理上真的没有共识的地方。跟「我没把握」是两件事：那个是能力问题，这个是学科的状况。
          </span>
        </div>
        <div className="dp-tabs">
          <button
            className={`dp-tab ${onlyHit ? 'on' : ''}`}
            onClick={() => setOnlyHit(true)}
            disabled={!hits.length}
          >
            这一份碰到的 {hits.length}
          </button>
          <button className={`dp-tab ${onlyHit ? '' : 'on'}`} onClick={() => setOnlyHit(false)}>
            全部 {DISPUTES.length}
          </button>
          <span className="spacer" />
          <span className="dp-hint">点标题展开：两派各主张什么、代价是什么</span>
        </div>
        <div className="dialog-body dp-dialog-body">
          {list.map((h, i) => (
            <DisputeCard
              key={h.id}
              d={DISPUTE_BY_ID[h.id as DisputeId]}
              hit={onlyHit && h.because ? h : undefined}
              index={i + 1}
            />
          ))}
          {onlyHit && !list.length && (
            <p className="hint">这一份没有碰到争议点。这不代表判定一定对，只代表这次的判断没有落在两派分歧的地方。</p>
          )}
          <p className="dp-fine">
            争议没有「正确答案」一栏，因为确实没有。本工具的做法是<b>把站边写出来、把代价写出来</b>，
            让不同意的人知道该攻哪里——而不是把一次选择包装成通行的结论。
            {hitIds.size > 0 && ` 这次涉及 ${hitIds.size} 条。`}
          </p>
        </div>
        <div className="dialog-foot">
          <button className="primary" onClick={onClose}>
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
