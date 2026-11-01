import { useEffect, useMemo, useRef, useState } from 'react';
import type { TheoryId } from '@shared/theories';
import type { PragmaRule } from '@shared/types';
import {
  CLAIM_BY_ID,
  THEORY_BOOKS,
  THEORY_CLAIMS,
  TIER_HINT,
  TIER_LABEL,
  SUB_LABEL,
  claimsOfBook,
  lensClaims,
  sharedClaims,
  searchClaims,
  tierStats,
  type ClaimSub,
  type EvidenceTier,
  type TheoryClaim,
} from '@shared/theory-base';
import { LANDING, LAND_KIND_LABEL } from '@shared/landing';

/**
 * 理论主张库。
 *
 * 这个面板回答的是链条上最后一问：报告说「按这条规则判」→ 卡片说「这条规则
 * 的道理在这」→ 到这里还要再问一句「那你这么说，凭什么，硬到什么程度」。
 *
 * 三条显示纪律：
 *   1. 每条都必须显示「它让本工具做了什么」。没有这一栏的主张就是文档，
 *      不是依据——读者有权只信有落点的那部分。
 *   2. 档位不写成 A/B/C，写全称（一手文献／学界通说／本工具判断）。
 *      字母单独出现时没人知道它什么意思，而这一栏的意义全在分辨。
 *   3. 本工具判断与一手文献同等排场，不做视觉降级。把它们排成小字，
 *      等于暗示「这条不重要」；实际正相反——那是最该被反驳的部分。
 */

const TIER_ORDER: EvidenceTier[] = ['A', 'B', 'C'];

export function TierBadge({ tier }: { tier: EvidenceTier }) {
  return (
    <span className={`tb-tier tb-${tier.toLowerCase()}`} title={TIER_HINT[tier]}>
      {TIER_LABEL[tier]}
    </span>
  );
}

function ClaimRow({ c, focus }: { c: TheoryClaim; focus: boolean }) {
  const [open, setOpen] = useState(false);
  const lands = LANDING[c.id] ?? [];

  /*
   * 从报告边界栏点 id 跳过来时，那一条会自动展开。
   * 原先只高亮不展开，而出处与落点都在折叠区里——用户点过来看到高亮，
   * 还得再点一次才能看到「落在哪」。那个「再点一次」不是小事：
   * README 写的是「点开能看到出处、落点与反对意见」，那就得点到就能看到。
   */
  useEffect(() => {
    if (focus) setOpen(true);
  }, [focus]);

  return (
    <article className={`tb-row ${focus ? 'tb-focus' : ''}`} id={`claim-${c.id}`}>
      <header className="tb-row-head" onClick={() => setOpen((v) => !v)}>
        <span className="tb-id">{c.id}</span>
        <span className="tb-claim">{c.claim}</span>
        <TierBadge tier={c.tier} />
        {c.sub && (
          <span className="tb-sub" title="细分域：同一话题的主张跨编归到这里">
            {SUB_LABEL[c.sub]}
          </span>
        )}
        <span className="tb-caret">{open ? '−' : '+'}</span>
      </header>

      <div className="tb-decides">
        <span className="tb-decides-k">↳</span>
        {c.decides}
      </div>

      {open && (
        <div className="tb-more">
          {c.contested && (
            <div className="tb-contested">
              <span className="tb-contested-k">谁反对</span>
              {c.contested}
            </div>
          )}
          <div className="tb-refs">
            <span className="tb-refs-k">出处</span>
            <ul>
              {c.refs.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
          {/*
            落点：这条主张在软件里变成了什么。
            放进来不是为了好看——库里立过一条规矩「指不出落点的就不是理论基础」，
            而在此之前那 70 条只写着「（行为层）」，等于没有地址。
            现在每个地址都由 check:landing 验过：块在、函数在、区块在。
          */}
          {lands.length > 0 && (
            <div className="tb-land">
              <span className="tb-refs-k" title="这些地址由 npm run check:landing 逐条校验存在">
                落在
              </span>
              <ul>
                {lands.map((l, i) => (
                  <li key={i}>
                    <span className={`tb-land-k tb-land-${l.k}`}>{LAND_KIND_LABEL[l.k]}</span>
                    <code className="tb-land-ref">{l.ref}</code>
                    <span className="tb-land-at">{l.at}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {c.lens && (
            <div className="tb-scope">
              只影响：{c.lens.map((l) => LENS_CN[l] ?? l).join('、')}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

const LENS_CN: Record<string, string> = {
  walton: '型式',
  pragma: '语用辩证',
  ars: '三标准',
  pta: 'PTA',
  toulmin: '图尔敏',
  copi: '名录',
};

export function TheoryBaseDialog({
  onClose,
  initial,
  pragmaRules = [],
}: {
  onClose: () => void;
  initial?: string;
  /** 语用辩证十规则。为空时不渲染那一节——宁可少一节，不显示空壳。 */
  pragmaRules?: PragmaRule[];
}) {
  const [q, setQ] = useState('');
  /** 只看某一档 */
  const [tier, setTier] = useState<EvidenceTier | null>(null);
  /** 只看某一细分域。编是按「理论在回答什么」分的；细分域按「话题」分——举证责任散在两编里，这里一屏看全。 */
  const [sub, setSub] = useState<ClaimSub | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const hits = useMemo(() => {
    let list = searchClaims(q);
    if (tier) list = list.filter((c) => c.tier === tier);
    if (sub) list = list.filter((c) => c.sub === sub);
    return list;
  }, [q, tier, sub]);

  /*
   * 从侧栏点某一条进来时，把它滚进视野。
   *
   * 三个细节都是踩出来的：
   *   1. 等一帧再滚。对话框刚挂载时 .tbl-body 的高度还没算出来，此刻 scrollIntoView
   *      会滚到 0，表现就是「点了没反应」。
   *   2. 用 auto 不用 smooth。瞬时滚动不依赖动画帧，截图与虚拟时间下也可靠；
   *      而这里本来就该「立刻到那儿」，动画只是延迟。
   *   3. 在对话框层做，不在每一条里各挂一个 effect——每条一个 effect 会出现
   *      七八个定时器抢同一个滚动容器。
   */
  useEffect(() => {
    if (!initial) return;
    const timer = window.setTimeout(() => {
      const el = document.getElementById(`claim-${initial}`);
      if (el && bodyRef.current) {
        // 只滚容器，不动整页。用 offsetTop 而不是 scrollIntoView，后者会连带滚动祖先。
        const top = el.offsetTop - bodyRef.current.offsetTop - bodyRef.current.clientHeight / 2 + el.clientHeight / 2;
        bodyRef.current.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
      }
    }, 60);
    return () => window.clearTimeout(timer);
  }, [initial]);

  const stats = tierStats();
  const searching = q.trim().length > 0 || tier !== null || sub !== null;

  return (
    <div className="mask" onClick={onClose}>
      <div className="dialog tbl" onClick={(e) => e.stopPropagation()}>
        <header className="tbl-head">
          <div>
            <div className="tbl-title">理论主张库</div>
            <div className="tbl-sub">
              报告里每一个判断，往上都能追到这里的某一条。每条都写着它有多硬，以及<b>它让本工具做了什么</b>
              ——指不出落点的主张，不该被当成依据。
            </div>
          </div>
          <button className="ghost-btn" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="tbl-bar">
          <input
            className="tbl-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜主张、落点或出处，例如「举证」「受众」「Fricker」"
          />
          <div className="tbl-tiers">
            {TIER_ORDER.map((t) => (
              <button
                key={t}
                className={`tbl-tf ${tier === t ? 'on' : ''} tb-${t.toLowerCase()}`}
                onClick={() => setTier(tier === t ? null : t)}
                title={TIER_HINT[t]}
              >
                {TIER_LABEL[t]} <b>{stats[t]}</b>
              </button>
            ))}
            {(tier || sub) && (
              <button
                className="tbl-clear"
                onClick={() => {
                  setTier(null);
                  setSub(null);
                }}
              >
                取消筛选
              </button>
            )}
          </div>
        </div>

        {/*
          细分域一行：第二根轴。硬数字摆出来（每域几条），
          免得这一排 chips 看着像功能，实际一个条目都没有的也混在里面。
        */}
        <div className="tbl-subs">
          {(Object.keys(SUB_LABEL) as ClaimSub[]).map((s) => {
            const n = THEORY_CLAIMS.filter((c) => c.sub === s).length;
            return (
              <button
                key={s}
                className={`tbl-tf tbl-subf ${sub === s ? 'on' : ''}`}
                onClick={() => setSub(sub === s ? null : s)}
              >
                {SUB_LABEL[s]} <b>{n}</b>
              </button>
            );
          })}
        </div>

        {!searching && (
          <p className="tbl-note">
            全部 {THEORY_CLAIMS.length} 条里，{TIER_LABEL.A} {stats.A} 条、
            {TIER_LABEL.B} {stats.B} 条、{TIER_LABEL.C} {stats.C} 条。
            <b>后两档加起来比第一档多，这是实情，不是谦虚</b>
            ——一个论证分析工具里，真正能追到原文的说法只占少数，其余是有理由的推论。分开标出来，你才知道该信到哪一层。
          </p>
        )}

        <div className="tbl-body" ref={bodyRef}>
          {searching ? (
            hits.length ? (
              <>
                <div className="tbl-hitcount">命中 {hits.length} 条</div>
                {hits.map((c) => (
                  <ClaimRow key={c.id} c={c} focus={initial === c.id} />
                ))}
              </>
            ) : (
              <div className="tbl-empty">
                没有命中。试试更短的词，或者点上面的档位看看那一档都有什么。
              </div>
            )
          ) : (
            THEORY_BOOKS.map((b) => {
              const list = claimsOfBook(b.n);
              return (
                <section className="tb-book" key={b.n}>
                  <div className="tb-book-head">
                    <span className="tb-book-n">{b.n}</span>
                    <span className="tb-book-t">{b.title}</span>
                    <span className="tb-book-asks">{b.asks}</span>
                    {/*
                      工程判断编标出来：第七编整编都是「本工具的判断」，
                      它说的是工具做了什么决定，不是文献结论。不标出来，
                      读者会拿文献编的标准去要求它——那不是它该被检验的方式。
                    */}
                    {b.engineering && (
                      <span
                        className="tb-book-eng"
                        title="这一编是工程判断编：整编都是本工具的判断（C 档），不是文献结论"
                      >
                        工程判断编
                      </span>
                    )}
                    <span className="tb-book-c">{list.length} 条</span>
                  </div>
                  {list.map((c) => (
                    <ClaimRow key={c.id} c={c} focus={initial === c.id} />
                  ))}
                </section>
              );
            })
          )}

          {/* 十规则单独成节：它不是「主张」，是语用辩证透镜的细则来源。 */}
          {!searching && pragmaRules.length > 0 && <RuleSection rules={pragmaRules} />}
        </div>

        <footer className="tbl-foot">
          <span className="tbl-foot-key">↳</span> 灰底那一行是「它让本工具做了什么」。展开任一条，还能看到它的
          <b>落点</b>——提示词块、透镜片段、代码里的函数、或界面区块，每一个地址都由{' '}
          <code>npm run check:landing</code> 逐条验过存在。没有落点的主张不配当依据，所以那一栏是必填。
          <span className="tbl-foot-dim">
            这份库与 docs/理论支撑/ 十编一一对应。改了代码不改这里，两边就会脱节——所以它和代码放在同一个仓库里。
          </span>
        </footer>
      </div>
    </div>
  );
}

/**
 * 十规则。与上面的「主张」分开的理由：主张是要被质疑的，规则是要被执行的那一版。
 *
 * 每条给三样：它守什么（why）、违反长什么样（violates）、本工具把它落在哪（codify）。
 * 中间那栏最容易写，两边最容易被跳过——而「守什么」才是它凭什么叫规则的东西。
 */
function RuleSection({ rules }: { rules: PragmaRule[] }) {
  const [open, setOpen] = useState(false);

  return (
    <section className="tb-book tb-rule-sec">
      <div className="tb-book-head tb-rule-head" onClick={() => setOpen((v) => !v)}>
        <span className="tb-book-n">附</span>
        <span className="tb-book-t">语用辩证十规则</span>
        <span className="tb-book-asks">每条规则守的是辩论的哪一环</span>
        <span className="tb-book-c">
          {rules.length} 条 {open ? '−' : '+'}
        </span>
      </div>

      {open && (
        <>
          <p className="tb-rule-intro">
            这十条不要求先给谬误命名：判定的形式是「第 4 条被违反，因为用了与结论无关的理由」。
            它们只在说话人确实以解决分歧为目标时成立，对广告、社论套用是范畴错误。
          </p>
          {rules.map((r) => (
            <article className="tb-rule" key={r.n}>
              <header className="tb-rule-t">
                <span className="tb-rule-n">R{r.n}</span>
                {r.name}
              </header>
              <div className="tb-rule-row">
                <span className="tb-rule-k">规则</span>
                <span className="tb-rule-v">{r.rule}</span>
              </div>
              <div className="tb-rule-row tb-rule-row-why">
                <span className="tb-rule-k">它守什么</span>
                <span className="tb-rule-v tb-rule-why">{r.why}</span>
              </div>
              <div className="tb-rule-row">
                <span className="tb-rule-k">违反长这样</span>
                <span className="tb-rule-v">{r.violates}</span>
              </div>
              <div className="tb-rule-row">
                <span className="tb-rule-k">落在哪</span>
                <span className="tb-rule-v tb-rule-code">{r.codify}</span>
              </div>
            </article>
          ))}
        </>
      )}
    </section>
  );
}

/**
 * 透镜卡片底部那一小段：「这一栏站在哪几条主张上」。
 *
 * 只列 id 与半句话，不列全文——侧栏只有 300px 宽，把三十个字塞进去会变成
 * 一堵墙。想看全文点开，那里有整条。
 *
 * 只列**这副透镜专有**的。六副共用的底座（论证是什么、机器能做什么）
 * 单独一句话交代数量——全部列进来的结果是二十九条，而二十九条等于没有信息。
 */
export function ClaimRefs({ theory, onOpen }: { theory: TheoryId; onOpen: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const list = lensClaims(theory);
  const shared = sharedClaims();
  if (!list.length) return null;

  const shown = all ? list : list.slice(0, 3);
  const rest = list.length - shown.length;

  return (
    <div className="tb-refs-inline">
      <div className="tb-ri-head">
        这一栏专有的 {list.length} 条主张
        <span className="tb-ri-hint">点一条看它凭什么、硬到什么程度</span>
      </div>
      <div className="tb-ri-list">
        {shown.map((c) => (
          <button key={c.id} className="tb-ri" onClick={() => onOpen(c.id)} title={c.claim}>
            <span className="tb-ri-id">{c.id}</span>
            <span className="tb-ri-t">{CLAIM_BY_ID[c.id].claim}</span>
            <TierBadge tier={c.tier} />
          </button>
        ))}
      </div>
      {rest > 0 && (
        <button className="tb-ri-more" onClick={() => setAll(true)}>
          还有 {rest} 条
        </button>
      )}
      <p className="tb-ri-shared">
        另有 {shared.length} 条是六副透镜共用的底座（论证是什么、机器能做什么、理论怎么落到代码），
        不在这一栏单独列。
      </p>
    </div>
  );
}
