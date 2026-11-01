import { contextBridge, ipcRenderer } from 'electron';
import type {
  AnalysisMode,
  Diagnosis,
  Objection,
  ObjectionStat,
  ReportMeta,
  LlmSettings,
  Pricing,
  ProgressEvent,
  SchemeDefinition,
  FallacyDefinition,
  PragmaRule,
  UsageRecord,
  UsageSummary,
} from '@shared/types';
import type { TheoryId } from '@shared/theories';


/**
 * 渲染进程只能通过这里访问主进程。
 * key 不常驻渲染层：只在设置页读写时短暂经过。
 */
const api = {
  settings: {
    get: (): Promise<LlmSettings & { hasKey: boolean }> => ipcRenderer.invoke('settings:get'),
    save: (patch: Partial<LlmSettings>): Promise<{ ok: boolean }> => ipcRenderer.invoke('settings:save', patch),
    test: (patch: Partial<LlmSettings>): Promise<{ ok: boolean; message: string; latencyMs: number }> =>
      ipcRenderer.invoke('settings:test', patch),
  },
  analysis: {
    run: (
      passage: string,
      theory: TheoryId,
      mode?: AnalysisMode,
      parentId?: string | null
    ): Promise<{ ok: boolean; data?: Diagnosis; usage?: UsageRecord; error?: { code: string; message: string } }> =>
      ipcRenderer.invoke('analysis:run', passage, theory, mode, parentId),
    onProgress: (cb: (e: ProgressEvent) => void): (() => void) => {
      const handler = (_e: unknown, payload: ProgressEvent) => cb(payload);
      ipcRenderer.on('analysis:progress', handler);
      return () => ipcRenderer.removeListener('analysis:progress', handler);
    },
  },
  kb: {
    schemes: (): Promise<SchemeDefinition[]> => ipcRenderer.invoke('kb:schemes'),
    fallacies: (): Promise<FallacyDefinition[]> => ipcRenderer.invoke('kb:fallacies'),
    pragmaRules: (): Promise<PragmaRule[]> => ipcRenderer.invoke('kb:pragmaRules'),
  },
  /**
   * 用量与余额。
   * 所有写操作都返回最新汇总：界面拿返回值直接替换状态，
   * 不再单独取一次，避免「刚记完余额、显示还是旧的」这种低级错。
   */
  usage: {
    summary: (): Promise<UsageSummary> => ipcRenderer.invoke('usage:summary'),
    setPricing: (patch: Partial<Pricing>): Promise<UsageSummary> => ipcRenderer.invoke('usage:setPricing', patch),
    setAnchor: (amount: number, note: string): Promise<UsageSummary> => ipcRenderer.invoke('usage:setAnchor', amount, note),
    clearAnchor: (): Promise<UsageSummary> => ipcRenderer.invoke('usage:clearAnchor'),
    exportCsv: (): Promise<{ ok: boolean; path?: string }> => ipcRenderer.invoke('usage:export'),
    reveal: (): Promise<string> => ipcRenderer.invoke('usage:reveal'),
  },
  /**
   * 异议：用户对某条判定说不认同。
   * 只记录、不改判——所以这里没有「应用我的意见」这种接口，也不该有。
   */
  objections: {
    list: (): Promise<Objection[]> => ipcRenderer.invoke('objections:list'),
    of: (diagId: string): Promise<Objection[]> => ipcRenderer.invoke('objections:of', diagId),
    add: (input: {
      diagId: string;
      theory: TheoryId;
      field: Objection['field'];
      refId: string;
      refLabel: string;
      excerpt: string;
      reason: string;
    }): Promise<Objection[]> => ipcRenderer.invoke('objections:add', input),
    remove: (diagId: string, key: string): Promise<Objection[]> => ipcRenderer.invoke('objections:remove', diagId, key),
    stats: (): Promise<ObjectionStat[]> => ipcRenderer.invoke('objections:stats'),
    reveal: (): Promise<string> => ipcRenderer.invoke('objections:reveal'),
  },
  /**
   * 报告存档。列表给元数据，取全文要单独要——几十份报告一次读完会明显卡。
   */
  archive: {
    list: (): Promise<ReportMeta[]> => ipcRenderer.invoke('archive:list'),
    get: (id: string): Promise<Diagnosis | null> => ipcRenderer.invoke('archive:get', id),
    remove: (id: string): Promise<ReportMeta[]> => ipcRenderer.invoke('archive:remove', id),
    reveal: (): Promise<string> => ipcRenderer.invoke('archive:reveal'),
  },
  prompt: {
    get: (
      theory: TheoryId,
      mode?: AnalysisMode
    ): Promise<{
      theory: TheoryId;
      mode: AnalysisMode;
      version: string;
      fingerprint: string;
      chars: number;
      estTokens: number;
      overBudget: boolean;
      budget: { warn: number; max: number };
      sampling: { temperature: number; maxTokens: number };
      blockIds: string[];
      system: string;
      userTemplate: string;
    }> => ipcRenderer.invoke('prompt:get', theory, mode),
  },
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', url),
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
