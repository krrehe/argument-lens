/**
 * 把整份报告渲染成 HTML 字符串，供无头检查用。
 *
 * 为什么不用浏览器：Chrome 的 --dump-dom 在这台机器上会去联网查更新，
 * 四个用例各卡 30 秒直到超时，而且失败原因跟「图画错没错」毫无关系。
 * 服务端渲染没有这个依赖，快、确定、也不受本机 Chrome 配置影响。
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DiagnosisView } from '../src/renderer/src/components/Diagnosis';
import { PlainCtx } from '../src/renderer/src/components/Term';
import { MOCK, MOCK_ARS, MOCK_PTA, MOCK_TOULMIN } from '../src/renderer/src/mock-data';
import { RevisionFlow } from '../src/renderer/src/components/Revision';
import { diffRevision } from '@shared/compare';
import type { Diagnosis } from '@shared/types';

const CASES: { lens: string; d: Diagnosis }[] = [
  { lens: 'walton', d: MOCK },
  { lens: 'toulmin', d: MOCK_TOULMIN },
  { lens: 'ars', d: MOCK_ARS },
  { lens: 'pta', d: MOCK_PTA },
];

/**
 * 走向图的用例：造一次真实的修订——把示例里未答的那条改成答上。
 * 它必须可比（同透镜、同模式、原文只加了一句），否则图不会画。
 */
function revisionCase(): Diagnosis {
  const parent: Diagnosis = JSON.parse(JSON.stringify(MOCK));
  const child: Diagnosis = JSON.parse(JSON.stringify(MOCK));
  child.id = 'child';
  child.parentId = parent.id;
  child.passage = `${parent.passage}
同期生源与师资均未发生足以解释 6 个百分点的变化。`;
  child.checks = child.checks.map((c) =>
    c.id === 'CQ2' ? { ...c, answer: 'passed' as const } : c
  );
  child.verdict.level = 'withstands';
  return child;
}

export const out: Record<string, string> = {};
for (const c of CASES) {
  try {
    out[c.lens] = renderToStaticMarkup(
      createElement(PlainCtx.Provider, { value: true }, createElement(DiagnosisView, { d: c.d }))
    );
  } catch (e) {
    out[c.lens] = `ERROR ${String(e)}`;
  }
}

/* 走向图：单独立一条，因为它挂在 App 层，DiagnosisView 里渲染不到 */
try {
  const diff = diffRevision(MOCK, revisionCase());
  out['revflow'] = renderToStaticMarkup(createElement(RevisionFlow, { diff }));
  out['revflow-meta'] = JSON.stringify({ comparable: diff.comparable, trend: diff.trend });
} catch (e) {
  out['revflow'] = `ERROR ${String(e)}`;
  out['revflow-meta'] = '{}';
}
