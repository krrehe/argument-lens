import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { THEORY_CLAIMS, CLAIM_BY_ID } from '@shared/theory-base';
import {
  HANDBOOK_SECTIONS,
  HB_CHECKS,
  HB_SCOPE,
  HB_VERDICT_LABEL,
  HB_VERDICT_ORDER,
  hbCoverage,
  hbLocator,
  hbMissing,
  hbStats,
} from '@shared/theory-handbook';

/**
 * 手册核对层的断言测试。跑法：npm run check:theory-handbook
 *
 * 这一层最容易被做假的地方有三处，各由一条断言守着：
 *
 *   1. 页码。手册中译本目录只到「1.3」「2.4」这一层，再往下（1.3.3、2.4.2）
 *      目录没给起页。若允许自己「顺推」一个页码，读者照着翻会翻错页，
 *      而错页比没有页更坏——他从此不信这一栏。于是：核对条目里的页码
 *      必须与 HANDBOOK_SECTIONS 逐字相同，而那张表里 null 就是 null。
 *
 *   2. 结论。四种结论里「文献有反对」最容易被悄悄改成「文献确认」——
 *      改完界面更好看，读者就再也看不到自己被说满了。于是：凡 conclusion
 *      为 dispute 的，库里那条必须已经有 contested 文字，否则算红。
 *
 *   3. 半途。核对表只覆盖十条，库里还有九十多条。若某条 refs 里已经写了
 *      「手册」却不在核对表里，说明有人核了一半就收手，界面会显示半个事实。
 */

const errors: string[] = [];
const warn = (m: string) => errors.push(m);
let n = 0;
const ok = () => {
  n += 1;
};
const VERDICTS = HB_VERDICT_ORDER;
/** 这两种结论的意思是「没有那一页」——指着节号就自相矛盾 */
const NO_SECTION: string[] = ['outside', 'own'];
const claims = THEORY_CLAIMS;
const known = new Set(claims.map((c) => c.id));

/* ── 一 · 章节表本身是否站得住 ── */
const sectionIds = new Set<string>();
for (const s of HANDBOOK_SECTIONS) {
  ok();
  if (sectionIds.has(s.id)) warn(`章节 ${s.id} 重复`);
  sectionIds.add(s.id);
  if (!s.title.trim()) warn(`章节 ${s.id} 没有标题`);
  if (s.volume !== 1 && s.volume !== 2) warn(`章节 ${s.id} 的卷次只能是 1 或 2`);
  if (s.page !== null && (!Number.isInteger(s.page) || s.page <= 0)) {
    warn(`章节 ${s.id} 的起页 ${s.page} 不是正整数`);
  }
}
// 同卷内页码必须递增：目录是顺序的，乱序说明抄错了一格。
for (const vol of [1, 2] as const) {
  const withPage = HANDBOOK_SECTIONS.filter((s) => s.volume === vol && s.page !== null);
  for (let i = 1; i < withPage.length; i++) {
    ok();
    if ((withPage[i].page as number) <= (withPage[i - 1].page as number)) {
      warn(`第 ${vol} 卷里 §${withPage[i].id}（页 ${withPage[i].page}）不大于上一节 §${withPage[i - 1].id}（页 ${withPage[i - 1].page}）——顺序反了`);
    }
  }
}
ok();
if (HANDBOOK_SECTIONS.length < 5) {
  warn(`只引了 ${HANDBOOK_SECTIONS.length} 节，少得可疑——核对是不是被整表删空`);
}

/* ── 二 · 逐条核对 ── */
const seen = new Set<string>();
for (const c of HB_CHECKS) {
  ok();
  if (!known.has(c.claimId)) warn(`${c.claimId} 在主张库里不存在——这条核对挂在空处`);
  if (seen.has(c.claimId)) warn(`${c.claimId} 核对了两次`);
  seen.add(c.claimId);

  const sec = c.section === null ? undefined : HANDBOOK_SECTIONS.find((s) => s.id === c.section);
  ok();
  if (c.section !== null && !sec) warn(`${c.claimId} 指到 §${c.section}，但章节表里没有这一节`);

  /*
    节号与结论必须对得上：
      「本书范围外」「无文献可核」说的是「没有这一页」，指着节号就是自相矛盾；
      其余四种说的是「有这一页，情况如此」，不指节号等于没给地址。
    这条断言是上一版没有的——上一版只有「没读到」一种否定，于是谁都可以把
    「这书不管」写成「这次没读」，读者永远等不到那一天。
  */
  ok();
  if (NO_SECTION.includes(c.verdict) && c.section !== null) {
    warn(`${c.claimId} 判「${HB_VERDICT_LABEL[c.verdict]}」却指着 §${c.section}——没有那一页可指`);
  }
  ok();
  if (!NO_SECTION.includes(c.verdict) && c.section === null) {
    warn(`${c.claimId} 判「${HB_VERDICT_LABEL[c.verdict]}」却没有节号——读者照什么去翻`);
  }

  ok();
  if (!VERDICTS.includes(c.verdict)) warn(`${c.claimId} 的结论 ${c.verdict} 不在六种之内`);

  ok();
  if (!c.says.trim()) warn(`${c.claimId} 没写手册说了什么`);
  ok();
  if (!c.gap.trim()) warn(`${c.claimId} 没写与本库的差——只抄手册不改本库，这一栏就没有用`);

  // 转述要短。长到能塞下原文摘录的篇幅，等于把书搬进仓库。
  ok();
  if (c.says.length > 70) warn(`${c.claimId} 的转述 ${c.says.length} 字，超过 70——太长就成了摘录`);
  ok();
  if (c.gap.length > 100) warn(`${c.claimId} 的差距 ${c.gap.length} 字，超过 100`);

  // 页码只许来自目录。locator 里出现的「页 N」必须与章节表一致。
  ok();
  const loc = hbLocator(c);
  if (sec && sec.page !== null && !loc.includes(`页 ${sec.page}`)) {
    warn(`${c.claimId} 的定位「${loc}」没写出章节表里的起页 ${sec.page}`);
  }
  ok();
  if (sec && sec.page === null && /页\s*\d/.test(loc)) {
    warn(`${c.claimId} 的定位「${loc}」凭自算写出了页码——目录没给这一层的起页，谁也不许补`);
  }

  // 「有反对」必须让读者在库里看得到反对，否则等于核了不说。
  if (c.verdict === 'dispute') {
    ok();
    const claim = CLAIM_BY_ID[c.claimId];
    if (claim && !claim.contested?.trim()) {
      warn(`${c.claimId} 判成「${HB_VERDICT_LABEL.dispute}」，但库里这条没有「谁反对」——发现了矛盾却没说给人听`);
    }
  }

  // 「未核到」必须自己说清没读到，不能拿别处的一句话充数。
  if (c.verdict === 'absent') {
    ok();
    if (!/没读到|未核|不在本次|范围外/.test(c.says + c.gap)) {
      warn(`${c.claimId} 判成「${HB_VERDICT_LABEL.absent}」，却没有一个字说明没读到——这等于假装核过`);
    }
  }

  /*
    「本书范围外」比「没读到」更强：它断言这本书里根本没有这一块。
    既然断言的是「书里没有」，依据只能是目录——所以转述里必须出现「目录」二字。
    写不出这两个字的，多半是没翻目录就判了，而这种判法读者没法复核。
  */
  if (c.verdict === 'outside') {
    ok();
    if (!/目录/.test(c.says)) {
      warn(`${c.claimId} 判成「${HB_VERDICT_LABEL.outside}」，但没写依据（目录里没有）——凭什么说书里没有`);
    }
    ok();
    if (/没读到|未核到/.test(c.says)) {
      warn(`${c.claimId} 判「${HB_VERDICT_LABEL.outside}」，转述里却写「没读到」——把「书里没有」和「这次没读」混成一件，读者会一直等`);
    }
  }

  // 「无文献可核」是唯一一条「这主张没有出处」的结论，必须自己认下来，不能读成有出处的。
  if (c.verdict === 'own') {
    ok();
    if (!/本工具/.test(c.says)) {
      warn(`${c.claimId} 判「${HB_VERDICT_LABEL.own}」，却没说这是本工具自己的判断——读者会当成有人这么写过`);
    }
  }

  // 空话。核对栏里出现「研究表明」这种没有地址的话，比不写还坏。
  ok();
  if (/研究表明|众所周知|学界普遍认为|普遍认为|大量研究/.test(c.says + c.gap)) {
    warn(`${c.claimId} 用了没有地址的措辞（研究表明／众所周知一类）——核对就是来治这个的`);
  }

  // 核对不是升档。
  ok();
  if (/升到|升级为|改为\s*A\s*档|改成\s*A\s*档/.test(c.says + c.gap)) {
    warn(`${c.claimId} 把核对写成了升档——核对说手册怎么看，不改本库的分档`);
  }
}

/* ── 三 · 半途而废与覆盖 ── */
const handbookRefClaims = claims.filter((c) => c.refs.some((r) => r.includes('手册')));
ok();
const halfDone = handbookRefClaims.filter((c) => !seen.has(c.id)).map((c) => c.id);
if (halfDone.length) {
  warn(`refs 里已写「手册」却没进核对表：${halfDone.join('、')}——核了一半就收手，界面会显示半个事实`);
}
ok();
if (HB_CHECKS.length < 10) warn(`核对只有 ${HB_CHECKS.length} 条，低于 10——这张表是不是被删过`);
ok();
const booksCovered = new Set([...seen].map((id) => CLAIM_BY_ID[id]?.book).filter(Boolean));
if (booksCovered.size < 4) warn(`核对只覆盖了 ${booksCovered.size} 编，低于 4——说明只核了顺手的那一编`);

/*
  最要紧的一条：**凡写进提示词的主张，必须有一条核对**。

  为什么单挑这一组：主张库一百多条，全核完不是这个工具该做的事；但其中有一小撮
  会变成提示词里的一句话，直接决定模型怎么读文本。那一小撮如果只有「我知道有这回事」，
  整份报告的每个判断就都压在印象上。所以这一组不按数量要求，按名单要求——
  一条没有核对，这里就红。

  名单不手抄：从 landing.ts 里把落在 `k: 'block'` 的主张捡出来。手抄一份清单，
  下次有人往提示词里加一条主张而忘了改清单，这条断言就成了摆设。
*/
const landingPath = join(process.cwd(), 'src/shared/landing.ts');
const landing = existsSync(landingPath) ? readFileSync(landingPath, 'utf-8') : '';
ok();
if (!landing) warn('landing.ts 不存在——查不出哪些主张写进了提示词');
const promptClaimIds: string[] = [];
if (landing) {
  for (const m of landing.matchAll(/'T(\d{1,2}-\d{2})':\s*\[([\s\S]*?)\n  \]/g)) {
    if (/\{ k: 'block'/.test(m[2])) promptClaimIds.push(`T${m[1]}`);
  }
}
ok();
if (promptClaimIds.length < 5) {
  warn(`落进提示词块的主张只数到 ${promptClaimIds.length} 条，少得可疑——landing.ts 的写法是不是变了`);
}
const promptMissing = hbMissing(promptClaimIds);
ok();
if (promptMissing.length) {
  warn(`写进提示词却没核过的主张：${promptMissing.join('、')}——报告里每个判断都压在这几条上`);
}

/* 账目：核对表覆盖全库多少，必须算得出来、且不加总成一句空话。 */
const cov = hbCoverage(claims.length);
ok();
if (cov.total !== claims.length) warn(`覆盖账的总数 ${cov.total} 与主张库 ${claims.length} 条对不上`);
ok();
if (cov.checked + cov.unchecked !== cov.total) warn('覆盖账：核过的加没核的，不等于全库');
ok();
if (cov.unchecked <= 0) {
  warn('覆盖账说全库都核过了——这张表只有二十几条，说全核完一定是算错了');
}

/* ── 四 · 落点：这一层必须真出现在界面上 ── */
const uiPath = join(process.cwd(), 'src/renderer/src/components/TheoryBase.tsx');
const ui = existsSync(uiPath) ? readFileSync(uiPath, 'utf-8') : '';
ok();
if (!ui) warn('TheoryBase.tsx 不存在——核对表没有落点');
for (const token of ['hbLocator(hb)', 'data-hb=', 'hb.says', 'hb.gap']) {
  ok();
  if (!ui.includes(token)) warn(`TheoryBase.tsx 里没有 ${token}——核对表做了但界面没显示`);
}
/*
  只查「字样在不在」会被两种改法骗过：把块整体注释掉，或者写成 `{false && hb && (...)`。
  后者尤其阴——源码里每个 token 都还在，界面一个字不出，静态检查全绿。
  所以这里认死一种写法：核对块必须直接由 `hb &&` 渲染。想换写法就得同时改这条断言，
  而改断言的人会先读到这段注释——这正是注释存在的用处。
  （「确实渲染出来了」最终由真机跑道兜底：AL_CLICK 打开理论库、点在 T2-11 上、
    量到 [data-hb] 那块在视野里，截图见 docs/screenshots/handbook-check-real.png。）
*/
ok();
if (!/\{hb && \(\s*<div className="tb-hb"/.test(ui)) {
  warn('TheoryBase.tsx 里核对块的渲染条件不是 `{hb && (` 直接渲染——被注释掉或被写成恒假条件时，字样检查是查不出来的');
}
const cssPath = join(process.cwd(), 'src/renderer/src/styles-theory.css');
const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf-8') : '';
for (const cls of ['.tb-hb', '.tb-hb-confirm', '.tb-hb-narrow', '.tb-hb-dispute', '.tb-hb-outside', '.tb-hb-own']) {
  ok();
  if (!css.includes(cls)) warn(`styles-theory.css 里没有 ${cls}——六种结论在界面上分不出来`);
}

/* ── 五 · 文档与命令 ── */
const docPath = join(process.cwd(), 'docs/理论支撑/11-手册核对.md');
ok();
const doc = existsSync(docPath) ? readFileSync(docPath, 'utf-8') : '';
if (!doc) warn('docs/理论支撑/11-手册核对.md 不存在');
else {
  ok();
  if (!doc.includes(HB_SCOPE)) {
    warn('手册核对文档里的覆盖范围与 HB_SCOPE 不是同一句话——两处各写一份，迟早对不上');
  }
  ok();
  for (const v of VERDICTS) {
    if (!doc.includes(HB_VERDICT_LABEL[v])) warn(`手册核对文档里没写「${HB_VERDICT_LABEL[v]}」这种结论`);
  }
  ok();
  for (const c of HB_CHECKS) {
    if (!doc.includes(c.claimId)) warn(`手册核对文档里没有 ${c.claimId}`);
  }

  /*
    两处对读：文档里的表是手抄的，代码里的表也是手抄的。
    手抄两遍最容易出的错不是「抄错」，而是**两边不一致却各自自洽**——
    这时界面显示一个结论，文档写着另一个，谁看谁都不觉得有问题。
    所以按行把「结论」与「页码」逐个对：对不上就是有人改了一边没改另一边。
  */
  const rowOf = new Map<string, string>();
  for (const line of doc.split('\n')) {
    const m = line.match(/^\|\s*(T\d{1,2}-\d{2})\s*\|/);
    if (m) rowOf.set(m[1], line);
  }
  for (const c of HB_CHECKS) {
    ok();
    const row = rowOf.get(c.claimId);
    if (!row) {
      warn(`文档表格里没有 ${c.claimId} 这一行——代码有、文档没有，读者只能看到一半`);
      continue;
    }
    ok();
    if (!row.includes(HB_VERDICT_LABEL[c.verdict])) {
      warn(
        `${c.claimId} 代码判「${HB_VERDICT_LABEL[c.verdict]}」，文档那一行写的不是这个——` +
          '悄悄把「有反对」改成「确认」时，读者就再也看不到反对意见'
      );
    }
    const secOfRow = HANDBOOK_SECTIONS.find((s) => s.id === c.section);
    ok();
    if (secOfRow && secOfRow.page !== null && !row.includes(`页 ${secOfRow.page}`)) {
      warn(`${c.claimId} 文档那一行没写章节表里的起页 ${secOfRow.page}（或写成了别的页）`);
    }
  }
}
const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as {
  scripts?: Record<string, string>;
};
ok();
if (!pkg.scripts?.['check:theory-handbook']) warn('package.json 里没有 check:theory-handbook 命令');
// verify 从 package.json 里动态捡 check:*，所以新关卡只要进了 scripts 就会被跑到。
// 但「被跑到」这件事本身也要验一下：有人把 verify.mjs 改成硬编码清单时，这里要响。
ok();
const verifySrc = existsSync(join(process.cwd(), 'scripts/verify.mjs'))
  ? readFileSync(join(process.cwd(), 'scripts/verify.mjs'), 'utf-8')
  : '';
if (!verifySrc) warn('scripts/verify.mjs 不存在');
else if (!verifySrc.includes("startsWith('check:')")) {
  warn('verify.mjs 不再按 check: 前缀动态发现——新加的关卡会静默地不被跑');
}

/* ── 六 · 统计与兜底 ── */
const stats = hbStats();
ok();
if (stats.total !== HB_CHECKS.length) warn('hbStats 的总数与核对表条数不一致');
ok();
for (const v of VERDICTS) {
  if (stats.byVerdict[v] < 0) warn(`结论 ${v} 的计数为负`);
}
ok();
const sum = VERDICTS.reduce((a, v) => a + stats.byVerdict[v], 0);
if (sum !== stats.total) warn(`六种结论加起来 ${sum}，与总数 ${stats.total} 对不上`);
if (n < 30) warn(`断言只跑了 ${n} 条，少得可疑——检查器是不是被整段跳过`);

if (errors.length) {
  console.error(`✗ 手册核对 ${errors.length} 处问题：`);
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
const brief = VERDICTS.map((v) => `${HB_VERDICT_LABEL[v]} ${stats.byVerdict[v]}`).join('、');
console.log(
  `✓ 手册核对 ${n} 条：${stats.total} 条主张核过（${brief}），全库 ${claims.length} 条中 ${cov.unchecked} 条没核，` +
    `写进提示词的 ${promptClaimIds.length} 条全覆盖，引用 ${HANDBOOK_SECTIONS.length} 节`
);
