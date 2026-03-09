import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCache,
  createIndexedDBCache,
  type CacheEntry,
} from "../src/runtime/browser/cache.js";
import { BsoResolver } from "../src/browser.js";

const CACHE_DB_NAME = "bso-resolver-cache";

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

async function deleteCacheDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(CACHE_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`Failed to delete IndexedDB database "${CACHE_DB_NAME}".`));
  });
}

describe("browser IndexedDB cache", () => {
  beforeEach(async () => {
    await deleteCacheDatabase();
  });

  afterEach(async () => {
    await deleteCacheDatabase();
  });

  it("stores and retrieves entries with createIndexedDBCache", async () => {
    const cache = await createIndexedDBCache();

    await cache.set("example.eth", SAMPLE_ENTRY);

    expect(await cache.get("example.eth")).toEqual(SAMPLE_ENTRY);

    await cache.destroy();
  });

  it("overwrites and deletes entries with createIndexedDBCache", async () => {
    const cache = await createIndexedDBCache();

    await cache.set("example.eth", SAMPLE_ENTRY);
    await cache.set("example.eth", SAMPLE_ENTRY_WITH_METADATA);
    expect(await cache.get("example.eth")).toEqual(SAMPLE_ENTRY_WITH_METADATA);

    await cache.delete("example.eth");
    expect(await cache.get("example.eth")).toBeUndefined();

    await cache.destroy();
  });

  it("uses IndexedDB when createCache is called without dataPath", async () => {
    const cache = await createCache();

    await cache.set("factory.eth", SAMPLE_ENTRY);
    expect(await cache.get("factory.eth")).toEqual(SAMPLE_ENTRY);

    await cache.destroy();
  });

  it("throws when dataPath is requested in the browser cache entry", async () => {
    await expect(createCache({ dataPath: "/tmp/test-cache" })).rejects.toThrow(
      "SQLite cache is not available in browser builds."
    );
  });

  it("allows the database to be recreated after destroy()", async () => {
    const cache = await createIndexedDBCache();

    await cache.set("example.eth", SAMPLE_ENTRY);
    await cache.destroy();
    await deleteCacheDatabase();

    const recreated = await createIndexedDBCache();
    expect(await recreated.get("example.eth")).toBeUndefined();

    await recreated.destroy();
  });

  it("loads the browser resolver entry without Node-only imports", () => {
    const resolver = new BsoResolver({ key: "bso-browser", provider: "viem" });
    expect(resolver.canResolve({ name: "example.bso" })).toBe(true);
    expect(resolver.canResolve({ name: "example.com" })).toBe(false);
  });
});
