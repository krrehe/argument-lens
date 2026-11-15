import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  DENSITY_BOUNDS,
  DENSITY_STORAGE_KEY,
  DEFAULT_DENSITY,
  PREVIEW_DENSITY,
  densityLine,
  normalizeDensity,
  type Density,
} from '@shared/ui-density';

/**
 * 阅读层级的显示状态。
 *
 * 两条刻意的设计：
 * 1. **Context 默认值是「完整」。** 预览页不包 Provider 时，所有栏照旧展开，
 *    几十张既有截图与按 DOM 取数的检查器不受这一改动影响；只有真应用包了
 *    Provider 才默认简洁。
 * 2. **收起只改 class，不卸载组件。** 折叠的栏连同它的 data-* 探针都留在 DOM 里，
 *    导出、复算、端到端读数走的是同一份节点；「看不见」与「不存在」必须分开。
 */
type DensityState = {
  density: Density;
  setDensity: (d: Density) => void;
  isRevealed: (key: string) => boolean;
  reveal: (key: string) => void;
  /** 简洁态里点栏名：展开 / 收起来回切，不改全局模式。 */
  toggle: (key: string) => void;
};

const FULL_STATE: DensityState = {
  density: PREVIEW_DENSITY,
  setDensity: () => {},
  isRevealed: () => true,
  reveal: () => {},
  toggle: () => {},
};

const Ctx = createContext<DensityState>(FULL_STATE);

export function useDensity(): DensityState {
  return useContext(Ctx);
}

export function DensityProvider({
  initial,
  persist = false,
  children,
}: {
  initial?: Density;
  /** 真应用才持久化；预览页每次由 URL 决定，不写本机。 */
  persist?: boolean;
  children: ReactNode;
}) {
  const [density, setDensityState] = useState<Density>(() => {
    if (persist) {
      try {
        return normalizeDensity(localStorage.getItem(DENSITY_STORAGE_KEY) ?? DEFAULT_DENSITY);
      } catch {
        // @allow-silent: 本机偏好读不出来时按默认简洁显示，不影响任何报告内容；
        // 这里抛异常只会让整页白屏，比少记一次选择糟得多。
        return DEFAULT_DENSITY;
      }
    }
    return normalizeDensity(initial ?? DEFAULT_DENSITY);
  });
  const [revealed, setRevealed] = useState<string[]>([]);

  useEffect(() => {
    /* CSS 用 :root[data-density] 收束，省得往每一层组件传 class。 */
    document.documentElement.dataset.density = density;
  }, [density]);

  useEffect(() => {
    /* 「跳到」只能给出 id；点开那一栏不该要求读者先切到完整模式。 */
    const onReveal = (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      if (!key) return;
      setRevealed((prev) => (prev.includes(key) ? prev : [...prev, key]));
    };
    window.addEventListener('al:reveal', onReveal);
    return () => window.removeEventListener('al:reveal', onReveal);
  }, []);

  const setDensity = (d: Density) => {
    const next = normalizeDensity(d);
    setDensityState(next);
    if (persist) {
      try {
        localStorage.setItem(DENSITY_STORAGE_KEY, next);
      } catch {
        // @allow-silent: 偏好写不进本机时，本次会话里切换仍然生效；
        // 界面上没有「已保存」这类承诺，所以不必抛到界面上。
      }
    }
  };

  return (
    <Ctx.Provider
      value={{
        density,
        setDensity,
        isRevealed: (key) => revealed.includes(key),
        reveal: (key) => setRevealed((prev) => (prev.includes(key) ? prev : [...prev, key])),
        toggle: (key) =>
          setRevealed((prev) =>
            prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
          ),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

/** 报告第一行：让读者知道还有核对层，也知道怎么一次性叫回来。 */
export function DensityBar() {
  const { density, setDensity } = useDensity();
  return (
    <div className="density-bar" data-density-bar>
      <span className="db-k">阅读层级</span>
      <div className="db-switch" role="group" aria-label="阅读层级">
        <button
          type="button"
          className={`db-btn ${density === 'compact' ? 'db-on' : ''}`}
          data-density="compact"
          aria-pressed={density === 'compact'}
          onClick={() => setDensity('compact')}
        >
          简洁
        </button>
        <button
          type="button"
          className={`db-btn ${density === 'full' ? 'db-on' : ''}`}
          data-density="full"
          aria-pressed={density === 'full'}
          onClick={() => setDensity('full')}
        >
          完整
        </button>
      </div>
      <span className="db-note" data-density-line>
        {densityLine(density)}
      </span>
      <details className="db-bounds">
        <summary>边界</summary>
        <ul className="db-bound">
          {DENSITY_BOUNDS.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/**
 * 左栏那一整面透镜说明。
 *
 * 不是删掉：五条不可动摇里「六副透镜不合并」守的是透镜本身，不是把说明书
 * 摊在第一屏。收成一行，想看尺度、失效条件与出处的人点开就有，字一个没少。
 */
export function BriefFold({ children }: { children: ReactNode }) {
  const { density } = useDensity();
  return (
    /*
     * key 跟着模式走：切模式时重建一次，开合状态跟着新默认走。
     * 不跟着每次父组件重渲染走——用户自己点开的那一下不能被覆盖回去。
     */
    <details
      key={density}
      className="brief-fold"
      data-brief-fold
      open={density === PREVIEW_DENSITY}
    >
      <summary className="bf-sum">这副透镜怎么问 · 点开看尺度、失效条件与出处</summary>
      {children}
    </details>
  );
}
