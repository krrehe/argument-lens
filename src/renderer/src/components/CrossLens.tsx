import type { CrossLensView } from '@shared/cross-lens';
import type { TheoryId } from '@shared/theories';

/**
 * 同一段文字，六副透镜各盯住了哪里。
 *
 * 只并列每副透镜报告里写下的「最弱的一处」，不显示档位、不排序、不投票。
 * 档位跨透镜不可换算；把它摆进来，读者会自然去比高低，而那正是报告没说过的话。
 */
export function CrossLensCard({
  view,
  currentId,
  onPickTheory,
  onOpenReport,
}: {
  view: CrossLensView;
  /** 屏幕上这份报告的 id：同一份不再给一个「打开自己」的按钮。 */
  currentId?: string;
  /** 点一副没跑过的透镜：只切换透镜，不自动重跑。 */
  onPickTheory?: (id: TheoryId) => void;
  /** 打开那一份存档报告。 */
  onOpenReport?: (id: string) => void;
}) {
  return (
    <div className="cl" data-cross-lens data-cross-count={view.rows.length}>
      <p className="cl-line" data-cross-line>
        {view.line}
      </p>
      <ul className="cl-list">
        {view.rows.map((r) => (
          <li
            className="cl-row"
            key={r.theory}
            data-cross-row={r.theory}
            data-cross-applicable={r.applicable ? '1' : '0'}
          >
            <span className="cl-name">{r.short}</span>
            <span className="cl-weak" data-cross-weak data-cross-kind={r.applicable ? r.weakKind : 'na'} title={r.applicable ? r.weak : r.reason}>
              <em className="cl-kind">
                {r.applicable ? (r.weakKind === 'weakest' ? '最弱的一处' : r.weakKind === 'verdict' ? '判读句' : '没写') : '不适用'}
              </em>
              {r.applicable
                ? r.weak || '（这份报告没有写「最弱的一处」）'
                : r.reason || '（没写理由）'}
            </span>
            <span className="cl-meta">
              {r.applicable
                ? `${r.checks.total} 条检查 · 未答 ${r.checks.unanswered} · 未过 ${r.checks.violated} · `
                : '这副透镜没有检查项 · '}
              {new Date(r.at).toLocaleDateString('zh-CN')}
            </span>
            {onOpenReport && r.reportId !== currentId && (
              <button
                className="cl-open"
                data-cross-open={r.theory}
                onClick={() => onOpenReport(r.reportId)}
                title={`打开「${r.name}」这一份报告`}
              >
                打开
              </button>
            )}
          </li>
        ))}
      </ul>
      {view.missing.length > 0 && (
        <div className="cl-missing" data-cross-missing>
          <span>还没跑过：</span>
          {view.missing.map((x) =>
            onPickTheory ? (
              <button
                key={x.theory}
                className="cl-pick"
                data-cross-pick={x.theory}
                onClick={() => onPickTheory(x.theory)}
                title={`换到「${x.name}」；只切换透镜，不自动重跑`}
              >
                {x.short}
              </button>
            ) : (
              <span key={x.theory}>{x.short}</span>
            )
          )}
          {onPickTheory && <span className="cl-pick-note">只切换透镜，不自动重跑。</span>}
        </div>
      )}
      <p className="cl-caveat" data-cross-caveat>
        {view.caveat}
      </p>
    </div>
  );
}
