/**
 * 「口气复核」的断言：本地拿原文那一句，核报告那一句。
 *
 * 这一层最坏的坏法不是抛异常，是**说得太勤**：一个到处报「报告比原文硬」的检查器，
 * 会让人连真的越界也不信。所以断言的重点不是「四种差别都能被抓到」，
 * 是「不该说话的时候闭嘴」——字面一致时说一致，读不到时说读不到。
 *
 * 恒真防护写在样本里：
 *   - 长词优先配「不一定」：若先扫短词，同一句话会同时读出软化词与硬化词，
 *     判定直接反过来。这条只能靠跨表共用占位才成立，所以单独断言 `readAll`。
 *   - 「一处差别」不写在只有一处差别的样本上：另配一个同时踩到软化词与推论词的样本，
 *     必须数出两处——否则「只取第一个」的实现也绿。
 *   - 「不改报告」用深比：比一份改过的报告与它自己的副本，字段一个都不能变。
 *
 * 跑法：npm run check:modal
 */
import type { Conclusion, Diagnosis } from '@shared/types';
import { WORD_LISTS, crossNote, hitsOf, readAll, sourceSentence, toneAudit } from '@shared/modal';

let passed = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}

/* ─────────── 样本 ─────────── */

function concl(c: Partial<Conclusion>): Conclusion {
  return {
    id: 'C',
    role: 'conclusion',
    text: '',
    supports: [],
    quote: null,
    span: null,
    implicit: false,
    implicitBasis: null,
    burden: 'proponent',
    acceptability: { status: 'acceptable', reason: '', forAudience: '', tag: 'stated', confidence: 'high' },
    modalOverreach: false,
    modalNote: '',
    ...c,
  };
}

function diag(passage: string, conclusion: Conclusion): Pick<Diagnosis, 'passage' | 'conclusion'> {
  return { passage, conclusion };
}

/* 1) 软化词被抹掉 */
const HEDGE = diag('降低作业量可能会提高睡眠质量。', concl({
  quote: '降低作业量可能会提高睡眠质量',
  text: '降低作业量能提高睡眠质量',
}));

/* 2) 报告加了硬化词 */
const HARDEN = diag('他这学期迟到了三次。', concl({
  quote: '他这学期迟到了三次',
  text: '他必然会迟到',
}));

/* 3) 原文只写并存，报告接成因果 */
const CAUSAL_ADD = diag('取消早读之后，一本率下降了。', concl({
  quote: '取消早读之后，一本率下降了',
  text: '取消早读因此导致一本率下降',
}));

/* 4) 原文是推论口气，报告写成断言 */
const CAUSAL_DROP = diag('这说明取消早读是错的。', concl({
  quote: '这说明取消早读是错的',
  text: '取消早读是错误决定',
}));

/* 5) 两边都对得上 */
const CONSISTENT = diag('这项政策可能会推高成本。', concl({
  quote: '这项政策可能会推高成本',
  text: '这项政策可能会增加成本',
}));

/* 6) 逐字相同 */
const SAME = diag('取消早读是错误决定。', concl({
  quote: '取消早读是错误决定',
  text: '取消早读是错误决定',
}));

/* 7) 报告没给引文，本地从全文里找出最像的一句 */
const FIND = diag('第一句说的是别的事。取消早读可能影响睡眠。第三句也不相干。', concl({
  quote: null,
  text: '取消早读影响睡眠',
}));

/* 8) 全文里也找不到 */
const NOSRC = diag('完全无关的一段话。', concl({
  quote: null,
  text: '关于火星殖民的判断',
}));

/* 9) 一处报告里同时踩两个维度 */
const TWO = diag('调整作息可能会因此让成绩下降。', concl({
  quote: '调整作息可能会因此让成绩下降',
  text: '成绩下降了',
}));

/* 10) 报告说越界了，但本地在字面上没读到差别 */
const REPORTED_ONLY = diag('这项政策可能会推高成本。', concl({
  quote: '这项政策可能会推高成本',
  text: '这项政策可能会增加成本',
  modalOverreach: true,
  modalNote: '把可能性写成了结论',
}));

/* ─────────── 词表 ─────────── */

ok(WORD_LISTS.HEDGES.every((w) => w.length > 0), '软化词表里没有空串（空串会无限命中）');
ok(WORD_LISTS.HARD.every((w) => w.length > 0), '硬化词表里没有空串');
ok(WORD_LISTS.CAUSAL.every((w) => w.length > 0), '因果词表里没有空串');
ok(WORD_LISTS.COOCCUR.every((w) => w.length > 0), '并存词表里没有空串');

const setOf = (xs: readonly string[]) => new Set(xs);
const cross = (a: readonly string[], b: readonly string[]) => [...setOf(a)].filter((w) => setOf(b).has(w));
ok(!cross(WORD_LISTS.HEDGES, WORD_LISTS.HARD).length, '软化词与硬化词没有交集（同一张表管两件事会自相矛盾）',
  cross(WORD_LISTS.HEDGES, WORD_LISTS.HARD).join('/'));
ok(!cross(WORD_LISTS.HEDGES, WORD_LISTS.CAUSAL).length, '软化词与因果词没有交集');
ok(!cross(WORD_LISTS.COOCCUR, WORD_LISTS.CAUSAL).length, '并存词与因果词没有交集（两类必须能分开读）');

/* ─────────── 读词 ─────────── */

const r1 = readAll('不一定');
ok(r1.hedges.length === 1 && r1.hedges[0].word === '不一定', '「不一定」读成软化词', JSON.stringify(r1.hedges));
ok(r1.hard.length === 0, '「不一定」里的「一定」不算硬化词（长词优先，跨表共用占位）', JSON.stringify(r1.hard));

const r2 = readAll('他一定要来');
ok(r2.hard.length === 1 && r2.hard[0].word === '一定', '单独出现的「一定」照常读成硬化词', JSON.stringify(r2.hard));
ok(r2.hedges.length === 0, '「一定」不会被读成软化词');

const r3 = readAll('可能会晚，可能不会');
ok(r3.hedges.length === 2, '同一个词出现两次就数两次（不是只取第一处）', String(r3.hedges.length));

const r4 = readAll('同期之后，因此说明');
ok(r4.cooccur.length === 2 && r4.causal.length === 2, '并存词与因果词在同一句里各读各的',
  `co=${r4.cooccur.length} ca=${r4.causal.length}`);

const r5 = readAll('它显然完全是对的');
ok(r5.hard.some((h) => h.word === '显然'), '硬化词在句中被读到');
ok(r5.hard.every((h, i, a) => i === 0 || a[i - 1].at <= h.at), '命中按出现位置排序');

const single = hitsOf('不一定', WORD_LISTS.HARD);
ok(single.length === 1, '单独拿硬化表扫「不一定」会命中「一定」——所以跨类别的判断必须走 readAll（这条守的是那次设计决定）');

/* ─────────── 找原文那一句 ─────────── */

const s1 = sourceSentence(HEDGE);
ok(s1.from === 'quote' && s1.text === '降低作业量可能会提高睡眠质量', '报告给了引文就直接用引文', JSON.stringify(s1));
const s2 = sourceSentence(FIND);
ok(s2.from === 'passage' && !!s2.text && s2.text.indexOf('取消早读可能影响睡眠') >= 0,
  '没有引文时从全文里找出最接近的一句，并标明这是找来的', JSON.stringify(s2));
const s3 = sourceSentence(NOSRC);
ok(s3.from === 'none' && s3.text === null, '全文里找不到就说找不到，不拿第一句凑数', JSON.stringify(s3));

/*
 * 阈值两侧的样本：两句只差几个字，一句在阈值上（8 个字里对上 6 个），
 * 一句在阈值下（10 个字里只对上 4 个——「取消早读」之后全是新字）。
 * 拿两个完全不同的样本来验阈值，等于没验：它们本来就一个是 1.0、一个是 0.0。
 */
const BORDER = '取消早读可能影响睡眠质量。';
const bMid = sourceSentence(diag(BORDER, concl({ quote: null, text: '取消早读影响成绩' })));
ok(bMid.from === 'passage', '大半的字对得上 → 认作出处', JSON.stringify(bMid));
const bLow = sourceSentence(diag(BORDER, concl({ quote: null, text: '取消早读提高成绩排名' })));
ok(bLow.from === 'none', '不到一半的字对得上 → 不认作出处（阈值真的在起作用）', JSON.stringify(bLow));

/* ─────────── 四种差别各说各的 ─────────── */

const aHedge = toneAudit(HEDGE);
ok(aHedge.verdict === 'differs', '软化词被抹掉 → 判为有差别');
ok(aHedge.diffs.length === 1 && aHedge.diffs[0].kind === 'hedge-dropped', '差别的种类是 hedge-dropped',
  JSON.stringify(aHedge.diffs.map((x) => x.kind)));
ok(aHedge.diffs[0].source === '可能' && aHedge.diffs[0].claim === null, '差别带着原文那个词', JSON.stringify(aHedge.diffs[0]));

const aHard = toneAudit(HARDEN);
ok(aHard.diffs.length === 1 && aHard.diffs[0].kind === 'hardened', '报告加硬化词 → hardened',
  JSON.stringify(aHard.diffs.map((x) => x.kind)));
ok(aHard.diffs[0].claim === '必然' && aHard.diffs[0].source === null, 'hardened 带着报告那个词');

const aCAdd = toneAudit(CAUSAL_ADD);
ok(aCAdd.diffs.length === 1 && aCAdd.diffs[0].kind === 'causal-added', '并存被写成因果 → causal-added',
  JSON.stringify(aCAdd.diffs.map((x) => x.kind)));
ok(aCAdd.diffs[0].source === '之后' && aCAdd.diffs[0].claim === '因此', 'causal-added 两边都点名');

const aCDrop = toneAudit(CAUSAL_DROP);
ok(aCDrop.diffs.length === 1 && aCDrop.diffs[0].kind === 'causal-dropped', '推论被写成断言 → causal-dropped',
  JSON.stringify(aCDrop.diffs.map((x) => x.kind)));
ok(aCDrop.diffs[0].source === '说明', 'causal-dropped 点名原文那个推论词');

/* ─────────── 不该说话的时候 ─────────── */

const aSame = toneAudit(SAME);
ok(aSame.verdict === 'same-text', '逐字相同 → 判为「没有改写」', aSame.verdict);
ok(aSame.diffs.length === 0, '逐字相同时一处差别都不列');

const aOk = toneAudit(CONSISTENT);
ok(aOk.verdict === 'consistent', '两边都有软化词 → 判为对得上', aOk.verdict);
ok(aOk.diffs.length === 0, '对得上时一处差别都不列');

const aNo = toneAudit(NOSRC);
ok(aNo.verdict === 'no-source', '找不到原文那句 → 说「比不了」，不猜', aNo.verdict);
ok(aNo.diffs.length === 0, '比不了时一处差别都不列');

/* ─────────── 数得对 ─────────── */

const aTwo = toneAudit(TWO);
ok(aTwo.diffs.length === 2, '同时踩到软化词与推论词，数出两处（不是只取第一处）', String(aTwo.diffs.length));
ok(new Set(aTwo.diffs.map((x) => x.kind)).size === 2, '两处是不同种类');
ok(aTwo.note.indexOf('2 处差别') >= 0, '总述里写着处数', aTwo.note);

for (const [name, a] of Object.entries({ aHedge, aHard, aCAdd, aCDrop, aSame, aOk, aNo, aTwo })) {
  ok((a.verdict === 'differs') === a.diffs.length > 0, `${name}：verdict 与差别条数一致（不能一个说有、另一个列空）`);
}

/* ─────────── 不替模型圆场 ─────────── */

const aRep = toneAudit(REPORTED_ONLY);
ok(aRep.reported === true, '报告说越界，本地没找到，也照实记成「报告说越界」');
ok(aRep.reportedNote === '把可能性写成了结论', '报告给的理由逐字回传', aRep.reportedNote);
ok(aRep.verdict === 'consistent', '本地该说对得上就说对得上，不为了跟报告一致而改口', aRep.verdict);

/* ─────────── 四种组合各有说法 ─────────── */

const noteA = crossNote(aRep);
ok(noteA.indexOf('报告说越界') >= 0 && noteA.indexOf('本地在字面上没读到') >= 0,
  '报告说越界 / 本地没找到 → 两句都写出来', noteA);
const noteB = crossNote(aHedge);
ok(noteB.indexOf('本地在字面上读到差别') >= 0 && noteB.indexOf('报告没说越界') >= 0,
  '本地找到 / 报告没说 → 两句都写出来', noteB);
const noteC = crossNote(aOk);
ok(noteC.indexOf('报告也没在字面上读到差别') >= 0 || noteC.indexOf('两边一致') >= 0,
  '两边都没说 → 说一致', noteC);
const noteD = crossNote(aNo);
ok(noteD.indexOf('没比成') >= 0, '比不了时说明核不了这一条自评', noteD);

/*
 * 两个布尔都为真，不等于说的是同一处。
 * 假模型的报告说越界，理由是「把或然说成必然」；本地读到的是「说明被写成了断言」——
 * 两句话不是一回事。第一版文案写「两边指的是同一处」，纯属替它们宣布了没核过的事。
 */
const BOTH = diag('降低作业量可能会提高睡眠质量。', concl({
  quote: '降低作业量可能会提高睡眠质量',
  text: '降低作业量能提高睡眠质量',
  modalOverreach: true,
  modalNote: '把可能写成了必然',
}));
const noteBoth = crossNote(toneAudit(BOTH));
ok(!/指的是同一处|两边指的/.test(noteBoth), '两边都说有差别时，不替它们宣布「指的是同一处」', noteBoth);
ok(noteBoth.indexOf('未必') >= 0 && noteBoth.indexOf('自己比') >= 0, '两边都说有差别时说清「未必同一处、自己比」', noteBoth);

const allNotes = [noteA, noteB, noteC, noteD].join('|');
ok(!/(更好|更差|准确|不可靠|可靠|错误率)/.test(allNotes), '四句互相比对的话里没有一个评价词', allNotes);

const allDiffNotes = [...aHedge.diffs, ...aHard.diffs, ...aCAdd.diffs, ...aCDrop.diffs, ...aTwo.diffs]
  .map((x) => x.note)
  .join('|');
ok(!/(报告错|原文错|应当改|必须改)/.test(allDiffNotes), '差别说明只描述两边字面，不判谁对谁错', allDiffNotes);
ok(aHedge.diffs[0].note.indexOf('可能') >= 0, '差别说明里带着那个词本身，让人自己去核');

/* ─────────── 只读 ─────────── */

/*
 * 用一份**从没被别的断言碰过**的样本。
 * 第一版拿 REPORTED_ONLY 量，而它在这之前已经被 toneAudit 跑过四次——
 * 把代码改成「核的过程顺手清掉 modalNote」，这条只读断言照样绿：
 * 它比的是「污染之后」与「又污染一次之后」。反证第 8 组就是这样漏过去的。
 */
const FRESH = diag('原始那一句可能成立。', concl({
  quote: '原始那一句可能成立',
  text: '原始那一句成立',
  modalOverreach: true,
  modalNote: '原始理由',
}));
const before = JSON.stringify(FRESH);
const aFresh = toneAudit(FRESH);
crossNote(aFresh);
ok(aFresh.reportedNote === '原始理由', '报告给的理由被逐字带回，核的过程不抹它', aFresh.reportedNote);
ok(JSON.stringify(FRESH) === before, '核一遍不改报告里的任何一个字段');

/* ─────────── 结果 ─────────── */

if (failed.length) {
  console.log(`✗ check:modal 失败 ${failed.length} 条（通过 ${passed} 条）`);
  for (const f of failed) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`✓ check:modal 通过 ${passed} 条`);
