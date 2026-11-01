import { createContext, useContext, useMemo, useState } from 'react';
import type { Objection, ObjectionField } from '@shared/types';
import type { TheoryId } from '@shared/theories';
import { OBJECTION_SCOPE_NOTE, objectionKey } from '@shared/objection';

/**
 * 「我不同意这条」。
 *
 * 这个按钮存在的原因，是这个工具的三个维度里缺了一个：
 *
 *   不确定 —— 工具的毛病：模型没把握
 *   有争议 —— 学科的毛病：文献里真没有共识
 *   我不同意 —— 用户的判断：他读过原文、懂这个语境，认为这一条错了
 *
 * 前两个都已有独立的位置。第三个原本无处安放：用户只能在心里嘀咕。
 * 一个人反复嘀咕的地方，往往就是这个工具真的错的地方——不收下来，就永远发现不了。
 *
 * 两条设计约束：
 *   1. **不许改判。** 没有「应用我的意见」「按我说的重算」。允许改判等于把
 *      「可检验」换成「可商量」，那是另一种谄媚，和这个工具反对的东西同构。
 *   2. **不用红色。** 红色是「错误」。这里是「分歧」，而且不知道谁对。
 *      用红色等于预先宣布用户错了。
 */

interface Ctx {
  diagId: string;
  theory: TheoryId;
  list: Objection[];
  add: (v: { field: ObjectionField; refId: string; refLabel: string; excerpt: string; reason: string }) => void;
  remove: (key: string) => void;
}

export const ObjectionCtx = createContext<Ctx | null>(null);

interface Props {
  field: ObjectionField;
  /** 检查项 id / 命名条目 id / 前提 id 等 */
  refId: string;
  /** 给人看的标签，如「CQ2 领域相关性」 */
  refLabel: string;
  /** 被反对的那句话本身，用来在历史里认出它 */
  excerpt: string;
  /** 放在窄格子里时用紧凑模式：只显示一个小标记 */
  compact?: boolean;
}

export function ObjectBtn({ field, refId, refLabel, excerpt, compact }: Props) {
  const ctx = useContext(ObjectionCtx);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  const key = useMemo(
    () => (ctx ? objectionKey(ctx.theory, field, refId, excerpt) : ''),
    [ctx, field, refId, excerpt]
  );

  if (!ctx) return null;

  const hit = ctx.list.find((o) => o.diagId === ctx.diagId && o.key === key);

  if (hit) {
    return (
      <div className={`obj-note ${compact ? 'sm' : ''}`}>
        <span className="obj-flag">你不同意</span>
        {hit.reason ? <span className="obj-reason">{hit.reason}</span> : <span className="obj-reason dim">（未写理由）</span>}
        <button className="obj-undo" onClick={() => ctx.remove(hit.key)}>
          撤销
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button className={`obj-btn ${compact ? 'sm' : ''}`} onClick={() => setOpen(true)} title="你认为这一条判错了">
        不同意
      </button>
    );
  }

  return (
    <div className="obj-form">
      <div className="obj-form-h">
        记下你的不同意见 —— 报告不改，两者并列
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="为什么不同意？（可以空着——说「不同意」本身就是信息）"
        rows={2}
        spellCheck={false}
      />
      <div className="obj-form-f">
        <span className="obj-fine">{OBJECTION_SCOPE_NOTE}</span>
        <button
          className="obj-cancel"
          onClick={() => {
            setOpen(false);
            setText('');
          }}
        >
          取消
        </button>
        <button
          className="obj-save"
          onClick={() => {
            ctx.add({ field, refId, refLabel, excerpt, reason: text });
            setOpen(false);
            setText('');
          }}
        >
          记下
        </button>
      </div>
    </div>
  );
}
