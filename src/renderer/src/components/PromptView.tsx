import { useEffect, useState } from 'react';
import { THEORY_BY_ID, type TheoryId } from '@shared/theories';
import { MODE_META, type AnalysisMode } from '@shared/types';

/**
 * 提示词视图。
 *
 * 一个工具用什么标准在衡量你，你有权看见。六副透镜各有各的提示词，
 * 这里把它们原样摊开——包括硬约束、范围门、以及每个透镜自己的索引材料。
 *
 * 除正文外还显示版本号、指纹、token 估算与采样上限：
 * 「这份报告和上次那一份是不是同一把尺子量的」这个问题，
 * 只能靠版本号回答，不能靠读全文。
 */
type PromptPayload = Awaited<ReturnType<typeof window.api.prompt.get>>;
export function PromptView({ theory, mode }: { theory: TheoryId; mode?: AnalysisMode }) {
  const [data, setData] = useState<PromptPayload | null>(null);
  const [copied, setCopied] = useState(false);
  const t = THEORY_BY_ID[theory];
  /*
   * 模式也换提示词。红队下写的是另一套问法，
   * 提示词页若仍显示诊断版，「你有权看见自己在被什么标准衡量」这条就只兑现了一半。
   */
  const m: AnalysisMode = mode ?? 'diagnose';

  useEffect(() => {
    let alive = true;
    window.api.prompt.get(theory, m).then((r) => {
      if (alive) setData(r);
    });
    return () => {
      alive = false;
    };
  }, [theory, m]);

  const copy = async () => {
    if (!data) return;
    await navigator.clipboard.writeText(data.system);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="prompt-view">
      <div className="prompt-bar">
        <strong style={{ fontSize: 13 }}>{t.name}</strong>
        {m !== 'diagnose' && <span className={`pv-mode mode-${m}`}>{MODE_META[m].label}</span>}
        <span className="count">
          {data ? `${data.system.length} 字符 / ${data.system.split('\n').length} 行` : '加载中…'}
        </span>
        {data && (
          <span
            className="pv-meta"
            title={`内容指纹 ${data.fingerprint}｜装配了 ${data.blockIds.length} 个规则块｜预算上限 ${data.budget.max} 字符`}
          >
            v{data.version} · {data.fingerprint.slice(0, 8)}
            {data.overBudget ? <b className="pv-warn">超预算</b> : <span>· 约 {data.estTokens} token</span>}
            <span>· 温度 ≤{data.sampling.temperature}</span>
          </span>
        )}
        <div className="spacer" />
        <span className="hint">
          {m === 'diagnose'
            ? '换一副透镜，整份提示词换掉——判定程序、硬约束、范围门、索引都不同。'
            : MODE_META[m].hint}
        </span>
        <button className="ghost-btn" onClick={copy} disabled={!data}>
          {copied ? '已复制' : '复制 system'}
        </button>
      </div>

      <div className="prompt-scroll">
        <div className="block">
          <div className="block-head">
            <span className="t">system</span>
            <span className="s">装配自 内核 + 本透镜模块 + 索引</span>
          </div>
          <div className="block-body" style={{ padding: 0 }}>
            <pre className="code" style={{ border: 'none', borderRadius: 0 }}>
              {data?.system ?? ''}
            </pre>
          </div>
        </div>

        <div className="block">
          <div className="block-head">
            <span className="t">user 模板</span>
            <span className="s">{'{{原文}} 处填入待分析文本'}</span>
          </div>
          <div className="block-body" style={{ padding: 0 }}>
            <pre className="code" style={{ border: 'none', borderRadius: 0 }}>
              {data?.userTemplate ?? ''}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
