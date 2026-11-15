import { useState } from 'react';
import { LEVEL_LABEL } from '@shared/theories';
import {
  LONGFORM_BOUNDS,
  longformMarkdown,
  summarize,
  type LongItem,
  type LongLedger,
} from '@shared/longform';

/**
 * 长文台账：一次逐段跑出来的那几份报告，摆在一起。
 *
 * 这一栏存在的理由，是它**不能**做的事：它不合并、不相加、不判段与段的关系。
 * 一篇社论里有三到五条论证，这个工具的判定单元是一条论证，所以诚实的形态
 * 是一排并列的报告，而不是一份假装统摄全篇的「总判决」。
 *
 * 因此每一行都必须留着「这一段单独跑出来的」这个身份：段号、字数、它自己的档位。
 * 汇总句只数个数，不排名、不给总分。
 */

interface Props {
  ledger: LongLedger;
  /** 还在顺序跑的时候为 true：此时「打开」可点，但「跑完剩下的」要变成「停」 */
  running?: boolean;
  onOpen: (reportId: string) => void;
  onResume?: () => void;
  onStop?: () => void;
}

const STATUS_TEXT: Record<LongItem['status'], string> = {
  idle: '还没跑',
  running: '正在跑',
  ok: '',
  failed: '失败',
  stopped: '按停后没跑',
  skipped: '跳过',
};

export function LongformLedger({ ledger, running, onOpen, onResume, onStop }: Props) {
  const [openBounds, setOpenBounds] = useState(false);
  /*
   * 复制的结果必须回话。
   *
   * 剪贴板在 Electron 里可能被系统策略拦掉（无焦点窗口、远程桌面、某些安全软件）。
   * 「点了没反应」会让用户以为没点中，再点一次——而他手里的表是空的，自己还不知道。
   */
  const [copy, setCopy] = useState<'idle' | 'ok' | 'fail'>('idle');
  const sum = summarize(ledger.items);
  const waiting = sum.waiting + sum.stopped;

  const doCopy = () => {
    navigator.clipboard
      .writeText(longformMarkdown(ledger))
      .then(() => setCopy('ok'))
      .catch(() => setCopy('fail'));
  };

  return (
    <section className="lf-panel" data-longform="1" data-lf-total={sum.total} data-lf-done={sum.done}>
      <div className="lf-head">
        <span className="lf-t">长文台账</span>
        <span className="lf-sub" data-lf-line={sum.line}>
          {ledger.passageChars ? `原文 ${ledger.passageChars.toLocaleString('zh-CN')} 字 · ` : ''}
          {sum.line}
        </span>
        <div className="lf-spacer" />
        <button className="lf-act" onClick={doCopy} data-lf-copy="1" title="把这批台账按 Markdown 复制走">
          {copy === 'ok' ? '已复制' : copy === 'fail' ? '复制失败' : '复制台账'}
        </button>
        {running && onStop ? (
          <button className="lf-act lf-stop" onClick={onStop} data-lf-stop="1">
            停
          </button>
        ) : (
          waiting > 0 &&
          onResume && (
            <button className="lf-act" onClick={onResume} data-lf-resume="1">
              接着跑（{waiting} 段）
            </button>
          )
        )}
        <button
          className={`lf-bounds-btn ${openBounds ? 'on' : ''}`}
          onClick={() => setOpenBounds((v) => !v)}
          title="这一栏不做什么"
          data-lf-bounds="1"
        >
          ⓘ 边界
        </button>
      </div>

      {openBounds && (
        <ul className="lf-bounds" data-lf-bounds-list="1">
          {LONGFORM_BOUNDS.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}

      <ul className="lf-rows">
        {ledger.items.map((it) => {
          /*
           * 一行的四种样子，必须看得出区别：
           *   跑成了 → 它自己的档位（不是「整篇的结论」）
           *   失败了 → 一句原因，并且能重跑
           *   没跑   → 明说没跑，不留空白。空白会被读成「这一段没问题」。
           */
          const ok = it.status === 'ok' && it.reportId;
          return (
            <li
              key={it.job.index}
              className={`lf-row s-${it.status}`}
              data-lf-row={it.job.index}
              data-lf-status={it.status}
              data-lf-id={it.reportId ?? ''}
              data-lf-level={it.level ?? ''}
            >
              <span className="lf-n">第 {it.job.index + 1} 段</span>
              <span className={`lf-prev ${it.job.preview ? '' : 'lf-prev-empty'}`} title={it.job.text || it.error || ''}>
                {it.job.preview || '（这一段没排进来）'}
                {it.job.previewTruncated ? '…' : ''}
              </span>
              <span className="lf-chars">{it.job.chars} 字</span>
              {ok ? (
                <span className={`lf-level lv-${it.level ?? 'none'}`}>
                  {/* 档位读不出时不说「判不了」：那是报告里的一个判断，不是「没读到」 */}
                  {it.level ? LEVEL_LABEL[it.level] : '档位读不出'}
                </span>
              ) : (
                <span className="lf-why" title={it.error ?? undefined}>
                  {/* 跳过与失败都必须带理由：只写「跳过」，读者会以为工具在替他挑 */}
                  {it.status === 'failed'
                    ? `失败：${it.error ?? '原因不明'}`
                    : it.status === 'skipped'
                      ? `没跑：${it.error ?? '计划里没排进来'}`
                      : STATUS_TEXT[it.status]}
                </span>
              )}
              {ok ? (
                <button className="lf-open" onClick={() => onOpen(it.reportId as string)} data-lf-open={it.job.index}>
                  打开
                </button>
              ) : (
                <span className="lf-open lf-open-off" aria-hidden>
                  —
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <p className="lf-foot">
        每一行都是那一段单独跑出来的一份报告，各自存在历史里。要判「整篇在论证什么」，得另跑一份整篇的——
        这一栏给的是几份并列的判断，不是一份统摄全篇的判决。
      </p>
    </section>
  );
}
