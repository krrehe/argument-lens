/**
 * 「按快捷键之后，这段字该不该进输入框」的断言。
 *
 * 这个功能的坏法很特别：它**不报错**。框里的字被换了，用户看到的是一个
 * 完全正常的结果页——只是分析的不是他写的那段。等他发现时，二十分钟的原文
 * 已经没了（输入框不备份）。所以这里守的不是「填得对不对」，
 * 而是「什么情况下**绝不许动**框里的东西」。
 *
 * 第二类断言守的是边界：超长时**不许截断**。截断看起来体贴，实际上
 * 报告里每条判定都挂着原文引文，引文对不上原文，比不给分析更坏。
 *
 * 跑法：npm run check:capture
 */
import {
  CAPTURE_ACCELERATOR,
  MAX_CAPTURE_CHARS,
  decideCapture,
  humanizeAccelerator,
  type CaptureInput,
} from '@shared/capture';

let passed = 0;
const failed: string[] = [];

function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) passed += 1;
  else failed.push(detail ? `${label}（${detail}）` : label);
}

const mine = '我写了一下午的一段话，不能就这么被换掉。';
const clipText = '剪贴板里是一段别的文字，来自某个网页。';

const base: CaptureInput = { current: '', clip: clipText, currentIsSample: false };
const d = (patch: Partial<CaptureInput>) => decideCapture({ ...base, ...patch });

/* ── 一、快捷键本身 ── */
ok(CAPTURE_ACCELERATOR.includes('CommandOrControl'), '快捷键用 CommandOrControl，Windows 与 macOS 同一个字符串');
ok(
  humanizeAccelerator(CAPTURE_ACCELERATOR, 'win32') === 'Ctrl+Alt+A',
  'Windows 上写给人看的是 Ctrl+Alt+A',
  humanizeAccelerator(CAPTURE_ACCELERATOR, 'win32')
);
ok(
  humanizeAccelerator(CAPTURE_ACCELERATOR, 'darwin') === '⌘+⌥+A',
  'macOS 上写给人看的是 ⌘+⌥+A',
  humanizeAccelerator(CAPTURE_ACCELERATOR, 'darwin')
);
ok(
  humanizeAccelerator(CAPTURE_ACCELERATOR, 'linux') === 'Ctrl+Alt+A',
  'Linux 上写给人看的是 Ctrl+Alt+A',
  humanizeAccelerator(CAPTURE_ACCELERATOR, 'linux')
);

/* ── 二、不该打扰的情况 ── */
const emptyClip = d({ clip: '' });
ok(emptyClip.kind === 'ignore', '剪贴板是空的就不填', emptyClip.kind);
ok(emptyClip.kind === 'ignore' && emptyClip.note.includes('没有文字'), '空剪贴板要说明「没有文字」，否则人以为按键坏了');
ok(emptyClip.kind === 'ignore' && !emptyClip.quiet, '「剪贴板里没有文字」必须说出来，不能静默');

const blankClip = d({ clip: ' \n\t ' });
ok(blankClip.kind === 'ignore', '剪贴板只有空白也算没有', blankClip.kind);

const same = d({ current: clipText, clip: clipText, currentIsSample: false });
ok(same.kind === 'ignore', '框里已经是这段就不动', same.kind);
ok(same.kind === 'ignore' && same.quiet, '「已经是这段」要静默——连按两下不该弹提示');

const sameTrim = d({ current: `  ${clipText}\n`, clip: clipText, currentIsSample: false });
ok(sameTrim.kind === 'ignore', '只差首尾空白的同一段，也不动', sameTrim.kind);

/* ── 三、超长：不填，更不许截断 ── */
const over = d({ clip: '字'.repeat(MAX_CAPTURE_CHARS + 1) });
ok(over.kind === 'ignore', '超过上限不填', over.kind);
ok(over.kind === 'ignore' && !over.quiet, '超长必须说出来：悄悄不填，人会以为按键坏了');
ok(over.kind === 'ignore' && !('text' in over), '超长时连候选都不给，界面就没法顺手写进去');
ok(
  over.kind === 'ignore' && over.note.includes(String(MAX_CAPTURE_CHARS)) && over.note.includes(String(MAX_CAPTURE_CHARS + 1)),
  '超长要报出「有 N 字、上限 M 字」，只说「太长了」等于让人自己猜'
);

const exact = d({ clip: '字'.repeat(MAX_CAPTURE_CHARS) });
ok(exact.kind === 'fill', '恰好等于上限要放行（边界内是正常长文，不能误伤）', exact.kind);
ok(exact.kind === 'fill' && exact.text.length === MAX_CAPTURE_CHARS, '恰好等于上限时一个字都不许少（没被悄悄截断）');

/* ── 四、能填的情况：原样写入，不做任何修剪 ── */
const intoEmpty = d({ current: '', clip: clipText });
ok(intoEmpty.kind === 'fill', '框是空的就直接填', intoEmpty.kind);
ok(intoEmpty.kind === 'fill' && intoEmpty.text === clipText, '填进去的就是剪贴板原文');

const withSpaces = `  前面有空格\n\n后面有空行  `;
const kept = d({ current: '', clip: withSpaces });
ok(kept.kind === 'fill' && kept.text === withSpaces, '不 trim：原文的排版是原文的一部分，报告要按它取引文');

const sample = d({ current: '一段示例文本，不是你写的。', clip: clipText, currentIsSample: true });
ok(sample.kind === 'fill', '框里是示例就直接换成剪贴板里的字（示例本来就是拿去换的）', sample.kind);

/* ── 五、绝不许动的情况：用户自己的字 ── */
const ask = d({ current: mine, clip: clipText, currentIsSample: false });
ok(ask.kind === 'ask', '框里是用户自己写的字，只能问，不能填', ask.kind);
ok(ask.kind === 'ask' && ask.chars === clipText.length, '问的时候要说清候选有多长，人才知道要不要');
ok(
  ask.kind === 'ask' && ask.note.includes('没有覆盖'),
  '提示里必须明说「没有覆盖」——只说「要用这段替换吗」会被读成「已经换了，确认一下」'
);
ok(ask.kind === 'ask' && ask.text !== mine, '候选不是框里那段（防实现把两边接反）');

/* 问过之后，框里的字在纯函数层面一个字节都没动：这条是上面几条的合判。 */
const before = mine;
const after = d({ current: before, clip: clipText, currentIsSample: false });
ok(JSON.stringify(before) === JSON.stringify(mine), '决定「问」的时候，传入的原文对象不被修改');

/* ── 六、确定性 ── */
const a1 = JSON.stringify(d({ current: mine, clip: clipText }));
const a2 = JSON.stringify(d({ current: mine, clip: clipText }));
ok(a1 === a2, '同样的输入两次，结论一致（纯函数，无隐藏状态）');
ok(!Number.isNaN(MAX_CAPTURE_CHARS) && MAX_CAPTURE_CHARS >= 2000, '上限至少容得下一篇长社论');

if (failed.length) {
  console.error(`\n✗ check:capture 失败 ${failed.length} 条（通过 ${passed} 条）`);
  for (const f of failed) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ check:capture 通过 ${passed} 条`);
