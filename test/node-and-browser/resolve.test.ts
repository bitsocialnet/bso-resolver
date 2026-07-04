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
import { BsoResolver } from "@bitsocial/bso-resolver";

const VALID_PUBLIC_KEY = "12D3KooWN5rLmRJ8fWMwTtkDN7w2RgPPGRM4mtWTnfbjpi1Sh7zR";

function getMockGetEnsText(): Mock {
  const client = (createPublicClient as Mock).mock.results.at(-1)?.value;
  return client.getEnsText;
}

describe("BsoResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn(),
    }));
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

  it("forwards blockNumber to getEnsText when provided", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    const result = await resolver.resolve({ name: "example.bso", blockNumber: 21000000n });

    expect(result).toEqual({ publicKey: VALID_PUBLIC_KEY });
    expect(getMockGetEnsText()).toHaveBeenCalledWith({
      name: "example.eth",
      key: "bitsocial",
      blockNumber: 21000000n,
    });

    await resolver.destroy();
  });

  it("resolves at head (blockNumber undefined) when omitted", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    await resolver.resolve({ name: "example.bso" });

    expect(getMockGetEnsText()).toHaveBeenCalledWith({
      name: "example.eth",
      key: "bitsocial",
    });
    expect(getMockGetEnsText().mock.calls[0][0]).not.toHaveProperty("blockNumber");

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
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn(),
    }));
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

  it("destroy() swallows getRpcClient() rejection and still completes", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
      transport: {
        type: "webSocket",
        getRpcClient: vi.fn().mockRejectedValue(new Error("WebSocket already closed")),
      },
    }));

    const resolver = new BsoResolver({ key: "bso-ws", provider: "wss://rpc.example.com" });
    await resolver.resolve({ name: "example.bso" });

    await resolver.destroy();

    await expect(
      resolver.resolve({ name: "example.bso" })
    ).rejects.toThrow("Cannot resolve after destroy() has been called.");
  });

  it("destroy() swallows WebSocket close() throws and still completes", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
      transport: {
        type: "webSocket",
        getRpcClient: vi.fn().mockResolvedValue({
          close: vi.fn(() => { throw new Error("close failed"); }),
        }),
      },
    }));

    const resolver = new BsoResolver({ key: "bso-ws", provider: "wss://rpc.example.com" });
    await resolver.resolve({ name: "example.bso" });

    await resolver.destroy();

    await expect(
      resolver.resolve({ name: "example.bso" })
    ).rejects.toThrow("Cannot resolve after destroy() has been called.");
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

    expect(signal.aborted).toBe(true);
  });
});

describe("BsoResolver lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));
  });

  afterEach(() => {
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

  it("exposes provider", () => {
    const resolver = new BsoResolver({
      key: "bso-rpc",
      provider: "https://rpc.example.com",
    });
    expect(resolver.provider).toBe("https://rpc.example.com");
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
});
