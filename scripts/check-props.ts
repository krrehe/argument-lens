/**
 * 命题账：每条主张该由什么来定。
 *
 * 这一关守的不是「多了一栏」，是四种会让这一栏变成装饰的坏法：
 *
 *   1. 归类只看标签不看用词（或反过来）——「应当废除」被归进「事实·可裁」，
 *      读者就会拿证据去否一个本来不该由证据来定的命题，而这正是这一栏存在的理由；
 *   2. 短词先匹配——「不合理」被读成「合理」，「不得不」被读成「不得」，
 *      归类的方向整个反过来；
 *   3. 只给一个标签，不给依据与改归条件——那和直接下结论没有区别，
 *      而且没法被反驳（反驳不了的东西不该出现在这份报告里）；
 *   4. 顺手长出一把新尺子——一个「重要度」、一个「可信度」，把性质差别做成分数。
 *
 * 防恒真：样本里**故意**放「不得不」「不合理」这类会被读错的说法，
 * 也**故意**让一条命题同时是规范命题与框架命题——去掉长词优先或去掉优先级，
 * 对应断言立刻红。
 *
 * 跑法：npm run check:props
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Claim, ConfidenceLevel, Diagnosis, EpistemicTag } from '@shared/types';
import { DECID_GIST, DECID_LABEL, DECID_ORDER, propositionsOf } from '@shared/propositions';
import { MOCK, MOCK_PTA } from '../src/renderer/src/mock-data';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}
const src = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');

/* ─────────── 一 · 样本 ─────────── */

function cl(
  id: string,
  text: string,
  o: {
    tag?: EpistemicTag;
    conf?: ConfidenceLevel;
    implicit?: boolean;
    burden?: Claim['burden'];
    role?: Claim['role'];
  } = {}
): Claim {
  return {
    id,
    role: o.role ?? 'premise',
    text,
    supports: ['C'],
    quote: null,
    span: null,
    implicit: o.implicit ?? false,
    implicitBasis: o.implicit ? '若不假定 X，则从这条推不出 C' : null,
    burden: o.burden ?? 'proponent',
    acceptability: {
      status: 'questionable',
      reason: '测试样本',
      forAudience: '测试受众',
      tag: o.tag ?? 'known',
      confidence: o.conf ?? 'medium',
    },
  };
}

/**
 * 用假报告做底，只换命题——其余字段（透镜、检查项）不影响这一栏。
 *
 * `conclusion` 不传就沿用样张那句。这句本身是有价值判断的（「是错误决定」），
 * 所以验「纯事实路由」时必须换掉它，否则断言会因为样张而红——那是样本的毛病，
 * 不是代码的毛病，而一个会被样本绊倒的断言，最后会被人改松。
 */
function withClaims(premises: Claim[], conclusion?: Claim): Diagnosis {
  const d = JSON.parse(JSON.stringify(MOCK)) as Diagnosis;
  d.premises = premises;
  d.intermediate = [];
  if (conclusion) d.conclusion = conclusion as Diagnosis['conclusion'];
  return d;
}

const only = (c: Claim) => propositionsOf(withClaims([c])).rows.find((r) => r.id === c.id)!;

/* ─────────── 二 · 真实样本：一处一条，账要对得上 ─────────── */

const real = propositionsOf(MOCK);
ok(real.total === 1 + (MOCK.premises?.length ?? 0) + (MOCK.intermediate?.length ?? 0), '每条命题都在账上', String(real.total));
ok(new Set(real.rows.map((r) => r.id)).size === real.total, '一条只记一次（同 id 不重复上账）');
ok(
  DECID_ORDER.reduce((n, k) => n + real.counts[k], 0) === real.total,
  '三栏计数加起来等于总数',
  JSON.stringify(real.counts)
);
ok(real.rows.every((r) => r.basis.length > 10), '每一行都写了「凭什么这么归」');
ok(real.rows.every((r) => r.reclassifyIf.length > 10), '每一行都写了「什么条件下改归」');
ok(real.rows.every((r) => !/可能有误差|仅供参考/.test(r.reclassifyIf)), '改归条件不是「可能有误差」那种套话');
ok(real.rows[0]?.id === 'C', '结论排在最前（读者最先要问的是「这个结论能不能被裁」）');
ok(/共 \d+ 条/.test(real.line), '总述带着条数', real.line);

/* 组内保持报告顺序：不因为归类而把 P1..P3 打乱 */
const three = propositionsOf(withClaims([cl('P1', '甲'), cl('P2', '乙'), cl('P3', '丙')]));
ok(
  three.rows.filter((r) => r.role === 'premise').map((r) => r.id).join(',') === 'P1,P2,P3',
  '组内顺序与报告一致（不按标签重排）'
);

/* 同一 id 出现两次（模型重复输出前提）只记一次 */
const dup = propositionsOf(withClaims([cl('P1', '甲'), cl('P1', '甲再写一遍')]));
ok(dup.rows.filter((r) => r.id === 'P1').length === 1, '同一 id 出现两次只上一次账');
ok(dup.total === 2, '重复的那条没有把总数抬高', String(dup.total));

/* ─────────── 三 · 规范命题：靠用词认，且长词优先 ─────────── */

const norm = (t: string) => only(cl('P9', t));
ok(norm('该制度应当废除').decidability === 'norm-undecidable', '「应当废除」归「不由论证裁定」');
ok(/按用词「应当」/.test(norm('该制度应当废除').basis), '依据里点出命中的那个词');
ok(norm('这种限制不合理').basis.includes('「不合理」'), '长词优先：「不合理」没有被读成「合理」', norm('这种限制不合理').basis);
ok(norm('这种限制不合理').decidability === 'norm-undecidable', '「不合理」归「不由论证裁定」');
ok(norm('我不得不承认这个说法有问题').decidability !== 'norm-undecidable', '「不得不」不是规范词（说的是被迫）');
ok(norm('他不由得停下了').decidability !== 'norm-undecidable', '「不由得」不是规范词');
ok(/按用词|依据等级/.test(norm('取消早读之后一本率下降了六个百分点').basis), '事实命题不写「按用词」');
ok(norm('取消早读之后一本率下降了六个百分点').decidability !== 'norm-undecidable', '没有规范词的事实命题不被归进规范');

/* 规范与框架同时成立：归规范，但另一层不许丢 */
const both = only(cl('P8', '按这套理论，应当先补出隐含前提', { tag: 'framework' }));
ok(both.decidability === 'norm-undecidable', '规范优先于「框架内」（拿去用证据判，是错得更彻底的一种）');
ok(/体系里成立/.test(both.basis), '被让位的那一层写进依据，不静默丢掉');

/* 不含「应当」的价值结论也要能认出来：单字太脏（「错误率」），按词组认 */
const evals = only(cl('C', '取消早读是错误决定'));
ok(evals.decidability === 'norm-undecidable', '「错误决定」这类评价性说法按词组认出来', evals.basis);
ok(only(cl('P5', '这次统计的错误率是 3%')).decidability !== 'norm-undecidable', '「错误率」是统计口径，不按价值判断处理');
ok(
  propositionsOf(MOCK).rows.find((r) => r.id === 'C')!.decidability === 'norm-undecidable',
  '真实样张的结论（「取消早读是错误决定」）落在「不由论证裁定」'
);

/* 透镜已经落盘的判断也要用上：实践论证透镜把结论判成价值命题时，不必再靠用词猜 */
const ptaRows = propositionsOf(MOCK_PTA);
const ptaC = ptaRows.rows.find((r) => r.role === 'conclusion')!;
ok(ptaC.decidability === 'norm-undecidable', '透镜把结论判为价值命题时，归「不由论证裁定」', ptaC.basis);
ok(/本次透镜/.test(ptaC.basis), '依据里说明「这是本次透镜的判断」，不冒充普遍结论');

/* ─────────── 四 · 事实层：可裁 / 证据不足 / 体系内 ─────────── */

ok(only(cl('P7', '甲', { tag: 'known', conf: 'high' })).decidability === 'fact-decidable', '有据且置信高 → 可裁');
ok(only(cl('P7', '甲', { tag: 'computed' })).decidability === 'fact-decidable', '算出来的 → 可裁（重算即可）');
ok(only(cl('P7', '甲', { tag: 'guess' })).decidability === 'fact-undecidable', '猜测 → 事实·不可裁');
ok(
  only(cl('P7', '甲', { tag: 'known', conf: 'undetermined' })).decidability === 'fact-undecidable',
  '置信未定 → 事实·不可裁（哪怕标签写的是有据）'
);
/* 框架不是第四栏：A-03 与 D-02 都只给三栏，多一栏两册就对不上号。
   折的是位置，不是那层意思——依据里必须写清缺的是什么。 */
const fw = only(cl('P7', '甲', { tag: 'framework' }));
ok(fw.decidability === 'fact-undecidable', '框架标签 → 事实·不可裁（不是第四栏）');
ok(/桥接前提/.test(fw.basis), '框架命题的依据写「缺的是桥接前提」，不是「缺数据」', fw.basis);
ok(!/证据$/.test(fw.basis), '没有把「只在体系里成立」说成「缺证据」', fw.basis);
ok(/体系里成立/.test(fw.basis), '体系内那层意思没被折掉');

/* 举证责任没分配，是缺陷本身，要写出来 */
const unassigned = only(cl('P6', '罪犯子女更易实施贪渎', { conf: 'undetermined', burden: 'unclear' }));
ok(/先定该谁举证/.test(unassigned.reclassifyIf), '举证责任没分配时，改归条件先说「先定该谁举证」');
ok(/未分配/.test(unassigned.burdenWho), '举证一栏直说没分配，不写成「双方」');

/* 隐含前提要标出来——原文没有这句话，读者最容易当成原文 */
const impl = only(cl('A1', '公职与私职在法律地位上同质', { implicit: true }));
ok(/补出来的前提/.test(impl.basis), '补出来的前提在依据里明写，不混成原文');

/* ─────────── 五 · 只读：不许动报告 ─────────── */

const before = JSON.stringify(MOCK);
propositionsOf(MOCK);
ok(JSON.stringify(MOCK) === before, '算这一栏不修改报告（一个字段都不许动）');

/* ─────────── 六 · 没有长出新尺子 ─────────── */

const mod = src('src/shared/propositions.ts');
ok(!/\b(score|rating|weight|rank)\b/i.test(mod.replace(/\/\*[\s\S]*?\*\//g, '')), '这一栏没有分数、权重、排序字段');
ok(
  !/verdict|acceptability\s*=\s*|\.status\s*=/.test(mod.replace(/\/\*[\s\S]*?\*\//g, '')),
  '这一栏不改判读与可接受性（只读已落盘字段）'
);
ok(DECID_ORDER.length === 3, '三栏，不多不少', String(DECID_ORDER.length));
ok(new Set(DECID_ORDER).size === 3, '三栏互不重复');
ok(DECID_ORDER.every((k) => !!DECID_LABEL[k] && DECID_LABEL[k].length >= 4), '每类都有中文名');
ok(DECID_ORDER.every((k) => DECID_GIST[k].length > 20), '每类都说清「什么在挡着」，不是一个标签了事');

/* ─────────── 六之二 · A3 路由（这一段该用哪套标准量） ─────────── */

const C_FACT = () => cl('C', '取消早读导致一本率下降', { role: 'conclusion' });
ok(
  propositionsOf(withClaims([cl('P1', '甲'), cl('P2', '乙')], C_FACT())).route === 'fact',
  '全是事实命题 → 纯事实'
);
ok(
  propositionsOf(withClaims([cl('P1', '该制度应当废除')], cl('C', '应当废除该制度', { role: 'conclusion' }))).route === 'norm',
  '全是规范命题 → 纯规范'
);
const mixed = propositionsOf(withClaims([cl('P1', '甲'), cl('P2', '该制度应当废除')], C_FACT()));
ok(mixed.route === 'mixed', '事实与规范混在一段 → 混合（不许整段一把尺子量）');
ok(
  mixed.routeLine.includes(`拆成 ${mixed.counts['fact-decidable'] + mixed.counts['fact-undecidable']} 条按证据判真假`) &&
    mixed.routeLine.includes(`${mixed.counts['norm-undecidable']} 条只判辩护成不成立`),
  '混合路由说清拆成几栏（数字与逐条计数一致）',
  mixed.routeLine
);
ok(/不许互相转账/.test(mixed.routeLine), '混合路由当场说明两套标准不许串账');
ok(
  propositionsOf(withClaims([cl('P1', '该制度应当废除')])).routeLine.includes('不判这条主张本身对不对'),
  '纯规范路由写清「只判辩护、不判命题」'
);
ok(/条件式结论/.test(DECID_GIST['norm-undecidable']), '规范那一组要求给出条件式结论，而不是真假');

/* ─────────── 七 · 界面：真的挂上了，且位置有理由 ─────────── */

const diagTsx = src('src/renderer/src/components/Diagnosis.tsx');
const ledger = src('src/renderer/src/components/PropositionLedger.tsx');
ok(/<PropositionLedger v=\{props\} gaps=\{ledgerGaps\} \/>/.test(diagTsx), '报告主体里真的渲染了命题账（不是只有 import）');
ok(/auditLedger\(d\)/.test(diagTsx), '账的缺口在报告层核一次，组件不自己判');
ok(/props\.total > 0/.test(diagTsx), '没有可归账的命题时整块不出现（不摆空壳）');
ok(
  diagTsx.indexOf('id="sec-props"') > diagTsx.indexOf('id="sec-verdict"') &&
    diagTsx.indexOf('id="sec-props"') < diagTsx.indexOf('id="sec-disputes"'),
  '位置在判读之后、争议之前（结论 → 哪些不能裁 → 哪里有分歧）'
);
ok(/DECID_ORDER\.map/.test(ledger), '组件按固定组顺序渲染，不是手写四块');
ok(/补出的/.test(ledger), '补出来的前提在界面上与原文主张分开标');
ok(/凭什么这么归/.test(ledger) && /什么条件下改归/.test(ledger), '每一行都露出依据与改归条件');
ok(/靠用词认/.test(ledger) && /本地读不出来/.test(ledger), '界面上写明「含蓄的价值判断认不出来」——这一栏不假装全覆盖');
ok(/账上/.test(ledger) && /凭什么这么归/.test(ledger), '账上的状态与本地归的栏并排摆，不合成一句');
ok(/pl-route/.test(ledger) && /data-route/.test(ledger), '路由那一行在界面上真的渲染出来');
ok(/两本账不许互相转账/.test(ledger), 'D2 的双向禁令写在界面上（两个方向都禁，不是只禁一边）');

/* 预览页：这一栏在默认样张里就有，不需要额外开关 */
const mockTsx = src('src/renderer/src/mock.tsx');
ok(/DiagnosisView/.test(mockTsx), '预览页走的是同一个报告组件，所以这一栏在样张里可见');

/* ─────────── 收口 ─────────── */

if (failed.length) {
  for (const f of failed) console.error(`✗ ${f}`);
  console.error(`\n✗ 命题账 ${failed.length} 条没过（共 ${passed + failed.length} 条）`);
  process.exit(1);
}
console.log(
  `✓ 命题账：${passed} 条全部通过｜长词优先、举证未分配要说出来、规范优先于框架但两层都留、只读不改判、没有长出新尺子`
);
