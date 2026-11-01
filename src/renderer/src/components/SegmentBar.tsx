import { useMemo, useState } from 'react';
import { cutIsGrounded, describeSegments, segmentPassage, worthSegmenting, type Segment } from '@shared/segment';

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
}

export function SegmentBar({ text, pickedIndex, onPick, onRestore, wholeChars, disabled }: Props) {
  const segs = useMemo(() => segmentPassage(text), [text]);
  const long = useMemo(() => worthSegmenting(text), [text]);
  const [open, setOpen] = useState(false);

  if (pickedIndex !== null) {
    return (
      <div className="sg-bar sg-picked">
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
    <div className={`sg-bar ${long ? 'sg-loud' : ''}`}>
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
          {segs.map((s) => (
            <button
              key={s.index}
              className={`sg-item k-${s.kind} ${cutIsGrounded(s.cutBasis) ? '' : 'ungrounded'}`}
              onClick={() => !disabled && onPick(s)}
              disabled={disabled}
              title={KIND_HINT[s.kind]}
            >
              <span className="sg-n">{s.index + 1}</span>
              <span className="sg-body">
                <span className="sg-line">
                  <span className={`sg-kind k-${s.kind}`}>{KIND_LABEL[s.kind]}</span>
                  <span className="sg-chars">{s.chars} 字</span>
                  {!cutIsGrounded(s.cutBasis) && <span className="sg-warn">切点无依据</span>}
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
