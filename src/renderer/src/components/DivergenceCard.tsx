import type { Divergence, DivergenceEntry, DivergencePatch } from '@shared/types';
import {
  BRANCH_MAX,
  CLOSURE_MODES,
  DIVERGENCE_ENTRY_MAX,
  DIVERGENCE_SOURCES,
  DIVERGENCE_STAKES,
  FRAME_CRITERION,
  FRAME_DIMENSION,
  FRAME_FORMAL,
  FRAME_PROTOCOL,
  closureLabel,
  divergenceCaveats,
  divergenceGaps,
  divergenceLine,
  divergenceNote,
  frameLine,
  sourceLabel,
  stakeLabel,
} from '@shared/divergence';

/**
 * v1.1 第 4 章的两块界面：输入区的「分歧账」（人填）与报告里的只读栏。
 *
 * 这一层不做判断。它不猜「这处分歧是 F2 还是 F3」，不判断「收敛条件可不可观察」，
 * 也不替人决定该收敛还是分叉——它只把人填的东西收好、把没填的格数出来。
 * 理由写在 `@shared/divergence` 文件头：让本地层替模型吐出两套答案，
 * 恰恰是 v1.1 那句「不许假装判得出」要防的事。
 *
 * 类名一律 `dv-*`：立案卡用过 `bf-*`，模式条是 `mode-chip`，
 * 而冒烟里有一条「模式开关五档」在数 `.mode-chip`，复用会污染那条断言。
 */

type Patch = DivergencePatch;

export function DivergenceCard({
  value,
  onPatch,
  onAddEntry,
  onRemoveEntry,
  onPatchEntry,
  disabled,
  open,
  onToggle,
  pending,
}: {
  value: Divergence | null;
  /** 只交「改了哪几项」，不交整份：交整份会在连点两个下拉时互相覆盖。 */
  onPatch: (p: Patch) => void;
  onAddEntry: () => void;
  onRemoveEntry: (i: number) => void;
  onPatchEntry: (i: number, p: Partial<DivergenceEntry>) => void;
  disabled?: boolean;
  open: boolean;
  onToggle: () => void;
  /** 输入区填了，但报告里还不是这一份：提醒「填完要再跑一次」。 */
  pending: boolean;
}) {
  const gaps = value ? divergenceGaps(value) : [];
  const caveats = value ? divergenceCaveats(value) : [];

  return (
    <div className="dv" data-dv={value ? '1' : '0'} data-open={open ? '1' : '0'} id="divergence-card">
      <div className="dv-head">
        <div className="dv-head-t">
          <span className="dv-title">分歧账</span>
          <span className="dv-sum" data-dv-line title={value ? divergenceLine(value) : undefined}>
            {value ? divergenceLine(value) : '没填：判定坐标四格、收束模式、E4 登记册都没有'}
          </span>
        </div>
        <button className="dv-toggle" data-dv-toggle="1" onClick={onToggle} disabled={disabled}>
          {open ? '收起' : '填写'}
        </button>
      </div>

      {!value && !open && (
        <p className="dv-why">按 v1.1 §4.1，任何一句「这里有问题」都得先交代判定坐标；四格填不出，等于不写法律依据就判决。</p>
      )}

      {open && (
        <div className="dv-body">
          <p className="dv-lead">
            这份账由人填，软件只保管。<b>它不判分歧属于哪一类，也不判收敛条件可不可观察</b>——只数填没填齐。
            登记册只收「影响档位 / 处置 / 命题账」三类；把「这个词用得怪」也塞进来，最后会交出一份「什么都可能」的报告。
          </p>

          <div className="dv-sec-h">判定坐标四元组（§4.1）</div>
          <div className="dv-frames">
            <FrameSelect
              tag="formal"
              label="形式系统"
              value={value?.frame.formal ?? 'unknown'}
              options={FRAME_FORMAL}
              onPick={(v) => onPatch({ frame: { formal: v } })}
            />
            <FrameSelect
              tag="criterion"
              label="判据来源"
              value={value?.frame.criterion ?? 'unknown'}
              options={FRAME_CRITERION}
              onPick={(v) => onPatch({ frame: { criterion: v } })}
            />
            <FrameSelect
              tag="dimension"
              label="分析维度"
              value={value?.frame.dimension ?? 'unknown'}
              options={FRAME_DIMENSION}
              onPick={(v) => onPatch({ frame: { dimension: v } })}
            />
            <FrameSelect
              tag="protocol"
              label="对话协议"
              value={value?.frame.protocol ?? 'unknown'}
              options={FRAME_PROTOCOL}
              onPick={(v) => onPatch({ frame: { protocol: v } })}
            />
          </div>

          <div className="dv-sec-h">收束模式（§4.3：先试收敛，收敛不了才分叉）</div>
          <div className="dv-chips" data-dv-closure={value?.closure ?? 'unknown'}>
            {CLOSURE_MODES.filter((x) => x.id !== 'unknown').map((m) => (
              <button
                key={m.id}
                className={`dv-chip ${value?.closure === m.id ? 'on' : ''}`}
                data-dv-mode={m.id}
                title={m.trigger}
                onClick={() => onPatch({ closure: m.id })}
                disabled={disabled}
              >
                {m.label}
              </button>
            ))}
          </div>

          {value?.closure === 'fork' && (
            <>
              <div className="dv-sec-h">多方案矩阵（§7.4 / §4.5，并列 ≤{BRANCH_MAX}）</div>
              <label className="dv-field">
                <span>并列几个方案</span>
                <select
                  data-dv-branches
                  value={value.branches}
                  onChange={(e) => onPatch({ branches: Number(e.target.value) })}
                  disabled={disabled}
                >
                  {Array.from({ length: 10 }, (_, i) => (
                    <option key={i} value={i}>{i === 0 ? '还没填' : `${i} 个`}</option>
                  ))}
                </select>
              </label>
              <TextField tag="basis" label="各方案判据（每方案一行：原文位置 + 未过的 CQ）" value={value.basis} onPatch={onPatch} disabled={disabled} />
              <TextField tag="common" label="【共同结论】各方案都同意的部分" value={value.common} onPatch={onPatch} disabled={disabled} />
              <TextField tag="difference" label="【差异位置】第几条前提 / 哪一环 / 哪一格判据" value={value.difference} onPatch={onPatch} disabled={disabled} />
              <TextField tag="condition" label="【收敛条件】出现 X 只剩 A；出现 Y 只剩 B" value={value.condition} onPatch={onPatch} disabled={disabled} />
            </>
          )}

          {value?.closure === 'suspend' && (
            <>
              <div className="dv-sec-h">分歧报告（§7.5：能裁的部分必须非空）</div>
              <TextField tag="decidable" label="【能裁的部分】" value={value.decidable} onPatch={onPatch} disabled={disabled} />
              <TextField tag="difference" label="【不能裁的部分】及原因" value={value.difference} onPatch={onPatch} disabled={disabled} />
              <TextField tag="condition" label="【定案条件】需要什么证据 / 让步 / 定义澄清" value={value.condition} onPatch={onPatch} disabled={disabled} />
              <TextField tag="burden" label="【举证责任】落在哪一方" value={value.burden} onPatch={onPatch} disabled={disabled} />
            </>
          )}

          {value?.closure === 'converge' && (
            <TextField tag="condition" label="什么会推翻此判（§9：写不出降级条件的判定只是感觉）" value={value.condition} onPatch={onPatch} disabled={disabled} />
          )}

          <div className="dv-sec-h">E4 分歧登记（只登记影响档位 / 处置 / 命题账三类）</div>
          {(value?.entries ?? []).map((e, i) => (
            <div className="dv-entry" key={i} data-dv-entry={i}>
              <input
                className="dv-in"
                data-dv-entry-at={i}
                value={e.at}
                placeholder="拿不准的位置：第几条前提 / 哪一环"
                onChange={(ev) => onPatchEntry(i, { at: ev.target.value })}
                disabled={disabled}
              />
              <div className="dv-chips">
                {DIVERGENCE_SOURCES.filter((x) => x.id !== 'unknown').map((s) => (
                  <button
                    key={s.id}
                    className={`dv-chip sm ${e.source === s.id ? 'on' : ''}`}
                    data-dv-entry-source={s.id}
                    title={`${s.symptom}｜${s.handling}`}
                    onClick={() => onPatchEntry(i, { source: s.id })}
                    disabled={disabled}
                  >
                    {s.id}
                  </button>
                ))}
              </div>
              <div className="dv-chips">
                {DIVERGENCE_STAKES.filter((x) => x.id !== 'unknown').map((s) => (
                  <button
                    key={s.id}
                    className={`dv-chip sm ${e.stakes === s.id ? 'on' : ''}`}
                    data-dv-entry-stakes={s.id}
                    title={s.hint}
                    onClick={() => onPatchEntry(i, { stakes: s.id })}
                    disabled={disabled}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <button className="dv-del" onClick={() => onRemoveEntry(i)} disabled={disabled} title="删掉这一条">×</button>
            </div>
          ))}
          {(value?.entries.length ?? 0) < DIVERGENCE_ENTRY_MAX && (
            <button className="dv-add" data-dv-add="1" onClick={onAddEntry} disabled={disabled}>＋ 加一条分歧</button>
          )}
          {!value?.entries.length && <p className="dv-hint">没收紧到唯一答案才登记。收敛且没有这三类犹豫时，空册是正确的。</p>}

          <div className="dv-gaps" data-dv-gaps={String(gaps.length)}>
            <b>{value ? divergenceNote(value) : '四格坐标、收束模式都还没选。'}</b>
            {gaps.length > 1 && <ul>{gaps.slice(1).map((g, i) => <li key={i}>{g}</li>)}</ul>}
          </div>

          {caveats.length > 0 && (
            <details className="dv-rules">
              <summary>文档里这几条硬规矩（{caveats.length} 条，填的时候看一眼）</summary>
              <ul>{caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </details>
          )}

          {pending && (
            <p className="dv-pending" data-dv-pend="1">
              填完要<b>再跑一次</b>才进报告：这份账只在按下「分析」的那一刻被带走。
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FrameSelect<T extends string>({
  tag,
  label,
  value,
  options,
  onPick,
}: {
  tag: string;
  label: string;
  value: T;
  options: { id: T; label: string; decides: string }[];
  onPick: (v: T) => void;
}) {
  return (
    <label className="dv-field" data-dv-frame={tag}>
      <span>{label}</span>
      <select value={value} onChange={(e) => onPick(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.id} value={o.id} title={o.decides}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function TextField({
  tag,
  label,
  value,
  onPatch,
  disabled,
}: {
  tag: keyof Pick<Divergence, 'common' | 'difference' | 'condition' | 'basis' | 'decidable' | 'burden'>;
  label: string;
  value: string;
  onPatch: (p: Patch) => void;
  disabled?: boolean;
}) {
  return (
    <label className="dv-field">
      <span>{label}</span>
      {tag === 'basis' ? (
        /* §7.4 只有这一格要求「每方案一行」：两个方案写在同一行里，
           单行框会把第二个藏在横向滚动后面，填的人以为没写进去。 */
        <textarea
          className="dv-in"
          data-dv-text={tag}
          rows={3}
          value={value}
          onChange={(e) => onPatch({ [tag]: e.target.value })}
          disabled={disabled}
        />
      ) : (
        /* 其余各格一句话就够。长句仍存得住（160 字上限），悬停能逐字核。 */
        <input
          className="dv-in"
          data-dv-text={tag}
          title={value || undefined}
          value={value}
          onChange={(e) => onPatch({ [tag]: e.target.value })}
          disabled={disabled}
        />
      )}
    </label>
  );
}

/**
 * 报告里的只读栏。与输入区那份同源：同一份 `Diagnosis.divergence`，
 * 同 `divergenceGaps` 数缺口。不改写一个字。
 */
export function DivergenceView({ value }: { value: Divergence | null | undefined }) {
  if (!value) {
    return (
      <div className="dv-view" data-dv-view="0">
        <p className="dv-absent">
          <b>这一份没有分歧账。</b>既没有判定坐标四元组，也没有声明收束模式或登记 E4。
        </p>
        <p className="dv-hint">
          按 v1.1 §4.1，四格填不出，等于不写法律依据就判决；按 §4.3，先试收敛、收敛不了才分叉。
          但「收敛且没有要登记的分歧」也是合法结果——这一栏空着，不等于判定一定对。
        </p>
      </div>
    );
  }
  const gaps = divergenceGaps(value);
  const caveats = divergenceCaveats(value);
  return (
    <div className="dv-view" data-dv-view="1" data-dv-closure={value.closure}>
      <p className="dv-vline" data-dv-vline>{divergenceLine(value)}</p>
      <div className="dv-vgrid">
        <div><span>形式系统</span><b>{FRAME_FORMAL.find((x) => x.id === value.frame.formal)?.label}</b></div>
        <div><span>判据来源</span><b>{FRAME_CRITERION.find((x) => x.id === value.frame.criterion)?.label}</b></div>
        <div><span>分析维度</span><b>{FRAME_DIMENSION.find((x) => x.id === value.frame.dimension)?.label}</b></div>
        <div><span>对话协议</span><b>{FRAME_PROTOCOL.find((x) => x.id === value.frame.protocol)?.label}</b></div>
      </div>
      <p className="dv-vframe">坐标：{frameLine(value.frame)}　·　收束：{closureLabel(value.closure)}</p>

      {value.entries.length > 0 && (
        <table className="dv-vtable">
          <thead><tr><th>位置</th><th>分歧源</th><th>影响</th></tr></thead>
          <tbody>
            {value.entries.map((e, i) => (
              <tr key={i} data-dv-ventry={i}>
                <td>{e.at || '（没写位置）'}</td>
                <td>{sourceLabel(e.source)}</td>
                <td>{stakeLabel(e.stakes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(value.common || value.decidable || value.difference || value.condition || value.basis || value.burden) && (
        <dl className="dv-vdl">
          {value.common && <><dt>共同结论</dt><dd>{value.common}</dd></>}
          {value.decidable && <><dt>能裁的部分</dt><dd>{value.decidable}</dd></>}
          {value.difference && <><dt>{value.closure === 'suspend' ? '不能裁的部分' : '差异位置'}</dt><dd>{value.difference}</dd></>}
          {value.basis && <><dt>各方案判据</dt><dd>{value.basis}</dd></>}
          {value.condition && <><dt>{value.closure === 'suspend' ? '定案条件' : '收敛条件 / 什么会推翻此判'}</dt><dd>{value.condition}</dd></>}
          {value.burden && <><dt>举证责任</dt><dd>{value.burden}</dd></>}
        </dl>
      )}

      <p className="dv-vnote" data-dv-vgaps={String(gaps.length)}>
        {gaps.length ? `还缺 ${gaps.length} 格：${gaps.join('；')}` : divergenceNote(value)}
      </p>
      <p className="dv-hint">这些是「填齐了」，不是「判对了」。归类与收敛条件准不准，软件算不出来。</p>
      <details className="dv-rules">
        <summary>文档里的硬规矩（{caveats.length} 条）</summary>
        <ul>{caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
      </details>
    </div>
  );
}
