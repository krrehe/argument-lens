import { useEffect, useMemo, useState } from 'react';
import type { Pricing, UsageRow, UsageSummary } from '@shared/types';
import { THEORY_BY_ID } from '@shared/theories';
import { formatAgo, formatMoney, formatTokens } from '@shared/tokens';

/**
 * 用量与余额。
 *
 * 这个面板只回答两个问题：
 *   1. 这次花了多少？
 *   2. 我的钱还够跑几次？
 *
 * 刻意不做的事（每一条都是克制）：
 *   - 不做权威价目表。供应商的价格会变，写死的表迟早是错的，
 *     而一个错的价格算出来的钱比「没显示」更有害——用户会当真。
 *     所以内置价只填空档：用户没填过才用它估个量级，永远不覆盖用户填的。
 *   - 不自动查余额。各家接口不统一，做不到就别假装能做到。
 *     记一笔锚点，从那里往后扣，这是唯一能对上真账单的办法。
 *   - 不做预算告警弹窗。额度快用完时顶栏那个数字会变色，就够了。
 *     弹窗拦下来的那次分析，用户本来是要用的。
 */

/* ─────────── 顶栏芯片 ─────────── */

export function UsageChip({ summary, onClick }: { summary: UsageSummary | null; onClick: () => void }) {
  if (!summary) return null;

  const { today, balance, hasPricing } = summary;
  const runs = balance.runsLeft;
  const state = runs === null ? '' : runs <= 0 ? 'bad' : runs <= 3 ? 'warn' : '';

  /*
   * 能不能显示钱，看的不是「用户填没填」，而是「有没有一套价可用」。
   * 内置参考价可用时也显示金额，但前面加个「约」：估的和记的是两件事，
   * 不加这个字，用户会拿它去对账单。
   */
  const showMoney = summary.pricingSource !== 'none';
  const approx = summary.pricingSource === 'builtin' ? '约 ' : '';
  const main = showMoney
    ? `今日 ${approx}${formatMoney(today.cost, summary.pricing.currency)}`
    : `今日 ${today.count} 次`;

  return (
    <button
      className={`usage-chip ${state}`}
      onClick={onClick}
      title={
        showMoney
          ? `本月 ${approx}${formatMoney(summary.month.cost, summary.pricing.currency)} · ${summary.month.okCount} 次` +
            (hasPricing ? '' : '\n单价是内置参考价，可在明细里改成你自己的账单单价') +
            '\n点开看明细与余额'
          : '还没填单价，这个模型也没有内置参考价，先只记次数。点开填一下就能看到钱。'
      }
    >
      <span className="uc-dot" />
      {main}
      {runs !== null && <span className="uc-runs">约 {runs} 次</span>}
    </button>
  );
}

/* ─────────── 面板 ─────────── */

export function UsagePanel({ onClose, onChanged }: { onClose: () => void; onChanged: (s: UsageSummary) => void }) {
  const [s, setS] = useState<UsageSummary | null>(null);
  const [inPerM, setInPerM] = useState('');
  const [outPerM, setOutPerM] = useState('');
  const [currency, setCurrency] = useState('¥');
  const [anchorInput, setAnchorInput] = useState('');
  const [anchorNote, setAnchorNote] = useState('');
  const [editingAnchor, setEditingAnchor] = useState(false);
  const [saved, setSaved] = useState<'price' | 'anchor' | null>(null);
  const [exported, setExported] = useState<string | null>(null);

  const apply = (next: UsageSummary) => {
    setS(next);
    onChanged(next);
  };

  useEffect(() => {
    window.api.usage.summary().then((x) => {
      setS(x);
      setInPerM(x.pricing.inPerM ? String(x.pricing.inPerM) : '');
      setOutPerM(x.pricing.outPerM ? String(x.pricing.outPerM) : '');
      setCurrency(x.pricing.currency);
      setEditingAnchor(!x.balance.anchor);
    });
  }, []);

  const num = (v: string) => {
    const n = Number(v.replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  const savePricing = async () => {
    const patch: Partial<Pricing> = { inPerM: num(inPerM), outPerM: num(outPerM), currency: currency || '¥' };
    apply(await window.api.usage.setPricing(patch));
    setSaved('price');
  };

  const saveAnchor = async () => {
    apply(await window.api.usage.setAnchor(num(anchorInput), anchorNote));
    setEditingAnchor(false);
    setAnchorInput('');
    setAnchorNote('');
    setSaved('anchor');
  };

  const clearAnchor = async () => {
    apply(await window.api.usage.clearAnchor());
    setEditingAnchor(true);
  };

  const doExport = async () => {
    const r = await window.api.usage.exportCsv();
    if (r.ok && r.path) setExported(r.path);
  };

  return (
    <div className="mask" onClick={onClose}>
      <div className="dialog usage" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head u-head">
          <span>用量与余额</span>
          <span className="u-head-sub">账本只存在这台电脑上，不上传</span>
          <div className="spacer" />
          <button className="u-x" onClick={onClose} title="关闭">
            ×
          </button>
        </div>

        <div className="dialog-body u-body">
          {!s ? (
            <div className="u-loading">正在读账本…</div>
          ) : (
            <>
              <Kpis s={s} />

              {/* 还没填单价时把单价提到最上面：不填就看不到钱，这是第一个该做的事 */}
              {!s.hasPricing && (
                <PricingBlock
                  inPerM={inPerM}
                  outPerM={outPerM}
                  currency={currency}
                  setInPerM={setInPerM}
                  setOutPerM={setOutPerM}
                  setCurrency={setCurrency}
                  onSave={savePricing}
                  saved={saved === 'price'}
                  first
                />
              )}

              <BalanceBlock
                s={s}
                editing={editingAnchor}
                onEdit={() => setEditingAnchor(true)}
                onCancel={() => setEditingAnchor(false)}
                anchorInput={anchorInput}
                setAnchorInput={setAnchorInput}
                anchorNote={anchorNote}
                setAnchorNote={setAnchorNote}
                onSave={saveAnchor}
                onClear={clearAnchor}
              />

              <DayChart s={s} />

              <RecentTable s={s} onExport={doExport} exported={exported} />

              {s.hasPricing && (
                <PricingBlock
                  inPerM={inPerM}
                  outPerM={outPerM}
                  currency={currency}
                  setInPerM={setInPerM}
                  setOutPerM={setOutPerM}
                  setCurrency={setCurrency}
                  onSave={savePricing}
                  saved={saved === 'price'}
                />
              )}

              <Honesty s={s} onReveal={() => window.api.usage.reveal()} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────── 单价 ─────────── */

function PricingBlock({
  inPerM,
  outPerM,
  currency,
  setInPerM,
  setOutPerM,
  setCurrency,
  onSave,
  saved,
  first,
}: {
  inPerM: string;
  outPerM: string;
  currency: string;
  setInPerM: (v: string) => void;
  setOutPerM: (v: string) => void;
  setCurrency: (v: string) => void;
  onSave: () => void;
  saved: boolean;
  /** 首次填写：语气要更明确，因为这一步不做就看不到任何金额 */
  first?: boolean;
}) {
  return (
    <div className={`u-pricing ${first ? 'first' : ''}`}>
      <div className="u-sec-title">
        单价
        {first && <span className="u-sec-note">没填就按内置参考价估，填了以你为准</span>}
      </div>
      <div className="u-price-row">
        <label>
          输入 · 每百万 token
          <input value={inPerM} onChange={(e) => setInPerM(e.target.value)} placeholder="例如 2" inputMode="decimal" />
        </label>
        <label>
          输出 · 每百万 token
          <input value={outPerM} onChange={(e) => setOutPerM(e.target.value)} placeholder="例如 8" inputMode="decimal" />
        </label>
        <label className="u-cur">
          货币
          <input value={currency} onChange={(e) => setCurrency(e.target.value.slice(0, 3))} />
        </label>
        <button className="primary u-save" onClick={onSave}>
          保存
        </button>
      </div>
      <p className="u-fine">
        去供应商控制台的「价格 / 计费」页抄两个数字，填一次就够。
        <b>你填的永远优先</b>——供应商会调价，写死的表迟早是错的，而用错的价算出来的钱，比不显示更害人。
        没填的时候，只有几个常见模型会用内置参考价估个量级，金额前面标「约」、明细里标「估算」；
        不在表里的模型宁可不写，那一栏就空着。
        改价之后：以后的分析按新价记；之前<b>没填过单价</b>的旧记录会按新价补算，明细里能看到标记。
        {saved && <span className="u-ok">已保存。</span>}
      </p>
    </div>
  );
}

/* ─────────── 三个大数字 ─────────── */

function Kpis({ s }: { s: UsageSummary }) {
  const cur = s.pricing.currency;
  const runs = s.balance.runsLeft;

  /*
   * 顺序有讲究：第一个是「还能跑几次」，因为这才是用户真正的问题。
   * 「本月 26 次」只是背景信息，放第三。
   */
  const runsNode =
    runs === null ? (
      <>
        <b className="u-unknown">还不知道</b>
        <span>{s.balance.anchor ? '先跑一次，有了均价就能算' : '记一笔余额后可以算'}</span>
      </>
    ) : (
      <>
        <b className={runs <= 0 ? 'bad' : runs <= 3 ? 'warn' : ''}>{runs}</b>
        <span>次 · 按最近 {s.balance.avgBasis} 次均价推算</span>
      </>
    );

  return (
    <div className="u-kpis">
      <div className="u-kpi wide">
        <div className="u-kpi-label">还能跑</div>
        <div className="u-kpi-val">{runsNode}</div>
      </div>
      <div className="u-kpi">
        <div className="u-kpi-label">本月花费</div>
        <div className="u-kpi-val">
          <b>{s.pricingSource === 'none' ? '—' : formatMoney(s.month.cost, cur)}</b>
          <span>
            {s.pricingSource === 'none'
              ? '无单价'
              : s.pricingSource === 'builtin'
                ? `${s.month.okCount} 次 · 估算`
                : `${s.month.okCount} 次`}
          </span>
        </div>
      </div>
      <div className="u-kpi">
        <div className="u-kpi-label">今天</div>
        <div className="u-kpi-val">
          <b>{s.today.count}</b>
          <span>{s.today.tokens > 0 ? `次 · ${formatTokens(s.today.tokens)} token` : '次'}</span>
        </div>
      </div>
    </div>
  );
}

/* ─────────── 余额尺 ─────────── */

function BalanceBlock({
  s,
  editing,
  onEdit,
  onCancel,
  anchorInput,
  setAnchorInput,
  anchorNote,
  setAnchorNote,
  onSave,
  onClear,
}: {
  s: UsageSummary;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  anchorInput: string;
  setAnchorInput: (v: string) => void;
  anchorNote: string;
  setAnchorNote: (v: string) => void;
  onSave: () => void;
  onClear: () => void;
}) {
  const cur = s.pricing.currency;
  const { anchor, spentSince, remaining } = s.balance;

  /* 已花占比。锚点金额为 0 时不画进度，避免除零画出一条满格 */
  const total = anchor ? anchor.amount : 0;
  const usedPct = total > 0 && remaining !== null ? Math.min(100, (spentSince / total) * 100) : 0;

  return (
    <div className="u-bal">
      <div className="u-sec-title">
        余额
        <span className="u-sec-note">
          {anchor ? `你在 ${formatAgo(anchor.at)} 记的是 ${formatMoney(anchor.amount, cur)}` : '还没记过'}
        </span>
        <div className="spacer" />
        {anchor && (
          <>
            <button className="u-mini" onClick={onEdit}>
              重记
            </button>
            <button className="u-mini" onClick={onClear}>
              清掉
            </button>
          </>
        )}
      </div>

      {anchor && remaining !== null ? (
        <>
          <div className="u-bar" title={`已花 ${formatMoney(spentSince, cur)} / 共 ${formatMoney(total, cur)}`}>
            <i className="u-bar-used" style={{ width: `${usedPct}%` }} />
            <i className="u-bar-left" style={{ width: `${100 - usedPct}%` }} />
          </div>
          <div className="u-bar-legend">
            <span className="lb-used">已花 {formatMoney(spentSince, cur)}</span>
            <span className="lb-left">剩 {formatMoney(remaining, cur)}</span>
          </div>
        </>
      ) : (
        <div className="u-bar-empty">
          没有余额数就没法算「还能跑几次」。打开供应商控制台看一眼还剩多少，填进来——
          <b>这个数只需要填一次，之后每次分析会自动从里面扣。</b>
        </div>
      )}

      {editing ? (
        <div className="u-anchor-form">
          <input
            className="u-anchor-amount"
            value={anchorInput}
            onChange={(e) => setAnchorInput(e.target.value)}
            placeholder={`此刻账户余额，如 50`}
            inputMode="decimal"
          />
          <input
            className="u-anchor-note"
            value={anchorNote}
            onChange={(e) => setAnchorNote(e.target.value)}
            placeholder="备注（可空）：充值 50 / 核对账单"
          />
          <button className="primary" onClick={onSave} disabled={!anchorInput.trim()}>
            记下
          </button>
          {anchor && (
            <button className="ghost-btn" onClick={onCancel}>
              取消
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ─────────── 近 14 天 ─────────── */

function DayChart({ s }: { s: UsageSummary }) {
  const cur = s.pricing.currency;
  // 能不能按钱画，看的是「有没有一套价可用」，不是「用户填没填」
  const priced = s.pricingSource !== 'none';
  const max = Math.max(...s.daily.map((d) => (priced ? d.cost : d.count)), 0);
  const todayKey = s.daily[s.daily.length - 1]?.date;

  const peak = useMemo(() => {
    if (!max) return null;
    const d = s.daily.reduce((a, b) => ((priced ? b.cost : b.count) > (priced ? a.cost : a.count) ? b : a));
    return d;
  }, [s.daily, max, priced]);

  if (!s.daily.some((d) => d.count > 0)) {
    return (
      <div className="u-chart-wrap">
        <div className="u-sec-title">近 14 天</div>
        <div className="u-chart-empty">还没有记录。跑一次分析，这里就会有第一根柱子。</div>
      </div>
    );
  }

  return (
    <div className="u-chart-wrap">
      <div className="u-sec-title">
        近 14 天
        <span className="u-sec-note">
          {peak && peak.count > 0
            ? `最高一天 ${priced ? formatMoney(peak.cost, cur) : `${peak.count} 次`}（${peak.date.slice(5)}）`
            : ''}
        </span>
      </div>
      <div className="u-chart">
        {s.daily.map((d, i) => {
          const v = priced ? d.cost : d.count;
          const h = max > 0 ? Math.max(v > 0 ? 4 : 0, (v / max) * 100) : 0;
          const isToday = d.date === todayKey;
          return (
            <div className={`u-day ${isToday ? 'today' : ''}`} key={d.date}>
              <div className="u-day-track">
                <i
                  style={{ height: `${h}%` }}
                  title={`${d.date}　${d.count} 次　${formatTokens(d.tokens)} token${
                    priced ? `　${formatMoney(d.cost, cur)}` : ''
                  }`}
                />
              </div>
              {(i === 0 || i === 7 || isToday) && <span className="u-day-lb">{isToday ? '今天' : d.date.slice(5)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────── 明细 ─────────── */

function RecentTable({
  s,
  onExport,
  exported,
}: {
  s: UsageSummary;
  onExport: () => void;
  exported: string | null;
}) {
  const cur = s.pricing.currency;

  if (!s.recent.length) return null;

  return (
    <div className="u-recent">
      <div className="u-sec-title">
        明细
        <span className="u-sec-note">最近 {s.recent.length} 条</span>
        <div className="spacer" />
        <button className="u-mini" onClick={onExport}>
          导出 CSV
        </button>
      </div>

      <div className="u-table">
        <div className="u-tr u-th">
          <span>时间</span>
          <span>透镜</span>
          <span className="num">输入</span>
          <span className="num">输出</span>
          <span className="num">费用</span>
          <span className="num">耗时</span>
        </div>
        {s.recent.map((r) => (
          <Row key={r.id} r={r} s={s} cur={cur} />
        ))}
      </div>

      {exported && <div className="u-ok-block">已导出到 {exported}</div>}
    </div>
  );
}

function Row({ r, s, cur }: { r: UsageRow; s: UsageSummary; cur: string }) {
  const theory = r.theory ? THEORY_BY_ID[r.theory]?.short ?? r.theory : '—';
  const est = r.estimated;
  /*
   * 费用列：用主进程算好的 effCost，不在这里读 r.cost。
   * 当时没填单价的记录会被按现价回填，并标上「回填」——
   * 不标的话，用户改了单价会以为历史被篡改了；不按同一个算法算，
   * 明细加起来就对不上上面的合计，那比贵一块钱更糟。
   */
  const showCost = s.pricingSource !== 'none' && r.ok;

  return (
    <div className={`u-tr ${r.ok ? '' : 'dead'}`} title={`${r.model} @ ${r.host}　原文 ${r.chars} 字`}>
      <span className="dim">{formatAgo(r.at)}</span>
      <span>{theory}</span>
      <span className="num">
        {formatTokens(r.promptTokens)}
        {est && <sup className="est" title="接口没返回用量，这个数是本地按字数估的">估</sup>}
      </span>
      <span className="num">
        {r.ok ? formatTokens(r.completionTokens) : '—'}
        {est && r.ok && <sup className="est">估</sup>}
      </span>
      <span className="num">
        {r.ok ? (
          showCost ? (
            <>
              {formatMoney(r.effCost, cur)}
              {/*
                标记写成两个字，不是「回」。
                「回」在小字号下就是方框套方框，跟缺字时那个豆腐块长得一模一样——
                一个用来解释「这个数不是当天的真实花费」的标记，自己被读成乱码，
                那它还不如不写。
              */}
              {r.backfilled && (
                <span className="est-note" title="这条记录当时没填单价，金额是按现价回填的">
                  回填
                </span>
              )}
            </>
          ) : (
            '—'
          )
        ) : (
          <em>未完成</em>
        )}
      </span>
      <span className="num dim">{(r.ms / 1000).toFixed(1)}s</span>
    </div>
  );
}

/* ─────────── 数字有多硬 ─────────── */

function Honesty({ s, onReveal }: { s: UsageSummary; onReveal: () => void }) {
  const measured = Math.round((1 - s.estimatedShare) * 100);

  /* 一条成功记录都没有时，百分比是没有意义的（分母为 0，会显示「100% 实测」）——那是在撒谎 */
  if (!s.all.okCount) {
    return (
      <div className="u-honest">
        <div className="u-sec-title">这些数字有多硬</div>
        <p className="u-fine">
          还没有成功完成的记录。等跑过一次分析，这里会写清楚哪些数是接口如实返回的、哪些是本地估的、
          哪些是你手填的——三者的硬度差很多，不能混在一起看。
        </p>
      </div>
    );
  }

  return (
    <div className="u-honest">
      <div className="u-sec-title">这些数字有多硬</div>
      <ul>
        <li>
          <b>token 数</b>：其中 {measured}% 是接口如实返回的，{100 - measured}% 是本地按字数估的（误差约 ±25%）。
          明细里带「估」字的就是估的。
        </li>
        <li>
          <b>钱</b>：
          {s.pricingSource === 'user'
            ? '按你填的单价算，不是按账单算。每条记录都存着当时的单价，所以改价不会翻旧账；'
            : s.pricingSource === 'builtin'
              ? '按内置参考价估的，量级对、具体数以账单为准。填上你自己的单价，就会改用你的。'
              : '这个模型没有内置参考价，你也还没填单价，所以金额一栏是空的——不是 0。'}
          {s.backfilled > 0
            ? `有 ${s.backfilled} 条当时还没有单价，按现在的价补算，明细里标着「回填」的就是——那不是当天的真实花费，别拿它去对账单。`
            : '目前没有需要按现价补算的记录。'}
        </li>
        <li>
          <b>模拟调用不进账</b>：冒烟测试跑的是本地假服务器，它返回的 token 是编好的固定值。
          {s.mockExcluded > 0
            ? `流水里还留着 ${s.mockExcluded} 条（可追溯、未删除），但不计入上面任何合计——`
            : '目前一条都没有。'}
          {s.mockExcluded > 0 ? '否则「用了多少次」里会混着根本没发生的调用，账本就不再是账本。' : ''}
        </li>
        <li>
          <b>缓存命中</b>：
          {s.cacheHitShare === null
            ? '这家供应商没报前缀缓存的命中数，所以这一项算不出来（算不出来就空着，不猜）。'
            : `最近这几次的输入 token 里，约 ${Math.round(s.cacheHitShare * 100)}% 命中了接口的前缀缓存。` +
              '命中部分单价低得多（通常约 1/5）。' +
              '这个数掉到接近 0 就是回归：说明提示词的 system 又变成每次都不一样了，' +
              '那样每次都会按未命中价付费，而除了这一栏，没有地方看得出来。'}
        </li>
        <li>
          <b>失败的调用记 0 元</b>，因为拿不到用量。但超时、解析失败这类情况，钱大概率已经花了——
          所以真实支出会比这里显示的多一点点。这是这份账唯一系统性偏小的地方。
        </li>
        <li>
          <b>余额</b>：你手记的那一个数往后扣的，不是从供应商查来的。
          {s.balance.anchor ? `如果你另外充值了，重记一次即可，不用管中间花掉多少。` : ''}
        </li>
      </ul>
      <p className="u-fine">
        所以：这份数据够用来看趋势、比透镜、估还能跑几次；不够用来对账。
        对账请导出 CSV，和供应商账单逐条核。
        <button className="u-link" onClick={onReveal}>
          打开账本文件夹
        </button>
      </p>
    </div>
  );
}
