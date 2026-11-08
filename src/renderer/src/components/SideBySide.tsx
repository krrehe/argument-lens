import { useMemo } from 'react';
import type { Diagnosis } from '@shared/types';
import { LEVEL_LABEL, THEORY_BY_ID } from '@shared/theories';
import { MODE_META, normalizeMode } from '@shared/types';
import {
  engineText,
  samenessNote,
  sideBySide,
  sidebyLine,
  sidebyText,
  sizeText,
  type SideHead,
  type SideRow,
} from '@shared/sideby';

/**
 * 两份对照面板。
 *
 * 它是「同题复跑」那个数字的落点：那边说「这一组 8 份里有 268 处字段变过」，
 * 这边把其中任意两份摆在一起，逐处给你看两边各写了什么。
 *
 * 为什么要单开一屏而不是塞进报告里：这份东西**不是报告的一部分**，它是一份
 * 关于报告的旁证。塞进正文，用户会以为它是某一次分析的结论。
 *
 * 四条呈现规矩：
 *   1. **先说要紧的。** 四项（原文 / 透镜 / 模式 / 提示词）只要有一项不同，
 *      那句话必须出现在表格**前面**：否则读者会把「换了透镜」读成「模型在抖」。
 *   2. **不评哪一份更对。** 这一屏没有「更好 / 更准 / 更稳」，也没有排序。
 *   3. **缺失与不同分开看。** 只在一份里出现的字段，另一侧写「这份里没有这一栏」，
 *      不写空——空串会被读成「内容是空的」。
 *   4. **分母写在总述里。** 「3 处不一样」离开「比了 364 个字段」就没有意义。
 */
export function SideBySide({
  pair,
  fmt,
  onClose,
}: {
  pair: { a: Diagnosis; b: Diagnosis };
  fmt: (at: number) => string;
  onClose: () => void;
}) {
  const s = useMemo(() => sideBySide(pair.a, pair.b), [pair.a, pair.b]);

  /*
   * 读不出来时不画空表。
   *
   * 一张 0 行的表会被读成「两份完全一样」——那是这一屏能给出的、
   * 最误导人的一句话。所以宁可只显示一句「这份读不出来」。
   */
  if (!s) {
    return (
      <div className="mask" onClick={onClose}>
        <div className="dialog sb-dialog" role="dialog" aria-label="两份对照" onClick={(e) => e.stopPropagation()}>
          <div className="sb-head">
            <div className="sb-title">两份对照</div>
            <div className="sb-spacer" />
            <button className="sb-x" onClick={onClose} aria-label="关闭">
              ✕
            </button>
          </div>
          <p className="sb-bad" data-sideby-bad>
            这两份报告里有一份读不出来，所以没有可对照的内容。档案里那一份可能被手动删掉或写坏了一半。
          </p>
        </div>
      </div>
    );
  }

  const note = samenessNote(s);
  const bySection = s.sections.map((sec) => ({ sec, rows: s.rows.filter((r) => r.section === sec.id) }));

  return (
    <div className="mask" onClick={onClose}>
      <div
        className="dialog sb-dialog"
        role="dialog"
        aria-label="两份对照"
        onClick={(e) => e.stopPropagation()}
        data-sideby
        data-sideby-rows={s.rows.length}
      >
        <div className="sb-head">
          <div className="sb-title">两份对照</div>
          <div className="sb-sub">同一段字跑了两遍，逐处摆在一起</div>
          <div className="sb-spacer" />
          <button className="sb-x" onClick={onClose} aria-label="关闭" data-sideby-close>
            ✕
          </button>
        </div>

        <div className="sb-body">
          {/* 两张「名片」：时间、透镜、模式、提示词版本、谁跑的。两份分别列，不合并。 */}
          <div className="sb-cards">
            <SideCard side="甲" h={s.a} fmt={fmt} />
            <SideCard side="乙" h={s.b} fmt={fmt} />
          </div>

          <div className="sb-flags" data-sideby-flags>
            <Flag on={s.same.passage} label="同一段原文" />
            <Flag on={s.same.theory} label="同一副透镜" />
            <Flag on={s.same.mode} label="同一个模式" />
            <Flag on={s.same.fingerprint} label="同一版提示词" />
            <span className="sb-size" data-sideby-size>
              {sizeText(s)}
            </span>
          </div>

          {/* 这一句必须在表格前面。它说的是「下面那张表不是在量同一件事」。 */}
          {note && (
            <p className="sb-warn" data-sideby-note>
              {note}
            </p>
          )}

          <p className="sb-line" data-sideby-line>
            {sidebyLine(s)}
          </p>

          {s.rows.length === 0 ? (
            <p className="sb-none">
              这一份在比到的每一个字段上都与另一份逐字相同——包括检查项的答案、每条反驳的话术、
              修补那一栏的写法。它<b>不</b>说明两次判断都对，只说明两次写下来的东西一样。
            </p>
          ) : (
            <>
              <div className="sb-jump" data-sideby-sections={s.sections.length}>
                {s.sections.map((sec) => (
                  <a key={sec.id} className="sb-chip" href={`#sb-${sec.id}`} onClick={(e) => e.preventDefault()}>
                    {sec.label} <b>{sec.rows}</b>
                    <span className="sb-jumpmark">↓</span>
                  </a>
                ))}
              </div>

              {bySection.map(({ sec, rows }) => (
                <section key={sec.id} className="sb-sec" data-sideby-section data-sideby-sec={sec.id}>
                  <h3 className="sb-sech">
                    {sec.label}
                    <span className="sb-secn">{rows.length} 处</span>
                  </h3>
                  <div className="sb-table">
                    {rows.map((r) => (
                      <Row key={r.path} r={r} />
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}

          <p className="sb-caveat">
            这张表只列不一样的，两边都改过的地方也照实各列一遍。它不说哪一份更对，也不说差异从哪来——
            同一个模型名不等于同一个版本，供应商什么时候换了权重，这份存档不知道。
          </p>

          <textarea
            className="sb-text"
            data-sideby-text
            readOnly
            rows={Math.min(14, 4 + Math.min(10, s.rows.length))}
            value={sidebyText(s, fmt)}
          />
        </div>
      </div>
    </div>
  );
}

const KIND_TAG: Record<SideRow['kind'], string> = {
  changed: '两边都有，写得不一样',
  'only-left': '只有甲这一份里有',
  'only-right': '只有乙这一份里有',
};

function Row({ r }: { r: SideRow }) {
  const missingLeft = r.kind === 'only-right';
  const missingRight = r.kind === 'only-left';
  return (
    <div className={`sb-row k-${r.kind}`} data-sideby-row data-sideby-kind={r.kind}>
      <div className="sb-what">
        <span className="sb-label" data-sideby-label>
          {r.label}
        </span>
        <span className="sb-kind">{KIND_TAG[r.kind]}</span>
      </div>
      {/*
        每一格自带一个「甲 / 乙」小字。
        原因是这一屏会滚：一旦两张名片滚出视野，左右两栏就只剩两段没有标签的文字，
        读者分不清哪边是哪一份——而那正是这一屏唯一要说清的事。
      */}
      <div className={`sb-cell left ${missingLeft ? 'miss' : ''}`} data-sideby-left>
        <span className="sb-who">甲</span>
        {r.left}
        {r.leftLen ? <span className="sb-cut">…（共 {r.leftLen} 字）</span> : null}
      </div>
      <div className={`sb-cell right ${missingRight ? 'miss' : ''}`} data-sideby-right>
        <span className="sb-who">乙</span>
        {r.right}
        {r.rightLen ? <span className="sb-cut">…（共 {r.rightLen} 字）</span> : null}
      </div>
    </div>
  );
}

function SideCard({ side, h, fmt }: { side: '甲' | '乙'; h: SideHead; fmt: (at: number) => string }) {
  const theory = THEORY_BY_ID[h.theory]?.name ?? h.theory;
  const mode = normalizeMode(h.mode);
  return (
    <div className={`sb-card side-${side === '甲' ? 'a' : 'b'}`} data-sideby-card>
      <div className="sb-cardh">
        <span className="sb-side">{side}</span>
        <span className="sb-at">{fmt(h.at)}</span>
        <span className="sb-lv">{LEVEL_LABEL[h.level] ?? h.level}</span>
      </div>
      <div className="sb-meta">
        {theory} · {MODE_META[mode]?.label ?? mode} · 提示词 {h.version ?? '未记'}
      </div>
      <div className="sb-engine" title="这一份是哪个模型、什么温度跑出来的">
        {engineText(h)}
      </div>
    </div>
  );
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`sb-flag ${on ? 'on' : 'off'}`} data-sideby-flag={on ? 'same' : 'diff'}>
      <i aria-hidden>{on ? '✓' : '≠'}</i>
      {label}
    </span>
  );
}
