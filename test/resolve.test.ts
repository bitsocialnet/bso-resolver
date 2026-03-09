import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("viem", () => ({
  createPublicClient: vi.fn(() => ({
    getEnsText: vi.fn(),
  })),
  http: vi.fn(() => "mock-transport"),
}));

vi.mock("viem/chains", () => ({
  mainnet: { id: 1, name: "mainnet" },
}));

vi.mock("viem/ens", () => ({
  normalize: (name: string) => name.toLowerCase(),
}));

vi.mock("../src/cache.js", () => {
  function makeCache() {
    const store = new Map();
    return {
      get: vi.fn((key: string) => Promise.resolve(store.get(key))),
      set: vi.fn((key: string, entry: unknown) => {
        store.set(key, entry);
        return Promise.resolve();
      }),
      delete: vi.fn((key: string) => {
        store.delete(key);
        return Promise.resolve();
      }),
      destroy: vi.fn(() => {
        store.clear();
        return Promise.resolve();
      }),
    };
  }

  return {
    createCache: vi.fn(() => Promise.resolve(makeCache())),
    isCacheStale: vi.fn(() => true),
  };
});

import { createPublicClient, http } from "viem";
import { BsoResolver, _resetRegistries } from "../src/index.js";
import { isCacheStale } from "../src/cache.js";

const VALID_PUBLIC_KEY = "12D3KooWN5rLmRJ8fWMwTtkDN7w2RgPPGRM4mtWTnfbjpi1Sh7zR";

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
  });

  it('resolves .eth name with provider="viem"', async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    const result = await resolver.resolve({ name: "example.eth" });

    expect(result).toEqual({ publicKey: VALID_PUBLIC_KEY });
    expect(http).toHaveBeenCalledWith();
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
    const result = await resolver.resolve({ name: "unknown.eth" });

    expect(result).toBeUndefined();

    await resolver.destroy();
  });

  it("passes custom URL to http() transport", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));

    const resolver = new BsoResolver({ key: "bso-rpc", provider: "https://rpc.example.com" });
    await resolver.resolve({ name: "example.eth" });

    expect(http).toHaveBeenCalledWith("https://rpc.example.com");

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
    const result = await resolver.resolve({ name: "example.eth" });

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
    const result = await resolver.resolve({ name: "example.eth" });

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
      resolver.resolve({ name: "example.eth" })
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
      resolver.resolve({ name: "example.eth" })
    ).rejects.toThrow('Invalid bitsocial TXT record: "publicKey" suffix key is not allowed.');

    await resolver.destroy();
  });

  it("throws when first TXT segment is not a valid IPNS public key", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue("not-a-valid-public-key;network=mainnet"),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });

    await expect(
      resolver.resolve({ name: "example.eth" })
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
      await resolver.resolve({ name: "example.eth" });
      expect.fail("should have thrown");
    } catch (error: any) {
      expect(error.message).toBe("RPC error");
      expect(error.details).toEqual({
        name: "example.eth",
        resolvedName: "example.eth",
        provider: "viem",
        ethName: "example.eth",
        normalized: "example.eth",
        chain: "mainnet",
      });
    }

    await resolver.destroy();
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
        name: "example.eth",
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
      name: "example.eth",
      abortSignal: controller.signal,
    });

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    await resolver.destroy();
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

  afterEach(() => {
    _resetRegistries();
  });

  it("throws after destroy() is called", async () => {
    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    await resolver.resolve({ name: "example.eth" });
    await resolver.destroy();

    await expect(
      resolver.resolve({ name: "example.eth" })
    ).rejects.toThrow("Cannot resolve after destroy() has been called.");
  });

  it("destroy() is idempotent", async () => {
    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    await resolver.resolve({ name: "example.eth" });
    await resolver.destroy();
    await resolver.destroy(); // should not throw
  });

  it("destroy() is a no-op if resolve() was never called", async () => {
    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    await resolver.destroy(); // should not throw
  });

  it("canResolve works without initialization", () => {
    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    expect(resolver.canResolve({ name: "example.eth" })).toBe(true);
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
});

describe("BsoResolver shared resources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetRegistries();
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));
  });

  afterEach(() => {
    _resetRegistries();
  });

  it("shares viem client between resolvers with same provider", async () => {
    const r1 = new BsoResolver({ key: "bso-viem", provider: "viem" });
    const r2 = new BsoResolver({ key: "bso-viem", provider: "viem" });

    await r1.resolve({ name: "a.eth" });
    await r2.resolve({ name: "b.eth" });

    expect(createPublicClient).toHaveBeenCalledTimes(1);

    await r1.destroy();
    await r2.destroy();
  });

  it("creates separate clients for different providers", async () => {
    const r1 = new BsoResolver({ key: "bso-viem", provider: "viem" });
    const r2 = new BsoResolver({ key: "bso-other", provider: "https://other.rpc" });

    await r1.resolve({ name: "a.eth" });
    await r2.resolve({ name: "b.eth" });

    expect(createPublicClient).toHaveBeenCalledTimes(2);

    await r1.destroy();
    await r2.destroy();
  });

  it("keeps client alive while any resolver still uses it", async () => {
    const r1 = new BsoResolver({ key: "bso-viem", provider: "viem" });
    const r2 = new BsoResolver({ key: "bso-viem", provider: "viem" });

    await r1.resolve({ name: "a.eth" });
    await r2.resolve({ name: "b.eth" });
    await r1.destroy();

    // r2 should still work
    await r2.resolve({ name: "c.eth" });
    await r2.destroy();
  });

  it("returns cached result without hitting ENS", async () => {
    (isCacheStale as Mock).mockReturnValue(false);

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });

    // First call populates cache
    await resolver.resolve({ name: "example.eth" });

    const mockGetEnsText = getMockGetEnsText();
    mockGetEnsText.mockClear();

    // Second call should use cache
    await resolver.resolve({ name: "example.eth" });
    expect(mockGetEnsText).not.toHaveBeenCalled();

    await resolver.destroy();
  });
});
