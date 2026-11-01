import { useEffect, useState } from 'react';
import type { LlmSettings } from '@shared/types';

const PRESETS = [
  {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    note: '便宜，中文稳，适合这个任务',
  },
  {
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    note: '国内直连，长文本强',
  },
  {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    note: '需要能访问外网',
  },
  {
    name: '本地 Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:14b',
    note: '完全离线，Key 随便填 ollama',
  },
];

type TestState = { kind: 'idle' } | { kind: 'testing' } | { kind: 'done'; ok: boolean; message: string };

export function Settings({
  mode = 'normal',
  onClose,
  onSaved,
}: {
  /** onboard：首次启动，讲清楚为什么必须配；normal：日常改配置 */
  mode?: 'onboard' | 'normal';
  onClose: () => void;
  onSaved: (s: LlmSettings & { hasKey: boolean }) => void;
}) {
  const [form, setForm] = useState<LlmSettings>({ baseUrl: '', apiKey: '', model: '', temperature: 0.2 });
  const [loaded, setLoaded] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  /**
   * 磁盘上存着 Key，但这台机器解不开（换了账户、系统密钥环重置）。
   *
   * 这一位决定保存时传不传 apiKey：不传 = 让主进程保留原密文，
   * 传空串 = 把它删掉。两者在界面上看起来一样（输入框都是空的），
   * 但对用户是两件完全不同的事——他改个模型名，不该把 Key 一起弄没。
   */
  const [keyUnreadable, setKeyUnreadable] = useState(false);
  /**
   * 本机存着一个 Key（hasKey）。
   *
   * 有了它，输入框才不需要显示明文：主进程不再把 Key 发回来（一条能读回凭据的
   * 通道，等于给渲染层留了一份可复制的凭据），界面只需要知道「有没有」。
   * 于是「留空」的含义也跟着定了：留空 = 不动它。想清掉要显式按一下清除。
   */
  const [savedKey, setSavedKey] = useState(false);
  /** 用户按了「清除」：这一次保存要把 Key 真的清掉，而不是「没填」。 */
  const [clearKey, setClearKey] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const onboard = mode === 'onboard';

  useEffect(() => {
    window.api.settings.get().then((s) => {
      // apiKey 一栏永远是空的：主进程不回明文，留空表示「不动原来那个」
      setForm({ baseUrl: s.baseUrl, apiKey: '', model: s.model, temperature: s.temperature });
      setSavedKey(!!s.hasKey);
      setKeyUnreadable(!!s.keyUnreadable);
      setLoaded(true);
    });
  }, []);

  const patch = (p: Partial<LlmSettings>) => {
    setForm((f) => ({ ...f, ...p }));
    setTest({ kind: 'idle' }); // 改了配置，上一次的测试结论就作废
  };

  const runTest = async () => {
    setTest({ kind: 'testing' });
    const r = await window.api.settings.test(form);
    setTest({ kind: 'done', ok: r.ok, message: r.message });
  };

  const save = async () => {
    /*
     * 三种情形，差别全在 apiKey 这一个字段上：
     *
     *   填了新的      → 发新值，覆盖
     *   空 + 按过清除 → 发空串，真的清掉
     *   空 + 没按清除 → 不发这个字段，让主进程保留原来那段（可能是它解不开的密文）
     *
     * 第三种最容易写错：发一个空串看起来无害，实际是把磁盘上仍然有用的凭据抹掉。
     * 用户只是改了个模型名，不该顺手把 Key 弄没。
     */
    const payload = form.apiKey ? form : clearKey ? { ...form, apiKey: '' } : { ...form, apiKey: undefined };
    const r = await window.api.settings.save(payload);
    if (!r.ok) {
      // 校验不过就停在设置页：写进去了再报错，用户面对的会是一条指向网络的假线索
      setSaveError(r.error ?? '没保存：这一版设置不合法。');
      setTest({ kind: 'done', ok: false, message: r.error ?? '没保存。' });
      return;
    }
    setSaveError(null);
    const s = await window.api.settings.get();
    setSavedKey(!!s.hasKey);
    setClearKey(false);
    onSaved(s);
  };

  return (
    <div className="mask" onClick={onboard ? undefined : onClose}>
      <div className={`dialog ${onboard ? 'onboard' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">{onboard ? '先接一个模型' : '模型接入'}</div>
        <div className="dialog-body">
          {onboard && (
            <div className="why">
              <p>
                这个工具要把一段日常语言拆成前提、隐含前提和推理链，<b>这件事没有规则可循</b>——
                同样一句话，法律文书和带货话术的拆法不同。所以它需要一个大模型来读文本。
              </p>
              <p>
                除此之外的部分都不需要联网：六套评估标准的提示词、型式库、谬误判据、原文定位、以及
                每一道防越界的程序裁决，都在本机跑。<b>换一个模型，镜片不变。</b>
              </p>
              <p className="fine">
                Key 用系统加密存在本机（Windows DPAPI），不上传任何第三方，也没有我们的服务器。
                不想花钱就装 Ollama，完全离线。
              </p>
            </div>
          )}

          <div className="field">
            <label>供应商</label>
            <div className="presets">
              {PRESETS.map((p) => {
                const on = form.baseUrl === p.baseUrl;
                return (
                  <button
                    key={p.name}
                    className={`preset ${on ? 'on' : ''}`}
                    onClick={() => patch({ baseUrl: p.baseUrl, model: p.model })}
                  >
                    <span className="pn">{p.name}</span>
                    <span className="pd">{p.note}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="field">
            <label>接口地址（OpenAI 兼容，以 /v1 结尾）</label>
            <input
              value={form.baseUrl}
              onChange={(e) => patch({ baseUrl: e.target.value })}
              placeholder="https://api.deepseek.com/v1"
              spellCheck={false}
            />
          </div>

          <div className="field">
            <label>模型名</label>
            <input
              value={form.model}
              onChange={(e) => patch({ model: e.target.value })}
              placeholder="deepseek-chat"
              spellCheck={false}
            />
          </div>

          <div className="field">
            <label>API Key</label>
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => {
                patch({ apiKey: e.target.value });
                setSaveError(null);
              }}
              placeholder={
                keyUnreadable
                  ? '（这台机器解不开原来那个，可重填）'
                  : savedKey
                    ? '已保存。留空 = 不改；要换就填新的'
                    : 'sk-…　（本地 Ollama 填 ollama 即可）'
              }
              spellCheck={false}
            />
            {savedKey && !clearKey && (
              <span className="hint">
                Key 用系统加密存在本机，这里读不出来也不显示——
                <button
                  className="link-btn"
                  onClick={() => {
                    setClearKey(true);
                    setForm((f) => ({ ...f, apiKey: '' }));
                  }}
                >
                  清除已保存的 Key
                </button>
              </span>
            )}
            {clearKey && (
              <span className="hint">
                点了保存之后，本机那个 Key 会被清掉（这次无法撤销）。
                <button className="link-btn" onClick={() => setClearKey(false)}>
                  不清了
                </button>
              </span>
            )}
            {keyUnreadable && (
              <span className="hint">
                本机存着一个 Key，但当前系统账户解不开它（换过账户或系统密钥环被重置）。
                不重填也没关系：原来那段会原样留着，换回原账户还能用；重填会覆盖它。
              </span>
            )}
          </div>

          <div className="field">
            <label>温度（{form.temperature.toFixed(2)}）</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={form.temperature}
              onChange={(e) => patch({ temperature: Number(e.target.value) })}
              style={{ padding: 0 }}
            />
            <span className="hint">建议 0.1–0.3。这个任务要的是稳定复现，不是文采。</span>
          </div>

          {/* 单价与余额不放在这里：那是账，不是配置。但得让人知道去哪儿找。 */}
          <p className="hint" style={{ borderTop: '1px dashed var(--line)', paddingTop: 8 }}>
            想看这个模型每次花多少钱，点顶栏的「今日 …」：那里填单价、记余额，也能导出明细。
          </p>

          {/* 校验不通过的提示留在这里，不跟着「改一下输入框」就消失：
              地址写错的人正要反复改，提示闪一下就没了等于没提示。 */}
          {saveError && <p className="hint warn">{saveError}</p>}

        </div>

        {/* 测试结果与按钮不能被折进滚动区：配置错的时候，用户正要反复点它 */}
        {test.kind === 'done' && (
          <div className={`test-bar ${test.ok ? 'ok' : 'bad'}`}>{test.message}</div>
        )}

        <div className="dialog-foot split">
          <button className="ghost-btn" onClick={runTest} disabled={test.kind === 'testing' || !loaded}>
            {test.kind === 'testing' ? '正在试…' : '测试连接'}
          </button>
          <div className="foot-right">
            <button className="ghost-btn" onClick={onClose}>
              {onboard ? '先不配，看看界面' : '取消'}
            </button>
            <button className="primary" onClick={save} disabled={!loaded}>
              {onboard ? '保存并开始' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
