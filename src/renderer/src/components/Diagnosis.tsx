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
import { prescriptionsOf } from '@shared/prescriptions';
import { fallacyHits, mapSentences } from '@shared/fallacy-map';
import { REREAD_KIND_LABEL, UNPLACED_LABEL, rereadOf, type RereadView } from '@shared/reread';
import { CheckStrip, StructureMap, VerdictGauge } from './Diagram';
import { DisputeStrip, focusDispute } from './Disputes';
import { QuickRead, jumpTo } from './Overview';
import { Term, usePlain } from './Term';
import { ObjectBtn } from './Objection';
import { ArsGapMap, PtaLocator, ToulminLayout, WaltonFamilyPath } from './LensDiagrams';
import { VerdictWhy } from './VerdictWhy';

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

function Meta({ tag, confidence }: { tag: string; confidence: string }) {
  return (
    <>
      <span className="pill">{TAG_LABEL[tag] ?? tag}</span>
      <span className="pill">置信 {CONF_LABEL[confidence] ?? confidence}</span>
    </>
  );
}

/* ═══════ 原文高亮 ═══════ */

function Passage({
  text,
  items,
  sel,
  onPick,
}: {
  text: string;
  items: { id: string; span: Span | null }[];
  sel: string | null;
  onPick: (id: string) => void;
}) {
  const marks = useMemo(() => {
    const valid = items
      .filter((x): x is { id: string; span: Span } => !!x.span && x.span.quality !== 'failed')
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

  const nodes: ReactNode[] = [];
  let pos = 0;
  marks.forEach((m, i) => {
    if (m.start > pos) nodes.push(text.slice(pos, m.start));
    nodes.push(
      <mark key={`${m.id}-${i}`} className={sel === m.id ? 'sel' : ''} onClick={() => onPick(m.id)}>
        {text.slice(m.start, m.end)}
      </mark>
    );
    pos = m.end;
  });
  nodes.push(text.slice(pos));

  return <div className="passage">{nodes}</div>;
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
  return (
    <div
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
    showRef: boolean;
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
    showRef: true,
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
    showRef: true,
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
    showRef: false,
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
    showRef: false,
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
    showRef: true,
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
}) {
  const [sel, setSel] = useState<string | null>(null);
  /** 落点图选中的命名。和结构图的 sel 分开：一个选主张，一个选谬误，别共用。 */
  const [labelSel, setLabelSel] = useState<string | null>(null);
  /**
   * 「回到原文重读」是**用户发起的一次操作**，不是报告里多出来的一个板块。
   * 默认关着：把原文摆到每个人面前，等于替他决定该先读什么。
   */
  const [reread, setReread] = useState(!!initialReread);
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
  const [exp, setExp] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'fail'; fmt?: 'md' | 'ad'; msg?: string }>({
    kind: 'idle',
  });
  const doExport = async (fmt: 'md' | 'ad') => {
    setExp({ kind: 'busy', fmt });
    try {
      const r = fmt === 'md' ? await window.api.report.exportMarkdown(d) : await window.api.report.exportArgdown(d);
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
        {exp.kind === 'ok' && (
          <span className="exp-ok" title={exp.msg}>
            已保存：{exp.msg}
          </span>
        )}
        {exp.kind === 'fail' && <span className="exp-fail">{exp.msg}</span>}
        {exp.kind === 'idle' && (
          <span className="exp-hint">Markdown 给人读；Argdown 是纯文本结构图，可进 git diff</span>
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
        <span className="rr-bar-why">原文一个字不改。把报告里指着它的条目，按句子重新摆一遍。</span>
      </div>

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

      <Block title="原文" sub="点黄色处 → 图上和下面那一条一起亮" plain="他自己写的话。黄色是被拆出来的句子，点一下就知道它在结构图里是哪一格。">
        <Passage
          text={d.passage}
          items={allClaims.map((c) => ({ id: c.id, span: c.span }))}
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
        <StructureMap d={d} sel={sel} onPick={setSel} />
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
            <CheckStrip checks={d.checks} sel={sel} onPick={setSel} defeatId={d.defeat.checkId} />
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
      </Block>

      <Block
        id="sec-verdict"
        title={SEC.verdictTitle}
        sub={SEC.verdictSub(t.name, d.verdict.scale)}
        disputes={at('sec-verdict')}
        plain={SEC.verdictPlain}
      >
        <VerdictGauge
          level={d.verdict.level}
          scaleValue={d.verdict.scaleValue}
          scale={d.verdict.scale}
          whatIsRefuted={d.verdict.whatIsRefuted}
        />
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

      {SEC.showRef && (
        <Block
          id="sec-refute"
          title={SEC.refTitle}
          sub={SEC.refSub(d.refutations.length)}
          plain={SEC.refPlain}
        >
          {d.refutations.length ? (
            d.refutations.map((r) => <RefItem key={r.id} r={r} mode={mode} />)
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
          <span>提示词版本不同的两份报告不能直接对照——判定口径可能已经变了。</span>
        </div>
      )}
    </>
  );
}

/**
 * 「回到原文重读」是一整屏，不是报告末尾又添的一个板块。
 *
 * 这一屏不写判断：句子是 passage 的原样切片，条目文字逐字引自报告，
 * 位置由 span / 唯一引文算出来（内核在 @shared/reread，有断言守着）。
 * 变化只发生在读者身上——原来按栏目分开读的东西，现在按句子聚到一起：
 * 同一句上「被点了名」和「此处合法」挨着摆，某一句谁都没提，也明说出来。
 */
function RereadScreen({ view, onBack }: { view: RereadView; onBack: () => void }) {
  const mapped = view.sentences.length - view.quietCount;
  return (
    <div className="rr-screen" data-reread>
      <div className="rr-head">
        <button className="rr-back" data-reread-back onClick={onBack}>
          ← 回报告
        </button>
        <h2>回到原文</h2>
        <p className="rr-lead">原文没有变化。这里只把报告里已经写下的、指着某一句的条目，搬回那一句旁边。</p>
        <p className="rr-lead2">
          同一句上若同时挂着「命名」和「此处合法」，两条都留着——报告里本来就有这两句话，
          只是分开摆着时看不出来。
        </p>
      </div>

      <div className="rr-stat" data-reread-stat>
        共 {view.sentences.length} 句 · {mapped} 句有条目指着 · {view.quietCount} 句没人提
        {view.unplaced.length > 0 && ` · 另有 ${view.unplaced.length} 条没能指回位置`}
      </div>

      <div className="rr-list">
        {view.sentences.map((s) => (
          <div className={`rr-s${s.quiet ? ' rr-s-quiet' : ''}`} data-reread-sentence key={s.index}>
            <div className="rr-s-head">
              <span className="rr-n">第 {s.index + 1} 句</span>
              {s.quiet && (
                <span className="rr-none" data-reread-quiet>
                  这一句，报告里没有哪一条指到它
                </span>
              )}
            </div>
            <div className="rr-text">{s.text}</div>
            {s.refs.length > 0 && (
              <div className="rr-refs">
                {s.refs.map((r, i) => (
                  <div className={`rr-ref rr-ref-${r.kind}`} data-reread-ref key={`${r.kind}-${r.id}-${i}`}>
                    <span className="rr-kind">{REREAD_KIND_LABEL[r.kind]}</span>
                    <span className="rr-id">{r.id}</span>
                    <span className="rr-body">{r.text}</span>
                    {r.quote && <span className="rr-quote">原文：{r.quote}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {view.unplaced.length > 0 && (
        <div className="rr-unplaced" data-reread-unplaced>
          <b>另有 {view.unplaced.length} 条没能指回原文位置</b>
          <span>没位置不等于没有发现；逐条留在这里，不替它们猜一句。</span>
          <ul>
            {view.unplaced.map((u, i) => (
              <li key={i}>
                <span className="rr-kind">{REREAD_KIND_LABEL[u.kind]}</span>
                <span className="rr-id">{u.id}</span>
                <span>{UNPLACED_LABEL[u.reason]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button className="rr-back rr-back-bottom" data-reread-back onClick={onBack}>
        读完了，回报告
      </button>
    </div>
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
