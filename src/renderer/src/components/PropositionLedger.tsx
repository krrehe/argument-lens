import { ACCEPT_LABEL, BURDEN_LABEL, CONF_LABEL, TAG_LABEL } from '@shared/labels';
import { DECID_GIST, DECID_LABEL, DECID_ORDER, type PropositionView } from '@shared/propositions';
import {
  COLUMN_LABEL,
  FACT_STATE_LABEL,
  LEDGER_BOUNDARY,
  LEDGER_ISOLATION,
  REASON_LABEL,
  STATUS_LABEL,
  type FactState,
  type LedgerGap,
} from '@shared/ledger';

/**
 * 命题账的界面。
 *
 * 它不是一张表：表会让人横着比，而这里横着比是错的——「事实·不可裁」与
 * 「规范·不可裁」不是同一条尺子的两档，是两件不同的事。
 * 所以按三组竖着排，每组开头先说这一组是「什么在挡着」，组内再逐条。
 *
 * 每行按两套来源分开写，不许混：
 *   - **本地归的栏**：按用词读出来的（凭什么这么归、什么条件下改归）；
 *   - **账上记的状态**：模型按 D-02 写的（状态值、依据、A_v、条件式结论、回栏条件、不判七项）。
 * 两边不一致时，那本身就是要登记的差异——所以并排摆，不合成一句。
 */
export function PropositionLedger({ v, gaps }: { v: PropositionView; gaps: LedgerGap[] }) {
  if (!v.total) return null;
  const l = v.ledger;
  const blocks = gaps.filter((g) => g.severity === 'block');
  return (
    <div className="pl">
      {v.routeLine && (
        <div className="pl-route" data-route={v.route}>
          <b>路由</b>
          {v.routeLine}
        </div>
      )}
      {!l && (
        <div className="pl-none" data-ledger="none">
          <b>这把尺子没记账</b>
          这份报告只按用词归了栏，没有逐条写「现在处于什么状态、凭什么、补什么材料能回栏」。
          2.10.0 之前的存档都是这样：不是漏填，是当时还没有这一层。要看状态值，请重跑一次。
        </div>
      )}
      {DECID_ORDER.map((k) => {
        const rows = v.rows.filter((r) => r.decidability === k);
        if (!rows.length) return null;
        return (
          <div className="pl-grp" key={k} data-decid={k}>
            <div className="pl-gh">
              <span className="pl-gt">{DECID_LABEL[k]}</span>
              <span className="pl-gn">{rows.length}</span>
              <span className="pl-gg">{DECID_GIST[k]}</span>
            </div>
            {rows.map((r) => {
              const g = r.ledger;
              return (
                <div className="pl-row" key={r.id} data-prop={r.id}>
                  <div className="pl-l">
                    <span className={`id-badge${r.implicit ? ' impl' : ''}`}>{r.id}</span>
                    <span className="pl-role">
                      {r.roleLabel}
                      {r.implicit ? '·补出的' : ''}
                    </span>
                  </div>
                  <div className="pl-b">
                    <div className="pl-text">{r.text}</div>
                    <div className="pl-meta">
                      <span>
                        {TAG_LABEL[r.tag] ?? r.tag}·置信{CONF_LABEL[r.confidence] ?? r.confidence}
                      </span>
                      <span>可接受性 {ACCEPT_LABEL[r.status] ?? r.status}</span>
                      <span>举证 {r.burdenWho}</span>
                    </div>

                    {g && (
                      <div className="pl-led" data-ledger={g.column} data-status={g.status}>
                        <div className="pl-st">
                          <b>账上</b>
                          <span className="pl-stv">
                            {COLUMN_LABEL[g.column]}·{STATUS_LABEL[g.status]}
                          </span>
                        </div>
                        <div className="pl-f">
                          <b>{g.column === 'fact-undecidable' ? '缺什么' : '依据'}</b>
                          {g.basis}
                        </div>
                        {g.column === 'norm-undecidable' && (
                          <>
                            <div className="pl-f">
                              <b>价值前提 A_v</b>
                              {g.av}
                            </div>
                            <div className="pl-f">
                              <b>事实前提</b>
                              {FACT_STATE_LABEL[(g.factState ?? 'checkable') as FactState]}
                            </div>
                            <div className="pl-f">
                              <b>条件式结论</b>
                              {g.conditional}
                            </div>
                          </>
                        )}
                        {g.noJudge && (
                          <div className="pl-f">
                            <b>不判登记</b>
                            {REASON_LABEL[g.noJudge.reason]}｜举证
                            {BURDEN_LABEL[g.noJudge.burden] ?? g.noJudge.burden}｜复核
                            {g.noJudge.reviewer}
                          </div>
                        )}
                        {g.reentry && (
                          <div className="pl-f">
                            <b>回栏条件</b>
                            {g.reentry}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="pl-why">
                      <b>凭什么这么归</b>
                      {r.basis}
                    </div>
                    <div className="pl-if">
                      <b>什么条件下改归</b>
                      {r.reclassifyIf}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {l && l.fallacies.length > 0 && (
        <div className="pl-fal" data-fal={String(l.fallacies.filter((f) => f.found).length)}>
          <div className="pl-fal-h">谬误谬误筛查：两个方向各查一遍</div>
          <p className="pl-fal-g">
            由推理有缺陷推出结论为假（正向），与由结论为真推出推理无缺陷（反向），是同一个错误的两个方向。
            只禁一边，就成了「对坏论证严格、对好结论宽松」。
          </p>
          {l.fallacies.map((f, i) => (
            <div className="pl-fal-row" key={i} data-dir={f.direction} data-found={f.found}>
              <span className="pl-fal-k">
                {f.direction === 'forward' ? '正向：推理差 → 结论假' : '反向：结论真 → 推理没问题'}
              </span>
              <span className="pl-fal-v">{f.found ? `发现：${f.at}` : '未发现'}</span>
              <span className="pl-fal-n">{f.note}</span>
            </div>
          ))}
        </div>
      )}

      {blocks.length > 0 && (
        <div className="pl-gaps" data-gaps={blocks.length}>
          <div className="pl-gaps-h">这份账有 {blocks.length} 处按 D-02 还不算记完</div>
          <ul>
            {blocks.map((g, i) => (
              <li key={i} data-kind={g.kind}>
                {g.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="pl-d2">
        <b>两本账不许互相转账</b>
        论证好，不能推出结论真（反向谬误谬误）；论证差，也不能推出结论假（谬误谬误）。这一栏就是那道闸：
        把「哪条该由证据定」和「哪条根本不归证据管」分开写，两个方向都不许借道。
        {LEDGER_ISOLATION}
      </p>
      <p className="pl-fine">
        这一栏只归类，不改上面的判读，也不给分。三栏不是三个等级——把它读成「越往下越不可信」就错了：
        一只股票的涨跌能不能算准（不可裁），跟「该不该收遗产税」（规范）不是一类事，没有谁更可信可言。
        另外，规范命题主要靠用词认（应当、不得、合理……）：价值判断要是写得含蓄——「取消早读是错误决定」——
        本地读不出来，它会落在事实那一组，所以账上与本地归的栏不一致是会发生的，那正是要登记的分歧。
        {LEDGER_BOUNDARY}
      </p>
    </div>
  );
}
