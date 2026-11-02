/**
 * 示例文本库的断言。
 *
 * 为什么示例也要有检查：它看起来只是「方便试用」的占位内容，实际上干着三件事——
 * 教用户什么样的文字值得拿来判、决定连按几次能看到几种报告、以及是存档里那一百多份
 * 同文本报告的来源。这三件事坏掉都不会报错：按钮照样能按，字照样填进去。
 *
 * 具体守什么，见每段断言上方的说明。核心是一条：
 * **同一段文本反复判，得到的是同一份报告，不是新样本。** 六段必须真的是六段。
 */
import { readFileSync } from 'node:fs';
import { SAMPLES } from '@shared/samples';

let passed = 0;
const failed: string[] = [];

function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}

/** 句末标点。中文的四类都算：一段话里连一个句末标点都没有，它就不是一个论证。 */
const END = /[。！？!?]/g;

ok(SAMPLES.length >= 5, '至少五段（少于五段，连按几次就绕回来了，「换一段」名不副实）', `实得 ${SAMPLES.length}`);

const norm = (s: string) => s.replace(/\s+/g, '');
const texts = SAMPLES.map((s) => norm(s.text));
ok(new Set(texts).size === texts.length, '每段文本互不相同（去空白后比）：重复的示例等于只有一段');

const genres = SAMPLES.map((s) => s.genre.trim());
ok(genres.every((g) => g.length >= 2), '每段都有体裁名（按钮的提示靠它说「这段是什么话」）', genres.join('/'));
ok(new Set(genres).size === genres.length, '体裁名互不相同（同名的两段，人分不出自己按到了第几段）');

for (const [i, s] of SAMPLES.entries()) {
  const tag = `第 ${i + 1} 段「${s.genre}」`;
  /*
   * 长度上下界。
   * 下界 60：短于这个数，一段话里通常只有一句断言，拆不出前提与推理链，
   *   用户第一次用就点开这种示例，会以为这工具只会复述。
   * 上界 400：示例是让人一眼看完、随手改两个字再跑的；更长的该由用户自己粘，
   *   而不是让示例占满输入框，看起来像「这软件要读长文」。
   */
  ok(s.text.length >= 60 && s.text.length <= 400, `${tag} 长度在 60–400 字之间`, `实得 ${s.text.length}`);
  const sentences = (s.text.match(END) ?? []).length;
  ok(sentences >= 2, `${tag} 至少两句（一句断言撑不起一次诊断）`, `实得 ${sentences}`);
  ok(s.hint.trim().length >= 4, `${tag} 有「这段埋了什么」的提示`);
  /*
   * 提示里点出的毛病，必须真的能在文本里找到对应的话。
   * 这里只做一件粗查：提示里写了几个毛病，文本就该有那么多句以上的句子——
   * 一句「个案代统计 + 假二难 + 贬低替代方案」配一句话，是怎么都对不上的。
   */
  const named = s.hint.split(/[+＋、,，]/).filter((x) => x.trim()).length;
  ok(named <= sentences, `${tag} 提示里点出的毛病数与句子数对得上`, `${named} 个毛病 / ${sentences} 句`);
}

/*
 * 第一段与假模型夹具是绑死的，但「绑死」不该靠一句「别改」。
 *
 * 夹具（`scripts/mock-llm.mjs`）里那两条命名写的是**下标**：span.start/end
 * 加上它自己声明的引文。冒烟跑的就是第一段，所以这些下标必须正好切出那段引文。
 * 一旦有人改了第一段的文字而不改下标，落点图会圈到别的位置，
 * 而界面不会报错——它只是安静地圈错地方，命名卡照样能点。
 *
 * 这里直接把夹具里声明的 span 拿来切第一段，切出来的必须等于它自己写的 quote。
 * 这比「文本里含某几个词」结实：它验的是坐标与文字是否还对得上。
 */
const mockPath = 'scripts/mock-llm.mjs';
let mockSrc = '';
try {
  mockSrc = readFileSync(mockPath, 'utf-8');
} catch {
  mockSrc = '';
}
ok(mockSrc.length > 0, '读得到假模型夹具（读不到时这一组会静默地什么都不验）', mockPath);

const spans = [...mockSrc.matchAll(/span:\s*\{\s*start:\s*(\d+),\s*end:\s*(\d+),\s*quote:\s*'([^']*)'/g)];
ok(spans.length >= 2, '夹具里至少两处带下标的命名（少于两处，这一组等于没验）', `实得 ${spans.length}`);

for (const m of spans) {
  const [start, end, quote] = [Number(m[1]), Number(m[2]), m[3]];
  const cut = SAMPLES[0].text.slice(start, end);
  ok(cut === quote, `夹具的下标 [${start},${end}) 切出的正是它声明的引文`, `切出「${cut}」`);
}
ok(
  SAMPLES[0].text.includes('取消早读') && SAMPLES[0].text.includes('一本率'),
  '第一段仍是文档与截图里的「取消早读」那段',
  SAMPLES[0].text.slice(0, 24)
);

ok(passed >= 12, '断言总数不少于 12 项', `实际 ${passed}`);

if (failed.length) {
  console.error(`\n✗ 示例文本检查失败 ${failed.length} 项（通过 ${passed} 项）`);
  for (const f of failed) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ 示例文本检查通过 ${passed} 项`);
