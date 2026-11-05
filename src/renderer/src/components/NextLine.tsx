import { useState } from 'react';
import { NEXT_LINE_MAX, nextLineHead, nextLineText, type NextLineView } from '@shared/nextline';

/**
 * 「读完这份报告，你下一句想说什么」。
 *
 * 它长在报告的最后一屏之后，因为它是**读完之后的反应**：
 * 放在开头等于在人还没读的时候先要一句评价，那一条数据就废了。
 *
 * 三件事它不做：不分析这句话、不给出选项、不替人归类。
 * 选项会把人往几个预设的说法上赶，而路线图要观察的恰恰是「人自己会说什么」。
 * 所以这里只有一个空框，和一段别人说过的话——原样摆着，不加评语。
 */
export function NextLineBar({
  view,
  diagId,
  passageHead,
  theory,
  onSave,
  onRemove,
  fmt,
  readError,
  initialOpen = false,
}: {
  view: NextLineView | null;
  /** 读不出本机记录时的原因。有它就不摆输入框：写进去也读不回来，摆一个假入口更坏。 */
  readError?: string | null;
  diagId: string;
  passageHead: string;
  theory: string;
  onSave: (input: {
    text: string;
    diagId: string;
    passageHead: string;
    theory: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  onRemove: (id: string) => Promise<{ ok: boolean; error?: string }>;
  fmt: (at: number) => string;
  /** 预览页专用：默认展开明细，好让这一块有截图入口。真应用里由用户点开。 */
  initialOpen?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(initialOpen);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** 两段式删除：第一下只是把按钮变成「确定删」，不直接抹掉用户写的字。 */
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (readError) {
    return (
      <div className="nl-bar" data-nextline data-nextline-read-error="1">
        <h3 className="nl-title">读完这份报告，你下一句想说什么？</h3>
        <p className="nl-err" data-nextline-error>
          读不出本机的记录：{readError}。这一栏先不摆输入框——写进去也读不回来。
        </p>
      </div>
    );
  }
  if (!view) return null;
  const head = nextLineHead(view, fmt);
  const text = draft.trim();

  const save = async () => {
    if (!text || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await onSave({ text, diagId, passageHead, theory });
      if (r.ok) {
        setDraft('');
        setSaved(true);
      } else {
        setErr(r.error ?? '这句话没能写进文件。');
      }
    } catch (e) {
      setErr(`没能写进文件：${(e as Error)?.message ?? '原因不明'}`);
    } finally {
      setBusy(false);
    }
  };

  const del = async (id: string) => {
    setConfirmId(null);
    setErr(null);
    try {
      const r = await onRemove(id);
      if (!r.ok) setErr(r.error ?? '这句话没能删掉。');
    } catch (e) {
      setErr(`没能删掉：${(e as Error)?.message ?? '原因不明'}`);
    }
  };

  return (
    <div className="nl-bar" data-nextline data-nextline-total={view.usable}>
      <h3 className="nl-title">读完这份报告，你下一句想说什么？</h3>
      <p className="nl-why">
        存的是你的原话，只在这台机器上。不进报告、不发模型，随时可删。
      </p>

      <textarea
        className="nl-input"
        data-nextline-input
        rows={2}
        maxLength={NEXT_LINE_MAX}
        placeholder="一句也行，不写也行"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setSaved(false);
        }}
        onKeyDown={(e) => {
          /* Ctrl+Enter 记下。单按 Enter 是换行：这句话可能不止一行，不该被当成提交。 */
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void save();
          }
        }}
      />

      <div className="nl-actions">
        <span className="nl-count">
          {text.length} / {NEXT_LINE_MAX}
        </span>
        {saved && <span className="nl-ok" data-nextline-ok>记下了。</span>}
        <button className="nl-save" data-nextline-save disabled={!text || busy} onClick={() => void save()}>
          {busy ? '正在写…' : '记下'}
        </button>
      </div>

      {err && (
        <p className="nl-err" data-nextline-error>
          {err}
        </p>
      )}

      {/*
        一句都没有时不说「本机还没有记下任何一句」——那行字在第一次使用的人眼里
        只是一个空计数器。有东西可看的时候才报数。
      */}
      {head && (
        <div className="nl-ledger">
          <p className="nl-line" data-nextline-line>
            {head}
          </p>
          <button className="nl-toggle" data-nextline-open onClick={() => setOpen((o) => !o)}>
            {open ? '收起这些句子' : '看这些句子'}
          </button>
          {open && (
            <div className="nl-detail" data-nextline-detail>
              <p className="nl-why">
                逐字相同的句子只在总述里合并计数，明细一条不少；差一个字就是两句。
                这里不判断哪一句更有内容。
              </p>
              <ol className="nl-list" data-nextline-list>
                {view.lines.map((r) => (
                  <li key={r.id} className="nl-item" data-nextline-item>
                    <span className="nl-when">{fmt(r.at)}</span>
                    <span className="nl-said" data-nextline-said>
                      {r.text}
                    </span>
                    {confirmId === r.id ? (
                      <span className="nl-del-confirm">
                        <button className="nl-del yes" data-nextline-del-yes onClick={() => void del(r.id)}>
                          确定删
                        </button>
                        <button className="nl-del" onClick={() => setConfirmId(null)}>
                          留着
                        </button>
                      </span>
                    ) : (
                      <button className="nl-del" data-nextline-del onClick={() => setConfirmId(r.id)}>
                        删
                      </button>
                    )}
                  </li>
                ))}
              </ol>
              {/* 明细与这段纯文本逐字相同：上面是能删的清单，这段是能带走的。 */}
              <p className="nl-why">下面这段是纯文本，可以直接复制走；它和上面的每一行逐字相同。</p>
              <textarea
                className="nl-text"
                data-nextline-text
                readOnly
                rows={Math.min(8, 2 + view.lines.length)}
                value={nextLineText(view, fmt)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
