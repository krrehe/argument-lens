import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { THEORIES, THEORY_BY_ID } from '@shared/theories';
import { disputesIn } from '@shared/disputes';
import { DiagnosisView } from './components/Diagnosis';
import { HistoryPanel } from './components/History';
import { TheoryBrief } from './components/TheoryBrief';
import { TheoryBaseDialog } from './components/TheoryBase';
import { DisputeDialog } from './components/Disputes';
import { GlossaryDialog, PlainCtx } from './components/Term';
import { MOCK, MOCK_BY_THEORY } from './mock-data';
import { UsagePanel } from './components/Usage';
import type { ObjectionStat, ReportMeta, TheoryId, UsageRecord, UsageSummary } from '@shared/types';
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
  cacheHit: number | undefined
): UsageRecord => ({
  id: `u${i}`,
  at: Date.now() - i * 7 * 60_000,
  ok: true,
  theory,
  model: 'deepseek-chat',
  host: 'api.deepseek.com',
  promptTokens: pt,
  completionTokens: ct,
  estimated: false,
  cost: (pt * 1 + ct * 2) / 1e6,
  priced: true,
  currency: '¥',
  priceIn: 1,
  priceOut: 2,
  ms,
  chars: 428,
  cacheHitTokens: cacheHit,
});

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
    mockRun(1, 'copi', 7_471, 3_133, 16_935, 6_600),
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
  const shown: typeof D = acOn ? { ...D, passage: AC_SAMPLE } : oosOn ? OOS : D;
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
          </div>
          <TheoryBrief
            theory={D.theory}
            onSwitch={() => {}}
            onOpenClaim={() => setTheoryOpen(true)}
          />
        </aside>
        <main className="main">
          <DiagnosisView
            d={shown}
            onOpenClaim={(id) => {
              // 预览里也走真链路：定位到那一条，顺便打开库，截图能核对高亮
              setFocusClaim(id);
              setTheoryOpen(true);
            }}
          />
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
    </div>
    </PlainCtx.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>
);
