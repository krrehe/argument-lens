import { useState } from 'react';
import {
  agreementLine,
  agreementText,
  cellHead,
  cellRest,
  spreadLine,
  type AgreementView,
} from '@shared/agreement';

/** 明细里每组最多直接列几处差异。多出来的在纯文本里全都有，界面上明说还有几处。 */
const SHOW_SPREADS = 6;

/**
 * 同题复跑。真应用读本地存档，预览页喂假数据，两边是同一个组件。
 *
 * 它回答的是样本账的下一个问题：那一组文字里的几十份报告，彼此是什么关系。
 * 只有本地存档答得了——云端对话不保存你上次跑的是什么。
 *
 * 三条不许越界：
 *   1. 不评「稳定 / 不可靠」，不算百分比。只数多少次一样、多少次不一样。
 *   2. 不猜差异从哪来。新报告记了跑它的模型、供应商与生效温度，旧报告没有——
 *      两种情形都必须在界面上说出来，否则那几个数字会被读成它证明不了的东西。
 *   3. 默认收起。它是按下去之前的一眼事实，不是报告的一部分。
 */
export function AgreementBar({
  view,
  dirError,
  fmt,
  initialOpen = false,
}: {
  view: AgreementView | null;
  dirError?: string | null;
  fmt: (at: number) => string;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);

  if (dirError) {
    return (
      <div className="pf-bar" data-agreement-bar data-agreement-error="1">
        <p className="pf-err" data-agreement-error>
          存档目录读不出来：{dirError}。复现的情况没有显示，因为它们不完整。
        </p>
      </div>
    );
  }
  if (!view) return null;
  const line = agreementLine(view);
  if (line === null) return null;

  return (
    <div className="pf-bar" data-agreement-bar data-agreement-repeat={view.repeat.length}>
      <div className="pf-head">
        <p className="pf-line" data-agreement-line>
          {line}
        </p>
        <button className="pf-toggle" data-agreement-open onClick={() => setOpen((o) => !o)}>
          {open ? '收起明细' : '看明细'}
        </button>
      </div>
      {open && (
        <div className="pf-detail" data-agreement-detail>
          <p className="pf-why">
            只有「同一版提示词、同一段字、同一个模式」的报告才放在一起比。改了提示词、换了透镜或模式、
            原文差一个字，都会分成另外一组——那些不是「模型这次说得不一样」。
          </p>
          <ol className="pf-list" data-agreement-cells>
            {view.repeat.map((c) => (
              <li key={c.index} data-agreement-cell data-agreement-spreads={c.spreads.length}>
                {/* 两段而不是一段：模型名从行首开始，不会被断成「gpt-」/「4o-mini」。
                    导出仍是一行（cellLine 把两段拼起来）。 */}
                <span className="ag-head">{cellHead(c)}</span>
                <span className="ag-rest">{cellRest(c, fmt)}</span>
                {c.spreads.length > 0 && (
                  <ul className="ag-spreads">
                    {c.spreads.slice(0, SHOW_SPREADS).map((s) => (
                      <li key={s.path} data-agreement-spread>
                        {spreadLine(s)}
                      </li>
                    ))}
                    {c.spreads.length > SHOW_SPREADS && (
                      <li data-agreement-more>另有 {c.spreads.length - SHOW_SPREADS} 处变过，见下面的纯文本。</li>
                    )}
                  </ul>
                )}
              </li>
            ))}
          </ol>
          {view.singles > 0 && (
            <p className="pf-why" data-agreement-singles>
              另有 {view.singles} 组只跑过一次，没有列出来：跑一遍看不出会不会一样。
            </p>
          )}
          <p className="pf-why" data-agreement-caveat>
            新报告里记了跑它的模型、供应商主机与生效温度；早期存档没有这一栏，明细里写「没记模型」。
            记了也只到这里：同一个模型名不等于同一个版本，供应商什么时候换权重，这份存档不知道；
            没记模型的组，差别分不开「模型每次说得不一样」与「当时换了模型或设置」。
          </p>
          <textarea
            className="pf-text"
            data-agreement-text
            readOnly
            rows={Math.min(16, 4 + view.repeat.length * 2)}
            value={agreementText(view, fmt)}
          />
        </div>
      )}
    </div>
  );
}
