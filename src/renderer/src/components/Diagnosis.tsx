import { useMemo, useState, type ReactNode } from 'react';
import {
  MODE_META,
  type AnalysisMode,
  type CheckItem,
  type Claim,
  type Diagnosis,
  type LabelCandidate,
  type LegitimateMove,
  type Refutation,
  type Span,
} from '@shared/types';
import { ACCEPT_PILL, ANSWER_CLASS, ANSWER_LABEL, BURDEN_LABEL, CONF_LABEL, STRATEGY_LABEL, TAG_LABEL } from '@shared/labels';
import { LEVEL_LABEL, THEORY_BY_ID } from '@shared/theories';
import { DISPUTE_BY_ID, DISPUTE_SECTION, disputesIn, type DisputeId } from '@shared/disputes';
import { topicsOf, type TopicHit } from '@shared/topics';
import { academicOf, BY_TOOL_LABEL, type AcademicView, type ByTool } from '@shared/academic';
import { limitsOf } from '@shared/limits';
import { propositionsOf } from '@shared/propositions';
import { pivotOf } from '@shared/pivot';
import { flowOf } from '@shared/flow';
import { graphOf, graphSummary } from '@shared/prg-graph';
import { prescriptionsOf } from '@shared/prescriptions';
import { fallacyHits, mapSentences } from '@shared/fallacy-map';
import { rereadOf } from '@shared/reread';
import { GAP_FROM_LABEL, skeletonOf } from '@shared/skeleton';
import { REWRITE_NOTE, rewriteOf } from '@shared/rewrite';
import { type RescalePair } from '@shared/rescale';
import { type ConditionInput } from '@shared/conditions';
import { CheckStrip, StructureMap, VerdictGauge } from './Diagram';
import { DivergenceView } from './DivergenceCard';
import { PromptHistoryCard } from './PromptHistory';
import { RefuteMap, RepairMap } from './DiagramMore';
import { ViewBar, readStoredViews, writeStoredViews } from './ViewBar';
import { crossNote, toneAudit } from '@shared/modal';
import { VIEW_ORDER, normalizeViews, sanitizeViews, viewsOf, type ViewId, type ViewSpec } from '@shared/views';
import { DisputeStrip, focusDispute } from './Disputes';
import { QuickRead, jumpTo } from './Overview';
import { Term, usePlain } from './Term';
import { ObjectBtn } from './Objection';
import { ObjectionDigest } from './ObjectionDigest';
import { PropositionLedger } from './PropositionLedger';
import { PivotCard } from './PivotCard';
import { FlowLedger } from './FlowLedger';
import { ArsGapMap, PtaLocator, ToulminLayout, WaltonFamilyPath } from './LensDiagrams';
import { VerdictWhy } from './VerdictWhy';
import { RereadScreen } from './RereadScreen';
import { RescaleScreen } from './RescaleScreen';
import { ConditionScreen } from './ConditionScreen';
import { SourceBar } from './SourceBar';
import { CoverageBar } from './CoverageBar';
import { FieldTermsBar } from './FieldTermsBar';

/* ═══════ 通用小件 ═══════ */

/* 标签表在 shared/labels.ts：界面与导出必须说同一套话，
   否则改了一处措辞，另一处还留着旧的。 */

function Block({
  id,
  title,
  sub,
  plain,
  disputes,
  children,
}: {
  id?: string;
  title: string;
  sub?: string;
  /** 这一栏在说什么。一句人话，不出现任何术语。 */
  plain?: string;
  /** 这一栏的内容碰到了哪几处理论争议。点了跳到那一条——从结论回到分歧。 */
  disputes?: DisputeId[];
  children: ReactNode;
}) {
  const p = usePlain();
  return (
    <section className="block" id={id}>
      <div className="block-head">
        <span className="t">{title}</span>
        {sub && <span className="s">{sub}</span>}
        {disputes && disputes.length > 0 && (
          <button
            className="dp-mark"
            onClick={() => focusDispute(disputes[0])}
            title={`这里的判断在学界有分歧：${disputes.map((x) => DISPUTE_BY_ID[x].short).join('、')}`}
          >
            争议 {disputes.length}
          </button>
        )}
      </div>
      {p && plain && <div className="block-plain">{plain}</div>}
      <div className="block-body">{children}</div>
    </section>
  );
}

/**
 * 图被用户关掉时占的那一行。
 *
 * 为什么不让整个栏目消失：目录里的「结构图」入口还指着它，跳过来会落到空处；
 * 而且「关掉了」与「这份报告画不出」是两件事，前者是用户自己做的，后者是数据没有。
 * 这一行把前者说出来，并给一个就地打开的按钮——不要求他去顶部再找一遍。
 */
/**
 * 图的选择闸门。
 *
 * 三种状态要分开：**画得出且开着**（渲染图）、**画得出但关着**（一行提示 + 打开）、
 * **压根画不出**（把 children 放出去，让图自己说为什么画不出）。
 * 第三种如果也显示「你关掉了」，读者会去找一个他从来没关过的东西。
 */
function Gated({
  id,
  views,
  picked,
  onOpen,
  children,
}: {
  id: ViewId;
  views: ViewSpec[];
  picked: ViewId[];
  onOpen: () => void;
  children: ReactNode;
}) {
  const spec = views.find((v) => v.id === id);
  if (!spec || spec.blocked !== null) return <>{children}</>;
  return picked.includes(id) ? <>{children}</> : <ViewOff id={id} onOpen={onOpen} />;
}

function ViewOff({ id, onOpen }: { id: ViewId; onOpen: () => void }) {
  return (
    <p className="hint vw-off" data-view-off={id}>
      这张图你关掉了。
      <button className="vw-off-open" data-view-off-open={id} onClick={onOpen}>
        打开
      </button>
    </p>
  );
}

function Meta({ tag, confidence }: { tag: string; confidence: string }) {
  return (
    <>
      <span className="pill">{TAG_LABEL[tag] ?? tag}</span>
      <span className="pill">置信 {CONF_LABEL[confidence] ?? confidence}</span>
    </>
  );
}

/* ═══════ 原文高亮 + 核对清单 ═══════ */

/**
 * 原文这一块原来只做一件事：点黄色处选中那条主张，别处跟着亮。
 * 缺的是反向——「报告到底把我的话读成了什么」，以及「哪几句它根本没碰」。
 * 所以并排放一列拆解清单：每条主张照原文顺序列出引文与定位质量，两侧互点互跳；
 * 未被任何主张引用的句子直接画在原文上（虚线），可以关掉。
 *
 * 不做的事：不新增判定、不改引文、不替定位质量做取舍——failed 的单列出来，
 * 因为「说过这句、原文却找不到」正是读者最该自己核的一类。
 * 句子切分用的是 fallacy-map 那一套，与下面逐句格子图同源，不另起一套断句。
 */
function Passage({
  text,
  items,
  sel,
  onPick,
}: {
  text: string;
  items: { id: string; span: Span | null; role?: string; quote?: string | null }[];
  sel: string | null;
  onPick: (id: string) => void;
}) {
  /*
   * 未引用句默认不标。
   *
   * 真机上是 6268 字那段：167 句里 160 句没人碰，全描成虚线等于把整段原文涂灰——
   * 「报告只碰了 7 句」这个事实很重要，但用涂灰表达，读者第一眼会以为字坏了。
   * 所以数字写在统计行里（未引用 160 句），要看具体哪几句再点开。
   */
  const [gapOn, setGapOn] = useState(false);
  const [listOn, setListOn] = useState(false);
  const sentences = useMemo(() => mapSentences(text), [text]);

  const marks = useMemo(() => {
    const valid = items
      .filter(
        (x): x is { id: string; span: Span; role?: string; quote?: string | null } =>
          !!x.span && x.span.quality !== 'failed'
      )
      .sort((a, b) => a.span.start - b.span.start);
    const out: { id: string; start: number; end: number }[] = [];
    let cursor = 0;
    for (const v of valid) {
      if (v.span.start >= cursor) {
        out.push({ id: v.id, start: v.span.start, end: v.span.end });
        cursor = v.span.end;
      }
    }
    return out;
  }, [items]);

  /* 没被任何主张碰到的句子。按区间交集算，不按「看起来像」算。 */
  const gaps = useMemo(
    () => sentences.filter((s) => !marks.some((m) => m.start < s.end && m.end > s.start)),
    [sentences, marks]
  );

  const lost = useMemo(() => items.filter((x) => !x.span || x.span.quality === 'failed'), [items]);

  const nodes = useMemo(() => {
    type Seg = { start: number; end: number; mark: boolean; id: string };
    const segs: Seg[] = [
      ...marks.map((m) => ({ start: m.start, end: m.end, mark: true, id: m.id })),
      ...(gapOn
        ? gaps.map((g) => ({ start: g.start, end: g.end, mark: false, id: `g${g.index}` }))
        : []),
    ].sort((a, b) => a.start - b.start || (a.mark === b.mark ? 0 : a.mark ? -1 : 1));

    const out: ReactNode[] = [];
    let pos = 0;
    segs.forEach((s, i) => {
      if (s.start < pos) return;
      if (s.start > pos) out.push(text.slice(pos, s.start));
      if (s.mark) {
        out.push(
          <mark
            key={`${s.id}-${i}`}
            data-claim={s.id}
            className={sel === s.id ? 'sel' : ''}
            onClick={() => onPick(s.id)}
          >
            {text.slice(s.start, s.end)}
          </mark>
        );
      } else {
        out.push(
          <span key={`g-${i}`} className="pv-gap" title="这句没有被任何主张引用">
            {text.slice(s.start, s.end)}
          </span>
        );
      }
      pos = s.end;
    });
    out.push(text.slice(pos));
    return out;
  }, [text, marks, gaps, gapOn, sel, onPick]);

  const rows = useMemo(() => {
    const ok = items.filter((x) => x.span && x.span.quality !== 'failed');
    const bad = items.filter((x) => !x.span || x.span.quality === 'failed');
    return [...ok.sort((a, b) => (a.span as Span).start - (b.span as Span).start), ...bad];
  }, [items]);

  const roleOf = (r?: string) =>
    r === 'conclusion' || r === 'C'
      ? '结论'
      : r === 'intermediate'
        ? '中间结论'
        : r === 'premise'
          ? '前提'
          : '主张';

  /* 点清单 → 原文那处滚进视野；点原文 → 清单那行滚进视野。两边都不换页。 */
  const markIds = useMemo(() => new Set(marks.map((m) => m.id)), [marks]);
  const pickRow = (id: string) => {
    onPick(id);
    const mk = document.querySelector(`.passage mark[data-claim="${id}"]`);
    if (mk && mk.scrollIntoView) {
      mk.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    /* 两条主张引同一句时，高亮只画在靠前那条上，后一条没有自己的 mark。
       这时改跳它自己的卡片——不能点了什么也不发生。 */
    jumpCard(id);
  };
  const jumpCard = (id: string) => {
    const card = document.getElementById(`cl-${id}`);
    if (card && card.scrollIntoView) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  /*
   * 为什么不是左右分栏，也不是把清单摆在原文下面。
   *
   * 第一版做「左原文、右键 330px 侧栏」：真机量出报告正文列只有 664px，
   * 分完原文剩 316px，14px 宋体一行不到二十字，读两行就得回头找下一行。
   * 第二版改成清单放在原文下面：6268 字的原文把清单顶到 5000px 开外，
   * 要点一条得先滚七屏——联动等于没有。
   *
   * 所以：统计与定位条放原文之前，清单默认收起。
   * 原文始终占满整列。
   *
   * 试过让定位条吸顶，不成立：外层 .block 有 overflow:hidden，sticky 在它里面
   * 不随滚动固定。与其写一条不起作用的样式，不如把「点了要能到」这条做实——
   * 点任一定位条，那一句会被滚进视口正中。
   */
  return (
    <div className="pv" data-crossexam>
      <div className="pv-top">
        <div className="pv-bar">
          <span className="pv-stat" data-pv-stat>
            原文 <b>{sentences.length}</b> 句 · 被引用 <b>{sentences.length - gaps.length}</b> 句 · 未引用{' '}
            <b>{gaps.length}</b> 句
          </span>
          <button
            className={`pv-toggle ${gapOn ? 'on' : ''}`}
            data-pv-gaptoggle
            onClick={() => setGapOn((v) => !v)}
          >
            {gapOn ? '✓ 原文上标出未引用句' : '标出未引用句'}
          </button>
          <button
            className={`pv-toggle ${listOn ? 'on' : ''}`}
            data-pv-listtoggle
            onClick={() => setListOn((v) => !v)}
          >
            {listOn ? '收起清单' : `展开清单（${rows.length} 条）`}
          </button>
          <span className="pv-hint" data-pv-hint>
            点编号回原文那一句
            {lost.length > 0 && <span className="pv-miss">· {lost.length} 条引文在原文里没定位到</span>}
          </span>
        </div>
        <div className="pv-chips" data-pv-chips>
          {rows.map((r) => {
            const sp = r.span;
            const failed = !sp || sp.quality === 'failed';
            const q = sp?.quality ?? 'failed';
            const full = failed ? (r.quote ?? '') : text.slice((sp as Span).start, (sp as Span).end);
            return (
              <button
                key={r.id}
                className={`pv-chip ${sel === r.id ? 'on' : ''} ${failed ? 'lost' : ''} ${
                  !markIds.has(r.id) && !failed ? 'shared' : ''
                } ${
                  q === 'exact' ? 'c-exact' : q === 'normalized' ? 'c-normalized' : q === 'fuzzy' ? 'c-fuzzy' : 'c-failed'
                }`}
                data-pv-chip={r.id}
                title={`${roleOf(r.role)}：${full || '原文里没定位到'}${
                  !markIds.has(r.id) && !failed ? '（与另一条引用同一句，点它跳到那张卡）' : ''
                }`}
                onClick={() => pickRow(r.id)}
              >
                <b>{r.id}</b>
                {roleOf(r.role)}
              </button>
            );
          })}
        </div>
      </div>

      {listOn && (
        <div className="pv-list" data-pv-list>
          {rows.map((r) => {
            const sp = r.span;
            const failed = !sp || sp.quality === 'failed';
            const q = sp?.quality ?? 'failed';
            const shown = failed ? (r.quote ?? '（没有引文）') : text.slice((sp as Span).start, (sp as Span).end);
            return (
              <div
                key={r.id}
                className={`pv-row ${sel === r.id ? 'on' : ''} ${failed ? 'lost' : ''}`}
                data-pv-row={r.id}
                title={failed ? '这句话在原文里没定位到，只能自行核对' : '点一下 → 原文那一句亮起来'}
                onClick={() => pickRow(r.id)}
              >
                <span className="pv-id">{r.id}</span>
                <span className="pv-role">{roleOf(r.role)}</span>
                <span
                  className={`pv-badge ${
                    q === 'exact'
                      ? 'q-exact'
                      : q === 'normalized'
                        ? 'q-normalized'
                        : q === 'fuzzy'
                          ? 'q-fuzzy'
                          : 'q-failed'
                  }`}
                >
                  {q === 'exact'
                    ? '逐字命中'
                    : q === 'normalized'
                      ? '归一化命中'
                      : q === 'fuzzy'
                        ? '模糊匹配'
                        : '原文找不到'}
                </span>
                <button
                  className="pv-jump"
                  title="在报告里看这条"
                  onClick={(e) => {
                    e.stopPropagation();
                    jumpCard(r.id);
                  }}
                >
                  ↗
                </button>
                <span className="pv-q">「{shown}」</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="passage">{nodes}</div>
    </div>
  );
}

/* ═══════ 主张 ═══════ */

function ClaimCard({
  claim,
  isConclusion,
  active,
  onPick,
}: {
  claim: Claim;
  isConclusion?: boolean;
  active: boolean;
  onPick: () => void;
}) {
  /* 本地把「原话」与「整理后那一句」逐字比一遍。两行本来就摆在这张卡上，
     这一小块贴在它们下面，不是报告外面另起一栏。 */
  const rw = rewriteOf(claim);
  return (
    <div
      id={`cl-${claim.id}`}
      className={`claim-card ${isConclusion ? 'concl' : ''}`}
      onClick={onPick}
      style={active ? { borderColor: 'var(--accent)', boxShadow: 'inset 0 0 0 1px var(--accent)' } : undefined}
    >
      <div className="claim-top">
        <span className={`id-badge ${claim.implicit ? 'impl' : ''}`}>{claim.id}</span>
        {claim.implicit && (
          <span className="pill mid">
            <Term k="implicit">推定</Term>
          </span>
        )}
        <span className="pill">
          <Term k="burden">{BURDEN_LABEL[claim.burden]}</Term>
        </span>
        <span className={`pill ${ACCEPT_PILL[claim.acceptability.status] ?? ''}`}>
          <Term k="acceptability">听众认不认</Term>
          {claim.acceptability.status === 'acceptable' ? '：认' : claim.acceptability.status === 'questionable' ? '：存疑' : claim.acceptability.status === 'unacceptable' ? '：不认' : '：未评'}
        </span>
      </div>

      <div className="claim-text">{claim.text}</div>

      {claim.quote && <div className="claim-quote">「{claim.quote}」</div>}

      {rw && (
        <div className="claim-rewrite" data-rewrite={rw.kind}>
          <div className="claim-rewrite-line" data-rewrite-line={rw.quoteChars}>{rw.line}</div>
          {rw.detail && (
            <div className="claim-rewrite-detail" data-rewrite-detail={rw.gone.length + rw.added.length}>
              {rw.detail}
            </div>
          )}
          <div className="claim-rewrite-note" data-rewrite-note={rw.kind}>{REWRITE_NOTE}</div>
        </div>
      )}

      {claim.implicitBasis && (
        <div className="claim-quote" style={{ borderLeftColor: 'var(--weak)', color: '#6d5320' }}>
          {claim.implicitBasis}
        </div>
      )}

      {claim.acceptability.reason && (
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 5 }}>{claim.acceptability.reason}</div>
      )}

      <div className="claim-meta">
        <Meta tag={claim.acceptability.tag} confidence={claim.acceptability.confidence} />
      </div>

      {claim.acceptability.forAudience && (
        <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 5 }}>
          对该受众：{claim.acceptability.forAudience}
        </div>
      )}
    </div>
  );
}

/* ═══════ 结论的口气 ═══════ */

/**
 * 报告里 `modalOverreach` / `modalNote` 这一对字段是**模型自评**的，
 * 而在 2026-11-08 之前，它在界面上一次都没显示过（整个 `src/renderer` 里只有假数据提到它）。
 * 这一块做两件事：把它印出来，并把**本地自己从原文读到的结果**摆在旁边。
 *
 * 两边都说，不裁决谁对：报告说越界、本地没读到，也照实写「本地只看字面」。
 * 少一句，读者就会以为两者之中有一个是错的——而这里只陈述各自看到了什么。
 */
/**
 * 骨架缺口。
 *
 * 这是报告里第一块由**本地**给出判定的地方：它不说这段话说得对不对，
 * 只说这份报告自己接上没有——原文哪句没碰、检查表哪条没答、依据有没有绕成圈。
 *
 * 为什么必须是本地算：这些数模型看不见。它不会回头数自己漏读了哪句，
 * 也不会数自己答了几条检查项；同一个模型两次跑，这两组数可以差很远。
 * 而它们全部能对着原文和报告逐字核——所以这一块错了，用户能当场抓住。
 *
 * 缺口为零时不说「没问题」：那只说明骨架接上了，判断对不对本地核不了。
 */
function SkeletonCard({ d }: { d: Diagnosis }) {
  const sk = useMemo(() => skeletonOf(d), [d]);
  return (
    <Block
      id="sec-gaps"
      title="骨架缺口"
      sub="本地数的、报告自己说的，分着摆"
      plain="软件把原文和报告摆在一起数了一遍：哪几句原文没人碰、依据之间有没有绕成圈、检查表哪几条报告说「文中没交代」。每条都标了是谁说的；这些地方说得对不对，软件算不出来。"
    >
      <div className="sk" data-skeleton>
        <p className="sk-line" data-skeleton-line={sk.gaps.length}>
          {sk.line}
        </p>
        {sk.gaps.length > 0 ? (
          <ul className="sk-gaps">
            {sk.gaps.map((g) => (
              <li
                className="sk-gap"
                data-skeleton-gap={g.kind}
                data-skeleton-from={g.from}
                key={g.kind}
              >
                <span className="sk-from" data-skeleton-from-label>
                  {GAP_FROM_LABEL[g.from]}
                </span>
                <span className="sk-note">{g.note}</span>
                {g.at.length > 0 && (
                  <span className="sk-at" data-skeleton-at={g.kind}>
                    {g.at.join('　·　')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="sk-clear" data-skeleton-clear>
            {sk.clearNote}
          </p>
        )}
        {sk.facts.length > 0 && (
          <div className="sk-facts">
            {sk.facts.map((f) => (
              <span className="sk-fact" data-skeleton-fact={f.label} key={f.label}>
                <i>{f.label}</i>
                {f.value}
              </span>
            ))}
          </div>
        )}
      </div>
    </Block>
  );
}

function ToneCard({ d }: { d: Diagnosis }) {
  const tone = useMemo(() => toneAudit(d), [d]);
  return (
    <div className={`tone-card tone-${tone.verdict}`} data-tone data-tone-verdict={tone.verdict}>
      <div className="tone-head">
        <span className="tone-title">结论的口气</span>
        <span className="tone-sub">本地拿原文那一句，逐字核报告那一句</span>
      </div>

      <div className="tone-pair">
        <div className="tone-row">
          <span className="tone-k">原文</span>
          <span className="tone-v" data-tone-source>
            {tone.sourceText ?? '（报告没给引文，原文里也没找到对应的一句）'}
          </span>
          {tone.from === 'passage' && (
            <span className="tone-flag" data-tone-from>
              本地找的
            </span>
          )}
        </div>
        <div className="tone-row">
          <span className="tone-k">报告</span>
          <span className="tone-v" data-tone-claim>
            {tone.claimText || '（报告没写结论）'}
          </span>
        </div>
      </div>

      {tone.diffs.length > 0 && (
        <ul className="tone-diffs" data-tone-diffs>
          {tone.diffs.map((x, i) => (
            <li key={`${x.kind}-${i}`} data-tone-diff={x.kind}>
              {x.note}
            </li>
          ))}
        </ul>
      )}

      <div className="tone-note" data-tone-note>
        {tone.note}
      </div>
      <div className="tone-cross" data-tone-cross>
        {crossNote(tone)}
      </div>

      {tone.reported &&
        (tone.reportedNote ? (
          <div className="tone-rep" data-tone-rep>
            报告给的理由：{tone.reportedNote}
          </div>
        ) : (
          <div className="tone-rep" data-tone-rep>
            报告说越界了，但没写理由。
          </div>
        ))}

      <div className="tone-fine">这一栏不动报告。本地只比字面上的词，不比意思；读不出来就说读不出来。</div>
    </div>
  );
}

/* ═══════ 检查表 ═══════ */

function CheckTable({ checks, sel }: { checks: CheckItem[]; sel: string | null }) {
  if (!checks.length) {
    return (
      <p className="hint">
        本次没有产生检查项。这副透镜的判定形态是识别而非逐项检验时，这是正常状态——结果在上一栏。
      </p>
    );
  }
  return (
    <table className="grid">
      <caption className="grid-note">
        每一问守的，都是这条推理的担保所依赖的一环——所以它是「合法的攻击点」，不是核对清单上的一格。
        答「未回答」不是漏答：它表示文中确实没交代这一环。
      </caption>
      <thead>
        <tr>
          <th style={{ width: 78 }}>编号</th>
          <th style={{ width: 190 }}>检查项</th>
          <th style={{ width: 66 }}>回答</th>
          <th>依据</th>
          <th style={{ width: 130 }}>守着哪一处</th>
        </tr>
      </thead>
      <tbody>
        {checks.map((c) => (
          <tr key={c.id} className={sel === `#${c.id}` ? 'hit' : undefined}>
            <td className="id">{c.id}</td>
            <td className="q">
              {c.label}
              {c.meta && (
                <span className="pill" style={{ marginLeft: 5 }}>
                  <Term k="meta">元</Term>
                </span>
              )}
            </td>
            <td>
              <span className={`st ${ANSWER_CLASS[c.answer]}`}>{ANSWER_LABEL[c.answer]}</span>
            </td>
            <td className="basis">
              {c.basis || '—'}
              {c.question && (
                <div style={{ color: 'var(--ink-3)', fontSize: 11.5, marginTop: 2 }}>问：{c.question}</div>
              )}
              <ObjectBtn field="check" refId={c.id} refLabel={c.label} excerpt={c.basis} compact />
            </td>
            <td className="basis">{c.guards || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ═══════ 透镜专属面板 ═══════ */

const FAMILY_LABEL: Record<string, string> = {
  pragmatic: '实效',
  causal: '因果',
  source: '信息源',
  comparison: '比较',
  mixed: '混合',
  none: '未识别',
};

const RULE_STAGE_LABEL: Record<string, string> = {
  confrontation: '冲突阶段',
  opening: '开场阶段',
  argumentation: '论证阶段',
  concluding: '结论阶段',
  unknown: '阶段不明',
};

function LensPanel({ d }: { d: Diagnosis }) {
  const l = d.lens;

  if (l.kind === 'walton') {
    return (
      <Block
        id="sec-lens"
        title="型式定位"
        sub="找族 → 认型式 → 拆骨架"
        plain="先把这段话归到一类套路（靠后果、靠因果、靠谁说的、靠比较），再落到具体套路，最后把这个套路的骨架写成一行字。归错类，后面那几个问题会全部问偏。"
      >
        <WaltonFamilyPath l={l} />
        <div className="kv">
          <span className="k">
            <Term k="family">族</Term>
          </span>
          <span className="v">
            {FAMILY_LABEL[l.family] ?? l.family}
            {l.familyBasis ? ` — ${l.familyBasis}` : ''}
          </span>
          <span className="k">
            <Term k="scheme">型式</Term>
          </span>
          <span className="v mono">
            {l.schemeId === 'none' ? '未识别（写 none 是正常输出）' : `${l.schemeName}（${l.schemeId}）`}
          </span>
          <span className="k">
            <Term k="skeleton">骨架</Term>
          </span>
          <span className="v mono">{l.skeleton || '—'}</span>
          {l.alternativeFamily && (
            <>
              <span className="k">另一可能</span>
              <span className="v">
                {FAMILY_LABEL[l.alternativeFamily] ?? l.alternativeFamily}
                {l.alternativeNote ? ` — ${l.alternativeNote}` : ''}
              </span>
            </>
          )}
        </div>
      </Block>
    );
  }

  if (l.kind === 'pragma') {
    return (
      <Block
        id="sec-lens"
        title="讨论程序"
        sub="哪个阶段 × 谁把话说死了"
        plain="这套不看某句话对不对，看这场讨论还能不能谈下去：现在到哪个阶段了，是谁把路堵住的。"
      >
        <div className="kv">
          <span className="k">是否以解决分歧为目标</span>
          <span className="v">
            {l.aimedAtResolution ? '是' : '否'}
            {l.aimedBasis ? ` — ${l.aimedBasis}` : ''}
          </span>
          <span className="k">阶段</span>
          <span className="v">
            {RULE_STAGE_LABEL[d.context.stage] ?? d.context.stage}
            {l.stageBasis ? ` — ${l.stageBasis}` : ''}
          </span>
          <span className="k">谁妨碍了分歧解决</span>
          <span className="v">{BURDEN_LABEL[l.blockedBy] ?? l.blockedBy}</span>
        </div>
      </Block>
    );
  }

  if (l.kind === 'ars') {
    return (
      <Block
        id="sec-lens"
        title="三标准"
        sub="你认不认 · 有没有关系 · 够不够"
        plain="三个问题、三处缺口：是他说的那句你不认，还是那句跟结论没关系，还是加起来不够。缺口在哪，补法就不同。"
      >
        <ArsGapMap d={d} l={l} />
        <div className="kv">
          <span className="k">论证负担</span>
          <span className="v">{l.burdenStandard || '未写明'}</span>
          <span className="k">缺口位置</span>
          <span className="v">
            {{
              premise: '某个前提',
              link: '前提与结论之间',
              'missing-premise': '缺一条未说出的前提',
              none: '未发现缺口',
            }[l.gapAt]}
          </span>
          <span className="k">充分性</span>
          <span className="v">{l.sufficiencyNote || '—'}</span>
        </div>
      </Block>
    );
  }

  if (l.kind === 'pta') {
    return (
      <Block
        id="sec-lens"
        title="三特征定位"
        sub="绕没绕一层 · 在比什么 · 说的是哪种话"
        plain="三个特征分开给，再合成一个「型」。允许特征都定了、型名给不出——这一栏比型名本身有用，因为它是你不同意我的入口。"
      >
        <PtaLocator l={l} />
        <div className="kv">
          <span className="k">型</span>
          <span className="v mono">{l.ptaType ?? '未给出（合法）'}</span>
          {l.ptaName && (
            <>
              <span className="k">通行名</span>
              <span className="v">{l.ptaName}</span>
            </>
          )}
          {l.waltonId && (
            <>
              <span className="k">对应型式</span>
              <span className="v mono">{l.waltonId}</span>
            </>
          )}
        </div>
      </Block>
    );
  }

  if (l.kind === 'toulmin') {
    const wt: Record<string, string> = {
      generalization: '概括',
      causal: '因果',
      definitional: '定义',
      authority: '权威',
      analogy: '类比',
      value: '价值',
      none: '未识别',
    };
    return (
      <Block
        id="sec-lens"
        title="骨架布局"
        sub="主张 · 理由 · 担保 · 支援 · 限定 · 例外"
        plain="六个零件摆开：他要你信什么、他摆了什么、凭什么能推出、这个「凭什么」有没有靠山、话说得多满、他自己承认哪些例外。最常见的毛病是第三个零件根本没出现。"
      >
        <ToulminLayout d={d} l={l} />
        <div className="kv">
          <span className="k">
            <Term k="grounds">理由</Term>
          </span>
          <span className="v">{l.grounds.length ? l.grounds.join('；') : '—'}</span>
          <span className="k">
            <Term k="warrant">担保</Term>
          </span>
          <span className="v">
            {l.warrant ?? '未给出'}
            {l.warrant && (
              <span className={`pill ${l.warrantStated ? 'ok' : 'mid'}`} style={{ marginLeft: 6 }}>
                {l.warrantStated ? '原文所述' : '推定补出'}
              </span>
            )}
          </span>
          <span className="k">担保类型</span>
          <span className="v">{wt[l.warrantType]}</span>
          <span className="k">
            <Term k="backing">支援</Term>
          </span>
          <span className="v">{l.backing ?? '缺位（不等于论证无效）'}</span>
          <span className="k">
            <Term k="qualifier">限定</Term>
          </span>
          <span className="v">{l.qualifier ?? '未写'}</span>
          <span className="k">
            <Term k="rebuttal">例外</Term>
          </span>
          <span className="v">{l.rebuttals.length ? l.rebuttals.join('；') : '未写'}</span>
          <span className="k">跳跃位置</span>
          <span className="v">{l.gapBetween || '—'}</span>
        </div>
      </Block>
    );
  }

  return (
    <Block
      id="sec-lens"
      title="名录对照"
      sub="只给候选，不给结论"
      plain="教材里可能对得上的名字，最多三条。这副透镜不给判决，只给候选——因为同一个地方往往能对上好几个名字。"
    >
      <div className="kv" style={{ marginBottom: l.whatItMisses ? 10 : 0 }}>
        <span className="k">候选数</span>
        <span className="v">{l.candidates.length} 条（上限 3）</span>
      </div>
      {l.whatItMisses && (
        <div className="banner warn" style={{ marginBottom: 0 }}>
          <div>
            <b>名录法在此处漏掉了什么</b>
            {l.whatItMisses}
          </div>
        </div>
      )}
    </Block>
  );
}

/* ═══════ 命名候选 ═══════ */

/**
 * 谬误落点图：查谬误模式的第五张图。
 *
 * 前四张图各解决一个「看不懂」，这张解决的是命名卡的第一个盲点：
 * 「事后归因」三个字看得懂，但它指的那句话在原文的第几句，文字引文要读者
 * 自己拿眼睛去对——句子一多，对的成本就是怀疑发酵的成本。
 * 图把这件事一眼摆出来：哪几格着了色、下面挂着哪个名字。
 *
 * 与前四张同一底线：**定位失败的不画**。span 质量是 failed 的命名留在图下
 * 明说，绝不为图面完整猜一个位置——猜错的格子比缺一格害处大得多。
 */
function FallacyMap({
  d,
  sel,
  onPick,
}: {
  d: Diagnosis;
  sel: string | null;
  onPick: (id: string | null) => void;
}) {
  const sentences = useMemo(() => mapSentences(d.passage), [d.passage]);
  const hits = useMemo(() => fallacyHits(d.passage, d.labels), [d.passage, d.labels]);
  const byLabel = useMemo(() => new Map(hits.map((h) => [h.labelId, h])), [hits]);
  const labelById = useMemo(() => new Map(d.labels.map((l) => [l.id, l])), [d.labels]);

  /** 句子 → 挂在这句上的命名（按 span 交集算出的，不是重新猜的）。 */
  const onSentence = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const h of hits) {
      if (!h.at) continue;
      for (const i of h.at) {
        const list = m.get(i) ?? [];
        list.push(h.labelId);
        m.set(i, list);
      }
    }
    return m;
  }, [hits]);

  /** 没画上去的：定位失败或模型没给位置。图可以缺格子，理由不能缺。 */
  const unpainted = hits.filter((h) => !h.at);
  if (!sentences.length) return null;

  /*
   * 定位质量照样说。
   *
   * 精确匹配和模糊匹配画在同一个格子里，视觉上毫无区别——而它们的可信度不同：
   * fuzzy 是「找到一句很像的」，用户若拿它去质问原作者，句子可能不是原句。
   * 不区分，等于把推测画成事实。
   */
  const qLabel = (id: string) => {
    const q = labelById.get(id)?.span?.quality;
    return q === 'normalized'
      ? '归一化后匹配'
      : q === 'fuzzy'
        ? '模糊匹配（找到一句很像的，未必是原句）'
        : '精确定位';
  };

  return (
    <div className="fmap">
      <div className="fmap-flow">
        {sentences.map((s) => {
          const hitIds = onSentence.get(s.index) ?? [];
          const anyHit = hitIds.length > 0;
          return (
            <span
              key={s.index}
              className={`fmap-s ${anyHit ? 'fmap-s-hit' : ''}`}
              title={
                anyHit
                  ? `${s.text}\n\n挂着：${hitIds.map((id) => labelById.get(id)?.name ?? id).join('、')}\n定位方式：${hitIds.map(qLabel).join('、')}`
                  : s.text
              }
            >
              {s.text}
              {hitIds.map((id) => {
                const l = labelById.get(id);
                if (!l) return null;
                return (
                  <button
                    key={id}
                    className={`fmap-chip ${sel === id ? 'on' : ''}`}
                    onClick={() => onPick(sel === id ? null : id)}
                  >
                    {l.name}
                    {l.landsOnCheck ? ` → ${l.landsOnCheck}` : ''}
                  </button>
                );
              })}
            </span>
          );
        })}
      </div>
      <div className="legend">
        <span className="legend-item">
          <i className="l-dot" style={{ background: 'var(--weak)' }} />
          有谬误候选挂着的句子
        </span>
        <span className="legend-item">点名字 → 下面的命名卡亮边框</span>
      </div>
      <p className="diagram-note">
        读法：每个格子是原文的一句，照原文顺序排。着色格下面挂的名单，就是报告认为问题落在那句上；
        名字后面的 CQ 编号是它挂到的检查关。这份对应由 span 定位算出，不靠人眼对引文；
        句子悬停会写明这条是精确定位还是模糊匹配——两者画在同一个格子里，可信度却不同。
        {unpainted.length > 0 && (
          <>
            {' '}
            <b>有 {unpainted.length} 条没画上去</b>
            （
            {unpainted
              .map((h) => {
                const l = labelById.get(h.labelId);
                const why = h.reason === 'failed' ? '引文在原文里没定位到' : '报告没给出位置';
                return `${l?.name ?? h.labelId}：${why}`;
              })
              .join('；')}
            ）——宁缺毋错，它们只以引文形式出现在下面的卡里。
          </>
        )}
      </p>
    </div>
  );
}

function LabelCard({ c, active, onPick }: { c: LabelCandidate; active?: boolean; onPick?: () => void }) {
  /*
   * 原文位置放在名字正下方，而不是塞进 dl 的一行。
   *
   * 因为它是这条命名的凭据，不是它的一项属性：读者看到「事后归因」的第一反应是
   * 「我哪句话这样了」，答案必须紧跟着出现。塞进表格里，他要在四行之后才找到，
   * 而找的过程正是「这条可能不成立」的怀疑发酵的过程——怀疑是对的，但应该由引文来证实或打消。
   *
   * 定位失败时明说，不装作有位置：span 是定位器真跑出来的结果，
   * quality 为 failed 就是「说过这句话，但原文里找不到」。
   */
  const locQuote = typeof c.quote === 'string' ? c.quote.trim() : '';
  const missed = Boolean(locQuote) && c.span?.quality === 'failed';
  return (
    <div className={`cand ${active ? 'cand-on' : ''}`}>
      <div className="cand-head">
        {/*
          名字本身是按钮，用来和落点图双向对位。
          单向联动（点图上胶囊 → 卡亮）只解决一半：用户更常见的动作是从卡出发——
          读完四样代价，回头想知道「那这句在原文第几句」。给不了这个，图就只是装饰。
          没有图时不给按钮：一个点了没反应的按钮比没有按钮更糟。
        */}
        {onPick ? (
          <button className="nm nm-btn" onClick={onPick} title="在落点图上找到这一条">
            {c.name}
          </button>
        ) : (
          <span className="nm">{c.name}</span>
        )}
        <span className="en">{c.nameEn}</span>
        <Meta tag={c.tag} confidence={c.confidence} />
        <div className="spacer" />
        <ObjectBtn field="label" refId={c.id} refLabel={c.name} excerpt={c.condition} compact />
      </div>
      {locQuote && (
        <div className="cand-quote">
          「{locQuote}」
          {missed && <span className="cq-miss">（这句在原文里没定位到，请自行核对）</span>}
        </div>
      )}
      <dl>
        <dt>
          <Term k="condition">成立条件</Term>
        </dt>
        <dd>{c.condition}</dd>
        <dt>何时其实合法</dt>
        <dd>{c.whenLegitimate}</dd>
        <dt>最可能错在</dt>
        <dd>{c.riskOfError}</dd>
        {c.landsOnCheck && (
          <>
            <dt>倒在</dt>
            <dd style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>{c.landsOnCheck}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

/* ═══════ 各模式的措辞 ═══════ */

/**
 * 四种模式下各区块的措辞。
 *
 * 为什么集中在一张表里，而不是散在各处写三元：
 * 散着写的结果是加第五个模式时，改了三处漏了第四处，
 * 而漏掉的那处会安静地显示成诊断版的措辞——报告照样好看，只是主语错了。
 */
const MODE_SECTIONS: Record<
  AnalysisMode,
  {
    bannerClass: string;
    verdictTitle: string;
    verdictSub: (tName: string, scale: string) => string;
    verdictPlain: string;
    legitTitle: string;
    legitSub: string;
    legitPlain: string;
    legitEmpty: string;
    labelTitle: string;
    labelSub: string;
    labelPlain: string;
    /** 命名栏空着时说什么。只有查谬误模式用得上——其余模式下空栏整块不出现。 */
    labelEmpty: string;
    refTitle: string;
    refSub: (n: number) => string;
    refPlain: string;
    refEmpty: string;
    repairSub: string;
    repairPlain: string;
  }
> = {
  diagnose: {
    bannerClass: '',
    verdictTitle: '判读',
    verdictSub: (tName, scale) => `${tName}｜刻度：${scale}`,
    verdictPlain:
      '先说结论：这段论证站不站得住；以及这个结论只伤到他的论证，还是连他要你信的那句话一起否定了。这两件事差得很远。',
    legitTitle: '此处合法',
    legitSub: '清单法缺的那一栏',
    legitPlain: '他做得对的地方。一个只会挑错的分析没法用——它会把对方做对的地方也算成错。',
    legitEmpty: '本次未找到「此处合法」的位置。可能确实没有，也可能没认真找——后者是清单法的老毛病。',
    labelTitle: '命名候选',
    labelSub: '末端注释，不是判定；三条门槛齐备才显示',
    labelPlain:
      '教材里可能对得上的名字。给名字是有代价的，所以每条都附了「什么时候其实合法」和「这条判断最可能错在哪」。',
    labelEmpty: '',
    refTitle: '反驳',
    refSub: (n) => `${n} 条，均带对方最强回击`,
    refPlain:
      '可以直接拿去说的话。每条都先替对方想了最能打的回击，并写了我方怎么接——不然你拿着它去，一句话就被人打回。',
    refEmpty: '本次未生成反驳。',
    repairSub: '判完必须回答「怎么补」',
    repairPlain: '怎么把这段话补成站得住的版本。只判不补，等于把人拦在门口不告诉他往哪走。',
  },
  redteam: {
    bannerClass: 'rt-banner',
    verdictTitle: '对手会打哪里',
    verdictSub: (tName) => `${tName}｜按杀伤力排序`,
    verdictPlain:
      '这一档不是「你的论证有多好」，是「对手最容易从哪一层打穿」。档位越差，说明可攻击面越大。',
    legitTitle: '打不动的地方',
    legitSub: '别在这些地方浪费力气',
    legitPlain:
      '对手攻不破的位置。红队报告里这一栏不是安慰，是告诉你哪些力气不必花——攻这里会被挡回来。',
    legitEmpty:
      '没找到攻不破的位置。也可能没认真找——后者更常见，而且更危险：你会按这份报告去攻一个其实攻不动的地方。',
    labelTitle: '命名候选',
    labelSub: '末端注释，不是判定',
    labelPlain:
      '打完之后可能被叫成的名字。红队模式下这一栏是给你做预判用的：对手大概率会用这个词，你最好先想好怎么接。',
    labelEmpty: '',
    refTitle: '他会怎么说',
    refSub: (n) => `${n} 条，按杀伤力排序`,
    refPlain:
      '对手可能说出口的原话，按杀伤力从上往下排。每条都附你怎么接——只列攻击不给接法，等于把人推出去挨打。',
    refEmpty: '这次没找到明确的攻击路线。',
    repairSub: '在对手打进来之前先补上',
    repairPlain:
      '按上面的攻击路线倒推：先补哪一处，杀伤力掉得最多。补完记得再跑一次——补没补上，要看下一份报告。',
  },
  fallacy: {
    bannerClass: 'fa-banner',
    verdictTitle: '这一份不判',
    verdictSub: (tName) => `${tName}｜查谬误模式只给名字与位置`,
    verdictPlain:
      '查谬误模式不给档位，这一栏固定是「判不了」。指出两三处推理没撑住，不等于这段话的结论是错的——前者只说明这一步断了，后者要另找理由。真要判这段话站不站得住，切回诊断模式。',
    legitTitle: '看着像谬误、其实合法',
    legitSub: '这一栏是本模式的解药',
    legitPlain:
      '清单法最深的病：列出来的几条里，有一条其实是对方做得对的地方，你也不改判，因为清单没有这一栏。引用专家、引用民意、反问，这三样在特定条件下都是正当的；分不清条件，名字就是冤枉。',
    legitEmpty:
      '本次没有标出「其实合法」的位置。可能确实没有，也可能没认真找——在这个模式里，后者更常见，也更伤人：被冤枉的那一处，恰恰是他做得最对的地方。',
    labelTitle: '对得上的名字',
    labelSub: '每条都指得出原文哪一句，并附三条代价',
    labelPlain:
      '这就是你要的那个词。但每个名字都附了原文位置、成立条件、什么时候其实合法、最可能错在哪——只给名字的清单，会让你拿着一条错的名称去对质，输得比不开口更难看。',
    labelEmpty:
      '本页没有显示任何名字。可能是这三种情况之一：这段文本本来就不在论证的层面上（不必再找）、名字都对不上原文（这一份是干净的）、或者模型没判断出来（换一副透镜再试一次）。下面「边界」一栏写了是哪一种；若名字找到过但被程序丢掉，那里也会说明丢的是哪一条、缺的是哪一样。',
    refTitle: '反驳',
    refSub: (n) => `${n} 条`,
    refPlain: '查谬误模式不给攻击路线。要攻击路线，切到红队模式。',
    refEmpty: '',
    repairSub: '名字之外还剩什么',
    repairPlain:
      '缺哪条前提、换一副透镜这些名字会变成什么样。名字本身不告诉你下一步做什么——它只告诉你这一处像什么，补哪儿还得看这一栏。',
  },
  reconstruct: {
    bannerClass: 'rc-banner',
    verdictTitle: '这一份不判',
    verdictSub: (tName) => `${tName}｜重构模式只画结构`,
    verdictPlain:
      '重构模式不给档位，这一栏固定是「判不了」。强弱不写在这里，写在下面的结构里：几条支撑链、哪一步依赖未说出的假定。',
    legitTitle: '容易被看错的地方',
    legitSub: '看着像漏洞、其实不是',
    legitPlain:
      '看着像循环、其实是分两步；看着像省略、其实是双方共有的前提。这一栏是给下一个读这份图的人看的。',
    legitEmpty: '没有标注容易被看错的地方。',
    labelTitle: '命名候选',
    labelSub: '本模式不命名',
    labelPlain: '重构模式不命名：说出「这是循环论证」的那一刻，就已经判过了，而这一份只描述结构。',
    labelEmpty: '',
    refTitle: '反驳',
    refSub: (n) => `${n} 条`,
    refPlain: '重构模式不给攻击路线。',
    refEmpty: '',
    repairSub: '结构缺的那一条',
    repairPlain:
      '缺哪条前提、换一副透镜这张图会变成什么样。重构的价值不在图好看，在于它告诉你「改哪里有用」。',
  },
  interrogate: {
    bannerClass: 'q-banner',
    verdictTitle: '这一份不判',
    verdictSub: (tName) => `${tName}｜提问模式只给问题`,
    verdictPlain:
      '提问模式不给档位，这一栏固定是「判不了」。你不是在等一个结论，你是在等对方回答——结论要在他答完之后才下得了。',
    legitTitle: '别问这些',
    legitSub: '问出口就输的位置',
    legitPlain:
      '身份、动机、以及「你能证明不存在……」式的问句。这几类问出去，位置就反了：前者变成人身之争，后者是错置证明责任。',
    legitEmpty: '没有标注不该问的位置。',
    labelTitle: '命名候选',
    labelSub: '本模式不命名',
    labelPlain: '提问模式不命名：给对方扣一个名字，他就只会回答这个名字，不再回答你的问题。',
    labelEmpty: '',
    refTitle: '你可以问什么',
    refSub: (n) => `${n} 个问题，按「答不上来的概率 × 答上来的收益」排序`,
    refPlain:
      '每一问都配了三段：可以直接发出去的原话、他最可能怎么答、他答完之后你接什么。只有问题的清单用一次就作废——他答了第一句你就不知道该说什么了。',
    refEmpty: '这次没找到可问的角度。也许这段话根本没有论证结构，那就问不动它。',
    repairSub: '问完之后的下一步',
    repairPlain:
      '缺哪条前提、换一副透镜会问出什么不同的问题。把这一栏留着，是因为对方答完之后你还要往下走。',
  },
};

/**
 * 专题分析的一行。
 *
 * 未命中不摆问题：问题挂在没有信号的位置上，用两次就成了新的清单法——
 * 「反正每个专题都要过一遍」。命中的才展开问法；未命中的留依据。
 * 「本次已问过」对得上逐关检查就点名，对不上就明说没问过——不装作覆盖了。
 */
/**
 * 边界栏左侧的主张编号。可点时跳到理论库对应条目。
 * 抽出来是因为边界栏现在分三组渲染，同一个编号要出现三次不同位置，内联写会抄三遍。
 */
function LimitId({ id, onOpen }: { id: string; onOpen?: (id: string) => void }) {
  if (!onOpen) return <span className="lim-id">{id}</span>;
  return (
    <button
      className="lim-id lim-id-btn"
      onClick={() => onOpen(id)}
      title="打开理论主张库：看这一条的出处、落点与反对意见"
    >
      {id}
    </button>
  );
}

function TopicRow({ t }: { t: TopicHit }) {
  return (
    <div className={`tp-row ${t.hit ? 'tp-hit' : 'tp-miss'}`}>
      <div className="tp-head">
        <span className="tp-name">{t.name}</span>
        <span className={`tp-flag ${t.hit ? 'on' : ''}`}>{t.hit ? '命中' : '未命中'}</span>
        <span className="tp-claims" title="依据的理论主张，点开「理论」可看全文">
          {t.claimIds.join(' · ')}
        </span>
      </div>
      <div className="tp-basis">{t.basis}</div>
      {t.hit && (
        <>
          <ul className="tp-asks">
            {t.asks.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
          <div className="tp-asked">
            {t.askedInChecks.length
              ? `本次逐关检查已问过：${t.askedInChecks.join('、')}`
              : '本次逐关检查没有问过这些——这是这副透镜的盲区，不是已覆盖。'}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 学术分析：体裁、待核清单、规范清单、反驳顺序。
 *
 * 这一栏的排场是按「哪些本工具做不到」定的，不是按做得到的那部分定的：
 * 三条完全不能代劳的规范（引用忠实、数据可追、方法匹配）与其他条目同字号、
 * 同位置，只换一个徽章。做不到的事排成小字脚注，等于暗示它不重要，
 * 而学术写作里最贵的错误恰好都在这三条里。
 *
 * 勾选状态只活在这个组件里：刷新即清，不存盘。界面写明这一点，
 * 因为一个看起来会保存、实际不保存的勾选框，比没有勾选框更坏。
 */
const BY_TAG: Record<ByTool, string> = BY_TOOL_LABEL;
const ATK_TAG: Record<'high' | 'low', string> = {
  high: '值得先攻',
  low: '难有结果',
};

function AcademicBlock({ a, onOpenClaim }: { a: AcademicView; onOpenClaim?: (id: string) => void }) {
  const [done, setDone] = useState<string[]>([]);
  const toggle = (id: string) =>
    setDone((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="ac">
      <div className="ac-genre">
        <div className="ac-g-head">
          <span className="ac-g-name">{a.genre.label}</span>
          <span className="ac-g-note">按字面特征判，不是体裁鉴定</span>
        </div>
        <div className="ac-g-basis">
          {a.genre.basis}
          {a.genre.tie ? ` ${a.genre.tie}` : ''}
        </div>
        <div className="ac-g-caveat">{a.genre.caveat}</div>
      </div>

      <div className="ac-sec">
        <div className="ac-sec-t">
          需要你回原文核的位置
          <span className="ac-sec-n">{a.traces.length} 处</span>
        </div>
        <div className="ac-note">{a.traceNote}</div>
        {a.traces.length > 0 && (
          <ul className="ac-traces">
            {a.traces.map((t, i) => (
              <li key={`${t.kind}-${i}`} className="ac-trace">
                <span className="ac-kind">{t.label}</span>
                <div>
                  <div className="ac-snip">{t.snippet}</div>
                  <div className="ac-ask">{t.ask}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="ac-sec">
        <div className="ac-sec-t">
          学术规范清单
          <span className="ac-sec-n">勾选只是你自己的记号，刷新即清，不存盘</span>
        </div>
        <ul className="ac-norms">
          {a.norms.map((n) => {
            const on = done.includes(n.id);
            return (
              <li key={n.id} className={`ac-norm ${on ? 'on' : ''}`}>
                <button
                  type="button"
                  className="ac-box"
                  onClick={() => toggle(n.id)}
                  aria-label={on ? '取消标记' : '标记为已查'}
                  aria-pressed={on}
                >
                  {on ? '✓' : ''}
                </button>
                <div className="ac-norm-b">
                  <div className="ac-norm-h">
                    <span className="ac-norm-ask">{n.ask}</span>
                    <span className={`ac-by ac-by-${n.byTool}`}>{BY_TAG[n.byTool]}</span>
                  </div>
                  <div className="ac-why">{n.why}</div>
                  <div className="ac-meta">
                    {n.claimIds.length > 0 && (
                      <span className="ac-ids">
                        {n.claimIds.map((id, i) => (
                          <span key={id}>
                            {i > 0 && ' · '}
                            {onOpenClaim ? (
                              <button type="button" className="lim-id-btn" onClick={() => onOpenClaim(id)}>
                                {id}
                              </button>
                            ) : (
                              id
                            )}
                          </span>
                        ))}
                        <span className="ac-sep">｜</span>
                      </span>
                    )}
                    <span className="ac-cov">
                      {n.covered
                        ? `本次已问：${n.covered}`
                        : n.byTool === 'no'
                          ? '本次没问，也问不了'
                          : '本次逐关检查里没有对应的一条'}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="ac-sec">
        <div className="ac-sec-t">要反驳，先从哪一层下手</div>
        <div className="ac-note">
          顺序不是随意排的：主张与事实这两层人各有之，争起来只是两种看法对撞；
          推理规则是「从事实走到结论的那座桥」，桥断了结论就落不下来，而这一步能指到具体位置。
        </div>
        <ol className="ac-atk">
          {a.attack.map((t, i) => (
            <li key={t.tier} className={`ac-atk-i ac-atk-${t.contested}`}>
              <span className="ac-atk-n">{i + 1}</span>
              <div>
                <div className="ac-atk-h">
                  <span className="ac-atk-l">{t.label}</span>
                  <span className="ac-atk-tag">{ATK_TAG[t.contested]}</span>
                </div>
                <div className="ac-atk-target">指到：{t.target}</div>
                <div className="ac-why">{t.why}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="ac-div">{a.division}</div>
    </div>
  );
}

export function DiagnosisView({
  d,
  onLoadRepair,
  onOpenClaim,
  initialReread,
  initialRescale,
  initialPairs,
  initialConditions,
  initialItems,
  initialViews,
  initialPicked,
  initialTerms,
  initialTermsWords,
}: {
  d: Diagnosis;
  /**
   * 把「原文 + 补上的前提」填回输入框。
   * 为什么不直接跑：修补后那一栏是「P1… P2… ∴ C」这种重构记号，不是成段的话，
   * 拿它当原文去分析是错的；更重要的是，跑一次要花钱，不能在你没看见文本时就花掉。
   * 所以这里只负责把候选版摆到你面前，跑不跑由你按「分析」决定。
   */
  onLoadRepair?: () => void;
  /**
   * 打开理论主张库并定位到某一条。
   * 边界栏每行挂一个主张 id，那不是为了显得有依据——点了要真能跳到那条的
   * 出处与反对意见。点不动的话，那行 id 就是装饰。
   */
  onOpenClaim?: (claimId: string) => void;
  /** 预览页专用：直接落在「回到原文」那一屏，好让这一屏有截图入口。真应用只能靠用户点开。 */
  initialReread?: boolean;
  /** 预览页专用：直接落在「换个尺度读」那一屏，并预填演示词对。真应用里词由用户自己填。 */
  initialRescale?: boolean;
  initialPairs?: RescalePair[];
  /** 预览页专用：直接落在「自己列成立条件」那一屏，并预填演示条件。真应用里全由用户自己填。 */
  initialConditions?: boolean;
  initialItems?: ConditionInput[];
  /** 预览页专用：把「挑图」面板先展开，好让这个面板有截图入口。 */
  initialViews?: boolean;
  /**
   * 预览页专用：直接指定这次显示哪几张。
   *
   * 为什么需要：新增的两张图默认关着，光有面板入口拍不到图本身。
   * 而「默认关」这个取舍不该为了截图而改——真应用里它仍然是关的。
   */
  initialPicked?: ViewId[];
  /** 预览页专用：展开「这一圈的词」并预填演示词，好让默认收起的那一栏有截图入口。 */
  initialTerms?: boolean;
  initialTermsWords?: string;
}) {
  const [sel, setSel] = useState<string | null>(null);
  /**
   * 这次看哪几张图。
   *
   * `wanted` 存的是**意图**（本机记忆），`picked` 才是这次实际显示的：
   * 意图里可能有一张这份报告画不出（没有反驳），它不该在显示时占位，
   * 但也不该从记忆里删掉——下一份有反驳的报告应当恢复它。
   */
  const [wanted, setWanted] = useState<ViewId[]>(() => initialPicked ?? sanitizeViews(readStoredViews()));
  const views = useMemo(() => viewsOf(d), [d]);
  const picked = useMemo(() => normalizeViews(wanted, views), [wanted, views]);
  /** 就地把一张图打开（那一栏底下那个按钮用）。顺序按 VIEW_ORDER，与挑图面板一致。 */
  const turnOn = (id: ViewId) => {
    const next = VIEW_ORDER.filter((x) => x === id || wanted.includes(x));
    setWanted(next);
    writeStoredViews(next);
  };
  /** 落点图选中的命名。和结构图的 sel 分开：一个选主张，一个选谬误，别共用。 */
  const [labelSel, setLabelSel] = useState<string | null>(null);
  /**
   * 「回到原文重读」是**用户发起的一次操作**，不是报告里多出来的一个板块。
   * 默认关着：把原文摆到每个人面前，等于替他决定该先读什么。
   */
  const [reread, setReread] = useState(!!initialReread);
  /* 同上：换尺度也是一次用户发起的操作，词由用户填，软件不预设「该换什么」。 */
  const [rescale, setRescale] = useState(!!initialRescale);
  /* 第三屏：连报告文字都不显示。条件、依据与结论全由人写，默认当然也是关着的。 */
  const [conditions, setConditions] = useState(!!initialConditions);
  const view = useMemo(() => rereadOf(d), [d]);
  const t = THEORY_BY_ID[d.theory];

  const allClaims: Claim[] = [d.conclusion, ...d.premises, ...d.intermediate];

  /**
   * 四种模式在界面上改的是**主语与那一份有没有判定**，不是标准。
   *
   * 标准换了，报告就不可比了——修订对照必须能回答「改完好没好」，
   * 而它的前提是两次用的是同一把尺子。所以这里只改措辞。
   */
  const mode = d.mode;
  const SEC = MODE_SECTIONS[mode];

  /**
   * 这一份碰到了哪些理论争议。全部由已有字段推出，不调模型、不花钱。
   * 每个板块标题上的「争议 N」就是按这里数出来的：同一份数据，两处显示。
   */
  const hits = useMemo(() => disputesIn(d), [d]);
  const at = (sectionId: string): DisputeId[] =>
    hits.filter((h) => DISPUTE_SECTION[h.id].id === sectionId).map((h) => h.id);

  /**
   * 专题分析：这段话落在哪类论证上，那类论证在文献里公认要问什么。
   * 全部由已有字段本地推导——不调模型、不加 token，两次运行结果一致（T7-07）。
   */
  const topics = useMemo(() => topicsOf(d), [d]);
  const limits = useMemo(() => limitsOf(d), [d]);
  /**
   * 学术分析：体裁、待核清单、规范清单、反驳顺序。
   * 同样全本地推导——它不含任何模型判断，所以可以随手重算。
   */
  const academic = useMemo(() => academicOf(d), [d]);
  /**
   * 下一步：每一处空着的地方要填什么形状的东西。
   * 同样全本地推导——它不含模型判断，只把已落盘的检查项重新组织一遍。
   */
  const rx = useMemo(() => prescriptionsOf(d), [d]);
  /*
   * 画布工程里到底有几个节点、几条线，在这里先算出来。导出的那一刻再算就晚了：
   * 用户点按钮之前就该知道「这次会交出去多少」——尤其是那几句「有几条没画出来」，
   * 它们是必须说出来、不能静默丢掉的。
   */
  const prgLine = useMemo(() => graphSummary(graphOf(d)), [d]);
  /**
   * 命题账：每条主张该由什么来定（证据 / 现在没证据 / 体系内 / 不由论证裁定）。
   * 全本地推导，只读报告字段，不改任何判定——所以它和判读永远不会互相矛盾。
   */
  const props = useMemo(() => propositionsOf(d), [d]);
  const pivot = useMemo(() => pivotOf(d), [d]);
  /**
   * 全流程账：这二十步做没做（v1.1 新增 F 段与 E4）。
   *
   * 放在最前面（四句话之后）而不是最后：它答的是「这份报告是按流程走的吗」，
   * 属于读之前的方位感；放到报告末尾，读者已经读完了才知道自己读的那份跳过立案。
   * 与它同一层的骨架缺口紧接着——一个说「流程走到哪」，一个说「报告哪儿是空的」。
   */
  const flow = useMemo(() => flowOf(d), [d]);
  const topicsHit = topics.filter((t) => t.hit).length;

  /**
   * 导出。
   *
   * 两种格式，导的是同一份报告：Markdown 给人读、照着改稿；Argdown 是纯文本的
   * 论证语法，换到任何支持它的编辑器里都能渲染出结构图，改动能进 git diff。
   *
   * 状态里要区分「取消」和「失败」：取消是用户的正常操作，弹一句红字去怪他
   * 只会让人下一次不敢点；而真正的失败（目录不可写、磁盘满）必须说出来，
   * 否则他会以为文件在某个地方等着他。fmt 记着是哪一份在忙，否则两个按钮
   * 会同时显示「正在导出…」，用户分不清点的是哪一个。
   */
  const [exp, setExp] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'fail'; fmt?: 'md' | 'ad' | 'prg'; msg?: string }>({
    kind: 'idle',
  });
  /*
   * 「拿走之后」的两件小事：复制成功没有、打开文件失败没有。
   *
   * 与 exp 分开记：一次导出成功之后再点「打开文件」失败，不该把「已保存：路径」
   * 那一条顶掉——那会让人以为文件没存下来。两句话说的是两件事。
   */
  const [copied, setCopied] = useState<{ kind: 'idle' | 'ok' | 'fail'; msg?: string }>({ kind: 'idle' });
  const [actErr, setActErr] = useState<string | null>(null);
  const doCopy = async () => {
    setCopied({ kind: 'idle' });
    try {
      const r = await window.api.report.copyMarkdown(d);
      setCopied(
        r.ok
          ? { kind: 'ok', msg: `${(r.chars ?? 0).toLocaleString('zh-CN')} 字已复制` }
          : { kind: 'fail', msg: r.reason ?? '没能写进剪贴板。' }
      );
    } catch (e) {
      setCopied({ kind: 'fail', msg: `复制失败：${(e as Error)?.message ?? '原因不明'}` });
    }
  };
  const openSaved = async (how: 'open' | 'reveal', path: string) => {
    setActErr(null);
    try {
      const r = how === 'open' ? await window.api.report.openSaved(path) : await window.api.report.revealSaved(path);
      if (!r.ok) setActErr(r.reason ?? (how === 'open' ? '打不开这个文件。' : '没能定位到这个文件。'));
    } catch (e) {
      setActErr(`打不开：${(e as Error)?.message ?? '原因不明'}`);
    }
  };
  const doExport = async (fmt: 'md' | 'ad' | 'prg') => {
    setExp({ kind: 'busy', fmt });
    try {
      const r =
        fmt === 'md'
          ? await window.api.report.exportMarkdown(d)
          : fmt === 'ad'
            ? await window.api.report.exportArgdown(d)
            : await window.api.report.exportPrg(d);
      if (r.ok && r.path) setExp({ kind: 'ok', fmt, msg: r.path });
      else if (r.canceled) setExp({ kind: 'idle' });
      else setExp({ kind: 'fail', fmt, msg: '没能写成功。换一个目录再试一次。' });
    } catch (e) {
      setExp({ kind: 'fail', fmt, msg: `导出失败：${(e as Error)?.message ?? '原因不明'}` });
    }
  };

  /*
   * 点开之后是**换一屏**，不是在报告末尾再添一段。
   * 报告本身一个字没动，回来时它还在原处。
   */
  if (reread) return <RereadScreen view={view} onBack={() => setReread(false)} />;
  if (rescale) return <RescaleScreen d={d} initialPairs={initialPairs} onBack={() => setRescale(false)} />;
  if (conditions) {
    return <ConditionScreen passage={d.passage ?? ''} initialItems={initialItems} onBack={() => setConditions(false)} />;
  }

  return (
    <>
      {MODE_META[mode].banner && (
        <div className={`banner mode-banner ${SEC.bannerClass}`}>
          <div>
            <b>{MODE_META[mode].label}模式</b>
            {MODE_META[mode].banner}
          </div>
        </div>
      )}

      {/*
        导出条放在最前，理由不是显眼，是它服务于「读完就走」的那一半用法：
        报告再细，也只有少数人会一直开着窗口；多数人是看完、带走、在自己的写作软件里改。
        放在最前面，意味着不用滚到底也能找到它。
      */}
      <div className="exp-bar">
        <button className="exp-btn" onClick={() => doExport('md')} disabled={exp.kind === 'busy'}>
          {exp.kind === 'busy' && exp.fmt === 'md' ? '正在导出…' : '导出为 Markdown'}
        </button>
        {/*
          第二个格式不是「更多格式」的堆砌：Markdown 带走的是「改哪一句」，
          Argdown 带走的是「谁支撑谁」。后者进了 git，结构的改动才会留下 diff。
        */}
        <button className="exp-btn" onClick={() => doExport('ad')} disabled={exp.kind === 'busy'}>
          {exp.kind === 'busy' && exp.fmt === 'ad' ? '正在导出…' : '导出为 Argdown'}
        </button>
        {/*
          第三个出口与前两个不是同一类东西：前两个带走的是一份**文件**，
          这一个带走的是一个**画布**——节点和线都在，位置只是草稿，
          用户可以按自己的方式重排、加批注、拆成两屏。
          放在最后是因为它服务于「还要再摆一遍」的那部分人，不是每次都用。
        */}
        <button className="exp-btn" onClick={() => doExport('prg')} disabled={exp.kind === 'busy'}>
          {exp.kind === 'busy' && exp.fmt === 'prg' ? '正在导出…' : '导出为画布工程（.prg）'}
        </button>
        {/*
          第四个出口不落盘：服务的是「贴到聊天窗口里问一句」「粘进自己的稿子」。
          它走的是同一个 reportToMarkdown，所以复制出来的字与导出的 .md 逐字相同。
        */}
        <button className="exp-btn" onClick={doCopy} data-copy-markdown="1">
          复制 Markdown
        </button>
        {copied.kind === 'ok' && (
          <span className="exp-ok" data-copy-ok="1">
            {copied.msg}
          </span>
        )}
        {copied.kind === 'fail' && <span className="exp-fail">{copied.msg}</span>}
        {exp.kind === 'ok' && exp.msg && (
          <>
            {/*
              只显示路径是不够的：路径长了会被截断，而且人得自己打开资源管理器再找一遍。
              这两个按钮打开的是主进程刚写出的那一份——不认别的路径。
            */}
            <span className="exp-ok" title={exp.msg}>
              已保存：{exp.msg}
            </span>
            <button className="exp-act" onClick={() => void openSaved('open', exp.msg!)} data-open-saved="1">
              打开文件
            </button>
            <button className="exp-act" onClick={() => void openSaved('reveal', exp.msg!)} data-reveal-saved="1">
              在文件夹中显示
            </button>
          </>
        )}
        {exp.kind === 'fail' && <span className="exp-fail">{exp.msg}</span>}
        {actErr && <span className="exp-fail">{actErr}</span>}
        {exp.kind === 'idle' && (
          <span className="exp-hint">
            Markdown 给人读；Argdown 是纯文本结构图，可进 git diff；画布工程 {prgLine}（位置是草稿，打开后可自己摆）；
            复制不落盘，贴到聊天窗口或自己的稿子里用
          </span>
        )}
      </div>

      {/*
        「回到原文重读」的入口放在报告最前，但**默认不展开**。
        它是一次用户发起的操作：把原文摆到每个人面前，等于替他决定该先读什么。
        为什么值得单独一个按钮：报告是按栏目组织的，读完之后「这句在原文里是哪句」
        得靠人自己翻回去；这一屏把顺序倒过来，原文在前、条目在后。
      */}
      <div className="rr-bar">
        <button className="rr-open" data-reread-open onClick={() => setReread(true)}>
          回到原文重读
        </button>
        <button className="rr-open" data-rescale-open onClick={() => setRescale(true)}>
          换个尺度读
        </button>
        <button className="rr-open" data-conditions-open onClick={() => setConditions(true)}>
          自己列成立条件
        </button>
        <span className="rr-bar-why">
          三件都是你按了才发生的操作：把条目搬回原文旁边；只换你给的那几个词；或自己写下「要站住得先有什么」，
          再回原文逐句找。第三件里不出现报告里的任何一句话。
        </span>
      </div>

      {/* 先说清这份报告里的判断是谁写的，再往下读。默认只占两行，清单要点开。 */}
      <SourceBar d={d} />

      {/*
        异议账放在来源之后、正文之前：它是「你读这份报告时留下的东西」，
        属于这一份的头，而不是某一节的内容。零条时整块不渲染（组件自己返回 null）。
      */}
      <ObjectionDigest diagId={d.id} />

      {/* 长文本才出现：把「原文哪些句子被条目落上了」摆出来，短文本不摆（那是空面板）。 */}
      <CoverageBar d={d} />

      {!d.scope.applicable && (
        <div className="banner bad">
          <div>
            <b>这副透镜在此不适用，因此不作判定</b>
            {d.scope.reason}
            {d.scope.outOfScopeAt && <div style={{ marginTop: 4 }}>不适用之处：{d.scope.outOfScopeAt}</div>}
            {/*
              判了不适用就该给出路。只写「不适用」等于把用户留在一份空报告前面——
              他知道这把尺子量不了，但不知道哪把量得了。提示来自本次分析自己的
              alternativeReading：模型在判不适用时必须回答「换哪副透镜能看到什么」，
              那句话就是这里要显示的，不该埋在页面最底部的修补栏里。
            */}
            {(d.repair.alternativeReading || d.selfCheck.underOtherLens) && (
              <div className="banner-next">
                <b>换一副透镜</b>
                {d.repair.alternativeReading || d.selfCheck.underOtherLens}
              </div>
            )}
          </div>
        </div>
      )}

      {d.scope.applicable && d.scope.partialNote && (
        <div className="banner warn">
          <div>
            <b>部分适用</b>
            {d.scope.partialNote}
          </div>
        </div>
      )}

      <QuickRead d={d} />

      {/*
        全流程账紧接四句话：四句话说「这份报告说了什么」，这一栏说
        「它是照流程走出来的，还是跳着走的」。两件事都不改报告一个字，
        但第二件决定了第一件该被信几分——所以它排在所有正文之前。
      */}
      <Block
        id="sec-flow"
        title="全流程账"
        sub={`${flow.depthLabel}档｜${flow.rows.length} 步走了 ${flow.counts.ok} 步`}
        plain="这份报告是按「立案 → 重构 → 检验 → 裁决 → 分歧收口 → 交付」一步步走出来的，还是跳着走的。软件只数做没做，不判做得对不对——哪一步做得准不准，它算不出来。"
      >
        <FlowLedger v={flow} />
      </Block>

      {/*
        骨架缺口跟在流程账之后：流程账说「步骤走到哪」，它说「报告哪儿是空的」。
        再往后放就成了读到一半才发现的附注，而它恰恰是对整份报告的核对。
      */}
      <SkeletonCard d={d} />

      {/*
        挑图放在目录之后、正文之前：读者刚看完四句话，正决定「要深看哪一层」。
        再往后放，他已经在读正文了，选择条就成了事后才发现的开关。
      */}
      <ViewBar views={views} picked={picked} onPick={setWanted} initialOpen={!!initialViews} />

      <Block
        title="原文"
        sub="点黄色处 → 上面定位条和图上一起亮；虚线句是报告没引用的"
        plain="他自己写的话。黄色是被拆出来的句子，点一下就知道它在结构图里是哪一格；上面那排编号是报告对这句话的读法，虚线是他没用到的话。"
      >
        <Passage
          text={d.passage}
          items={allClaims.map((c) => ({ id: c.id, span: c.span, role: c.role, quote: c.quote }))}
          sel={sel}
          onPick={(id) => setSel(id === sel ? null : id)}
        />
      </Block>

      <Block
        id="sec-structure"
        title="结构图"
        sub="左：依据 → 右：结论"
        disputes={at('sec-structure')}
        plain="把这段话画成一张图。左边是他摆出的依据，右边是他要你信的那句，中间的线就是「凭什么」。线断了，就是说这一步接不上。"
      >
        <Gated id="structure" views={views} picked={picked} onOpen={() => turnOn('structure')}>
          <StructureMap d={d} sel={sel} onPick={setSel} />
        </Gated>
      </Block>

      <Block
        id="sec-checks"
        title="逐关检查"
        sub={d.scope.applicable ? `${t.unit}｜${d.checks.length} 项` : '不适用，无检查项'}
        disputes={at('sec-checks')}
        plain="把这套理论要问的问题排成一排关卡：绿的是过了，红的是没过，黄的是他没回答。点任一关，下面就有它的依据。"
      >
        {d.scope.applicable ? (
          <>
            <Gated id="checks" views={views} picked={picked} onOpen={() => turnOn('checks')}>
              <CheckStrip checks={d.checks} sel={sel} onPick={setSel} defeatId={d.defeat.checkId} />
            </Gated>
            <CheckTable checks={d.checks} sel={sel} />
          </>
        ) : (
          /*
           * 不适用时的空表会被读成「检查过了，全过」或「程序坏了」。
           * 两者都不是。写清楚原因在这儿，不让人猜。
           */
          <p className="hint">
            这副透镜判了不适用，所以这里没有检查项。不适用的尺子量出来的刻度是假的——清空比留一排「未覆盖」诚实。
            想看能问出什么，换一副透镜：具体换哪副，写在页面顶部那条提示里。
          </p>
        )}
      </Block>

      {/*
        专题分析。放在逐关检查之后：关卡是「这副透镜要问的」，专题是「这类论证
        文献上公认还要问的」。未命中的专题照列并写明为什么——只显示命中的，
        用户就分不清「没命中」和「没检查」，后者是假绿。
      */}
      <Block
        id="sec-topics"
        title="专题分析"
        sub={`六个专题｜命中 ${topicsHit} 个｜本地推导，不给档位`}
        plain="每个专题是一类论证（类比、因果、来源、实践、定义、预设）在文献里的共识问题清单。命中与否由本次分析已经落盘的判断和原文用词推出来，不再调一次模型——所以它不花钱，也永远可复现。它给的是该问什么，不是第几分。"
      >
        {topics.map((t) => (
          <TopicRow key={t.sub} t={t} />
        ))}
      </Block>

      {/*
        学术分析。放在专题分析之后：专题说「这类论证该问什么」，
        这一栏说「哪些你自己得去核、哪些本工具根本核不了」。
        两者都不调模型，都靠本地推导——所以它们可以一起看，不会互相矛盾。
      */}
      <Block
        id="sec-academic"
        title="学术分析"
        sub={`${academic.genre.label}｜${academic.traces.length} 处待核｜${academic.norms.length} 条规范｜本地推导，不调模型`}
        plain="如果这段话是从论文、书评或报告里摘出来的，这一栏替你分清两件事：哪些本工具查过了，哪些只能你自己回原文查。引用是否忠实、数据是否真实、方法是否恰当——这三条它一概查不了，所以它把它们指出来，而不是装作没看见。最后一小节讲的是：要反驳，先从哪一层下手。"
      >
        <AcademicBlock a={academic} onOpenClaim={onOpenClaim} />
        <FieldTermsBar d={d} initialOpen={!!initialTerms} initialWords={initialTermsWords} />
      </Block>

      <Block
        id="sec-verdict"
        title={SEC.verdictTitle}
        sub={SEC.verdictSub(t.name, d.verdict.scale)}
        disputes={at('sec-verdict')}
        plain={SEC.verdictPlain}
      >
        <Gated id="verdict" views={views} picked={picked} onOpen={() => turnOn('verdict')}>
          <VerdictGauge
            level={d.verdict.level}
            scaleValue={d.verdict.scaleValue}
            scale={d.verdict.scale}
            whatIsRefuted={d.verdict.whatIsRefuted}
          />
        </Gated>
        <div className="verdict-say">{d.verdict.statement}</div>
        <ObjectBtn field="verdict" refId="verdict" refLabel="判读" excerpt={d.verdict.statement} />
        {/*
          推导链只给「会给档位」的三个模式。查谬误／重构／提问本来就不判，
          给它们配一条「为什么在这一格」的链，等于把「不判」渲染成一次判定。
        */}
        {MODE_META[d.mode].givesVerdict && (
          <VerdictWhy
            d={d}
            onGotoCheck={(id) => {
              setSel(`#${id}`);
              jumpTo('sec-checks');
            }}
          />
        )}
        {d.verdict.qualification && (
          <div className="verdict-qual">
            <b>这个判断在什么条件下成立：</b>
            {d.verdict.qualification}
          </div>
        )}
        {/*
          这一句原来是把本透镜这一档的释义再说一遍——可上面三格对照里已经写着同一句，
          同一屏出现两次会被读成两回事。改为讲它没讲的那件事：跨透镜不可比，
          用另一副尺子的同名档做对照。
        */}
        {d.scope.applicable && t.levelMeaning[d.verdict.level as 'withstands' | 'weakened' | 'fails'] && (
          <div className="verdict-qual dim">
            这三格的意思<b>每副透镜都不一样</b>：同样叫「{LEVEL_LABEL[d.verdict.level]}」，「
            {THEORY_BY_ID.pragma.name}」指的是“
            {THEORY_BY_ID.pragma.levelMeaning[d.verdict.level as 'withstands' | 'weakened' | 'fails']}”，
            而「{t.name}」指的是上面那一格。所以档位不能跨透镜比大小，只在同一副尺子内看走向。
          </div>
        )}
      </Block>

      {/*
        命题账。放在判读之后、争议之前，位置是有理由的：
        判读刚给完档位，读者最想问的是「你凭什么」；紧接着这一栏先回答另一半——
        这些命题里，哪几条根本不是论证能定的。再往后才是「学界在哪吵架」
        （争议）与「这个工具只有一把尺子」（边界）。顺序是层层退后的：
        结论 → 哪些不能裁 → 哪里有分歧 → 我根本不做。
      */}
      {props.total > 0 && (
        <Block
          id="sec-props"
          title="命题账"
          sub={props.line}
          plain="判读只说了一件事：这段话站不站得住。这一栏说的是另一半——里面每一条主张本来该由什么来定。有的能去查，有的现在谁都给不出证据，有的是价值选择，论证再多也只能说明代价，不能把它判真判假。"
        >
          <PropositionLedger v={props} />
        </Block>
      )}

      {/*
        枢纽前提。紧接命题账，因为账回答「每条该由什么来定」，这一栏回答
        「这一段其实压在谁身上」——两问合起来才够用：知道哪条不是证据能定的，
        还得知道哪一条是整段的承重墙。位置也照顾读法：先看全账，再看那根柱子。
      */}
      {pivot.rows.length > 0 && (
        <Block
          id="sec-pivot"
          title="枢纽前提"
          sub={pivot.line}
          plain="指出十处措辞毛病，不如指出一次「你把 X 当起点用了，而 X 正是要争的那件事」。这一栏只攒两件事：结论经过谁，谁身上已经有反对意见。"
        >
          <PivotCard v={pivot} />
        </Block>
      )}

      {/*
        争议栏放在判读之后：读者此时刚拿到结论，最想问的正是「你凭什么」。
        放在最后等于承认它只是个免责声明——它其实是结论的第二层。
      */}
      {hits.length > 0 && (
        <Block
          id="sec-disputes"
          title="这里有什么争议"
          sub={`${hits.length} 处｜学理上真的没有共识的地方`}
          plain="这份判断里，有几处其实是学界两派吵着的地方。这里不写「可能不准」，写清楚：一派怎么说、另一派怎么说、各自要付什么代价、这个工具站哪一边。"
        >
          <DisputeStrip hits={hits} />
          <p className="dp-fine" style={{ marginTop: 10 }}>
            这些<b>不是</b>「我没把握」——那是能力问题，写在每条依据的置信里。这些是学科本身的状况：
            换一位学者来看，会同意的部分照样同意，会不同意的地方就在这里。
          </p>
        </Block>
      )}

      {/*
        边界栏。放在最后不是因为它不重要——放在最后是因为它说的是这份报告自身，
        读者得先看过报告才知道它省掉了什么。它也不是免责声明：
        每行挂一条理论主张的 id，点开能看到出处与反对意见，边界一样可以被反驳。
        按三类分组，因为三类边界的性质不同：不看、看到某层为止、只有一把尺子。
      */}
      <Block
        id="sec-limits"
        title="这份分析自身的边界"
        sub={`${limits.total} 条｜三类：不评价人、代劳到某层为止、只有一套规范`}
        plain="这一栏不是免责声明。它分三组说清三种不同的「没做」：哪一种它根本不看，哪一种是看到某一层就停，哪一种是有意只用一把尺子。每行左侧的编号可以点，点开是那条主张的出处、落点与反对意见——边界也一样可以被反驳。"
      >
        {limits.thisRun.length > 0 && (
          <div className="lim-group">
            <div className="lim-ghead">
              <span className="lim-gtitle">本次</span>
              <span className="lim-ggist">只对这一份报告成立；下面三组是恒定的</span>
            </div>
            <ul className="lim-list">
              {limits.thisRun.map((l) => (
                <li key={l.claimId} className="lim-item">
                  <LimitId id={l.claimId} onOpen={onOpenClaim} />
                  <span className="lim-text">{l.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {limits.groups.map((g) => (
          <div key={g.id} className="lim-group">
            <div className="lim-ghead">
              <span className="lim-gtitle">{g.title}</span>
              <span className="lim-ggist">{g.gist}</span>
            </div>
            <ul className="lim-list">
              {g.notes.map((l) => (
                <li key={l.claimId} className="lim-item">
                  <LimitId id={l.claimId} onOpen={onOpenClaim} />
                  <span className="lim-text">{l.text}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Block>

      <Block
        id="sec-context"
        title="语境坐标"
        sub="后面所有判断都锚在这上面"
        disputes={at('sec-context')}
        plain="这段话是在什么场合说的、说给谁听、对方是谁。同一句话换个场合，对错会变。"
      >        <div className="ctx">
          <div>
            <div className="k">争议之点</div>
            <div className="v">{d.context.issue}</div>
          </div>
          <div>
            <div className="k">说话者立场</div>
            <div className="v">{d.context.speakerPosition || '—'}</div>
          </div>
          <div>
            <div className="k">对方立场</div>
            <div className="v">{d.context.opposingPosition || '无可识别对手'}</div>
          </div>
          <div>
            <div className="k">
              <Term k="dialogue">对话类型</Term>
            </div>
            <div className="v">
              {d.context.dialogueType}
              {d.context.dialogueTypeBasis ? `｜${d.context.dialogueTypeBasis}` : ''}
            </div>
          </div>
          <div>
            <div className="k">受众</div>
            <div className="v">{d.context.audience || '—'}</div>
          </div>
          <div>
            <div className="k">
              <Term k="stage">阶段</Term>
            </div>
            <div className="v">{RULE_STAGE_LABEL[d.context.stage] ?? d.context.stage}</div>
          </div>
        </div>
        {d.context.contextGaps.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className="k" style={{ fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: '0.1em' }}>
              语境缺口（缺了这些，下面有些判断只能打折）
            </div>
            <ul style={{ listStyle: 'none', marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {d.context.contextGaps.map((g, i) => (
                <li key={i} style={{ fontSize: 12, color: 'var(--ink-2)', paddingLeft: 12, position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 2, color: 'var(--ink-3)' }}>·</span>
                  {g}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Block>

      <Block
        title="重构"
        sub={`${d.premises.length} 条前提 · ${d.intermediate.length} 条中间结论 · 结论 1 条`}
        plain="一条一条摊开给他看：他给了几条依据、结论是哪句、哪些是他没说出口的。图上那几格，就是这里的几条。"
      >
        <ClaimCard claim={d.conclusion} isConclusion active={sel === 'C'} onPick={() => setSel('C')} />
        <ToneCard d={d} />
        {d.intermediate.map((m) => (
          <ClaimCard key={m.id} claim={m} active={sel === m.id} onPick={() => setSel(m.id)} />
        ))}
        {d.premises.map((pr) => (
          <ClaimCard key={pr.id} claim={pr} active={sel === pr.id} onPick={() => setSel(pr.id)} />
        ))}
      </Block>

      <LensPanel d={d} />

      {d.defeat.kind !== 'none' && (
        <Block
          id="sec-defeat"
          title="击败类型"
          sub="削弱 ≠ 反驳"
          disputes={at('sec-defeat')}
          plain="分两件事：是他这一步推不出来（削弱），还是你要他信的那句话本身被证伪了（反驳）。绝大多数批评只能做到前者。"
        >
          <div className="kv">
            <span className="k">类型</span>
            <span className="v">
              {d.defeat.kind === 'undermining'
                ? '削弱性击败：切断前提与结论的联结，不否证结论'
                : '反驳性击败：给出结论为假的理由'}
            </span>
            <span className="k">切断处</span>
            <span className="v">{d.defeat.cuts || '—'}</span>
            <span className="k">说明</span>
            <span className="v">{d.defeat.explanation}</span>
            {d.defeat.checkId && (
              <>
                <span className="k">倒在</span>
                <span className="v mono">{d.defeat.checkId}</span>
              </>
            )}
          </div>
          <ObjectBtn
            field="defeat"
            refId="defeat"
            refLabel="击败类型"
            excerpt={d.defeat.explanation || d.defeat.cuts}
          />
        </Block>
      )}

      {/*
        命名栏在查谬误模式下是主输出，所以它空着时也要出现——
        别处「空段落不打印」是为了不留空壳，这里反过来：用户特意来问「有没有谬误」，
        一句名字都没有本身就是答案，而它必须带着「是哪一种没有」才算答案。
        其余模式下空着就整块不出现（不留空壳）。
      */}
      {(d.labels.length > 0 || mode === 'fallacy') && (
        <Block
          id="sec-labels"
          title={SEC.labelTitle}
          sub={SEC.labelSub}
          disputes={at('sec-labels')}
          plain={SEC.labelPlain}
        >
          {d.labels.length ? (
            <>
              {mode === 'fallacy' && <FallacyMap d={d} sel={labelSel} onPick={setLabelSel} />}
              {d.labels.map((c) => (
                <LabelCard
                  key={c.id}
                  c={c}
                  active={labelSel === c.id}
                  onPick={mode === 'fallacy' ? () => setLabelSel(labelSel === c.id ? null : c.id) : undefined}
                />
              ))}
            </>
          ) : (
            <p className="hint">{SEC.labelEmpty}</p>
          )}
        </Block>
      )}

      <Block
        id="sec-legit"
        title={SEC.legitTitle}
        sub={SEC.legitSub}
        disputes={at('sec-legit')}
        plain={SEC.legitPlain}
      >
        {d.legitimateMoves.length ? (
          d.legitimateMoves.map((m, i) => <LegitItem key={i} m={m} />)
        ) : (
          <p className="hint">{SEC.legitEmpty}</p>
        )}
      </Block>

      {MODE_META[d.mode].showsRefute && (
        <Block
          id="sec-refute"
          title={SEC.refTitle}
          sub={SEC.refSub(d.refutations.length)}
          plain={SEC.refPlain}
        >
          {d.refutations.length ? (
            <>
              {/* 图在上、逐条在下：图说「火力怎么分布」，逐条说「每一条怎么打」。 */}
              <Gated id="refute" views={views} picked={picked} onOpen={() => turnOn('refute')}>
                <RefuteMap d={d} />
              </Gated>
              {d.refutations.map((r) => <RefItem key={r.id} r={r} mode={mode} />)}
            </>
          ) : (
            <p className="hint">{SEC.refEmpty}</p>
          )}
        </Block>
      )}

      <Block
        id="sec-repair"
        title="修补"
        sub={SEC.repairSub}
        plain={SEC.repairPlain}
      >
        <Gated id="repair" views={views} picked={picked} onOpen={() => turnOn('repair')}>
          <RepairMap d={d} />
        </Gated>
        <div className="kv">
          <span className="k">缺的前提</span>
          <span className="v">{d.repair.missingPremise ?? '—'}</span>
          <span className="k">换透镜会怎样</span>
          <span className="v">{d.repair.alternativeReading ?? '未写'}</span>
          <span className="k">可正面回答</span>
          <span className="v">{d.repair.answerable.length ? d.repair.answerable.join('、') : '—'}</span>
          <span className="k">证明责任</span>
          <span className="v">{d.repair.burdenStatus || '—'}</span>
          <span className="k">修补后</span>
          <span className="v mono">{d.repair.repairedForm ?? '—'}</span>
        </div>
        {/*
          修补后那一栏是重构记号（P1… P2… ∴ C），不是可以直接拿去说的话，
          所以按钮不给「拿它再判一次」，只给「把原文 + 补上的前提填回去」。
        */}
        {onLoadRepair && (
          <div className="rp-rerun">
            <button className="rp-rerun-btn" onClick={onLoadRepair}>
              把这一版填回输入框
            </button>
            <span className="rp-rerun-note">
              填回去的是「原文 + 补上的那句前提」，你可以先改再跑——上面那一栏是建议，不是结论。
              跑完这一版会与当前这份并排对照，所以补没补上，下一份报告会告诉你。
            </span>
          </div>
        )}
      </Block>

      {/*
        下一步：把「这一环空着」翻译成「要填什么形状的东西」。
        放在修补之后，是因为修补给的是补完的样子，这一栏说的是每一步为什么那样补。
        两条信息必须挨着看：分开两屏，用户只会记住那份重构版，记不住它凭什么成立。
      */}
      <Block
        title="下一步"
        sub="每一处空着的地方，要填什么形状的东西"
        plain="诊断说完就走，等于把最费力的一步留给用户。这一栏把「CQ2 未答」翻译成这一环要填什么形状的内容，并且给出验收标准——补完之后该是哪一条变过。它不给答案，也不承诺补得上。"
      >
        {rx.emptyReason && <div className="rx-empty">{rx.emptyReason}</div>}

        {/* 缺的前提单列在最前：它是最直接能动的一处，而且补完之后会被继续追问 */}
        {rx.missingPremise && (
          <div className="rx-item rx-lead">
            <div className="rx-head">
              <span className="rx-state rx-viol">先补这句</span>
              <span className="rx-ring">依据与结论之间的那一步</span>
            </div>
            <div className="rx-need">「{rx.missingPremise.text}」</div>
            <div className="rx-accept">{rx.missingPremise.accept}</div>
            <div className="rx-cost">{rx.missingPremise.cost}</div>
          </div>
        )}

        {rx.groups.map((g) => (
          <div className="rx-group" key={g.site}>
            <div className="rx-gtitle">{g.title}</div>
            <div className="rx-gist">{g.gist}</div>
            {g.items.map((it) => (
              <div className="rx-item" key={it.checkId}>
                <div className="rx-head">
                  <span className={`rx-state ${it.state === 'violated' ? 'rx-viol' : 'rx-open'}`}>
                    {it.state === 'violated' ? '没过' : '未答'}
                  </span>
                  <span className="rx-ring">{it.ring}</span>
                  <code className="rx-cid">{it.checkId}</code>
                </div>
                <div className="rx-need">{it.need}</div>
                <div className="rx-accept">{it.accept}</div>
                <div className="rx-cost">{it.cost}</div>
              </div>
            ))}
          </div>
        ))}
      </Block>

      <Block
        id="sec-selfcheck"
        title="自检"
        sub="这份输出用同一套标准检视自己"
        plain="这份分析给自己打的七项分，不是给原文打的。一个只会挑别人毛病的工具，本身就违反了它自己的标准。"
      >
        <div className="epi">
          {(
            [
              ['P1', '出处', d.selfCheck.epi.P1_source],
              ['P2', '语境', d.selfCheck.epi.P2_context],
              ['P3', '位置', d.selfCheck.epi.P3_position],
              ['P4', '撤回', d.selfCheck.epi.P4_withdrawal],
              ['P5', '自适', d.selfCheck.epi.P5_selfApply],
              ['P6', '完备', d.selfCheck.epi.P6_openness],
              ['P7', '回应', d.selfCheck.epi.P7_steelman],
            ] as const
          ).map(([k, name, v]) => (
            <div key={k} className={`cell ${v === 0 ? 'zero' : v === 2 ? 'full' : ''}`}>
              <div className="k">{k}</div>
              <div className="v">{v}</div>
              <div className="k">{name}</div>
            </div>
          ))}
          <div className="cell" style={{ minWidth: 74 }}>
            <div className="k">总分</div>
            <div className="v">{d.selfCheck.epi.total}</div>
            <div className="k">/14</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <span className={`reading ${d.selfCheck.epi.reading}`}>
            {d.selfCheck.epi.reading === 'legitimate' ? '站得住' : d.selfCheck.epi.reading === 'overreach' ? '越界' : '标签化裁决'}
          </span>
          {d.selfCheck.epi.vetoed && <span className="pill bad">单项否决：P3=0 且 P4=0</span>}
        </div>

        {d.selfCheck.underOtherLens && (
          <div className="banner info" style={{ marginBottom: 10 }}>
            <div>
              <b>换一副透镜会怎样</b>
              {d.selfCheck.underOtherLens}
            </div>
          </div>
        )}

        {d.selfCheck.unknowns.length > 0 && (
          <>
            <div className="k" style={{ fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: '0.1em' }}>
              明确不知道的事
            </div>
            <ul style={{ listStyle: 'none', margin: '4px 0 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {d.selfCheck.unknowns.map((u, i) => (
                <li key={i} style={{ fontSize: 12, color: 'var(--ink-2)', paddingLeft: 12, position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 2, color: 'var(--ink-3)' }}>·</span>
                  {u}
                </li>
              ))}
            </ul>
          </>
        )}

        {d.selfCheck.withdrawIf.length > 0 && (
          <>
            <div className="k" style={{ fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: '0.1em' }}>
              可推翻条件（什么情况下这份分析该被撤回）
            </div>
            <ul style={{ listStyle: 'none', margin: '4px 0 0', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {d.selfCheck.withdrawIf.map((u, i) => (
                <li key={i} style={{ fontSize: 12, color: 'var(--ink-2)', paddingLeft: 12, position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 2, color: 'var(--invalid)' }}>×</span>
                  {u}
                </li>
              ))}
            </ul>
          </>
        )}
      </Block>

      {/*
        分歧账（v1.1 E4）。放在自检之后、程序裁定之前：它是给读者看的最后一段
        「这份判定在什么坐标下成立、判不出的部分在哪」，不是又一条程序诊断。
        没登记时这一栏照样在，并明说空着不等于判定对——空白才是最容易被误读的。
      */}
      <Block
        id="sec-divergence"
        title="分歧账"
        sub="判定坐标 · 收束模式 · E4 登记"
        plain="按 v1.1 第 4 章，判不出唯一答案时不许假装判得出，也不许用「多元」逃掉该判的那部分。这一栏由人填，软件只保管；它不判分歧归哪一类，只把没填齐的格数出来。"
      >
        <DivergenceView value={d.divergence} />
      </Block>

      {/*
        这把尺子：提示词版本、指纹与变更注记。
        放在分歧账之后、程序裁定之前——它是给读者回看用的追溯信息，
        不是又一条判定，也不是程序诊断。每份报告都有这一栏：
        旧存档没记版本时，空白最容易被读成「都一样」，所以必须明说「没记」。
      */}
      <Block
        id="sec-prompt-history"
        title="这把尺子"
        sub="版本 · 指纹 · 变更注记"
        plain="报告里那串版本号，说的是当时用哪一套话问的。这一栏把那一版改过什么、和现在这套是不是同一把尺子摆给你看。更早版本的全文本机没有存，所以这里不会假装能把当时的指纹重算一遍。"
      >
        <PromptHistoryCard d={d} />
      </Block>

      {d.diagnostics.length > 0 && (
        <Block
          title="程序裁定"
          sub="本地确定性检查抓到的越界与缺口"
          plain="代码这一层抓住的越界：比如模型把「没论证成功」写成了「结论是错的」。抓到就改回去，并且留一条记录——静默改判是另一种撒谎。"
        >
          {d.diagnostics.map((x, i) => (
            <div key={i} className={`diag ${x.level}`}>
              <span className="lv">{x.level === 'warn' ? '警告' : x.level === 'error' ? '错误' : '记录'}</span>
              <span className="msg">
                <code style={{ fontSize: 10.5, color: 'var(--ink-3)', marginRight: 6 }}>{x.code}</code>
                {x.message}
              </span>
            </div>
          ))}
        </Block>
      )}

      {/*
        报告脚注：这份报告是哪一把尺子量的。
        放在最后而不是最前，因为它是追溯信息，不是判读前提——
        只在用户想核对「这两份能不能对照」时才需要看见。
      */}
      {d.prompt && (
        <div className="prompt-foot">
          本次提示词 v{d.prompt.version} · 指纹 {d.prompt.fingerprint.slice(0, 8)}
          {/* 「谁跑的」与「哪把尺子」是同一类追溯信息：都只在核对「这两份能不能对照」时才需要。
              旧报告没有这一栏，写「没记」而不是留空——留空会被读成「没模型」或者「都一样」。 */}
          <span data-engine-foot>
            {d.engine
              ? `由 ${d.engine.model} 跑出（温度 ${d.engine.temperature}，${d.engine.host}）`
              : '没记模型与温度（那一栏是后加的）'}
          </span>
          <span>提示词版本不同的两份报告不能直接对照——判定口径可能已经变了。</span>
        </div>
      )}
    </>
  );
}

function LegitItem({ m }: { m: LegitimateMove }) {
  return (
    <div className="claim-card" style={{ borderLeft: '3px solid var(--legal)' }}>
      <div className="claim-top">
        <span className="id-badge" style={{ background: 'var(--legal-bg)', color: 'var(--legal)' }}>
          {m.targetId}
        </span>
        <Meta tag={m.tag} confidence={m.confidence} />
      </div>
      {m.quote && <div className="claim-quote">「{m.quote}」</div>}
      <div style={{ fontSize: 12.5, marginTop: 4 }}>
        <strong>实际是：</strong>
        {m.what}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
        <strong>为何正当：</strong>
        {m.why}
      </div>
      <ObjectBtn field="legitimate" refId={m.targetId} refLabel="此处合法" excerpt={m.why} compact />
    </div>
  );
}

/**
 * 提问模式下这两个标签要换：steelman 不是「对方怎么反击我」，是「他怎么回答这个问句」；
 * reply 不是「我怎么接反击」，是「我顺着他的回答继续问什么」。
 * 不换标签，用户会拿红队的读法去读问题清单，第一句就误解。
 */
function RefItem({ r, mode }: { r: Refutation; mode: AnalysisMode }) {
  const q = mode === 'interrogate';
  return (
    <div className="ref">
      <div className="ref-head">
        <span className="id-badge">{r.id}</span>
        <span className="pill">{STRATEGY_LABEL[r.strategy] ?? r.strategy}</span>
        <span className="pill">{q ? '问' : '打'} {r.targetId}</span>
        {r.checkId && <span className="pill">{r.checkId}</span>}
        <Meta tag={r.tag} confidence={r.confidence} />
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{r.claim}</div>
      <div className="ref-script">{r.script}</div>
      <div className="ref-row">
        <span className="k">{q ? '他最可能答' : '对方会回'}</span>
        <span>{r.steelman}</span>
      </div>
      <div className="ref-row">
        <span className="k">{q ? '你接着问' : '我方接法'}</span>
        <span>{r.reply}</span>
      </div>
      {r.evidenceNeeded.length > 0 && (
        <div className="ref-row">
          <span className="k">还需证据</span>
          <span>{r.evidenceNeeded.join('；')}</span>
        </div>
      )}
      <div className="ref-row">
        <span className="k">
          <Term k="burden">责任</Term>
        </span>
        <span>成立后落在{BURDEN_LABEL[r.burdenAfter]}</span>
      </div>
    </div>
  );
}
