import { useEffect, useState } from 'react';
import type { FlowGroup, FlowRow, FlowStatus, FlowView } from '@shared/flow';

/**
 * 全流程账：这份报告是照流程走出来的，还是跳着走的。
 *
 * 排版上的三个决定：
 *
 *   1. **按 A–E 分组，不按状态排。** 状态排序（把「没做」全提到最上面）看起来更抓眼，
 *      但它会把这十六步的顺序打乱——而顺序本身就是这一栏要说的事之一。
 *   2. **每一步都写「本地看到了什么」。** 只写「没做」而不写看到了什么，读者没法核对，
 *      只能相信这块板子；写了证据，他可以不同意。
 *   3. **不出现分数、百分比、及格线。** 「走了 9 步」是数出来的，「这报告 60 分」是编出来的。
 */
const GROUP_NAME: Record<FlowGroup, string> = {
  A: '立案',
  B: '重构',
  C: '检验',
  D: '裁决',
  E: '交付',
};

const STATUS_LABEL: Record<FlowStatus, string> = {
  ok: '做了',
  partial: '一半',
  gap: '没做',
  na: '这一档不走',
};

const STATUS_MARK: Record<FlowStatus, string> = {
  ok: '✓',
  partial: '~',
  gap: '×',
  na: '–',
};

export function FlowLedger({ v }: { v: FlowView }) {
  /*
   * 哪几个落点这一份报告里真的在。
   *
   * 为什么不按数据算：同一栏在渲染层有六七个分支（透镜按 kind 分、反驳按模式开关、
   * 命题账与枢纽按数据），把那份判断抄进纯函数，改一处分支这边就会说假话——
   * 而假话的样子是一个点了没反应的按钮，读起来最像「软件卡了一下」。
   * 所以这里当场看 DOM：挂载后问一遍，答不上来的就不给按钮。
   */
  const [here, setHere] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const r of v.rows) if (r.at) next[r.at] = !!document.getElementById(r.at);
    setHere(next);
  }, [v]);

  const jump = (id: string | null) => {
    if (!id) return;
    /* 立案卡不在报告里，在输入区：它要先展开，再滚过去。两件事都由 App 做，
       因为展开状态归它管——这一层只发一句「去看立案」，不替它改状态。 */
    if (id === 'brief-card') {
      window.dispatchEvent(new CustomEvent('al:brief'));
      return;
    }
    window.dispatchEvent(new CustomEvent('al:unfold', { detail: { id } }));
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('al-jump-hit');
    window.setTimeout(() => el.classList.remove('al-jump-hit'), 1400);
  };

  const groups: FlowGroup[] = ['A', 'B', 'C', 'D', 'E'];

  return (
    <div className="wf" data-flow={v.rows.length} data-depth={v.depth}>
      <p className="wf-line" data-flow-line>
        {v.line}
      </p>

      {v.breach && (
        <div className="wf-breach" data-flow-breach="1">
          {v.breach}
        </div>
      )}

      <p className="wf-depth">
        档位：<b>{v.depthLabel}</b>（{v.depthWhy}）
        <span className="wf-depth-note">
          —— 这一档要走哪几步由文档 §0.1 定；不在这档里的步骤，没做也不算缺。
        </span>
      </p>

      {groups.map((g) => {
        const rows = v.rows.filter((r) => r.group === g);
        if (!rows.length) return null;
        return (
          <div className="wf-group" key={g} data-flow-group={g}>
            <div className="wf-ghead">
              <span className="wf-gid">{g}</span>
              <span className="wf-gname">{GROUP_NAME[g]}</span>
            </div>
            {rows.map((r) => (
              <Row key={r.id} r={r} here={here} onJump={jump} />
            ))}
          </div>
        );
      })}

      <p className="wf-fine">{v.fine}</p>
    </div>
  );
}

function Row({
  r,
  here,
  onJump,
}: {
  r: FlowRow;
  here: Record<string, boolean>;
  onJump: (id: string | null) => void;
}) {
  /* 落点不在这一份里就不给按钮：宁可少一个入口，也不留一个点了没反应的。 */
  const to = r.at && here[r.at] ? r.at : null;
  return (
    <div className="wf-row" data-flow-row={r.id} data-status={r.status}>
      <span className={`wf-mark m-${r.status}`} title={STATUS_LABEL[r.status]}>
        {STATUS_MARK[r.status]}
      </span>
      <span className="wf-id">{r.id}</span>
      <span className="wf-name">{r.name}</span>
      <div className="wf-body">
        <div className="wf-saw" data-saw>
          {r.saw}
        </div>
        {r.note && <div className="wf-note">{r.note}</div>}
        {r.next && <div className="wf-next">下一步：{r.next}</div>}
      </div>
      {to ? (
        <button
          className="wf-go"
          onClick={() => onJump(to)}
          data-flow-go={r.id}
          data-flow-to={to}
          title={r.goLabel}
        >
          {r.goLabel}
        </button>
      ) : (
        <span className="wf-go wf-go-none" aria-hidden="true" />
      )}
    </div>
  );
}
