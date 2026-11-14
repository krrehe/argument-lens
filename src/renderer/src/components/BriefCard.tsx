import type { Brief, BriefObject, BriefSource } from '@shared/types';
import { BRIEF_OBJECTS, BRIEF_SOURCES, briefGaps, briefLine, objectRoute } from '@shared/brief';

/**
 * 立案：流程文档 A 阶段的那三问，加一句「这段话在做什么」。
 *
 * 为什么它长在输入区、而不是报告里：
 *
 * 它必须发生在分析之前——文档 §1 写着「A 阶段任何一个环节没做完，不得进入 B」。
 * 放在报告里，等于先判完再问「评的是谁」，那句话就只是事后的注脚。
 *
 * 为什么默认收起：
 *
 * 输入区已经有字数、示例、模式、主按钮四排东西。这一段每次都要填会让人烦，
 * 而不填的代价（结论只能算「就文论文」）在看见报告之前不会有人感觉到。
 * 所以收起时也留一整行摘要：**没填就明写没填**，别让它悄悄空着。
 *
 * 它不改任何判定，也不进提示词：填错只会让报告对「评的是谁」说错话，
 * 不会污染对这段文字的任何判断。
 */
export function BriefCard({
  brief,
  onPatch,
  disabled,
  open,
  onToggle,
  pending,
}: {
  brief: Brief | null;
  /**
   * 只交「改了哪一项」，不交整份 —— 交整份就会丢更新：
   * 连点两个选择（原文 + 说理）时，两次都基于同一份旧状态算，后一次把前一次盖掉。
   * 这不是理论问题：端到端第一次跑，填完四个值只剩三个。
   */
  onPatch: (p: Partial<Brief>) => void;
  disabled?: boolean;
  /** 展开状态由外面管：全流程账的「去填立案」要能把它打开。 */
  open: boolean;
  onToggle: () => void;
  /**
   * 这四问比眼前这份报告里记的新（或者那份报告里根本没有）。
   * 有这一句，人不会以为「填完报告就跟着改了」。
   */
  pending: boolean;
}) {
  const gaps = brief ? briefGaps(brief) : ['谁说的', '哪一版', '原文还是转述'];

  const route = brief ? objectRoute(brief.objectKind) : null;

  return (
    <div
      className={`bf${pending ? ' bf-pending' : ''}`}
      id="brief-card"
      data-brief={brief ? '1' : '0'}
      data-open={open ? '1' : '0'}
      data-brief-pending={pending ? '1' : '0'}
    >
      <div className="bf-head">
        <span className="bf-k">立案</span>
        <span className="bf-sub">A1 取材 · A2 准入</span>
        <span className="bf-line" data-brief-line>
          {brief ? briefLine(brief) : '没填：谁说的 / 哪一版 / 原文还是转述'}
        </span>
        <span className={`bf-verdict ${gaps.length === 0 ? 'ok' : 'gap'}`} data-brief-gaps={gaps.length}>
          {gaps.length === 0 ? '三问答清' : `缺 ${gaps.length} 问`}
        </span>
        <button
          className="bf-toggle"
          data-brief-toggle="1"
          onClick={onToggle}
          disabled={disabled}
        >
          {open ? '收起' : '填写'}
        </button>
      </div>

      {pending && (
        <p className="bf-pend" data-brief-pend="1">
          这四问比眼前这份报告里记的新（或者那份报告里没有）。
          <b>立案只在按下「分析」的那一刻进报告</b>——填完要再跑一次，这份报告不会跟着改。
        </p>
      )}

      {!open && (
        <p className="bf-why">
          没立案不等于不能分析，但按 §2 A1，结论只能算「就文论文」：评的可能是转述、可能是删改过的某一版，
          而报告里不会有一句话提醒你这件事。
        </p>
      )}

      {open && (
        <div className="bf-body">
          <div className="bf-row">
            <label className="bf-label" htmlFor="bf-speaker">
              谁说的
            </label>
            <input
              id="bf-speaker"
              className="bf-input"
              data-brief-field="speaker"
              value={brief?.speaker ?? ''}
              maxLength={120}
              placeholder="实名、机构名，或明写「匿名」"
              disabled={disabled}
              onChange={(e) => onPatch({ speaker: e.target.value })}
            />
          </div>

          <div className="bf-row">
            <label className="bf-label" htmlFor="bf-version">
              哪一版
            </label>
            <input
              id="bf-version"
              className="bf-input"
              data-brief-field="version"
              value={brief?.version ?? ''}
              maxLength={120}
              placeholder="初稿 / 修订 / 转载有删改；只有一版也写一句"
              disabled={disabled}
              onChange={(e) => onPatch({ version: e.target.value })}
            />
          </div>

          <div className="bf-row">
            <span className="bf-label">原文还是转述</span>
            <div className="bf-chips">
              {BRIEF_SOURCES.map((s) => (
                <button
                  key={s.id}
                  className={`bf-chip ${(brief?.source ?? 'unknown') === s.id ? 'on' : ''}`}
                  data-brief-source={s.id}
                  title={s.hint}
                  disabled={disabled}
                  onClick={() => onPatch({ source: s.id as BriefSource })}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="bf-row">
            <span className="bf-label">这段话在做什么</span>
            <div className="bf-chips">
              {BRIEF_OBJECTS.map((o) => (
                <button
                  key={o.id}
                  className={`bf-chip ${(brief?.objectKind ?? 'unknown') === o.id ? 'on' : ''}`}
                  data-brief-object={o.id}
                  title={o.hint}
                  disabled={disabled}
                  onClick={() => onPatch({ objectKind: o.id as BriefObject })}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {route && (
            <p className="bf-warn" data-brief-route={brief?.objectKind}>
              {route}。仍然可以分析，但读结论时要记住：这一步按流程是不该开的口子。
            </p>
          )}
          {!route && gaps.length === 0 && brief?.source === 'hearsay' && (
            <p className="bf-warn" data-brief-route="hearsay">
              这是转述，不是原文。按 §2 A1，结论须标「基于转述的评估」，整体信任度降一档。
            </p>
          )}
          <p className="bf-fine">
            这三问不在文本里，软件算不出来；填了什么就照什么记，不替你默认。它不进提示词，也不改任何判定。
          </p>
        </div>
      )}
    </div>
  );
}
