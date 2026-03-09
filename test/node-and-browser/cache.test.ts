import { describe, it, expect } from "vitest";
import {
  createInMemoryCache,
  isCacheStale,
  DEFAULT_CACHE_TTL_MS,
  type CacheEntry,
} from "../../src/runtime/shared/cache.js";

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

  it("clears all entries on destroy", async () => {
    const cache = createInMemoryCache();
    await cache.set("a.eth", SAMPLE_ENTRY);
    await cache.set("b.eth", SAMPLE_ENTRY);
    await cache.destroy();
    expect(await cache.get("a.eth")).toBeUndefined();
    expect(await cache.get("b.eth")).toBeUndefined();
  });
});
