import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { AppDatabase } from '../db/database';
import { KeywordIndex } from '../indexing/keywordIndex';
import { VectorIndex } from '../indexing/vectorIndex';
import { embeddingSpaceKey } from '../indexing/embeddingSpace';
import { restoreEmbeddingIndex } from '../indexing/embeddingLifecycle';
import { ProviderService } from './providerService';
import { parseDocument } from '../parsers';
import { chunkDocument } from '../chunker/chunker';
import { DocumentRecord, DocumentStatus } from '../types';

export interface IngestionTask {
  id: string;
  filePath: string;
  fileName: string;
  libraryId: string;
  status: DocumentStatus;
  progress: number;
  error?: string;
}

export interface IngestionStats {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}

export class IngestionQueue extends EventEmitter {
  private db: AppDatabase;
  private keywordIndex: KeywordIndex;
  private vectorIndex: VectorIndex;
  private storageDir: string;
  private providerService?: ProviderService;
  private queue: IngestionTask[] = [];
  private concurrency: number = 2;
  private activeCount: number = 0;
  private completedCount: number = 0;
  private failedCount: number = 0;
  private cancelledIds: Set<string> = new Set();

  constructor(
    db: AppDatabase,
    keywordIndex: KeywordIndex,
    vectorIndex: VectorIndex,
    storageDir: string,
    providerService?: ProviderService
  ) {
    super();
    this.db = db;
    this.keywordIndex = keywordIndex;
    this.vectorIndex = vectorIndex;
    this.storageDir = storageDir;
    this.providerService = providerService;
    fs.mkdirSync(this.storageDir, { recursive: true });
  }

  public setProviderService(providerService: ProviderService) {
    this.providerService = providerService;
  }

  public getStats(): IngestionStats {
    return {
      queued: this.queue.length,
      processing: this.activeCount,
      completed: this.completedCount,
      failed: this.failedCount,
      total: this.queue.length + this.activeCount + this.completedCount + this.failedCount
    };
  }

  public addFiles(filePaths: string[], libraryId: string): IngestionTask[] {
    const tasks: IngestionTask[] = [];
    for (const fp of filePaths) {
      const fileName = path.basename(fp);
      const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const task: IngestionTask = {
        id: taskId,
        filePath: fp,
        fileName,
        libraryId,
        status: 'queued',
        progress: 0
      };
      this.queue.push(task);
      tasks.push(task);
    }
    this.emit('task-updated', this.getStats());
    this.processNext();
    return tasks;
  }

  public cancelTask(taskId: string) {
    this.cancelledIds.add(taskId);
    const idx = this.queue.findIndex(t => t.id === taskId);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
    }
    this.emit('task-updated', this.getStats());
  }

  private async processNext() {
    if (this.activeCount >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift();
    if (!task) return;

    if (this.cancelledIds.has(task.id)) {
      this.cancelledIds.delete(task.id);
      this.processNext();
      return;
    }

    this.activeCount++;
    task.status = 'parsing';
    task.progress = 20;
    this.emit('task-progress', task);

    try {
      await this.processTask(task);
      task.progress = 100;
      this.completedCount++;
      this.emit('task-progress', task);
    } catch (err: any) {
      console.error(`Error ingesting file ${task.fileName}:`, err);
      task.status = 'failed';
      task.error = err.message || '解析失败';
      this.failedCount++;
      this.emit('task-progress', task);
    } finally {
      this.activeCount--;
      this.emit('task-updated', this.getStats());
      this.processNext();
    }
  }

  private async processTask(task: IngestionTask) {
    const buffer = fs.readFileSync(task.filePath);
    const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const ext = path.extname(task.fileName).replace('.', '').toLowerCase();
    const fileType = (['pdf', 'docx', 'md', 'txt'].includes(ext) ? ext : 'txt') as 'pdf' | 'docx' | 'md' | 'txt';

    // 1. Deduplication Check by SHA-256
    const existingDoc = this.db.findDocumentByHash(fileHash);
    if (existingDoc) {
      if (!existingDoc.libraryIds.includes(task.libraryId)) {
        existingDoc.libraryIds.push(task.libraryId);
        this.db.saveDocument(existingDoc);
      }
      // The last library may have been deleted: reconstruct actual chunks, not
      // just an association for a chunk that no longer exists in memory.
      for (const chunk of this.db.getChunksByDocument(existingDoc.id)) {
        this.keywordIndex.addChunk(chunk, existingDoc.libraryIds);
      }
      restoreEmbeddingIndex(this.db, this.vectorIndex, this.db.getActiveProfile('embed'));
      task.status = existingDoc.status;
      return;
    }

    // Save copy to storage directory
    const docId = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const savedPath = path.join(this.storageDir, `${docId}_${task.fileName}`);
    fs.writeFileSync(savedPath, buffer);

    // 2. Parse Document asynchronously
    const parsed = await parseDocument(task.fileName, buffer);

    const docRecord: DocumentRecord = {
      id: docId,
      fileName: task.fileName,
      fileType,
      fileSize: buffer.length,
      fileHash,
      pageCount: parsed.pageCount,
      status: 'indexing',
      errorMsg: null,
      needsOcr: parsed.needsOcr,
      storagePath: savedPath,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      libraryIds: [task.libraryId]
    };

    this.db.saveDocument(docRecord);

    // 3. Chunk Document
    task.status = 'indexing';
    task.progress = 50;
    this.emit('task-progress', task);

    const chunks = chunkDocument(docId, 1, task.libraryId, parsed);
    this.db.saveChunks(chunks);

    // 4. Index Chunks for Keyword Search
    for (const chunk of chunks) {
      this.keywordIndex.addChunk(chunk, docRecord.libraryIds);
    }

    // 5. Generate Vector Embeddings (P1-01)
    const activeEmbedProfile = this.db.getActiveProfile('embed');
    if (this.providerService && activeEmbedProfile && chunks.length > 0) {
      try {
        task.progress = 75;
        this.emit('task-progress', task);

        const texts = chunks.map(c => `${c.sectionPath}\n${c.text}`);
        const vectors = await this.providerService.generateEmbeddings(activeEmbedProfile, texts, (done, total) => {
          task.progress = Math.min(95, 75 + Math.floor((done / total) * 20));
          this.emit('task-progress', task);
        });

        const dimensions = this.validateVectors(vectors, chunks.length);
        const spaceKey = embeddingSpaceKey(activeEmbedProfile);
        const selected = this.db.getActiveProfile('embed');
        if (!selected || embeddingSpaceKey(selected) !== spaceKey) {
          throw new Error('嵌入配置已变化；未替换索引，请为当前配置重建向量');
        }
        this.db.saveEmbeddings(chunks.map((chunk, i) => ({
          chunkId: chunk.id, profileId: activeEmbedProfile.id,
          model: activeEmbedProfile.modelEmbed, spaceKey, dimensions, vector: vectors[i]
        })));
        this.db.saveEmbeddingProfile({ profileId: activeEmbedProfile.id,
          model: activeEmbedProfile.modelEmbed, spaceKey, dimensions });
        const current = this.db.getActiveProfile('embed');
        restoreEmbeddingIndex(this.db, this.vectorIndex, current);
        docRecord.status = current && embeddingSpaceKey(current) === spaceKey ? 'ready' : 'keyword_only';
        if (docRecord.status === 'keyword_only') docRecord.errorMsg = '嵌入配置已变化，请为当前配置重建向量';

      } catch (embErr: any) {
        console.warn(`Embedding generation failed for ${task.fileName}, fallback to keyword:`, embErr.message);
        docRecord.status = 'keyword_only';
        docRecord.errorMsg = `语义向量未生成 (${embErr.message})，已启用关键词检索`;
      }
    } else {
      docRecord.status = 'keyword_only';
      if (!activeEmbedProfile) {
        docRecord.errorMsg = '未配置向量嵌入模型，当前仅支持关键词检索';
      }
    }

    if (parsed.needsOcr) {
      docRecord.needsOcr = true;
      docRecord.errorMsg = '文档为扫描件或无有效文本图层，需 OCR 识别后方可检索';
      docRecord.status = 'keyword_only';
    }

    this.db.saveDocument(docRecord);
    task.status = docRecord.status;
  }

  public async rebuildEmbeddings(docId?: string): Promise<{ processed: number; succeeded: number }> {
    const activeEmbedProfile = this.db.getActiveProfile('embed');
    if (!this.providerService || !activeEmbedProfile) {
      throw new Error('未配置或未激活向量模型，无法生成语义嵌入');
    }

    const chunks = docId
      ? this.db.getChunksByDocument(docId)
      : this.db.getAllChunks();

    if (chunks.length === 0) return { processed: 0, succeeded: 0 };

    const texts = chunks.map(c => `${c.sectionPath}\n${c.text}`);
    const vectors = await this.providerService.generateEmbeddings(activeEmbedProfile, texts);

    const dimensions = this.validateVectors(vectors, chunks.length);
    const spaceKey = embeddingSpaceKey(activeEmbedProfile);
    const current = this.db.getActiveProfile('embed');
    if (!current || embeddingSpaceKey(current) !== spaceKey) {
      throw new Error('重建期间嵌入配置已变化；未替换现有索引，请使用当前配置重新重建');
    }
    this.db.saveEmbeddings(chunks.map((chunk, i) => ({
      chunkId: chunk.id, profileId: activeEmbedProfile.id,
      model: activeEmbedProfile.modelEmbed, spaceKey, dimensions, vector: vectors[i]
    })));
    this.db.saveEmbeddingProfile({ profileId: activeEmbedProfile.id,
      model: activeEmbedProfile.modelEmbed, spaceKey, dimensions });
    restoreEmbeddingIndex(this.db, this.vectorIndex, current);
    for (const documentId of new Set(chunks.map(c => c.documentId))) {
      const doc = this.db.getDocument(documentId);
      if (doc && !doc.needsOcr) {
        doc.status = 'ready'; doc.errorMsg = null;
        this.db.saveDocument(doc);
      }
    }

    return { processed: chunks.length, succeeded: vectors.length };
  }
  private validateVectors(vectors: number[][], expected: number): number {
    const dimensions = vectors[0]?.length ?? 0;
    if (vectors.length !== expected || !dimensions || vectors.some(v =>
      !Array.isArray(v) || v.length !== dimensions || v.some(n => !Number.isFinite(n)))) {
      throw new Error('向量响应数量、维度或数值不合法；现有索引未替换');
    }
    return dimensions;
  }

}
