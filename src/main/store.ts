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
      } catch {
        apiKey = raw.apiKeyPlain ?? '';
      }
    } else {
      apiKey = raw.apiKeyPlain ?? '';
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

  if (next.apiKey) {
    if (safeStorage.isEncryptionAvailable()) {
      persisted.apiKeyCipher = safeStorage.encryptString(next.apiKey).toString('base64');
    } else {
      persisted.apiKeyPlain = next.apiKey;
    }
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
