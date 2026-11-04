/**
 * 「回到原文重读」的断言。
 *
 * 这一屏的价值全押在两条否定的承诺上，任何一条破了都不会报错，只会让它
 * 悄悄变回「又一份生成好的东西」：
 *   1. **原文一个字没改。** 逐句拼回来必须逐字等于 passage，包括空行与结尾换行。
 *   2. **本地一个字的判断都没写。** 屏幕上出现的每一句内容，必须逐字来自报告里
 *      已经写下的字段。2026-11-04 实测真实存档：报告 ≥12 字的文字 97.4% 逐字来自
 *      模型返回的 JSON。若这一层再加一句「解释」，那个数字只会更高。
 *
 * 其余断言守位置：failed 的 span 不能拿来钉句子、引文出现两次不能猜第一处、
 * 同一句上的「命名」与「此处合法」必须并存（分歧本身就是输出，不能合并）。
 *
 * 跑法：npm run check:reread
 */
import type { Claim, Diagnosis, LegitimateMove, Span } from '@shared/types';
import {
  REREAD_KIND_LABEL,
  UNPLACED_LABEL,
  rereadOf,
  type RereadKind,
} from '@shared/reread';
import { claim, diag, labelItem } from './fixture-report';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}

const S1 = '取消早读之后一本率下降。';
const S2 = '所以应当恢复早读。';
const S3 = '其实去年同期也降过。';
const PASSAGE = S1 + S2 + S3;

function sp(needle: string, passage = PASSAGE, quality: Span['quality'] = 'exact'): Span {
  const start = passage.indexOf(needle);
  return { start, end: start + needle.length, quote: needle, quality };
}

function withSpan(c: Claim, span: Span | null): Claim {
  return { ...c, span };
}

/** 主样本：第一句三种身份并存，第二句只有一条主张，第三句谁都没提。 */
function sample(patch: Partial<Diagnosis> = {}): Diagnosis {
  const legit: LegitimateMove = {
    targetId: 'P1',
    quote: '一本率下降',
    what: '这一处只是报告了时间上的先后',
    why: '没有把先后说成因果',
    tag: 'argued',
    confidence: 'medium',
  };
  return diag({
    passage: PASSAGE,
    conclusion: withSpan(claim('C', 'conclusion', '取消早读是错的'), sp(S1)),
    premises: [withSpan(claim('P1', 'premise', '一本率下降了'), sp(S2))],
    intermediate: [],
    labels: [labelItem({ id: 'L1', name: '以先后为因果', span: sp(S1) })],
    legitimateMoves: [legit],
    ...patch,
  });
}

const D = sample();
const V = rereadOf(D);
const serialized = JSON.stringify(D);

/* ── 一、先确认样本不是空的，否则下面那些「每一条都…」全是恒真断言 ───── */
ok(V.sentences.length === 3, '样本切出三句', `实际 ${V.sentences.length}`);
ok(V.refCount === 4, '样本确实挂上了四条引用', `实际 ${V.refCount}`);
ok(V.quietCount === 1, '样本确实有一句没人提', `实际 ${V.quietCount}`);
ok(V.unplaced.length === 0, '样本里没有未定位条目', `实际 ${V.unplaced.length}`);

/* ── 二、原文不变 ───────────────────────────────────────────── */
ok(
  V.sentences.map((s) => s.text).join('') === PASSAGE,
  '逐句拼回来逐字等于原文',
);
ok(
  V.sentences.every((s) => PASSAGE.includes(s.text)),
  '每一句都是原文的原样切片',
);
ok(
  V.sentences.every((s, i) => s.index === i && s.start < s.end && s.start >= 0 && s.end <= PASSAGE.length),
  '下标连续、递增、不越界',
);
ok(
  V.sentences.every((s, i) => (i === 0 ? s.start === 0 : s.start === V.sentences[i - 1].end)),
  '句子之间既不留缝也不重叠',
);
ok(
  V.sentences[V.sentences.length - 1]?.end === PASSAGE.length,
  '最后一句收走原文末尾',
);

/* 空行与结尾换行：mapSentences 会丢掉它们，这一层必须把它们收回来。 */
const messy = '甲。\n\n乙。  \n';
const vm = rereadOf(sample({ passage: messy }));
ok(vm.sentences.map((s) => s.text).join('') === messy, '含空行与结尾换行时仍逐字还原', JSON.stringify(vm.sentences.map((s) => s.text)));
const vw = rereadOf(sample({ passage: '   \n ' }));
ok(vw.sentences.length === 1 && vw.sentences[0].text === '   \n ', '全是空白的原文也照原样摆出来');
ok(rereadOf(sample({ passage: '' })).sentences.length === 0, '空原文不编句子');

/* 纯函数：不改写报告，同输入同输出。 */
ok(JSON.stringify(D) === serialized, '调用没有改写报告对象');
ok(JSON.stringify(rereadOf(D)) === JSON.stringify(V), '同一输入两次结果一致');

/* ── 三、位置：不猜、不越界、不静默丢弃 ───────────────────────── */
ok(
  V.sentences.every((s) => s.refs.every((r) => r.start < s.end && s.start < r.end)),
  '每条引用都与它所在的句子有交集',
);
ok(V.sentences[0].refs.length === 3, '第一句上三种身份都在', `实际 ${V.sentences[0].refs.length}`);
ok(V.sentences[2].quiet, '第三句标成没人提');
ok(
  V.sentences.every((s) => s.quiet === (s.refs.length === 0)),
  'quiet 与 refs 严格互斥',
);
ok(V.quietCount === V.sentences.filter((s) => s.quiet).length, 'quietCount 与实际句数一致');
ok(V.refCount === V.sentences.reduce((n, s) => n + s.refs.length, 0), 'refCount 与实际引用数一致');

/** 同一句上「命名」与「此处合法」并存——合并掉一个就是替用户下了判定。 */
const kindsOnFirst = V.sentences[0].refs.map((r) => r.kind).sort().join(',');
ok(kindsOnFirst === 'claim,label,legit', '命名与此处合法没有被合并', kindsOnFirst);
ok(
  V.sentences[0].refs.some((r) => r.kind === 'legit' && r.text === '这一处只是报告了时间上的先后'),
  '此处合法这一栏确实出现在原文旁边',
);

/* 一条跨句的引用要在两句上各出现一次，不能只挑一句。 */
const across = sample({
  conclusion: withSpan(claim('C', 'conclusion', '取消早读是错的'), {
    start: S1.length - 2,
    end: S1.length + 3,
    quote: '下降。所以',
    quality: 'exact',
  }),
});
const va = rereadOf(across);
ok(
  va.sentences[0].refs.some((r) => r.id === 'C') && va.sentences[1].refs.some((r) => r.id === 'C'),
  '跨句引用在两句上都出现',
);

/* 各类「没位置」都要明说，且理由落在闭集里。 */
const bads: { name: string; d: Diagnosis; reason: string; kind: RereadKind; id: string }[] = [
  {
    name: 'span 越界',
    d: sample({ labels: [labelItem({ span: { start: 999, end: 1005, quote: '没有', quality: 'exact' } })] }),
    reason: 'span-out-of-range',
    kind: 'label',
    id: 'post-hoc',
  },
  {
    name: 'span 没对上',
    d: sample({ labels: [labelItem({ span: { start: 0, end: 4, quote: '取消早读', quality: 'failed' } })] }),
    reason: 'span-failed',
    kind: 'label',
    id: 'post-hoc',
  },
  {
    name: '压根没给 span',
    d: sample({ labels: [labelItem({ span: null })] }),
    reason: 'no-span',
    kind: 'label',
    id: 'post-hoc',
  },
  {
    name: '引文找不到',
    d: sample({
      legitimateMoves: [
        { targetId: 'P1', quote: '原文里没有这半句', what: '甲', why: '乙', tag: 'argued', confidence: 'medium' },
      ],
    }),
    reason: 'quote-not-found',
    kind: 'legit',
    id: 'P1',
  },
  {
    name: '引文出现两次',
    d: sample({
      legitimateMoves: [
        { targetId: 'P1', quote: '早读', what: '甲', why: '乙', tag: 'argued', confidence: 'medium' },
      ],
    }),
    reason: 'quote-ambiguous',
    kind: 'legit',
    id: 'P1',
  },
];
for (const b of bads) {
  const v = rereadOf(b.d);
  ok(v.unplaced.some((u) => u.reason === b.reason), `${b.name} 被明说而不是静默丢掉`, JSON.stringify(v.unplaced));
  /*
   * 两个方向都要验：光验「进了 unplaced」，改坏的代码仍可能把它同时挂到某句上。
   * 按 kind + id 认那一条坏条目，不按 reason——RereadRef 里没有 reason 字段，
   * 写 r.reason === undefined 是恒真断言，比不写更糟。
   */
  ok(
    !v.sentences.some((s) => s.refs.some((r) => r.kind === b.kind && r.id === b.id)),
    `${b.name} 的条目没有被猜着挂到某句上`,
  );
}
ok(
  V.unplaced.every((u) => u.reason in UNPLACED_LABEL) &&
    bads.every((b) => rereadOf(b.d).unplaced.every((u) => u.reason in UNPLACED_LABEL)),
  '未定位理由都在标签闭集里',
);

/* ── 四、最关键：本地没有写下一个字的判断 ─────────────────────── */
/**
 * 这一条对应 97.4% 那个实测。若有人在界面或内核里加一句「本地认为……」，
 * 它必须红——否则这一屏又变成模型（或本地）替读者把话说了。
 */
ok(
  V.sentences.every((s) => s.refs.every((r) => serialized.includes(r.text))),
  '每条引用的正文逐字来自报告',
  JSON.stringify(V.sentences.flatMap((s) => s.refs.filter((r) => !serialized.includes(r.text)))),
);
ok(
  V.sentences.every((s) => s.refs.every((r) => r.quote === null || serialized.includes(r.quote))),
  '每条引用的原文引句逐字来自报告',
);
ok(
  Object.keys(REREAD_KIND_LABEL).length === 3 && Object.values(REREAD_KIND_LABEL).every((x) => x.length > 0),
  '三种身份都有显示用的标签',
);

/* 没有任何指代条目的报告：全部句子都该是 quiet，而不是拿别的东西填满。 */
const bare = rereadOf(sample({ labels: [], legitimateMoves: [], premises: [], conclusion: withSpan(claim('C', 'conclusion', '取消早读是错的'), null) }));
ok(bare.refCount === 0 && bare.quietCount === bare.sentences.length, '没有条目时所有句子都标成没人提');
ok(bare.unplaced.length === 1 && bare.unplaced[0].reason === 'no-span', '连一条没有位置的结论也要明说');

/* ── 汇总（verify 只取最后一行，所以汇总必须放最后） ───────────── */
if (failed.length) {
  console.error(`✗ check:reread 红了 ${failed.length} 处（通过 ${passed} 条）\n`);
  for (const f of failed) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`✓ check:reread 通过 ${passed} 条｜原文逐字还原、引用不越界、展示文字逐字来自报告`);
