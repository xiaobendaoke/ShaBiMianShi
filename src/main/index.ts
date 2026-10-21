import {resolveProjectFocus,caseSection,answeredCase} from './services/projectFocus';
import {memoryContext,recentContext,verifiedMemoryPatch,isUserCorrection,selectedProject,type MemorySource} from './services/sessionMemory';
import { BUILD_ID, IPC_VERSION, SCHEMA_VERSION } from '../shared/runtime';
import { backupUserData } from './services/dataBackup';
import electron from 'electron';
const { app, BrowserWindow, ipcMain, dialog, globalShortcut } = electron;
import path from 'path';
import fs from 'fs';
import { AppDatabase } from './db/database';
import { KeyVault } from './services/keyVault';
import { KeywordIndex } from './indexing/keywordIndex';
import { VectorIndex } from './indexing/vectorIndex';
import { embeddingSpaceKey } from './indexing/embeddingSpace';
import { restoreEmbeddingIndex, ensureEmbeddingIndex, indexMatchesProvider } from './indexing/embeddingLifecycle';
import { RetrievalService } from './indexing/retrievalService';
import { ProviderService } from './services/providerService';
import { IngestionQueue } from './services/ingestionQueue';
import { MockAiServer } from './services/mockServer';
import { WindowManager } from './windows/windowManager';
import { AudioSessionService } from './services/audioSession';
import {NativeSystemAudio} from './services/nativeSystemAudio';
import { CaptureCoordinator } from './services/captureCoordinator';
import { answerPolicy } from '../shared/interview';
import type { AnswerOptions, AudioSource } from './types';
import { captureScreen } from './services/screenCapture';
import { PRESET_INTERVIEW_BANK_CONTENT } from './resources/presetInterviewBank';
import {
  Library,
  SessionRecord,
  ProviderProfile,
  ProviderRole,
  RoleModelConfig,
  TurnRecord,
  CitationSnapshot,
  RetrievalQuery
} from './types';

// Preserve the original internal identity for existing encrypted credentials and data.
// Display names and bundle names are independent of this compatibility identifier.
app.setName('面试狗-独立版');
app.setPath('userData', path.join(app.getPath('appData'), '面试狗-独立版'));

// An explicit isolated profile is useful for local QA without touching user data.
if (process.env.INTERVIEWDOG_TEST_DATA_DIR) {
  fs.mkdirSync(process.env.INTERVIEWDOG_TEST_DATA_DIR, { recursive: true });
  app.setPath('userData', process.env.INTERVIEWDOG_TEST_DATA_DIR);
}

function traceBoot(stage:string){if(process.env.INTERVIEWDOG_RUNTIME_REPORT)fs.writeFileSync(process.env.INTERVIEWDOG_RUNTIME_REPORT+'.startup.json',JSON.stringify({stage,buildId:BUILD_ID,pid:process.pid,at:Date.now()}),{mode:0o600});}
traceBoot('requesting-single-instance');
// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();
traceBoot(gotTheLock?'waiting-for-app-ready':'old-instance-running');
if (!gotTheLock) {
  dialog.showErrorBox('旧实例仍在运行','请先从菜单完整退出傻逼面试，再打开新版。为保护配置，本次启动不会初始化数据库。');
  app.quit();
}

let db: AppDatabase;
let keyVault: KeyVault;
let keywordIndex: KeywordIndex;
let vectorIndex: VectorIndex;
let retrievalService: RetrievalService;
let providerService: ProviderService;
let ingestionQueue: IngestionQueue;
let mockServer: MockAiServer;
let windowManager: WindowManager;
let audioSession: AudioSessionService;
let captureCoordinator: CaptureCoordinator;
const nativeSystemAudio=new NativeSystemAudio();
let nativeCapture:{id:string;owner:number;sessionId:string}|undefined;
const nativeAudioEnabled=()=>process.platform==='darwin'&&process.env.INTERVIEWDOG_TEST_LEGACY_AUDIO!=='1';
const memoryJobs=new Map<string,AbortController>();
const pendingQuestions: {sessionId: string; question: string; libraryIds?: string[]; turnId: string; options: AnswerOptions}[] = [];
function imageProfile() {
  return db.getActiveProfile('chat');
}
function drainQuestions() {
  if (captureCoordinator?.busy) return;
  for (let i = 0; i < pendingQuestions.length;) {
    const item = pendingQuestions[i];
    if ([...activeTurns.values()].some(t => t.sessionId === item.sessionId)) { i++; continue; }
    pendingQuestions.splice(i, 1);
    try { executeAskQuestion(item.sessionId, item.question, item.libraryIds, item.turnId, item.options); }
    catch (error: any) {
      const turn = db.getTurns(item.sessionId).find(t => t.id === item.turnId);
      if (turn) {turn.status = 'error'; turn.error = error.message; db.saveTurn(turn);}
      windowManager.broadcast('chat:error', {turnId: item.turnId, sessionId: item.sessionId, error: error.message});
    }
  }
}
function submitQuestion(sessionId: string, question: string, libraryIds?: string[], turnId: string = crypto.randomUUID(), options: AnswerOptions = {}) {
  if (!db.getSessions().some(s => s.id === sessionId)) throw new Error('会话不存在');
  if (!question?.trim()) throw new Error('问题不能为空');
  if (activeTurns.has(turnId) || pendingQuestions.some(q => q.turnId === turnId) || db.getTurns(sessionId).some(t => t.id === turnId)) throw new Error('问题ID已在使用');
  if (pendingQuestions.filter(q => q.sessionId === sessionId).length >= 20) throw new Error('待答问题过多，请先处理队列');
  const images = options.images || [];
  if (images.length > 8 || images.reduce((n, x) => n + x.base64.length, 0) > 32 * 1024 * 1024 || images.some(x => !['image/png', 'image/jpeg', 'image/webp'].includes(x.mimeType))) throw new Error('图片过多或过大，请分批提交（最多8张）');
  db.saveTurn({id: turnId, sessionId, role: 'assistant', question, answer: '', status: 'queued', citations: [], createdAt: Date.now(), options});
  pendingQuestions.push({sessionId, question, libraryIds, turnId, options});
  windowManager.broadcast('chat:queued', {sessionId, turnId});
  drainQuestions(); return turnId;
}

// Per-turn AbortController map to eliminate global state race conditions (P1-06)
const activeTurns = new Map<string, { controller: AbortController; sessionId: string; turn: TurnRecord; cancel: () => void }>();

const DEFAULT_ROLE_DEFAULTS: Record<ProviderRole, { name: string; baseUrl: string; model: string }> = {
  chat: {
    name: '文本对话服务 (Chat)',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat'
  },
  embed: {
    name: '向量嵌入服务 (Embedding)',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'BAAI/bge-m3'
  },
  vision: {
    name: '图片理解服务 (Vision)',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o'
  },
  asr: {
    name: '语音转写服务 (ASR)',
    baseUrl: 'https://api.openai.com/v1',
    model: 'whisper-1'
  }
};

function getOrInitRoleConfigs(db: AppDatabase, keyVault: KeyVault): Record<ProviderRole, RoleModelConfig> {
  const roles: ProviderRole[] = ['chat', 'embed', 'vision', 'asr'];
  const result = {} as Record<ProviderRole, RoleModelConfig>;

  for (const role of roles) {
    let profile = db.getActiveProfile(role);
    if (!profile) {
      const dedicatedId = `role_profile_${role}`;
      const existing = db.getProfiles().find(p => p.id === dedicatedId);
      if (existing) {
        profile = existing;
      } else {
        const d = DEFAULT_ROLE_DEFAULTS[role];
        const newProf: ProviderProfile = {
          id: dedicatedId,
          name: d.name,
          protocol: 'openai',
          baseUrl: d.baseUrl,
          hasKey: false,
          modelChat: role === 'chat' ? d.model : 'gpt-4o',
          modelEmbed: role === 'embed' ? d.model : 'BAAI/bge-m3',
          modelVision: role === 'vision' ? d.model : 'gpt-4o',
          modelAsr: role === 'asr' ? d.model : 'whisper-1',
          timeoutMs: 30000,
          isActive: false,
          createdAt: Date.now()
        };
        db.saveProfile(newProf);
        profile = newProf;
      }
      db.setActiveProviderId(role, profile.id);
    }

    const modelName =
      role === 'chat' ? profile.modelChat :
      role === 'embed' ? profile.modelEmbed :
      role === 'vision' ? profile.modelVision :
      profile.modelAsr;

    result[role] = {
      role,
      name: profile.name,
      baseUrl: profile.baseUrl,
      hasKey: keyVault.hasKey(profile.id),
      model: modelName || DEFAULT_ROLE_DEFAULTS[role].model,
      timeoutMs: profile.timeoutMs || 30000,
      profileId: profile.id
    };
  }

  return result;
}

function saveRoleConfig(
  db: AppDatabase,
  keyVault: KeyVault,
  vectorIndex: VectorIndex,
  payload: { role: ProviderRole; name?: string; baseUrl: string; model: string; key?: string; timeoutMs?: number }
): Record<ProviderRole, RoleModelConfig> {
  const { role, name, baseUrl, model, key, timeoutMs } = payload;
  const roles: ProviderRole[] = ['chat', 'embed', 'vision', 'asr'];
  const dedicatedId = `role_profile_${role}`;

  const currentProfile = db.getActiveProfile(role);
  let isSharedWithOthers = false;
  if (currentProfile) {
    for (const otherRole of roles) {
      if (otherRole !== role && db.getActiveProviderId(otherRole) === currentProfile.id) {
        isSharedWithOthers = true;
        break;
      }
    }
  }

  let targetProfileId = currentProfile ? currentProfile.id : dedicatedId;

  if (isSharedWithOthers || !currentProfile) {
    targetProfileId = dedicatedId;
    const prevKey = currentProfile ? keyVault.getKey(currentProfile.id) : undefined;
    if (prevKey && !keyVault.hasKey(dedicatedId) && !key) {
      keyVault.setKey(dedicatedId, prevKey);
    }
    db.setActiveProviderId(role, targetProfileId);
  }

  const existing = db.getProfiles().find(p => p.id === targetProfileId);
  const updatedProfile: ProviderProfile = {
    id: targetProfileId,
    name: name || existing?.name || DEFAULT_ROLE_DEFAULTS[role].name,
    protocol: 'openai',
    baseUrl: baseUrl.trim(),
    hasKey: (key && key.trim().length > 0) ? true : (existing ? keyVault.hasKey(existing.id) : false),
    modelChat: role === 'chat' ? model.trim() : (existing?.modelChat || 'gpt-4o'),
    modelEmbed: role === 'embed' ? model.trim() : (existing?.modelEmbed || 'BAAI/bge-m3'),
    modelVision: role === 'vision' ? model.trim() : (existing?.modelVision || 'gpt-4o'),
    modelAsr: role === 'asr' ? model.trim() : (existing?.modelAsr || 'whisper-1'),
    timeoutMs: timeoutMs || existing?.timeoutMs || 30000,
    isActive: existing?.isActive ?? false,
    createdAt: existing?.createdAt || Date.now()
  };

  db.saveProfile(updatedProfile);
  db.setActiveProviderId(role, targetProfileId);

  if (key && key.trim().length > 0) {
    keyVault.setKey(targetProfileId, key.trim());
  }

  if (role === 'embed') {
    restoreEmbeddingIndex(db, vectorIndex, db.getActiveProfile('embed'));
  }

  return getOrInitRoleConfigs(db, keyVault);
}

function syncRoleConfig(
  db: AppDatabase,
  keyVault: KeyVault,
  vectorIndex: VectorIndex,
  sourceRole: ProviderRole
): Record<ProviderRole, RoleModelConfig> {
  const configs = getOrInitRoleConfigs(db, keyVault);
  const source = configs[sourceRole];
  const sourceKey = keyVault.getKey(source.profileId) || '';

  const roles: ProviderRole[] = ['chat', 'embed', 'asr'];
  for (const role of roles) {
    if (role === sourceRole) continue;
    const current = configs[role];
    saveRoleConfig(db, keyVault, vectorIndex, {
      role,
      baseUrl: source.baseUrl,
      model: current.model,
      key: sourceKey || undefined,
      timeoutMs: source.timeoutMs
    });
  }

  return getOrInitRoleConfigs(db, keyVault);
}

let startupReady = false;
const startedAt = Date.now();
async function bootstrap() {
  traceBoot('backup-start');
  const userDataDir = app.getPath('userData');
  const dbPath = path.join(userDataDir, 'app_data.db');
  const storageDir = path.join(userDataDir, 'documents');

  await backupUserData(userDataDir, BUILD_ID);
  traceBoot('backup-complete');
  db = new AppDatabase(dbPath);
  keyVault = new KeyVault(userDataDir);
  traceBoot('vault-loaded');
  keywordIndex = new KeywordIndex();
  vectorIndex = new VectorIndex();
  windowManager = new WindowManager();
  process.env.INTERVIEWDOG_RESOURCE_DIR ||= app.getAppPath();
  captureCoordinator = new CaptureCoordinator(() => BrowserWindow.getAllWindows(), busy => {windowManager.broadcast('screen:busy', busy); if (!busy) setTimeout(drainQuestions, 0);}, stage=>windowManager.broadcast('screen:stage',{stage,at:Date.now()}));
  audioSession = new AudioSessionService((wav, signal) => {
    const profile = db.getActiveProfile('asr');
    if (!profile) throw new Error('请先配置ASR服务');
    return providerService.transcribeAudio(profile, wav, 'audio/wav', signal);
  }, (channel, value) => {
    if(channel==='audio:state'&&!value.running&&nativeCapture?.id===value.captureId){nativeSystemAudio.stop();nativeCapture=undefined;}
    windowManager.broadcast(channel, value);
  }, record => db.saveTranscript(record),
  (sessionId, question, audioTiming) => { try { submitQuestion(sessionId, question, undefined, undefined, {audioTiming}); } catch(error: any) {windowManager.broadcast('audio:error', {sessionId, error: error.message});} }, () => captureCoordinator.busy);
  providerService = new ProviderService(keyVault);

  ingestionQueue = new IngestionQueue(db, keywordIndex, vectorIndex, storageDir, providerService);

  // 1. Populate Keyword Index from existing DB chunks with multi-library mapping (P1-01 & P1-03)
  const allChunks = db.getAllChunks();
  const docLibMap = db.getDocumentLibraryLinks();
  const chunkDocMap = new Map<string, string[]>();
  for (const link of docLibMap) {
    if (!chunkDocMap.has(link.documentId)) chunkDocMap.set(link.documentId, []);
    chunkDocMap.get(link.documentId)!.push(link.libraryId);
  }

  for (const chunk of allChunks) {
    const libs = chunkDocMap.get(chunk.documentId) || [];
    if (libs.length > 0) {
      keywordIndex.addChunk(chunk, libs);
    }
  }

  restoreEmbeddingIndex(db, vectorIndex, db.getActiveProfile('embed'));

  retrievalService = new RetrievalService(keywordIndex, vectorIndex, {
    getDocument: (id) => db.getDocument(id),
    getNeighborChunk: (chunkId, offset) => {
      const neighbors = db.getNeighborChunks(chunkId, Math.max(0, -offset), Math.max(0, offset));
      const target=db.getChunk(chunkId);
      return neighbors.find(n => n.ordinal === (target?.ordinal ?? -1000)+offset && n.documentVersion===target?.documentVersion) || null;
    }
  });

  // Only start mock server if explicitly requested via environment variable (P1-02)
  mockServer = new MockAiServer(52140);
  if (process.env.MOCK_SERVER === 'true') {
    try {
      await mockServer.start();
      console.log('Mock AI server started on http://127.0.0.1:52140/v1');
    } catch (err) {
      console.warn('Could not start mock server on default port:', err);
    }
  }

  // Ensure default library exists
  const existingLibs = db.getLibraries();
  let defaultLibId = 'default_lib';
  if (existingLibs.length === 0) {
    db.saveLibrary({
      id: defaultLibId,
      name: '默认知识库 (精选大厂真题)',
      description: '内置大厂高并发架构、MySQL、Redis、前端与算法精选题库',
      docCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    try {
      importPresetQuestionBank(defaultLibId);
    } catch (err) {
      console.warn('Failed to auto-import preset question bank:', err);
    }
  } else {
    defaultLibId = existingLibs[0].id;
  }

  // If database has no profiles at all, register a template profile without forcing it active
  const existingProfiles = db.getProfiles();
  if (existingProfiles.length === 0) {
    const templateProfile: ProviderProfile = {
      id: 'mock_local',
      name: '本地离线模拟服务 (测试专用)',
      protocol: 'openai',
      baseUrl: 'http://127.0.0.1:52140/v1',
      hasKey: false,
      modelChat: 'mock-gpt-4o',
      modelEmbed: 'text-embedding-3-small',
      modelVision: 'mock-gpt-4o',
      modelAsr: 'whisper-1',
      timeoutMs: 30000,
      isActive: false, // Do NOT auto-activate mock in production (P1-02)
      createdAt: Date.now()
    };
    db.saveProfile(templateProfile);
  }

  // Ensure default session exists
  const existingSessions = db.getSessions();
  if (existingSessions.length === 0) {
    db.saveSession({
      id: 'session_default',
      title: '日常技术面试辅导',
      libraryIds: [defaultLibId],
      strategy: 'docs_and_general',
      promptStyle: 'standard',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }

  // Forward ingestion events to renderer
  ingestionQueue.on('task-progress', (task) => {
    windowManager.broadcast('kb:ingestion-progress', task);
  });
  ingestionQueue.on('task-updated', (stats) => {
    windowManager.broadcast('kb:ingestion-stats', stats);
  });

  electron.session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const sources = await Promise.race([
        electron.desktopCapturer.getSources({types: ['screen'], thumbnailSize: {width: 0, height: 0}}),
        new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('获取系统音源超时')),20000);})
      ]);
      if (!sources.length) return callback({});
      callback({video: sources[0], audio: 'loopback'});
    } catch { callback({}); } finally {clearTimeout(timer);}
  });
  app.on('web-contents-created', (_event, contents) => {const owner=contents.id;contents.once('destroyed', () => audioSession.stop(owner));});
  registerIpc();

  startupReady = true;
  traceBoot('ready');
  if(process.env.INTERVIEWDOG_RUNTIME_REPORT)fs.writeFileSync(process.env.INTERVIEWDOG_RUNTIME_REPORT,JSON.stringify({buildId:BUILD_ID,ipcVersion:IPC_VERSION,pid:process.pid,startedAt,appPath:app.getAppPath(),dataDirectory:userDataDir,schemaVersion:db.getSchemaVersion(),keyHealth:keyVault.getHealth()}),{mode:0o600});
  windowManager.createMainWindow();

  // Register global shortcuts
  try {
    const registerShortcut = (key: string, handler: () => void) => { if (!globalShortcut.register(key, handler)) { const failed = JSON.parse(db.getSetting('shortcut_failures', '[]') || '[]'); db.setSetting('shortcut_failures', JSON.stringify([...new Set([...failed, key])])); } };
    db.setSetting('shortcut_failures', '[]');
    registerShortcut('CommandOrControl+Shift+Space', () => {
      windowManager.toggleFloatingWindow();
    });
    registerShortcut('CommandOrControl+Shift+P', () => {
      windowManager.toggleClickThrough();
    });
    registerShortcut('CommandOrControl+Shift+S', () => {
      void handleCaptureAndAsk('fullscreen').catch(reportCaptureError);
    });
    registerShortcut('CommandOrControl+Alt+X', () => {
      void handleCaptureAndAsk('interactive').catch(reportCaptureError);
    });
    registerShortcut('CommandOrControl+Shift+G', () => windowManager.broadcast('interview:command', 'listen'));
    registerShortcut('CommandOrControl+Shift+Return', () => windowManager.broadcast('interview:command', 'immediate'));
    registerShortcut('CommandOrControl+Shift+M', () => windowManager.broadcast('interview:command', 'self'));
    registerShortcut('CommandOrControl+Alt+Left', () => windowManager.broadcast('interview:command', 'previous'));
    registerShortcut('CommandOrControl+Alt+Right', () => windowManager.broadcast('interview:command', 'next'));
    registerShortcut('CommandOrControl+Up', () => windowManager.broadcast('interview:command', 'scroll-up'));
    registerShortcut('CommandOrControl+Down', () => windowManager.broadcast('interview:command', 'scroll-down'));

  } catch (err) {
    console.warn('Failed to register global shortcuts:', err);
  }
}

function importPresetQuestionBank(targetLibId?: string): { success: boolean; message: string; docCount: number } {
  const libs = db.getLibraries();
  const libId = targetLibId || libs[0]?.id || 'default_lib';
  const presetsDir = path.join(app.getPath('userData'), 'presets');
  fs.mkdirSync(presetsDir, { recursive: true });
  const presetFile = path.join(presetsDir, '大厂高频技术面试真题与核心考点.md');
  fs.writeFileSync(presetFile, PRESET_INTERVIEW_BANK_CONTENT, 'utf-8');
  ingestionQueue.addFiles([presetFile], libId);
  return { success: true, message: '预置真题库已加入导入队列', docCount: 1 };
}

function executeAskQuestion(
  sessionId: string,
  question: string,
  libraryIds?: string[],
  clientTurnId?: string,
  options: AnswerOptions = {}
): string {
  const session = db.getSessions().find(s => s.id === sessionId);
  if (!session) throw new Error('会话不存在');
  if (typeof question !== 'string' || !question.trim()) throw new Error('问题不能为空');
  const chatProfile = options.images?.length ? imageProfile() : db.getActiveProfile('chat');
  if (!chatProfile) throw new Error('请先配置 Chat 模型服务');
  const embedProfile = db.getActiveProfile('embed');
  const turnId = clientTurnId?.trim() || `turn_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  if (activeTurns.has(turnId)) throw new Error('问题 ID 已在使用');
  const controller = new AbortController();
  const turn: TurnRecord = { id: turnId, sessionId, role: 'assistant', question,
    answer: '', status: 'streaming', citations: [], createdAt: db.getTurns(sessionId).find(t=>t.id===turnId)?.createdAt || Date.now(), options, answerPolicyVersion:2, timings: {startedAt: Date.now()} };
  if(options.audioTiming)turn.timings!.speechToSubmitMs=options.audioTiming.submittedAt-options.audioTiming.voiceEndedAt;
  turn.timings!.queuedMs = turn.timings!.startedAt - turn.createdAt;
  let settled = false;
  const finishError = (error: Error) => {
    if (settled) return;
    settled = true;
    turn.status = controller.signal.aborted ? 'cancelled' : 'error';
    turn.error = error.message;
    db.saveTurn(turn);
    activeTurns.delete(turnId); setTimeout(drainQuestions, 0);
    windowManager.broadcast('chat:error', { turnId, sessionId, error: error.message, status: turn.status });
  };
  activeTurns.set(turnId, { controller, sessionId, turn, cancel: () => {
    controller.abort(); finishError(new Error('用户取消了生成'));
  } });
  db.saveTurn(turn);
  if (!db.getSetting('active_session_id')) db.setSetting('active_session_id', sessionId);
  windowManager.broadcast('chat:start', { turnId, sessionId, question, createdAt: turn.createdAt, turn });
  const selectedLibraries=libraryIds??session.libraryIds;
  const completedBefore=db.getTurns(sessionId).filter(t=>t.id!==turnId&&t.status==='completed');
  const previous=completedBefore.at(-1);
  const projects=retrievalService.projects(selectedLibraries);
  const previousFocus=previous?.retrieval|| (previous?resolveProjectFocus(previous.question,projects):undefined);
  const focus=resolveProjectFocus(question,projects,previousFocus);
  const continuing=focus.reason==='连续追问继承上一题项目';
  const needsRetrieval = session.strategy === 'docs_only' || answerPolicy(question, session.promptStyle, options).project || focus.documentIds.length>0;
  const targetLibraries = needsRetrieval ? selectedLibraries : [];
  // ACK the identity before running cancellable retrieval/generation.
  void (async () => {
    try {
      ensureEmbeddingIndex(db, vectorIndex, embedProfile);
      let qVec: number[] | undefined;
      if (embedProfile && targetLibraries.length && vectorIndex.size &&
        indexMatchesProvider(vectorIndex, embedProfile) && keyVault.hasKey(embedProfile.id)) {
        try {
          const vectors = await providerService.generateEmbeddings(embedProfile, [question], undefined, controller.signal);
          const current = db.getActiveProfile('embed');
          if (current && embeddingSpaceKey(current) === embeddingSpaceKey(embedProfile) &&
            indexMatchesProvider(vectorIndex, embedProfile) && vectors[0]?.length === vectorIndex.getProfile()?.dimensions) {
            qVec = vectors[0];
          }
        } catch (error) {
          if (controller.signal.aborted) throw error;
          // Keyword retrieval is an intentional fallback; never substitute another space.
        }
      }
      if (controller.signal.aborted || settled) return;
      const retrieval = await retrievalService.retrieve({query:continuing?focus.anchor+'\n本次追问：'+question:question,libraryIds:targetLibraries,topK:8,documentIds:focus.documentIds,
        focusSection:continuing&&!/换个|另一个|其他/.test(question)?previous?.retrieval?.caseSection:undefined},qVec);
      turn.retrieval={...focus,caseSection:retrieval.items.map(i=>caseSection(i.sectionPath)).find(Boolean),omitted:retrieval.omitted||[],items:retrieval.items.map(i=>({chunkId:i.chunkId,fileName:i.fileName,sectionPath:i.sectionPath,chars:i.text.length}))};
      if (controller.signal.aborted || settled) return;
      const candidates: CitationSnapshot[] = retrieval.items.map((item, idx) => ({
        id: `cite_${turnId}_${idx + 1}`, citationIndex: idx + 1, chunkId: item.chunkId,
        documentId: item.documentId, documentVersion: db.getChunk(item.chunkId)?.documentVersion ?? 1,
        fileName: item.fileName, page: item.pageStart, sectionPath: item.sectionPath,
        snippet: item.text.slice(0, 300), fullText: item.text, isVerified: false
      }));
      turn.citations = candidates;
      db.saveTurn(turn);
      const completed = db.getTurns(sessionId).filter(t => t.id !== turnId && t.status === 'completed');
      memoryJobs.get(sessionId)?.abort();
      let memory=db.getMemory(sessionId);
      // Deleted or reimported chunks cannot remain a source of project facts.
      memory={...memory,entries:memory.entries.filter(e=>e.source.type!=='document'||!!db.getChunk(e.source.id))};
      const project=focus.name||selectedProject(memory,question);
      if(project!==memory.currentProject)memory=db.updateMemory({...memory,currentProject:project},memory.revision);
      if(isUserCorrection(question)) {
        const entry={id:crypto.randomUUID(),project:memory.currentProject||'未归类',kind:'fact' as const,text:question,source:{type:'user' as const,id:turnId,quote:question},confirmed:true,updatedAt:Date.now()};
        memory=db.updateMemory({...memory,entries:[...memory.entries,entry]},memory.revision);
        windowManager.broadcast('memory:changed',memory);
      }
      const memoryRevision=memory.revision;
      const contextTurns=focus.documentIds.length?completed.filter(t=>t.retrieval?.documentIds.some(id=>focus.documentIds.includes(id))||t.citations.some(c=>focus.documentIds.includes(c.documentId))):completed;
      const history=[{role:'system',content:`检索范围判断：${focus.reason}。若只给了平台名且存在多个不同项目，请先用一句话澄清具体项目；跨项目比较时分别说明，禁止拼成一个人的同一次实施。\n`+memoryContext(memory,question,focus.documentIds)+`\n用户填写的项目事实：${session.projectFacts||'未提供'}\n目标职位：${session.jobDescription||'未提供'}\n近期问答（回答是草稿，不作为个人事实或格式示范）：${JSON.stringify(recentContext(contextTurns,continuing||options.action==='debug'||options.action==='shorten'||options.action==='explain'))}`}];
      turn.timings!.retrievalMs=Date.now()-turn.timings!.startedAt;
      turn.timings!.modelRequestedAt=Date.now();
      windowManager.broadcast('chat:progress',{turnId,sessionId,timings:turn.timings});
      await providerService.streamChat(chatProfile, question, retrieval.items.map((item, idx) => ({
        citationIndex: idx + 1, text: item.text, fileName: item.fileName, sectionPath: item.sectionPath
      })), session.strategy, history, {
        onResponse: value=>{Object.assign(turn.timings!,value);windowManager.broadcast('chat:progress',{turnId,sessionId,timings:turn.timings});},
        onReset: () => {
          if (settled || controller.signal.aborted) return;
          turn.answer = ''; turn.timings!.firstTokenMs = undefined;
          windowManager.broadcast('chat:reset', {turnId, sessionId});
        },
        onToken: token => {
          if (settled || controller.signal.aborted) return;
          if (turn.timings!.firstTokenMs === undefined) turn.timings!.firstTokenMs = Date.now() - turn.timings!.startedAt;
          if(options.audioTiming&&turn.timings!.speechToFirstTokenMs===undefined)turn.timings!.speechToFirstTokenMs=Date.now()-options.audioTiming.voiceEndedAt;
          turn.answer += token;
          windowManager.broadcast('chat:token', { turnId, sessionId, token, timings:turn.timings });
        },
        onError: finishError,
        onComplete: answer => {
          if (settled || controller.signal.aborted) return;
          settled = true;
          turn.answer = answer; turn.status = 'completed';
          if(turn.retrieval)turn.retrieval.caseSection=answeredCase(answer,retrieval.items)||turn.retrieval.caseSection; turn.timings!.totalMs = Date.now() - turn.timings!.startedAt;
          if(options.images?.length) turn.topic = answer.split('```')[0].trim().slice(0,220) || question;
          const checked = ProviderService.verifyCitations(answer, candidates);
          turn.citations = candidates.map(c => checked.verifiedCitations.find(v => v.id === c.id) || c);
          turn.hallucinatedNumbers = checked.hallucinatedNumbers;
          if (checked.hallucinatedNumbers.length) turn.citationWarning =
            `检测到不存在的资料编号：${checked.hallucinatedNumbers.map(n => `[资料${n}]`).join('、')}；这些引用没有对应证据。`;
          db.saveTurn(turn); activeTurns.delete(turnId); setTimeout(drainQuestions, 0);
          windowManager.broadcast('chat:complete', { turnId, sessionId, turn });
          if(options.action!=='extract') {
            const job=new AbortController();memoryJobs.get(sessionId)?.abort();memoryJobs.set(sessionId,job);
            const sources:MemorySource[]=retrieval.items.map(item=>({id:item.chunkId,type:'document',text:item.text.slice(0,5000)}));
            if(session.projectFacts?.trim())sources.push({id:'user-project-facts',type:'user',text:session.projectFacts});
            if(isUserCorrection(question))sources.push({id:'user-correction',type:'user',text:question});
            void providerService.extractMemory(chatProfile,{question,answer,sources,currentProject:memory.currentProject},job.signal).then(result=>{
              if(job.signal.aborted||db.getMemory(sessionId).revision!==memoryRevision)return;
              const next=verifiedMemoryPatch(memory,result,sources.filter(source=>source.type!=='document'||!!db.getChunk(source.id)),question);
              const updated=db.updateMemory(next,memoryRevision);windowManager.broadcast('memory:changed',updated);
            }).catch(()=>{/* Failed extraction never changes confirmed memory or delays the answer. */}).finally(()=>{if(memoryJobs.get(sessionId)===job)memoryJobs.delete(sessionId);});
          }

        }
      }, session.promptStyle, controller.signal, {...options, language: options.language || session.language || 'C17'});
    } catch (error) {
      finishError(error instanceof Error ? error : new Error(String(error)));
    }
  })();
  return turnId;
}

function reportCaptureError(error: any) { windowManager.broadcast('screen:error', {error: error.message}); }
async function handleCaptureAndAsk(mode: 'interactive' | 'fullscreen' = 'interactive', targetSessionId?: string, targetLibraryIds?: string[]) {
  const sessionId = targetSessionId || db.getSetting('active_session_id') || db.getSessions()[0]?.id;
  if (!sessionId) throw new Error('请先创建会话');
  const captureRes = await captureCoordinator.run(() => captureScreen(mode));
  if (!captureRes) {windowManager.broadcast('screen:stage',{stage:'cancelled',sessionId,at:Date.now()});return null;}
  windowManager.broadcast('screen:stage',{stage:'captured',sessionId,width:captureRes.width,height:captureRes.height,at:Date.now()});
  if (db.getSetting('active_session_id') !== sessionId) throw new Error('会话已切换，请重新截图');
  const image = {...captureRes, id: crypto.randomUUID()};
  windowManager.broadcast('screen:preview', {sessionId, image});
  const question = '请解答截图中的题目；若是代码题，先用候选人口吻讲解法思路，再给完整可运行代码，最后简述复杂度。遵循题目约束，不要先复述输入输出和约束清单。';
  return {question, turnId: submitQuestion(sessionId, question, targetLibraryIds, undefined, {images: [image]})};
}

function registerIpc() {
  // App & Windows
  ipcMain.handle('app:get-runtime-info', () => ({buildId:BUILD_ID,ipcVersion:IPC_VERSION,startedAt,pid:process.pid,dataDirectory:app.getPath('userData'),schemaVersion:db.getSchemaVersion(),ready:startupReady,capabilities:['capture-v2','audio-v2','memory-v2'],keyHealth:keyVault.getHealth()}));
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('window:toggle-floating', () => windowManager.toggleFloatingWindow());
  ipcMain.handle('window:set-opacity', (_, val: number) => windowManager.setOpacity(val));
  ipcMain.handle('window:set-content-protection', (_, val: boolean) => windowManager.setContentProtection(val));
  ipcMain.handle('window:toggle-click-through', () => windowManager.toggleClickThrough());
  ipcMain.handle('window:set-click-through', (_, val: boolean) => windowManager.setClickThrough(val));
  ipcMain.handle('window:get-click-through', () => windowManager.getIsClickThrough());

  // Screen capture & Vision
  ipcMain.handle('screen:capture', async (_, mode?: 'interactive' | 'fullscreen') => {
    return captureCoordinator.run(() => captureScreen(mode || 'interactive'));
  });
  ipcMain.handle('screen:capture-and-ask', async (_, payload?: { mode?: 'interactive' | 'fullscreen'; sessionId?: string; libraryIds?: string[] }) => {
    return handleCaptureAndAsk(payload?.mode || 'interactive', payload?.sessionId, payload?.libraryIds);
  });

  ipcMain.handle('memory:get',(_,sessionId:string)=>db.getMemory(sessionId));
  ipcMain.handle('memory:update',(_,sessionId:string,payload:{expectedRevision:number;currentProject:string;text?:string;removeId?:string})=>{
    memoryJobs.get(sessionId)?.abort();const current=db.getMemory(sessionId);
    const entries=current.entries.filter(e=>e.id!==payload.removeId);
    if(payload.text?.trim())entries.push({id:crypto.randomUUID(),project:payload.currentProject||'未归类',kind:'fact',text:payload.text.trim().slice(0,6000),source:{type:'user',id:'manual-correction',quote:payload.text.trim().slice(0,6000)},confirmed:true,updatedAt:Date.now()});
    const next=db.updateMemory({...current,currentProject:payload.currentProject.trim().slice(0,120),entries},payload.expectedRevision);windowManager.broadcast('memory:changed',next);return next;
  });
  ipcMain.handle('memory:reset',(_,sessionId:string,expectedRevision:number)=>{memoryJobs.get(sessionId)?.abort();const current=db.getMemory(sessionId);const next=db.updateMemory({...current,currentProject:'',entries:[]},expectedRevision);windowManager.broadcast('memory:changed',next);return next;});
  // Compatibility for older renderers; images always use the multimodal chat model.
  ipcMain.handle('interview:get-sharing', () => true);
  ipcMain.handle('interview:set-sharing', () => undefined);
  ipcMain.handle('interview:shortcuts', () => JSON.parse(db.getSetting('shortcut_failures', '[]') || '[]'));
  ipcMain.handle('chat:clear-attachments', (_, sessionId: string) => {
    if ([...activeTurns.values()].some(t => t.sessionId === sessionId) || pendingQuestions.some(t => t.sessionId === sessionId)) throw new Error('请先停止本会话所有回答后清理截图');
    db.clearAttachments(sessionId);
  });
  ipcMain.handle('audio:start', (event, {sessionId, mode, auto}: {sessionId: string; mode: string; auto: boolean}) => {
    if (!['system', 'microphone', 'both'].includes(mode) || !db.getSessions().some(s => s.id === sessionId)) throw new Error('无效的会话或音源');
    return audioSession.start(sessionId, event.sender.id, mode, auto);
  });
  ipcMain.handle('audio:start-system',async(event,{sessionId,captureId}:{sessionId:string;captureId:string})=>{
    if(!nativeAudioEnabled())return {native:false};
    if(!audioSession.owns(event.sender.id,captureId,sessionId))throw Error('监听已结束，请重新开始');
    const current={id:captureId,owner:event.sender.id,sessionId};nativeCapture=current;
    try {
      await nativeSystemAudio.start(path.join(app.getAppPath(),'resources/system-audio'),samples=>{
        if(nativeCapture===current)audioSession.frame(current.owner,current.id,'system',samples);
      },health=>{
        if(nativeCapture===current)windowManager.broadcast('audio:health',{sessionId,captureId,source:'system',...health});
      },message=>{
        if(nativeCapture!==current)return;
        windowManager.broadcast('audio:error',{sessionId,captureId,error:message});audioSession.stop(current.owner);
      });
      return {native:true};
    } catch(error) {
      if(nativeCapture===current){windowManager.broadcast('audio:error',{sessionId,captureId,error:error instanceof Error?error.message:'系统声音连接失败'});nativeCapture=undefined;audioSession.stop(current.owner);}throw error;
    }
  });
  ipcMain.on('audio:frame', (event, p: {captureId: string; source: AudioSource; samples: Float32Array}) => audioSession.frame(event.sender.id, p.captureId, p.source, p.samples));
  ipcMain.handle('audio:stop', event => audioSession.stop(event.sender.id));
  ipcMain.handle('audio:control', (event, changes) => audioSession.control(event.sender.id, changes));
  ipcMain.handle('audio:immediate', event => audioSession.immediate(event.sender.id));
  ipcMain.handle('audio:retry', (event, id: string) => audioSession.retry(event.sender.id, id));
  ipcMain.handle('audio:history', (_, sessionId: string) => db.getTranscripts(sessionId));
  ipcMain.handle('audio:open-permissions',(_,source:string)=>{
    if(process.platform==='darwin')return electron.shell.openExternal(source==='microphone'?'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone':'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  });
  // Audio ASR transcription
  ipcMain.handle('api:transcribe-audio', async (_, payload: { audioData: ArrayBuffer | number[]; mimeType?: string }) => {
    const asrProfile = db.getActiveProfile('asr') || db.getActiveProfile('chat');
    if (!asrProfile) {
      throw new Error('请先在“模型与 API”中配置 ASR 语音模型或 Chat 服务');
    }
    const buffer = Buffer.isBuffer(payload.audioData)
      ? payload.audioData
      : Buffer.from(payload.audioData as any);
    const text = await providerService.transcribeAudio(asrProfile, buffer, payload.mimeType || 'audio/webm');
    return { ok: true, text };
  });

  // Preset question bank
  ipcMain.handle('kb:import-preset-bank', (_, libraryId?: string) => {
    return importPresetQuestionBank(libraryId);
  });

  // Libraries
  ipcMain.handle('kb:get-libraries', () => db.getLibraries());
  ipcMain.handle('kb:save-library', (_, lib: Library) => db.saveLibrary(lib));
  ipcMain.handle('kb:delete-library', (_, id: string) => {
    keywordIndex.removeLibrary(id);
    vectorIndex.removeLibrary(id);
    db.deleteLibrary(id);
  });

  // Documents
  ipcMain.handle('kb:get-documents', (_, libId?: string) => {
    const provider = db.getActiveProfile('embed');
    ensureEmbeddingIndex(db, vectorIndex, provider);
    const profile = vectorIndex.getProfile();
    const indexed = new Set(profile?.spaceKey ? db.getAllEmbeddings({ spaceKey: profile.spaceKey,
      dimensions: profile.dimensions }).map(e => e.chunkId) : []);
    return db.getDocuments(libId).map(doc => {
      if (doc.status === 'failed' || doc.needsOcr) return doc;
      const chunks = db.getChunksByDocument(doc.id);
      return chunks.length && chunks.every(c => indexed.has(c.id)) ? { ...doc, status: 'ready', errorMsg: null }
        : { ...doc, status: 'keyword_only', errorMsg: '当前嵌入配置的索引尚未就绪；请重建向量，当前仅使用关键词检索' };
    });
  });
  ipcMain.handle('kb:delete-document', (_, id: string) => {
    const chunks = db.getChunksByDocument(id);
    for (const c of chunks) {
      keywordIndex.removeChunk(c.id);
      vectorIndex.removeVector(c.id);
    }
    db.deleteEmbeddingsByDocument(id);
    db.deleteDocument(id);
  });

  // Full Text & Chunk Expansion (P1-05)
  ipcMain.handle('kb:get-chunk-neighbors', (_, { chunkId, before, after }: { chunkId: string; before?: number; after?: number }) => {
    return db.getNeighborChunks(chunkId, before ?? 1, after ?? 1);
  });
  ipcMain.handle('kb:get-document-text', (_, docId: string) => {
    return db.getDocumentText(docId);
  });
  ipcMain.handle('kb:rebuild-embeddings', async (_, docId?: string) => {
    return ingestionQueue.rebuildEmbeddings(docId);
  });

  // Import files via dialog
  ipcMain.handle('kb:import-files', async (_, libraryId: string) => {
    const win = windowManager.getMainWindow();
    if (!win) return;
    const res = await dialog.showOpenDialog(win, {
      title: '批量选择文档导入',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '文档文件', extensions: ['pdf', 'docx', 'md', 'markdown', 'txt'] }
      ]
    });
    if (!res.canceled && res.filePaths.length > 0) {
      ingestionQueue.addFiles(res.filePaths, libraryId);
    }
  });

  // Import folder via dialog
  ipcMain.handle('kb:import-folder', async (_, libraryId: string) => {
    const win = windowManager.getMainWindow();
    if (!win) return;
    const res = await dialog.showOpenDialog(win, {
      title: '选择文件夹递归导入',
      properties: ['openDirectory']
    });
    if (!res.canceled && res.filePaths.length > 0) {
      const folderPath = res.filePaths[0];
      const validFiles: string[] = [];
      const scanDir = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            scanDir(full);
          } else {
            const ext = path.extname(e.name).toLowerCase();
            if (['.pdf', '.docx', '.md', '.txt'].includes(ext)) {
              validFiles.push(full);
            }
          }
        }
      };
      scanDir(folderPath);
      if (validFiles.length > 0) {
        ingestionQueue.addFiles(validFiles, libraryId);
      }
    }
  });

  ipcMain.handle('kb:get-ingestion-stats', () => ingestionQueue.getStats());

  // Retrieval Test (P1-01 & P1-03)
  ipcMain.handle('kb:test-retrieval', async (_, req: RetrievalQuery) => {
    let qVec: number[] | undefined;
    const activeEmbedProfile = db.getActiveProfile('embed');
    ensureEmbeddingIndex(db, vectorIndex, activeEmbedProfile);
    // Only generate embeddings if vectorIndex has vectors and embed profile has key!
    if (activeEmbedProfile && indexMatchesProvider(vectorIndex, activeEmbedProfile) && vectorIndex.size > 0 && keyVault.hasKey(activeEmbedProfile.id)) {
      try {
        const vecs = await providerService.generateEmbeddings(activeEmbedProfile, [req.query]);
        if (indexMatchesProvider(vectorIndex, activeEmbedProfile) && db.getActiveProfile('embed') &&
          embeddingSpaceKey(db.getActiveProfile('embed')!) === embeddingSpaceKey(activeEmbedProfile) &&
          vecs[0]?.length === vectorIndex.getProfile()?.dimensions) qVec = vecs[0];
      } catch (err) {
        console.warn('Embedding generation skipped for test query:', err);
      }
    }
    return retrievalService.retrieve(req, qVec);
  });

  // Sessions
  ipcMain.handle('chat:get-sessions', () => db.getSessions());
  ipcMain.handle('chat:get-selected-session', () => db.getSetting('active_session_id') || null);
  ipcMain.handle('chat:save-session', (_, s: SessionRecord) => {
    if (!s.id || !s.title?.trim()) throw Error('请填写会话名称');
    db.saveSession({...s,title:s.title.trim().slice(0,100)});
  });
  ipcMain.handle('chat:delete-session', (_, id: string) => {
    memoryJobs.get(id)?.abort();memoryJobs.delete(id);audioSession.stopSession(id);
    for (let i=pendingQuestions.length-1;i>=0;i--) if(pendingQuestions[i].sessionId===id) pendingQuestions.splice(i,1);
    for (const t of [...activeTurns.values()]) if (t.sessionId === id) t.cancel();
    db.deleteSession(id);
    if(db.getSetting('active_session_id')===id){
      const next=db.getSessions()[0]?.id||'';db.setSetting('active_session_id',next);
      windowManager.broadcast('chat:session',{sessionId:next,turn:next?db.getTurns(next).at(-1)||null:null});
    }
  });
  ipcMain.handle('chat:get-turns', (_, sessionId: string) => db.getTurns(sessionId));

  const activeTurnSnapshot = (sessionId?: string) => {
    const id = sessionId || db.getSetting('active_session_id') || db.getSessions()[0]?.id;
    if (!id) return null;
    const running = [...activeTurns.values()].filter(t => t.sessionId === id).at(-1);
    return running?.turn || db.getTurns(id).at(-1) || null;
  };
  ipcMain.handle('chat:get-active-turn', () => activeTurnSnapshot());
  ipcMain.handle('chat:select-session', (_, sessionId: string) => {
    if (!db.getSessions().some(s => s.id === sessionId)) throw new Error('会话不存在');
    audioSession.stopOtherSession(sessionId);
    db.setSetting('active_session_id', sessionId);
    windowManager.broadcast('chat:session', { sessionId, turn: activeTurnSnapshot(sessionId) });
  });

  // Ask Question / Stream Generation (P1-01, P1-02, P1-03, P1-05, P1-06)
  ipcMain.handle('chat:ask-question', (_, { sessionId, question, libraryIds, turnId: clientTurnId, options }: {
    sessionId: string; question: string; libraryIds?: string[]; turnId?: string; options?: AnswerOptions;
  }) => {
    return submitQuestion(sessionId, question, libraryIds, clientTurnId, options);
  });

  // Cancel generation (P1-06)
  ipcMain.handle('chat:cancel', (_, { turnId, sessionId }: { turnId?: string; sessionId?: string } = {}) => {
    for (let i = pendingQuestions.length - 1; i >= 0; i--) {
      const item = pendingQuestions[i];
      if ((!turnId || item.turnId === turnId) && (!sessionId || item.sessionId === sessionId)) {
        pendingQuestions.splice(i, 1);
        const turn = db.getTurns(item.sessionId).find(t => t.id === item.turnId);
        if (turn) {turn.status = 'cancelled'; db.saveTurn(turn); windowManager.broadcast('chat:error', {turnId: item.turnId, sessionId: item.sessionId, error: '用户取消了生成', status: 'cancelled'});}
      }
    }
    if (turnId) {
      const active = activeTurns.get(turnId);
      if (active && (!sessionId || active.sessionId === sessionId)) active.cancel();
      return; // A stale ID must never cancel a newer request in the same session.
    }
    for (const active of [...activeTurns.values()]) {
      if (!sessionId || active.sessionId === sessionId) active.cancel();
    }
  });

  // Providers & Role Bindings (P1-02 & P2-01)
  ipcMain.handle('api:get-profiles', () => {
    const profiles = db.getProfiles();
    return profiles.map(p => ({
      ...p,
      hasKey: keyVault.hasKey(p.id)
    }));
  });

  ipcMain.handle('api:get-active-roles', () => {
    return {
      chat: db.getActiveProviderId('chat'),
      embed: db.getActiveProviderId('embed'),
      vision: db.getActiveProviderId('vision'),
      asr: db.getActiveProviderId('asr')
    };
  });

  ipcMain.handle('api:set-active-role', (_, { role, profileId }: { role: ProviderRole; profileId: string }) => {
    db.setActiveProviderId(role, profileId);
    if (role === 'embed') restoreEmbeddingIndex(db, vectorIndex, db.getActiveProfile('embed'));
  });

  ipcMain.handle('api:save-profile', (_, profile: ProviderProfile) => {
    db.saveProfile(profile);
    ensureEmbeddingIndex(db, vectorIndex, db.getActiveProfile('embed'));
  });

  ipcMain.handle('api:delete-profile', (_, id: string) => {
    db.deleteProfile(id);
    keyVault.deleteKey(id);
    restoreEmbeddingIndex(db, vectorIndex, db.getActiveProfile('embed'));
  });

  ipcMain.handle('api:set-key', (_, { profileId, key }: { profileId: string; key: string }) => {
    keyVault.setKey(profileId, key);
  });

  ipcMain.handle('api:get-role-configs', () => {
    return getOrInitRoleConfigs(db, keyVault);
  });

  ipcMain.handle('api:save-role-config', (_, payload: {
    role: ProviderRole;
    name?: string;
    baseUrl: string;
    model: string;
    key?: string;
    timeoutMs?: number;
  }) => {
    return saveRoleConfig(db, keyVault, vectorIndex, payload);
  });

  ipcMain.handle('api:sync-role-config', (_, { sourceRole }: { sourceRole: ProviderRole }) => {
    return syncRoleConfig(db, keyVault, vectorIndex, sourceRole);
  });

  ipcMain.handle('api:test-role', async (_, payload: {
    role: ProviderRole;
    baseUrl: string;
    model: string;
    key?: string;
    timeoutMs?: number;
  }) => {
    const { role, baseUrl, model, key, timeoutMs } = payload;
    const currentProfile = db.getActiveProfile(role === 'vision' ? 'chat' : role);
    const existingKey = currentProfile ? (keyVault.getKey(currentProfile.id) || undefined) : undefined;
    const effectiveKey = (key && key.trim().length > 0) ? key.trim() : existingKey;

    const dummyProfile: ProviderProfile = {
      id: currentProfile?.id || `test_${role}`,
      name: `测试 ${role}`,
      protocol: 'openai',
      baseUrl: baseUrl.trim(),
      hasKey: !!effectiveKey,
      modelChat: role === 'chat' ? model.trim() : 'gpt-4o',
      modelEmbed: role === 'embed' ? model.trim() : 'BAAI/bge-m3',
      modelVision: role === 'vision' ? model.trim() : 'gpt-4o',
      modelAsr: role === 'asr' ? model.trim() : 'whisper-1',
      timeoutMs: timeoutMs || 15000,
      isActive: false,
      createdAt: Date.now()
    };

    const res = await providerService.testConnection(dummyProfile, effectiveKey || undefined, role);
    return { ok: res.success, message: res.message, latencyMs: res.latencyMs };
  });

  ipcMain.handle('api:test-provider', async (_, args: { profileId: string; overrideKey?: string; role?: ProviderRole } | string) => {
    const pId = typeof args === 'string' ? args : args.profileId;
    const key = typeof args === 'object' ? args.overrideKey : undefined;
    const role = typeof args === 'object' ? args.role : undefined;

    const profile = db.getProfiles().find(p => p.id === pId);
    if (!profile) return { ok: false, message: '配置不存在' };

    const testRes = await providerService.testConnection(profile, key, role);
    return { ok: testRes.success, message: testRes.message, latencyMs: testRes.latencyMs };
  });

  ipcMain.handle('api:toggle-mock', async (_, enable: boolean) => {
    if (enable) {
      try {
        await mockServer.start();
        return true;
      } catch {
        return false;
      }
    } else {
      await mockServer.stop();
      return false;
    }
  });
}

if (gotTheLock) {
  app.whenReady().then(bootstrap).catch(error => {dialog.showErrorBox('启动失败，原配置已保留',String(error.message));app.quit();});
  app.on('second-instance',()=>{const w=windowManager?.getMainWindow();w?.show();w?.focus();});
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (gotTheLock && startupReady && BrowserWindow.getAllWindows().length === 0) {
    windowManager.createMainWindow();
  }
});

app.on('will-quit', () => {
  for(const job of memoryJobs.values())job.abort();
  audioSession?.stop();
  for (const active of [...activeTurns.values()]) active.cancel();
  globalShortcut.unregisterAll();
  if (mockServer) {
    mockServer.stop();
  }
  if (db) {
    db.close();
  }
});
