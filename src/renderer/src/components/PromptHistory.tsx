import { useState } from 'react';
import { promptHistoryOf } from '@shared/prompt-history';
import type { Diagnosis } from '@shared/types';

/**
 * 报告里的「这把尺子」栏。
 *
 * 脚注只有一行「本次提示词 vX · 指纹 …」，回答不了三个月后回看的那两个问题：
 * 那一版和现在差在哪、本机还有没有那一版的全文。这一栏把版本注记交到人手上，
 * 同时把最关键的一句边界摆在同一屏：**旧版全文没有存档，历史指纹不能在这里重算**。
 *
 * 全部数据来自 `@shared/prompt-history` 读的同一份落盘基线；这里不解析版本、
 * 不比指纹、不评价哪一版更好，只负责把纯函数算出来的话说清楚。
 */
export function PromptHistoryCard({ d }: { d: Diagnosis }) {
  const v = promptHistoryOf(d);
  const [open, setOpen] = useState(false);

  return (
    <div className="ph" data-ph={v.relation} data-ph-fp={v.fingerprintState}>
      <div className="ph-top">
        <span className="ph-k">这份报告</span>
        <b className="ph-v" data-ph-version={v.reportVersion ?? 'none'}>
          {v.reportVersion ? `v${v.reportVersion}` : '版本未记录'}
        </b>
        <span className="ph-fp" data-ph-fingerprint={v.reportFingerprint ?? 'none'}>
          指纹 {v.reportFingerprint ? v.reportFingerprint.slice(0, 12) : '未记录'}
        </span>
        <span className="ph-cur">当前装机 v{v.currentVersion}</span>
        <span className="ph-combo">{v.combination}</span>
      </div>

      <p className="ph-line" data-ph-line>
        {v.line}
      </p>
      <p className="ph-lead" data-ph-note-state={v.noteFound ? 'found' : 'missing'}>
        {v.noteLine}
      </p>
      {v.noteText && (
        <blockquote className="ph-note" data-ph-note>
          {v.noteText}
        </blockquote>
      )}

      <div className="ph-caveats" data-ph-caveats={v.caveats.length}>
        <span className="ph-caveat-head">这一栏的边界</span>
        {v.caveats.map((c, i) => (
          <p key={i}>{c}</p>
        ))}
      </div>

      <button
        type="button"
        className="ph-toggle"
        data-ph-toggle={open ? '1' : '0'}
        onClick={() => setOpen((x) => !x)}
      >
        {open ? '收起本机版本变更史' : `展开本机版本变更史（${v.rows.length} 行）`}
      </button>
      {open && (
        <ol className="ph-rows" data-ph-rows={v.rows.length}>
          {v.rows.map((r, i) => (
            <li key={i} data-ph-row={r.version ?? 'unknown'}>
              <b>{r.version ? `v${r.version}` : '没写版本号'}</b>
              <span>{r.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
