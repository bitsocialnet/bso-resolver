import {
  DEFAULT_CACHE_TTL_MS,
  createInMemoryCache,
  createRuntimeCache,
  isCacheStale,
  type CacheEntry,
  type CreateCacheArgs,
  type ResolverCache,
} from "../shared/cache.js";
import { createIndexedDBCache } from "./indexeddb-cache.js";

export {
  DEFAULT_CACHE_TTL_MS,
  createIndexedDBCache,
  createInMemoryCache,
  isCacheStale,
  type CacheEntry,
  type CreateCacheArgs,
  type ResolverCache,
};

export async function createSqliteCache(): Promise<ResolverCache> {
  throw new Error("SQLite cache is not available in browser builds.");
}

export async function createCache({ dataPath }: CreateCacheArgs = {}): Promise<ResolverCache> {
  return createRuntimeCache({
    dataPath,
    createIndexedDBCache,
    unsupportedDataPathError: "SQLite cache is not available in browser builds.",
  });
}
