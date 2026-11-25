/**
 * 同一段文字，六副透镜各盯住了哪里。
 *
 * 这不是「六副投票」。每副透镜的刻度、检查项与档位都不同，加起来、取多数、
 * 排高低都会造出一个报告里没有的判断。这里只做一件本地能证实的事：
 * 在同一段原文、同一个模式下，把每副透镜**最近一次**报告里写下的「最弱的一处」
 * 并列出来，让读者看见换一副透镜会换一双眼睛。
 *
 * 三条边界：
 *   1. 只读已落盘的报告，不调模型、不重判、不写盘；
 *   2. 只认同原文（空白归一后逐字相同）与同模式；不同模式不混在一起；
 *   3. 每副透镜只取最近一份，按透镜固定顺序排——不按档位、不按时间、不按「谁更严重」。
 */
import type { AgreementItem } from './agreement';
import type { Diagnosis } from './types';
import { THEORIES, THEORY_BY_ID, type TheoryId } from './theories';

export interface CrossLensRow {
  theory: TheoryId;
  name: string;
  short: string;
  at: number;
  reportId: string;
  /** 逐字取自报告的「最弱的一处」；没写就退回判读句；两者都空时为空串。 */
  weak: string;
  /** 这段文字到底取自哪一栏：最弱的一处 / 判读句 / 两栏都空。 */
  weakKind: 'weakest' | 'verdict' | 'none';
  /** 这副透镜判了「不适用」：没有检查项，也不该把不适用理由当成「最弱的一处」。 */
  applicable: boolean;
  /** 不适用时逐字取报告的 `scope.reason`；适用时为空串。 */
  reason: string;
  checks: { total: number; unanswered: number; violated: number };
  version: string | null;
}

export interface CrossLensView {
  rows: CrossLensRow[];
  missing: { theory: TheoryId; name: string; short: string }[];
  line: string;
  caveat: string;
}

/** 原文判等只做空白归一：多一个换行不该让同一段变成两段。 */
function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export const CROSS_LENS_CAVEAT =
  '不同透镜的刻度不可换算，同一处被几副透镜盯住也不等于它已被证实——它们问的不是同一个问题。';

function rowOf(theory: TheoryId, at: number, reportId: string, version: string | null, r: Partial<Diagnosis>): CrossLensRow {
  const t = THEORY_BY_ID[theory];
  const applicable = r.scope?.applicable !== false;
  const checks = applicable && Array.isArray(r.checks) ? r.checks : [];
  const weakest = applicable ? String(r.overall?.weakest?.what ?? '').trim() : '';
  const verdict = applicable ? String(r.verdict?.statement ?? '').trim() : '';
  const weak = weakest || verdict;
  const weakKind: CrossLensRow['weakKind'] = !weak ? 'none' : weakest ? 'weakest' : 'verdict';
  const reason = applicable ? '' : String(r.scope?.reason ?? '').trim();
  return {
    theory,
    name: t.name,
    short: t.short,
    at,
    reportId,
    weak,
    weakKind,
    applicable,
    reason,
    checks: {
      total: checks.length,
      unanswered: checks.filter((c) => c.answer === 'unanswered').length,
      violated: checks.filter((c) => c.answer === 'violated').length,
    },
    version,
  };
}

/**
 * `current` 是屏幕上这份报告：它可能刚跑完、还没被存档扫描到。
 * 同一副透镜下，它比存档里那份更新时就用它，而不是让读者看到一份旧的。
 */
export function crossLensOf(
  passage: string,
  mode: string,
  items: AgreementItem[],
  current?: Diagnosis
): CrossLensView {
  const p = norm(passage);
  const empty: CrossLensView = { rows: [], missing: [], line: '', caveat: CROSS_LENS_CAVEAT };
  if (!p) return empty;

  const latest = new Map<TheoryId, { it: AgreementItem }>();
  for (const it of items) {
    if (it.mode !== mode) continue;
    if (norm(it.passage) !== p) continue;
    const theory = it.theory as TheoryId;
    if (!THEORY_BY_ID[theory]) continue;
    const prev = latest.get(theory);
    if (!prev || it.at > prev.it.at) latest.set(theory, { it });
  }
  if (current && current.mode === mode && norm(current.passage ?? '') === p && THEORY_BY_ID[current.theory]) {
    const prev = latest.get(current.theory);
    if (!prev || current.createdAt >= prev.it.at) {
      latest.set(current.theory, {
        it: {
          id: current.id,
          at: current.createdAt,
          mode: current.mode,
          theory: current.theory,
          version: current.prompt?.version ?? null,
          fingerprint: current.prompt?.fingerprint ?? null,
          passage: current.passage ?? '',
          report: current,
        },
      });
    }
  }

  const rows: CrossLensRow[] = [];
  const missing: CrossLensView['missing'] = [];
  for (const t of THEORIES) {
    const hit = latest.get(t.id);
    if (!hit) {
      missing.push({ theory: t.id, name: t.name, short: t.short });
      continue;
    }
    rows.push(
      rowOf(t.id, hit.it.at, hit.it.id, hit.it.version, hit.it.report as Partial<Diagnosis>)
    );
  }

  const notApplicable = rows.filter((r) => !r.applicable).length;
  const applicable = rows.length - notApplicable;
  const tail = notApplicable
    ? `其中 ${notApplicable} 副判了「不适用」，它们没有可并列的弱点。`
    : '';
  const line =
    rows.length >= 2
      ? `这段文字在 ${rows.length} 副透镜下跑过（共 ${THEORIES.length} 副），${applicable} 副给出了可并列的判断。下面只并列每副写下的「最弱的一处」（没写就退到判读句），不换算档位、不投票、不排名。${tail}`
      : rows.length === 1
        ? `这段文字只跑过「${rows[0].short}」这一副透镜。换一副再看，才知道别的透镜会盯住哪里；这里不替你排哪副更好。`
        : '';

  return { rows, missing, line, caveat: CROSS_LENS_CAVEAT };
}
