export interface CacheEntry {
  value: Record<string, string>;
  timestampMs: number;
}

export interface ResolverCache {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
  destroy(): Promise<void>;
}

export interface CreateCacheArgs {
  dataPath?: string;
}

interface CreateRuntimeCacheArgs extends CreateCacheArgs {
  createPersistentCache?: (dataPath: string) => Promise<ResolverCache>;
  createIndexedDBCache?: () => Promise<ResolverCache>;
  unsupportedDataPathError?: string;
}

export const DEFAULT_CACHE_TTL_MS = 3600 * 1000; // 1 hour

export function isCacheStale(entry: CacheEntry, ttlMs: number = DEFAULT_CACHE_TTL_MS): boolean {
  return Date.now() - entry.timestampMs > ttlMs;
}

export function createInMemoryCache(): ResolverCache {
  const store = new Map<string, CacheEntry>();
  return {
    async get(key) { return store.get(key); },
    async set(key, entry) { store.set(key, entry); },
    async delete(key) { store.delete(key); },
    async destroy() { store.clear(); },
  };
}

export async function createRuntimeCache({
  dataPath,
  createPersistentCache,
  createIndexedDBCache,
  unsupportedDataPathError,
}: CreateRuntimeCacheArgs = {}): Promise<ResolverCache> {
  if (dataPath) {
    if (!createPersistentCache) {
      throw new Error(unsupportedDataPathError ?? "Persistent cache is not available in this runtime.");
    }
    return createPersistentCache(dataPath);
  }

  if (typeof indexedDB !== "undefined" && createIndexedDBCache) {
    return createIndexedDBCache();
  }

  return createInMemoryCache();
}
