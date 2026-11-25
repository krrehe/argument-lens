import { normalizeDiagnosis } from '../src/main/analyze';
import { extractJson } from '../src/main/llm';
import { applyDeepChallenges, validateDeep } from '@shared/deep';
import { fallacyHits, mapSentences } from '@shared/fallacy-map';
import type { TheoryId } from '@shared/theories';

/**
 * 提示词契约检查。
 *
 * 提示词里那些硬规矩（不许把削弱写成反驳、命名要过三道门槛、不许编引文……）
 * 如果只写在提示词里，它们就只是**请求**。模型会违反，而且违反得很有条理。
 * 所以每一条都在 `analyze.ts` 里有一道确定性裁决兜底。
 *
 * 这个文件验证的是兜底本身：喂一个**故意越界**的模型输出，
 * 断言对应的 diagnostic 一定出现。
 *
 * 这不是模型质量评估——没有模型参与，也没有打分。
 * 它只回答一件事：提示词要求守的规矩，代码是不是真的在守。
 * 声称评了模型质量而实际没评，是这类工具最常见的自欺。
 */

let passed = 0;
const failures: string[] = [];

function ok(cond: boolean, name: string, detail = ''): void {
  if (cond) {
    passed += 1;
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const PASSAGE = '早读取消之后，该校一本率从 62% 掉到 51%。可见取消早读导致成绩下滑，应当恢复早读。';

function run(raw: unknown, theory: TheoryId = 'walton', passage = PASSAGE) {
  return normalizeDiagnosis(raw, passage, theory);
}

function codes(d: ReturnType<typeof run>): string[] {
  return d.diagnostics.map((x) => x.code);
}

function has(raw: unknown, code: string, theory: TheoryId = 'walton'): boolean {
  return codes(run(raw, theory)).includes(code);
}

/* ── 逐条越界 ── */

// 注意：必须显式给一个非 undetermined 的档位才触发——
// 空输入本身档位就是 undetermined，用它测等于什么都没测。
ok(has({ verdict: { level: 'withstands' } }, 'CATALOG_OVERREACH', 'copi'), '名录透镜给出终局判定 → 打回判不了');
ok(
  run({ verdict: { level: 'withstands' } }, 'copi').verdict.level === 'undetermined',
  '名录透镜的档位被强制为 undetermined'
);

ok(
  has({ scope: { applicable: false, reason: '不适用' }, checks: [{ id: 'CQ1', answer: 'violated' }] }, 'SCOPE_CHECKS_DROPPED'),
  '范围门判不适用却仍给检查项 → 清空'
);

ok(
  has(
    {
      defeat: { kind: 'undermining' },
      verdict: { level: 'fails', whatIsRefuted: 'conclusion' },
    },
    'OVERRUN_CORRECTED'
  ),
  '削弱性击败被写成结论为假 → 改回仅否证论证'
);

ok(has({ labels: [{ id: 'post-hoc', name: '后此谬误' }] }, 'NAMING_GATE'), '命名缺三道门槛 → 不予显示');
ok(has({ labels: [{ id: '不存在的条目' }] }, 'UNKNOWN_LABEL'), '索引外的名字 → 丢弃');
ok(has({ lens: { schemeId: 'invented-scheme' } }, 'UNKNOWN_SCHEME'), '型式 id 不在库内 → 降为 none');

ok(
  has({ premises: [{ id: 'P1', supports: ['P9'] }] }, 'SUPPORTS_UNRESOLVED'),
  '支撑关系指向不存在的 id → 丢弃并留痕'
);

ok(has({ selfCheck: { underOtherLens: '' } }, 'NO_LENS_CONTRAST'), '未写「换另一副透镜会怎样」→ 提示');
ok(has({ refutations: [{ script: '你这条没有根据。' }] }, 'NO_STEELMAN'), '反驳缺 steelman → 提示');

ok(has({ lens: { burdenStandard: '' } }, 'NO_BURDEN_STANDARD', 'ars'), 'ARS 未写论证负担 → 提示');
ok(
  has({ lens: { order: 'undetermined', axis: 'undetermined', premiseType: 'undetermined' } }, 'PTA_NO_FEATURE', 'pta'),
  'PTA 三特征全未定 → 提示这是失效而非中性'
);

ok(
  has({ checks: [{ id: 'R1', answer: 'passed' }] }, 'CHECKLIST_INCOMPLETE', 'pragma'),
  '固定清单未列全 → 补齐为「未覆盖」'
);
ok(
  has({ checks: [{ id: 'T-claim', answer: 'passed' }] }, 'CHECKLIST_INCOMPLETE', 'toulmin'),
  '图尔敏六要素未列全 → 补齐为「未覆盖」'
);

ok(
  has({ conclusion: { quote: '这句话原文里根本没有' } }, 'QUOTE_NOT_FOUND'),
  '引文在原文中找不到 → 降级为推定'
);

/* ── 描述类模式不给判定 ── */

/**
 * 这两个模式的「不给档位」不能只写在提示词里。
 *
 * 提示词是请求，代码是保证。模型几乎每次都会顺手给一个 level——
 * 它在一个要求填 level 的 schema 里，填一个值是它的默认动作。
 * 而界面会照常把这个档位渲染成一份判定，用户切到重构模式要的就是「别判」。
 *
 * 所以下面三条都验的是**故意越界**的输入：给一个非 undetermined 的档位、
 * 给一条击败、给几条反驳与命名，断言它们分别被改回来、并且都留了痕。
 */
{
  /*
   * 这条样本必须带一个真结论。
   *
   * 它原本只给了 verdict、没给 conclusion，能过是因为当时没有 G10。
   * 现在有了：判为适用却抽不出结论 → 档位打回未定，于是这条样本自己触发了 G10，
   * 断言的意图（「判定类模式不受描述类规则影响」）被另一条规则盖住了。
   * 补上结论，测的才是它想测的东西。
   */
  const verdictOut = {
    conclusion: { text: '取消早读是错的', quote: '这说明取消早读是错的' },
    verdict: { level: 'fails', whatIsRefuted: 'conclusion' },
  };
  for (const mode of ['reconstruct', 'interrogate'] as const) {
    const d = normalizeDiagnosis(verdictOut, PASSAGE, 'walton', { mode });
    ok(d.verdict.level === 'undetermined', `${mode} 档位被强制为 undetermined`, d.verdict.level);
    ok(d.verdict.whatIsRefuted === 'nothing', `${mode} 不声称否证了任何东西`);
    ok(d.defeat.kind === 'none', `${mode} 击败类型被清空`);
    ok(d.defeat.checkId === null, `${mode} 不指认倒在哪一条`);
    ok(codes(d).includes('MODE_NO_VERDICT'), `${mode} 强制档位时留了痕`);
    ok(d.mode === mode, `${mode} 模式被记进报告（不是被静默降级成诊断）`);
  }

  // 命名在描述类模式下也要清空：命名是评价，不是描述
  const lab = { labels: [{ id: 'post-hoc', condition: 'a', whenLegitimate: 'b', riskOfError: 'c' }] };
  for (const mode of ['reconstruct', 'interrogate'] as const) {
    const d = normalizeDiagnosis(lab, PASSAGE, 'walton', { mode });
    ok(d.labels.length === 0, `${mode} 命名候选被清空`, `剩 ${d.labels.length}`);
    ok(codes(d).includes('MODE_NO_LABELS'), `${mode} 清空命名时留了痕`);
  }

  // 重构清空反驳；提问**保留**——那里它是主输出（问题清单）
  const refs = { refutations: [{ script: '你说多数研究表明，指的是哪几项？', steelman: '他会举一篇', reply: '那就问那一篇的样本' }] };
  const rc = normalizeDiagnosis(refs, PASSAGE, 'walton', { mode: 'reconstruct' });
  ok(rc.refutations.length === 0, '重构模式清空攻击路线');
  ok(codes(rc).includes('MODE_NO_REFUTATIONS'), '重构清空反驳时留了痕');
  const q = normalizeDiagnosis(refs, PASSAGE, 'walton', { mode: 'interrogate' });
  ok(q.refutations.length === 1, '提问模式保留问题清单（它是主输出）');
  ok(q.refutations[0].script.includes('指的是哪几项'), '问题清单内容原样保留');

  // 判定类模式不受影响：给档位就是给档位，不该被清
  const dg = normalizeDiagnosis(verdictOut, PASSAGE, 'walton', { mode: 'diagnose' });
  ok(dg.verdict.level === 'fails', '诊断模式照常给档位（不受描述类规则影响）');
  const rt = normalizeDiagnosis(verdictOut, PASSAGE, 'walton', { mode: 'redteam' });
  ok(rt.verdict.level === 'fails', '红队模式照常给档位');

  /*
   * G10 的正面测试：判为适用，却一条结论都没抽出来。
   * 这时档位没有落点——「这份论证被削弱了」这句话，说的是哪一句被削弱了？
   * 所以即使是诊断模式，也要打回未定，并且留痕。
   */
  const noClaim = normalizeDiagnosis(
    { verdict: { level: 'fails', whatIsRefuted: 'conclusion' } },
    PASSAGE,
    'walton',
    { mode: 'diagnose' }
  );
  ok(noClaim.verdict.level === 'undetermined', '抽不出结论时，诊断模式也不给档位（G10）');
  ok(noClaim.verdict.whatIsRefuted === 'nothing', '没有结论时不声称否证了任何东西');
  ok(
    noClaim.diagnostics.some((x) => x.code === 'APPLICABLE_BUT_NO_CLAIM'),
    'G10 打回档位时留了痕'
  );
}

/* ── 查谬误模式：名字必须付代价（G11） ── */

/**
 * 这个模式的主输出是名字，而名字是这套工具里最容易脱离位置单独存在的东西。
 *
 * 「这是事后归因」——六个字，读起来像结论，实际上什么也没说：说不出是原文哪一句，
 * 用户既不能拿它对质，也不知道自己有没有冤枉人。所以这里验的不是措辞，
 * 是那条硬规矩：缺位置的名字不许显示。
 *
 * 另外三条验的是「门控有没有串」：查谬误模式给名字、不给档位、不给攻击路线。
 * 这三件事原先由两个开关控制（givesVerdict 管档位，也被顺手用来管命名），
 * 加模式时正是那一处会静默出错——报告照常生成，只是主输出空着。
 */
{
  const located = {
    id: 'post-hoc',
    quote: '该校一本率从 62% 掉到 51%',
    condition: '仅凭时间先后断言因果，且没排除其他原因',
    whenLegitimate: '机制已知、时间间隔合理且排除了主要干扰变量时，由先后推因果是正当的',
    riskOfError: '把「证据不足」当成「推理错误」；作者若有未写出的对照数据，这条不成立',
    landsOnCheck: 'CQ2',
  };
  const base = {
    conclusion: { text: '取消早读导致成绩下滑', quote: '可见取消早读导致成绩下滑' },
    checks: [
      { id: 'CQ1', answer: 'passed', basis: '文本给了两个时间点上的事实' },
      { id: 'CQ2', answer: 'unanswered', basis: '只给了单校单年的前后对比' },
    ],
  };
  const F = (patch: Record<string, unknown>) =>
    normalizeDiagnosis({ ...base, ...patch }, PASSAGE, 'walton', { mode: 'fallacy' });

  const d0 = F({ labels: [located] });
  ok(d0.labels.length === 1, '谬误模式：位置与落点齐备的命名被保留', `剩 ${d0.labels.length} 条`);
  ok(d0.labels[0]?.span?.quality === 'exact', '谬误模式：命名带上了原文位置', String(d0.labels[0]?.span?.quality));
  ok(!codes(d0).includes('LABEL_NO_LOCATION'), '位置可定位的命名不报「没位置」');

  const noQuote = F({ labels: [{ ...located, quote: undefined }] });
  ok(noQuote.labels.length === 0, '谬误模式：没给原文引文的命名不显示');
  ok(codes(noQuote).includes('LABEL_NO_LOCATION'), '丢掉没位置的命名时留了痕');

  const wrongQuote = F({ labels: [{ ...located, quote: '这句话原文里根本没有' }] });
  ok(wrongQuote.labels.length === 0, '谬误模式：引文不在原文里的命名不显示', '说过，但指的是空气');

  const badCheck = F({ labels: [{ ...located, landsOnCheck: 'CQ9' }] });
  ok(badCheck.labels.length === 0, '谬误模式：挂在不存在的检查项上的命名不显示');
  ok(codes(badCheck).includes('LABEL_NO_CHECK'), '丢掉挂不上落点的命名时留了痕');

  /*
   * checks 为空时不要求落点，否则名录透镜下的查谬误模式永远交白卷——
   * 那副透镜按设计不产生检查项。这不是放宽标准，是不让一条规则把整副透镜废掉。
   */
  const noChecks = normalizeDiagnosis(
    { conclusion: base.conclusion, labels: [located] },
    PASSAGE,
    'copi',
    { mode: 'fallacy' }
  );
  ok(noChecks.labels.length === 1, '透镜不产生检查项时，命名只按位置判', `剩 ${noChecks.labels.length} 条`);
  ok(codes(noChecks).includes('LABEL_WITHOUT_CHECK'), '没有落点时明说，不假装落上了');
  ok(noChecks.labels[0]?.landsOnCheck === 'CQ2', '落点照原样留着，只是本次无对应检查项');

  /* 门控三件事：给名字、不给档位、不给攻击路线 */
  const withVerdict = F({
    labels: [located],
    verdict: { level: 'fails', whatIsRefuted: 'conclusion' },
    defeat: { kind: 'undermining', checkId: 'CQ2' },
  });
  ok(withVerdict.verdict.level === 'undetermined', '谬误模式给了档位 → 打回判不了');
  ok(codes(withVerdict).includes('MODE_NO_VERDICT'), '打回档位时留了痕');
  ok(withVerdict.labels.length === 1, '打回档位不许连带清掉命名（那是这个模式的主输出）', `剩 ${withVerdict.labels.length} 条`);
  ok(withVerdict.defeat.kind === 'none' && withVerdict.defeat.checkId === null, '谬误模式不指认倒在哪一条');

  const withRef = F({
    labels: [located],
    refutations: [{ script: '你这条没有对照数据。', steelman: '他会说单校就是全部' }],
  });
  ok(withRef.refutations.length === 0, '谬误模式清空攻击路线');
  ok(codes(withRef).includes('MODE_NO_REFUTATIONS'), '清空攻击路线时留了痕');

  /*
   * 反向：诊断模式不受 G11 约束。
   *
   * 这条不是凑数。查谬误之外的三个模式里名字是末端注释，注释不必指出位置；
   * 若 G11 一视同仁地执行，86 份旧报告里的每一条命名都会被判成废条目，
   * 而它们在诊断模式下本来是合法显示、也被用户读过、异议过的。
   */
  const dg = normalizeDiagnosis({ ...base, labels: [{ ...located, quote: undefined }] }, PASSAGE, 'walton', {
    mode: 'diagnose',
  });
  ok(dg.labels.length === 1, '诊断模式里没标位置的命名照旧保留', 'G11 只管查谬误模式');
}

/* ── 提示词版本要能带出来 ── */

{
  const d = normalizeDiagnosis({}, PASSAGE, 'walton', {
    prompt: { version: '2.0.0', fingerprint: 'abcdef012345' },
  });
  ok(d.prompt?.version === '2.0.0', '提示词版本写进报告');
  ok(d.prompt?.fingerprint === 'abcdef012345', '提示词指纹写进报告');
  const noPrompt = normalizeDiagnosis({}, PASSAGE, 'walton');
  ok(noPrompt.prompt === undefined, '未传版本时不回填假值');
}

/* ── 健壮性 ── */

ok(
  (() => {
    try {
      const d = run(undefined as unknown);
      return false;
    } catch {
      return true;
    }
  })(),
  '空结构直接抛错，不产出一份假报告'
);

ok(
  (() => {
    const d = run({});
    return Array.isArray(d.checks) && !!d.conclusion && !!d.verdict && !!d.selfCheck;
  })(),
  '最小输入也能产出完整结构（字段齐全，值可以是缺省）'
);

ok(
  (() => {
    const d = run({ refutations: [{ script: 'x'.repeat(500) }] });
    return (d.refutations[0]?.script.length ?? 0) <= 200;
  })(),
  '话术过长被截断（提示词要求 ≤120 字，代码兜底 200）'
);

ok(
  (() => {
    const d = run({ labels: Array.from({ length: 8 }, () => ({ id: 'post-hoc', condition: 'a', whenLegitimate: 'b', riskOfError: 'c' })) });
    return d.labels.length <= 3;
  })(),
  '命名候选不超过三条（贴标签要付代价）'
);

/* ── 评测跑出来的三类真实失效（2026-11，见 docs/评测报告.md） ── */

ok(
  (() => {
    const d = run(
      {
        conclusion: { text: '应当恢复早读', quote: '应当恢复早读' },
        premises: [{ id: 'P1', text: '一本率掉了 11 个百分点', quote: '该校一本率从 62% 掉到 51%' }],
        intermediate: [{ id: 'I1', text: '取消早读导致下滑（因果成立）', quote: '该校一本率从 62% 掉到 51%' }],
        defeat: { kind: 'undermining', cuts: 'P1 到 I1 的联结', explanation: 'I1 未获得担保' },
      },
      'walton',
      PASSAGE
    );
    return (
      d.diagnostics.some((x) => x.code === 'RESTATED_STEP') &&
      d.intermediate.length === 0 &&
      d.defeat.cuts.includes('P1') &&
      !/I1/.test(d.defeat.cuts)
    );
  })(),
  '同一句既当依据又当中间结论 → 合并为一步，并改写正文里的旧编号'
);

ok(
  (() => {
    const d = run({
      scope: { applicable: false, reason: '没有论证' },
      conclusion: { text: '无结论可规范化', quote: '早读取消之后' },
    });
    return d.conclusion.quote === null && d.conclusion.span === null;
  })(),
  '判不适用时的占位结论不许挂原文引文'
);

ok(
  (() => {
    const one = { id: 'post-hoc', condition: 'a', whenLegitimate: 'b', riskOfError: 'c' };
    const d = run({ labels: [one, one] }, 'copi');
    return d.labels.length === 1 && d.diagnostics.some((x) => x.code === 'LABEL_DUPLICATED');
  })(),
  '同一条目重复出现 → 合并为一条'
);

ok(
  !codes(run({ scope: { applicable: false, reason: '没有论证' } })).includes('NO_LEGITIMATE_FOUND'),
  '判不适用时不再提示「没找到此处合法」（那是拿免责声明当指控）'
);

ok(
  codes(run({ scope: { applicable: true, reason: '有论证' } })).includes('NO_LEGITIMATE_FOUND'),
  '适用而没找到「此处合法」时，该提示仍然出现'
);

/* ── 谬误落点图：切句与命中 ── */

const FM_PASSAGE = '第一句在这里。第二句在那边！末句没有句号';
const S = mapSentences(FM_PASSAGE);
ok(S.length === 3, '落点图：句末标点切句，末句无标点也保留', `实际 ${S.length} 句`);
ok(S[0]?.start === 0 && S[0]?.text === '第一句在这里。', '落点图：句子带原文下标（UTF-16 坐标系）');
ok(
  mapSentences('他说「早读有益。」就走')?.[0]?.text === '他说「早读有益。」',
  '落点图：收尾引号跟着句子走'
);
ok(mapSentences('   \n  ').length === 0, '落点图：纯空白不产出句子');

const mkLabel = (span: { start: number; end: number; quality: 'exact' | 'failed' } | null) => ({
  id: 'x1',
  name: '事后归因',
  condition: 'c',
  whenLegitimate: 'w',
  riskOfError: 'r',
  landsOnCheck: null,
  tradition: 'walton',
  tag: 'inferred' as const,
  confidence: 'medium' as const,
  span,
});
const hitsOf = (span: { start: number; end: number; quality: 'exact' | 'failed' } | null) =>
  fallacyHits(
    FM_PASSAGE,
    [mkLabel(span)] as unknown as Parameters<typeof fallacyHits>[1]
  )[0];

const hit = hitsOf({ start: 0, end: 7, quality: 'exact' }) as { at: number[] };
ok(Array.isArray(hit.at) && hit.at.length === 1 && hit.at[0] === 0, '落点图：span 与句子交集即命中');
const cross = hitsOf({ start: 5, end: 12, quality: 'exact' }) as { at: number[] };
ok(
  Array.isArray(cross.at) && cross.at.includes(0) && cross.at.includes(1),
  '落点图：跨句的引文落在每一句上，不猜最近句'
);
ok(
  (() => {
    const h = hitsOf({ start: 0, end: 3, quality: 'failed' }) as { at: unknown; reason?: string };
    return h.at === null && h.reason === 'failed';
  })(),
  '落点图：定位失败不画位置（failed），留痕不静默'
);
ok(
  (() => {
    const h = hitsOf(null) as { at: unknown; reason?: string };
    return h.at === null && h.reason === 'missing';
  })(),
  '落点图：没给 span 的不画位置（missing），留痕不静默'
);
ok(
  (() => {
    const h = hitsOf({ start: 0, end: 7, quality: 'fuzzy' }) as { at: number[] };
    return Array.isArray(h.at) && h.at.length === 1;
  })(),
  '落点图：模糊匹配照样画，但界面必须写明是模糊（画同一格子≠同等可信）'
);
ok(
  (() => {
    const h = hitsOf({ start: 999, end: 1001, quality: 'exact' }) as { at: number[] };
    return Array.isArray(h.at) && h.at.length === 0;
  })(),
  '落点图：span 越界得空命中，图上不出现，也不冒充 failed'
);

/* ── 模型输出的 JSON 抠取 ── */
/*
 * 真实评测里出现过两种坏输出：
 *   1. 正常 JSON 后面又跟了一段话（甚至第二个 JSON 对象）；
 *   2. 围栏、全角引号、尾逗号这类机械错误。
 * 第 1 种如果按「第一个 { 到最后一个 }」切片，会把后面的对象也吞进来，
 * 然后报「Unexpected non-whitespace character after JSON」。
 * 这里钉住：只取**第一个配平的 JSON 对象**，后面的内容不参与解析；
 * 但截断的 JSON 必须继续报错，不能悄悄返回半个对象。
 */
const jsonOf = (s: string): any => {
  try {
    return extractJson(s);
  } catch {
    return undefined;
  }
};

ok(jsonOf('{"a":1}')?.a === 1, 'JSON：普通对象照常解析');
ok(jsonOf('```json\n{"a":1}\n```')?.a === 1, 'JSON：围栏照常剥掉');
ok(jsonOf('{"a":1}{"b":2}')?.a === 1, 'JSON：后跟第二个对象时只取第一个，不把两个拼在一起');
ok(jsonOf('{"a":1}\n\n以上是分析。')?.a === 1, 'JSON：后跟说明文字时只取前面的对象');
ok(jsonOf('{"a":"} {","b":2}')?.a === '} {' && jsonOf('{"a":"} {","b":2}')?.b === 2, 'JSON：字符串里的花括号不当作结构');
ok(jsonOf('{"a":"他说\\"好\\"","b":2}')?.a === '他说"好"', 'JSON：转义引号不打乱配平');
ok(jsonOf('{"a":"x",}')?.a === 'x', 'JSON：尾逗号仍然修得回来');
ok(jsonOf('{"a":“x”}')?.a === 'x', 'JSON：全角引号仍然修得回来');
ok(jsonOf('{"a":{"b":1},"c":2}')?.a?.b === 1 && jsonOf('{"a":{"b":1},"c":2}')?.c === 2, 'JSON：嵌套对象返回外层，不截成内层');
ok(jsonOf('{"a":1') === undefined, 'JSON：截断的对象必须报错，不返回半个');
ok(jsonOf('{"a":{"b":1}') === undefined, 'JSON：外层截断时不把完整的内层对象顶上来');
ok(jsonOf('这里没有 JSON') === undefined, 'JSON：找不到对象时仍然报错');

/* ── 深查账本：只核落点/引文/理论依据/状态 ── */
{
  const base = normalizeDiagnosis({}, PASSAGE, 'walton');
  const finding = {
    id: 'D1',
    kind: 'cq-gap',
    title: '报告没有问这一问',
    detail: '这一段的相关—因果型式还差「机制」这一问。',
    targetId: 'C',
    quote: '早读取消之后',
    theoryRef: 'T1-01',
    ifChanged: '如果原文给出了机制，这条就不成立。',
    status: 'open',
  };
  const good = validateDeep({ findings: [finding] }, base, PASSAGE);
  ok(
    good.deep.findings.length === 1 &&
      good.deep.findings[0].targetOk &&
      good.deep.findings[0].quoteOk &&
      good.deep.findings[0].theoryOk,
    '深查：落点、引文、理论依据都对得上'
  );

  const lost = validateDeep(
    {
      findings: [
        {
          ...finding,
          targetId: 'P9',
          quote: '原文里没有这一句',
          theoryRef: 'T9-99',
        },
      ],
    },
    base,
    PASSAGE
  );
  ok(
    lost.deep.findings.length === 0 && lost.deep.unlocated.length === 1,
    '深查：落点与引文都指不到 → 进 unlocated，不丢'
  );

  const dupe = validateDeep({ findings: [finding, { ...finding }] }, base, PASSAGE);
  ok(dupe.deep.findings.length === 1, '深查：id 重复只留一条');

  const merged = applyDeepChallenges(good.deep, {
    challenges: [
      {
        id: 'D1',
        challenge: '原文可能已经用别的话交代了机制。',
        status: 'confirmed',
        ifChanged: '如果原文别处写了机制，这条要撤回。',
      },
    ],
  });
  ok(
    merged.deep.findings[0].status === 'confirmed' &&
      merged.deep.findings[0].challenge.includes('机制'),
    '深查：第二遍的状态与最强反驳合并回账本'
  );

  const missing = applyDeepChallenges(good.deep, { challenges: [] });
  ok(
    missing.deep.findings[0].status === 'unresolved',
    '深查：没被第二遍反驳到的发现标未决，不假装站住'
  );
}

/* 同上：断言总数兜底，防止某段循环没跑起来而输出仍是全绿 */
ok(passed >= 75, '断言总数不少于 75 项（少跑就是静默跳过）', `实际 ${passed}`);

/* ── 结果 ── */

if (failures.length) {
  console.error(`✗ 提示词契约检查失败 ${failures.length} 项（通过 ${passed} 项）`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ 提示词契约检查通过 ${passed} 项`);
