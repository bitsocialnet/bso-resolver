import {
  DEFAULT_CACHE_TTL_MS,
  createInMemoryCache,
  createRuntimeCache,
  isCacheStale,
  type CacheEntry,
  type CreateCacheArgs,
  type ResolverCache,
} from "../shared/cache.js";
import { createIndexedDBCache } from "../browser/indexeddb-cache.js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

export {
  DEFAULT_CACHE_TTL_MS,
  createIndexedDBCache,
  createInMemoryCache,
  isCacheStale,
  type CacheEntry,
  type CreateCacheArgs,
  type ResolverCache,
};

export function createSqliteCache(dataPath: string): Promise<ResolverCache> {
  const dir = join(dataPath, ".bso-resolver");
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, "bso-cache.sqlite");

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS bso_cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL
    )
  `);

  const getStmt = db.prepare("SELECT value, timestamp_ms FROM bso_cache WHERE key = ?");
  const setStmt = db.prepare(
    "INSERT OR REPLACE INTO bso_cache (key, value, timestamp_ms) VALUES (?, ?, ?)"
  );
  const deleteStmt = db.prepare("DELETE FROM bso_cache WHERE key = ?");

  return Promise.resolve({
    async get(key: string): Promise<CacheEntry | undefined> {
      const row = getStmt.get(key) as { value: string; timestamp_ms: number } | undefined;
      if (!row) return undefined;
      return {
        value: JSON.parse(row.value) as Record<string, string>,
        timestampMs: row.timestamp_ms,
      };
    },

    async set(key: string, entry: CacheEntry): Promise<void> {
      setStmt.run(key, JSON.stringify(entry.value), entry.timestampMs);
    },

    async delete(key: string): Promise<void> {
      deleteStmt.run(key);
    },

    async destroy(): Promise<void> {
      db.close();
    },
  });
}

export async function createCache({ dataPath }: CreateCacheArgs = {}): Promise<ResolverCache> {
  return createRuntimeCache({
    dataPath,
    createIndexedDBCache,
    createPersistentCache: createSqliteCache,
  });
}
