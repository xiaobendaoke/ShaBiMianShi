import crypto from 'crypto';
import type { ProviderProfile } from '../types';

// Version this whenever the text sent to the embedding model changes.
export const EMBEDDING_TEXT_VERSION = 'section-text-v1';
export function embeddingSpaceKey(profile: ProviderProfile): string {
  let endpoint = profile.baseUrl.trim().replace(/\/+$/, '');
  try {
    const url = new URL(endpoint);
    if (url.pathname === '/') url.pathname = '/v1';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    endpoint = url.toString().replace(/\/+$/, '');
  } catch { /* Invalid saved endpoints cannot match another provider's vectors. */ }
  return crypto.createHash('sha256').update(JSON.stringify({
    providerId: profile.id,
    protocol: profile.protocol,
    endpoint,
    model: profile.modelEmbed.trim(),
    textVersion: EMBEDDING_TEXT_VERSION
  })).digest('hex');
}
