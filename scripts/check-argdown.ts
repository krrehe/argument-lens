/**
 * Argdown 导出的断言。
 *
 * 这个功能最容易出现的假绿是「文件长得像 Argdown」——缩进对、符号对、肉眼没问题，
 * 但**官方解析器一读就报错**，或者读进去之后语句数少了一条。所以这里不数字符，
 * 每一条都过一遍 `@argdown/core` 的 ParserPlugin：**它不报错，才算数**。
 *
 * 第二类断言针对转义：中文正文里出现 `[P1]` 这种字样很正常（引用别人的编号），
 * 直出会被当成语句引用，整份文件解析失败。转全角之后必须仍然可解析，
 * 并且**原文的六个字形确实变了**——变了要写在文件头，不能假装一字未改。
 *
 * 跑法：npm run check:argdown
 */
import { ArgdownApplication, ParserPlugin } from '@argdown/core';
import { argdownFileName, reportToArgdown } from '@shared/argdown';
import type { Diagnosis } from '@shared/types';
import { claim, diag } from './fixture-report';

let passed = 0;
const failed: string[] = [];

function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}

/** 每次新建应用：插件有内部状态，跨用例复用会互相污染。 */
function parse(src: string): { errors: string[]; statements: number } {
  const app = new ArgdownApplication();
  app.addPlugin(new ParserPlugin(), 'default');
  const res = app.run({ input: src, process: ['default'] }) as {
    parserErrors?: { message?: string }[];
    tokens?: { tokenType?: { name?: string } }[];
  };
  const errors = (res.parserErrors ?? []).map((e) => e.message ?? '解析错误');
  const statements = (res.tokens ?? []).filter((t) => t.tokenType?.name === 'StatementDefinition').length;
  return { errors, statements };
}

/* ── 样本一：结构完整的一份 ── */

const full: Diagnosis = diag({
  conclusion: claim('C', 'conclusion', '取消早读是错的', 0),
  premises: [
    claim('P1', 'premise', '早读能提高记忆效率', 40),
    { ...claim('P2', 'premise', '一本率下降了两成', 60), supports: ['P3'] },
  ],
  intermediate: [{ ...claim('P3', 'intermediate', '取消早读是那次下滑的主因', 80), implicit: true }],
  legitimateMoves: [
    {
      targetId: 'P1',
      quote: '早读能提高记忆效率',
      what: '「两成」给了具体幅度，不是「大幅下降」这类空话',
      why: '有数字，可以被核对',
      tag: 'argued',
      confidence: 'medium',
    },
  ],
  prompt: { version: '9.9.9', fingerprint: 'abcdef123456' },
});

const ad = reportToArgdown(full);
const p1 = parse(ad);

/* ── 一 · 官方解析器必须读得进去 ── */

ok(p1.errors.length === 0, 'Argdown 解析器读得进去', p1.errors[0]);
ok(p1.statements === 1 + 2 + 1 + 1, '语句数与报告一致（结论 1 + 前提 2 + 中间结论 1 + 合法 1）', `数到 ${p1.statements}`);

/* ── 二 · 文件头：透镜、档位、版本，一个不能少 ── */

ok(ad.startsWith('// 论证镜 · 结构导出'), '第一行就说明这是导出件');
ok(ad.includes('型式') || ad.includes('沃尔顿'), '带透镜名', '取 THEORY_BY_ID 的 name');
ok(/档位：被削弱/.test(ad), '档位写在中注释里');
ok(ad.includes('不是判决书'), '档位后面紧跟「不是判决书」');
ok(ad.includes('v9.9.9') && ad.includes('abcdef123456'), '带提示词版本与指纹');
ok(/全角/.test(ad), '交代正文里的字符被换成了全角');
ok(/原文以报告为准/.test(ad), '写明以原文为准');

{
  /* 旧存档没有版本字段，不能编一个。 */
  const old = diag({ prompt: undefined as unknown as Diagnosis['prompt'] });
  ok(reportToArgdown(old).includes('版本未记录'), '无版本时写「版本未记录」');
}

/* ── 三 · 关系按 supports 画，不按「前提一律指向结论」 ── */

ok(/\[C\]\n {4}<\+ \[P1\]\n {4}<\+ \[P3\]/.test(ad), '结论块下列出支撑它的 P1 与 P3');
ok(/\[P3\]\n {4}<\+ \[P2\]/.test(ad), 'P2 支撑 P3 时，关系挂在 P3 下而不是 C 下');
ok(!/\[C\]\n {4}<\+ \[P2\]/.test(ad), 'P2 不许同时被画成直接支撑 C', 'supports 指向 P3 时它就不是 C 的直接支撑');

/* ── 四 · 隐含前提与合法项各有自己的形状 ── */

ok(/\[P3\]: .*#隐含前提/.test(ad), '隐含前提带 #隐含前提 标签');
ok(/\[L1\]: .*#此处合法/.test(ad), '合法项作为独立语句带 #此处合法');
ok(
  !/\[L1\][^\n]*\n[ \t]+<\+/.test(ad) && !/<\+ \[L1\]/.test(ad),
  '合法项不连任何边',
  '它不支撑某一步，它是「这一步本来没问题」；两种连边方向都不许出现'
);

/* ── 五 · 断口只做注释 ── */

ok(/接不上：/.test(ad) && ad.includes('切断 P1 与 C 之间的因果联结'), '断口写进注释，且是原话');
ok(!/<-\s*\[/.test(ad), '不把「接不上」伪造成攻击关系', 'Argdown 的 - 是攻击，不是「这一步缺支撑」');

/* ── 六 · 转义：正文里的方括号不能变成语法 ── */

{
  const tricky = diag({ conclusion: claim('C', 'conclusion', '他说「[P1] 是错的」{不是元数据} #不是标签', 0) });
  const src = reportToArgdown(tricky);
  const r = parse(src);
  ok(r.errors.length === 0, '正文里出现 [P1] / {} / # 时仍可解析', r.errors[0]);
  ok(src.includes('［P1］'), '方括号被换成全角');
  ok(src.includes('｛不是元数据｝'), '花括号被换成全角');
  ok(src.includes('＃不是标签'), '井号被换成全角');
  ok(!src.includes('[P1] 是错'), '原样的 [P1] 不出现在语句正文里');
}

/* ── 七 · 不适用：不许假装分析过 ── */

{
  const na = diag({
    scope: { applicable: false, reason: '这是广告文案，说话人不以解决分歧为目标', outOfScopeAt: null, partialNote: null },
  });
  const src = reportToArgdown(na);
  ok(/不适用/.test(src), '写明本副透镜不适用');
  ok(!/档位：/.test(src), '不适用时不出现任何档位');
  ok(parse(src).errors.length === 0, '不适用样本仍可解析');
}

/* ── 八 · 没有关系时不留空壳，也不假装完整 ── */

{
  const bare = diag({ premises: [], intermediate: [] });
  const src = reportToArgdown(bare);
  ok(/没有可表达为「支撑」的关系/.test(src), '没有关系时写明原因，而不是印一个空块');
  ok(parse(src).errors.length === 0, '只有结论时仍可解析');
}

/* ── 九 · 文件名 ── */

{
  const name = argdownFileName(full);
  ok(name.endsWith('.ad'), '扩展名是 .ad');
  ok(/^论证镜-/.test(name), '文件名以「论证镜-」开头');
  ok(!/[/\\]/.test(name), '文件名里没有路径分隔符');
}

if (failed.length) {
  for (const f of failed) console.error(`✗ ${f}`);
  console.error(`\n✗ Argdown 导出检查失败 ${failed.length} 项（通过 ${passed} 项）`);
  process.exit(1);
}
console.log(`✓ Argdown 导出检查通过 ${passed} 项`);
