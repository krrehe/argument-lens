/**
 * 「挑图」——报告顶部那一行：这次看哪几张图。
 *
 * 为什么把它放在报告里，而不是设置页：看几张图不是全局偏好，是**读这一份时**
 * 的决定。同一个人读结构复杂的论证想看结构图，读一段广告词只想看它倒在哪。
 * 放到设置里，等于要求他先想清自己要什么，再来读。
 *
 * 三条规矩：
 *   1. 默认与旧版一致（结构、逐关检查、判读三张），升级不改变阅读顺序；
 *   2. 画不出的图照样列出并写明原因——过滤掉就分不清「没有」与「坏了」；
 *   3. 关掉图不改报告内容，也不改存档与导出。选择只存在本机。
 */
import { useState } from 'react';
import { DEFAULT_VIEWS, VIEW_ORDER, viewCountLine, viewStateText, type ViewId, type ViewSpec } from '@shared/views';
import { jumpTo } from './Overview';

const STORE_KEY = 'al:views';

/** 读上次的选法。存储被手改坏时交给 `sanitizeViews` 落地，不在这里 catch 成默认。 */
export function readStoredViews(): unknown {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    // @allow-silent: 读到坏 JSON（手改过、或上一次写了一半）时当作没存过。这是本机的
    // 一份界面偏好，不值得为它挡住整份报告；调用方会拿到默认三张，界面仍可用。
    return null;
  }
}

export function writeStoredViews(ids: ViewId[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(ids));
  } catch {
    // @allow-silent: 写不进去（配额满 / 隐私模式）时选择只在这次生效。不弹错：图照样能选，
    // 只是下次不记得——这比因为存不下而禁用整条选择条更接近可用。
  }
}

export function ViewBar({
  views,
  picked,
  onPick,
  initialOpen = false,
}: {
  views: ViewSpec[];
  /** 这次实际显示的（已过 `normalizeViews`）。 */
  picked: ViewId[];
  onPick: (ids: ViewId[]) => void;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const drawable = views.filter((v) => v.blocked === null);

  const toggle = (id: ViewId) => {
    const has = picked.includes(id);
    const next = has ? picked.filter((x) => x !== id) : [...picked, id];
    /* 存的是意图：按固定顺序排，不随点击顺序变。 */
    const ordered = VIEW_ORDER.filter((x) => next.includes(x));
    onPick(ordered);
    writeStoredViews(ordered);
  };

  const setAll = (ids: ViewId[]) => {
    onPick(ids);
    writeStoredViews(ids);
  };

  return (
    <div className="vw-bar" data-view-bar data-view-count={picked.length}>
      <div className="vw-head">
        <span className="vw-line" data-view-line>
          {viewCountLine(views, picked)}
        </span>
        <button
          className="vw-toggle"
          data-view-open
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? '收起' : drawable.length > picked.length ? '挑图' : '改选'}
        </button>
      </div>

      {open && (
        <div className="vw-panel" data-view-panel>
          <ul className="vw-list">
            {views.map((v) => {
              const blocked = v.blocked !== null;
              const on = picked.includes(v.id);
              return (
                <li
                  key={v.id}
                  className={`vw-item ${blocked ? 'is-blocked' : ''} ${on ? 'is-on' : ''}`}
                  data-view-item
                  data-view-id={v.id}
                  data-view-blocked={blocked ? '1' : '0'}
                  data-view-on={on ? '1' : '0'}
                >
                  {/*
                    不可画的项不做成勾选框：勾选框会让读者以为「点一下就有了」。
                    用一个横杠占位，右边写原因。
                  */}
                  {blocked ? (
                    <span className="vw-box" aria-hidden>
                      –
                    </span>
                  ) : (
                    <button
                      className="vw-box"
                      data-view-toggle={v.id}
                      onClick={() => toggle(v.id)}
                      aria-pressed={on}
                      aria-label={`${on ? '关掉' : '显示'}${v.name}`}
                    >
                      {on ? '✓' : ''}
                    </button>
                  )}
                  <span className="vw-name">{v.name}</span>
                  <span className="vw-what">{v.what}</span>
                  {blocked ? (
                    <span className="vw-why" data-view-why>
                      {v.blocked}
                    </span>
                  ) : (
                    <>
                      <span className="vw-state">{viewStateText(v, picked)}</span>
                      <button className="vw-go" data-view-goto={v.id} onClick={() => jumpTo(v.where)}>
                        去看
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="vw-actions">
            <button className="vw-act" data-view-all onClick={() => setAll(drawable.map((v) => v.id))}>
              全显示
            </button>
            <button
              className="vw-act"
              data-view-default
              onClick={() => setAll(DEFAULT_VIEWS.filter((id) => drawable.some((v) => v.id === id)))}
            >
              只留默认三张
            </button>
            <span className="vw-saved">关掉图不影响报告内容、存档与导出。选法记在这台机器上。</span>
          </div>
        </div>
      )}
    </div>
  );
}
