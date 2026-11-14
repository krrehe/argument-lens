import { useContext, useMemo, useState } from 'react';
import { ObjectionCtx } from './Objection';
import { digestOf } from '@shared/objection-digest';

/**
 * 这份报告里你不同意哪几处。
 *
 * 为什么长在报告顶部而不是工作台里：异议是在读报告的过程中一条条记下的，
 * 记完就该在同一屏看见「一共记了几条、分布在哪儿」，否则人要去另一个窗口
 * 才能确认自己刚才那一下有没有记上。工作台那一栏是跨报告的统计（哪一处最常被反对），
 * 这里只回答这一份。
 *
 * 三条不变：
 *   · **没有就不出现。** 零条时整块不渲染，不摆一个空壳说「暂无异议」。
 *   · **只跳不改。** 点「跳到这一节」只是滚动并把那一节展开，不动报告一个字。
 *   · **不评价。** 不说这些异议「有道理」，也不说报告「错了」——谁对谁错这一层，
 *     软件没有资格判，写清楚「两者并列」就够了。
 */
export function ObjectionDigest({ diagId }: { diagId: string }) {
  const ctx = useContext(ObjectionCtx);
  const [open, setOpen] = useState(false);
  const dg = useMemo(() => (ctx ? digestOf(ctx.list, diagId) : null), [ctx, diagId]);

  if (!ctx || !dg || !dg.total) return null;

  /*
   * 跳到那一节：目录面板自己管折叠状态，所以这里只派一个事件过去，
   * 由它把那一节展开——直接删 DOM 上的 data 属性会被下一次重贴盖回来，
   * 表现为「跳过去还是收着的」。事件没人接也不影响滚动，最多是那一节仍收着。
   */
  const jump = (sectionId: string | null) => {
    if (!sectionId) return;
    window.dispatchEvent(new CustomEvent('al:unfold', { detail: { id: sectionId } }));
    const el = document.getElementById(sectionId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('al-jump-hit');
    window.setTimeout(() => el.classList.remove('al-jump-hit'), 1400);
  };

  return (
    <div className="odg" data-obj-digest={dg.total}>
      <div className="odg-head">
        <span className="odg-h">
          这份里你记了 <b>{dg.total}</b> 条不同意
        </span>
        <span className="odg-where">
          {dg.sections.map((s) => `${s.title} ${s.items.length}`).join(' · ')}
        </span>
        <span className="odg-why">报告不改，你的意见与它并列留着。</span>
        <button className="odg-toggle" onClick={() => setOpen(!open)} data-obj-digest-toggle="1">
          {open ? '收起' : '逐条看'}
        </button>
      </div>
      {open && (
        <div className="odg-body">
          {dg.sections.map((s) => (
            <div className="odg-sec" key={`${s.title}:${s.sectionId ?? ''}`}>
              <div className="odg-st">
                <span className="odg-st-t">{s.title}</span>
                <span className="odg-st-n">{s.items.length}</span>
                {s.sectionId && (
                  <button className="odg-jump" onClick={() => jump(s.sectionId)} data-obj-jump={s.sectionId}>
                    跳到这一节
                  </button>
                )}
                {s.unknown && <span className="odg-unk">位置认不出来（旧记录没有这一栏），所以跳不过去</span>}
              </div>
              {s.items.map((o) => (
                <div className="odg-item" key={o.key} data-obj-digest-item="1">
                  <span className="odg-label">{o.refLabel || o.refId || '未命名的一处'}</span>
                  <span className={`odg-reason ${o.reason ? '' : 'dim'}`}>
                    {o.reason || '（没写理由——说「不同意」本身也是信息）'}
                  </span>
                  <button className="odg-undo" onClick={() => ctx.remove(o.key)}>
                    撤销
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
