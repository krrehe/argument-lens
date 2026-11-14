import { ACCEPT_LABEL, CONF_LABEL, TAG_LABEL } from '@shared/labels';
import { DECID_GIST, DECID_LABEL, DECID_ORDER, type PropositionView } from '@shared/propositions';

/**
 * 命题账的界面。
 *
 * 它不是一张表：表会让人横着比，而这里横着比是错的——「事实·证据不足」与
 * 「规范·不由论证裁定」不是同一条尺子的两档，是两件不同的事。
 * 所以按四组竖着排，每组开头先说这一组是「什么在挡着」，组内再逐条。
 *
 * 每行四样东西：这是哪一条、它说了什么、本地凭什么这么归、什么条件下改归另一类。
 * 第三样缺了就是扣帽子，第四样缺了这一栏就只是四个标签。
 */
export function PropositionLedger({ v }: { v: PropositionView }) {
  if (!v.total) return null;
  return (
    <div className="pl">
      {v.routeLine && (
        <div className="pl-route" data-route={v.route}>
          <b>路由</b>
          {v.routeLine}
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
            {rows.map((r) => (
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
            ))}
          </div>
        );
      })}
      <p className="pl-d2">
        <b>两本账不许互相转账</b>
        论证好，不能推出结论真（反向谬误谬误）；论证差，也不能推出结论假（谬误谬误）。这一栏就是那道闸：
        把「哪条该由证据定」和「哪条根本不归证据管」分开写，两个方向都不许借道。
      </p>
      <p className="pl-fine">
        这一栏只归类，不改上面的判读，也不给分。四类不是四个等级——把它读成「越往下越不可信」就错了：
        一只股票的涨跌能不能算准（证据不足），跟「该不该收遗产税」（不由论证裁定）不是一类事，
        没有谁更可信可言。另外，规范命题主要靠用词认（应当、不得、合理……）：价值判断要是写得含蓄
        ——「取消早读是错误决定」——本地读不出来，它会落在事实那一组。这一栏不猜语义。
      </p>
    </div>
  );
}
