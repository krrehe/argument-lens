import { THEORY_BY_ID, type TheoryId } from '@shared/theories';
import { THEORY_NOTES } from '@shared/theory-notes';
import { LensMap } from './Diagram';
import { usePlain } from './Term';
import { ClaimRefs } from './TheoryBase';

/**
 * 透镜说明 + 地形图 + 理论卡。
 *
 * 这一栏不是帮助文档，是判定的一部分：用户必须能看见这副透镜问什么、
 * 什么时候会失效，否则他会把一份有边界的分析当成无条件的结论。
 *
 * 上半部分答「它问什么」，地形图答「它为什么不能和别副混着用」，
 * 理论卡答「你凭什么这么判」——最后一问是这一轮补的，也是最容易被跳过的一问。
 * 只答「沃尔顿说的」是把权威当理由，而反对把权威当理由，正是这个工具的立场。
 */
export function TheoryBrief({
  theory,
  onSwitch,
  onOpenClaim,
}: {
  theory: TheoryId;
  onSwitch: (id: TheoryId) => void;
  /** 点「这一栏站在哪几条主张上」里的某一条时，打开主张库并定位过去 */
  onOpenClaim: (id: string) => void;
}) {
  const t = THEORY_BY_ID[theory];
  const note = THEORY_NOTES[theory];
  const plain = usePlain();

  return (
    <div className="brief">
      <h4>这套透镜怎么问</h4>
      <p className="claim">{plain ? t.plainClaim : t.claim}</p>

      <h4>一次判断落在什么上</h4>
      <p>{plain ? t.plainUnit : t.unit}</p>

      <h4>它自己的刻度</h4>
      <p>{t.scale}</p>

      <h4>什么时候该用它</h4>
      <ul>
        {t.appliesWhen.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>

      <h4>什么时候它必然失效</h4>
      <ul className="no">
        {t.failsWhen.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>

      <div className="caveat">{t.caveat}</div>

      <h4 style={{ marginTop: 18 }}>它站在哪</h4>
      <p style={{ marginBottom: 2 }}>{t.mapNote}</p>
      <LensMap current={theory} onPick={onSwitch} />

      <details className="tcard">
        <summary>凭什么这么判（想追问的人点这里）</summary>

        <div className="tc-sec">
          <div className="tc-label">道理在哪</div>
          <p>{note.ground}</p>
        </div>

        <div className="tc-sec">
          <div className="tc-label">谁反对它，它怎么答</div>
          <ul className="tc-obj">
            {note.objections.map((o, i) => (
              <li key={i}>
                <div className="tc-who">{o.who}</div>
                <div className="tc-what">{o.what}</div>
                <div className="tc-ans">
                  <span className="tc-ans-tag">回应</span>
                  {o.answer}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="tc-sec">
          <div className="tc-label">它测不出什么</div>
          <ul className="tc-blind">
            {note.blind.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>

        <div className="tc-sec">
          <div className="tc-label">出处（可查）</div>
          <ul className="tc-refs">
            {note.refs.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      </details>

      <ClaimRefs theory={theory} onOpen={onOpenClaim} />

      <h4>出处</h4>
      <p style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{t.source}</p>
    </div>
  );
}
