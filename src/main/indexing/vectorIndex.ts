export interface VectorSearchResult {
  chunkId: string;
  score: number;
}

export interface VectorProfile {
  profileId: string;
  model: string;
  spaceKey?: string;
  dimensions: number;
  createdAt: number;
}

export class VectorIndex {
  private profile: VectorProfile | null = null;
  // chunkId -> Float32Array
  private vectors: Map<string, Float32Array> = new Map();
  // chunkId -> Set of libraryIds for fast scope filtering
  private chunkLibraries: Map<string, Set<string>> = new Map();

  constructor() {}

  public setProfile(profile: VectorProfile) {
    if (this.profile && (this.profile.dimensions !== profile.dimensions || this.profile.model !== profile.model || this.profile.profileId !== profile.profileId || this.profile.spaceKey !== profile.spaceKey)) {
      // Profile changed: clear outdated vectors to avoid mixing spaces
      this.clear();
    }
    this.profile = profile;
  }

  public getProfile(): VectorProfile | null {
    return this.profile;
  }

  public addVector(chunkId: string, libraryIds: string[] | string, rawVector: number[] | Float32Array) {
    if (!this.profile) {
      this.profile = {
        profileId: 'default',
        model: 'text-embedding-3-small',
        dimensions: rawVector.length,
        createdAt: Date.now()
      };
    }

    if (!rawVector || !rawVector.length || Array.from(rawVector).some(v => !Number.isFinite(v))) {
      throw new Error('嵌入向量缺失或包含非有限数值');
    }
    if (rawVector.length !== this.profile.dimensions) {
      throw new Error(`向量维度不匹配: 期望 ${this.profile.dimensions}, 实际 ${rawVector.length}`);
    }

    // Normalize vector to unit length so cosine similarity = dot product
    const vec = new Float32Array(rawVector.length);
    let normSq = 0;
    for (let i = 0; i < rawVector.length; i++) {
      vec[i] = rawVector[i];
      normSq += vec[i] * vec[i];
    }
    const norm = Math.sqrt(normSq);
    if (norm > 1e-9) {
      for (let i = 0; i < vec.length; i++) {
        vec[i] /= norm;
      }
    }

    this.vectors.set(chunkId, vec);

    const libSet = new Set<string>();
    if (Array.isArray(libraryIds)) {
      for (const id of libraryIds) if (id) libSet.add(id);
    } else if (libraryIds) {
      libSet.add(libraryIds);
    }
    this.chunkLibraries.set(chunkId, libSet);
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
      this.removeVector(chunkId);
    }
  }

  public removeVector(chunkId: string) {
    this.vectors.delete(chunkId);
    this.chunkLibraries.delete(chunkId);
  }

  public clear() {
    this.vectors.clear();
    this.chunkLibraries.clear();
    this.profile = null;
  }

  public search(queryVector: number[] | Float32Array, allowedLibraryIds?: string[], topK: number = 30): VectorSearchResult[] {
    // Explicit empty array means user selected 0 libraries -> return 0 results immediately
    if (allowedLibraryIds !== undefined && allowedLibraryIds.length === 0) {
      return [];
    }

    if (!this.profile || this.vectors.size === 0) return [];

    if (queryVector.length !== this.profile.dimensions) {
      throw new Error(`查询向量维度不匹配: 期望 ${this.profile.dimensions}, 实际 ${queryVector.length}`);
    }

    // Normalize query vector
    const qVec = new Float32Array(queryVector.length);
    let normSq = 0;
    for (let i = 0; i < queryVector.length; i++) {
      qVec[i] = queryVector[i];
      normSq += qVec[i] * qVec[i];
    }
    const norm = Math.sqrt(normSq);
    if (norm > 1e-9) {
      for (let i = 0; i < qVec.length; i++) {
        qVec[i] /= norm;
      }
    }

    const d = this.profile.dimensions;
    const allowedLibs = allowedLibraryIds && allowedLibraryIds.length > 0 ? new Set(allowedLibraryIds) : null;
    const topResults: VectorSearchResult[] = [];
    let minTopScore = -Infinity;

    for (const [chunkId, v] of this.vectors.entries()) {
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

      // Fast dot product
      let dot = 0;
      for (let i = 0; i < d; i++) {
        dot += qVec[i] * v[i];
      }

      if (topResults.length < topK) {
        topResults.push({ chunkId, score: dot });
        if (topResults.length === topK) {
          topResults.sort((a, b) => b.score - a.score);
          minTopScore = topResults[topK - 1].score;
        }
      } else if (dot > minTopScore) {
        let pos = topResults.length - 1;
        while (pos > 0 && topResults[pos - 1].score < dot) {
          topResults[pos] = topResults[pos - 1];
          pos--;
        }
        topResults[pos] = { chunkId, score: dot };
        minTopScore = topResults[topK - 1].score;
      }
    }

    if (topResults.length < topK) {
      topResults.sort((a, b) => b.score - a.score);
    }
    return topResults;
  }

  public get size(): number {
    return this.vectors.size;
  }
}
