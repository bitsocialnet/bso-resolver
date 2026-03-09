import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createInMemoryCache,
  createSqliteCache,
  createIndexedDBCache,
  createCache,
  isCacheStale,
  DEFAULT_CACHE_TTL_MS,
  type CacheEntry,
} from "../src/cache.js";

const SAMPLE_ENTRY: CacheEntry = {
  value: { publicKey: "12D3KooWN5rLmRJ8fWMwTtkDN7w2RgPPGRM4mtWTnfbjpi1Sh7zR" },
  timestampMs: Date.now(),
};

const SAMPLE_ENTRY_WITH_METADATA: CacheEntry = {
  value: {
    publicKey: "12D3KooWN5rLmRJ8fWMwTtkDN7w2RgPPGRM4mtWTnfbjpi1Sh7zR",
    name: "memes.bso",
    network: "mainnet",
  },
  timestampMs: Date.now(),
};

// --- isCacheStale ---

describe("isCacheStale", () => {
  it("returns false for a fresh entry", () => {
    const entry: CacheEntry = { value: { publicKey: "key" }, timestampMs: Date.now() };
    expect(isCacheStale(entry)).toBe(false);
  });

  it("returns true for an expired entry", () => {
    const entry: CacheEntry = {
      value: { publicKey: "key" },
      timestampMs: Date.now() - DEFAULT_CACHE_TTL_MS - 1,
    };
    expect(isCacheStale(entry)).toBe(true);
  });

  it("accepts a custom TTL", () => {
    const entry: CacheEntry = { value: { publicKey: "key" }, timestampMs: Date.now() - 500 };
    expect(isCacheStale(entry, 1000)).toBe(false);
    expect(isCacheStale(entry, 100)).toBe(true);
  });
});

// --- In-memory cache ---

describe("createInMemoryCache", () => {
  it("returns undefined for missing keys", async () => {
    const cache = createInMemoryCache();
    expect(await cache.get("nonexistent")).toBeUndefined();
  });

  it("stores and retrieves entries", async () => {
    const cache = createInMemoryCache();
    await cache.set("example.eth", SAMPLE_ENTRY);
    expect(await cache.get("example.eth")).toEqual(SAMPLE_ENTRY);
  });

  it("overwrites existing entries", async () => {
    const cache = createInMemoryCache();
    await cache.set("example.eth", SAMPLE_ENTRY);
    await cache.set("example.eth", SAMPLE_ENTRY_WITH_METADATA);
    expect(await cache.get("example.eth")).toEqual(SAMPLE_ENTRY_WITH_METADATA);
  });

  it("deletes entries", async () => {
    const cache = createInMemoryCache();
    await cache.set("example.eth", SAMPLE_ENTRY);
    await cache.delete("example.eth");
    expect(await cache.get("example.eth")).toBeUndefined();
  });
});

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
    await cache.set("example.eth", SAMPLE_ENTRY);
    expect(await cache.get("example.eth")).toEqual(SAMPLE_ENTRY);
  });

  it("overwrites existing entries", async () => {
    const cache = await createSqliteCache(tmpDir);
    await cache.set("example.eth", SAMPLE_ENTRY);
    await cache.set("example.eth", SAMPLE_ENTRY_WITH_METADATA);
    expect(await cache.get("example.eth")).toEqual(SAMPLE_ENTRY_WITH_METADATA);
  });

  it("deletes entries", async () => {
    const cache = await createSqliteCache(tmpDir);
    await cache.set("example.eth", SAMPLE_ENTRY);
    await cache.delete("example.eth");
    expect(await cache.get("example.eth")).toBeUndefined();
  });

  it("serializes and deserializes metadata fields", async () => {
    const cache = await createSqliteCache(tmpDir);
    await cache.set("meta.eth", SAMPLE_ENTRY_WITH_METADATA);
    const result = await cache.get("meta.eth");
    expect(result).toEqual(SAMPLE_ENTRY_WITH_METADATA);
    expect(result?.value.name).toBe("memes.bso");
    expect(result?.value.network).toBe("mainnet");
  });

  it("creates the .bso-resolver directory inside dataPath", async () => {
    const { existsSync } = await import("node:fs");
    await createSqliteCache(tmpDir);
    expect(existsSync(join(tmpDir, ".bso-resolver", "bso-cache.sqlite"))).toBe(true);
  });
});

// --- IndexedDB cache ---

describe("createIndexedDBCache", () => {
  beforeEach(() => {
    // Reset IndexedDB between tests
    indexedDB = new IDBFactory();
  });

  it("returns undefined for missing keys", async () => {
    const cache = await createIndexedDBCache();
    expect(await cache.get("nonexistent")).toBeUndefined();
  });

  it("stores and retrieves entries", async () => {
    const cache = await createIndexedDBCache();
    await cache.set("example.eth", SAMPLE_ENTRY);
    expect(await cache.get("example.eth")).toEqual(SAMPLE_ENTRY);
  });

  it("overwrites existing entries", async () => {
    const cache = await createIndexedDBCache();
    await cache.set("example.eth", SAMPLE_ENTRY);
    await cache.set("example.eth", SAMPLE_ENTRY_WITH_METADATA);
    expect(await cache.get("example.eth")).toEqual(SAMPLE_ENTRY_WITH_METADATA);
  });

  it("deletes entries", async () => {
    const cache = await createIndexedDBCache();
    await cache.set("example.eth", SAMPLE_ENTRY);
    await cache.delete("example.eth");
    expect(await cache.get("example.eth")).toBeUndefined();
  });
});

// --- Factory ---

describe("createCache", () => {
  it("returns SQLite cache when dataPath is provided", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "bso-cache-factory-"));
    try {
      const cache = await createCache({ dataPath: tmpDir });
      await cache.set("test.eth", SAMPLE_ENTRY);
      expect(await cache.get("test.eth")).toEqual(SAMPLE_ENTRY);

      // Verify it actually created the sqlite file
      const { existsSync } = await import("node:fs");
      expect(existsSync(join(tmpDir, ".bso-resolver", "bso-cache.sqlite"))).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns IndexedDB cache when indexedDB is available and no dataPath", async () => {
    const cache = await createCache();
    await cache.set("test.eth", SAMPLE_ENTRY);
    expect(await cache.get("test.eth")).toEqual(SAMPLE_ENTRY);
  });

  it("returns in-memory cache when no dataPath and no indexedDB", async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error -- temporarily remove indexedDB to test fallback
    delete globalThis.indexedDB;
    try {
      const cache = await createCache();
      await cache.set("test.eth", SAMPLE_ENTRY);
      expect(await cache.get("test.eth")).toEqual(SAMPLE_ENTRY);
    } finally {
      globalThis.indexedDB = original;
    }
  });
});
