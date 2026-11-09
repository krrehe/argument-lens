import { useMemo, useState } from 'react';
import type { Diagnosis } from '@shared/types';
import {
  FIELD_TERMS_CAVEAT,
  FIELD_TERMS_PLAIN,
  FIELD_TERMS_SPLIT,
  FIELD_TERMS_TITLE,
  fieldTermsOf,
  parseWords,
} from '@shared/field-terms';
import { rereadOf, sentenceBounds } from '@shared/reread';

/**
 * 「这一圈的词」——学术分析区块里的第三条 sec。
 *
 * 词表由使用者填，本地只按字面复算；抬头、边界、分隔说明逐字取自
 * `@shared/field-terms`，界面不另写一句，免得口径慢慢说成两件事。
 *
 * 默认收起，词表只活在这个组件里（刷新即清、不存盘）——跟同一区块的
 * 规范勾选框是同一个取舍，界面明写。预览页用 `?terms=1` 展开并预填演示词，
 * 那几个词只为拍版式，真应用里是空的。
 */
export function FieldTermsBar({
  d,
  initialOpen = false,
  initialWords = '',
}: {
  d: Diagnosis;
  initialOpen?: boolean;
  initialWords?: string;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [raw, setRaw] = useState(initialWords);

  const view = useMemo(() => {
    const words = parseWords(raw);
    const rv = rereadOf(d);
    return fieldTermsOf({
      passage: d.passage ?? '',
      words,
      conclusion: d.conclusion?.text ?? '',
      premises: (d.premises ?? []).map((p) => p.text),
      sentences: sentenceBounds(d.passage ?? ''),
      quietSentences: rv.sentences.filter((s) => s.quiet).map((s) => s.index),
    });
  }, [d, raw]);

  return (
    <div className="ft-bar" data-terms-bar>
      <div className="ft-head">
        <span className="ft-title">{FIELD_TERMS_TITLE}</span>
        <button className="ft-toggle" data-terms-toggle onClick={() => setOpen((v) => !v)}>
          {view.state === 'empty' ? '填词' : `${view.rows.length} 个词`} · {open ? '收起' : '展开'}
        </button>
      </div>
      <div className="ft-plain">{FIELD_TERMS_PLAIN}</div>
      {open && (
        <div className="ft-panel" data-terms-panel>
          <label className="ft-label" htmlFor="ft-input">
            你的词表
          </label>
          <textarea
            id="ft-input"
            className="ft-input"
            data-terms-input
            rows={2}
            value={raw}
            placeholder={FIELD_TERMS_SPLIT}
            onChange={(e) => setRaw(e.target.value)}
          />
          <div className="ft-split">{FIELD_TERMS_SPLIT}</div>
          <div className="ft-note" data-terms-note data-terms-state={view.state}>
            {view.note}
          </div>
          {view.rows.length > 0 && (
            <ul className="ft-rows">
              {view.rows.map((r) => (
                <li className="ft-row" data-terms-row={r.word} key={r.word}>
                  <div className="ft-row-h">
                    <span className="ft-word">{r.word}</span>
                    <span className="ft-count">{r.count} 次</span>
                  </div>
                  <ul className="ft-facts">
                    {r.facts.map((f, i) => (
                      <li className="ft-fact" key={i}>
                        {f}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          <div className="ft-caveat" data-terms-caveat>
            {FIELD_TERMS_CAVEAT}
          </div>
        </div>
      )}
    </div>
  );
}
