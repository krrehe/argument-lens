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
  stopping,
  onStop,
}: {
  progress: ProgressEvent | null;
  /** 秒。由 App 每秒加一，这里只负责显示。 */
  elapsed: number;
  /** 已经按了停、在等主进程确认。 */
  stopping: boolean;
  onStop: () => void;
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
        {slow ? '这一次已经比平常久了——可能碰上长文本、供应商排队或重试。可以继续等，也可以按「停」。' : ''}
      </p>

      {/*
       * 停。
       *
       * 为什么这个按钮必须真的掐掉请求，而不是「界面不等了」：
       * 后者看起来也一样——主区立刻空出来——但模型还在生成、钱还在花，
       * 而用户以为自己已经省下了。停要停在 fetch 上。
       *
       * 旁边那句不是免责声明，是这次操作的实际后果，而且要说准：
       * 这一次会记成一条**失败**（token 按字数估、金额记 0），余额不会因此扣减；
       * 但钱可能已经花了，只是拿不到用量就写不下准确数字。
       * 「没记账」和「记了个 0」是两件事，说错哪一件都会让账本失去可信度。
       */}
      <div className="run-act">
        <button type="button" className="run-stop" onClick={onStop} disabled={stopping}>
          {stopping ? '正在停…' : '停'}
        </button>
        <span className="run-stop-note">
          停只停这一边的等待：请求已经发出去了，钱可能已经花了。账本里会多一条失败记录（金额记 0），
          余额不扣，所以别把余额当成这一趟的真实花费。停下来的文本还在输入框里，改完可以再跑一次。
        </span>
      </div>

      {/*
       * 中途关窗与按「停」不是一回事，所以分开写：关窗连界面一起没了，
       * 记账那一步多半来不及跑完；按「停」至少账本里还会留下一条失败记录，
       * 而且你能把这段文本拿回来改。
       */}
      <p className="run-note fine">
        现在关掉窗口，供应商那边照样计费，而这一条多半来不及记进账本（进程退出了才轮到写盘）。
        想留个准数就等它跑完。
      </p>
    </div>
  );
}
