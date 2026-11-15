/**
 * 「两份对照」的断言：同一段字跑两遍，两份报告哪几处不一样、两边各写了什么。
 *
 * 为什么值得单开一条检查：这一层输出的每一个字都会被当成「差异」读。
 * 它出错的四种方式，每一种都不会抛异常：
 *   1. **按下标对齐**：模型把检查项换个顺序，整段红成一片假差异，
 *      而读的人只会得出「模型很不稳定」——那是对齐方式的错，不是报告的错。
 *   2. **把「缺失」并进「不同」**：旧存档没有 `engine` 那一栏，混进去就变成
 *      「改过」，而它其实是「当时没记」。
 *   3. **把相同的也说成不同**（或反过来）：分母藏起来时，读者无法判断
 *      「3 处不同」是 300 个字段里的 3 处，还是 3 个字段里的 3 处。
 *   4. **两份读不出来却给一张空表**：0 行的表会被读成「完全一样」。
 *
 * 防恒真写在样本里，不写在注释里：
 *   - 「按 id 对齐」配一份**同样内容、顺序不同**的样本，结果必须是 0 处；
 *     同一份样本再用「按下标」算一遍，必须不是 0——否则这条断言在
 *     「根本没有对齐逻辑」时也绿。
 *   - 「只列不一样的」配一份**逐字相同**的样本（0 行）与一份改了三个字的样本
 *     （1 行），两个结果必须不同。
 *   - 「缺失与不同分开」配一份**两边都有但取值不同**的样本，onlyLeft 必须还是 0。
 *
 * 跑法：npm run check:sideby
 */
import { normalizeDiagnosis } from '../src/main/analyze';
import type { CheckItem, Claim, Conclusion, Diagnosis, Refutation, Scope } from '@shared/types';
import {
  FIELD_LABEL,
  SECTION_ORDER,
  SIDE_MAX_VALUE,
  engineText,
  rowLabel,
  samenessNote,
  sideBySide,
  sideFlat,
  sidebyLine,
  sidebyText,
  sizeText,
} from '@shared/sideby';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}

/* ─────────── 样本 ─────────── */

const P = '我们学校去年取消了早读，今年高考一本率下降了六个百分点。这说明取消早读是错的。';

const ACC = { status: 'acceptable' as const, reason: '' };
const claim = (id: string, role: Claim['role'], text: string, supports: string[] = []): Claim => ({
  id,
  role,
  text,
  supports,
  quote: null,
  span: null,
  implicit: false,
  implicitBasis: null,
  burden: 'proponent',
  acceptability: ACC,
});
const conclusion = (id: string, text: string): Conclusion => ({
  ...claim(id, 'conclusion', text),
  modalOverreach: false,
  modalNote: '',
});
const ref = (id: string, targetId: string, strategy: Refutation['strategy'], checkId: string | null = null): Refutation => ({
  id,
  targetId,
  checkId,
  strategy,
  claim: '这一条打的是某个位置',
  script: '话术',
  steelman: '对方会回',
  reply: '我方接法',
  evidenceNeeded: [],
  burdenAfter: 'proponent',
  tag: 'inferred',
  confidence: 'medium',
});
const item = (id: string, answer: CheckItem['answer'] = 'answered'): CheckItem => ({
  id,
  system: 'walton-cq',
  label: `第 ${id} 条`,
  question: '这一关问什么',
  meta: false,
  answer,
  basis: '依据',
  guards: '守着某处',
  landsOn: null,
});

const base = normalizeDiagnosis({}, P, 'walton', { mode: 'diagnose', id: 'a1', createdAt: 1000 });
/* 指纹要造出来：真实报告都带 `prompt`，没有它的样本会让「四项全同」永远假红 */
const withPrompt = (d: Diagnosis, fp = 'fp-test'): Diagnosis => ({ ...d, prompt: { version: '2.5.0', fingerprint: fp } });

/**
 * 甲的样本：四样都齐（前提、结论、检查项、反驳、修补）。
 *
 * `id` / `createdAt` 会被换掉——两份报告的身份必然不同，它不能算差异。
 */
const A: Diagnosis = withPrompt({
  ...base,
  premises: [claim('P1', 'premise', '去年取消了早读', ['C']), claim('P2', 'premise', '今年一本率下降六点', ['C'])],
  conclusion: conclusion('C', '取消早读是错的'),
  checks: [item('CQ1'), item('CQ2'), item('CQ3', 'unanswered')],
  scope: { applicable: true, reason: '是论证', outOfScopeAt: null, partialNote: null } as Scope,
  refutations: [ref('R1', 'P1', 'premise-unsupported'), ref('R2', 'C', 'alternative-explanation', 'CQ1')],
  repair: {
    missingPremise: '若取消早读，则一本率会下降',
    alternativeReading: null,
    answerable: ['同期有没有别的教学安排变动'],
    burdenStatus: '在提议者',
    repairedForm: 'P1；P2；若取消早读则一本率下降 ∴ C',
  },
});

/** 乙：与甲逐字相同，只换了身份。这是「跑两遍完全一样」那一档。 */
const B_SAME: Diagnosis = { ...A, id: 'b1', createdAt: 2000 };

/** 乙：只改了一句前提里的三个字。这是「改了，但只改了一点」那一档。 */
const B_ONE_WORD: Diagnosis = {
  ...A,
  id: 'b2',
  createdAt: 3000,
  premises: [
    claim('P1', 'premise', '去年取消了早读', ['C']),
    claim('P2', 'premise', '今年一本率下降七个点', ['C']),
  ],
};

/** 乙：数组顺序整个反过来，内容一个字没变。按 id 对齐时它必须等于「完全一样」。 */
const B_REORDER: Diagnosis = {
  ...A,
  id: 'b3',
  createdAt: 4000,
  checks: [item('CQ3', 'unanswered'), item('CQ2'), item('CQ1')],
  refutations: [ref('R2', 'C', 'alternative-explanation', 'CQ1'), ref('R1', 'P1', 'premise-unsupported')],
};

/** 乙：多了一个检查项、少了一条反驳。这是「缺失」那一档，不是「改过」。 */
const B_ADDED: Diagnosis = {
  ...A,
  id: 'b4',
  createdAt: 5000,
  checks: [item('CQ1'), item('CQ2'), item('CQ3', 'unanswered'), item('CQ4')],
  refutations: [ref('R1', 'P1', 'premise-unsupported')],
};

/** 乙：换了透镜，其余照旧。 */
const B_OTHER_LENS: Diagnosis = { ...A, id: 'b5', createdAt: 6000, theory: 'pragma' };

/** 乙：原文完全不是同一段。 */
const B_OTHER_TEXT: Diagnosis = { ...A, id: 'b6', createdAt: 7000, passage: '另一段完全不同的文字，长度也不同。' };

/** 乙：超长取值，验证截断与「原长度」那一栏。 */
const LONG = '长'.repeat(SIDE_MAX_VALUE + 30);
const B_LONG: Diagnosis = {
  ...A,
  id: 'b7',
  createdAt: 8000,
  repair: { ...A.repair, missingPremise: LONG },
};

/* 没有 id 的元素：只有这一类才允许按位置对齐。 */
const B_NOID: Diagnosis = {
  ...A,
  id: 'b8',
  createdAt: 9000,
  premises: [
    { ...claim('P1', 'premise', '去年取消了早读', ['C']), id: '' },
    { ...claim('P2', 'premise', '今年一本率下降六点', ['C']), id: '' },
  ],
};

/*
 * 乙没有提示词指纹（旧存档）。
 *
 * 加这个样本是被反证逼出来的：原先所有样本都带同一个指纹，
 * 于是把「四项」那条判成 `fingerprint: true`（永远说「同一版」）也照样全绿——
 * 断言在**所有样本都相同**的时候是恒真的。
 */
const B_NOFP: Diagnosis = { ...A, id: 'b12', createdAt: 9300, prompt: undefined };

/*
 * 一份多区段、处数不均的样本：结论 1 处、检查项 3 处。
 *
 * 加它的理由同样是反证：原来用的是「只改一句话」那一份，整张表只有一个区段，
 * 于是「区段按报告的读法排、不按差得多排」在任何排序实现下都成立（只有一段，怎么排都一样）。
 * 现在必须是「结论」在前、「检查项」在后——按行数排会把它翻过来。
 */
const B_MULTI: Diagnosis = {
  ...A,
  id: 'b13',
  createdAt: 9400,
  conclusion: conclusion('C', '取消早读这件事是错的'),
  checks: [item('CQ1', 'violated'), item('CQ2', 'violated'), item('CQ3')],
};

/** 有一份根本不是报告。它必须返回 null，而不是一张 0 行的表。 */
const BROKEN = null as unknown as Diagnosis;

/* ─────────── 对照组守卫 ─────────── */

/*
 * 样本坏了要**先说出来再退**。
 *
 * 上一轮（`check:prg`）学到的那条：一个构造失败的样本会让一组断言「全部未命中」，
 * 而那种输出读起来像「这些断言不可信」——实际是样本不可信。崩掉和失效长得一样，
 * 所以这里先点名，再 exit 1。
 */
const samplesOk =
  A.premises.length === 2 &&
  A.checks.length === 3 &&
  A.refutations.length === 2 &&
  B_SAME.premises.length === 2 &&
  B_REORDER.checks[0].id === 'CQ3' &&
  A.passage === B_SAME.passage &&
  A.passage !== B_OTHER_TEXT.passage;
if (!samplesOk) {
  console.log('✗ 对照组本身不成立：样本没造好，下面的断言一条都不能信。');
  process.exit(1);
}

/* ─────────── 一、对齐方式 ─────────── */

const same = sideBySide(A, B_SAME)!;
ok(same.rows.length === 0, '逐字相同的两份：一处差异都没有', `实际 ${same.rows.length} 处`);
ok(same.equal === same.fields, '逐字相同的两份：比到的字段全部计入「一样」', `${same.equal}/${same.fields}`);
ok(same.fields > 20, '分母不是个位数（样本确实摊开了）', String(same.fields));

/*
 * 人填的 v1.1 分歧账属于输入，不是模型产物。第二遍才补填它时，
 * 那份账会摊出十几个 `divergence.*` 路径；把它们列进「其他」差异，
 * 读的人只会以为是模型这次写得不一样。包内自检真撞上过这一处。
 */
const B_HUMAN: Diagnosis = {
  ...A,
  divergence: {
    frame: { formal: 'classical', criterion: 'scheme-cq', dimension: 'dialectic', protocol: 'inquiry' },
    closure: 'fork', branches: 2, entries: [], common: '', difference: '',
    condition: '给出出处只剩宽读', basis: '两读各自未过的 CQ', decidable: '', burden: '', at: 2,
  } as NonNullable<Diagnosis['divergence']>,
};
const human = sideBySide(A, B_HUMAN)!;
ok(human.rows.length === 0, '只补填了分歧账：两份对照一处差异都没有（人填的账属于输入）', `实际 ${human.rows.length} 处`);
ok(!JSON.stringify(human.rows).includes('divergence'), '差异表里不出现 divergence.* 路径');

const reorder = sideBySide(A, B_REORDER)!;
ok(
  reorder.rows.length === 0,
  '数组换了顺序、内容没变：按 id 对齐时仍是 0 处差异',
  `实际 ${reorder.rows.length} 处：${reorder.rows.slice(0, 3).map((r) => r.path).join('、')}`,
);

/*
 * 对照组：同一份样本按**下标**对齐，必须能数出差异来。
 *
 * 缺了这一条，「按 id 对齐」的断言在「压根没有对齐逻辑」时也是绿的——
 * 因为这个样本在两种实现下都可能碰巧给出 0。有了它，样本才被证明「能区分」。
 */
function byIndex(d: Diagnosis): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const walk = (v: unknown, path: string): void => {
    if (v === null || typeof v !== 'object') {
      out.set(path, v);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
      return;
    }
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) walk(val, path === '' ? k : `${path}.${k}`);
  };
  const { id: _i, createdAt: _c, ...rest } = d as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(rest)) walk(v, k);
  return out;
}
const ia = byIndex(A);
const ib = byIndex(B_REORDER);
let indexDiff = 0;
for (const p of new Set([...ia.keys(), ...ib.keys()])) {
  if (JSON.stringify(ia.get(p)) !== JSON.stringify(ib.get(p))) indexDiff += 1;
}
ok(indexDiff > 0, '对照：同一样本按下标对齐会数出差异（说明这个样本能区分两种对齐）', String(indexDiff));

const noId = sideBySide(A, B_NOID)!;
/*
 * 这一条第一版只看了「乙侧」的路径就写完了：`!includes('premises[') || includes('#')`。
 * 表里同时有甲侧（`premises[P1]`）与乙侧（`premises[#0]`）两类路径，
 * 甲侧那条既不是「不含 premises[」也不含 `#`，于是它本该红——但当时样本里
 * 甲侧路径恰好被 `slice(0,2)` 截掉了，断言就绿了。**方向只盖住一半，等于没盖。**
 * 现在的写法两边一起看：位置键必须出现，且不许出现裸下标。
 */
ok(
  noId.rows.some((r) => r.path.includes('[#0]')),
  '没有 id 的元素按位置对齐，键是 #0 这种形式（不冒充成有编号）',
  noId.rows.slice(0, 3).map((r) => r.path).join('、'),
);
ok(
  !noId.rows.some((r) => /\[\d+\]/.test(r.path)),
  '位置键带 #，不是裸下标——裸下标与「第 0 个元素」看起来一样，分不清是有意对齐还是碰巧',
  noId.rows.filter((r) => /\[\d+\]/.test(r.path)).slice(0, 3).map((r) => r.path).join('、'),
);

/* ─────────── 二、缺失与不同分开 ─────────── */

const added = sideBySide(A, B_ADDED)!;
ok(added.onlyRight > 0, '乙多出来的字段计入「乙有甲没有」', String(added.onlyRight));
ok(added.onlyLeft > 0, '乙少掉的那条反驳计入「甲有乙没有」', String(added.onlyLeft));
ok(
  added.rows.some((r) => r.kind === 'only-right') && added.rows.some((r) => r.kind === 'only-left'),
  '两种缺失在行上各自有标记，没有混成一种',
);
ok(
  added.rows.every((r) => (r.kind === 'changed') === (r.left !== '（这份里没有这一栏）' && r.right !== '（这份里没有这一栏）')),
  '缺失的那一侧写的是「这份里没有这一栏」，不是空串（空串会被读成「没有内容」）',
);
ok(
  added.rows.length + added.equal === added.fields,
  '不变式：不一样的行数 + 一样字段数 = 比到的字段数（分母不会凭空变大）',
  `${added.rows.length}+${added.equal} vs ${added.fields}`,
);

const one = sideBySide(A, B_ONE_WORD)!;
ok(one.rows.length === 1, '只改了一句话里的三个字：恰好 1 处差异', `实际 ${one.rows.length} 处`);
ok(one.onlyLeft === 0 && one.onlyRight === 0, '两边都有的字段变了，不该被算成「缺失」', `${one.onlyLeft}/${one.onlyRight}`);
ok(one.rows[0]?.kind === 'changed', '那一处的类型是「改过」');
ok(
  one.rows[0]?.left.includes('六点') && one.rows[0]?.right.includes('七个点'),
  '那一行带着两边的原文，不是只说「有一处不同」',
  `${one.rows[0]?.left} / ${one.rows[0]?.right}`,
);

/* ─────────── 三、四项相同与否，各自说 ─────────── */

ok(same.same.passage && same.same.theory && same.same.mode && same.same.fingerprint, '逐字相同的两份：四项全同');
ok(samenessNote(same) === null, '四项全同时不啰嗦（没有「注意」那一行）');

const otherLens = sideBySide(A, B_OTHER_LENS)!;
ok(!otherLens.same.theory, '换了透镜：那一项被认出来不同');
ok(otherLens.same.passage, '换了透镜：原文那一项仍然是「同」——四项各自独立，不连坐');
ok((samenessNote(otherLens) ?? '').includes('透镜'), '提醒里点名是透镜不同', samenessNote(otherLens) ?? '（没有提醒）');

const noFp = sideBySide(A, B_NOFP)!;
ok(!noFp.same.fingerprint, '一边没有提示词指纹：这一项必须是「不同」，不能默认成同一版');
ok((samenessNote(noFp) ?? '').includes('提示词'), '提醒里点名是提示词版本不同', samenessNote(noFp) ?? '（没有提醒）');
ok(noFp.same.passage && noFp.same.theory && noFp.same.mode, '只有指纹那一项不同时，其余三项仍是「同」（不连坐）');

const otherText = sideBySide(A, B_OTHER_TEXT)!;
ok(!otherText.same.passage, '换了原文：那一项被认出来不同');
ok((samenessNote(otherText) ?? '').includes('原文'), '提醒里点名是原文不同', samenessNote(otherText) ?? '（没有提醒）');
ok(
  (samenessNote(otherText) ?? '').includes('不只是'),
  '原文不同时的提醒说明「这张表不只是同一个输入跑两遍的差异」（不留给读者自己推断）',
);

/* ─────────── 四、谁跑的 ─────────── */

ok(engineText(A).includes('没记'), '没记模型的两份：照实说没记，不补一个假模型名', engineText(A));
const A_ENGINE: Diagnosis = { ...A, engine: { model: 'gpt-x', host: 'api.example.com', temperature: 0.3 } };
const B_ENGINE: Diagnosis = { ...A, id: 'b9', createdAt: 6100, engine: { model: 'gpt-y', host: 'api.example.com', temperature: 0.7 } };
ok(engineText(sideBySide(A_ENGINE, B_ENGINE)!.a).includes('gpt-x'), '记了模型的两份：甲写自己的模型名');
ok(engineText(sideBySide(A_ENGINE, B_ENGINE)!.b).includes('gpt-y'), '乙写自己的模型名（两份分别列，不合并）');
ok(
  engineText(sideBySide(A_ENGINE, B_ENGINE)!.b).includes('0.7'),
  '温度按执行时的值写出来',
);
/** 半条记录不算：有模型没温度，与「没记」同样处理。 */
const HALF: Diagnosis = { ...A, engine: { model: 'gpt-x', host: 'h' } as never };
ok(engineText(sideBySide(HALF, B_ENGINE)!.a).includes('没记'), '半条引擎记录按「没记」处理（不让读的人以为温度也是同一个）');

/* ─────────── 五、长值与份量 ─────────── */

const long = sideBySide(A, B_LONG)!;
const longRow = long.rows.find((r) => r.right.length === SIDE_MAX_VALUE);
ok(!!longRow, '超长取值被截到上限', String(longRow?.right.length));
ok(longRow?.rightLen === LONG.length, '被截断时记下原长度（界面上写得出「共 N 字」）', String(longRow?.rightLen));
ok(sizeText(long).includes('字'), '份量说的是「字」，不是「KB」——汉字一个字三个字节，混着写会读错', sizeText(long));

/*
 * 三种「没有」的写法。这一条是被截图抓出来的：`missingPremise: null` 那一行
 * 在界面上印成了英文的 `null`——它既不是「这份里没有这一栏」，也不是空串，
 * 读的人只会以为哪里坏了。
 */
const NULLED: Diagnosis = { ...A, id: 'b10', createdAt: 9100, repair: { ...A.repair, missingPremise: null } };
const nullRow = sideBySide(A, NULLED)!.rows.find((r) => r.path === 'repair.missingPremise');
ok(!!nullRow, '把前提改成一个空值：仍然算「两边都有」，不是「缺失」', nullRow?.kind);
ok(nullRow?.right === '（空值）', '空值写成「空值」，不印出英文的 null', String(nullRow?.right));
ok(!JSON.stringify(sideBySide(A, NULLED)!.rows).includes('"null"'), '整张表里不出现英文 null 字样');

const EMPTIED: Diagnosis = { ...A, id: 'b11', createdAt: 9200, repair: { ...A.repair, missingPremise: '' } };
const emptyRow = sideBySide(A, EMPTIED)!.rows.find((r) => r.path === 'repair.missingPremise');
ok(emptyRow?.right === '（空字符串）', '空字符串与空值分开写（两者含义不同）', String(emptyRow?.right));

/* ─────────── 六、标签与归段 ─────────── */

ok(rowLabel('checks[CQ2].answer') === '检查项 CQ2 · 答案', '路径被翻成人话：检查项 CQ2 · 答案', rowLabel('checks[CQ2].answer'));
ok(rowLabel('verdict.level') === '评级 · 档位', '非数组路径也翻：评级 · 档位', rowLabel('verdict.level'));
ok(rowLabel('refutations[R1].steelman') === '反驳 R1 · 对方最可能的反击', '长字段名也翻', rowLabel('refutations[R1].steelman'));
ok(rowLabel('somethingNew.body') !== '', '不认识的字段退化成原名而不是空串（空标签让人不知道在看什么）', rowLabel('somethingNew.body'));

const topKeys = new Set([...sideFlat(A).keys()].map((p) => p.split(/[.[]/)[0]));
const known = new Set(SECTION_ORDER.filter((s) => s.key !== '').map((s) => s.key));
const unclassified = [...topKeys].filter((k) => !known.has(k));
ok(unclassified.length === 0, '报告里的每个顶层字段都归到了某一段（不许掉进「其他」）', unclassified.join('、'));

const leafFields = new Set<string>();
for (const p of sideFlat(A).keys()) {
  const segs = p.split('.').slice(1);
  for (const s of segs) {
    /*
     * 字段名里可以有数字与下划线（`P1_source` 是 EPI 的第 1 项）。
     * 第一版写成 `^([A-Za-z]+)`，它把 `P1_source` 截成 `P`——于是报「缺标签」，
     * 而其实缺的是这条正则。**判据自己错了的时候，输出看起来和代码错了一样。**
     */
    const m = /^([A-Za-z][A-Za-z0-9_]*)/.exec(s.replace(/\[[^\]]*\]/g, ''));
    if (m) leafFields.add(m[1]);
  }
}
const noLabel = [...leafFields].filter((f) => !(f in FIELD_LABEL));
ok(noLabel.length === 0, '报告里出现的每个字段名都有人话标签（否则界面会露出英文单词）', noLabel.join('、'));

/* ─────────── 七、区段顺序 ─────────── */

const reordered = sideBySide(A, B_MULTI)!;
ok(
  reordered.sections.length >= 2 && reordered.sections[0].id === 'conclusion',
  '区段按报告的读法排序，不按「差得多」排序（结论在前，哪怕检查项那一栏处的数更多）',
  reordered.sections.map((sec) => `${sec.id}:${sec.rows}`).join(','),
);
ok(
  (reordered.sections.find((sec) => sec.id === 'checks')?.rows ?? 0) >
    (reordered.sections.find((sec) => sec.id === 'conclusion')?.rows ?? 0),
  '这个样本本身满足「行数多的那一段不在前面」（否则上一条是恒真的）',
  reordered.sections.map((sec) => `${sec.id}:${sec.rows}`).join(','),
);
ok(
  reordered.sections.reduce((n, s) => n + s.rows, 0) === reordered.rows.length,
  '每个区段的行数加起来等于总行数（没有行落在段外）',
);
const secIds = SECTION_ORDER.map((s) => s.id);
const sorted = reordered.sections.every((s, i) => i === 0 || secIds.indexOf(s.id) > secIds.indexOf(reordered.sections[i - 1].id));
ok(sorted, '区段顺序与 SECTION_ORDER 一致（不再另排一次）', reordered.sections.map((s) => s.id).join(','));

/* ─────────── 八、读不出来时不许给空表 ─────────── */

ok(sideBySide(BROKEN, A) === null, '有一份不是报告：返回 null，而不是一张 0 行的表（0 行会被读成「完全一样」）');
ok(sideBySide(A, undefined as unknown as Diagnosis) === null, '另一侧缺失时同样返回 null');

/* ─────────── 九、文案 ─────────── */

const line = sidebyLine(one);
/*
 * 逐字核整句，而不是「包含某个数字」。
 *
 * 第一版写的是 `line.includes(String(one.fields))`——分母只有两位数时，
 * 「1」在句子里到处都是，把分母改成「一样字段数」也照样命中（反证抓到的）。
 * 现在的写法把三个数钉在一次匹配里，少一个、换一个都会红。
 */
const lineRe = new RegExp(
  `逐路径比了 ${one.fields} 个字段：${one.equal} 个逐字一样，${one.rows.length} 个不一样`,
);
ok(lineRe.test(line), '总述那一句逐字写着三个数（分母 / 一样 / 不一样）', line);
ok(one.fields > one.equal && one.equal > 0, '样本满足「分母大于一样数」（否则上面那条在把分母算错时也可能过）', `${one.fields}/${one.equal}`);
ok(!/(稳定|不可靠|更好|更差|准确)/.test(line + sidebyText(one, () => '时间')), '总述与导出里没有一个评价词');
ok(sidebyLine(same).includes('逐字相同'), '完全一样时说的是「逐字相同」，不是「没有差异可报告」');
const text = sidebyText(one, () => '时间');
ok(text.includes('甲：') && text.includes('乙：'), '导出里两份分别列');
ok(text.includes('六点') && text.includes('七个点'), '导出里带着两边的取值');
ok(text.includes('只列不一样的'), '导出末尾说明这张表只列不一样的');
ok(text.includes('不说哪一份更对'), '导出末尾说明它不评哪一份更对');

/* ─────────── 结果 ─────────── */

if (failed.length) {
  console.log(`✗ check:sideby 失败 ${failed.length} 条（通过 ${passed} 条）`);
  for (const f of failed) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`✓ check:sideby 通过 ${passed} 条`);
