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
  const onboard = mode === 'onboard';

  useEffect(() => {
    window.api.settings.get().then((s) => {
      setForm({ baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.model, temperature: s.temperature });
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
    await window.api.settings.save(form);
    const s = await window.api.settings.get();
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
              onChange={(e) => patch({ apiKey: e.target.value })}
              placeholder="sk-…　（本地 Ollama 填 ollama 即可）"
              spellCheck={false}
            />
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
