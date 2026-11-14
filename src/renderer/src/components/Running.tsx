import type { AnalysisStage, ProgressEvent } from '@shared/types';

/**
 * 一条进度事件。`at` 是渲染层收到的时刻（毫秒），不是主进程发车的时刻。
 * 两者会差几毫秒，而这个清单只用它算「这一步花了多久」，用不着更准。
 */
export interface RunEvent {
  stage: AnalysisStage;
  label: string;
  at: number;
}

/**
 * 每一次分析都会走的五步，以及它们各自在干什么。
 *
 * 名字由这里写、不由主进程报，是因为「还没走到的步骤」没有事件可依据：
 * 主进程只在真的进入某一步时才发一条进度，提前报「待办」等于替它编话。
 * 但用户需要知道后面还有几步——否则 50% 停在那里看着就像卡死。
 * 所以：**已走过的步骤用主进程报的原话，没走到的只给中性说明**。
 */
const PLAN: { stage: AnalysisStage; name: string; note: string }[] = [
  { stage: 'scope', name: '框定', note: '按这副透镜定下要看什么' },
  { stage: 'reconstructing', name: '重构', note: '拆出前提、结论与隐含假设' },
  { stage: 'checking', name: '检查', note: '逐条走这透镜要问的问题' },
  { stage: 'verdict', name: '判定', note: '把检查结果写成结论' },
  { stage: 'self-check', name: '自检', note: '核对引用、回填原文位置' },
];

/** 秒数说成人话。阶段耗时常常只有一两秒，写「0 分 02 秒」比「2 秒」难读。 */
function humanSec(sec: number): string {
  if (sec < 1) return '不到 1 秒';
  if (sec < 60) return `${sec} 秒`;
  const m = Math.floor(sec / 60);
  return `${m} 分 ${String(sec % 60).padStart(2, '0')} 秒`;
}

/**
 * 分析进行中的主区。
 *
 * 为什么要有这一屏：一次分析 30–90 秒，这期间原来的主区显示的是首屏空态
 * 「先给一段真话」——而用户明明刚把话贴进去、刚按下「分析」。整屏最大的一块
 * 在说他没做已经做过的事，唯一的变化是顶上一条 2px 的进度条。
 *
 * 百分比只有阶段（框定 10% → 重构 25% → 检查 50% → 判定 80% → 自检 92%），
 * 没有逐字流的真实进度可用，所以这里不画那种一直往前爬、跟实际无关的假进度条：
 * 百分比只随阶段跳，文字永远是主进程刚报的那个阶段名。
 *
 * 这一轮补三件用户真的会问的事：
 *   1. 「后面还有几步」——阶段清单，已走过的标出实际耗时；
 *   2. 「现在到底在动还是卡住了」——同一阶段长时间没有新进度时直说，
 *      不拿一个自我安慰的动画糊过去；
 *   3. 「这个百分比是什么意思」——明写它只随阶段跳，不是时间比例。
 *
 * 「已等几秒」是本地数出来的，货真价实；它比百分比有用——用户真正想知道的是
 * 「还要不要等」，而这个数字至少让他能自己判断。
 */
export function Running({
  progress,
  elapsed,
  stopping,
  onStop,
  events = [],
  stillMs = 0,
}: {
  progress: ProgressEvent | null;
  /** 秒。由 App 每秒加一，这里只负责显示。 */
  elapsed: number;
  /** 已经按了停、在等主进程确认。 */
  stopping: boolean;
  onStop: () => void;
  /** 这一次已经收到的进度事件，按到达顺序。空数组表示只收到初始占位。 */
  events?: RunEvent[];
  /** 距上一条进度事件过了多少毫秒。每 500 毫秒随计时器刷新一次。 */
  stillMs?: number;
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

  const now = Date.now();
  const firstAt = (stage: AnalysisStage): number | null =>
    events.find((e) => e.stage === stage)?.at ?? null;
  const curIdx = progress ? PLAN.findIndex((p) => p.stage === progress.stage) : -1;
  const known = curIdx >= 0;

  /*
   * 同一阶段里如果又来了新的一条（判定那一步在格式损坏时会重出一次），
   * 把最新那句原话端出来——它是真的发生了，藏起来等于让用户以为没在动。
   */
  const inStage = progress ? events.filter((e) => e.stage === progress.stage) : [];
  const latestExtra =
    inStage.length > 1 && inStage[inStage.length - 1].label !== inStage[0].label
      ? inStage[inStage.length - 1].label
      : '';

  /*
   * 45 秒没有新进度才提「没动静」。检查那一步本来就是最长的一段，
   * 十几秒不动是常态；把常态说成异常，这个提示很快就没人看了。
   */
  const stallSec = Math.floor(stillMs / 1000);
  const stalled = known && stallSec >= 45;

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

      {/*
       * 阶段清单。故意不做 aria-live：里面的耗时每 500 毫秒变一次，
       * 让读屏跟着念等于制造噪音；真正需要播报的只有上面那一句阶段名。
       */}
      <ol className="run-plan" data-run-plan="1">
        {PLAN.map((p, i) => {
          const start = firstAt(p.stage);
          const state = curIdx > i || (!known && start !== null) ? 'done' : curIdx === i ? 'current' : 'todo';
          const next = PLAN.slice(i + 1)
            .map((q) => firstAt(q.stage))
            .find((v): v is number => v !== null);
          const spent = start === null ? null : Math.max(0, Math.round(((next ?? now) - start) / 1000));
          return (
            <li
              key={p.stage}
              className={`run-step ${state}`}
              data-step={p.stage}
              data-state={state}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <span className="run-step-i" aria-hidden="true">
                {state === 'done' ? '✓' : state === 'current' ? '●' : '○'}
              </span>
              <span className="run-step-b">
                <span className="run-step-n">{p.name}</span>
                {/* 走到这一步就显示主进程原话；没走到只显示中性说明，不替它编 */}
                <span className="run-step-t">{state === 'current' ? label : p.note}</span>
              </span>
              {spent !== null && <span className="run-step-time">{state === 'current' ? `已 ${humanSec(spent)}` : humanSec(spent)}</span>}
            </li>
          );
        })}
        {/* 主进程报了一个不在这五步里的阶段（未来加步骤时）：如实补一行，不硬塞 */}
        {progress && !known && (
          <li className="run-step current" data-step={progress.stage} data-state="current" aria-current="step">
            <span className="run-step-i" aria-hidden="true">
              ●
            </span>
            <span className="run-step-b">
              <span className="run-step-n">{progress.stage}</span>
              <span className="run-step-t">{label}</span>
            </span>
          </li>
        )}
      </ol>

      {latestExtra && (
        <p className="run-live" data-run-live="1">
          这一步刚报了一句：{latestExtra}
        </p>
      )}

      {/*
       * 卡住的时候说实话。这里最容易被做成「一直在转的动画」——
       * 那种动画在真的卡住时也在转，所以它传递的信息量是零。
       */}
      {stalled && (
        <p className="run-stall" data-run-stall="1">
          「{label}」这 {humanSec(stallSec)}没有新进展。可能是在供应商那边排队、在自动重试，或者碰上长文本。
          没有超时打断：要不要继续等由你决定，按「停」不会少收这次的钱。
        </p>
      )}

      <p className="run-note">
        一次通常 30–90 秒：模型要先把这段话拆成前提与推理链，再逐条走完这副透镜要问的问题。
        {slow ? '这一次已经比平常久了——可能碰上长文本、供应商排队或重试。可以继续等，也可以按「停」。' : ''}
      </p>
      <p className="run-note fine">
        百分比只随阶段跳（10 / 25 / 50 / 80 / 92），不是时间比例——它停在 50% 不代表卡住，
        只代表还在这五步里的第三步。
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
          也可以直接按 <b>Esc</b>。
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
