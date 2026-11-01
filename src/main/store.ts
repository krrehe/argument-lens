import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { LlmSettings } from '@shared/types';

const DEFAULT_SETTINGS: LlmSettings = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.2,
};

interface Persisted extends Omit<LlmSettings, 'apiKey'> {
  /** base64(safeStorage 加密后的 apiKey) */
  apiKeyCipher: string;
  /** 加密不可用时的明文回退（仅当 DPAPI 不可用） */
  apiKeyPlain?: string;
}

let cached: LlmSettings | null = null;

/**
 * 读到过、但当前解不开的密文。
 *
 * 存在的理由是一个会真的丢 Key 的场景：换了机器、换了 Windows 账户、
 * 系统密钥环被重置之后，DPAPI 解不开原来那段密文。此时 readSettings 只能给出
 * 空 Key，而用户接下来大概率会去改模型名——那次保存会把空 Key 写回去，
 * 密文被覆盖成空字符串，原来那段就永久没了。
 *
 * 所以密文留在这里：只要这次保存没有显式碰 apiKey，就把原文原样抄回去。
 * 解不开不等于该删掉——它下一次换回原来的账户还能解开。
 */
let orphanCipher: string | null = null;

function settingsPath(): string {
  const dir = app.getPath('userData');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'settings.json');
}

export function readSettings(): LlmSettings {
  if (cached) return cached;
  const p = settingsPath();
  if (!existsSync(p)) {
    cached = { ...DEFAULT_SETTINGS };
    return cached;
  }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as Persisted;
    let apiKey = '';
    if (raw.apiKeyCipher) {
      try {
        apiKey = safeStorage.decryptString(Buffer.from(raw.apiKeyCipher, 'base64'));
        orphanCipher = null;
      } catch {
        // 解不开：明文回退只在没有密文时才有意义，这里把密文留着，别让下一次保存抹掉它
        apiKey = raw.apiKeyPlain ?? '';
        orphanCipher = raw.apiKeyCipher;
      }
    } else {
      apiKey = raw.apiKeyPlain ?? '';
      orphanCipher = null;
    }
    cached = {
      baseUrl: raw.baseUrl || DEFAULT_SETTINGS.baseUrl,
      model: raw.model || DEFAULT_SETTINGS.model,
      temperature: typeof raw.temperature === 'number' ? raw.temperature : DEFAULT_SETTINGS.temperature,
      apiKey,
    };
    return cached;
  } catch {
    cached = { ...DEFAULT_SETTINGS };
    return cached;
  }
}

export function writeSettings(patch: Partial<LlmSettings>): void {
  const cur = readSettings();
  const next: LlmSettings = {
    baseUrl: patch.baseUrl ?? cur.baseUrl,
    model: patch.model ?? cur.model,
    temperature: patch.temperature ?? cur.temperature,
    apiKey: patch.apiKey ?? cur.apiKey,
  };

  const persisted: Persisted = {
    baseUrl: next.baseUrl,
    model: next.model,
    temperature: next.temperature,
    apiKeyCipher: '',
  };

  /*
   * 这次保存有没有碰 Key，要看 patch 里有没有这个字段，
   * 不能看 next.apiKey 真不真——「没传」和「传了空串」在业务上是两件事：
   * 前者是「只改了模型名」，后者才是「我要清掉这个 Key」。
   * 混为一谈的后果是：解不开密文的那台机器上，改一次模型名就把 Key 删了。
   */
  const keyTouched = patch.apiKey !== undefined;

  if (next.apiKey) {
    if (safeStorage.isEncryptionAvailable()) {
      persisted.apiKeyCipher = safeStorage.encryptString(next.apiKey).toString('base64');
    } else {
      persisted.apiKeyPlain = next.apiKey;
    }
    orphanCipher = null;
  } else if (!keyTouched && orphanCipher) {
    persisted.apiKeyCipher = orphanCipher;
  }

  const p = settingsPath();
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(persisted, null, 2), 'utf-8');
  renameSync(tmp, p);

  cached = next;
}

export function hasApiKey(): boolean {
  return readSettings().apiKey.trim().length > 0;
}

/**
 * 磁盘上存着一段密文，但这台机器解不开它。
 *
 * 界面要知道这件事，因为「没配 Key」和「配过但解不开」对用户是两种处境：
 * 前者该去填一个，后者该知道原来那个还在、只是这台机器读不出来——
 * 后者填一个新的会把旧密文覆盖掉，那等于删掉了他仍然需要的凭据。
 */
export function keyUnreadable(): boolean {
  readSettings();
  return orphanCipher !== null;
}
