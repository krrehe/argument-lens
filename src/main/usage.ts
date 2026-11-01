import { app, dialog } from 'electron';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  BalanceAnchor,
  Pricing,
  UsageBucket,
  UsageDay,
  UsageRecord,
  UsageSummary,
} from '@shared/types';
import type { TheoryId } from '@shared/theories';
import { costOf, dayKey, hasPrice, monthKey } from '@shared/tokens';
import { KNOWN_PRICES, isMockCall, pickPricing } from '@shared/usage-rules';
import { CSV_HEAD, csvCell, csvRow } from '@shared/usage-csv';

/**
 * 用量账本。
 *
 * 存储形状刻意选得极简：一个月一个 jsonl 文件，一行一条记录，只追加。
 *
 * 为什么不建 SQLite：这份数据的规模是「一年几千行」，查询只有「按天聚合」。
 * 上一个数据库换来的能力用不上，却多一个可能损坏、需要迁移、需要备份的东西。
 *
 * 为什么按月分文件而不是一个大文件：单文件会无限长，每次读全量、每次写要重写。
 * 分月之后，读最近两个月就够算今日/本月/近 14 天，旧月份只在导出时碰。
 *
 * 为什么不存「净额」只存流水：净额一旦写错就无从追溯。流水错了还能一笔笔对。
 */

const DEFAULT_PRICING: Pricing = { inPerM: 0, outPerM: 0, currency: '¥' };

/**
 * 取价。规则本身在 `@shared/usage-rules`，这里只是把「用户配置」填进去。
 *
 * 规则拆出去的原因是它能被断言：`scripts/check-usage.ts` 验的是
 * 「用户填的价不会被内置价盖掉」「本地 Ollama 不会被当成模拟调用」——
 * 这两条都写反过，而且写反了都不报错。
 */
function priceOf(model: string, user: Pricing = getPricing()): Pricing {
  return pickPricing(user, model);
}

interface Meta {
  pricing: Pricing;
  anchor: BalanceAnchor | null;
}

let metaCache: Meta | null = null;

function usageDir(): string {
  const dir = join(app.getPath('userData'), 'usage');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** 账本所在目录。用户有权知道自己的数据存在哪 —— 面板上直接给一个打开按钮。 */
export function usageDirPath(): string {
  return usageDir();
}

function metaPath(): string {
  return join(usageDir(), 'meta.json');
}

function readMeta(): Meta {
  if (metaCache) return metaCache;
  const p = metaPath();
  if (!existsSync(p)) {
    metaCache = { pricing: { ...DEFAULT_PRICING }, anchor: null };
    return metaCache;
  }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as Partial<Meta>;
    const pr = raw.pricing ?? DEFAULT_PRICING;
    metaCache = {
      pricing: {
        inPerM: Number.isFinite(pr.inPerM) ? Number(pr.inPerM) : 0,
        outPerM: Number.isFinite(pr.outPerM) ? Number(pr.outPerM) : 0,
        currency: typeof pr.currency === 'string' && pr.currency.trim() ? pr.currency.trim().slice(0, 3) : '¥',
      },
      anchor:
        raw.anchor && Number.isFinite(raw.anchor.amount)
          ? { at: Number(raw.anchor.at) || Date.now(), amount: Number(raw.anchor.amount), note: String(raw.anchor.note ?? '') }
          : null,
    };
  } catch {
    metaCache = { pricing: { ...DEFAULT_PRICING }, anchor: null };
  }
  return metaCache;
}

function writeMeta(next: Meta): void {
  const p = metaPath();
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8');
  renameSync(tmp, p);
  metaCache = next;
}

export function getPricing(): Pricing {
  return readMeta().pricing;
}

export function setPricing(patch: Partial<Pricing>): Pricing {
  const cur = readMeta();
  const next: Meta = {
    ...cur,
    pricing: {
      inPerM: clampMoney(patch.inPerM ?? cur.pricing.inPerM),
      outPerM: clampMoney(patch.outPerM ?? cur.pricing.outPerM),
      currency: (patch.currency ?? cur.pricing.currency).trim().slice(0, 3) || '¥',
    },
  };
  writeMeta(next);
  return next.pricing;
}

function clampMoney(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 0;
}

/**
 * 记一笔余额。
 *
 * 语义是「此刻账户里还剩 amount」，不是一个增量。
 * 这样用户任何时候只要打开供应商控制台看一眼，填进去就校正了，
 * 不需要先算清之前花了多少——那件事这个应用本来就在替他做。
 */
export function setAnchor(amount: number, note = ''): BalanceAnchor {
  const cur = readMeta();
  const anchor: BalanceAnchor = {
    at: Date.now(),
    amount: Number.isFinite(amount) ? Math.max(0, amount) : 0,
    note: note.trim().slice(0, 60),
  };
  writeMeta({ ...cur, anchor });
  return anchor;
}

export function clearAnchor(): void {
  const cur = readMeta();
  writeMeta({ ...cur, anchor: null });
}

/* ─────────── 流水 ─────────── */

function monthFile(ym: string): string {
  return join(usageDir(), `usage-${ym}.jsonl`);
}

export function recordUsage(
  rec: Omit<UsageRecord, 'id' | 'at'> & { at?: number },
  opts: { persist?: boolean } = {}
): UsageRecord {
  const at = rec.at ?? Date.now();
  const full: UsageRecord = {
    ...rec,
    id: `${at.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    at,
  };
  // persist: false 用于模拟调用——返回值照给（界面要显示这一次的 token），但不落盘。
  if (opts.persist !== false) {
    try {
      appendFileSync(monthFile(monthKey(at)), `${JSON.stringify(full)}\n`, 'utf-8');
    } catch {
      // @allow-silent: 记账失败绝不能影响分析本身（钱已经花了，结果必须照给）。
      // 代价是面板次数偏少——偏少是可解释的方向，偏多才是假账。
    }
  }
  return full;
}

/**
 * 一次模型调用的记账入口。
 *
 * 单价在这里取，是因为「当时的价」要冻结进记录。让调用方自己取价，
 * 早晚会出现两条路径取了两次价、算出来的钱不一样。
 */
export function recordChatUsage(input: {
  ok: boolean;
  theory: TheoryId | null;
  model: string;
  host: string;
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
  ms: number;
  chars: number;
  /** 命中前缀缓存的输入 token 数；供应商不返回就传 undefined */
  cacheHitTokens?: number;
}): UsageRecord {
  const pricing = priceOf(input.model);
  const priced = hasPrice(pricing);
  const cost = input.ok && priced ? costOf(input.promptTokens, input.completionTokens, pricing) : 0;
  return recordUsage(
    {
      ok: input.ok,
      theory: input.theory,
      model: input.model,
      host: input.host,
      promptTokens: Math.round(input.promptTokens),
      completionTokens: Math.round(input.completionTokens),
      estimated: input.estimated,
      cost,
      priced,
      currency: pricing.currency,
      priceIn: pricing.inPerM,
      priceOut: pricing.outPerM,
      ms: Math.round(input.ms),
      chars: input.chars,
      cacheHitTokens:
        typeof input.cacheHitTokens === 'number' && Number.isFinite(input.cacheHitTokens)
          ? Math.round(input.cacheHitTokens)
          : undefined,
    },
    { persist: !isMockCall(input) }
  );
}

function listMonthFiles(): string[] {
  try {
    return readdirSync(usageDir())
      .filter((f) => /^usage-\d{4}-\d{2}\.jsonl$/.test(f))
      .sort();
  } catch {
    return [];
  }
}

function readRecords(): UsageRecord[] {
  const out: UsageRecord[] = [];
  for (const f of listMonthFiles()) {
    let text = '';
    try {
      text = readFileSync(join(usageDir(), f), 'utf-8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try {
        const r = JSON.parse(s) as UsageRecord;
        if (!r || typeof r.at !== 'number') continue;
        out.push({
          ...r,
          promptTokens: Number(r.promptTokens) || 0,
          completionTokens: Number(r.completionTokens) || 0,
          cost: Number(r.cost) || 0,
          priceIn: Number(r.priceIn) || 0,
          priceOut: Number(r.priceOut) || 0,
          ms: Number(r.ms) || 0,
          chars: Number(r.chars) || 0,
        });
      } catch {
        // @allow-silent: 半行（写入时断电）跳过，不让一条坏记录毁掉整月账本。
        // 与异议文件同一条规矩：局部损坏只丢局部。
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * 一条记录实际算多少钱。
 *
 * 取价顺序：记录里冻结的当时单价 → 按**这条记录的模型**取当时该用的价 → 0。
 * 中间那一步不能退化成「全局现价」：换了模型之后回头重算历史，
 * 等于用今天的价改昨天的账。
 */
function effectiveCost(
  r: UsageRecord,
  priceOfModel: (model: string) => Pricing
): { cost: number; backfilled: boolean } {
  if (!r.ok) return { cost: 0, backfilled: false };
  if (r.priced && (r.priceIn > 0 || r.priceOut > 0)) {
    return { cost: costOf(r.promptTokens, r.completionTokens, { inPerM: r.priceIn, outPerM: r.priceOut }), backfilled: false };
  }
  const p = priceOfModel(r.model);
  if (hasPrice(p)) {
    return { cost: costOf(r.promptTokens, r.completionTokens, p), backfilled: true };
  }
  return { cost: 0, backfilled: false };
}

function emptyBucket(): UsageBucket {
  return { count: 0, okCount: 0, tokens: 0, cost: 0 };
}

function addTo(b: UsageBucket, r: UsageRecord, cost: number): void {
  b.count += 1;
  if (r.ok) {
    b.okCount += 1;
    b.tokens += r.promptTokens + r.completionTokens;
    b.cost += cost;
  }
}

/** 近 14 天，从 13 天前到今天，缺的补 0——图上不能有洞 */
function buildDaily(
  records: UsageRecord[],
  priceOfModel: (model: string) => Pricing,
  now: number
): UsageDay[] {
  const map = new Map<string, UsageDay>();
  for (let i = 13; i >= 0; i--) {
    const d = dayKey(now - i * 86_400_000);
    map.set(d, { date: d, count: 0, tokens: 0, cost: 0 });
  }
  for (const r of records) {
    const k = dayKey(r.at);
    const cell = map.get(k);
    if (!cell) continue;
    cell.count += 1;
    if (r.ok) {
      cell.tokens += r.promptTokens + r.completionTokens;
      cell.cost += effectiveCost(r, priceOfModel).cost;
    }
  }
  return Array.from(map.values());
}

const AVG_WINDOW = 10;

/**
 * 这次调用是不是本地假模型的。
 *
 * 规则本身在 `@shared/usage-rules`（那里能被断言）。这里只留一句提醒：
 * 冒烟测试每次返回编好的 3200/1800 token，它们一旦进真账本，
 * 「本月几次」里就会混着根本没发生的调用。判据必须是「回环地址 + mock 前缀」两条同时成立，
 * 只看地址会误伤本地 Ollama，只看名字会误伤真叫 mock 的线上服务。
 */

export function summarizeUsage(): UsageSummary {
  const now = Date.now();
  const pricing = getPricing();
  const meta = readMeta();
  const allRecords = readRecords();
  /*
   * 模拟调用不进统计，但也不从流水里删。
   * 删掉等于篡改历史：那些记录确实写进来过，只是不该算数。
   * 所以是「排除并计数」，面板上明说排除了几条。
   */
  const mockExcluded = allRecords.filter(isMockCall).length;
  const records = allRecords.filter((r) => !isMockCall(r));
  // 每条记录按它自己的模型取价，不用一个全局价去重算历史
  const priceOfModel = (model: string) => priceOf(model, pricing);

  const todayKey = dayKey(now);
  const thisMonth = monthKey(now);

  const today = emptyBucket();
  const month = emptyBucket();
  const all = emptyBucket();
  let backfilled = 0;
  let okTotal = 0;
  let estimatedOk = 0;

  const priced: { r: UsageRecord; cost: number }[] = [];

  for (const r of records) {
    const { cost, backfilled: bf } = effectiveCost(r, priceOfModel);
    if (bf && cost > 0) backfilled += 1;
    addTo(all, r, cost);
    if (monthKey(r.at) === thisMonth) addTo(month, r, cost);
    if (dayKey(r.at) === todayKey) addTo(today, r, cost);
    if (r.ok) {
      okTotal += 1;
      if (r.estimated) estimatedOk += 1;
      if (cost > 0) priced.push({ r, cost });
    }
  }

  /* 均价只用最近若干次成功记录：模型换了、文本长度变了，平均值本来就会漂 */
  const recentPriced = priced.slice(-AVG_WINDOW);
  const avgCostPerRun = recentPriced.length
    ? recentPriced.reduce((s, x) => s + x.cost, 0) / recentPriced.length
    : null;

  /* 锚点之后的支出 */
  const anchor = meta.anchor;
  let spentSince = 0;
  if (anchor) {
    for (const r of records) {
      if (r.at > anchor.at) spentSince += effectiveCost(r, priceOfModel).cost;
    }
  }
  const remaining = anchor ? Math.max(0, anchor.amount - spentSince) : null;
  const runsLeft =
    remaining !== null && avgCostPerRun && avgCostPerRun > 0 ? Math.floor(remaining / avgCostPerRun + 1e-9) : null;

  /*
   * 金额按什么价算的，要说清楚。
   * 只有「用过的每个模型都有内置价」才算 builtin——不然界面会写着
   * 「按内置参考价估算」，而实际上一半记录仍是 0。
   */
  const modelsInUse = new Set(records.map((r) => r.model));
  const everyModelKnown = modelsInUse.size > 0 && [...modelsInUse].every((m) => Boolean(KNOWN_PRICES[m]));
  const pricingSource: 'user' | 'builtin' | 'none' = hasPrice(pricing)
    ? 'user'
    : everyModelKnown
      ? 'builtin'
      : 'none';

  /*
   * 缓存命中率只统计「供应商确实报了命中数」的记录。
   * 把没报的算进分母等于硬说它没命中，那会造出一个假的回归信号。
   */
  const cacheReported = records
    .filter((r) => r.ok && typeof r.cacheHitTokens === 'number' && r.promptTokens > 0)
    .slice(-AVG_WINDOW);
  const cacheHitTotal = cacheReported.reduce((n, r) => n + (r.cacheHitTokens ?? 0), 0);
  const cachePromptTotal = cacheReported.reduce((n, r) => n + r.promptTokens, 0);
  const cacheHitShare = cachePromptTotal > 0 ? cacheHitTotal / cachePromptTotal : null;

  return {
    today,
    month,
    all,
    daily: buildDaily(records, priceOfModel, now),
    /*
     * 明细带上算好的金额。
     *
     * 只给原始记录的话，面板只能显示 `r.cost`——没填单价的那条是 0，
     * 而合计里它是按现价回填过的，于是「明细加起来」和「本月花费」对不上。
     * 一个账本最不能被质疑的就是这个加法。
     */
    recent: records.slice(-30).reverse().map((r) => {
      const e = effectiveCost(r, priceOfModel);
      return { ...r, effCost: e.cost, backfilled: e.backfilled };
    }),
    pricing,
    hasPricing: hasPrice(pricing),
    balance: {
      anchor,
      spentSince,
      remaining,
      runsLeft,
      avgCostPerRun,
      avgBasis: recentPriced.length,
    },
    estimatedShare: okTotal ? estimatedOk / okTotal : 0,
    backfilled,
    mockExcluded,
    pricingSource,
    cacheHitShare,
  };
}

/* ─────────── 导出 ─────────── */

/**
 * 导出 CSV。
 *
 * 表格形状（表头、每一行的排布）在 `@shared/usage-csv`，那里不依赖 electron，
 * 所以 `check:usage` 能直接断言「行和表头一样长」。这里只负责取价和落盘。
 *
 * 带 BOM 是必须的：不带的话 Excel 打开中文列名会是乱码，
 * 而用户拿到一份乱码文件之后就再也不会点第二次了。
 */
export function usageToCsv(): string {
  const pricing = getPricing();
  const priceOfModel = (model: string) => priceOf(model, pricing);
  const lines = [CSV_HEAD.map(csvCell).join(',')];
  for (const r of readRecords()) {
    // 金额与面板同源：都走 effectiveCost，不在这里另算一遍取价顺序
    const { cost, backfilled } = effectiveCost(r, priceOfModel);
    lines.push(csvRow(r, cost, backfilled).map(csvCell).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

/** 弹保存框并写盘。返回是否真的写了。 */
export async function exportUsageCsv(parent: Electron.BrowserWindow | null): Promise<{ ok: boolean; path?: string }> {
  const suggested = `论证镜-用量-${dayKey(Date.now())}.csv`;
  const opts = {
    title: '导出用量明细',
    defaultPath: join(app.getPath('downloads'), suggested),
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  };
  const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || !r.filePath) return { ok: false };
  writeFileSync(r.filePath, usageToCsv(), 'utf-8');
  return { ok: true, path: r.filePath };
}
