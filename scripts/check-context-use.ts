/**
 * 语境依赖的断言。
 *
 * 这一层要防的错不是「代码写错了」，是**说不该说的话**：
 *
 *   1. 结果页原来写着「后面所有判断都锚在这上面」。六副透镜里有三副
 *      （图尔明、PTA、名录对照）的判定一步都不读语境——这句话对它们不成立。
 *   2. 就算读，读的也不是同一格：walton 读对话类型与阶段，pragma 再读对方立场，
 *      ars 读受众与受众类型。一张「大致都读」的表等于没表。
 *   3. 每一条依赖都得指得出出处。指不出，这张表就是「我觉得它读了」——
 *      而那种表比没有更糟：它让人以为依赖关系已经被核过。
 *
 * 所以这里的断言分四段：依赖表本身、载荷计算、提示词、界面接线。
 * 文案（措辞好不好）不在这里管；这里管的是「说的话有没有落点」。
 *
 * 反证另做（scripts/.out/prove-context-use.mjs）：改源码逐组看红，
 * 因为这里改不了自己脚下踩的文件。
 *
 * 跑法：npm run check:context-use
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CLAIM_BY_ID } from '@shared/theory-base';
import { THEORIES, THEORY_BY_ID, type TheoryId } from '@shared/theories';
import { ANALYSIS_MODES, CONTEXT_FIELDS, MODE_META, type AnalysisMode, type ContextField, type Diagnosis } from '@shared/types';
import {
  AUDIENCE_KIND_LABEL,
  CONTEXT_FIELD_LABEL,
  CONTEXT_UNUSED_WHY,
  CONTEXT_USE,
  SOURCE_LABEL,
  STAGE_LABEL,
  contextLoadOf,
} from '@shared/context-use';
import { normalizeGrounding } from '@shared/context-grounding';
import { buildPrompt, SHARED_SCHEMA } from '../src/main/prompt';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}
const src = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf-8');

/** 字段关键词。条款正文里谈到这一格，至少得命中一个词。 */
const FIELD_HINT: Record<ContextField, RegExp> = {
  issue: /争|议题|issue/i,
  speakerPosition: /立场|说话/,
  opposingPosition: /对方|对手|opposing/i,
  dialogueType: /dialogueType|对话类型/,
  stage: /阶段|stage/i,
  audience: /受众|听众|audience|forAudience/i,
  audienceKind: /audienceKind|受众类型/,
};

/* ─────────── 一 · 依赖表本身 ─────────── */

const ids = THEORIES.map((t) => t.id);
ok(ids.length === 6, '六副透镜', `实际 ${ids.length}`);
ok(
  ids.every((id) => Array.isArray(CONTEXT_USE[id as TheoryId])),
  '六副透镜都有依赖条目（空数组也是条目，表示「一格都不读」）',
);

/* 空表是有结论的，不是漏填：这三种透镜必须各有一句「为什么不读」。 */
const EMPTY: TheoryId[] = ['pta', 'toulmin', 'copi'];
for (const id of EMPTY) {
  ok(CONTEXT_USE[id].length === 0, `${id} 的依赖表是空的（判定不读语境）`);
  ok(!!CONTEXT_UNUSED_WHY[id]?.trim(), `${id} 写了「为什么不读」，不是留白`);
  ok(contextLoadOf(fake({ theory: id })).unusedWhy === CONTEXT_UNUSED_WHY[id], `${id} 的载荷把这句话原样带出来`);
  ok(
    contextLoadOf(fake({ theory: id })).summary.includes(CONTEXT_UNUSED_WHY[id] as string),
    `${id} 的口径句里写着为什么不读，不是只写「不读」`,
  );
  ok(contextLoadOf(fake({ theory: id })).caveat === null, `${id} 不读语境，所以判定区不补语境那句`);
}
ok(
  THEORIES.filter((t) => CONTEXT_USE[t.id].length > 0)
    .map((t) => t.id)
    .sort()
    .join(',') === 'ars,pragma,walton',
  '读语境的只有三副：walton／pragma／ars',
);

for (const t of THEORIES) {
  const seen = new Set<string>();
  for (const u of CONTEXT_USE[t.id]) {
    ok((CONTEXT_FIELDS as readonly string[]).includes(u.field), `${t.id} 依赖的「${u.field}」是七格之一`);
    ok(!seen.has(u.field), `${t.id} 没有重复列同一格（${u.field}）`);
    seen.add(u.field);
    ok(u.why.trim().length >= 8, `${t.id}.${u.field} 写清了这一格进哪一步判断`, u.why);
    ok(!/[、，。！？；]$/.test(u.why), `${t.id}.${u.field} 的说明不以标点收尾（拼接时不出现双标点）`);
  }
}

/* 每一条依赖都要有可核的出处 */
for (const t of THEORIES) {
  for (const u of CONTEXT_USE[t.id]) {
    const e = u.evidence;
    if (e.kind === 'claim') {
      const c = CLAIM_BY_ID[e.id];
      ok(!!c, `${t.id}.${u.field} 引的条目 ${e.id} 真的存在`);
      if (!c) continue;
      ok(
        !c.lens || c.lens.includes(t.id),
        `${t.id}.${u.field} 引的 ${e.id} 真的管这副透镜`,
        c.lens ? `该条目只属于 ${c.lens.join('、')}` : '',
      );
      const body = `${c.claim}${c.decides}`;
      if (e.quote) {
        ok(body.includes(e.quote), `${t.id}.${u.field} 引的「${e.quote}」逐字出现在 ${e.id} 里`);
      } else {
        ok(
          FIELD_HINT[u.field].test(body),
          `${t.id}.${u.field} 引的 ${e.id} 正文确实谈到这一格`,
          '正文里既没有字段名也没有关键词，这条依赖不可核',
        );
      }
    } else {
      const proc = THEORY_BY_ID[t.id].procedure.join('｜');
      ok(
        proc.includes(e.text),
        `${t.id}.${u.field} 引的 procedure 原话逐字出现在这副透镜里`,
        e.text,
      );
    }
  }
}

/* ─────────── 二 · 载荷计算 ─────────── */

function fake(opts: {
  theory?: TheoryId;
  mode?: AnalysisMode;
  level?: string;
  context?: Record<string, unknown>;
  grounding?: Record<string, unknown>;
}): Diagnosis {
  const c = {
    issue: '取消早读对不对',
    speakerPosition: '校方',
    opposingPosition: null,
    dialogueType: 'persuasion',
    dialogueTypeBasis: '「这说明」',
    stage: 'argumentation',
    audience: '家长',
    audienceKind: 'general',
    contextGaps: [],
    grounding: {},
    ...(opts.context ?? {}),
  };
  return {
    theory: opts.theory ?? 'walton',
    mode: opts.mode ?? 'diagnose',
    verdict: { level: opts.level ?? 'weakened' },
    context: { ...c, grounding: opts.grounding ?? {} },
  } as unknown as Diagnosis;
}

/* 2.1 读的格全都能从原文指出 → 判定区不补话 */
const solidArs = fake({
  theory: 'ars',
  grounding: {
    audience: { source: 'known', basis: '家长' },
    audienceKind: { source: 'known', basis: '家长' },
  },
});
const L1 = contextLoadOf(solidArs);
ok(L1.used.length === 2, 'ars 读两格', `${L1.used.length}`);
ok(L1.solid === 2 && L1.weak.length === 0, '两格都能从原文指出');
ok(L1.caveat === null, '地基稳时判定区不多说一句');
ok(L1.summary.includes('2 格能从原文指出'), '口径句报出能从原文指出的格数');

/* 2.2 一格假定 → 判定区点名 */
const guessArs = fake({
  theory: 'ars',
  grounding: {
    audience: { source: 'known', basis: '家长' },
    audienceKind: { source: 'guess', basis: '文本没说听谁', ifChanged: '若是对立听众，可接受性会降一档' },
  },
});
const L2 = contextLoadOf(guessArs);
ok(L2.weak.length === 1, '一格站不住');
ok(!!L2.caveat && L2.caveat.includes('「受众类型」是假定'), '判定区点名是哪一格假定', L2.caveat ?? '');
ok(!!L2.caveat && L2.caveat.startsWith('这条判定'), '给档位时说「这条判定」，不是「这份报告」');
ok(!!L2.caveat && L2.caveat.includes('档位可能跟着变'), '说清后果落在档位上');
ok(!/建议|应该|务必|请/.test(L2.caveat ?? ''), '不劝告');

/* 2.3 判不出来（unknown）→ 与「假定」分开说 */
const unsetWalton = fake({
  theory: 'walton',
  context: { dialogueType: 'unknown' },
  grounding: { dialogueType: { source: 'guess', basis: '看不出', ifChanged: '换类型则合法性结论不同' } },
});
const L3 = contextLoadOf(unsetWalton);
ok(L3.used.some((i) => i.unset), 'unknown 被认成判不出来');
ok(!!L3.caveat && L3.caveat.includes('「对话类型」判不出来'), '判不出来的格单独说，不混进「假定」', L3.caveat ?? '');

/* 2.4 降级过的 known → 「标了原文却找不着」，不叫「假定」 */
const downWalton = fake({
  theory: 'walton',
  grounding: { dialogueType: { source: 'inferred', downgraded: true, basis: '它自称引自原文' } },
});
const L4 = contextLoadOf(downWalton);
ok(L4.weak.some((i) => i.downgraded), '降级痕迹进了载荷');
ok(!!L4.caveat && L4.caveat.includes('标了原文却找不着'), '降级与假定分开说', L4.caveat ?? '');

/* 2.5 旧存档（一格标注都没有）→ 说「分不出」，不说「假定」 */
const oldWalton = fake({ theory: 'walton', grounding: {} });
const L5 = contextLoadOf(oldWalton);
ok(L5.unmarkedAll, '整份都没有标注时标出 unmarkedAll');
ok(!!L5.caveat && L5.caveat.includes('分不出'), '旧档说「分不出来路」', L5.caveat ?? '');
ok(!/假定/.test(L5.caveat ?? ''), '旧档不补一句「假定」——那是往它身上加一个它没做过的承诺');

/* 2.6 不读的格不参与判定 */
const irrelevantGuess = fake({
  theory: 'ars',
  context: { issue: '换个说法' },
  grounding: {
    audience: { source: 'known', basis: '家长' },
    audienceKind: { source: 'known', basis: '家长' },
    issue: { source: 'guess', basis: '看不出争什么', ifChanged: '换议题结论会变' },
  },
});
ok(contextLoadOf(irrelevantGuess).weak.length === 0, 'ars 不读争议之点，它标 assume 也不进判定的地基');
ok(contextLoadOf(irrelevantGuess).caveat === null, '不读的格是假定，判定区也不补话');

/* 2.7 不给档位的模式 / 判不了 → 说「这份分析」 */
const fallacyWeak = fake({ theory: 'ars', mode: 'fallacy', grounding: {} });
ok(!!contextLoadOf(fallacyWeak).caveat?.startsWith('这份分析'), '查谬误模式不给档位，不说「这条判定」');
const undet = fake({ theory: 'ars', level: 'undetermined', grounding: {} });
ok(!!contextLoadOf(undet).caveat?.startsWith('这份分析'), '判不了的时候也不说「这条判定」');

/* 2.8 MODE_META 是唯一口径：这张判断表若与它不一致，这里对拍 */
for (const m of ANALYSIS_MODES as readonly AnalysisMode[]) {
  const l = contextLoadOf(fake({ theory: 'ars', mode: m, grounding: {} })).caveat ?? '';
  const wants = MODE_META[m].givesVerdict;
  ok(
    wants ? l.startsWith('这条判定') || l === '' : l.startsWith('这份分析') || l === '',
    `${m} 模式的口径与 MODE_META.givesVerdict 一致`,
    l,
  );
}

/* 2.9 三档中文只有一份 */
for (const [k, zh] of [
  ['known', '原文'],
  ['inferred', '推出'],
  ['guess', '假定'],
  ['unmarked', '没标'],
] as const) {
  ok(SOURCE_LABEL[k] === zh, `出处中文「${zh}」由 SOURCE_LABEL 定义（${k}）`);
}
ok(AUDIENCE_KIND_LABEL.unknown === '判不出', '受众类型 unknown 有中文，不裸奔');
ok(STAGE_LABEL.argumentation === '论证阶段', '阶段中文与报告页原有写法一致');
for (const f of CONTEXT_FIELDS) ok(!!CONTEXT_FIELD_LABEL[f]?.trim(), `「${f}」有中文名`);

/* ─────────── 三 · 提示词 ─────────── */

const promptMissing: string[] = [];
for (const t of THEORIES) {
  for (const m of ANALYSIS_MODES as readonly AnalysisMode[]) {
    const p = buildPrompt(t.id as TheoryId, m);
    const all = p.system + p.userTemplate;
    const wantRead = CONTEXT_USE[t.id].length > 0;
    if (wantRead && !all.includes('本透镜的判定要读')) promptMissing.push(`${t.id}.${m} 缺「要读哪几格」`);
    if (!wantRead && !all.includes('一步都不读语境七格')) promptMissing.push(`${t.id}.${m} 缺「不读语境」`);
  }
}
ok(promptMissing.length === 0, '30 份提示词都写明了本透镜读不读语境、读哪几格', promptMissing.slice(0, 5).join('、'));

const arsP = buildPrompt('ars', 'diagnose').userTemplate;
ok(arsP.includes('「受众类型」'), 'ars 的提示词点名了受众类型这一格');
ok(arsP.includes('ifChanged 就必须写'), 'ars 的提示词要求非 known 的格写 ifChanged');
ok(arsP.includes('不许写「影响很大」'), 'ifChanged 要求有落点，不许写空话');
const toulminP = buildPrompt('toulmin', 'diagnose').userTemplate;
ok(toulminP.includes('不要把档位或结论归因到语境上'), '不读语境的透镜明确禁止把档位归因到语境');
ok(/^7\.\s/m.test(arsP), '这条规则排在 user 模板第 7 条（编号不断层）');
ok(SHARED_SCHEMA.includes('非 known 都要写'), 'schema 里 ifChanged 的口径已扩到非 known');

/* inferred 缺 ifChanged 现在要留一条问题——这是 2.7.0 与 2.6.0 的差别 */
const infNoIf = normalizeGrounding({ dialogueType: { source: 'inferred', basis: '据「这说明」推的' } }, '这说明取消早读是错的');
ok(infNoIf.grounding.dialogueType?.source === 'inferred', 'inferred 不被降级（它没说谎，只是缺一句敏感度）');
ok(
  infNoIf.problems.some((p) => p.kind === 'inferred-without-ifchanged'),
  'inferred 缺 ifChanged 记一条问题',
);
const infWithIf = normalizeGrounding(
  { dialogueType: { source: 'inferred', basis: '据「这说明」推的', ifChanged: '换成探究型，CQ1 不再成立' } },
  '这说明取消早读是错的',
);
ok(infWithIf.grounding.dialogueType?.ifChanged?.includes('CQ1'), 'inferred 的 ifChanged 会被收下并显示');

/* ─────────── 四 · 界面接线 ─────────── */

const diag = src('src/renderer/src/components/Diagnosis.tsx');
ok(diag.includes("from '@shared/context-use'"), '报告页从 shared 取依赖结论，不自己判断');
ok(/const ctxLoad = useMemo\(\(\) => contextLoadOf\(d\), \[d\]\)/.test(diag), '载荷按报告 memo 化');
/* 守卫要查「还挂在 caveat 上」。查「data-verdict-context 这个词还在」会骗人：
   把条件改成 true 时词还在，判定区就会对每份报告都说一句地基不稳。 */
ok(
  /ctxLoad\.caveat && \([\s\S]{0,160}data-verdict-context/.test(diag),
  '判定区那句挂在 caveat 上，不是无条件渲染',
);
ok(
  /sub=\{ctxLoad\.used\.length \? `这副尺子读其中 \$\{ctxLoad\.used\.length\} 格` : '这副尺子不读语境'\}/.test(diag),
  '语境块的标题按依赖表分口径，不是一句「都锚在这上面」',
);
ok(!diag.includes('后面所有判断都锚在这上面'), '那句对三副透镜不成立的话已经删掉');
ok(diag.includes('field="audienceKind"'), '受众类型那一格在报告里显示了（它决定可接受性的偏置方向）');
ok(/ctxLoad\.weak\.length \? ' weak'/.test(diag), '口径句在有站不住的格时才加左边线');
/* 界面里不许自己写一份「哪一档算站不住」的判断——那会与 shared 分叉 */
ok(!/source === 'guess' \|\|/.test(diag) && !/source==='guess'\|\|/.test(diag), '界面不自己判「哪一档算站不住」');

const css = src('src/renderer/src/styles.css');
for (const sel of ['.ctx-sum', '.ctx-sum.weak', '.ctxbadge.s-known', '.ctxbadge.s-guess', '.ctxbadge.down', '.ctx-basis', '.ctx-if', '.vtag']) {
  ok(css.includes(`${sel} {`) || css.includes(`${sel}{`), `样式里有 ${sel}`);
}
ok(/\.ctxbadge\.s-guess \{[\s\S]{0,80}--invalid/.test(css), '「假定」用警示色，不是绿色');

/* ─────────── 汇总 ─────────── */

if (failed.length) {
  console.error(`✗ check:context-use 红了 ${failed.length} 处（通过 ${passed} 条）\n`);
  for (const f of failed) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(
  `✓ check:context-use 通过 ${passed} 条｜三副透镜读语境、三副不读且各有理由、每条依赖指得出出处、旧档不说假定`,
);
