/**
 * 对照组：同一模型、同一段文本、一句普通用户会写的请求。
 *
 * 这个脚本存在的唯一目的，是回答 A 方案那个问题——「论证镜比裸提示词强吗」。
 * 所以基线不能做成稻草人：
 *
 *   · 不给它任何不利条件：温度与产品侧一致（0.2），max_tokens 给足。
 *   · 也不用一句话敷衍它：这版请求是「结论 / 理由 / 站不站得住 / 问题在哪」四问齐上，
 *     还明确要求指出问题在原文哪一句——**这是对基线有利的一条**，因为锚定原文
 *     恰恰是产品侧靠 locator 才稳定做到的事。
 *   · 措辞是普通人在对话框里会写的那一句，不是我们内部的行话。
 *
 * 不写 JSON schema、不给判据表、不给六套透镜、不做本地裁决。它拿到的东西，
 * 就是一个没读过这套理论的用户，把文本粘进聊天框能得到的东西。
 *
 * 与产品侧共用同一套隔离做法（见 run.mjs 的注释）：Key 靠复制 settings.json
 * 与 Local State 到临时 userData 解开，跑完删掉。评测不写用户账本。
 */
import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chat } from '../../src/main/llm';
import { CASES } from './cases';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../.out/eval-bare');
mkdirSync(outDir, { recursive: true });

/*
 * 请求原文逐字存进产物里。基线一旦可以事后悄悄改措辞，
 * 「比裸提示词强」这句话就永远无法复核——想改就改一个更弱的版本上来。
 */
const BARE_SYSTEM = '你是一个严谨、务实的论证分析助手。';
const BARE_USER = (text: string) =>
  `请分析下面这段文字的论证：它想证明什么、用了哪些理由、站不站得住、有什么问题。尽量指出问题对应原文的哪一句。\n\n---\n${text}\n---`;

app.setName('argument-lens');
app.disableHardwareAcceleration();

const only = (process.env.EVAL_ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
/* 断点续跑：一条要几十秒，中途挂了不该让前面白跑。默认跳过已完成的。 */
const force = process.env.EVAL_FORCE === '1';

app.whenReady().then(async () => {
  const picked = only.length ? CASES.filter((c) => only.includes(c.id)) : CASES;
  console.log(`BARE start ${picked.length} cases`);

  for (const c of picked) {
    const out = resolve(outDir, `${c.id}.json`);
    if (!force && existsSync(out)) {
      const prev = JSON.parse(readFileSync(out, 'utf-8'));
      if (prev && typeof prev.output === 'string' && prev.output.length > 0) {
        console.log(`BARE skip ${c.id}（已有结果）`);
        continue;
      }
    }
    const started = Date.now();
    try {
      const r = await chat(BARE_SYSTEM, BARE_USER(c.text), {
        maxTokens: 4096,
        temperature: 0.2,
      });
      writeFileSync(
        out,
        JSON.stringify(
          {
            id: c.id,
            title: c.title,
            genre: c.genre,
            at: Date.now(),
            ms: Date.now() - started,
            system: BARE_SYSTEM,
            user: BARE_USER(c.text),
            output: r.text,
            usage: r.usage ?? null,
            textChars: c.text.length,
          },
          null,
          1
        ),
        'utf-8'
      );
      console.log(
        `BARE ok ${c.id} ${Date.now() - started}ms chars=${r.text.length} tok=${r.usage?.completion_tokens ?? '?'}`
      );
    } catch (err) {
      const e = err as Error & { code?: string };
      writeFileSync(
        resolve(outDir, `${c.id}.error.json`),
        JSON.stringify({ id: c.id, at: Date.now(), error: e.message, code: e.code ?? null }, null, 1),
        'utf-8'
      );
      console.log(`BARE fail ${c.id} ${e.code ?? ''} ${e.message}`);
    }
  }

  console.log('BARE done');
  app.exit(0);
});
