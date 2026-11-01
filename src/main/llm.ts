import type { LlmSettings } from '@shared/types';
import { readSettings } from './store';

export interface ChatResult {
  text: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    /**
     * 命中自动前缀缓存的输入 token 数。
     *
     * DeepSeek 用这个名字；OpenAI 用的是 prompt_tokens_details.cached_tokens。
     * 两个都收，收不到就留空——留空表示「这家不说」，不是「没命中」。
     */
    prompt_cache_hit_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

export class LlmError extends Error {
  code: string;
  status?: number;
  constructor(code: string, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const TIMEOUT_MS = 120_000;

export async function chat(
  system: string,
  user: string,
  opts: {
    json?: boolean;
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
    override?: Partial<LlmSettings>;
    /**
     * 追加在 user 之后的追问。只用于**格式修复**：
     * 第一次输出解析失败时，把错误信息原样喂回去让它重出一次。
     * 不用于追问内容——那会让一次分析变成两次判定，两次判定必然不一致。
     */
    followUps?: string[];
  } = {}
): Promise<ChatResult> {
  const cfg: LlmSettings = { ...readSettings(), ...(opts.override ?? {}) };

  if (!cfg.apiKey.trim()) {
    throw new LlmError('NO_KEY', '尚未配置 API Key。请在设置中填写，或使用示例诊断查看界面。');
  }

  const base = cfg.baseUrl.replace(/\/+$/, '');
  const url = `${base}/chat/completions`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort);

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
      ...(opts.followUps ?? []).map((content) => ({ role: 'user', content })),
    ],
    temperature: opts.temperature ?? cfg.temperature,
    max_tokens: opts.maxTokens ?? 8192,
  };
  if (opts.json) body.response_format = { type: 'json_object' };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      const brief = raw.slice(0, 400);
      if (res.status === 401 || res.status === 403) {
        throw new LlmError('AUTH', `API Key 无效或无权限（${res.status}）。请检查设置。`, res.status);
      }
      if (res.status === 429) {
        throw new LlmError('RATE_LIMIT', `请求被限流（429）。请稍后重试。${brief}`, 429);
      }
      if (res.status === 404) {
        throw new LlmError(
          'MODEL_NOT_FOUND',
          `找不到模型或接口路径（404）。检查 baseUrl 是否为 …/v1，模型名是否正确。${brief}`,
          404
        );
      }
      throw new LlmError('HTTP_ERROR', `请求失败（${res.status}）。${brief}`, res.status);
    }

    const data = (await res.json()) as any;
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) {
      throw new LlmError('EMPTY_RESPONSE', '模型返回了空内容。可能是输入过长或触发了内容过滤。');
    }
    return { text, usage: data?.usage };
  } catch (err) {
    if (err instanceof LlmError) throw err;
    const e = err as Error;
    if (e.name === 'AbortError') {
      throw new LlmError('TIMEOUT', `请求超时（${TIMEOUT_MS / 1000} 秒）。可尝试更短的文本或换用更快的模型。`);
    }
    throw new LlmError('NETWORK', `网络请求失败：${e.message}`);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

export interface TestResult {
  ok: boolean;
  /** 成功时报模型自报的名字与耗时；失败时报可操作的原因 */
  message: string;
  latencyMs: number;
}

/**
 * 试一次最小请求，确认地址、模型名、Key 三者都对。
 *
 * 这一项不是锦上添花：地址少写 /v1、模型名拼错、Key 有余额限制，
 * 这三种错在正式分析里都表现为「等了 30 秒然后失败」，而且报错文案容易被误读成文本有问题。
 * 用一个 max_tokens=4 的请求先试，二十秒内就能把配置问题排除掉。
 */
export async function testConnection(cfg: Partial<LlmSettings>): Promise<TestResult> {
  const merged: LlmSettings = { ...readSettings(), ...cfg };
  const started = Date.now();

  if (!merged.apiKey.trim()) {
    return { ok: false, message: 'Key 是空的。', latencyMs: 0 };
  }
  if (!/^https?:\/\//.test(merged.baseUrl)) {
    return { ok: false, message: '接口地址要以 http:// 或 https:// 开头。', latencyMs: 0 };
  }

  const base = merged.baseUrl.replace(/\/+$/, '');
  const controller = new AbortController();
  // 测试用短超时：连不通要立刻说，不能让用户以为程序卡了
  const timer = setTimeout(() => controller.abort(), 20_000);

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${merged.apiKey}` },
      body: JSON.stringify({
        model: merged.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 4,
        temperature: 0,
      }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;

    if (res.ok) {
      const data = (await res.json().catch(() => null)) as any;
      const served = data?.model ? `（服务端回：${data.model}）` : '';
      return { ok: true, message: `连接正常，用时 ${latencyMs} ms${served}`, latencyMs };
    }

    const raw = await res.text().catch(() => '');
    const brief = raw.replace(/\s+/g, ' ').slice(0, 300);

    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: `Key 无效或无权限（${res.status}）。${brief}`, latencyMs };
    }
    if (res.status === 404) {
      return {
        ok: false,
        message: `地址或模型名不对（404）。地址应以 /v1 结尾，模型名要和供应商给的完全一致。${brief}`,
        latencyMs,
      };
    }
    if (res.status === 429) {
      return { ok: false, message: `被限流（429）。Key 可用，但额度或频率受限。${brief}`, latencyMs };
    }
    return { ok: false, message: `服务端返回 ${res.status}。${brief}`, latencyMs };
  } catch (err) {
    const e = err as Error;
    const latencyMs = Date.now() - started;
    if (e.name === 'AbortError') {
      return { ok: false, message: '20 秒内没有响应。地址是否可达？本地 Ollama 是否在运行？', latencyMs };
    }
    if (/ENOTFOUND|EAI_AGAIN/.test(e.message)) {
      return { ok: false, message: `域名解析失败，地址可能写错：${base}`, latencyMs };
    }
    if (/ECONNREFUSED/.test(e.message)) {
      return { ok: false, message: '连接被拒绝。本地服务没启动，或端口不对。', latencyMs };
    }
    return { ok: false, message: `请求失败：${e.message}`, latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

/** 从模型返回的文本中抠出 JSON。模型有时会加围栏或前后缀。 */
export function extractJson(text: string): unknown {
  let t = text.trim();

  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();

  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new LlmError('BAD_JSON', '返回内容里找不到 JSON 对象。');
  }
  let slice = t.slice(start, end + 1);

  try {
    return JSON.parse(slice);
  } catch {
    // 常见机械错误：尾逗号、全角引号
    slice = slice
      .replace(/[“”]/g, '"')
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/[\u00A0\u3000]/g, ' ');
    try {
      return JSON.parse(slice);
    } catch (e2) {
      throw new LlmError('BAD_JSON', `JSON 解析失败：${(e2 as Error).message}`);
    }
  }
}
