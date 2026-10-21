import { BUILD_ID, IPC_VERSION } from '../shared/runtime';
import electron from 'electron';
const { contextBridge, ipcRenderer } = electron;
import {
  Library,
  DocumentRecord,
  ChunkRecord,
  RetrievalQuery,
  RetrievalResult,
  SessionRecord,
  TurnRecord,
  ProviderProfile,
  ProviderRole,
  RoleModelConfig, AnswerOptions, AudioSource
} from '../main/types';

export interface ChatTokenPayload {
  turnId: string;
  sessionId: string;
  token: string;
}

export interface ChatCompletePayload {
  turnId: string;
  sessionId: string;
  turn: TurnRecord;
}

export interface ChatErrorPayload {
  turnId: string;
  sessionId: string;
  error: string;
}

const subscribe = (channel: string, cb: (data: any) => void) => {
  const handler = (_event: any, data: any) => cb(data);
  ipcRenderer.on(channel, handler); return () => ipcRenderer.removeListener(channel, handler);
};
const api = {
  getMemory:(sessionId:string)=>ipcRenderer.invoke('memory:get',sessionId),
  updateMemory:(sessionId:string,payload:any)=>ipcRenderer.invoke('memory:update',sessionId,payload),
  resetMemory:(sessionId:string,revision:number)=>ipcRenderer.invoke('memory:reset',sessionId,revision),
  onMemoryChanged:(cb:(memory:any)=>void)=>subscribe('memory:changed',cb),
  onCaptureStage:(cb:(data:any)=>void)=>subscribe('screen:stage',cb),
  getRuntimeInfo: () => ipcRenderer.invoke('app:get-runtime-info'),
  getPreloadIdentity: () => ({buildId:BUILD_ID,ipcVersion:IPC_VERSION}),
  getModelSharing: (): Promise<boolean> => ipcRenderer.invoke('interview:get-sharing'),
  setModelSharing: (shared: boolean) => ipcRenderer.invoke('interview:set-sharing', shared),
  getShortcutFailures: (): Promise<string[]> => ipcRenderer.invoke('interview:shortcuts'),
  onInterviewCommand: (cb: (command: string) => void) => subscribe('interview:command', cb),
  onScreenBusy: (cb: (busy: boolean) => void) => subscribe('screen:busy', cb),
  onScreenPreview: (cb: (data: any) => void) => subscribe('screen:preview', cb),
  onScreenError: (cb: (data: any) => void) => subscribe('screen:error', cb),
  onChatProgress: (cb:(data:any)=>void)=>subscribe('chat:progress',cb),
  onChatReset: (cb: (data: {turnId: string; sessionId: string}) => void) => subscribe('chat:reset', cb),
  onChatQueued: (cb: (data: any) => void) => subscribe('chat:queued', cb),
  clearAttachments: (sessionId: string) => ipcRenderer.invoke('chat:clear-attachments', sessionId),
  startListening: (sessionId: string, mode: string, auto: boolean): Promise<string> => ipcRenderer.invoke('audio:start', {sessionId, mode, auto}),
  startSystemAudio:(sessionId:string,captureId:string)=>ipcRenderer.invoke('audio:start-system',{sessionId,captureId}),
  onAudioHealth:(cb:(data:any)=>void)=>subscribe('audio:health',cb),
  openAudioPermissions:(source:string)=>ipcRenderer.invoke('audio:open-permissions',source),
  sendAudioFrame: (captureId: string, source: AudioSource, samples: Float32Array) => ipcRenderer.send('audio:frame', {captureId, source, samples}),
  stopListening: () => ipcRenderer.invoke('audio:stop'),
  controlListening: (changes: {auto?: boolean; paused?: boolean; selfSpeaking?: boolean}) => ipcRenderer.invoke('audio:control', changes),
  answerImmediately: () => ipcRenderer.invoke('audio:immediate'),
  retryTranscript: (id: string) => ipcRenderer.invoke('audio:retry', id),
  getTranscripts: (sessionId: string) => ipcRenderer.invoke('audio:history', sessionId),
  onAudioState: (cb: (data: any) => void) => subscribe('audio:state', cb),
  onTranscript: (cb: (data: any) => void) => subscribe('audio:transcript', cb),
  onAudioError: (cb: (data: any) => void) => subscribe('audio:error', cb),
  // --- Window & System ---
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  toggleFloatingWindow: () => ipcRenderer.invoke('window:toggle-floating'),
  setFloatingOpacity: (val: number) => ipcRenderer.invoke('window:set-opacity', val),
  setContentProtection: (val: boolean) => ipcRenderer.invoke('window:set-content-protection', val),
  toggleClickThrough: (): Promise<boolean> => ipcRenderer.invoke('window:toggle-click-through'),
  setClickThrough: (val: boolean): Promise<void> => ipcRenderer.invoke('window:set-click-through', val),
  getClickThrough: (): Promise<boolean> => ipcRenderer.invoke('window:get-click-through'),
  onClickThroughChanged: (cb: (enabled: boolean) => void) => {
    const handler = (_: any, enabled: boolean) => cb(enabled);
    ipcRenderer.on('window:click-through-changed', handler);
    return () => ipcRenderer.removeListener('window:click-through-changed', handler);
  },

  // --- Screen Capture & Vision ---
  captureScreen: (mode: 'interactive' | 'fullscreen' = 'interactive'): Promise<{ base64: string; mimeType: string } | null> =>
    ipcRenderer.invoke('screen:capture', mode),
  captureAndAsk: (mode: 'interactive' | 'fullscreen' = 'interactive', sessionId?: string, libraryIds?: string[]): Promise<{ question: string; turnId: string } | null> =>
    ipcRenderer.invoke('screen:capture-and-ask', { mode, sessionId, libraryIds }),
  onQuestionExtracted: (cb: (data: { question: string }) => void) => {
    const handler = (_: any, data: any) => cb(data);
    ipcRenderer.on('screen:question-extracted', handler);
    return () => ipcRenderer.removeListener('screen:question-extracted', handler);
  },

  // --- Audio Recording & ASR ---
  transcribeAudio: (audioData: ArrayBuffer, mimeType: string = 'audio/webm'): Promise<{ ok: boolean; text?: string; error?: string }> =>
    ipcRenderer.invoke('api:transcribe-audio', { audioData, mimeType }),

  // --- Preset Bank ---
  importPresetQuestionBank: (libraryId?: string): Promise<{ success: boolean; message: string; docCount: number }> =>
    ipcRenderer.invoke('kb:import-preset-bank', libraryId),

  // --- Libraries & Documents ---
  getLibraries: (): Promise<Library[]> => ipcRenderer.invoke('kb:get-libraries'),
  saveLibrary: (lib: Library): Promise<void> => ipcRenderer.invoke('kb:save-library', lib),
  deleteLibrary: (id: string): Promise<void> => ipcRenderer.invoke('kb:delete-library', id),
  getDocuments: (libId?: string): Promise<DocumentRecord[]> => ipcRenderer.invoke('kb:get-documents', libId),
  deleteDocument: (id: string): Promise<void> => ipcRenderer.invoke('kb:delete-document', id),
  getChunkNeighbors: (chunkId: string, before = 1, after = 1): Promise<ChunkRecord[]> =>
    ipcRenderer.invoke('kb:get-chunk-neighbors', { chunkId, before, after }),
  getDocumentText: (docId: string): Promise<string> =>
    ipcRenderer.invoke('kb:get-document-text', docId),
  rebuildEmbeddings: (docId?: string): Promise<{ processed: number; succeeded: number }> =>
    ipcRenderer.invoke('kb:rebuild-embeddings', docId),
  selectAndImportFiles: (libId: string) => ipcRenderer.invoke('kb:import-files', libId),
  selectAndImportFolder: (libId: string) => ipcRenderer.invoke('kb:import-folder', libId),
  getIngestionStats: () => ipcRenderer.invoke('kb:get-ingestion-stats'),
  onIngestionProgress: (cb: (data: any) => void) => {
    const handler = (_: any, data: any) => cb(data);
    ipcRenderer.on('kb:ingestion-progress', handler);
    return () => ipcRenderer.removeListener('kb:ingestion-progress', handler);
  },
  testRetrieval: (req: RetrievalQuery): Promise<RetrievalResult> => ipcRenderer.invoke('kb:test-retrieval', req),

  // --- Sessions & Chat ---
  selectSession: (sessionId: string): Promise<void> => ipcRenderer.invoke('chat:select-session', sessionId),
  getActiveTurn: (): Promise<TurnRecord | null> => ipcRenderer.invoke('chat:get-active-turn'),
  onChatSessionSelected: (cb: (data: {sessionId: string; turn: TurnRecord | null}) => void) => {
    const handler = (_: any, data: any) => cb(data);
    ipcRenderer.on('chat:session', handler);
    return () => ipcRenderer.removeListener('chat:session', handler);
  },
  getSessions: (): Promise<SessionRecord[]> => ipcRenderer.invoke('chat:get-sessions'),
  getSelectedSession: (): Promise<string | null> => ipcRenderer.invoke('chat:get-selected-session'),
  saveSession: (s: SessionRecord): Promise<void> => ipcRenderer.invoke('chat:save-session', s),
  deleteSession: (id: string): Promise<void> => ipcRenderer.invoke('chat:delete-session', id),
  getTurns: (sessionId: string): Promise<TurnRecord[]> => ipcRenderer.invoke('chat:get-turns', sessionId),
  askQuestion: (sessionId: string, question: string, libraryIds?: string[], turnId?: string, options?: AnswerOptions): Promise<string> =>
    ipcRenderer.invoke('chat:ask-question', { sessionId, question, libraryIds, turnId, options }),
  cancelGeneration: (turnId?: string, sessionId?: string): Promise<void> =>
    ipcRenderer.invoke('chat:cancel', { turnId, sessionId }),
  onChatStreamStart: (cb: (data: { turnId: string; sessionId: string; question: string; createdAt: number }) => void) => {
    const handler = (_: any, payload: any) => cb(payload);
    ipcRenderer.on('chat:start', handler);
    return () => ipcRenderer.removeListener('chat:start', handler);
  },
  onChatStreamToken: (cb: (data: ChatTokenPayload | string) => void) => {
    const handler = (_: any, payload: any) => cb(payload);
    ipcRenderer.on('chat:token', handler);
    return () => ipcRenderer.removeListener('chat:token', handler);
  },
  onChatStreamComplete: (cb: (data: ChatCompletePayload | TurnRecord) => void) => {
    const handler = (_: any, payload: any) => cb(payload);
    ipcRenderer.on('chat:complete', handler);
    return () => ipcRenderer.removeListener('chat:complete', handler);
  },
  onChatStreamError: (cb: (data: ChatErrorPayload | string) => void) => {
    const handler = (_: any, payload: any) => cb(payload);
    ipcRenderer.on('chat:error', handler);
    return () => ipcRenderer.removeListener('chat:error', handler);
  },

  // --- Providers & API Keys ---
  getProfiles: (): Promise<ProviderProfile[]> => ipcRenderer.invoke('api:get-profiles'),
  getActiveRoles: (): Promise<{ chat: string | null; embed: string | null; vision: string | null; asr: string | null }> =>
    ipcRenderer.invoke('api:get-active-roles'),
  setActiveRole: (role: ProviderRole, profileId: string): Promise<void> =>
    ipcRenderer.invoke('api:set-active-role', { role, profileId }),
  saveProfile: (p: ProviderProfile): Promise<void> => ipcRenderer.invoke('api:save-profile', p),
  deleteProfile: (id: string): Promise<void> => ipcRenderer.invoke('api:delete-profile', id),
  setApiKey: (profileId: string, key: string): Promise<void> => ipcRenderer.invoke('api:set-key', { profileId, key }),
  testProvider: (profileId: string, overrideKey?: string, role?: ProviderRole): Promise<{ ok: boolean; message: string; latencyMs?: number }> =>
    ipcRenderer.invoke('api:test-provider', { profileId, overrideKey, role }),
  getRoleConfigs: (): Promise<Record<ProviderRole, RoleModelConfig>> =>
    ipcRenderer.invoke('api:get-role-configs'),
  saveRoleConfig: (payload: { role: ProviderRole; name?: string; baseUrl: string; model: string; key?: string; timeoutMs?: number }): Promise<Record<ProviderRole, RoleModelConfig>> =>
    ipcRenderer.invoke('api:save-role-config', payload),
  syncRoleConfig: (sourceRole: ProviderRole): Promise<Record<ProviderRole, RoleModelConfig>> =>
    ipcRenderer.invoke('api:sync-role-config', { sourceRole }),
  testRoleConnection: (payload: { role: ProviderRole; baseUrl: string; model: string; key?: string; timeoutMs?: number }): Promise<{ ok: boolean; message: string; latencyMs?: number }> =>
    ipcRenderer.invoke('api:test-role', payload),
  toggleMockServer: (enable: boolean): Promise<boolean> => ipcRenderer.invoke('api:toggle-mock', enable)
};

export type ElectronApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
