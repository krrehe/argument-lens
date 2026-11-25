/**
 * 全屏论证地图（只读）。
 *
 * 数据与版面在 `@shared/map`：这里只负责画、缩放、拖动与展开详情。
 * 三条界面规矩：
 *   1. 图上的字逐字来自报告，界面只加「结论 / 前提 / 检查」这类分类标签；
 *   2. 图例必须有——没有图例的图只是装饰；
 *   3. 不提供任何「改判」「重排」「导出图片」的按钮：这是一次阅读，不是编辑器。
 *
 * 缩放与平移走 SVG viewBox，不用 CSS transform（`check:ui-rules` 禁止主窗口
 * 出现 transform）。滚轮以指针为中心缩放，按住拖动平移，左下角三颗控制键，
 * 交互骨架参考 React Flow 的 fitView / Controls，但不引入依赖。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  buildMap,
  MAP_BODY_TOP,
  MAP_LINE_H,
  MAP_MAX_LINES,
  MAP_NOTE,
  MAP_TEXT_BUDGET,
  type MapEdgeKind,
  type MapNode,
} from '@shared/map';
import { ACCEPT_LABEL, ANSWER_LABEL, STRATEGY_LABEL } from '@shared/labels';
import { locationLabel } from '@shared/overall';
import type { Diagnosis } from '@shared/types';
import { C, Legend, wrap } from './Diagram';

type Surface = 'text' | 'map';

/* ─────────── 开关 ─────────── */

export function ReportSurfaceSwitch({
  surface,
  onChange,
}: {
  surface: Surface;
  onChange: (s: Surface) => void;
}) {
  return (
    <div className="mp-switch" data-map-switch>
      <div className="mp-seg" role="group" aria-label="报告呈现方式">
        <button
          className={`mp-seg-btn ${surface === 'text' ? 'is-on' : ''}`}
          data-map-text
          aria-pressed={surface === 'text'}
          onClick={() => onChange('text')}
        >
          文字
        </button>
        <button
          className={`mp-seg-btn ${surface === 'map' ? 'is-on' : ''}`}
          data-map-open
          aria-pressed={surface === 'map'}
          onClick={() => onChange('map')}
        >
          地图
        </button>
      </div>
      <span className="mp-switch-note">
        {surface === 'map'
          ? '滚轮缩放，拖动平移；点任一节点，在右侧看它逐字写了什么。'
          : '把整份报告摆成一张图：结论、前提、检查、反驳、改法各就各位。'}
      </span>
    </div>
  );
}

/* ─────────── 详情 ─────────── */

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="mp-row">
      <span className="mp-k">{k}</span>
      <span className="mp-v">{children}</span>
    </div>
  );
}

function MapDetail({ d, node, onClose }: { d: Diagnosis; node: MapNode; onClose: () => void }) {
  const claim = [d.conclusion, ...d.premises, ...d.intermediate].find((c) => c.id === node.id);
  const check = d.checks.find((c) => c.id === node.id);
  const ref = d.refutations.find((r) => r.id === node.id);
  const revIndex = /^V\d+$/.test(node.id) ? Number(node.id.slice(1)) - 1 : -1;
  const rev = revIndex >= 0 ? d.revisions?.[revIndex] : undefined;

  return (
    <aside className="mp-side" data-map-detail>
      <div className="mp-side-head">
        <b className="mp-side-title">
          {node.label} {node.id}
        </b>
        <button className="mp-side-x" data-map-detail-close aria-label="关闭详情" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="mp-side-body">
        {claim && (
          <>
            <Row k="全文">{claim.text}</Row>
            <Row k="原文">
              {claim.quote ? <span className="mp-quote">「{claim.quote}」</span> : '报告没有给出原文引文'}
            </Row>
            <Row k="可接受性">{ACCEPT_LABEL[claim.acceptability.status]}</Row>
            <Row k="是否推定">{claim.implicit ? '是（原文没说出口）' : '否'}</Row>
            {claim.role !== 'conclusion' && (
              <Row k="它支撑谁">
                {claim.supports.length
                  ? claim.supports.map((id) => locationLabel(d, id)).join('、')
                  : '报告没写它支撑谁'}
              </Row>
            )}
          </>
        )}
        {check && (
          <>
            <Row k="答复">
              <span className="mp-tag">{ANSWER_LABEL[check.answer]}</span>
            </Row>
            <Row k="问题">{check.question}</Row>
            <Row k="依据">{check.basis || '报告没写依据'}</Row>
            {/*
              详情面板只有 260px，一屏能同时读到的行有限。
              先给「答了什么、依据是什么」，出处与落点收进「更多」——
              不折叠关键行，读完三行就知道这一关过没过。
            */}
            {(check.guards || check.landsOn) && (
              <details className="mp-more">
                <summary>更多</summary>
                <Row k="守着哪一处">{check.guards || '报告没写'}</Row>
                {check.landsOn ? <Row k="落到名录">{check.landsOn}</Row> : null}
              </details>
            )}
          </>
        )}
        {ref && (
          <>
            <Row k="打法">{STRATEGY_LABEL[ref.strategy] ?? ref.strategy}</Row>
            <Row k="说法">{ref.claim}</Row>
            <Row k="对方最强反击">{ref.steelman || '报告没写'}</Row>
            <Row k="打向">{locationLabel(d, ref.targetId)}</Row>
            <details className="mp-more">
              <summary>更多</summary>
              {ref.script ? <Row k="可直接说">{ref.script}</Row> : null}
              {ref.reply ? <Row k="回应">{ref.reply}</Row> : null}
              <Row k="要什么证据">
                {ref.evidenceNeeded.length ? ref.evidenceNeeded.join('、') : '报告没写'}
              </Row>
            </details>
          </>
        )}
        {rev && (
          <>
            <Row k="名字">{rev.kind}</Row>
            <Row k="怎么改">{rev.change}</Row>
            <Row k="代价">{rev.cost}</Row>
            <Row k="修的是">
              {rev.fixes.length ? rev.fixes.map((id) => locationLabel(d, id)).join('、') : '报告没写要修哪几处'}
            </Row>
            <details className="mp-more">
              <summary>更多</summary>
              <Row k="保住">{rev.keeps || '报告没写'}</Row>
              <Row k="仍没解决">{rev.leaves || '报告没写'}</Row>
            </details>
          </>
        )}
      </div>
    </aside>
  );
}

/* ─────────── 地图 ─────────── */

const VIEW_PAD = 16;

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

function nodeColor(n: MapNode): string {
  if (n.kind === 'conclusion') return C.accent;
  if (n.kind === 'refutation') return C.invalid;
  if (n.kind === 'revision') return C.accent;
  if (n.kind === 'check') {
    if (n.status === 'passed') return C.strong;
    if (n.status === 'violated') return C.invalid;
    if (n.status === 'unanswered') return C.weak;
    return C.ink3;
  }
  return C.ink3;
}

const EDGE_LABEL: Record<MapEdgeKind, string> = {
  support: '支撑',
  attack: '打向',
  repair: '改向',
};

function edgeStyle(kind: MapEdgeKind): { stroke: string; width: number; dash?: string; marker: string } {
  if (kind === 'attack') return { stroke: C.invalid, width: 1.8, dash: '5 4', marker: 'mp-ar-attack' };
  /* 改法是「如果这样改会碰到哪」，不是主结构；线细一点、淡一点，免得盖过支撑。 */
  if (kind === 'repair') return { stroke: C.accent, width: 1.3, dash: '2 4', marker: 'mp-ar-repair' };
  return { stroke: C.edge, width: 1.5, marker: 'mp-ar-support' };
}

function edgeD(a: MapNode, b: MapNode): string {
  const acx = a.x + a.w / 2;
  const bcx = b.x + b.w / 2;
  if (a.y + a.h <= b.y) {
    const sy = a.y + a.h;
    const ty = b.y;
    const dy = Math.max(26, (ty - sy) * 0.5);
    return `M${acx},${sy} C${acx},${sy + dy} ${bcx},${ty - dy} ${bcx},${ty}`;
  }
  if (b.y + b.h <= a.y) {
    const sy = a.y;
    const ty = b.y + b.h;
    const dy = Math.max(26, (sy - ty) * 0.5);
    return `M${acx},${sy} C${acx},${sy - dy} ${bcx},${ty + dy} ${bcx},${ty}`;
  }
  const rightward = bcx >= acx;
  const sx = rightward ? a.x + a.w : a.x;
  const sy = a.y + a.h / 2;
  const tx = rightward ? b.x : b.x + b.w;
  const ty = b.y + b.h / 2;
  const dx = Math.max(30, Math.abs(tx - sx) * 0.5);
  const c1 = sx + (rightward ? dx : -dx);
  const c2 = tx + (rightward ? -dx : dx);
  return `M${sx},${sy} C${c1},${sy} ${c2},${ty} ${tx},${ty}`;
}

export function ArgumentMapView({ d }: { d: Diagnosis }) {
  const map = useMemo(() => buildMap(d), [d]);
  const fit = useMemo<View>(
    () => ({ x: -VIEW_PAD, y: -VIEW_PAD, w: map.width + VIEW_PAD * 2, h: map.height + VIEW_PAD * 2 }),
    [map]
  );
  const [view, setView] = useState<View>(fit);
  const [sel, setSel] = useState<string | null>(null);
  /**
   * 选中一个节点后，是否把无关的节点与连线淡下去。
   *
   * 默认开：三种改法一摆，蓝色虚线会横穿整张图；不透一下，读者要花很久才看得出
   * 一条改法到底碰到哪几处。它只改透明度，不改数据、不改位置，也不判轻重。
   */
  const [focus, setFocus] = useState(true);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef<{ cx: number; cy: number; vx: number; vy: number; s: number; moved: boolean } | null>(null);
  const suppress = useRef(false);
  const minW = fit.w / 3;
  const maxW = fit.w / 0.3;
  const AR = fit.h / fit.w;

  const clamp = useCallback(
    (v: View): View => {
      const w = Math.min(Math.max(v.w, minW), maxW);
      const h = w * AR;
      const x = Math.min(Math.max(v.x, -w + 80), map.width - 80);
      const y = Math.min(Math.max(v.y, -h + 80), map.height - 80);
      return { x, y, w, h };
    },
    [AR, map.width, map.height, minW, maxW]
  );

  const zoomAt = useCallback(
    (px: number, py: number, factor: number) => {
      setView((v) => {
        const w = Math.min(Math.max(v.w * factor, minW), maxW);
        const ratio = w / v.w;
        return clamp({ x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio, w, h: v.h * ratio });
      });
    },
    [clamp, minW, maxW]
  );

  const zoomBy = (factor: number) => {
    zoomAt(view.x + view.w / 2, view.y + view.h / 2, factor);
  };

  /** 屏幕坐标 → SVG 坐标。viewBox 用 meet，所以两侧/上下可能留黑边。 */
  const pointOf = (clientX: number, clientY: number, v: View): { x: number; y: number; s: number } => {
    const el = svgRef.current;
    if (!el) return { x: v.x + v.w / 2, y: v.y + v.h / 2, s: 1 };
    const rect = el.getBoundingClientRect();
    const s = Math.min(rect.width / v.w, rect.height / v.h) || 1;
    const ox = (rect.width - v.w * s) / 2;
    const oy = (rect.height - v.h * s) / 2;
    return { x: v.x + (clientX - rect.left - ox) / s, y: v.y + (clientY - rect.top - oy) / s, s };
  };

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = pointOf(e.clientX, e.clientY, viewRef.current);
      zoomAt(p.x, p.y, e.deltaY > 0 ? 1.12 : 1 / 1.12);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const el = svgRef.current;
    if (!el) return;
    const p = pointOf(e.clientX, e.clientY, viewRef.current);
    drag.current = { cx: e.clientX, cy: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y, s: p.s, moved: false };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // @allow-silent: 合成指针事件或某些环境里没有可捕获的活动指针，setPointerCapture 会抛。
      // 拖拽本身仍由 svg 上的 pointermove 处理；这里失败不该让整张图崩掉。
    }
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const g = drag.current;
    if (!g) return;
    const dx = e.clientX - g.cx;
    const dy = e.clientY - g.cy;
    if (!g.moved && Math.abs(dx) + Math.abs(dy) > 3) g.moved = true;
    setView((v) => clamp({ ...v, x: g.vx - dx / g.s, y: g.vy - dy / g.s }));
  };
  const onPointerUp = () => {
    if (drag.current?.moved) {
      suppress.current = true;
      window.setTimeout(() => {
        suppress.current = false;
      }, 0);
    }
    drag.current = null;
  };

  /**
   * 让选中的节点留在详情面板左侧。
   *
   * 详情是覆盖在地图右缘的（不挤压画布），点检查列里那一格时面板正好盖住它，
   * 用户会以为自己点空了。这里只在地图内平移，不改缩放：把节点右缘推到
   * 面板左边留 16px 的位置。
   */
  const ensureVisible = (n: MapNode) => {
    setView((v) => {
      const cssW = svgRef.current?.clientWidth ?? 0;
      const reserve = cssW > 0 ? (v.w * Math.min(0.45, 284 / cssW)) : 0;
      let x = v.x;
      if (n.x + n.w > v.x + v.w - reserve) x = n.x + n.w - (v.w - reserve);
      if (n.x < x + 16) x = n.x - 16;
      return clamp({ ...v, x });
    });
  };

  const onNodeKey = (e: ReactKeyboardEvent<SVGGElement>, n: MapNode) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSel(n.id);
      ensureVisible(n);
    }
  };

  const selNode = sel ? map.nodes.find((n) => n.id === sel) ?? null : null;
  /** 三类线各几条。只数报告写下的连线，不把「没画出来」算进去。 */
  const edgeCounts = useMemo(() => {
    const c = { support: 0, attack: 0, repair: 0 };
    for (const e of map.edges) c[e.kind] += 1;
    return c;
  }, [map.edges]);
  /** 与选中节点直接相连的节点（含它自己）。只算一跳，不替读者推断更远的关系。 */
  const related = useMemo(() => {
    if (!sel) return null;
    const set = new Set<string>([sel]);
    for (const e of map.edges) {
      if (e.from === sel) set.add(e.to);
      else if (e.to === sel) set.add(e.from);
    }
    return set;
  }, [sel, map.edges]);
  const refs = map.nodes.filter((n) => n.kind === 'refutation');
  const revs = map.nodes.filter((n) => n.kind === 'revision');
  const checks = map.nodes.filter((n) => n.kind === 'check');
  const labelOf = (list: MapNode[]) => (list.length ? Math.min(...list.map((n) => n.y)) - 10 : 0);

  return (
    <section
      className="mp-wrap"
      data-arg-map
      onKeyDown={(e) => {
        /* Esc 只关这一层详情；分析进行中的「Esc = 停」归 App，不在这里抢。 */
        if (e.key === 'Escape' && sel) {
          e.stopPropagation();
          setSel(null);
        }
      }}
    >
      <div className="mp-bar">
        <b className="mp-title">论证地图</b>
        <span className="mp-sub">结论在右，检查在更右；反驳在上，改法在下。</span>
        <span className="mp-count" data-map-count>
          {map.nodes.length} 个节点 · 支撑 {edgeCounts.support} / 打向 {edgeCounts.attack} / 改向{' '}
          {edgeCounts.repair}
        </span>
      </div>

      <div className="mp-canvas">
        <svg
          ref={svgRef}
          className="mp-svg"
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          preserveAspectRatio="xMidYMid meet"
          role="group"
          aria-label="论证地图"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          /* 点空白关详情；双击空白回全图。节点与线自己处理点击，不会误触。 */
          onClick={(e) => {
            if ((e.target as Element).tagName.toLowerCase() === 'svg') setSel(null);
          }}
          onDoubleClick={(e) => {
            if ((e.target as Element).tagName.toLowerCase() === 'svg') setView(fit);
          }}
        >
          <defs>
            <marker id="mp-ar-support" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill={C.edge} />
            </marker>
            <marker id="mp-ar-attack" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill={C.invalid} />
            </marker>
            <marker id="mp-ar-repair" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill={C.accent} />
            </marker>
          </defs>

          {map.edges.map((e) => {
            const a = map.nodes.find((n) => n.id === e.from);
            const b = map.nodes.find((n) => n.id === e.to);
            if (!a || !b) return null;
            const s = edgeStyle(e.kind);
            const active = sel ? e.from === sel || e.to === sel : false;
            const dim = !!sel && focus && !active;
            return (
              <path
                key={`${e.kind}:${e.from}->${e.to}`}
                d={edgeD(a, b)}
                data-map-edge={e.kind}
                data-map-dim={dim ? '1' : '0'}
                fill="none"
                stroke={s.stroke}
                strokeWidth={s.width}
                strokeDasharray={s.dash}
                markerEnd={`url(#${s.marker})`}
                opacity={dim ? 0.1 : e.kind === 'repair' ? 0.72 : 0.95}
              >
                {/* 线交在一起时，悬停能读出这是哪一类、从哪儿到哪儿；不另加标签，免得更挤。 */}
                <title>{`${EDGE_LABEL[e.kind]}：${a.label} ${a.id} → ${b.label} ${b.id}`}</title>
              </path>
            );
          })}

          {refs.length > 0 && (
            <g>
              <text x={32} y={labelOf(refs)} fontSize={12} fill={C.ink3} fontWeight={600}>
                反驳
              </text>
              <line x1={32} x2={map.width - 32} y1={labelOf(refs) + 6} y2={labelOf(refs) + 6} stroke={C.line} />
            </g>
          )}
          {checks.length > 0 && (
            <text x={checks[0].x} y={labelOf(checks)} fontSize={12} fill={C.ink3} fontWeight={600}>
              逐关检查
            </text>
          )}
          {revs.length > 0 && (
            <g>
              <text x={32} y={labelOf(revs)} fontSize={12} fill={C.ink3} fontWeight={600}>
                三种改法
              </text>
              <line x1={32} x2={map.width - 32} y1={labelOf(revs) + 6} y2={labelOf(revs) + 6} stroke={C.line} />
            </g>
          )}

          {map.nodes.map((n) => {
            const on = sel === n.id;
            const dim = !!sel && focus && !!related && !related.has(n.id);
            const color = nodeColor(n);
            const lines = wrap(n.text, MAP_TEXT_BUDGET, MAP_MAX_LINES);
            return (
              <g
                key={n.id}
                className="mp-node"
                data-map-node={n.id}
                data-map-node-kind={n.kind}
                data-map-dim={dim ? '1' : '0'}
                opacity={dim ? 0.28 : 1}
                role="button"
                tabIndex={0}
                aria-label={`${n.label} ${n.id}`}
                onClick={() => {
                  if (suppress.current) return;
                  if (on) {
                    setSel(null);
                    return;
                  }
                  setSel(n.id);
                  ensureVisible(n);
                }}
                onKeyDown={(e) => onNodeKey(e, n)}
              >
                <title>{`${n.label} ${n.id}\n${n.text}`}</title>
                {on && (
                  <rect
                    x={n.x - 3}
                    y={n.y - 3}
                    width={n.w + 6}
                    height={n.h + 6}
                    rx={7}
                    fill="none"
                    stroke={C.accent}
                    strokeWidth={2}
                  />
                )}
                <rect
                  x={n.x}
                  y={n.y}
                  width={n.w}
                  height={n.h}
                  rx={4}
                  fill={n.kind === 'conclusion' ? C.panel : C.panel2}
                  stroke={C.lineStrong}
                  strokeWidth={1}
                />
                <rect x={n.x} y={n.y} width={3} height={n.h} rx={1.5} fill={color} />
                <text x={n.x + 12} y={n.y + 18} fontSize={12} fill={color} fontWeight={600}>
                  {n.id} · {n.label}
                </text>
                {n.status ? (
                  <text x={n.x + n.w - 10} y={n.y + 18} fontSize={12} textAnchor="end" fill={color}>
                    {ANSWER_LABEL[n.status]}
                  </text>
                ) : null}
                {lines.map((ln, i) => (
                  <text
                    key={i}
                    x={n.x + 12}
                    y={n.y + MAP_BODY_TOP + i * MAP_LINE_H}
                    fontSize={12}
                    fill={n.kind === 'conclusion' ? C.ink : C.ink2}
                    fontWeight={n.kind === 'conclusion' ? 600 : 400}
                  >
                    {ln}
                  </text>
                ))}
              </g>
            );
          })}
        </svg>

        <div className="mp-zoom">
          <span className="mp-pct">{Math.round((fit.w / view.w) * 100)}%</span>
          {/* viewBox 越小 = 放大，所以「放大」传小于 1 的倍数；写反了按钮会反着走。 */}
          <button className="mp-zoom-btn" data-map-zoom-out aria-label="缩小" onClick={() => zoomBy(1.25)}>
            −
          </button>
          <button className="mp-zoom-btn" data-map-zoom-fit onClick={() => setView(fit)}>
            适应
          </button>
          <button className="mp-zoom-btn" data-map-zoom-in aria-label="放大" onClick={() => zoomBy(1 / 1.25)}>
            ＋
          </button>
          {sel && (
            <button
              className="mp-zoom-btn"
              data-map-focus
              aria-pressed={focus}
              title={focus ? '显示整张图' : '只看与选中节点直接相连的节点与线'}
              onClick={() => setFocus((v) => !v)}
            >
              {focus ? '看全部' : '只看相连'}
            </button>
          )}
        </div>

        {selNode && <MapDetail d={d} node={selNode} onClose={() => setSel(null)} />}
      </div>

      <div className="mp-legend">
        <Legend
          items={[
            { kind: 'line', label: '支撑' },
            { kind: 'dash', label: '打向（反驳）', color: C.invalid },
            { kind: 'dash', label: '改向（改法）', color: C.accent },
            { kind: 'dot', label: '检查已过', color: C.strong },
            { kind: 'dot', label: '检查未答', color: C.weak },
            { kind: 'dot', label: '检查被违反', color: C.invalid },
            { kind: 'dot', label: '检查不适用', color: C.ink3 },
          ]}
        />
      </div>

      <p className="mp-note">{MAP_NOTE}</p>
      {map.problems.length > 0 && (
        <ul className="mp-problems" data-map-problems>
          {map.problems.map((p, i) => (
            <li className="mp-problem" key={i}>
              {p}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
