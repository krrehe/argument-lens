import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { THEORIES, THEORY_BY_ID, LEVEL_LABEL } from '@shared/theories';
import { disputesIn } from '@shared/disputes';
import { DiagnosisView } from './components/Diagnosis';
import { HistoryPanel, when } from './components/History';
import { TheoryBrief } from './components/TheoryBrief';
import { TheoryBaseDialog } from './components/TheoryBase';
import { DisputeDialog } from './components/Disputes';
import { GlossaryDialog, PlainCtx } from './components/Term';
import { MOCK, MOCK_BY_THEORY } from './mock-data';
import { UsagePanel } from './components/Usage';
import { Settings } from './components/Settings';
import { Running } from './components/Running';
import { PortfolioBar } from './components/PortfolioBar';
import { AgreementBar } from './components/AgreementBar';
import { SideBySide } from './components/SideBySide';
import { NextLineBar } from './components/NextLine';
import { ObjectionCtx } from './components/Objection';
import { portfolioOf } from '@shared/portfolio';
import { agreementOf } from '@shared/agreement';
import type { Diagnosis, Divergence, Objection } from '@shared/types';
import type { ViewId } from '@shared/views';
import { nextLinesOf } from '@shared/nextline';
import { ANALYSIS_MODES, MODE_META, type ObjectionStat, type ReportMeta, type SearchWhere, type TheoryId, type UsageRow, type UsageSummary } from '@shared/types';
import { parseTerms } from '@shared/archive-search';
import { PROMPT_BASELINE } from '@shared/prompt-history';
import './styles.css';
import './styles-usage.css';
import './styles-disputes.css';
import './styles-theory.css';
import './styles-flow.css';
import './styles-history.css';
import './styles-sideby.css';
import './styles-tone.css';
import './styles-skeleton.css';
import './styles-rewrite.css';
import './styles-source.css';
import './styles-field-terms.css';
import './styles-coverage.css';
import './styles-procedure.css';
import { SAMPLES } from '@shared/samples';
import { planLongform, type LongItem, type LongLedger } from '@shared/longform';
import { LongformLedger } from './components/LongformLedger';
import { SegmentBar } from './components/SegmentBar';
import { DensityProvider, BriefFold } from './components/Density';
import { DocHead } from './components/DocHead';
import { PREVIEW_DENSITY } from '@shared/ui-density';
import './styles-density.css';
import './styles-longform.css';
import './styles-docpage.css';

/*
 * ?lens=toulmin|ars|pta 可以换成另一副透镜的预览数据。
 *
 * 六副透镜的产物栏现在是图，而假模型每次只返回 walton 那一版——
 * 端到端冒烟根本走不到另外几张图。没有这个开关，那几张图会一直躺在仓库里
 * 从没被人眼看过，那是最容易藏错的状态。
 */
const LENS = new URLSearchParams(location.search).get('lens') ?? MOCK.theory;

/*
 * ?gaps=clean：换成一份「四个缺口全为零」的报告。
 *
 * 缺口为零时是另一种版式——一行说明，不是一列黄线。真实报告里四条同时满足很罕见，
 * 不给入口，这一版就永远不会被人看过。做法是把原文截到最后一个被引用的句子结束处
 * （前面的下标不变，引文位置仍然对得上），再把检查项全部改成 passed。
 */
function withNoGaps(d: Diagnosis): Diagnosis {
  const claims = [d.conclusion, ...d.premises, ...d.intermediate].filter(Boolean);
  const ends = claims.map((c) => (c.span && c.span.quality !== 'failed' ? c.span.end : 0));
  const maxEnd = Math.max(0, ...ends);
  return {
    ...d,
    passage: maxEnd > 0 ? d.passage.slice(0, maxEnd) : d.passage,
    checks: d.checks.map((c) => ({ ...c, answer: 'passed' as const })),
  };
}

const D0 = MOCK_BY_THEORY[LENS] ?? MOCK;
/*
 * ?coverage=1：长文覆盖账只在长文本上出现，得有一份长文本才拍得到它。
 * 这一段**是构造的演示原文**，不是真实语料：以 D0.passage 逐字开头（这样报告里
 * 那些 span / 引文坐标仍然对得上），后面接仓库里示例文本的其余五段、接两轮。
 * 不编一个新字、不拿使用者的真文本进仓库；截图里的段落因此会有重复，那是演示数据，
 * 不是「另一个使用证据」。
 */
const LONG_DEMO = new URLSearchParams(location.search).get('coverage') === '1'
  ? {
      ...D0,
      passage: [
        D0.passage,
        ...SAMPLES.slice(1).map((s) => s.text),
        ...SAMPLES.slice(1).map((s) => s.text),
      ].join('\n\n'),
    }
  : D0;
/*
 * ?brief=1 / ?brief=partial：给预览数据配一份立案。
 *
 * 全流程账上 A1/A2 两格长什么样，取决于这份报告有没有立案记录，而预览页
 * 没有输入框、也没有主进程——不造一份，那两格「做了」的样子就永远没人看过，
 * 而「没做」的样子反而天天见（默认 mock 没有 brief）。两种都要能拍。
 */
function withBrief(d: Diagnosis, q: string): Diagnosis {
  if (!q) return d;
  const partial = q === 'partial';
  return {
    ...d,
    brief: partial
      ? { speaker: '城南小学校办', version: '', source: 'unknown', objectKind: 'argument', at: Date.now() }
      : {
          speaker: '城南小学校办',
          version: '家长群通知（2026-11 第一版）',
          source: 'original',
          objectKind: 'argument',
          at: Date.now(),
        },
  };
}
/*
 * ?divergence=fork / suspend / converge / partial：给预览数据配一份 v1.1 分歧账。
 *
 * 与立案同一个理由：预览页没有输入区，不造一份，F 段与 E4 那四格「做了」的样子
 * 就永远没人看过；而「没做」的样子天天见。partial 那一份故意缺几格，
 * 用来拍「填了但没填齐」——那才是这一栏最常出现的状态。
 */
function withDivergence(d: Diagnosis, q: string): Diagnosis {
  if (!q) return d;
  const base: Divergence = {
    frame: { formal: 'classical', criterion: 'scheme-cq', dimension: 'dialectic', protocol: 'persuasion' },
    closure: 'fork',
    branches: 2,
    entries: [
      { at: 'B2 补 A：宽读补最弱、严读补作者最可能的意思', source: 'F2', stakes: 'level' },
      { at: 'C2 型式：专家意见还是例证', source: 'F3', stakes: 'handling' },
    ],
    common: '缺陷都在「早读提高记忆效率」这一步，方向是支持不足，可加固',
    difference: '补出的 A 与选中的型式（第 2 条前提 / C2 那一格判据）',
    condition: '作者给出原始研究出处 → 只剩宽读；只给二手转述 → 只剩严读',
    basis: '宽读：原文第 3 句 + 未过的 CQ「样例是否典型」；严读：原文第 3 句 + 未过的 CQ「转述是否准确」',
    decidable: '',
    burden: '',
    at: Date.now(),
  };
  if (q === 'converge') {
    return { ...d, divergence: { ...base, closure: 'converge' as const, branches: 0, entries: [], common: '', difference: '', basis: '' } };
  }
  if (q === 'suspend') {
    return {
      ...d,
      divergence: {
        ...base,
        closure: 'suspend' as const,
        branches: 0,
        common: '',
        basis: '',
        decidable: '「学校去年取消了早读」这一事实主张仍可由校历与通知核定',
        difference: '「是否应当恢复」是价值选择，不由论证裁定',
        condition: '需拿到去年的校历与家长群原始通知，并澄清「恢复」指自愿还是强制',
        burden: '主张恢复的一方',
      },
    };
  }
  if (q === 'partial') {
    return {
      ...d,
      divergence: {
        ...base,
        frame: { ...base.frame, protocol: 'unknown' },
        common: '',
        condition: '',
        entries: [{ at: '', source: 'unknown', stakes: 'unknown' }],
      },
    };
  }
  return { ...d, divergence: base };
}
/*
 * ?ph=old / unknown / none / mismatch：给预览数据配一份「这把尺子」的状态。
 *
 * 预览样例本身没有 prompt 字段（MOCK 是判读用的，不是追溯用的），不补就是「没记版本」，
 * 于是这一栏最完整、最该被人看一眼的样子永远拍不到。默认补当前基线里这一组合的
 * 真实版本与指纹——数字不是写死的，基线换了预览自动跟上。
 *   old      另一版，且变更史里找得到那一行注记
 *   unknown  另一版，但本机没有它的注记（「不能凭版本号推断」那句话的样子）
 *   none     旧存档没记版本
 *   mismatch 版本号对、指纹不对（同一版号下有过不止一套内容）
 */
function withPromptHistory(d: Diagnosis, q: string): Diagnosis {
  const combo = `${d.theory}.${d.mode}`;
  const fp = PROMPT_BASELINE.fingerprints[combo] ?? PROMPT_BASELINE.fingerprints['walton.diagnose'];
  const current = { version: PROMPT_BASELINE.version, fingerprint: fp };
  if (q === 'none') return { ...d, prompt: undefined };
  if (q === 'old') return { ...d, prompt: { version: '2.0.0', fingerprint: 'aaaaaaaaaaaa' } };
  if (q === 'unknown') return { ...d, prompt: { version: '9.9.9', fingerprint: 'bbbbbbbbbbbb' } };
  if (q === 'mismatch') return { ...d, prompt: { ...current, fingerprint: 'ffffffffffff' } };
  return { ...d, prompt: current };
}
const D = withPromptHistory(
  withDivergence(
    withBrief(
      new URLSearchParams(location.search).get('gaps') === 'clean' ? withNoGaps(LONG_DEMO) : LONG_DEMO,
      new URLSearchParams(location.search).get('brief') ?? ''
    ),
    new URLSearchParams(location.search).get('divergence') ?? ''
  ),
  new URLSearchParams(location.search).get('ph') ?? ''
);
const t = THEORY_BY_ID[D.theory];
const MOCK_DISPUTES = disputesIn(D);

/*
 * ?digest=1：异议账（这份报告里你不同意哪几处）。
 *
 * 这块只在**已经有异议**时出现，而预览页没有存档也没有主进程，
 * 不造几条就永远拍不到它——「没人见过的界面等于没做」那种状态。
 * 四条记录覆盖三种情况：有理由、没写理由、以及工作台里钉的（跳不过去）。
 * 它们只是演示数据，不进任何统计。
 */
/* ?digest=1 只看收起那条；?digest=open 连逐条也展开（展开态只有点过才出现）。 */
const DIGEST_Q = new URLSearchParams(location.search).get('digest') ?? '';
const DIGEST_ON = DIGEST_Q === '1' || DIGEST_Q === 'open';
const MOCK_DIGEST: Objection[] = [
  {
    key: `${D.theory}:verdict:verdict`,
    diagId: D.id,
    at: Date.UTC(2026, 10, 12, 9, 40),
    theory: D.theory,
    field: 'verdict',
    refId: 'verdict',
    refLabel: '判读',
    excerpt: '被削弱。',
    reason: '',
  },
  {
    key: `${D.theory}:check:CQ2`,
    diagId: D.id,
    at: Date.UTC(2026, 10, 12, 9, 46),
    theory: D.theory,
    field: 'check',
    refId: 'CQ2',
    refLabel: 'CQ2 因果方向',
    excerpt: '从相关跨到因果这一步。',
    reason: '一本率下滑那一年同时换了教材，报告没有排除这一条。',
  },
  {
    key: `${D.theory}:check:CQ3`,
    diagId: D.id,
    at: Date.UTC(2026, 10, 12, 9, 52),
    theory: D.theory,
    field: 'check',
    refId: 'CQ3',
    refLabel: 'CQ3 替代解释',
    excerpt: '有没有第三因素被排除。',
    reason: '同届考生人数也变了，报告没提。',
  },
  {
    key: `${D.theory}:legitimate:P2`,
    diagId: D.id,
    at: Date.UTC(2026, 10, 12, 10, 3),
    theory: D.theory,
    field: 'legitimate',
    refId: 'P2',
    refLabel: '此处合法',
    excerpt: '引校长的话作为依据，在这个语境里是允许的。',
    reason: '这里引原话是为了说明对方立场，不是拿权威压人。',
  },
  {
    key: 'anchor:sentence:2',
    diagId: D.id,
    at: Date.UTC(2026, 10, 12, 10, 9),
    theory: D.theory,
    field: 'anchor',
    refId: 'workbench',
    refLabel: '原文第 2 句',
    excerpt: '王校长在一份公开材料里说……',
    reason: '这句其实是在转述，不是作者自己的主张。',
  },
];

/*
 * 样本账的预览数据。用 portfolioOf 现算而不是写死一串数字：
 * 预览页里的数目必须和真应用同一套口径，否则截图会替一个不存在的算法作证。
 * 时间戳全是固定值，预览页每次刷新都是同一份账。
 */
const MOCK_FOLIO = portfolioOf([
  { id: 'f1', at: Date.UTC(2026, 10, 4, 10, 12), passage: D.passage },
  { id: 'f2', at: Date.UTC(2026, 10, 3, 9, 3), passage: D.passage },
  { id: 'f3', at: Date.UTC(2026, 10, 2, 16, 40), passage: D.passage },
  { id: 'f4', at: Date.UTC(2026, 10, 1, 8, 15), passage: `${D.passage}另外，隔壁两个县情况类似。` },
  {
    id: 'f5',
    at: Date.UTC(2026, 9, 28, 14, 20),
    passage:
      '这款护肝片把排毒两个字印在包装正面，包装上却没写排的是什么、拿什么量。' +
      '客服说很多人吃了精神好，这跟肝有没有变好是两件事。',
  },
  { id: 'f6', at: Date.UTC(2026, 9, 20, 11, 5), passage: '你行你上' },
]);

/*
 * 同题复跑的预览数据。同样用真内核现算：预览页要拍的正是「有相同、有一处不同」这两种组，
 * 写死一串数字的话，截图会替一个不存在的算法作证。
 *
 * 假报告的字段形状照着真报告取（verdict / context / checks / labels），
 * 这样差异路径读起来和真存档里的一样。
 */
const mockReport = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  verdict: { level: 'weakened', whatIsRefuted: '取消早读导致一本率下降' },
  context: { issue: '该不该恢复早读', dialogueType: 'persuasion' },
  checks: [
    { id: 'c1', answer: 'answered' },
    { id: 'c2', answer: 'answered' },
  ],
  labels: [{ id: 'hasty', name: '轻率概括', landsOnCheck: 'c1' }],
  ...over,
});
/*
 * 「谁跑的」这一栏也要能拍到：第一组同一模型、两个温度（演示「温度换过」），
 * 第二组换了模型。旧存档那种「没记模型」的状态由 g6 体现——它没有指纹，
 * 本来就不进比对；不另外造假数据，因为预览页只该展示真会出现的样子。
 */
const MOCK_G1 = mockReport({ engine: { model: 'deepseek-chat', host: 'api.deepseek.com', temperature: 0.2 } });
const MOCK_G3 = mockReport({
  labels: [{ id: 'hasty', name: '轻率概括', landsOnCheck: 'c2' }],
  engine: { model: 'deepseek-chat', host: 'api.deepseek.com', temperature: 0.7 },
});
const MOCK_AGREE = agreementOf([
  { id: 'g1', at: Date.UTC(2026, 10, 4, 10, 12), mode: 'diagnose', theory: 'walton', version: '2.5.0', fingerprint: 'cadbec610c06', passage: D.passage, report: MOCK_G1 },
  { id: 'g2', at: Date.UTC(2026, 10, 3, 9, 3), mode: 'diagnose', theory: 'walton', version: '2.5.0', fingerprint: 'cadbec610c06', passage: D.passage, report: MOCK_G1 },
  { id: 'g3', at: Date.UTC(2026, 10, 2, 16, 40), mode: 'diagnose', theory: 'walton', version: '2.5.0', fingerprint: 'cadbec610c06', passage: D.passage, report: MOCK_G3 },
  { id: 'g4', at: Date.UTC(2026, 9, 28, 14, 20), mode: 'diagnose', theory: 'walton', version: '2.4.0', fingerprint: 'c532993045d9', passage: '这款护肝片把排毒两个字印在包装正面，包装上却没写排的是什么、拿什么量。' + '客服说很多人吃了精神好，这跟肝有没有变好是两件事。', report: mockReport({ engine: { model: 'gpt-4o-mini', host: 'api.openai.com', temperature: 0.2 } }) },
  { id: 'g5', at: Date.UTC(2026, 9, 27, 11, 5), mode: 'diagnose', theory: 'walton', version: '2.4.0', fingerprint: 'c532993045d9', passage: '这款护肝片把排毒两个字印在包装正面，包装上却没写排的是什么、拿什么量。' + '客服说很多人吃了精神好，这跟肝有没有变好是两件事。', report: mockReport({ engine: { model: 'gpt-4o-mini', host: 'api.openai.com', temperature: 0.2 } }) },
  { id: 'g6', at: Date.UTC(2026, 9, 20, 11, 5), mode: 'diagnose', theory: 'walton', version: null, fingerprint: null, passage: '你行你上', report: mockReport() },
]);

/*
 * 「两份对照」的预览数据。
 *
 * 拿真报告当甲，把它改三处当乙：一条检查项改了答案与依据、评级降了一档、
 * 修补那一栏的缺失前提被抹掉。三种情形（两边都有的值不同 / 整段降档 / 只有甲有）都在，
 * 这样截图能同时说明「差异长什么样」和「缺失长什么样」。
 *
 * 不用 `mockReport()` 那种两三个字段的假报告：那一屏正是要给人看
 * 「一份完整报告有几处会动」，字段太少的话，截图会替一个过于整齐的世界作证。
 */
const SIDEBY_A: Diagnosis = {
  ...D,
  id: 'sb-a',
  createdAt: Date.UTC(2026, 10, 4, 10, 12),
  prompt: { version: '2.5.0', fingerprint: 'cadbec610c06' },
  engine: { model: 'deepseek-chat', host: 'api.deepseek.com', temperature: 0.2 },
};
const SIDEBY_B: Diagnosis = {
  ...SIDEBY_A,
  id: 'sb-b',
  createdAt: Date.UTC(2026, 10, 3, 9, 3),
  verdict: { ...SIDEBY_A.verdict, level: 'fails' },
  checks: (SIDEBY_A.checks ?? []).map((c, i) =>
    i === 1 ? { ...c, answer: 'violated' as const, basis: '这一关没答上：给的是同比，不是因果证据。' } : c,
  ),
  refutations: (SIDEBY_A.refutations ?? []).slice(0, 2),
  repair: { ...SIDEBY_A.repair, missingPremise: null },
};

/*
 * 「下一句」的预览数据。同样用真内核现算，不写死一串数目——
 * 截图要是替一个不存在的算法作证，它就只是好看，不能当证据。
 * 四句里两句逐字相同，正好看得出「只数逐字相同」长在界面上是什么样。
 */
const MOCK_NEXTLINE = nextLinesOf([
  {
    id: 'q1',
    at: Date.UTC(2026, 10, 4, 10, 21),
    text: '所以呢',
    diagId: 'r3',
    passageHead: D.passage.slice(0, 32),
    theory: D.theory,
  },
  {
    id: 'q2',
    at: Date.UTC(2026, 10, 3, 9, 12),
    text: '这跟我上次那篇稿子里的毛病是一样的',
    diagId: 'r2',
    passageHead: D.passage.slice(0, 32),
    theory: D.theory,
  },
  {
    id: 'q3',
    at: Date.UTC(2026, 10, 2, 16, 55),
    text: '所以呢',
    diagId: 'r1',
    passageHead: D.passage.slice(0, 32),
    theory: D.theory,
  },
]);

/*
 * 历史面板预览（?dlg=history）。
 *
 * 为什么预览页也要能开它：这个面板的样式曾经整块缺失，而它不报错、不影响构建，
 * DOM 里节点也都在——smoke 数得出来，typecheck 过得去，只有人眼看得出排版是裸的。
 * 所以给它留一个截图入口，改动之后能真的看一眼。
 *
 * 面板要读 IPC，浏览器里没有 window.api，这里替掉。替的是列表与统计这两条只读路径，
 * 不含删除——预览页上不该有能删掉真数据的按钮。
 */
const H0 = Date.now() - 1000 * 60 * 60 * 26;
const MOCK_HISTORY: ReportMeta[] = [
  {
    id: 'r3',
    at: H0 + 1000 * 60 * 90,
    theory: D.theory,
    mode: 'diagnose',
    parentId: 'r2',
    chars: D.passage.length,
    excerpt: D.passage.replace(/\s+/g, ' ').trim().slice(0, 72),
    level: 'withstands',
    open: 0,
    cost: 0.021,
    bytes: 18432,
  },
  {
    id: 'r2',
    at: H0 + 1000 * 60 * 40,
    theory: D.theory,
    mode: 'redteam',
    parentId: null,
    chars: D.passage.length,
    excerpt: D.passage.replace(/\s+/g, ' ').trim().slice(0, 72),
    level: 'weakened',
    open: 2,
    cost: 0.018,
    bytes: 17120,
  },
  {
    id: 'r1',
    at: H0,
    theory: D.theory,
    mode: 'reconstruct',
    parentId: null,
    chars: D.passage.length,
    excerpt: D.passage.replace(/\s+/g, ' ').trim().slice(0, 72),
    level: 'undetermined',
    open: 0,
    cost: null,
    bytes: 15980,
  },
];

const MOCK_OBJECTIONS: ObjectionStat[] = [
  {
    key: `${D.theory}:check:CQ2`,
    theory: D.theory,
    field: 'check',
    refId: 'CQ2',
    refLabel: 'CQ2 领域相关性',
    excerpt: '专家说的领域与结论所属领域不是同一个。',
    count: 3,
    lastAt: H0 + 1000 * 60 * 30,
    reasons: ['这位专家的研究方向是材料，不是流行病学。', '引的是十年前的综述。'],
  },
  {
    key: `${D.theory}:verdict:verdict`,
    theory: D.theory,
    field: 'verdict',
    refId: 'verdict',
    refLabel: '判读',
    excerpt: '被削弱。',
    count: 1,
    lastAt: H0,
    reasons: [],
  },
];

if (new URLSearchParams(location.search).get('dlg') === 'history') {
  (window as unknown as { api: unknown }).api = {
    archive: {
      list: async () => MOCK_HISTORY,
      /* 体检的替身：三份都读得出来、索引与磁盘一致。缺了它预览页会先闪一条红条。 */
      health: async () => ({
        dirError: null,
        issues: [],
        healthyFiles: MOCK_HISTORY.length,
        indexState: 'ok' as const,
        indexReason: null,
        indexEntries: MOCK_HISTORY.length,
        missing: [],
        orphans: [],
        checkedAt: Date.now(),
      }),
      /*
       * 检索的替身。预览页手上没有真报告，只有三行摘要——所以它只在摘要里找，
       * 搜不到正文里的字。这不是缺陷：预览页是看版面用的，
       * 「搜得到」由真机冒烟在真存档上验（见 `AL_PANEL=history`）。
       */
      find: async (q: string) => {
        const terms = parseTerms(q);
        const hits = MOCK_HISTORY.filter((m) =>
          terms.every((t) => m.excerpt.toLowerCase().includes(t)),
        ).map((m) => ({
          id: m.id,
          at: m.at,
          count: terms.reduce(
            (n, t) => n + m.excerpt.toLowerCase().split(t).length - 1,
            0,
          ),
          where: ['passage'] as SearchWhere[],
          snippet: m.excerpt,
          snippetWhere: 'passage' as const,
        }));
        return { terms, scanned: MOCK_HISTORY.length, unreadable: 0, dirError: null, hits };
      },
      remove: async () => MOCK_HISTORY,
      reveal: () => {},
    },
    objections: { stats: async () => MOCK_OBJECTIONS, reveal: () => {} },
  };
}

/*
 * 用量面板的假数据（?dlg=usage）。
 *
 * 这一屏以前没有预览入口，改了文案只能靠猜版面——而它恰恰是用户最在意的一屏。
 *
 * 数据刻意贴近真实那次的情况：82 次真调用、115 条模拟记录被排除、
 * 金额按内置参考价估的、缓存命中 86%。四个新字段必须在一屏里同时看得见，
 * 否则「改了但没验证」和「没改」在外观上没有区别。
 */
const mockRun = (
  i: number,
  theory: TheoryId,
  pt: number,
  ct: number,
  ms: number,
  cacheHit: number | undefined,
  /** 预览里留一条「按现价回填」的样本，界面上那个「回」标记才看得见 */
  backfilled = false
): UsageRow => {
  const cost = (pt * 1 + ct * 2) / 1e6;
  return {
    id: `u${i}`,
    at: Date.now() - i * 7 * 60_000,
    ok: true,
    theory,
    model: 'deepseek-chat',
    host: 'api.deepseek.com',
    promptTokens: pt,
    completionTokens: ct,
    estimated: false,
    cost: backfilled ? 0 : cost,
    effCost: cost,
    backfilled,
    priced: !backfilled,
    currency: '¥',
    priceIn: backfilled ? 0 : 1,
    priceOut: backfilled ? 0 : 2,
    ms,
    chars: 428,
    cacheHitTokens: cacheHit,
  };
};

/**
 * 设置页预览（?dlg=settings[&onboard=1][&bad=1]）。
 *
 * 这一屏以前没有任何预览入口，从来没有人眼看过：它要读 IPC，静态预览页跑不了；
 * 真应用里得进设置才看得见。而「留空 = 不动已存的 Key」「要清掉得显式点」
 * 这两条规矩恰好都落在这里——规矩写在代码里、界面没验过，等于没验。
 *
 * ?onboard=1 是首次启动那一版（多一段「为什么必须配」）。
 * ?bad=1 让保存返回一条校验错误，用来看错误行长什么样：那是这一轮新加的分支，
 * 只在地址写错时才出现，平时截图永远碰不到。
 */
const QS = new URLSearchParams(location.search);
const SETTINGS_BAD = QS.get('bad') === '1';

/**
 * ?digest=1 时才挂异议上下文。
 *
 * 平时**不挂**：ObjectBtn 在没有上下文时返回 null，预览页里那十几处「不同意」
 * 按钮就该保持不可见——它们是报告内容的一部分，不该为了拍一张账而全亮起来。
 */
function MaybeDigest({ children }: { children: ReactNode }) {
  if (!DIGEST_ON) return <>{children}</>;
  return (
    <ObjectionCtx.Provider
      value={{
        diagId: D.id,
        theory: D.theory,
        list: MOCK_DIGEST,
        /* 预览页不写盘：点了只为看版式，真链路在端到端冒烟里走。 */
        add: () => {},
        remove: () => {},
      }}
    >
      {children}
    </ObjectionCtx.Provider>
  );
}

/*
 * ?at=<section id>：把报告里任意一节滚进视野。
 *
 * 一栏一个截图入口（?digest / ?tone / ?coverage / ?terms …）已经攒了七个，
 * 每个只为一个元素服务；报告越长，这种入口越会变成负担。
 * 这里给一个通用的，顺手也给「新加一栏就想拍它」这件事省掉一个开关。
 */
function ScrollToAnchor(): null {
  useEffect(() => {
    const id = QS.get('at');
    if (!id) return;
    const timer = window.setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ block: 'start' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}

/*
 * ?digest=open：把异议账逐条展开。
 *
 * 展开态只在用户点过之后出现，不点开就永远拍不到——「没人见过的界面等于没做」。
 * 走的是同一个按钮（点它，而不是把状态塞进去），这样截图里看到的就是真实那一屏。
 */
function DigestAnchor(): null {
  useEffect(() => {
    if (QS.get('digest') !== 'open') return;
    window.setTimeout(() => {
      const btn = document.querySelector('[data-obj-digest-toggle]');
      if (btn instanceof HTMLElement && !document.querySelector('[data-obj-digest-item]')) btn.click();
    }, 60);
  }, []);
  return null;
}

/*
 * ?tone=1：把页面滚到「结论的口气」那一块。
 *
 * 它长在「重构」这一段里，离首屏很远；不滚的话截图只能拍到头两屏，
 * 而「只在特定时刻出现的屏没人见过」这个坑，这一块同样适用——
 * 它只在有结论时出现，且三种 verdict 长得不一样。
 */
function ToneAnchor(): null {
  useEffect(() => {
    if (QS.get('tone') !== '1') return;
    const el = document.querySelector('[data-tone]');
    if (el) el.scrollIntoView({ block: 'center' });
  }, []);
  return null;
}

/*
 * ?gaps=1：把页面滚到「骨架缺口」那一块。
 *
 * 它在首屏偏下，而且缺口的条数会变（0 条时是另一种版式），
 * 两种版式都要有入口，否则「缺口清零」那一版永远没人见过。
 */
function GapsAnchor(): null {
  useEffect(() => {
    /* `?gaps=1` 与 `?gaps=clean` 都要滚到这一块：两种版式各截一张。 */
    if (!QS.get('gaps')) return;
    const el = document.querySelector('[data-skeleton]');
    if (el) el.scrollIntoView({ block: 'center' });
  }, []);
  return null;
}

/* ?rewrite=1：滚到第一条主张下面的「逐字比」。它分散贴在每张卡上，不另起一栏。 */
function RewriteAnchor(): null {
  useEffect(() => {
    if (QS.get('rewrite') !== '1') return;
    const el = document.querySelector('[data-rewrite]');
    if (el) el.scrollIntoView({ block: 'center' });
  }, []);
  return null;
}

/*
 * ?source=1：滚到报告顶部的来源账，并把它点开。
 * 默认收起的清单没人见过就等于没做，这个入口专门拍展开那一版。
 * 滚动与点击分两拍：同一个 effect 里点完立刻读，界面还没重绘（探针抢跑那个老坑）。
 */
function SourceAnchor(): null {
  useEffect(() => {
    if (QS.get('source') !== '1') return;
    const el = document.querySelector('[data-source-bar]');
    if (el) el.scrollIntoView({ block: 'center' });
    window.setTimeout(() => {
      const btn = document.querySelector('[data-source-toggle]');
      if (btn instanceof HTMLElement && !document.querySelector('[data-source-list]')) btn.click();
    }, 60);
  }, []);
  return null;
}

/*
 * ?coverage=1：滚到报告里的长文覆盖账，并把它点开。
 * 这一栏只在长文本上出现，演示原文由上面的 LONG_DEMO 给；滚动与点击分两拍，
 * 免得同一个 effect 里点完立刻读、界面还没重绘（探针抢跑那个老坑）。
 */
function CoverageAnchor(): null {
  useEffect(() => {
    if (QS.get('coverage') !== '1') return;
    const el = document.querySelector('[data-coverage]');
    if (el) el.scrollIntoView({ block: 'center' });
    window.setTimeout(() => {
      const btn = document.querySelector('[data-coverage-toggle]');
      if (btn instanceof HTMLElement && !document.querySelector('[data-coverage-list]')) btn.click();
    }, 60);
  }, []);
  return null;
}

/*
 * ?terms=1：滚到学术分析里的「这一圈的词」。
 * 展开与演示词由 DiagnosisView 的 initialTerms / initialTermsWords 直接给，
 * 这里只负责滚动——这一栏在报告中部，不滚就永远拍不到。
 */
function TermsAnchor(): null {
  useEffect(() => {
    if (QS.get('terms') !== '1') return;
    const el = document.querySelector('[data-terms-bar]');
    if (el) el.scrollIntoView({ block: 'center' });
  }, []);
  return null;
}

/*
 * 分析进行中（?running=checking&wait=42）。
 *
 * 这一屏在真应用里只存在 30–90 秒，而且必须先发一次真请求才看得到；
 * 没有入口，它的版式就只能靠想象。阶段文案照抄 analyze.ts 里 onProgress 的那几句——
 * 那边改了，这里要跟着改（预览页只核对版式，不保证措辞最新）。
 */
const RUN_STAGES: Record<string, { label: string; percent: number }> = {
  scope: { label: '按「论证型式与批判性问题」拆解', percent: 10 },
  reconstructing: { label: '重构论证与隐含前提', percent: 25 },
  checking: { label: '逐条走检查项', percent: 50 },
  verdict: { label: '把逐条结果收成一个判读', percent: 80 },
  'self-check': { label: '自检与回填原文位置', percent: 92 },
};
const RUN_KEY = QS.get('running') ?? '';
const RUN_STAGE = RUN_STAGES[RUN_KEY] ?? null;
const RUN_WAIT = Number(QS.get('wait') ?? 0);
/**
 * `&stopping=1`：按下去之后的那一瞬间。
 *
 * 这个状态在真应用里只有几百毫秒，而它正是「按了但没反应」最容易糊弄过去的地方——
 * 按钮要是没变字，用户分不清「按中了」和「没按中」。留一个能截图核对的入口。
 */
const RUN_STOPPING = QS.get('stopping') === '1';

/**
 * 长文台账夹具。
 *
 * 只供预览页看版式：六段里四段跑成（三种档位各一份，另有一段「判不了」）、
 * 一段失败、一段没跑。三种状态必须同屏出现——只拍「全都跑成」的那一版，
 * 失败与没跑这两行长什么样就永远没人核过，而它们恰恰是最容易被画成空白的两行。
 *
 * 真应用里这张表由 `runBatch` 一段一段填，`?longform=busy` 拍的是「正在跑」那一态。
 */
const LONGFORM = QS.get('longform') ?? '';
const LF_SEG_TEXT = [
  '我们学校去年取消了早读，今年高考一本率下降了 6 个百分点。这说明取消早读是错的。',
  '王校长在公开材料里说，早读能提高记忆效率，学生就该早起读书。但他没有给出任何数据。',
  '如果连早读都保证不了，将来上课、自习、考试还能保证什么？',
  '另外，很多家长也反对取消早读，可见取消早读不得人心。',
  '学校的作息安排应当听取家长意见，这一点在教育部文件里有明确规定。',
  '总之，早读必须立刻恢复，否则教学质量会继续下滑。',
];
const MOCK_LEDGER: LongLedger = {
  version: 1,
  id: 'lf-preview-0001',
  createdAt: Date.now(),
  passageChars: 1683,
  passageHash: 'preview1',
  items: LF_SEG_TEXT.map((text, i) => {
    const levels: (LongItem['level'])[] = ['weakened', 'weakened', 'undetermined', 'fails', null, 'undetermined'];
    /* 第 3 段是问句：默认不排进来。台账里它照样占一行，否则段号会从 2 跳到 4。 */
    const status: LongItem['status'] =
      i === 2
        ? 'skipped'
        : LONGFORM === 'busy'
          ? i < 4
            ? 'ok'
            : i === 4
              ? 'running'
              : 'idle'
          : i < 4
            ? 'ok'
            : i === 4
              ? 'failed'
              : 'idle';
    return {
      job: {
        index: i,
        chars: 96 + i * 37,
        kind: i === 2 ? 'aside' : 'argument',
        cutBasis: 'blank',
        text,
        preview: text.slice(0, 40),
        previewTruncated: text.length > 40,
      },
      status,
      reportId: status === 'ok' ? `preview-report-${i}` : null,
      level: status === 'ok' ? levels[i] : null,
      error:
        status === 'failed'
          ? '请求被限流（429）。请稍后重试。'
          : status === 'skipped'
            ? '这一段是问句，单独分析多半是一份空报告'
            : null,
    };
  }),
};


if (QS.get('dlg') === 'settings') {
  const saved = {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    temperature: 0.2,
    apiKey: '',
    hasKey: true,
    keyUnreadable: false,
  };
  (window as unknown as { api: unknown }).api = {
    settings: {
      get: async () => saved,
      save: async () =>
        SETTINGS_BAD
          ? { ok: false, error: '接口地址要以 http:// 或 https:// 开头（现在填的是 file:///D:/tmp）' }
          : { ok: true },
      test: async () => ({ ok: true, message: '连上了：deepseek-chat 回了 4 个字，用时 1.3 秒。' }),
    },
  };
}

const MOCK_USAGE: UsageSummary = {
  today: { count: 6, okCount: 6, tokens: 48_600, cost: 0.068 },
  month: { count: 82, okCount: 82, tokens: 856_709, cost: 1.113 },
  all: { count: 82, okCount: 82, tokens: 856_709, cost: 1.113 },
  daily: Array.from({ length: 14 }, (_, i) => {
    const n = [3, 5, 0, 8, 12, 4, 0, 6, 9, 3, 7, 11, 5, 6][i];
    const d = new Date(Date.now() - (13 - i) * 86_400_000);
    return { date: d.toISOString().slice(0, 10), count: n, tokens: n * 8_600, cost: n * 0.0136 };
  }),
  recent: [
    mockRun(0, 'walton', 8_457, 2_826, 14_390, 7_460),
    mockRun(1, 'copi', 7_471, 3_133, 16_935, 6_600, true),
    mockRun(2, 'toulmin', 6_159, 3_435, 19_130, undefined),
  ],
  pricing: { inPerM: 0, outPerM: 0, currency: '¥' },
  hasPricing: false,
  balance: {
    anchor: null,
    spentSince: 0,
    remaining: null,
    runsLeft: null,
    avgCostPerRun: 0.0136,
    avgBasis: 10,
  },
  estimatedShare: 0,
  backfilled: 82,
  mockExcluded: 115,
  pricingSource: 'builtin',
  cacheHitShare: 0.86,
};

if (new URLSearchParams(location.search).get('dlg') === 'usage') {
  const readOnly = {
    summary: async () => MOCK_USAGE,
    setPricing: async () => MOCK_USAGE,
    setAnchor: async () => MOCK_USAGE,
    clearAnchor: async () => MOCK_USAGE,
    // 预览页不该能往磁盘上写文件
    export: async () => null,
    reveal: () => {},
  };
  (window as unknown as { api: unknown }).api = { usage: readOnly };
}

/**
 * 截图用的学术样例。只在 ?ac=1 时替换 passage，其余字段仍是那份社论报告的。
 *
 * 这种错配只有预览页才允许：真应用里 passage 与报告一一对应，这里故意不一致，
 * 是为了在一屏里把学术栏的四个部分都看清楚（体裁、待核清单、规范清单、反驳顺序）。
 * 它含六类可核线索，正好把「抽得到」那条路走一遍；不带参数时走的是社论原文，
 * 那条路是「抽不到」——两种状态都要能看到，只截一种等于没验。
 */
const AC_SAMPLE =
  '摘要：本文认为彩礼的性质不能只看金额。关键词：彩礼；法律；性别。' +
  '本研究采用问卷法，样本量为 1200 人，数据显示 43% 的受访者认为彩礼属于风险保障，另有 32% 用于个人储蓄（张三 2019）。' +
  '有学者指出，这一比例在东中部地区差异显著[1]。转引自李四的综述，学界普遍认为该分歧尚未解决。' +
  '研究表明，彩礼水平与离婚率呈负相关。';

/** 纯静态预览：不接 IPC，不看模型，只看界面。用于截图核对版式。 */
function Preview() {
  // 截图脚本用 ?scroll=1300 定位到下半部分，便于逐段核对版式
  useEffect(() => {
    const y = Number(new URLSearchParams(location.search).get('scroll') ?? 0);
    if (y) {
      const el = document.querySelector('.main');
      if (el) el.scrollTop = y;
    }
  }, []);

  /*
   * ?bad=1 时替人按一下「保存」，让校验失败那一行出现在截图里。
   * 那一行只在保存被拒时才有，静态预览不点按钮就永远拍不到——
   * 拍不到的分支等于没写过。
   */
  useEffect(() => {
    if (!SETTINGS_BAD) return;
    const id = window.setTimeout(() => {
      const btn = document.querySelector<HTMLButtonElement>('.dialog-foot.split .primary');
      btn?.click();
    }, 400);
    return () => window.clearTimeout(id);
  }, []);

  /*
   * 预览页的顶栏是手写的，不会自动跟随 App.tsx 的改动。
   * 每加一个顶栏按钮就要在这里补一次——不补的后果是：截图看着没问题，
   * 真应用里多一个按钮，而截图正是拿来核对版式用的。这条注意是给未来的自己。
   */
  /*
   * ?ac=1 时换上一段含六类可核线索的学术样例，用来核对学术栏「抽得到」那条路。
   * 只换 passage：其余字段仍是那份社论报告的，所以这一屏的结构与其他区块不一致——
   * 预览页只用来核对版式，这一点写在 AC_SAMPLE 的注释里。
   */
  const acOn = new URLSearchParams(location.search).get('ac') === '1';
  /*
   * ?oos=1 换成「范围门判不适用」的那一屏。
   *
   * 这一屏以前没有任何办法在预览里看到——它只在真模型判不适用时才出现，
   * 而那正是评测里发现「横幅不给下一步、检查栏空着一张表」的那一屏。
   * 看不见的状态等于没测过的状态。
   */
  const oosOn = new URLSearchParams(location.search).get('oos') === '1';
  const OOS = {
    ...D,
    scope: {
      applicable: false,
      reason: '这段文本是独白式的政策评论，不是批判性讨论的一个回合：它没有回应某个具体反对意见，也没有给对方留下申辩的位置。',
      outOfScopeAt: '整段——不存在可逐条追问的讨论回合',
      partialNote: null,
    },
    checks: [],
    verdict: { ...D.verdict, level: 'undetermined' as const, statement: '这副透镜在此不适用，因此不作判定。' },
    repair: {
      ...D.repair,
      alternativeReading: '换用型式法或 ARS 三标准，可以逐条检验「北欧经验不可搬」的类比是否恰当、托育与生育意愿的因果概括是否可靠，而不要求文本里存在对手。',
    },
  };
  /*
   * ?mode=<模式名>：换报告的显示模式。
   *
   * 为什么要有它：模式改的是**措辞与分区**，不是数据，端到端冒烟虽然五模式各跑一趟，
   * 但它的截图是整页长图，人眼核对措辞不如预览页方便。加了这个开关，
   * 截图跑道（ui:preview 传入参数）就能对五个模式各截一版，改动措辞后能逐模式看一眼。
   * 不是五模式之一的值直接忽略——预览页宁可退回诊断版，也不显示一半错的状态。
   */
  const QMODE = new URLSearchParams(location.search).get('mode');
  const qMode: typeof D['mode'] | null = (ANALYSIS_MODES as readonly string[]).includes(QMODE ?? '')
    ? (QMODE as typeof D['mode'])
    : null;
  const shown: typeof D = acOn
    ? { ...D, passage: AC_SAMPLE }
    : oosOn
      ? OOS
      : qMode
        ? {
            ...D,
            mode: qMode,
            /*
             * 命名类模式不给档位，端到端里这步是裁决层做的（MODE_NO_VERDICT），
             * 预览页跳过了裁决层，所以要在这里补上——否则预览页显示「被削弱」的刻度尺，
             * 而真应用同一份数据显示「判不了」。预览页说谎，截图审计就会带着错截图走。
             */
            verdict:
              MODE_META[qMode].givesVerdict
                ? D.verdict
                : { ...D.verdict, level: 'undetermined' as const },
          }
        : D;
  const [theoryOpen, setTheoryOpen] = useState(new URLSearchParams(location.search).get('dlg') === 'theory');
  const [dispOpen, setDispOpen] = useState(false);
  const [focusClaim, setFocusClaim] = useState<string | undefined>(undefined);

  return (
    /* 预览页默认完整：几十张既有截图是这一态拍的。?density=compact 单独拍简洁态。 */
    <DensityProvider initial={QS.get('density') === 'compact' ? 'compact' : PREVIEW_DENSITY}>
    <PlainCtx.Provider value>
    <div className="app">
      <header className="topbar">
        <div className="brand">
          论证镜<small>ARGUMENT LENS</small>
        </div>
        <nav className="tabs">
          <button className="tab on">分析</button>
          <button className="tab">提示词</button>
        </nav>
        <div className="spacer" />
        <button className="plain-toggle on">
          <i />
          大白话
        </button>
        <button className="ghost-btn">术语表</button>
        <button className="ghost-btn" onClick={() => setTheoryOpen(true)}>
          理论
        </button>
        <button className="ghost-btn dp-open" onClick={() => setDispOpen(true)}>
          争议
          <span className="dp-open-n">{MOCK_DISPUTES.length}</span>
        </button>
        <button className="ghost-btn">设置</button>
      </header>

      <div className="lens-bar">
        {THEORIES.map((x) => (
          <button key={x.id} className={`lens-chip ${x.id === D.theory ? 'on' : ''}`}>
            <span className="n">{x.name}</span>
            <span className="u">{x.unit}</span>
          </button>
        ))}
      </div>
      <div className="progress" />

      <div className="body">
        <aside className="side">
          <div className="composer">
            <div className="side-title">原文</div>
            <textarea value={D.passage} readOnly />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="count">{D.passage.length} 字</span>
              <div className="spacer" />
              <button className="primary">分析</button>
            </div>
            <p className="hint">
              按「{t.name}」分析。换一副透镜，同一处地方会被判成不同的东西——这不是错误，是这个工具的立场。
            </p>
            {/*
              ?seg=1：切分条展开的那一版，用来看「逐段跑」入口的版式。
              夹具是六段拼起来的同一篇——真应用里这一段文字来自用户粘贴。
            */}
            {QS.get('seg') === '1' && (
              <SegmentBar
                text={LF_SEG_TEXT.join('\n\n')}
                pickedIndex={null}
                wholeChars={LF_SEG_TEXT.join('\n\n').length}
                onPick={() => {}}
                onRestore={() => {}}
                plan={planLongform(LF_SEG_TEXT.join('\n\n'))}
                onRunBatch={() => {}}
                initialOpen
              />
            )}
            {/* ?portfolio=1：这一栏默认收起，留个入口把展开后的明细也拍下来。 */}            <PortfolioBar view={MOCK_FOLIO} dirError={null} fmt={when} initialOpen={QS.get('portfolio') === '1'} />
            {/* ?agreement=1：同样默认收起，留个入口把展开后的差异明细也拍下来。 */}
            <AgreementBar view={MOCK_AGREE} dirError={null} fmt={when} initialOpen={QS.get('agreement') === '1'} />
          </div>
          <BriefFold>
            <TheoryBrief
              theory={D.theory}
              onSwitch={() => {}}
              onOpenClaim={() => setTheoryOpen(true)}
            />
          </BriefFold>
        </aside>
        <main className="main">
          <DocHead
            crumbs={['论证镜', '分析报告', t.name]}
            title={t.name}
            subtitle={t.plainClaim}
            status={LEVEL_LABEL[D.verdict.level]}
            meta={[`${D.passage.length} 字`, t.unit]}
            callout={
              <>
                这一档是<b>这副透镜量出来的结果，不是判决书</b>。下面逐条给出依据、限定条件与可以反对的地方。
              </>
            }
          />
          {/* ?longform=1：长文台账。夹具里有跑成 / 失败 / 没跑三种行，缺一种就等于没核过。 */}
          {LONGFORM && (
            <LongformLedger
              ledger={MOCK_LEDGER}
              running={LONGFORM === 'busy'}
              onOpen={() => {}}
              onResume={LONGFORM === 'busy' ? undefined : () => {}}
              onStop={() => {}}
            />
          )}
          <ScrollToAnchor />
          <DigestAnchor />
          <ToneAnchor />
          <GapsAnchor />
          <RewriteAnchor />
          <SourceAnchor />
          <TermsAnchor />
          <CoverageAnchor />
          {RUN_STAGE ? (
            <Running
              progress={{ stage: 'checking', label: RUN_STAGE.label, percent: RUN_STAGE.percent }}
              elapsed={RUN_WAIT}
              stopping={RUN_STOPPING}
              /* 预览页里的按钮不接主进程：这里只核版式，真链路在端到端冒烟里点 */
              onStop={() => {}}
            />
          ) : (
            <>
            <MaybeDigest>
            <DiagnosisView
              d={shown}
              /* ?reread=1：只在特定时刻出现的那一屏，必须留一个能拍到它的入口。 */
              initialReread={QS.get('reread') === '1'}
              /* ?rescale=1：同上。预填的两组词只供截图看版式，真应用里由用户自己填。 */
              initialRescale={QS.get('rescale') === '1'}
              initialPairs={
                QS.get('rescale') === '1'
                  ? [
                      { from: '早读', to: '午休' },
                      { from: '一本率', to: '及格率' },
                    ]
                  : undefined
              }
              /* ?conditions=1：同上。预填的三条只为拍版式，真应用里全是空的。 */
              initialConditions={QS.get('conditions') === '1'}
              /* ?views=1：把挑图面板展开；?show=refute,repair 直接打开新增的两张图。 */
              initialViews={QS.get('views') === '1'}
              initialPicked={
                QS.get('show')
                  ? (QS.get('show')!.split(',').filter((x) => /^(structure|checks|verdict|refute|repair)$/.test(x)) as ViewId[])
                  : undefined
              }
              /* ?terms=1：预填的四个词只为拍版式（两个命中、两个不命中），真应用里是空的。 */
              initialTerms={QS.get('terms') === '1'}
              initialTermsWords={QS.get('terms') === '1' ? '早读, 一本率, 成绩, 举证责任' : undefined}
              initialItems={
                QS.get('conditions') === '1'
                  ? [
                      { id: 'p1', text: '得先排除别的原因吗', mark: 'no' as const, sentence: 0 },
                      { id: 'p2', text: '去年和今年只差早读这一件事吗', mark: 'unknown' as const, sentence: 1 },
                      { id: 'p3', text: '两年数据够不够下这个结论', mark: 'unknown' as const, sentence: null },
                    ]
                  : undefined
              }
              onOpenClaim={(id) => {
                // 预览里也走真链路：定位到那一条，顺便打开库，截图能核对高亮
                setFocusClaim(id);
                setTheoryOpen(true);
              }}
            />
            </MaybeDigest>
            {/* ?nextline=1：这一块的明细默认收起，留个入口把展开后的样子也拍下来。 */}
            <NextLineBar
              view={MOCK_NEXTLINE}
              diagId={D.id}
              passageHead={D.passage.slice(0, 32)}
              theory={D.theory}
              fmt={when}
              initialOpen={QS.get('nextline') === '1'}
              /* 预览页不写盘：这两个回调只为让版式可点，真链路在端到端冒烟里走。 */
              onSave={async () => ({ ok: false, error: '预览页不写盘。' })}
              onRemove={async () => ({ ok: false, error: '预览页不写盘。' })}
            />
            </>
          )}
        </main>
      </div>
      {new URLSearchParams(location.search).get('dlg') === 'glossary' && (
        <GlossaryDialog onClose={() => {}} />
      )}
      {theoryOpen && (
        <TheoryBaseDialog
          onClose={() => setTheoryOpen(false)}
          initial={focusClaim ?? new URLSearchParams(location.search).get('claim') ?? undefined}
        />
      )}
      {dispOpen && <DisputeDialog hits={MOCK_DISPUTES} onClose={() => setDispOpen(false)} />}
      {/* ?sideby=1：两份对照。这一屏只在有人挑了两份之后出现，所以必须留个入口拍它。 */}
      {QS.get('sideby') === '1' && <SideBySide pair={{ a: SIDEBY_A, b: SIDEBY_B }} fmt={when} onClose={() => {}} />}
      {new URLSearchParams(location.search).get('dlg') === 'history' && (
        <HistoryPanel onOpen={() => {}} onClose={() => {}} />
      )}
      {new URLSearchParams(location.search).get('dlg') === 'usage' && (
        <UsagePanel onClose={() => {}} onChanged={() => {}} />
      )}
      {QS.get('dlg') === 'settings' && (
        <Settings
          mode={QS.get('onboard') === '1' ? 'onboard' : 'normal'}
          onClose={() => {}}
          onSaved={() => {}}
        />
      )}
    </div>
    </PlainCtx.Provider>
    </DensityProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>
);
