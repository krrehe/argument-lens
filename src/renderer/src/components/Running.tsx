import type { ProgressEvent } from '@shared/types';

/**
 * 分析进行中的主区。
 *
 * 为什么要有这一屏：一次分析 30–90 秒，这期间原来的主区显示的是首屏空态
 * 「先给一段真话」——而用户明明刚把话贴进去、刚按下「分析」。整屏最大的一块
 * 在说他没做已经做过的事，唯一的变化是顶上一条 2px 的进度条。
 *
 * 进度只有阶段（拆解 10% → 检查 50% → 判定 80% → 自检 92%），没有逐字流的
 * 真实进度可用，所以这里不画那种一直往前爬、跟实际无关的假进度条：
 * 百分比只随阶段跳，文字永远是主进程刚报的那个阶段名。
 *
 * 「已等几秒」是本地数出来的，货真价实；它比百分比有用——用户真正想知道的是
 * 「还要不要等」，而这个数字至少让他能自己判断。
 */
export function Running({
  progress,
  elapsed,
}: {
  progress: ProgressEvent | null;
  /** 秒。由 App 每秒加一，这里只负责显示。 */
  elapsed: number;
}) {
  const percent = progress?.percent ?? 4;
  const label = progress?.label ?? '准备';

  const mm = Math.floor(elapsed / 60);
  const ss = elapsed % 60;
  const waited = mm ? `${mm} 分 ${String(ss).padStart(2, '0')} 秒` : `${ss} 秒`;

  /*
   * 超过 150 秒才提「比平常久」。低于这个数就说「有点慢」是在制造焦虑——
   * 正常区间本来就到 90 秒，其中一半时间用户会看到这句话。
   */
  const slow = elapsed >= 150;

  return (
    <div className="running">
      <div className="run-head">
        <span className="run-dot" aria-hidden="true" />
        <b>正在分析</b>
        {/*
          这一句每秒变一次。它不能落进任何 aria-live 区域：读屏会跟着每秒念一遍，
          比不念更糟。信息仍然对读屏可见（只是不主动播报），要问再读。
        */}
        <span className="run-wait">已等 {waited}</span>
      </div>

      {/* 只有阶段变（一次跑 5 次）时才播报，这才值得打断用户 */}
      <div className="run-stage" role="status" aria-live="polite">
        <span className="run-label">{label}</span>
        <span className="run-pct">{percent}%</span>
      </div>
      <div
        className="run-bar"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <i style={{ width: `${percent}%` }} />
      </div>

      <p className="run-note">
        一次通常 30–90 秒：模型要先把这段话拆成前提与推理链，再逐条走完这副透镜要问的问题。
        {slow ? '这一次已经比平常久了——可能碰上长文本、供应商排队或重试。可以继续等，也可以关掉窗口。' : ''}
      </p>

      {/*
       * 中途关窗的代价要说清楚，而且不能吓唬人：
       * 请求已到供应商那边，token 已经在生成，钱照收；但本地这笔账要等响应回来才写得下，
       * 所以账本里不会留下这一条——账本会偏小，偏小的地方正是这里。
       */}
      <p className="run-note fine">
        这段文本和这次问法都已经发出去了：现在关掉窗口，供应商那边照样计费，而这份账本里不会留下这一条
        （拿不到用量就记不了账）。想留个准数，就等它跑完。
      </p>
    </div>
  );
}
