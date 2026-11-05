import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { THEORIES, THEORY_BY_ID } from '@shared/theories';
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
import { NextLineBar } from './components/NextLine';
import { portfolioOf } from '@shared/portfolio';
import { agreementOf } from '@shared/agreement';
import { nextLinesOf } from '@shared/nextline';
import { ANALYSIS_MODES, MODE_META, type ObjectionStat, type ReportMeta, type TheoryId, type UsageRow, type UsageSummary } from '@shared/types';
import './styles.css';
import './styles-usage.css';
import './styles-disputes.css';
import './styles-theory.css';
import './styles-flow.css';
import './styles-history.css';

/*
 * ?lens=toulmin|ars|pta 可以换成另一副透镜的预览数据。
 *
 * 六副透镜的产物栏现在是图，而假模型每次只返回 walton 那一版——
 * 端到端冒烟根本走不到另外几张图。没有这个开关，那几张图会一直躺在仓库里
 * 从没被人眼看过，那是最容易藏错的状态。
 */
const LENS = new URLSearchParams(location.search).get('lens') ?? MOCK.theory;
const D = MOCK_BY_THEORY[LENS] ?? MOCK;
const t = THEORY_BY_ID[D.theory];
const MOCK_DISPUTES = disputesIn(D);

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
const MOCK_G1 = mockReport();
const MOCK_G3 = mockReport({ labels: [{ id: 'hasty', name: '轻率概括', landsOnCheck: 'c2' }] });
const MOCK_AGREE = agreementOf([
  { id: 'g1', at: Date.UTC(2026, 10, 4, 10, 12), mode: 'diagnose', theory: 'walton', version: '2.5.0', fingerprint: 'cadbec610c06', passage: D.passage, report: MOCK_G1 },
  { id: 'g2', at: Date.UTC(2026, 10, 3, 9, 3), mode: 'diagnose', theory: 'walton', version: '2.5.0', fingerprint: 'cadbec610c06', passage: D.passage, report: MOCK_G1 },
  { id: 'g3', at: Date.UTC(2026, 10, 2, 16, 40), mode: 'diagnose', theory: 'walton', version: '2.5.0', fingerprint: 'cadbec610c06', passage: D.passage, report: MOCK_G3 },
  { id: 'g4', at: Date.UTC(2026, 9, 28, 14, 20), mode: 'diagnose', theory: 'walton', version: '2.4.0', fingerprint: 'c532993045d9', passage: '这款护肝片把排毒两个字印在包装正面，包装上却没写排的是什么、拿什么量。' + '客服说很多人吃了精神好，这跟肝有没有变好是两件事。', report: mockReport() },
  { id: 'g5', at: Date.UTC(2026, 9, 27, 11, 5), mode: 'diagnose', theory: 'walton', version: '2.4.0', fingerprint: 'c532993045d9', passage: '这款护肝片把排毒两个字印在包装正面，包装上却没写排的是什么、拿什么量。' + '客服说很多人吃了精神好，这跟肝有没有变好是两件事。', report: mockReport() },
  { id: 'g6', at: Date.UTC(2026, 9, 20, 11, 5), mode: 'diagnose', theory: 'walton', version: null, fingerprint: null, passage: '你行你上', report: mockReport() },
]);

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
    archive: { list: async () => MOCK_HISTORY, remove: async () => MOCK_HISTORY, reveal: () => {} },
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
            {/* ?portfolio=1：这一栏默认收起，留个入口把展开后的明细也拍下来。 */}
            <PortfolioBar view={MOCK_FOLIO} dirError={null} fmt={when} initialOpen={QS.get('portfolio') === '1'} />
            {/* ?agreement=1：同样默认收起，留个入口把展开后的差异明细也拍下来。 */}
            <AgreementBar view={MOCK_AGREE} dirError={null} fmt={when} initialOpen={QS.get('agreement') === '1'} />
          </div>
          <TheoryBrief
            theory={D.theory}
            onSwitch={() => {}}
            onOpenClaim={() => setTheoryOpen(true)}
          />
        </aside>
        <main className="main">
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
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>
);
