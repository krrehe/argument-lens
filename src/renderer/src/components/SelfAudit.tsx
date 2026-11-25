import {
  SELF_AUDIT_KIND_LABEL,
  SELF_AUDIT_SOURCE_LABEL,
  type SelfAuditView,
} from '@shared/self-audit';

/**
 * 自省账本。
 *
 * 只排版 `selfAuditOf` 算出来的线索：来源、类别、原文。
 * 不在这里加一句「所以这份报告不可信」——每条线索的分量由读者自己判。
 */
export function SelfAuditCard({ view }: { view: SelfAuditView }) {
  return (
    <div className="sa" data-self-audit data-self-audit-count={view.items.length}>
      <p className="sa-line" data-self-audit-line>
        {view.line}
      </p>
      <p className="sa-caveat">
        这是自省，不是判决：模型自认的、本地数的、深查账本里留下的分开摆；软件不另加一条判断。
      </p>
      <ul className="sa-list">
        {view.items.map((x) => (
          <li
            key={x.id}
            className="sa-item"
            data-self-audit-item={x.kind}
            data-self-audit-source={x.source}
          >
            <span className="sa-src">{SELF_AUDIT_SOURCE_LABEL[x.source]}</span>
            <span className="sa-kind">{SELF_AUDIT_KIND_LABEL[x.kind]}</span>
            <span className="sa-text">{x.text}</span>
            {x.detail && <span className="sa-detail">{x.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
