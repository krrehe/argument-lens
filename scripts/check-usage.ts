/**
 * 记账规则断言。
 *
 * 这里只验 `@shared/usage-rules` 里的两条判定——它们原先埋在 `main/usage.ts`，
 * 而那个文件 import electron，跑不起来。于是「本地 Ollama 会不会被当成模拟调用」
 * 「用户填的价会不会被内置价盖掉」这两个问题，一直只能靠人读。
 *
 * 两条都写反过一次，而且写反了都不报错：一条让用量少算，一条让钱算错。
 */
import { KNOWN_PRICES, isMockCall, pickPricing } from '@shared/usage-rules';
import { CSV_HEAD, csvCell, csvRow } from '@shared/usage-csv';
import { hasPrice } from '@shared/tokens';
import type { Pricing, UsageRecord } from '@shared/types';

let passed = 0;
const failed: string[] = [];

function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) {
    passed += 1;
  } else {
    failed.push(detail ? `${label}（${detail}）` : label);
  }
}

const price = (inPerM: number, outPerM: number, currency = '¥'): Pricing => ({ inPerM, outPerM, currency });

/* ── 1. 谁算模拟调用 ── */

ok(isMockCall({ model: 'mock-argument-lens', host: '127.0.0.1:8799' }), '回环地址 + mock 前缀 → 算模拟');
ok(isMockCall({ model: 'mock-big', host: 'localhost:1234' }), 'localhost 也算回环');
ok(isMockCall({ model: 'MOCK-UP', host: '127.0.0.1' }), '前缀大小写不敏感');

/*
 * 这两条是本文件的重点。写反了都不会报错：
 * 前一条写反 = 谁在自己机器上跑 Ollama，用量就整块消失；
 * 后一条写反 = 任何线上服务只要名字里带 mock，账就记不上。
 */
ok(
  !isMockCall({ model: 'llama3.1:8b', host: '127.0.0.1:11434' }),
  '本地 Ollama 不算模拟（它是真模型，只是不花钱）'
);
ok(!isMockCall({ model: 'mock-trial', host: 'api.example.com' }), '线上服务名字带 mock 也不算模拟');
ok(!isMockCall({}), '缺字段不误判');
ok(!isMockCall({ model: 'deepseek-chat', host: 'api.deepseek.com' }), '线上真调用不算模拟');

/* ── 2. 取价顺序 ── */

const mine = price(2, 8);
const theirs = pickPricing(mine, 'deepseek-chat');
ok(theirs.inPerM === 2 && theirs.outPerM === 8, '用户填过价 → 一律用用户的，内置价不许覆盖', JSON.stringify(theirs));
ok(theirs.currency === '¥', '覆盖价时不改币种');

const empty = price(0, 0);
const filled = pickPricing(empty, 'deepseek-chat');
ok(filled.inPerM > 0 && filled.outPerM > 0, '没填过 → 用内置参考价', JSON.stringify(filled));
ok(filled.currency === '¥', '内置价沿用用户的币种，不自作主张');

const unknown = pickPricing(empty, 'some-model-nobody-knows');
ok(unknown.inPerM === 0 && unknown.outPerM === 0, '不在表里的模型 → 仍是 0，宁可不写也不猜');
ok(!hasPrice(unknown), '0 价如实报告「没有价」');

const partial = pickPricing(price(3, 0), 'deepseek-chat');
ok(partial.inPerM === 3, '用户只填了输入价 → 用用户的输入价');
ok(
  partial.outPerM === 0,
  '只填一半时，输出价仍留 0 —— 不拿内置价去补另一半',
  `实得 ${partial.outPerM}`
);

/* ── 3. 内置价本身 ── */

const names = Object.keys(KNOWN_PRICES);
ok(names.length > 0, '内置价表不为空');
let sane = true;
for (const n of names) {
  const p = KNOWN_PRICES[n];
  if (!(p.inPerM > 0 && p.outPerM > 0)) sane = false;
  if (p.outPerM < p.inPerM) sane = false;
}
ok(sane, '每条内置价的正负与量级都正常（输出价不应低于输入价）', names.join(','));

/* ── 4. 导出的表格形状 ── */

/*
 * 这一段守的是一个已经发生过的事实：表头 13 列、数据 14 项，
 * 「按现价回填」那一列掉到表头之外。Excel 打开是一列没有名字的数据，谁也不会报错。
 * 所以这里不比「看起来对不对」，直接比列数和每列的位置。
 */
const sample: UsageRecord = {
  id: 'x',
  at: Date.parse('2026-03-01T10:00:00+08:00'),
  ok: true,
  theory: 'walton',
  model: 'deepseek-chat',
  host: 'api.deepseek.com',
  promptTokens: 8457,
  completionTokens: 2100,
  estimated: false,
  cost: 0.0126,
  priced: true,
  currency: '¥',
  priceIn: 1,
  priceOut: 2,
  ms: 12_000,
  chars: 900,
};

const row = csvRow(sample, 0.0099, true);
ok(row.length === CSV_HEAD.length, 'CSV 行与表头一样长', `行 ${row.length} / 表头 ${CSV_HEAD.length}`);
ok(new Set(CSV_HEAD).size === CSV_HEAD.length, '表头没有重名列');

const col = (name: string) => CSV_HEAD.indexOf(name as (typeof CSV_HEAD)[number]);
ok(col('费用') >= 0 && col('备注') === CSV_HEAD.length - 1, '「备注」固定在最后一列', `位置 ${col('备注')}`);
ok(
  row[col('费用')] === '0.009900',
  '费用列用的是传进来的金额，不是记录里冻结的那一个',
  `实得 ${row[col('费用')]}，记录里是 ${sample.cost}`
);
ok(row[col('备注')] === '按现价回填', '备注列在回填时写明「按现价回填」');
ok(csvRow(sample, 0.0099, false)[col('备注')] === '', '没有回填时备注是空的，不留一句废话');
ok(csvCell('a,b') === '"a,b"', '字段里有逗号就加引号，否则整行错位');
ok(csvCell('he said "hi"') === '"he said ""hi"""', '字段里的引号要成对转义');

/* 断言总数兜底：少跑就是静默跳过 */
ok(passed >= 22, '断言总数不少于 22 项', `实际 ${passed}`);

if (failed.length) {
  console.error(`\n✗ 记账规则检查失败 ${failed.length} 项（通过 ${passed} 项）`);
  for (const f of failed) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ 记账规则检查通过 ${passed} 项`);
