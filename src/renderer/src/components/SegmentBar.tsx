import { useEffect, useMemo, useRef, useState } from 'react';
import { cutIsGrounded, describeSegments, segmentPassage, worthSegmenting, type Segment } from '@shared/segment';
import { planLine, type LongPlan } from '@shared/longform';

/**
 * 切分条：把长文切成候选的「一段论证」。
 *
 * 这里有个必须守住的边界：**工具只给候选，不替用户决定**。
 *
 * 所以样式上没有「已自动切分」这种说法，只有一个可展开的列表，
 * 每一段都标着「我是怎么切出来的」以及「这段像不像论证」。
 * 用户点哪一段，就分析哪一段；不点，就整篇一起分析。
 *
 * 另一条：按字数硬切的分段必须显示警示色。那是唯一没有语义依据的切法，
 * 把它和「空行分隔」画成一个样子，等于让用户以为工具读懂了文章结构。
 */

const KIND_LABEL: Record<Segment['kind'], string> = {
  argument: '自成论证',
  plain: '可能是论证',
  aside: '不像论证',
};

const KIND_HINT: Record<Segment['kind'], string> = {
  argument: '有结论指示词，单独分析通常能出完整报告',
  plain: '没有结论指示词，可能是论证，也可能只是陈述',
  aside: '问句、口号或过渡句，单独分析多半得到空报告',
};

interface Props {
  text: string;
  /** 当前是从第几段载入的；null 表示分析的是完整原文 */
  pickedIndex: number | null;
  onPick: (s: Segment) => void;
  onRestore: () => void;
  /** 原文总长，用于「恢复全文」按钮 */
  wholeChars: number;
  disabled?: boolean;
  /** 逐段跑的计划。与列表用的是同一份切分（同一次调用算出来的），不另算一遍。 */
  plan?: LongPlan;
  onRunBatch?: () => void;
  /** 正在跑：按钮换成进度，且不许再点 */
  batchBusy?: boolean;
  batchNote?: string | null;
  /** 预览页用：一进来就展开列表，好把「逐段跑」的入口拍下来 */
  initialOpen?: boolean;
}

export function SegmentBar({
  text,
  pickedIndex,
  onPick,
  onRestore,
  wholeChars,
  disabled,
  plan,
  onRunBatch,
  batchBusy,
  batchNote,
  initialOpen,
}: Props) {
  const segs = useMemo(() => segmentPassage(text), [text]);
  const long = useMemo(() => worthSegmenting(text), [text]);
  const [open, setOpen] = useState(initialOpen ?? false);
  /*
   * 跑批要花钱，所以点一次不够：第一次点开的是「几次调用、多少字」，
   * 第二次才是「确认跑」。用页面里的确认行而不是系统弹窗——弹窗会拦住
   * 正在读的东西，且在这个工具里显得像报错。
   */
  const [confirm, setConfirm] = useState(false);
  /*
   * 报告页那条「引文只钉住 3 句」旁边有个按钮，点了会派 `al:segment` 过来。
   *
   * 这里只做三件事：展开、滚过来、闪一下——与「去填立案」「去登记分歧」同一套。
   * 不替人点任何一段：切开之后选哪段是判断，工具只把列表摆到眼前。
   */
  const barRef = useRef<HTMLDivElement>(null);
  const [hit, setHit] = useState(false);

  const skipMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of plan?.skipped ?? []) m.set(s.index, s.why);
    return m;
  }, [plan]);

  useEffect(() => {
    const onSegment = () => {
      /*
       * 已经载入某一段时不展开：那一屏的切分条只有「已载入第 N 段 / 恢复全文」，
       * 没有列表可展开。此时滚过去仍然有用（那是「恢复全文」的入口），
       * 所以照滚，只是不假装展开了什么。
       */
      if (pickedIndex === null && segs.length >= 2) setOpen(true);
      const el = barRef.current;
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHit(true);
      window.setTimeout(() => setHit(false), 1400);
    };
    window.addEventListener('al:segment', onSegment);
    return () => window.removeEventListener('al:segment', onSegment);
  }, [pickedIndex, segs.length]);

  if (pickedIndex !== null) {
    return (
      <div className={`sg-bar sg-picked ${hit ? 'sg-hit' : ''}`} ref={barRef} data-sg-bar="picked">
        <span className="sg-tag">已载入第 {pickedIndex + 1} 段</span>
        <span className="sg-sub">只分析这一段。切错了吗？</span>
        <div className="sg-spacer" />
        <button className="sg-restore" onClick={onRestore}>
          恢复全文（{wholeChars} 字）
        </button>
      </div>
    );
  }

  if (segs.length < 2) return null;

  return (
    <div className={`sg-bar ${long ? 'sg-loud' : ''} ${hit ? 'sg-hit' : ''}`} ref={barRef} data-sg-bar="list">
      <button className="sg-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="sg-scissors" aria-hidden>
          ✂
        </span>
        <span className="sg-title">{long ? '这段文字里有好几条论证' : '可以切成几段'}</span>
        <span className="sg-sub">{describeSegments(segs)}</span>
        <div className="sg-spacer" />
        <span className="sg-toggle">{open ? '收起' : '切给我看'}</span>
      </button>

      {open && (
        <div className="sg-list">
          <p className="sg-note">
            下面是按空行、句末标点和「所以 / 因此 / 可见」这类词切出来的。
            <b>这是切分，不是理解</b>——它不知道每段在讲什么。点一段就只分析那一段。
          </p>
          {/*
            批量入口放在列表最上面，不放在末尾。
            放在末尾时，六段以上就要滚过整张列表才看得见它——而它才是这条切分条的主动作；
            列表是用来看「切得对不对」的，不是用来找按钮的。
          */}
          {plan && plan.calls > 0 && onRunBatch && (
            <div className="sg-batch" data-sg-batch={plan.calls}>
              {batchBusy ? (
                <p className="sg-batch-note" data-sg-batch-busy="1">
                  {batchNote ?? '正在逐段跑…'}
                </p>
              ) : !confirm ? (
                <>
                  <button className="sg-run" onClick={() => setConfirm(true)} data-sg-run={plan.calls}>
                    逐段跑这 {plan.calls} 段
                  </button>
                  <span className="sg-batch-why">{planLine(plan)}</span>
                </>
              ) : (
                <>
                  <span className="sg-batch-warn" data-sg-confirm="1">
                    会发起 {plan.calls} 次调用，花的是你自己的额度；每段各存一份报告，不会合并成一份。
                  </span>
                  <button
                    className="sg-run sg-run-go"
                    onClick={() => {
                      setConfirm(false);
                      onRunBatch();
                    }}
                    data-sg-run-go="1"
                  >
                    确认跑
                  </button>
                  <button className="sg-again" onClick={() => setConfirm(false)}>
                    算了
                  </button>
                </>
              )}
              {(plan.warnings ?? []).map((w) => (
                <p className="sg-batch-warn-line" key={w}>
                  {w}
                </p>
              ))}
            </div>
          )}
          {segs.map((s) => (
            <button
              key={s.index}
              className={`sg-item k-${s.kind} ${cutIsGrounded(s.cutBasis) ? '' : 'ungrounded'}`}
              onClick={() => !disabled && onPick(s)}
              disabled={disabled}
              title={KIND_HINT[s.kind]}
              data-sg-item={s.index}
            >
              <span className="sg-n">{s.index + 1}</span>
              <span className="sg-body">
                <span className="sg-line">
                  <span className={`sg-kind k-${s.kind}`}>{KIND_LABEL[s.kind]}</span>
                  <span className="sg-chars">{s.chars} 字</span>
                  {!cutIsGrounded(s.cutBasis) && <span className="sg-warn">切点无依据</span>}
                  {skipMap.has(s.index) && (
                    <span className="sg-skip" title={skipMap.get(s.index)}>
                      逐段跑时跳过
                    </span>
                  )}
                </span>
                <span className="sg-text">{s.text.replace(/\s+/g, ' ').slice(0, 64)}</span>
                <span className="sg-why">{s.why}</span>
              </span>
            </button>
          ))}
          <p className="sg-foot">
            都不对？直接分析整篇也可以——报告可能会说「这不是单一论证」，那也是有用的结果。
          </p>
        </div>
      )}
    </div>
  );
}
