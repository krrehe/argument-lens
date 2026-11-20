/**
 * 型式—CQ 对表（C-04 + C-03）的断言。
 *
 * 这一层要防的错有四种，性质不同：
 *
 *   1. 表错位。十九型的编号、名称、最低集、来源层级任意一处与 C-04 对不上，
 *      读者按编号去复核就会翻到另一型——比没有编号更糟。
 *   2. 登记簿说谎。库内某型映射到表内某型，却把「库内没问的那一问」写成已覆盖，
 *      读者就再也看不到那个缺口；反过来，把已覆盖写成缺，会冤枉模型。
 *   3. 本地越权。产品定位是「判断由模型写出，本地只核结构与越界」，
 *      所以这一层只许核「登记了没有」，不许判「这一问答得对不对」。
 *   4. 三种缺席混成一句。本库没有／报告未登记／不适用，该由不同的人补，
 *      合成一句「没答完」就把库的边界算到模型头上。
 *
 * 文案好不好不在这里管；这里管的是「编号对不对、覆盖是不是真的、本地有没有越权」。
 * 反证另做（scripts/.out/prove-scheme-cq.mjs）：改源码或改表，逐组看红。
 *
 * 跑法：npm run check:scheme-cq
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CheckAnswer, CheckItem, Diagnosis } from '@shared/types';
import {
  ANSWER_LABEL,
  LIB_SCHEME_MAP,
  SCHEME_CQ_BOUNDARY,
  SCHEME_CQ_ISOLATION,
  SCHEME_CQ_TABLE,
  SOURCE_LABEL,
  auditSchemeCq,
  cqLine,
  tableRow,
} from '@shared/scheme-cq';
import { auditGrade } from '@shared/grading';
import { SCHEMES } from '../src/main/kb/schemes';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}
const src = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf-8');

/* ─────────── 一 · 十九型表 ─────────── */

ok(SCHEME_CQ_TABLE.length === 19, '表里正好十九型，不多不少', String(SCHEME_CQ_TABLE.length));
ok(
  SCHEME_CQ_TABLE.map((r) => r.no).join(',') === Array.from({ length: 19 }, (_, i) => i + 1).join(','),
  '编号是 1–19 且按序排列（表外不许临场造第 20 型）',
  SCHEME_CQ_TABLE.map((r) => r.no).join(','),
);
ok(new Set(SCHEME_CQ_TABLE.map((r) => r.name)).size === 19, '十九个型式名互不重复');

const EXPECT_NAME: Record<number, string> = {
  1: '例证',
  2: '类比',
  3: '滑坡',
  4: '后果论证',
  5: '专家意见',
  6: '人身攻击',
  7: '无知论证',
  8: '因果',
  9: '征兆',
  10: '实践推理',
  11: '溯因',
  12: '归类',
  13: '价值判断',
  14: '规则适用',
  15: '归谬',
  16: '合成／分割',
  17: '统计',
  18: '两难',
  19: '空转论据／失信原则',
};
for (const r of SCHEME_CQ_TABLE) {
  ok(r.name === EXPECT_NAME[r.no], `第 ${r.no} 型的名字与 C-04 表一致`, r.name);
}

/* 来源层级：1–18 已核准确，第 19 型是本流程自定，不许混。 */
for (const r of SCHEME_CQ_TABLE) {
  const want = r.no === 19 ? 'local' : 'verified';
  ok(r.source === want, `第 ${r.no} 型的来源层级标对`, `${r.source}／应为 ${want}`);
}
ok(SCHEME_CQ_TABLE.filter((r) => r.source === 'local').length === 1, '自定项只有一个（第 19 型）');
ok(/空转论据/.test(SCHEME_CQ_TABLE[18]?.name ?? ''), '第 19 型是空转论据／失信原则，不是别的自定项');
ok(
  (SCHEME_CQ_TABLE[18]?.cqs ?? []).some((c) => /同时支持正反/.test(c.ask)),
  '第 19 型的 CQ 写的是双向支持测试，不是「这个论据没用」',
);

/* 每行都要有要点、示例、最低集。 */
for (const r of SCHEME_CQ_TABLE) {
  ok(r.point.trim().length >= 8, `第 ${r.no} 型有判定要点（不是空话）`, r.point);
  ok(r.example.trim().length >= 10, `第 ${r.no} 型有微型构造示例`, r.example);
  ok(r.cqs.length >= 1, `第 ${r.no} 型的最低集不是空的`);
  ok(
    r.cqs.map((c) => c.no).join(',') === Array.from({ length: r.cqs.length }, (_, i) => i + 1).join(','),
    `第 ${r.no} 型的 CQ 编号从 1 连续`,
    r.cqs.map((c) => c.no).join(','),
  );
}

/* 示例只能用甲／乙／某公司／某市；出现真实主体会被当案例引用。 */
const REAL_NAMES = ['北京', '上海', '广州', '深圳', '中国', '美国', '日本', '欧盟', '联合国', '清华', '北大', '教育部', '国务院'];
for (const r of SCHEME_CQ_TABLE) {
  ok(/甲|乙|某公司|某市/.test(r.example), `第 ${r.no} 型的示例用的是构造主体（甲／乙／某公司／某市）`, r.example);
  ok(!REAL_NAMES.some((n) => r.example.includes(n)), `第 ${r.no} 型的示例没有真实机构名`, r.example);
}

/* 关键 CQ：C-03 只明文点了三处，不许自行加标。 */
const keys = SCHEME_CQ_TABLE.flatMap((r) => r.cqs.filter((c) => c.key).map((c) => `${r.no}.${c.no}`));
ok(keys.join(',') === '3.3,5.1,17.3', '关键 CQ 只有 C-03 明文那三处（滑坡阻断、专家领域、统计方向）', keys.join(','));

/* 表内不许出现「第 20 型」这种临场造项。 */
ok(!/第\s*20\s*型/.test(JSON.stringify(SCHEME_CQ_TABLE)), '表里没有「第 20 型」');
ok(tableRow(20) === null && tableRow(null) === null, '取表外的编号返回 null，不抛错也不兜一个近似的型');

/* ─────────── 二 · 库内型式 → 表内哪一型 ─────────── */

const libIds = SCHEMES.map((s) => s.id).sort();
const mapIds = Object.keys(LIB_SCHEME_MAP).sort();
ok(libIds.join(',') === mapIds.join(','), '库里每个型式都在登记簿里，且登记簿没有多余项', `${libIds.length}／${mapIds.length}`);

const unmappedTypes: number[] = [];
for (const r of SCHEME_CQ_TABLE) {
  const hits = Object.values(LIB_SCHEME_MAP).filter((m) => m.no === r.no).length;
  if (hits === 0) unmappedTypes.push(r.no);
}
/* 库只覆盖到第 12 型；13–19 型在库里没有对应型式。这是当前事实，不是错——
 * 但它必须被写出来，否则读者会以为「表里有的问，库里都有」。 */
ok(unmappedTypes.join(',') === '13,14,15,16,17,18,19', '表内第 13–19 型在库里没有对应型式（这个缺口要明说）', unmappedTypes.join(','));

for (const [id, m] of Object.entries(LIB_SCHEME_MAP)) {
  const def = SCHEMES.find((s) => s.id === id);
  ok(!!def, `登记簿里的 ${id} 在库里有定义`);
  if (!def) continue;

  ok(m.why.trim().length >= 12, `${id} 写了映射依据或表外理由`, m.why);

  if (m.no === null) {
    ok(Object.keys(m.covers).length === 0, `${id} 判了表外，就不再套最低集`);
    continue;
  }

  const row = tableRow(m.no);
  ok(!!row, `${id} 指向的表内第 ${m.no} 型存在`);
  if (!row) continue;

  const wantKeys = row.cqs.map((c) => String(c.no)).join(',');
  const gotKeys = Object.keys(m.covers).sort((a, b) => Number(a) - Number(b)).join(',');
  ok(gotKeys === wantKeys, `${id} 的表内每一问都写了覆盖情况`, `${gotKeys}／应为 ${wantKeys}`);

  const claimed = new Set<string>();
  for (const [no, cover] of Object.entries(m.covers)) {
    ok(cover.note.trim().length >= 12, `${id} 第 ${no} 问写了「库内问的是什么」`, cover.note);
    if (cover.cq === null) continue;
    ok(
      def.criticalQuestions.some((q) => q.id === cover.cq),
      `${id} 第 ${no} 问指向的 ${cover.cq} 在该型式的 CQ 里`,
    );
    ok(!claimed.has(cover.cq), `${id} 的 ${cover.cq} 没有被两条表内问题重复认领`, cover.cq);
    claimed.add(cover.cq);
  }
}

/* 真数据上最要紧的一格：相关—因果少了「机制」。 */
const corr = LIB_SCHEME_MAP['correlation-causation'];
ok(corr?.no === 8, '相关—因果映射到第 8 型因果');
ok(corr?.covers['4']?.cq === null, '相关—因果的四条库内 CQ 里，没有一条承接「机制」——登记为库内缺口');
ok(/机制/.test(corr?.covers['4']?.note ?? ''), '那一格的说明点名了缺的是「机制」');

/* ─────────── 三 · 报告侧核对 ─────────── */

function checkItem(id: string, answer: CheckAnswer): CheckItem {
  return {
    id,
    system: 'walton-cq',
    label: id,
    question: '',
    meta: false,
    answer,
    basis: '',
    guards: '',
    landsOn: null,
  } as CheckItem;
}

function fake(opts: {
  theory?: Diagnosis['theory'];
  kind?: 'walton' | 'pragma';
  schemeId?: string;
  answers?: CheckAnswer[];
  grade?: string | null;
}): Diagnosis {
  const answers = opts.answers ?? ['passed', 'passed', 'unanswered'];
  return {
    version: 2,
    id: 'x',
    parentId: null,
    mode: 'diagnose',
    theory: opts.theory ?? 'walton',
    createdAt: 0,
    passage: 'p',
    context: {},
    scope: { applicable: true, reason: '', outOfScopeAt: null, partialNote: null },
    conclusion: { id: 'C' },
    premises: [{ id: 'P1' }, { id: 'P2' }],
    intermediate: [],
    checks: answers.map((a, i) => checkItem(`CQ${i + 1}`, a)),
    lens:
      (opts.kind ?? 'walton') === 'walton'
        ? {
            kind: 'walton',
            family: 'causal',
            familyBasis: '',
            schemeId: opts.schemeId ?? 'correlation-causation',
            schemeName: '相关—因果',
            skeleton: '',
            alternativeFamily: null,
            alternativeNote: '',
          }
        : { kind: 'pragma', aimedAtResolution: true, aimedBasis: '', stageBasis: '', blockedBy: 'unclear' },
    verdict: {
      level: 'weakened',
      grade: opts.grade
        ? { level: opts.grade, clause: '4.4', at: ['CQ2'], evidence: 'x', fix: 'x', downgrade: 'x', d5: null }
        : null,
      scale: '',
      scaleValue: '',
      statement: '',
      qualification: '',
      whatIsRefuted: 'argument-only',
    },
  } as unknown as Diagnosis;
}

const a1 = auditSchemeCq(fake({}))!;
ok(a1 !== null, 'walton 透镜能算出对表');
ok(a1.row?.no === 8, '相关—因果认出第 8 型');
ok(a1.counts.min === 4, '第 8 型最低集四问', String(a1.counts.min));
ok(a1.counts.registered === 3, '报告登记了三问', String(a1.counts.registered));
ok(a1.counts.libraryGap === 1, '库内缺一问（机制）', String(a1.counts.libraryGap));
ok(a1.counts.unlisted === 0, '库内有的三问，报告都登了');
ok(a1.counts.unanswered === 1, '未答单独计数，不混进「过」');
ok(a1.rows.length === 4, '第 8 型对出四行（表里少一行，这里就该红）', String(a1.rows.length));
ok(a1.rows[3]?.gap === 'library-gap', '第四问（机制）标的是「本库没有」，不是「报告没答」');
ok(/最低集 4 问/.test(cqLine(a1)) && /本库没有 1/.test(cqLine(a1)), '一句话账说清了最低集与库内缺口', cqLine(a1));

const a2 = auditSchemeCq(fake({ schemeId: 'example-to-generalization', answers: ['passed', 'passed'] }))!;
ok(a2.row?.no === 1, '从例子到概括认出第 1 型');
ok(a2.counts.registered === 1, '只登了 CQ1/CQ2，其中只有 CQ2 对上「典型性」');
ok(a2.counts.unlisted === 1, 'CQ3（反例）库里有、报告没登——记「报告未登记」', String(a2.counts.unlisted));
ok(a2.extra.length === 1 && a2.extra[0]?.id === 'CQ1', 'CQ1（例子属实）不在最低集上，记表外追加', a2.extra.map((c) => c.id).join(','));
ok(a2.counts.passed === 1, '读数只数最低集里的那几问，不把表外追加算进「过」', String(a2.counts.passed));
ok(
  a1.counts.registered + a1.counts.libraryGap + a1.counts.unlisted === a1.counts.min,
  '登记＋库缺＋报告缺＝最低集（三个数必须能对上，否则读者会以为漏了一行）',
  `${a1.counts.registered}+${a1.counts.libraryGap}+${a1.counts.unlisted}／${a1.counts.min}`,
);
ok(
  a1.counts.passed + a1.counts.violated + a1.counts.unanswered + a1.counts.na === a1.counts.registered,
  '过＋不过＋未答＋不适用＝已登记数（读数不许多出来）',
  `${a1.counts.passed}+${a1.counts.violated}+${a1.counts.unanswered}+${a1.counts.na}／${a1.counts.registered}`,
);

const a3 = auditSchemeCq(fake({ schemeId: 'sunk-cost' }))!;
ok(a3.row === null && a3.rows.length === 0, '表外型式不套最低集');
ok(/谬误名/.test(a3.why ?? ''), '表外理由写清为什么不在表内');
ok(/不套最低集/.test(cqLine(a3)) || a3.why !== null, '表外也有话说，不返回空');

const a4 = auditSchemeCq(fake({ schemeId: 'none' }))!;
ok(/未识别/.test(a4.why ?? ''), '未识别型式说「未识别」，不说「无需过 CQ」');

const a5 = auditSchemeCq(fake({ kind: 'pragma' }));
ok(a5 === null, '非 walton 透镜不套型式 CQ（返回 null，整块不出现）');

/* 三种缺口必须分开：库缺、报告缺、不适用。 */
const a6 = auditSchemeCq(fake({ schemeId: 'correlation-causation', answers: ['passed', 'not-applicable', 'violated'] }))!;
ok(a6.counts.na === 1, '不适用单独计数');
ok(a6.counts.registered === 3, '不适用也算「登记了」，不进未登记');
ok(a6.counts.libraryGap === 1, '不适用不改变库内缺口');

/* ─────────── 四 · 与 C-03 的档位衔接 ─────────── */

const d1unans = fake({ grade: 'D1', answers: ['passed', 'unanswered', 'passed'] });
ok(
  auditGrade(d1unans).some((g) => g.kind === 'shallow-grade-with-unanswered'),
  'D1 却有未答项：C-03「未答不算过」，记录自相矛盾',
);
const d1na = fake({ grade: 'D1', answers: ['passed', 'not-applicable', 'passed'] });
ok(
  !auditGrade(d1na).some((g) => g.kind === 'shallow-grade-with-unanswered'),
  '不适用不计入分母，D1 不受影响',
);
const d2unans = fake({ grade: 'D2', answers: ['passed', 'unanswered', 'passed'] });
ok(
  !auditGrade(d2unans).some((g) => g.kind === 'shallow-grade-with-unanswered'),
  'D2 允许未答（C-03 4.7：仅一般未过或未答 → 支持力下降），不误报',
);

/* ─────────── 五 · 接线 ─────────── */

const diag = src('src/renderer/src/components/Diagnosis.tsx');
ok(/import \{ SchemeCqCard \} from '\.\/SchemeCqCard';/.test(diag), '报告页引入了对表卡');
const atChecks = diag.indexOf('<CheckTable checks={d.checks} sel={sel} />');
const atCard = diag.indexOf('<SchemeCqCard d={d} />');
const atTopics = diag.indexOf('id="sec-topics"');
ok(atChecks >= 0 && atCard > atChecks, '对表卡挂在检查表之后');
ok(atCard < atTopics, '对表卡在检查表这一块里，不拖到后面');

const card = src('src/renderer/src/components/SchemeCqCard.tsx');
ok(/auditSchemeCq\(d\)/.test(card), '卡片用共享核对，不自己写一套');
ok(/data-scheme-cq/.test(card) && /data-scq-row=/.test(card), '卡片带 data 探针，端到端能逐行核');
ok(/data-scq-libgap=/.test(card) && /data-scq-unlisted=/.test(card), '卡片把两种缺口分开挂出来');
ok((card.match(/\{SCHEME_CQ_BOUNDARY\}/g) ?? []).length === 2, '卡片两处分支都印边界句（表内一处、表外一处）');
ok(/SCHEME_CQ_ISOLATION/.test(card), '卡片写明不改档位、不补答');
ok(!/answer\s*===\s*'passed'/.test(card), '卡片不按读数自己算「过没过」（本地不越权）');
ok(!/answer\s*===\s*'violated'/.test(card), '卡片不按读数自己算缺陷');
ok(/SOURCE_LABEL\[row\.source\]/.test(card), '第 19 型的自定来源在界面上看得见');

const css = src('src/renderer/src/styles.css');
ok((css.match(/^\.scq \{/gm) ?? []).length === 1, '.scq 只定义一次（重名会让两条规则同时生效）');
ok(/\.scq-miss \{/.test(css) && /\.scq-lib/.test(css), '缺口与命中各有自己的样式');
ok(/\.scq-table/.test(css) && /\.scq-notes/.test(css), '表格与缺口说明都有样式');

/* ─────────── 六 · 文案里的名词唯一 ─────────── */

ok(SOURCE_LABEL.verified === '已核准确' && SOURCE_LABEL.local === '本流程自定', '来源层级的中文名与 C-04 标注一致');
ok(ANSWER_LABEL.unanswered === '未答' && ANSWER_LABEL['not-applicable'] === '不适用', '三态的中文名与 C-03 一致');
ok(/未答不算过/.test(src('src/shared/grading.ts')), '判档那边也写着「未答不算过」的依据');

/* ─────────── 收口 ─────────── */

if (failed.length) {
  console.error(`✗ 型式—CQ 检查：${failed.length} 条不通过（共 ${passed + failed.length} 条）`);
  for (const f of failed) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`✓ 型式—CQ 检查：${passed} 条全部通过`);
