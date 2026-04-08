import type { CacheEntry, ResolverCache } from "../shared/cache.js";

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
    request.onblocked = () =>
      reject(new DOMException('IndexedDB "bso-resolver-cache" open blocked by another connection.', "AbortError"));
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
      let result: T;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? new DOMException("Transaction aborted", "AbortError"));
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

    async destroy(): Promise<void> {
      db.close();
    },
  };
}
