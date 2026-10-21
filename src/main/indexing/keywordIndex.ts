import { ChunkRecord } from '../types';

export interface KeywordSearchResult {
  chunkId: string;
  score: number;
}

export class KeywordIndex {
  private segmenter: Intl.Segmenter;
  // term -> Map<chunkId, termFrequency>
  private invertedIndex: Map<string, Map<string, number>> = new Map();
  // chunkId -> document length (token count)
  private docLengths: Map<string, number> = new Map();
  // chunkId -> ChunkRecord
  private chunks: Map<string, ChunkRecord> = new Map();
  // chunkId -> Set of libraryIds
  private chunkLibraries: Map<string, Set<string>> = new Map();
  private totalLength: number = 0;

  constructor() {
    this.segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
  }

  public tokenize(text: string): string[] {
    const tokens: string[] = [];
    const segments = this.segmenter.segment(text);

    for (const seg of segments) {
      const term = seg.segment.trim().toLowerCase();
      // Exclude punctuation, symbols, and single whitespaces
      if (term.length > 0 && !/^[\p{P}\p{S}\s]+$/u.test(term)) {
        tokens.push(term);
        // If Chinese term has length >= 4, add bi-grams for composite search robustness
        if (/^[\u4e00-\u9fa5]+$/.test(term) && term.length >= 4) {
          for (let i = 0; i < term.length - 1; i += 2) {
            tokens.push(term.slice(i, i + 2));
          }
        }
      }
    }
    return tokens;
  }

  public addChunk(chunk: ChunkRecord, libraryIds?: string[]) {
    this.removeChunk(chunk.id);

    this.chunks.set(chunk.id, chunk);
    const libSet = new Set<string>();
    if (libraryIds === undefined && chunk.libraryId) libSet.add(chunk.libraryId);
    if (libraryIds) {
      for (const id of libraryIds) libSet.add(id);
    }
    this.chunkLibraries.set(chunk.id, libSet);

    const tokens = this.tokenize(chunk.text + ' ' + chunk.sectionPath);
    this.docLengths.set(chunk.id, tokens.length);
    this.totalLength += tokens.length;

    const tfMap = new Map<string, number>();
    for (const token of tokens) {
      tfMap.set(token, (tfMap.get(token) || 0) + 1);
    }

    for (const [token, count] of tfMap.entries()) {
      if (!this.invertedIndex.has(token)) {
        this.invertedIndex.set(token, new Map());
      }
      this.invertedIndex.get(token)!.set(chunk.id, count);
    }
  }

  public linkChunkLibrary(chunkId: string, libraryId: string) {
    let set = this.chunkLibraries.get(chunkId);
    if (!set) {
      set = new Set();
      this.chunkLibraries.set(chunkId, set);
    }
    set.add(libraryId);
  }

  public unlinkChunkLibrary(chunkId: string, libraryId: string) {
    const set = this.chunkLibraries.get(chunkId);
    if (set) {
      set.delete(libraryId);
    }
  }

  public removeLibrary(libraryId: string) {
    const toRemove: string[] = [];
    for (const [chunkId, set] of this.chunkLibraries.entries()) {
      set.delete(libraryId);
      if (set.size === 0) {
        toRemove.push(chunkId);
      }
    }
    for (const chunkId of toRemove) {
      this.removeChunk(chunkId);
    }
  }

  public removeChunk(chunkId: string) {
    if (!this.chunks.has(chunkId)) return;

    const oldLen = this.docLengths.get(chunkId) || 0;
    this.totalLength = Math.max(0, this.totalLength - oldLen);
    this.docLengths.delete(chunkId);
    this.chunks.delete(chunkId);
    this.chunkLibraries.delete(chunkId);

    // Remove from inverted index
    for (const posting of this.invertedIndex.values()) {
      posting.delete(chunkId);
    }
  }

  public clear() {
    this.invertedIndex.clear();
    this.docLengths.clear();
    this.chunks.clear();
    this.chunkLibraries.clear();
    this.totalLength = 0;
  }

  public search(query: string, allowedLibraryIds?: string[], topK: number = 30, documentIds?:string[]): KeywordSearchResult[] {
    // Explicit empty array means user selected 0 libraries -> return 0 results immediately
    if (allowedLibraryIds !== undefined && allowedLibraryIds.length === 0) {
      return [];
    }

    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0 || this.chunks.size === 0) return [];

    const N = this.chunks.size;
    const avgdl = this.totalLength / (N || 1);
    const k1 = 1.5;
    const b = 0.75;

    const scores = new Map<string, number>();
    const allowedLibs = allowedLibraryIds && allowedLibraryIds.length > 0 ? new Set(allowedLibraryIds) : null;

    for (const term of queryTokens) {
      const postings = this.invertedIndex.get(term);
      if (!postings) continue;

      const n_qi = postings.size;
      // BM25 IDF
      const idf = Math.log((N - n_qi + 0.5) / (n_qi + 0.5) + 1.0);

      for (const [chunkId, freq] of postings.entries()) {
        const chunk = this.chunks.get(chunkId);
        if (!chunk) continue;
        if(documentIds?.length&&!documentIds.includes(chunk.documentId))continue;

        if (allowedLibs) {
          const libs = this.chunkLibraries.get(chunkId);
          let matches = false;
          if (libs) {
            for (const l of allowedLibs) {
              if (libs.has(l)) { matches = true; break; }
            }
          }
          if (!matches) continue;
        }

        const docLen = this.docLengths.get(chunkId) || 1;
        const tf = (freq * (k1 + 1)) / (freq + k1 * (1 - b + b * (docLen / avgdl)));
        const termScore = idf * tf;

        scores.set(chunkId, (scores.get(chunkId) || 0) + termScore);
      }
    }

    const results: KeywordSearchResult[] = [];
    for (const [chunkId, score] of scores.entries()) {
      results.push({ chunkId, score });
    }

    // Sort descending by score
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  public getChunk(chunkId: string): ChunkRecord | undefined {
    return this.chunks.get(chunkId);
  }

  public inScope(id:string,libraries?:string[]) {
    return this.chunks.has(id)&&(libraries===undefined||libraries.some(l=>this.chunkLibraries.get(id)?.has(l)));
  }
  public scopedChunks(libraries?:string[]) {
    return [...this.chunks.values()].filter(c=>this.inScope(c.id,libraries));
  }

  public get size(): number {
    return this.chunks.size;
  }
}
