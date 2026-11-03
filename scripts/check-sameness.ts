/**
 * 「这段文字跑过没有」的断言。
 *
 * 这一栏的坏法不是崩溃，是**说错话**：
 *   - 说「跑过 89 次」而真相是 97 份（改稿没被算进去）
 *   - 说「最近 10 月 20 日」而最近一次是 11 月 1 日（并列时取错了那份）
 *   - 说「和那份有 67% 相同」而两份只有四个字（短文本上相似度会乱跳）
 * 三种都不会报错，都会让用户按着错的信息决定要不要再花一次钱。
 *
 * 所以这里守的是三件事：数目对、日期对、**不该说的时候不说**。
 *
 * 跑法：npm run check:sameness
 */
import {
  NEAR_SAME,
  WORTH_MENTION,
  bigrams,
  dice,
  normalizePassage,
  pct,
  samenessLine,
  samenessOf,
  type PriorPassage,
} from '@shared/sameness';

let passed = 0;
const failed: string[] = [];

function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}

/* 一段造出来的「原文」：够长，长到相似度有意义。 */
const BASE =
  '我们学校去年取消了早读，今年高考一本率下降了六个百分点。这说明取消早读是错的。' +
  '学校应该恢复早读，并且把它写进作息制度里，让每个班都执行。';

/* 同一段话，加一两句——真实存档里那 8 份改稿就是这个样子（128 字加两句变 157 字，+23%）。 */
const LIGHT = BASE + '另外，隔壁两个县情况类似。';

/* 同一段话，加了将近一半的内容。这是改写，不是「加两句」。 */
const HEAVY =
  BASE + '另外，隔壁两个县也取消了早读，而且情况差不多。老师们的意见也支持恢复，家长也提过。';

/* 换了一个话题，字数相近。 */
const OTHER =
  '这家公司的报销流程改了三次，每次都要重新填表。财务说这是为了合规，' +
  '员工说这是折腾人。同一个单据在三个系统里重复录入，谁都不愿意改。';

const prior = (id: string, at: number, passage: string): PriorPassage => ({ id, at, passage });

/* ── 一、规范化：只做该做的两件事 ── */
ok(normalizePassage('  两 边 有空白  ') === '两 边 有空白', '规范化去掉首尾空白');
ok(normalizePassage('第一段\n\n第二段\t第三段') === '第一段 第二段 第三段', '连续空白压成一个空格');
ok(normalizePassage('\uFEFF开头带 BOM') === '开头带 BOM', 'BOM 不算内容');
ok(
  normalizePassage('他说「对」') !== normalizePassage('他说“对”'),
  '不转全角引号：两段原文不同，报告里的引文要对得回去',
  '归一化得太宽会把不同的原文合并成同一段'
);
ok(normalizePassage('AbC') === 'AbC', '不改大小写（改了就不是原文了）');

/* ── 二、二元组与 Dice ── */
ok(bigrams('').size === 0, '空文本没有二元组');
ok(bigrams('单字').size === 1, '两个字恰好一组');
ok(bigrams('的的的').get('的的') === 2, '二元组是多重集：重复片段计次数，不是去重');
ok(dice(bigrams(BASE), bigrams(BASE)) === 1, '自己和自己重合度为 1');
ok(dice(bigrams(''), bigrams(BASE)) === 0, '空文本与任何东西的重合度是 0，不是 NaN');
ok(dice(bigrams(BASE), bigrams(OTHER)) < 0.2, '换一个话题的两段，重合度很低');

/* ── 三、数得对 ── */
const twoSame = samenessOf(BASE, [
  prior('a', 1000, BASE),
  prior('b', 2000, BASE),
  prior('c', 3000, OTHER),
]);
ok(twoSame.exact === 2, '逐字相同的份数数得对', String(twoSame.exact));
ok(twoSame.near === 2, '一样的两份也算在 near 里', String(twoSame.near));
ok(twoSame.exact <= twoSame.near, 'near 永远不小于 exact');
ok(twoSame.closest?.share === 1, '最像的那份重合度是 1');

const none = samenessOf(BASE, []);
ok(none.exact === 0 && none.near === 0 && none.closest === null, '存档里什么都没有时，什么都不说');

/* ── 四、改一两句仍算「跑过」；大改不许混进去 ──
 *
 * 这一节量的是同一条规矩的两面。真实存档里 8 份改稿是「128 字加两句变 157 字」，
 * 相对长度 +23%，实测重合度 0.897。所以阈值必须低于 0.9——否则界面会说
 * 「跑过 89 次」，而真相是 97 份落在同一段话上。
 *
 * 反过来，加了四成内容的那种改写重合度只有 0.80：它确实是在同一段话上做出来的，
 * 但已经不是「同一段」。按「跑过」计数会让「你又跑了一遍」这个意思失真；
 * 正确的做法是**仍然指出来，但说成「有 80% 字面重合」**，让人自己判断。
 */
const light = samenessOf(BASE, [prior('l', 1500, LIGHT)]);
ok(
  light.near === 1,
  '加一两句（+23%）仍算「同一段」',
  `重合度 ${light.closest?.share.toFixed(3)}，阈值 ${NEAR_SAME}`
);
ok(light.exact === 0, '改稿不是逐字相同，exact 仍为 0');
ok(
  (light.closest?.share ?? 0) > 0.4,
  '改稿的重合度远高于「两个话题」那一组，两者不该混淆',
  String(light.closest?.share)
);
ok((light.closest?.share ?? 1) < 1, '改稿不能算成 100%——那几份是改过的');

const heavy = samenessOf(BASE, [prior('h', 1500, HEAVY)]);
ok(
  heavy.near === 0,
  '加了四成内容的改写不并进「跑过 N 次」——「又跑了一遍」是失真的说法',
  `重合度 ${heavy.closest?.share.toFixed(3)}`
);
ok(heavy.closest !== null, '但它仍然要被指出来：大改也是在同一段话上做出来的');

const unrelated = samenessOf(BASE, [prior('o', 1500, OTHER)]);
ok(unrelated.closest === null, '不相干的两段：低于 WORTH_MENTION 就不提，不当噪音显示');
ok(WORTH_MENTION < NEAR_SAME, '「值得一提」的门槛低于「几乎同一段」，否则中间那一档永远走不到');

/* ── 五、日期取最近的那份（并列时最容易错） ── */
const tie = samenessOf(BASE, [
  prior('old', 1000, BASE),
  prior('new', 9000, BASE),
  prior('mid', 5000, BASE),
]);
ok(tie.closest?.id === 'new', '三份逐字相同时，报的是最近那一份', tie.closest?.id);

const tieNear = samenessOf(BASE, [
  prior('near-old', 1000, LIGHT),
  prior('near-new', 8000, LIGHT),
]);
ok(tieNear.closest?.id === 'near-new', '相近的两份重合度一样时，也取最近那份', tieNear.closest?.id);

/* ── 六、短文本不许报相似度（会乱跳） ─────────────────────────────
 *
 * 注意这条守卫是**合取**的：两侧长度都要够，才去算相似度。
 * 反证时试过——只破「当前这段」那一侧，断言仍绿；只破「存档那份」那一侧，仍绿；
 * 两侧都破才红。所以将来有人破了单侧看见绿，不要据此断定这条断言是死的。
 *
 * 下面第二条断言把这个隐患的数值钉住：不加守卫的话，四个字对五个字是 0.857，
 * 正好压过 0.85——界面就会说「和那份有 86% 相同」。
 */
const short = samenessOf('你行你上', [prior('s', 1000, '你行你上啊')]);
ok(short.closest === null, '四个字对五个字，不报相似度', JSON.stringify(short.closest));
ok(
  dice(bigrams('你行你上'), bigrams('你行你上啊')) > NEAR_SAME,
  '四个字对五个字，光算 Dice 是过阈值的（0.857）——所以必须有守卫，不是多余的一行',
  dice(bigrams('你行你上'), bigrams('你行你上啊')).toFixed(3)
);
const shortExact = samenessOf('你行你上', [prior('s', 1000, '你行你上')]);
ok(shortExact.exact === 1, '但逐字相同照样数得出来');
ok(shortExact.closest?.share === 1, '逐字相同的那份仍可指出来');

/* ── 七、说成人话 ── */
const fmt = (at: number) => `时间戳${at}`;
const lineExact = samenessLine(twoSame, fmt);
ok(!!lineExact && lineExact.includes('已经跑过 2 次'), '逐字相同时说「已经跑过 N 次」', String(lineExact));
ok(!!lineExact && lineExact.includes('时间戳2000'), '句子里带的是最近那份的时间', String(lineExact));
/*
 * 「最近一次：」这四个字是截图看出来的：省掉之后是「（最近 今天 13:19）」——
 * 两个时间副词叠在一起，读起来像病句。fmt 给的就是「今天 13:19」这种口语形式，
 * 前面必须有个名词接住它。这条断言钉住那个名词。
 */
ok(!!lineExact && lineExact.includes('最近一次：'), '时间前面要有「最近一次：」，不能写成「最近 今天」', String(lineExact));

const mixed = samenessOf(BASE, [prior('a', 1000, BASE), prior('b', 2000, BASE), prior('e', 3000, LIGHT)]);
const lineMixed = samenessLine(mixed, fmt);
ok(mixed.exact === 2 && mixed.near === 3, '两份逐字 + 一份改稿 = exact 2、near 3', `${mixed.exact}/${mixed.near}`);
ok(
  !!lineMixed && lineMixed.includes('另有 1 份只差几个字'),
  '改稿要说成「只差几个字」，不能默默并进「跑过 N 次」里',
  String(lineMixed)
);

const lineNear = samenessLine(light, fmt);
ok(!!lineNear && lineNear.includes(pct(light.closest!.share)), '只有改稿时说「有 X% 相同」', String(lineNear));
ok(!!lineNear && lineNear.includes('那份'), '「那份」二字让用户知道比的是哪一份');
ok(!!lineNear && /那份 \d+ 字/.test(lineNear), '给出那份的字数，才能解释「为什么不是 100%」', String(lineNear));

const lineHeavy = samenessLine(heavy, fmt);
ok(
  !!lineHeavy && lineHeavy.includes('字面重合'),
  '大改的那份仍然出现，但说成「字面重合」而不是「又跑了一遍」',
  String(lineHeavy)
);

const linePartial = samenessLine(unrelated, fmt);
ok(linePartial === null, '不值得提的时候，一句话都不说');

/* 前半段是本段、后半段是另一段：真实里对应的就是「截了别人的一段接着写」。 */
const partial = samenessOf(BASE, [prior('p', 1000, `${BASE.slice(0, 40)}${OTHER.slice(0, 40)}`)]);
const linePartial2 = samenessLine(partial, fmt);
ok(
  !!linePartial2 && linePartial2.includes('字面重合'),
  '只重合一部分时说「字面重合」，不说「相同」——相同与重合不是一回事',
  String(linePartial2)
);

/* 这句话不许出现劝告。它只陈述位置，跑不跑由人决定。 */
for (const l of [lineExact, lineMixed, lineNear, lineHeavy, linePartial2]) {
  if (!l) continue;
  ok(!/别|不要|请|建议|应当/.test(l), '这句话里不许有劝告词', l);
}

/* ── 八、pct 不撒谎 ── */
ok(pct(1) === '100%', 'pct(1) 是 100%');
ok(pct(0.897) === '90%', 'pct(0.897) 是 90%（四舍五入，不截断）', pct(0.897));
ok(pct(0.0001) === '0%', 'pct 极小值显示 0%，不显示成 0.01%');

/* ── 九、确定性 ── */
const r1 = JSON.stringify(samenessOf(BASE, twoSame.closest ? [prior('x', 1, BASE)] : []));
const r2 = JSON.stringify(samenessOf(BASE, twoSame.closest ? [prior('x', 1, BASE)] : []));
ok(r1 === r2, '同样输入两次，结论一致（纯函数，无隐藏状态）');

if (failed.length) {
  console.error(`\n✗ check:sameness 失败 ${failed.length} 条（通过 ${passed} 条）`);
  for (const f of failed) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ check:sameness 通过 ${passed} 条`);
