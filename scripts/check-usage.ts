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
import { hasPrice } from '@shared/tokens';
import type { Pricing } from '@shared/types';

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

/* 断言总数兜底：少跑就是静默跳过 */
ok(passed >= 12, '断言总数不少于 12 项', `实际 ${passed}`);

if (failed.length) {
  console.error(`\n✗ 记账规则检查失败 ${failed.length} 项（通过 ${passed} 项）`);
  for (const f of failed) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ 记账规则检查通过 ${passed} 项`);
