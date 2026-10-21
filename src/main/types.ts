export type DocumentStatus = 'queued' | 'parsing' | 'indexing' | 'ready' | 'keyword_only' | 'failed' | 'cancelled';

export interface Library {
  id: string;
  name: string;
  description: string;
  docCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface DocumentRecord {
  id: string;
  fileName: string;
  fileType: 'pdf' | 'docx' | 'md' | 'txt';
  fileSize: number;
  fileHash: string; // SHA-256
  pageCount: number | null;
  status: DocumentStatus;
  errorMsg: string | null;
  needsOcr: boolean;
  storagePath: string;
  createdAt: number;
  updatedAt: number;
  libraryIds: string[];
}

export interface ChunkRecord {
  id: string;
  documentId: string;
  documentVersion: number;
  libraryId: string;
  sectionPath: string; // e.g. "第2章 架构设计 > 2.1 幂等机制"
  pageStart: number | null;
  pageEnd: number | null;
  ordinal: number;
  sourceStart: number;
  sourceEnd: number;
  text: string;
  contentHash: string;
  tokenEstimate: number;
  createdAt: number;
}

export interface EmbeddingRecord {
  chunkId: string;
  profileId: string;
  model?: string;
  dimensions: number;
  vector: number[]; // or Float32Array in memory
  createdAt: number;
}

export type ProviderRole = 'chat' | 'embed' | 'vision' | 'asr';

export interface RoleModelConfig {
  role: ProviderRole;
  name: string;
  baseUrl: string;
  hasKey: boolean;
  model: string;
  timeoutMs: number;
  profileId: string;
}

export interface ProviderProfile {
  id: string;
  name: string;
  protocol: 'openai';
  baseUrl: string;
  hasKey: boolean;
  modelChat: string;
  modelEmbed: string;
  modelVision: string;
  modelAsr: string;
  timeoutMs: number;
  isActive: boolean;
  createdAt: number;
}

export interface RetrievalQuery {
  query: string;
  libraryIds?: string[];
  topK?: number;
  keywordWeight?: number;
  vectorWeight?: number;
  documentIds?: string[];
  focusSection?: string;
  maxContextChars?: number;
}

export interface RetrievalResultItem {
  chunkId: string;
  documentId: string;
  fileName: string;
  sectionPath: string;
  pageStart: number | null;
  pageEnd: number | null;
  text: string;
  keywordScore: number;
  keywordRank?: number;
  vectorScore: number;
  vectorRank?: number;
  rrfScore: number;
  caseKey?: string;
}

export interface RetrievalResult {
  query: string;
  items: RetrievalResultItem[];
  totalCandidates: number;
  latencyMs: number;
  omitted?: string[];
}

export type AnsweringStrategy = 'experience_first' | 'docs_and_general' | 'docs_only';

export type PromptStyle = 'standard' | 'concise' | 'detailed' | 'algorithm' | 'system_design';

export interface SessionRecord {
  id: string;
  title: string;
  libraryIds: string[];
  strategy: AnsweringStrategy;
  promptStyle: PromptStyle;
  language?: string;
  summary?: string;
  projectFacts?: string;
  jobDescription?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TurnRecord {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  question: string;
  answer: string;
  status: 'queued' | 'streaming' | 'completed' | 'cancelled' | 'error';
  options?: AnswerOptions;
  topic?: string;
  answerPolicyVersion?: number;
  retrieval?: {documentIds:string[];name:string;reason:string;anchor:string;caseSection?:string;omitted:string[];items:{fileName:string;sectionPath:string;chunkId:string;chars:number}[]};
  error?: string;
  timings?: {startedAt: number; firstTokenMs?: number; totalMs?: number; queuedMs?: number;
    retrievalMs?: number; modelRequestedAt?: number; responseMs?: number; streaming?: boolean; attempts?: number;
    speechToSubmitMs?: number; speechToFirstTokenMs?: number};
  citations: CitationSnapshot[];
  hallucinatedNumbers?: number[];
  citationWarning?: string;
  createdAt: number;
}

export interface CitationSnapshot {
  id: string;
  citationIndex: number; // e.g. 1 for [资料1]
  chunkId: string;
  documentId: string;
  documentVersion?: number;
  fileName: string;
  page: number | null;
  sectionPath: string;
  snippet: string;
  fullText?: string;
  sourceDeleted?: boolean;
  isVerified?: boolean; // actually cited in answer
}


export interface ImageAttachment { id: string; base64: string; mimeType: string; width?: number; height?: number; }
export interface AnswerOptions {
  images?: ImageAttachment[];
  language?: string;
  action?: 'answer' | 'shorten' | 'explain' | 'debug' | 'extract';
  deepThinking?: boolean;
  audioTiming?: {voiceEndedAt: number; submittedAt: number};
}
export type AudioSource = 'system' | 'microphone';
export interface TranscriptRecord {
  id: string; sessionId: string; captureId: string; sequence: number; source: AudioSource;
  text: string; status: 'pending' | 'completed' | 'error'; error?: string;
  createdAt: number; latencyMs?: number;
  queuedMs?: number; completedAt?: number; audioMs?: number; ignored?: boolean;
}

export interface MemoryEntry {
  id:string; project:string; topic?:string; kind:'fact'|'working'|'uncertain'; text:string;
  source:{type:'document'|'user'|'assistant';id:string;quote?:string}; confirmed:boolean; updatedAt:number;
}
export interface SessionMemory {sessionId:string;revision:number;currentProject:string;entries:MemoryEntry[];updatedAt:number;}
