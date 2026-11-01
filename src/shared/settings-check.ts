import type { LlmSettings } from './types';

/**
 * 设置的合法性校验。放在 shared 而不是 main，理由和 main/jsonl.ts 一样：
 * 这个模块不依赖 electron，于是检查脚本能在纯 node 里拿它做运行时断言——
 * 「校验存在」如果只能靠读代码确认，就只是另一个说法，不是一条保证。
 *
 * 为什么要校验：baseUrl 会被拼进 fetch 的 url、apiKey 会被放进 Authorization 头。
 * 界面上写什么就发什么，等于把「填错」和「填坏」两种错误都推迟到请求时刻才暴露，
 * 而那时用户看到的是「网络请求失败」——一条指向错误方向的提示。
 *
 * 校验只做形状，不做可达性。能不能连上由「测试连接」回答，
 * 在保存时发一个请求去试，会把「改个模型名」变成一次等待和一次扣费的可能。
 */

export type SettingsField = 'baseUrl' | 'model' | 'temperature' | 'apiKey';

export interface SettingsProblem {
  field: SettingsField;
  message: string;
}

const MAX_BASE_URL = 500;
const MAX_MODEL = 200;
const MAX_KEY = 500;

/**
 * 空白与控制字符。
 *
 * 不写正则是因为 `[\s]` 之外的控制字符要写成转义区间，而那段转义在编辑器里
 * 看着像空格——一个看不出内容的规则，等于没有规则。这里直接比码位。
 * 空格进了 header 会被截断，换行能伪造出一个 header，两者都必须挡在保存这一步。
 */
function hasStrayWhitespace(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c <= 0x20 || c === 0x7f) return true;
  }
  return false;
}

export function validateSettingsPatch(patch: Partial<LlmSettings>): SettingsProblem[] {
  const out: SettingsProblem[] = [];

  if (patch.baseUrl !== undefined) {
    const v = String(patch.baseUrl ?? '').trim();
    if (!v) {
      out.push({ field: 'baseUrl', message: '接口地址不能为空。' });
    } else if (v.length > MAX_BASE_URL) {
      out.push({ field: 'baseUrl', message: `接口地址太长（${v.length} 字符，上限 ${MAX_BASE_URL}）。` });
    } else if (hasStrayWhitespace(v)) {
      out.push({ field: 'baseUrl', message: '接口地址里不能有空格或换行。' });
    } else {
      let u: URL | null = null;
      try {
        u = new URL(v);
      } catch {
        u = null;
      }
      if (!u) {
        out.push({ field: 'baseUrl', message: '接口地址不是一个可解析的网址（要带 http:// 或 https://）。' });
      } else if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        /*
         * file:// / data: / javascript: 都能被 new URL 接受。
         * 放过去的话，一个从别处粘来的地址会让请求打向本地文件系统——
         * 那不是配置错误，是越权。
         */
        out.push({
          field: 'baseUrl',
          message: '接口地址必须是 http:// 或 https://（本地模型用 http://localhost:…）。',
        });
      }
    }
  }

  if (patch.model !== undefined) {
    const v = String(patch.model ?? '').trim();
    if (!v) out.push({ field: 'model', message: '模型名不能为空。' });
    else if (v.length > MAX_MODEL) out.push({ field: 'model', message: `模型名太长（上限 ${MAX_MODEL} 字符）。` });
    else if (hasStrayWhitespace(v)) out.push({ field: 'model', message: '模型名里不能有空格或换行。' });
  }

  if (patch.temperature !== undefined) {
    const v = patch.temperature;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      out.push({ field: 'temperature', message: '温度必须是数字。' });
    } else if (v < 0 || v > 2) {
      out.push({ field: 'temperature', message: `温度要在 0 到 2 之间（现在是 ${v}）。` });
    }
  }

  if (patch.apiKey !== undefined && patch.apiKey !== '') {
    const v = String(patch.apiKey);
    if (v.length > MAX_KEY) out.push({ field: 'apiKey', message: `Key 太长（上限 ${MAX_KEY} 字符）。` });
    else if (hasStrayWhitespace(v)) out.push({ field: 'apiKey', message: 'Key 里不能有空格或换行。' });
  }

  return out;
}

/** 把问题并成一句话给界面。字段顺序即显示顺序，地址排在最前。 */
export function describeProblems(problems: SettingsProblem[]): string {
  return problems.map((p) => p.message).join(' ');
}
