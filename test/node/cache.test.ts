import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import type { CacheEntry } from "../../src/runtime/shared/cache.js";
import {
  createSqliteCache,
  createCache,
} from "../../src/runtime/node/cache.js";
import { createIndexedDBCache } from "../../src/runtime/browser/cache.js";

const SAMPLE_ENTRY: CacheEntry = {
  value: { publicKey: "12D3KooWN5rLmRJ8fWMwTtkDN7w2RgPPGRM4mtWTnfbjpi1Sh7zR" },
  timestampMs: Date.now(),
  provider: "https://rpc.example.com",
};

const SAMPLE_ENTRY_WITH_METADATA: CacheEntry = {
  value: {
    publicKey: "12D3KooWN5rLmRJ8fWMwTtkDN7w2RgPPGRM4mtWTnfbjpi1Sh7zR",
    name: "memes.bso",
    network: "mainnet",
  },
  timestampMs: Date.now(),
  provider: "viem",
};

// --- SQLite cache ---

describe("createSqliteCache", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bso-cache-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns undefined for missing keys", async () => {
    const cache = await createSqliteCache(tmpDir);
    expect(await cache.get("nonexistent")).toBeUndefined();
  });

  it("stores and retrieves entries", async () => {
    const cache = await createSqliteCache(tmpDir);
    await cache.set("example.bso", SAMPLE_ENTRY);
    expect(await cache.get("example.bso")).toEqual(SAMPLE_ENTRY);
  });

  it("overwrites existing entries", async () => {
    const cache = await createSqliteCache(tmpDir);
    await cache.set("example.bso", SAMPLE_ENTRY);
    await cache.set("example.bso", SAMPLE_ENTRY_WITH_METADATA);
    expect(await cache.get("example.bso")).toEqual(SAMPLE_ENTRY_WITH_METADATA);
  });

  it("deletes entries", async () => {
    const cache = await createSqliteCache(tmpDir);
    await cache.set("example.bso", SAMPLE_ENTRY);
    await cache.delete("example.bso");
    expect(await cache.get("example.bso")).toBeUndefined();
  });

  it("serializes and deserializes metadata fields", async () => {
    const cache = await createSqliteCache(tmpDir);
    await cache.set("meta.bso", SAMPLE_ENTRY_WITH_METADATA);
    const result = await cache.get("meta.bso");
    expect(result).toEqual(SAMPLE_ENTRY_WITH_METADATA);
    expect(result?.value.name).toBe("memes.bso");
    expect(result?.value.network).toBe("mainnet");
  });

  it("closes the database on destroy", async () => {
    const cache = await createSqliteCache(tmpDir);
    await cache.set("example.bso", SAMPLE_ENTRY);
    await cache.destroy();
    await expect(cache.get("example.bso")).rejects.toThrow();
  });

  it("creates the .bso-resolver directory inside dataPath", async () => {
    const { existsSync } = await import("node:fs");
    await createSqliteCache(tmpDir);
    expect(existsSync(join(tmpDir, ".bso-resolver", "bso-cache.sqlite"))).toBe(true);
  });

  it("drops the legacy table when opening a cache with an older schema version", async () => {
    // Simulate a pre-v2 database that lacks the `provider` column.
    const dir = join(tmpDir, ".bso-resolver");
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "bso-cache.sqlite");
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE bso_cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL
      )
    `);
    legacy.prepare("INSERT INTO bso_cache (key, value, timestamp_ms) VALUES (?, ?, ?)").run(
      "legacy.bso",
      JSON.stringify({ publicKey: "legacy" }),
      Date.now()
    );
    // user_version is 0 by default — different from CACHE_SCHEMA_VERSION = 2
    legacy.close();

    const cache = await createSqliteCache(tmpDir);

    // Legacy row should be gone after the drop-and-recreate.
    expect(await cache.get("legacy.bso")).toBeUndefined();

    // New entries with provider column round-trip correctly.
    await cache.set("fresh.bso", SAMPLE_ENTRY);
    expect(await cache.get("fresh.bso")).toEqual(SAMPLE_ENTRY);

    await cache.destroy();
  });
});

// --- IndexedDB cache ---

describe("createIndexedDBCache", () => {
  beforeEach(() => {
    indexedDB = new IDBFactory();
  });

  it("returns undefined for missing keys", async () => {
    const cache = await createIndexedDBCache();
    expect(await cache.get("nonexistent")).toBeUndefined();
  });

  it("stores and retrieves entries", async () => {
    const cache = await createIndexedDBCache();
    await cache.set("example.bso", SAMPLE_ENTRY);
    expect(await cache.get("example.bso")).toEqual(SAMPLE_ENTRY);
  });

  it("overwrites existing entries", async () => {
    const cache = await createIndexedDBCache();
    await cache.set("example.bso", SAMPLE_ENTRY);
    await cache.set("example.bso", SAMPLE_ENTRY_WITH_METADATA);
    expect(await cache.get("example.bso")).toEqual(SAMPLE_ENTRY_WITH_METADATA);
  });

  it("deletes entries", async () => {
    const cache = await createIndexedDBCache();
    await cache.set("example.bso", SAMPLE_ENTRY);
    await cache.delete("example.bso");
    expect(await cache.get("example.bso")).toBeUndefined();
  });

  it("closes the database on destroy", async () => {
    const cache = await createIndexedDBCache();
    await cache.set("example.bso", SAMPLE_ENTRY);
    await cache.destroy();
    await expect(cache.get("example.bso")).rejects.toThrow();
  });

  it("wipes existing records when upgrading from version 1", async () => {
    // Manually open the DB at the pre-v2 version and seed a legacy record.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("bso-resolver-cache", 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("cache", { keyPath: "key" });
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("cache", "readwrite");
        tx.objectStore("cache").put({
          key: "legacy.bso",
          value: { publicKey: "legacy" },
          timestampMs: Date.now(),
          // No `provider` field — pre-v2 shape
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });

    // Reopen via createIndexedDBCache — should bump to v2 and wipe the store.
    const cache = await createIndexedDBCache();
    expect(await cache.get("legacy.bso")).toBeUndefined();

    // New entries round-trip with provider.
    await cache.set("fresh.bso", SAMPLE_ENTRY);
    expect(await cache.get("fresh.bso")).toEqual(SAMPLE_ENTRY);

    await cache.destroy();
  });
});

// --- Factory ---

describe("createCache", () => {
  it("returns SQLite cache when dataPath is provided", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "bso-cache-factory-"));
    try {
      const cache = await createCache({ dataPath: tmpDir });
      await cache.set("test.bso", SAMPLE_ENTRY);
      expect(await cache.get("test.bso")).toEqual(SAMPLE_ENTRY);

      // Verify it actually created the sqlite file
      const { existsSync } = await import("node:fs");
      expect(existsSync(join(tmpDir, ".bso-resolver", "bso-cache.sqlite"))).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns IndexedDB cache when indexedDB is available and no dataPath", async () => {
    const cache = await createCache();
    await cache.set("test.bso", SAMPLE_ENTRY);
    expect(await cache.get("test.bso")).toEqual(SAMPLE_ENTRY);
  });

  it("returns in-memory cache when no dataPath and no indexedDB", async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error -- temporarily remove indexedDB to test fallback
    delete globalThis.indexedDB;
    try {
      const cache = await createCache();
      await cache.set("test.bso", SAMPLE_ENTRY);
      expect(await cache.get("test.bso")).toEqual(SAMPLE_ENTRY);
    } finally {
      globalThis.indexedDB = original;
    }
  });
});
