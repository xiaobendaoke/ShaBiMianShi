import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import {
  Library,
  DocumentRecord,
  ChunkRecord,
  ProviderProfile,
  ProviderRole,
  SessionRecord,
  TurnRecord,
  CitationSnapshot
} from '../types';

export class AppDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    if ((this.db.pragma('user_version', {simple:true}) as number) > 2) {
      this.db.close();
      throw Error('数据库来自更新版本，请使用最新应用打开；未执行降级迁移');
    }
    this.db.transaction(() => this.initSchema())();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS libraries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        doc_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        file_type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        file_hash TEXT NOT NULL,
        page_count INTEGER,
        status TEXT NOT NULL,
        error_msg TEXT,
        needs_ocr INTEGER DEFAULT 0,
        storage_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_docs_hash ON documents(file_hash);

      CREATE TABLE IF NOT EXISTS document_library_links (
        document_id TEXT NOT NULL,
        library_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (document_id, library_id),
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
        FOREIGN KEY (library_id) REFERENCES libraries(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        document_version INTEGER DEFAULT 1,
        library_id TEXT NOT NULL,
        section_path TEXT NOT NULL,
        page_start INTEGER,
        page_end INTEGER,
        ordinal INTEGER NOT NULL,
        source_start INTEGER NOT NULL,
        source_end INTEGER NOT NULL,
        text TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        token_estimate INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(document_id);
      CREATE INDEX IF NOT EXISTS idx_chunks_lib ON chunks(library_id);

      CREATE TABLE IF NOT EXISTS embeddings (
        chunk_id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        model TEXT DEFAULT '',
        dimensions INTEGER NOT NULL,
        vector_blob BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS provider_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        protocol TEXT DEFAULT 'openai',
        base_url TEXT NOT NULL,
        model_chat TEXT NOT NULL,
        model_embed TEXT NOT NULL,
        model_vision TEXT NOT NULL,
        model_asr TEXT NOT NULL,
        timeout_ms INTEGER DEFAULT 30000,
        is_active INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        library_ids_json TEXT NOT NULL,
        strategy TEXT DEFAULT 'docs_and_general',
        prompt_style TEXT DEFAULT 'standard',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        status TEXT NOT NULL,
        hallucinated_numbers TEXT,
        citation_warning TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS answer_citations (
        id TEXT PRIMARY KEY,
        turn_id TEXT NOT NULL,
        citation_index INTEGER NOT NULL,
        chunk_id TEXT,
        document_id TEXT NOT NULL,
        document_version INTEGER DEFAULT 1,
        file_name TEXT NOT NULL,
        page INTEGER,
        section_path TEXT NOT NULL,
        snippet TEXT NOT NULL,
        full_text TEXT,
        is_verified INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (turn_id) REFERENCES turns(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    for (const table of ['sessions', 'turns']) {
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as {name: string}[];
      if (!columns.some(c => c.name === 'metadata_json')) this.db.exec(`ALTER TABLE ${table} ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'`);
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS session_memory (session_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL, FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE)`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS transcripts (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, payload TEXT NOT NULL, FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE)`);
    this.db.prepare("UPDATE turns SET status = 'error' WHERE status IN ('queued', 'streaming')").run();
    // Schema Migrations
    const embeddingColumns = this.db.prepare('PRAGMA table_info(embeddings)').all() as { name: string }[];
    if (!embeddingColumns.some(c => c.name === 'space_key')) {
      this.db.exec("ALTER TABLE embeddings ADD COLUMN space_key TEXT NOT NULL DEFAULT ''");
    }
    try {
      this.db.exec(`ALTER TABLE embeddings ADD COLUMN model TEXT DEFAULT ''`);
    } catch (_) {}
    try {
      this.db.exec(`ALTER TABLE turns ADD COLUMN hallucinated_numbers TEXT`);
    } catch (_) {}
    try {
      this.db.exec(`ALTER TABLE turns ADD COLUMN citation_warning TEXT`);
    } catch (_) {}
    try {
      this.db.exec(`ALTER TABLE answer_citations ADD COLUMN document_version INTEGER DEFAULT 1`);
    } catch (_) {}
    try {
      this.db.exec(`ALTER TABLE answer_citations ADD COLUMN full_text TEXT`);
    } catch (_) {}
    try {
      this.db.exec(`ALTER TABLE answer_citations ADD COLUMN is_verified INTEGER DEFAULT 0`);
    } catch (_) {}
    this.db.pragma('user_version = 2');
  }

  // --- Library Ops ---
  public getLibraries(): Library[] {
    const rows = this.db.prepare(`
      SELECT l.*, (SELECT COUNT(*) FROM document_library_links dll WHERE dll.library_id = l.id) as doc_count 
      FROM libraries l ORDER BY l.created_at ASC
    `).all() as any[];
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      docCount: r.doc_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }

  public getLibrary(id: string): Library | null {
    const r = this.db.prepare(`
      SELECT l.*, (SELECT COUNT(*) FROM document_library_links dll WHERE dll.library_id = l.id) as doc_count 
      FROM libraries l WHERE l.id = ?
    `).get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      docCount: r.doc_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  public saveLibrary(lib: Library) {
    this.db.prepare(`
      INSERT INTO libraries (id, name, description, doc_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        updated_at = excluded.updated_at
    `).run(lib.id, lib.name, lib.description, lib.docCount, lib.createdAt, lib.updatedAt);
  }

  public deleteLibrary(id: string) {
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM document_library_links WHERE library_id = ?`).run(id);
      this.db.prepare(`DELETE FROM libraries WHERE id = ?`).run(id);
      // Synchronize session library scopes: remove deleted library from all sessions
      const sessions = this.getSessions();
      for (const s of sessions) {
        if (s.libraryIds && s.libraryIds.includes(id)) {
          s.libraryIds = s.libraryIds.filter(lid => lid !== id);
          s.updatedAt = Date.now();
          this.saveSession(s);
        }
      }
    })();
  }

  // --- Document Ops ---
  public saveDocument(doc: DocumentRecord) {
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO documents (id, file_name, file_type, file_size, file_hash, page_count, status, error_msg, needs_ocr, storage_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          file_name = excluded.file_name,
          file_type = excluded.file_type,
          file_size = excluded.file_size,
          file_hash = excluded.file_hash,
          page_count = excluded.page_count,
          status = excluded.status,
          error_msg = excluded.error_msg,
          needs_ocr = excluded.needs_ocr,
          storage_path = excluded.storage_path,
          updated_at = excluded.updated_at
      `).run(
        doc.id,
        doc.fileName,
        doc.fileType,
        doc.fileSize,
        doc.fileHash,
        doc.pageCount,
        doc.status,
        doc.errorMsg,
        doc.needsOcr ? 1 : 0,
        doc.storagePath,
        doc.createdAt,
        doc.updatedAt
      );

      // Update library links
      this.db.prepare(`DELETE FROM document_library_links WHERE document_id = ?`).run(doc.id);
      for (const libId of doc.libraryIds) {
        this.db.prepare(`
          INSERT OR IGNORE INTO libraries (id, name, description, doc_count, created_at, updated_at)
          VALUES (?, ?, '', 0, ?, ?)
        `).run(libId, '知识库 ' + libId, Date.now(), Date.now());

        this.db.prepare(`
          INSERT OR IGNORE INTO document_library_links (document_id, library_id, created_at)
          VALUES (?, ?, ?)
        `).run(doc.id, libId, Date.now());
      }
    })();
  }

  public getDocument(id: string): DocumentRecord | null {
    const r = this.db.prepare(`SELECT * FROM documents WHERE id = ?`).get(id) as any;
    if (!r) return null;
    const links = this.db.prepare(`SELECT library_id FROM document_library_links WHERE document_id = ?`).all(id) as any[];
    return {
      id: r.id,
      fileName: r.file_name,
      fileType: r.file_type,
      fileSize: r.file_size,
      fileHash: r.file_hash,
      pageCount: r.page_count,
      status: r.status,
      errorMsg: r.error_msg,
      needsOcr: r.needs_ocr === 1,
      storagePath: r.storage_path,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      libraryIds: links.map(l => l.library_id)
    };
  }

  public findDocumentByHash(fileHash: string): DocumentRecord | null {
    const r = this.db.prepare(`SELECT id FROM documents WHERE file_hash = ? LIMIT 1`).get(fileHash) as any;
    if (!r) return null;
    return this.getDocument(r.id);
  }

  public getDocuments(libraryId?: string): DocumentRecord[] {
    let rows: any[] = [];
    if (libraryId) {
      rows = this.db.prepare(`
        SELECT d.* FROM documents d
        JOIN document_library_links dll ON dll.document_id = d.id
        WHERE dll.library_id = ?
        ORDER BY d.created_at DESC
      `).all(libraryId) as any[];
    } else {
      rows = this.db.prepare(`SELECT * FROM documents ORDER BY created_at DESC`).all() as any[];
    }

    return rows.map(r => {
      const links = this.db.prepare(`SELECT library_id FROM document_library_links WHERE document_id = ?`).all(r.id) as any[];
      return {
        id: r.id,
        fileName: r.file_name,
        fileType: r.file_type,
        fileSize: r.file_size,
        fileHash: r.file_hash,
        pageCount: r.page_count,
        status: r.status,
        errorMsg: r.error_msg,
        needsOcr: r.needs_ocr === 1,
        storagePath: r.storage_path,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        libraryIds: links.map(l => l.library_id)
      };
    });
  }

  public deleteDocument(id: string) {
    this.db.prepare(`DELETE FROM documents WHERE id = ?`).run(id);
  }

  // --- Chunk Ops ---
  public saveChunks(chunks: ChunkRecord[]) {
    const stmt = this.db.prepare(`
      INSERT INTO chunks (id, document_id, document_version, library_id, section_path, page_start, page_end, ordinal, source_start, source_end, text, content_hash, token_estimate, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        text = excluded.text,
        content_hash = excluded.content_hash,
        token_estimate = excluded.token_estimate
    `);

    const tx = this.db.transaction((chunkList: ChunkRecord[]) => {
      for (const c of chunkList) {
        stmt.run(
          c.id,
          c.documentId,
          c.documentVersion,
          c.libraryId,
          c.sectionPath,
          c.pageStart,
          c.pageEnd,
          c.ordinal,
          c.sourceStart,
          c.sourceEnd,
          c.text,
          c.contentHash,
          c.tokenEstimate,
          c.createdAt
        );
      }
    });

    tx(chunks);
  }

  public getChunksByDocument(documentId: string): ChunkRecord[] {
    const rows = this.db.prepare(`SELECT * FROM chunks WHERE document_id = ? ORDER BY ordinal ASC`).all(documentId) as any[];
    return rows.map(r => ({
      id: r.id,
      documentId: r.document_id,
      documentVersion: r.document_version,
      libraryId: r.library_id,
      sectionPath: r.section_path,
      pageStart: r.page_start,
      pageEnd: r.page_end,
      ordinal: r.ordinal,
      sourceStart: r.source_start,
      sourceEnd: r.source_end,
      text: r.text,
      contentHash: r.content_hash,
      tokenEstimate: r.token_estimate,
      createdAt: r.created_at
    }));
  }

  public getAllChunks(): ChunkRecord[] {
    const rows = this.db.prepare(`SELECT * FROM chunks`).all() as any[];
    return rows.map(r => ({
      id: r.id,
      documentId: r.document_id,
      documentVersion: r.document_version,
      libraryId: r.library_id,
      sectionPath: r.section_path,
      pageStart: r.page_start,
      pageEnd: r.page_end,
      ordinal: r.ordinal,
      sourceStart: r.source_start,
      sourceEnd: r.source_end,
      text: r.text,
      contentHash: r.content_hash,
      tokenEstimate: r.token_estimate,
      createdAt: r.created_at
    }));
  }

  public getChunk(id: string): ChunkRecord | null {
    const r = this.db.prepare('SELECT * FROM chunks WHERE id = ?').get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      documentId: r.document_id,
      documentVersion: r.document_version,
      libraryId: r.library_id,
      sectionPath: r.section_path,
      pageStart: r.page_start,
      pageEnd: r.page_end,
      ordinal: r.ordinal,
      sourceStart: r.source_start,
      sourceEnd: r.source_end,
      text: r.text,
      contentHash: r.content_hash,
      tokenEstimate: r.token_estimate,
      createdAt: r.created_at
    };
  }

  public getNeighborChunks(chunkId: string, beforeCount = 1, afterCount = 1): ChunkRecord[] {
    const target = this.getChunk(chunkId);
    if (!target) return [];
    const minOrd = Math.max(0, target.ordinal - beforeCount);
    const maxOrd = target.ordinal + afterCount;
    const rows = this.db.prepare(`
      SELECT * FROM chunks 
      WHERE document_id = ? AND ordinal >= ? AND ordinal <= ?
      ORDER BY ordinal ASC
    `).all(target.documentId, minOrd, maxOrd) as any[];
    return rows.map(r => ({
      id: r.id,
      documentId: r.document_id,
      documentVersion: r.document_version,
      libraryId: r.library_id,
      sectionPath: r.section_path,
      pageStart: r.page_start,
      pageEnd: r.page_end,
      ordinal: r.ordinal,
      sourceStart: r.source_start,
      sourceEnd: r.source_end,
      text: r.text,
      contentHash: r.content_hash,
      tokenEstimate: r.token_estimate,
      createdAt: r.created_at
    }));
  }

  public getDocumentText(documentId: string): string {
    const chunks = this.getChunksByDocument(documentId);
    return chunks.map(c => c.text).join('\n\n');
  }

  public getDocumentLibraryLinks(): { documentId: string; libraryId: string }[] {
    const rows = this.db.prepare('SELECT document_id, library_id FROM document_library_links').all() as any[];
    return rows.map(r => ({ documentId: r.document_id, libraryId: r.library_id }));
  }

  public deleteChunksByDocument(documentId: string) {
    this.db.prepare(`DELETE FROM chunks WHERE document_id = ?`).run(documentId);
  }

  // --- Embeddings Ops ---
  public saveEmbeddings(embeddings: { chunkId: string; profileId: string; model?: string; spaceKey?: string; dimensions: number; vector: Float32Array | number[] }[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO embeddings (chunk_id, profile_id, model, space_key, dimensions, vector_blob, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET
        profile_id = excluded.profile_id,
        model = excluded.model,
        space_key = excluded.space_key,
        dimensions = excluded.dimensions,
        vector_blob = excluded.vector_blob,
        created_at = excluded.created_at
    `);

    const tx = this.db.transaction((list: typeof embeddings) => {
      for (const item of list) {
        let buf: Buffer;
        if (item.vector instanceof Float32Array) {
          buf = Buffer.from(item.vector.buffer, item.vector.byteOffset, item.vector.byteLength);
        } else {
          const f32 = new Float32Array(item.vector);
          buf = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
        }
        stmt.run(item.chunkId, item.profileId, item.model || '', item.spaceKey || '', item.dimensions, buf, Date.now());
      }
    });

    tx(embeddings);
  }

  public getAllEmbeddings(filter?: { model?: string; dimensions?: number; spaceKey?: string }): { chunkId: string; profileId: string; model: string; spaceKey: string; dimensions: number; vector: Float32Array }[] {
    const clauses: string[] = [];
    const values: (string | number)[] = [];
    for (const [field, value] of [['model', filter?.model], ['dimensions', filter?.dimensions], ['space_key', filter?.spaceKey]] as const) {
      if (value !== undefined) { clauses.push(`${field} = ?`); values.push(value); }
    }
    const rows = this.db.prepare('SELECT * FROM embeddings' + (clauses.length ? ' WHERE ' + clauses.join(' AND ') : '')).all(...values) as any[];
    return rows.map(r => {
      const buf = r.vector_blob as Buffer;
      const copy = new Uint8Array(buf).buffer;
      const f32 = new Float32Array(copy);
      return {
        chunkId: r.chunk_id,
        profileId: r.profile_id,
        model: r.model || '',
        spaceKey: r.space_key || '',
        dimensions: r.dimensions,
        vector: f32
      };
    });
  }

  public getEmbeddingsByDocument(documentId: string): { chunkId: string; profileId: string; model: string; spaceKey: string; dimensions: number; vector: Float32Array }[] {
    const rows = this.db.prepare(`
      SELECT e.* FROM embeddings e
      JOIN chunks c ON c.id = e.chunk_id
      WHERE c.document_id = ?
    `).all(documentId) as any[];
    return rows.map(r => {
      const buf = r.vector_blob as Buffer;
      const copy = new Uint8Array(buf).buffer;
      const f32 = new Float32Array(copy);
      return {
        chunkId: r.chunk_id,
        profileId: r.profile_id,
        model: r.model || '',
        spaceKey: r.space_key || '',
        dimensions: r.dimensions,
        vector: f32
      };
    });
  }

  public deleteEmbeddingsByDocument(documentId: string): void {
    this.db.prepare(`
      DELETE FROM embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE document_id = ?)
    `).run(documentId);
  }

  public getEmbeddingCount(): number {
    const r = this.db.prepare('SELECT COUNT(*) as cnt FROM embeddings').get() as any;
    return r ? r.cnt : 0;
  }

  public getEmbeddingProfile(spaceKey?: string): { profileId: string; model: string; spaceKey?: string; dimensions: number; createdAt: number } | null {
    const val = this.getSetting(spaceKey ? `embedding_profile:${spaceKey}` : 'current_embedding_profile');
    if (!val) return null;
    try {
      return JSON.parse(val);
    } catch {
      return null;
    }
  }

  public saveEmbeddingProfile(profile: { profileId: string; model: string; spaceKey?: string; dimensions: number; createdAt?: number }): void {
    const value = JSON.stringify({ ...profile, createdAt: profile.createdAt || Date.now() });
    this.setSetting('current_embedding_profile', value);
    if (profile.spaceKey) this.setSetting(`embedding_profile:${profile.spaceKey}`, value);
  }

  // --- Provider Profile Ops ---
  public getProfiles(): ProviderProfile[] {
    const rows = this.db.prepare(`SELECT * FROM provider_profiles ORDER BY created_at ASC`).all() as any[];
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      protocol: r.protocol,
      baseUrl: r.base_url,
      hasKey: false, // populated via KeyVault
      modelChat: r.model_chat,
      modelEmbed: r.model_embed,
      modelVision: r.model_vision,
      modelAsr: r.model_asr,
      timeoutMs: r.timeout_ms,
      isActive: r.is_active === 1,
      createdAt: r.created_at
    }));
  }

  public saveProfile(p: ProviderProfile) {
    this.db.prepare(`
      INSERT INTO provider_profiles (id, name, protocol, base_url, model_chat, model_embed, model_vision, model_asr, timeout_ms, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        base_url = excluded.base_url,
        model_chat = excluded.model_chat,
        model_embed = excluded.model_embed,
        model_vision = excluded.model_vision,
        model_asr = excluded.model_asr,
        timeout_ms = excluded.timeout_ms,
        is_active = excluded.is_active
    `).run(
      p.id,
      p.name,
      p.protocol,
      p.baseUrl,
      p.modelChat,
      p.modelEmbed,
      p.modelVision,
      p.modelAsr,
      p.timeoutMs,
      p.isActive ? 1 : 0,
      p.createdAt
    );
  }

  public deleteProfile(id: string) {
    this.db.prepare(`DELETE FROM provider_profiles WHERE id = ?`).run(id);
    for (const role of ['chat', 'embed', 'vision', 'asr']) {
      if (this.getSetting(`active_${role}_provider_id`) === id) {
        this.setSetting(`active_${role}_provider_id`, '');
      }
    }
  }

  // --- Settings & Role Bindings ---
  public getSetting(key: string, defaultValue?: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as any;
    return row ? row.value : defaultValue;
  }

  public setSetting(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO app_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  public getActiveProviderId(role: ProviderRole): string | null {
    const key = `active_${role}_provider_id`;
    const val = this.getSetting(key);
    if (val && val.trim().length > 0) return val;
    // Fallback: if no explicit setting, look for isActive profile
    const fallback = this.db.prepare('SELECT id FROM provider_profiles WHERE is_active = 1 LIMIT 1').get() as any;
    return fallback ? fallback.id : null;
  }

  public setActiveProviderId(role: ProviderRole, profileId: string): void {
    this.setSetting(`active_${role}_provider_id`, profileId);
  }

  public getActiveProfile(role: ProviderRole): ProviderProfile | null {
    const id = this.getActiveProviderId(role);
    if (!id) return null;
    const r = this.db.prepare('SELECT * FROM provider_profiles WHERE id = ?').get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      protocol: r.protocol,
      baseUrl: r.base_url,
      hasKey: false,
      modelChat: r.model_chat,
      modelEmbed: r.model_embed,
      modelVision: r.model_vision,
      modelAsr: r.model_asr,
      timeoutMs: r.timeout_ms,
      isActive: r.is_active === 1,
      createdAt: r.created_at
    };
  }

  // --- Sessions & Turns ---
  public getSessions(): SessionRecord[] {
    const rows = this.db.prepare(`SELECT * FROM sessions ORDER BY updated_at DESC`).all() as any[];
    return rows.map(r => ({
      id: r.id,
      title: r.title,
      libraryIds: JSON.parse(r.library_ids_json || '[]'),
      strategy: r.strategy,
      promptStyle: r.prompt_style,
      ...JSON.parse(r.metadata_json || '{}'),
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }

  public saveSession(s: SessionRecord) {
    const existing = this.db.prepare('SELECT metadata_json FROM sessions WHERE id = ?').get(s.id) as {metadata_json: string} | undefined;
    const previous = JSON.parse(existing?.metadata_json || '{}');
    this.db.prepare(`
      INSERT INTO sessions (id, title, library_ids_json, strategy, prompt_style, created_at, updated_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        library_ids_json = excluded.library_ids_json,
        strategy = excluded.strategy,
        prompt_style = excluded.prompt_style,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(s.id, s.title, JSON.stringify(s.libraryIds), s.strategy, s.promptStyle, s.createdAt, s.updatedAt, JSON.stringify({language: s.language || 'C17', summary: s.summary ?? previous.summary, projectFacts: s.projectFacts ?? previous.projectFacts, jobDescription: s.jobDescription ?? previous.jobDescription}));
  }

  public deleteSession(id: string) {
    this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
  }

  public getTurns(sessionId: string): TurnRecord[] {
    const rows = this.db.prepare(`SELECT * FROM turns WHERE session_id = ? ORDER BY created_at ASC`).all(sessionId) as any[];
    return rows.map(r => {
      const citeRows = this.db.prepare(`SELECT * FROM answer_citations WHERE turn_id = ? ORDER BY citation_index ASC`).all(r.id) as any[];
      const citations: CitationSnapshot[] = citeRows.map(c => ({
        id: c.id,
        citationIndex: c.citation_index,
        chunkId: c.chunk_id,
        documentId: c.document_id,
        documentVersion: c.document_version || 1,
        fileName: c.file_name,
        page: c.page,
        sectionPath: c.section_path,
        snippet: c.snippet,
        fullText: c.full_text || c.snippet || '',
        isVerified: c.is_verified === 1 || c.is_verified === true,
        sourceDeleted: !this.getDocument(c.document_id)
      }));

      let hallucinatedNumbers: number[] | undefined;
      if (r.hallucinated_numbers) {
        try {
          hallucinatedNumbers = JSON.parse(r.hallucinated_numbers);
        } catch {}
      }

      return {
        id: r.id,
        sessionId: r.session_id,
        role: r.role,
        question: r.question,
        answer: r.answer,
        status: r.status,
        citations,
        hallucinatedNumbers,
        citationWarning: r.citation_warning || undefined,
        ...JSON.parse(r.metadata_json || '{}'),
        createdAt: r.created_at
      };
    });
  }

  public saveTurn(turn: TurnRecord) {
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO turns (id, session_id, role, question, answer, status, hallucinated_numbers, citation_warning, created_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          question = excluded.question,
          answer = excluded.answer,
          status = excluded.status,
          hallucinated_numbers = excluded.hallucinated_numbers,
          citation_warning = excluded.citation_warning,
          metadata_json = excluded.metadata_json
      `).run(
        turn.id,
        turn.sessionId,
        turn.role,
        turn.question,
        turn.answer,
        turn.status,
        turn.hallucinatedNumbers ? JSON.stringify(turn.hallucinatedNumbers) : null,
        turn.citationWarning || null,
        turn.createdAt, JSON.stringify({options: turn.options, error: turn.error, timings: turn.timings, topic: turn.topic, answerPolicyVersion:turn.answerPolicyVersion,retrieval:turn.retrieval})
      );

      this.db.prepare(`DELETE FROM answer_citations WHERE turn_id = ?`).run(turn.id);
      for (const c of turn.citations) {
        this.db.prepare(`
          INSERT INTO answer_citations (id, turn_id, citation_index, chunk_id, document_id, document_version, file_name, page, section_path, snippet, full_text, is_verified, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          c.id,
          turn.id,
          c.citationIndex,
          c.chunkId,
          c.documentId,
          c.documentVersion || 1,
          c.fileName,
          c.page,
          c.sectionPath,
          c.snippet,
          c.fullText || c.snippet || '',
          c.isVerified ? 1 : 0,
          Date.now()
        );
      }
    })();
  }

  public saveTranscript(record: import('../types').TranscriptRecord) {
    this.db.prepare('INSERT INTO transcripts (id, session_id, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(record.id, record.sessionId, JSON.stringify(record));
  }
  public getTranscripts(sessionId: string): import('../types').TranscriptRecord[] {
    return (this.db.prepare('SELECT payload FROM transcripts WHERE session_id = ? ORDER BY rowid').all(sessionId) as {payload: string}[]).map(r => JSON.parse(r.payload));
  }
  public clearAttachments(sessionId: string) {
    for (const turn of this.getTurns(sessionId)) if (turn.options?.images?.length) this.saveTurn({...turn, options: {...turn.options, images: []}});
  }

  public getMemory(sessionId:string): import('../types').SessionMemory {
    const row=this.db.prepare('SELECT payload FROM session_memory WHERE session_id=?').get(sessionId) as {payload:string}|undefined;
    return row?JSON.parse(row.payload):{sessionId,revision:0,currentProject:'',entries:[],updatedAt:0};
  }
  public updateMemory(memory:import('../types').SessionMemory, expectedRevision:number) {
    return this.db.transaction(()=>{
      if(!this.db.prepare('SELECT id FROM sessions WHERE id=?').get(memory.sessionId))throw Error('会话不存在');
      const current=this.getMemory(memory.sessionId);if(current.revision!==expectedRevision)throw Error('记忆已更新，请刷新后重试');
      const next={...memory,revision:expectedRevision+1,updatedAt:Date.now()};
      this.db.prepare('INSERT INTO session_memory(session_id,revision,payload) VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload').run(next.sessionId,next.revision,JSON.stringify(next));return next;
    })();
  }
  public getSchemaVersion():number {return this.db.pragma('user_version',{simple:true}) as number;}

  public close() {
    this.db.close();
  }
}
