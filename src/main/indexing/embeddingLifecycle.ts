import type { AppDatabase } from '../db/database';
import type { ProviderProfile } from '../types';
import { VectorIndex } from './vectorIndex';
import { embeddingSpaceKey } from './embeddingSpace';

export function indexMatchesProvider(index: VectorIndex, provider: ProviderProfile | null): boolean {
  return !!provider && index.getProfile()?.spaceKey === embeddingSpaceKey(provider);
}

// Never infer the origin of legacy vectors or fall back to a different model.
export function restoreEmbeddingIndex(db: AppDatabase, index: VectorIndex, provider: ProviderProfile | null): void {
  index.clear();
  if (!provider) return;
  const spaceKey = embeddingSpaceKey(provider);
  const saved = db.getEmbeddingProfile(spaceKey);
  const rows = db.getAllEmbeddings({ spaceKey, model: provider.modelEmbed, dimensions: saved?.dimensions });
  if (!rows.length) return;
  const dimensions = saved?.dimensions ?? rows[0].dimensions;
  index.setProfile({ profileId: provider.id, model: provider.modelEmbed, spaceKey, dimensions, createdAt: Date.now() });
  const links = new Map<string, string[]>();
  for (const link of db.getDocumentLibraryLinks()) {
    links.set(link.documentId, [...(links.get(link.documentId) ?? []), link.libraryId]);
  }
  for (const row of rows) {
    if (row.dimensions !== dimensions) continue;
    const chunk = db.getChunk(row.chunkId);
    const libraries = chunk && links.get(chunk.documentId);
    if (libraries?.length) index.addVector(row.chunkId, libraries, row.vector);
  }
}

export function ensureEmbeddingIndex(db: AppDatabase, index: VectorIndex, provider: ProviderProfile | null): void {
  if (!indexMatchesProvider(index, provider)) restoreEmbeddingIndex(db, index, provider);
}
