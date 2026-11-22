import type { OverallAnalysis, OverallChange, OverallPoint, RevisionPath } from './types';
import { MODE_META, type Diagnosis } from './types';
import { versionAtLeast } from './version';

/**
 * 整体分析与三种改法的形状核对（纯函数）。
 *
 * 这一层只回答一个问题：**模型写下的这一栏，能不能挂到这份报告已有的位置上。**
 * 它不判断「最弱的一处」是不是真的最弱，也不判断「这样改」对不对——
 * 那些是模型写下的判断，本地没有第二把尺子。
 *
 * 三条硬边界：
 *   1. 不补一句本地判断：文字逐字来自模型，核对只做丢弃与留痕；
 *   2. 指错的落点不替它猜：`at` 不在报告的编号里就丢掉那一格的位置，
 *      并把问题说出来，而不是顺手挂到第一条前提上；
 *   3. 空就是空：正文为空时整栏不成立，不拿「整体尚可」这类话凑一格。
 */

export interface OverallParse {
  value: OverallAnalysis | null;
  problems: string[];
}

export interface RevisionsParse {
  value: RevisionPath[] | null;
  problems: string[];
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function point(v: unknown, ids: Set<string>, label: string, problems: string[]): OverallPoint | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const what = text(o.what);
  const why = text(o.why);
  if (!what && !why) return null;
  let at = text(o.at) || null;
  if (at && !ids.has(at)) {
    problems.push(`${label}的落点「${at}」在报告里不存在，已丢弃位置`);
    at = null;
  }
  return { at, what, why };
}

function change(v: unknown, ids: Set<string>, problems: string[]): OverallChange | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const how = text(o.change);
  const because = text(o.because);
  if (!how) {
    problems.push('「只改一处」没有写出怎么改，整格不显示');
    return null;
  }
  let at = text(o.at) || null;
  if (at && !ids.has(at)) {
    problems.push(`「只改一处」的落点「${at}」在报告里不存在，已丢弃位置`);
    at = null;
  }
  return { at, change: how, because };
}

export function normalizeOverall(raw: unknown, ids: Set<string>): OverallParse {
  if (raw === undefined || raw === null) return { value: null, problems: [] };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { value: null, problems: ['整体分析不是一个对象，整栏不显示'] };
  }
  const o = raw as Record<string, unknown>;
  const summary = text(o.summary);
  const problems: string[] = [];
  if (!summary) {
    problems.push('整体分析没有正文，整栏不显示');
    return { value: null, problems };
  }
  return {
    value: {
      summary,
      strongest: point(o.strongest, ids, '「最强的一处」', problems),
      weakest: point(o.weakest, ids, '「最弱的一处」', problems),
      ifOneChange: change(o.ifOneChange, ids, problems),
    },
    problems,
  };
}

export function normalizeRevisions(raw: unknown, ids: Set<string>): RevisionsParse {
  if (raw === undefined || raw === null) return { value: null, problems: [] };
  if (!Array.isArray(raw)) {
    return { value: null, problems: ['三种改法不是一个数组，整栏不显示'] };
  }
  const problems: string[] = [];
  const out: RevisionPath[] = [];
  for (const [i, item] of raw.entries()) {
    if (!item || typeof item !== 'object') {
      problems.push(`第 ${i + 1} 种改法不是一个对象，已跳过`);
      continue;
    }
    const o = item as Record<string, unknown>;
    const how = text(o.change);
    const cost = text(o.cost);
    if (!how) {
      problems.push(`第 ${i + 1} 种改法没有写出怎么改，已跳过`);
      continue;
    }
    /*
     * 没写代价的改法不显示。
     *
     * 这不是排版偏好：只写「补一句前提」不写「会把你没说过的话算到你头上」，
     * 读者会把它当成免费的建议，而每一种改法都要付点什么。缺代价的那一条
     * 留着，等于把许愿混进方案里。
     */
    if (!cost) {
      problems.push(`第 ${i + 1} 种改法（${text(o.kind) || '未命名'}）没有写代价，已跳过`);
      continue;
    }
    const fixes = Array.isArray(o.fixes)
      ? o.fixes
          .map((x) => text(x))
          .filter((x) => Boolean(x))
          .filter((x) => {
            if (ids.has(x)) return true;
            problems.push(`第 ${i + 1} 种改法指向的「${x}」在报告里不存在，已从落点里去掉`);
            return false;
          })
      : [];
    out.push({
      kind: text(o.kind) || `改法 ${i + 1}`,
      change: how,
      keeps: text(o.keeps),
      cost,
      fixes,
      leaves: text(o.leaves),
    });
  }
  return { value: out.length ? out : null, problems };
}

/** 新报告应该给到三种改法；少给时由界面照实说，不替它补第三种。 */
export const REVISION_EXPECTED = 3;

export function revisionShortfall(revisions: RevisionPath[] | null | undefined): string | null {
  const n = revisions?.length ?? 0;
  if (n === 0) return '模型这次没有给出改法。';
  if (n < REVISION_EXPECTED) return `模型这次只给了 ${n} 种改法，不是 ${REVISION_EXPECTED} 种；少的那几种没有本地补写。`;
  return null;
}

/**
 * 界面与导出共用的一句话。
 *
 * 口径必须一处：说「这些文字由模型写、本地只核对落点」的地方多写一份，
 * 迟早在某一处变成「本地分析」，而那正是产品定位明令禁止的旧宣称。
 */
export const OVERALL_NOTE =
  '整体分析由模型写出；本地只核对它指的位置在报告里存不存在，不改判读，也不与档位互相折算。';

export const REVISIONS_NOTE =
  '改法与代价都由模型写出；本地只核对每一处落点是否存在，不替它补第三种改法，也不判断哪一种更好。';

/**
 * 这份报告「本应有」整体分析吗？
 *
 * 两个条件缺一不可：这个模式给档位（诊断 / 红队），且提示词版本至少 3.0.0。
 * 旧存档没有这一栏是历史事实，不该补一段空标题；新报告缺了它才是模型漏答，
 * 界面要照实说「这次没给」，而不是让整栏静默消失——静默消失会被读成「不需要」。
 */
export function expectsOverall(d: Diagnosis): boolean {
  return MODE_META[d.mode].givesVerdict && versionAtLeast(d.prompt?.version, '3.0.0');
}

export function expectsRevisions(d: Diagnosis): boolean {
  return expectsOverall(d);
}

/**
 * 把报告里的编号换成人话位置。
 *
 * 整体分析与改法都要求「指得出位置」，但只写 `P1` / `C` / `CQ2`，第一次读的人
 * 还得回正文找它是前提、结论还是某一关。这里只做一件事：把编号翻译成
 * 「结论 C / 前提 P1 / 检查 CQ2 · 因果方向」，**不改变编号、不补一条判断**。
 * 找不到对应位置时原样返回——宁可露出一个编号，也不猜它属于哪一类。
 */
export function locationLabel(d: Diagnosis, id: string | null | undefined): string {
  if (!id) return '';
  if (d.conclusion?.id === id) return `结论 ${id}`;
  if (d.premises.some((p) => p.id === id)) return `前提 ${id}`;
  if (d.intermediate.some((m) => m.id === id)) return `中间结论 ${id}`;
  const c = d.checks.find((x) => x.id === id);
  if (c) {
    const label = (c.label ?? '').trim();
    if (!label) return `检查 ${id}`;
    return label.startsWith(id) ? `检查 ${label}` : `检查 ${id} · ${label}`;
  }
  return id;
}
