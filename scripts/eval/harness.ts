/**
 * 评测宿主：在 Electron 主进程里跑真模型分析。
 *
 * 为什么必须是 Electron：API Key 用 safeStorage 加密存在用户目录里，
 * 只有持有同一个系统账户的 Electron 进程能解开。把 Key 复制到测试脚本里
 * 是另一码事——那会多出一份明文密钥，且从此测试跑的不是用户实际在用的配置。
 *
 * 一次一条，逐条落盘。中途失败不影响已完成的条目：跑十二条要几分钟，
 * 第 11 条挂掉不该让前 10 条白跑。
 */
import { app } from 'electron';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAnalysis } from '../../src/main/analyze';
import { CASES } from './cases';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../.out/eval');
mkdirSync(outDir, { recursive: true });

/*
 * app 名字必须手动设置成 package.json 里那个 name。
 * 直接 `electron 某个脚本` 启动时，Electron 不知道自己在跑哪个应用，
 * 名字退回 "Electron"，userData 于是指向 %APPDATA%/Electron——
 * 那里没有 settings.json，readSettings 读不到 Key，报的是「尚未配置 API Key」，
 * 而用户明明配过。错的目录不会报错，它只会返回空。
 */
app.setName('argument-lens');
app.disableHardwareAcceleration();

const only = (process.env.EVAL_ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.whenReady().then(async () => {
  const picked = only.length ? CASES.filter((c) => only.includes(c.id)) : CASES;
  console.log(`EVAL start ${picked.length} cases`);

  for (const c of picked) {
    const started = Date.now();
    const base = { id: c.id, title: c.title, genre: c.genre, theory: c.theory, mode: c.mode };
    try {
      const { diagnosis, usage } = await runAnalysis(c.text, c.theory, () => {}, { mode: c.mode });
      writeFileSync(
        resolve(outDir, `${c.id}.json`),
        JSON.stringify({ ...base, at: usage?.at ?? Date.now(), diagnosis, usage }, null, 1),
        'utf-8'
      );
      rmSync(resolve(outDir, `${c.id}.error.json`), { force: true });
      const ms = Date.now() - started;
      console.log(
        `EVAL ok ${c.id} ${ms}ms level=${diagnosis.verdict.level} checks=${diagnosis.checks.length} claims=${
          1 + diagnosis.premises.length + diagnosis.intermediate.length
        } diag=${diagnosis.diagnostics.length}`
      );
    } catch (err) {
      const e = err as Error & { code?: string };
      writeFileSync(
        resolve(outDir, `${c.id}.error.json`),
        JSON.stringify({ ...base, at: Date.now(), error: e.message, code: e.code ?? null }, null, 1),
        'utf-8'
      );
      /*
       * 不删上一次的成功产物。
       *
       * 第一版在这里 rmSync 了 .json，理由是「留着会让人分不清哪次是当前状态」。
       * 实际发生的是：一次因余额不足失败的单条重跑，把之前已经跑好的结果删了，
       * 而结果没法重跑（余额不足）。**失败不该销毁已有的证据。**
       * 现在两份都留，审计里标明「上次重跑失败：原因」，读者自己判断。
       */
      console.log(`EVAL fail ${c.id} ${(e.code ?? '')} ${e.message}`);
    }
  }

  console.log('EVAL done');
  app.exit(0);
});
