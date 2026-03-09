import type BetterSqlite3 from "better-sqlite3";

// --- Types ---

export interface CacheEntry {
  value: Record<string, string>;
  timestampMs: number;
}

export interface ResolverCache {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
}

// --- Cache helpers ---

export const DEFAULT_CACHE_TTL_MS = 3600 * 1000; // 1 hour

export function isCacheStale(entry: CacheEntry, ttlMs: number = DEFAULT_CACHE_TTL_MS): boolean {
  return Date.now() - entry.timestampMs > ttlMs;
}

// --- In-memory cache ---

export function createInMemoryCache(): ResolverCache {
  const store = new Map<string, CacheEntry>();
  return {
    async get(key) { return store.get(key); },
    async set(key, entry) { store.set(key, entry); },
    async delete(key) { store.delete(key); },
  };
}

// --- SQLite cache (Node-only, loaded via dynamic import) ---

export async function createSqliteCache(dataPath: string): Promise<ResolverCache> {
  const { mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");

  const dir = join(dataPath, ".bso-resolver");
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, "bso-cache.sqlite");

  // Use variable indirection to defeat static bundler analysis
  const moduleName = "better-sqlite3";
  const { default: Database } = await import(/* @vite-ignore */ moduleName) as { default: typeof BetterSqlite3 };

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

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

  return {
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
  };
}

// --- IndexedDB cache (browser-only) ---

function openIndexedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("bso-resolver-cache", 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("cache")) {
        db.createObjectStore("cache", { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function createIndexedDBCache(): Promise<ResolverCache> {
  const db = await openIndexedDB();

  function withTransaction<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("cache", mode);
      const store = tx.objectStore("cache");
      const request = fn(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return {
    async get(key: string): Promise<CacheEntry | undefined> {
      const row = await withTransaction("readonly", (store) => store.get(key));
      if (!row) return undefined;
      return {
        value: row.value as Record<string, string>,
        timestampMs: row.timestampMs as number,
      };
    },

    async set(key: string, entry: CacheEntry): Promise<void> {
      await withTransaction("readwrite", (store) =>
        store.put({ key, value: entry.value, timestampMs: entry.timestampMs })
      );
    },

    async delete(key: string): Promise<void> {
      await withTransaction("readwrite", (store) => store.delete(key));
    },
  };
}

// --- Factory ---

export async function createCache({ dataPath }: { dataPath?: string } = {}): Promise<ResolverCache> {
  if (dataPath) {
    return createSqliteCache(dataPath);
  }

  if (typeof indexedDB !== "undefined") {
    return createIndexedDBCache();
  }

  return createInMemoryCache();
}
