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
import type { CaptureStatus } from '@shared/capture';


/**
 * 渲染进程只能通过这里访问主进程。
 *
 * 通道里不再有 Key：settings.get 只回「有没有 / 解不解得开」，
 * 要改 Key 就往 settings.save 里发一个明文——单向，不回读。
 * 一条能读回凭据的通道，等于给渲染层留了一份可复制的凭据。
 */
const api = {
  settings: {
    get: (): Promise<LlmSettings & { hasKey: boolean; keyUnreadable: boolean }> =>
      ipcRenderer.invoke('settings:get'),
    /** 校验不通过时 ok=false 并带上原因；没校验这一步，错配置会一直拖到请求时才炸。 */
    save: (patch: Partial<LlmSettings>): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('settings:save', patch),
    test: (patch: Partial<LlmSettings>): Promise<{ ok: boolean; message: string; latencyMs: number }> =>
      ipcRenderer.invoke('settings:test', patch),
  },
  analysis: {
    /*
     * 报告照常返回，但 `saved` 会说明它有没有进历史。
     * 存档失败不拦结果（钱已经花了），但不说明的话，用户会在想做修订对照的那天
     * 才发现少了一份，而那时原因无从查起。
     */
    run: (
      passage: string,
      theory: TheoryId,
      mode?: AnalysisMode,
      parentId?: string | null
    ): Promise<{
      ok: boolean;
      data?: Diagnosis;
      usage?: UsageRecord;
      saved?: boolean;
      saveError?: string | null;
      error?: { code: string; message: string };
    }> => ipcRenderer.invoke('analysis:run', passage, theory, mode, parentId),
    /*
     * 停。
     *
     * `canceled` 说的是「真的掐到了一个还在跑的请求」。
     * 为 false 时不能报成「已停止」——那多半是它刚好跑完了，
     * 用户下一秒就会看到一份报告浮出来，与刚才那句提示自相矛盾。
     */
    cancel: (): Promise<{ ok: boolean; canceled: boolean }> => ipcRenderer.invoke('analysis:cancel'),
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
   * 全局快捷键。
   *
   * 只有一个方向：主进程把「剪贴板里读到这段」交上来，渲染层自己决定填不填。
   * 没有 `capture.write()` 这种接口，也不该有——能往剪贴板写，就能悄悄改用户
   * 复制的东西，而这里没有任何功能需要那么做。
   */
  capture: {
    /** 注册结果。失败是正常事（键被占），所以这是一条查询，不是一个错误。 */
    status: (): Promise<CaptureStatus> => ipcRenderer.invoke('capture:status'),
    onOffer: (cb: (p: { text: string }) => void): (() => void) => {
      const handler = (_e: unknown, payload: { text: string }) => cb(payload);
      ipcRenderer.on('capture:offer', handler);
      return () => ipcRenderer.removeListener('capture:offer', handler);
    },
  },
  /**
   * 报告导出。
   *
   * 只给一个方向：报告 → 一份文件。没有「从文件导入」——
   * 报告是模型输出的解析结果，手写一份 JSON 塞进来，程序无法分辨它是不是真的分析过。
   */
  report: {
    exportMarkdown: (d: Diagnosis): Promise<{ ok: boolean; path?: string; canceled?: boolean }> =>
      ipcRenderer.invoke('report:exportMarkdown', d),
    /** Argdown：同一份报告的结构，换成可被文本工具渲染的语法。 */
    exportArgdown: (d: Diagnosis): Promise<{ ok: boolean; path?: string; canceled?: boolean }> =>
      ipcRenderer.invoke('report:exportArgdown', d),
  },
  /**
   * 异议：用户对某条判定说不认同。
   * 只记录、不改判——所以这里没有「应用我的意见」这种接口，也不该有。
   */
  objections: {
    list: (): Promise<Objection[]> => ipcRenderer.invoke('objections:list'),
    of: (diagId: string): Promise<Objection[]> => ipcRenderer.invoke('objections:of', diagId),
    /*
     * 写操作的返回带 ok：写不进去时要能把原因带到界面上。
     * 只回一个列表的话，「没记上」和「记上了」在界面上是同一个样子。
     */
    add: (input: {
      diagId: string;
      theory: TheoryId;
      field: Objection['field'];
      refId: string;
      refLabel: string;
      excerpt: string;
      reason: string;
    }): Promise<{ ok: boolean; list: Objection[]; error?: string }> =>
      ipcRenderer.invoke('objections:add', input),
    remove: (diagId: string, key: string): Promise<{ ok: boolean; list: Objection[]; error?: string }> =>
      ipcRenderer.invoke('objections:remove', diagId, key),
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
