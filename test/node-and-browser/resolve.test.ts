import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("viem", () => ({
  createPublicClient: vi.fn(() => ({
    getEnsText: vi.fn(),
  })),
  http: vi.fn(() => "mock-http-transport"),
  webSocket: vi.fn(() => "mock-ws-transport"),
}));

vi.mock("viem/chains", () => ({
  mainnet: { id: 1, name: "mainnet" },
}));

vi.mock("viem/ens", () => ({
  normalize: (name: string) => name.toLowerCase(),
}));

import { createPublicClient, http, webSocket } from "viem";
import { BsoResolver, _resetRegistries } from "@bitsocial/bso-resolver";

const VALID_PUBLIC_KEY = "12D3KooWN5rLmRJ8fWMwTtkDN7w2RgPPGRM4mtWTnfbjpi1Sh7zR";

const CACHE_DB_NAME = "bso-resolver-cache";

async function cleanupIndexedDB(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(CACHE_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

function getMockGetEnsText(): Mock {
  const client = (createPublicClient as Mock).mock.results.at(-1)?.value;
  return client.getEnsText;
}

describe("BsoResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetRegistries();
    // Reset the mock implementation so each test gets a fresh mock client
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn(),
    }));
  });

  afterEach(async () => {
    _resetRegistries();
    await cleanupIndexedDB();
  });

  it('resolves .bso name with provider="viem"', async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    const result = await resolver.resolve({ name: "example.bso" });

    expect(result).toEqual({ publicKey: VALID_PUBLIC_KEY });
    expect(http).toHaveBeenCalledWith(undefined, { fetchOptions: { signal: expect.any(AbortSignal) } });
    expect(getMockGetEnsText()).toHaveBeenCalledWith({
      name: "example.eth",
      key: "bitsocial",
    });

    await resolver.destroy();
  });

  it("resolves .bso name by normalizing to .eth first", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    const result = await resolver.resolve({ name: "example.bso" });

    expect(result).toEqual({ publicKey: VALID_PUBLIC_KEY });
    expect(getMockGetEnsText()).toHaveBeenCalledWith({
      name: "example.eth",
      key: "bitsocial",
    });

    await resolver.destroy();
  });

  it("returns undefined when TXT record not found", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(null),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    const result = await resolver.resolve({ name: "unknown.bso" });

    expect(result).toBeUndefined();

    await resolver.destroy();
  });

  it("passes custom URL to http() transport", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));

    const resolver = new BsoResolver({ key: "bso-rpc", provider: "https://rpc.example.com" });
    await resolver.resolve({ name: "example.bso" });

    expect(http).toHaveBeenCalledWith("https://rpc.example.com", { fetchOptions: { signal: expect.any(AbortSignal) } });

    await resolver.destroy();
  });

  it("uses webSocket() transport for wss:// provider URLs", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));

    const resolver = new BsoResolver({ key: "bso-ws", provider: "wss://rpc.example.com" });
    await resolver.resolve({ name: "example.bso" });

    expect(webSocket).toHaveBeenCalledWith("wss://rpc.example.com", { reconnect: false });
    expect(http).not.toHaveBeenCalled();

    await resolver.destroy();
  });

  it("uses webSocket() transport for ws:// provider URLs", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));

    const resolver = new BsoResolver({ key: "bso-ws", provider: "ws://rpc.example.com" });
    await resolver.resolve({ name: "example.bso" });

    expect(webSocket).toHaveBeenCalledWith("ws://rpc.example.com", { reconnect: false });
    expect(http).not.toHaveBeenCalled();

    await resolver.destroy();
  });

  it("defaults to .bso when name has no TLD", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    const result = await resolver.resolve({ name: "example" });

    expect(result).toEqual({ publicKey: VALID_PUBLIC_KEY });
    expect(getMockGetEnsText()).toHaveBeenCalledWith({
      name: "example.eth",
      key: "bitsocial",
    });

    await resolver.destroy();
  });

  it("parses TXT record metadata fields", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi
        .fn()
        .mockResolvedValue(
          `${VALID_PUBLIC_KEY};name=memes.bso;network=mainnet;owner=bitsocial`
        ),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    const result = await resolver.resolve({ name: "example.bso" });

    expect(result).toEqual({
      publicKey: VALID_PUBLIC_KEY,
      name: "memes.bso",
      network: "mainnet",
      owner: "bitsocial",
    });

    await resolver.destroy();
  });

  it("uses last value when metadata keys are duplicated", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi
        .fn()
        .mockResolvedValue(`${VALID_PUBLIC_KEY};network=mainnet;network=testnet`),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    const result = await resolver.resolve({ name: "example.bso" });

    expect(result).toEqual({
      publicKey: VALID_PUBLIC_KEY,
      network: "testnet",
    });

    await resolver.destroy();
  });

  it("throws for malformed metadata segments", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(`${VALID_PUBLIC_KEY};bad-segment`),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });

    await expect(
      resolver.resolve({ name: "example.bso" })
    ).rejects.toThrow('Invalid bitsocial TXT record: expected "key=value" segment');

    await resolver.destroy();
  });

  it('throws when metadata includes "publicKey" key', async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi
        .fn()
        .mockResolvedValue(`${VALID_PUBLIC_KEY};publicKey=12D3KooWWrongValue`),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });

    await expect(
      resolver.resolve({ name: "example.bso" })
    ).rejects.toThrow('Invalid bitsocial TXT record: "publicKey" suffix key is not allowed.');

    await resolver.destroy();
  });

  it("throws when first TXT segment is not a valid IPNS public key", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue("not-a-valid-public-key;network=mainnet"),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });

    await expect(
      resolver.resolve({ name: "example.bso" })
    ).rejects.toThrow(
      "Invalid bitsocial TXT record: expected a valid IPNS public key as the first segment."
    );

    await resolver.destroy();
  });

  it("throws for unsupported TLDs", async () => {
    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });

    await expect(
      resolver.resolve({ name: "example.com" })
    ).rejects.toThrow('Unsupported TLD in "example.com". Only .bso and .eth domains are supported.');

    await resolver.destroy();
  });

  it("propagates errors from viem with details", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockRejectedValue(new Error("RPC error")),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });

    try {
      await resolver.resolve({ name: "example.bso" });
      expect.fail("should have thrown");
    } catch (error: any) {
      expect(error.message).toBe("RPC error");
      expect(error.details).toEqual({
        name: "example.bso",
        resolvedName: "example.bso",
        provider: "viem",
        ethName: "example.eth",
        normalized: "example.eth",
        chain: "mainnet",
      });
    }

    await resolver.destroy();
  });
});

describe("BsoResolver abort and destroy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetRegistries();
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn(),
    }));
  });

  afterEach(async () => {
    _resetRegistries();
    await cleanupIndexedDB();
  });

  it("rejects immediately with AbortError for pre-aborted signal", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));

    const controller = new AbortController();
    controller.abort();

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });

    await expect(
      resolver.resolve({
        name: "example.bso",
        abortSignal: controller.signal,
      })
    ).rejects.toMatchObject({ name: "AbortError" });

    await resolver.destroy();
  });

  it("rejects with AbortError when aborted during in-flight resolution", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn(
        () =>
          new Promise(() => {
            // Intentionally unresolved to simulate a long-running request.
          })
      ),
    }));

    const controller = new AbortController();
    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });

    const pending = resolver.resolve({
      name: "example.bso",
      abortSignal: controller.signal,
    });

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    await resolver.destroy();
  });

  it("destroy() rejects all in-flight resolves with AbortError", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn(
        () =>
          new Promise(() => {
            // Intentionally unresolved to simulate a long-running request.
          })
      ),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });

    const pending1 = resolver.resolve({ name: "a.bso" });
    const pending2 = resolver.resolve({ name: "b.bso" });

    await resolver.destroy();

    await expect(pending1).rejects.toMatchObject({ name: "AbortError" });
    await expect(pending2).rejects.toMatchObject({ name: "AbortError" });
  });

  it("aborting one concurrent resolve does not cancel others for same name", async () => {
    let resolveEns!: (value: string) => void;
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn(
        () => new Promise<string>((r) => { resolveEns = r; })
      ),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    const controller = new AbortController();

    // Two concurrent resolves for the same name — one with abort signal
    const p1 = resolver.resolve({ name: "example.bso", abortSignal: controller.signal });
    const p2 = resolver.resolve({ name: "example.bso" });

    // Abort the first caller
    controller.abort();
    await expect(p1).rejects.toMatchObject({ name: "AbortError" });

    // Resolve the underlying request — second caller should get the result
    resolveEns(VALID_PUBLIC_KEY);
    const result = await p2;
    expect(result).toEqual({ publicKey: VALID_PUBLIC_KEY });

    await resolver.destroy();
  });

  it("destroy() closes WebSocket connection", async () => {
    const mockClose = vi.fn();
    const mockRpcClient = { close: mockClose };

    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
      transport: {
        type: "webSocket",
        getRpcClient: vi.fn().mockResolvedValue(mockRpcClient),
      },
    }));

    const resolver = new BsoResolver({ key: "bso-ws", provider: "wss://rpc.example.com" });
    await resolver.resolve({ name: "example.bso" });

    await resolver.destroy();

    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("passes destroy signal to http() transport fetchOptions", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    await resolver.resolve({ name: "example.bso" });

    // Capture the signal passed to http()
    const httpCall = (http as Mock).mock.calls[0];
    const signal = httpCall[1]?.fetchOptions?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);

    await resolver.destroy();

    // After destroy, the signal should be aborted
    expect(signal.aborted).toBe(true);
  });
});

describe("BsoResolver lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetRegistries();
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));
  });

  afterEach(async () => {
    _resetRegistries();
    await cleanupIndexedDB();
    vi.restoreAllMocks();
  });

  it("throws after destroy() is called", async () => {
    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    await resolver.resolve({ name: "example.bso" });
    await resolver.destroy();

    await expect(
      resolver.resolve({ name: "example.bso" })
    ).rejects.toThrow("Cannot resolve after destroy() has been called.");
  });

  it("destroy() is idempotent", async () => {
    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    await resolver.resolve({ name: "example.bso" });
    await resolver.destroy();
    await resolver.destroy(); // should not throw
  });

  it("destroy() is a no-op if resolve() was never called", async () => {
    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    await resolver.destroy(); // should not throw
  });

  it("canResolve works without initialization", () => {
    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    expect(resolver.canResolve({ name: "example.bso" })).toBe(true);
    expect(resolver.canResolve({ name: "example.com" })).toBe(false);
  });

  it("has correct key property", () => {
    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    expect(resolver.key).toBe("bso-viem");
  });

  it("exposes provider and dataPath", () => {
    const resolver = new BsoResolver({
      key: "bso-rpc",
      provider: "https://rpc.example.com",
      dataPath: "/tmp/test",
    });
    expect(resolver.provider).toBe("https://rpc.example.com");
    expect(resolver.dataPath).toBe("/tmp/test");
  });

  it("each resolver creates its own client", async () => {
    const r1 = new BsoResolver({ key: "r1", provider: "viem" });
    const r2 = new BsoResolver({ key: "r2", provider: "viem" });

    await r1.resolve({ name: "a.bso" });
    await r2.resolve({ name: "b.bso" });

    expect(createPublicClient).toHaveBeenCalledTimes(2);

    await r1.destroy();
    await r2.destroy();
  });

  it("returns cached result without hitting ENS", async () => {
    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });

    // First call populates cache
    await resolver.resolve({ name: "cached.bso" });

    const mockGetEnsText = getMockGetEnsText();
    mockGetEnsText.mockClear();

    // Second call should use cache (entry was just written, so it's fresh)
    await resolver.resolve({ name: "cached.bso" });
    expect(mockGetEnsText).not.toHaveBeenCalled();

    await resolver.destroy();
  });
});

const UPDATED_PUBLIC_KEY = "12D3KooWGC4xFPBDmMENweb3rPBYDMPSMHpJBGZJGCPFp7TCZGTL";

// Default cache TTL is 1 hour (3_600_000 ms)
const DEFAULT_CACHE_TTL_MS = 3_600_000;

describe("BsoResolver stale-while-revalidate", () => {
  let baseTime: number;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetRegistries();
    baseTime = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(baseTime);
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(UPDATED_PUBLIC_KEY),
    }));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    _resetRegistries();
    await cleanupIndexedDB();
  });

  it("returns stale cached value immediately and refreshes in background", async () => {
    // First call populates cache
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    await resolver.resolve({ name: "stale.bso" });

    // Now mock returns updated key for background refresh
    const mockGetEnsText = getMockGetEnsText();
    mockGetEnsText.mockReset().mockResolvedValue(UPDATED_PUBLIC_KEY);

    // Advance past TTL — cache entry is now stale
    vi.mocked(Date.now).mockReturnValue(baseTime + DEFAULT_CACHE_TTL_MS + 1);
    const result = await resolver.resolve({ name: "stale.bso" });

    // Should return the stale cached value immediately
    expect(result).toEqual({ publicKey: VALID_PUBLIC_KEY });

    // Background refresh should have been triggered
    expect(mockGetEnsText).toHaveBeenCalledTimes(1);

    // Wait for background refresh to complete
    await new Promise((r) => queueMicrotask(r));
    await new Promise((r) => queueMicrotask(r));

    // Now should get updated value (cache was refreshed in background)
    const freshResult = await resolver.resolve({ name: "stale.bso" });
    expect(freshResult).toEqual({ publicKey: UPDATED_PUBLIC_KEY });

    await resolver.destroy();
  });

  it("deduplicates concurrent resolves for the same name", async () => {
    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });

    // Two concurrent resolves for the same name with no cache
    const [r1, r2] = await Promise.all([
      resolver.resolve({ name: "dedup.bso" }),
      resolver.resolve({ name: "dedup.bso" }),
    ]);

    expect(r1).toEqual({ publicKey: UPDATED_PUBLIC_KEY });
    expect(r2).toEqual({ publicKey: UPDATED_PUBLIC_KEY });

    // Should only have called ENS once due to deduplication
    const mockGetEnsText = getMockGetEnsText();
    expect(mockGetEnsText).toHaveBeenCalledTimes(1);

    await resolver.destroy();
  });

  it("returns stale value when background refresh fails", async () => {
    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });

    // First call populates cache
    await resolver.resolve({ name: "fail.bso" });

    // Now make ENS fail for background refresh
    const mockGetEnsText = getMockGetEnsText();
    mockGetEnsText.mockReset().mockRejectedValue(new Error("RPC timeout"));

    // Advance past TTL — triggers background refresh that will fail
    vi.mocked(Date.now).mockReturnValue(baseTime + DEFAULT_CACHE_TTL_MS + 1);
    const result = await resolver.resolve({ name: "fail.bso" });

    // Should still return the stale cached value
    expect(result).toEqual({ publicKey: UPDATED_PUBLIC_KEY });

    // Wait for background refresh to settle
    await new Promise((r) => queueMicrotask(r));
    await new Promise((r) => queueMicrotask(r));

    // Cache should still have the original value (not corrupted by failed refresh)
    const afterFailure = await resolver.resolve({ name: "fail.bso" });
    expect(afterFailure).toEqual({ publicKey: UPDATED_PUBLIC_KEY });

    await resolver.destroy();
  });
});
