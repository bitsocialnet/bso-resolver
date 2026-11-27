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
import { createTestLog, type TestLog } from "../test-log.js";

let log: TestLog;
beforeEach(() => {
  log = createTestLog();
});

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
    const result = await resolver.resolve({ log, name: "example.bso" });

    expect(result).toEqual({ publicKey: VALID_PUBLIC_KEY });
    expect(http).toHaveBeenCalledWith(undefined, { fetchOptions: { signal: expect.any(AbortSignal) } });
    expect(getMockGetEnsText()).toHaveBeenCalledWith({
      name: "example.eth",
      key: "bitsocial",
    });

    await resolver.destroy({ log });
  });

  it("resolves .bso name by normalizing to .eth first", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    const result = await resolver.resolve({ log, name: "example.bso" });

    expect(result).toEqual({ publicKey: VALID_PUBLIC_KEY });
    expect(getMockGetEnsText()).toHaveBeenCalledWith({
      name: "example.eth",
      key: "bitsocial",
    });

    await resolver.destroy({ log });
  });

  it("returns undefined when TXT record not found", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(null),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    const result = await resolver.resolve({ log, name: "unknown.bso" });

    expect(result).toBeUndefined();

    await resolver.destroy({ log });
  });

  it("passes custom URL to http() transport", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));

    const resolver = new BsoResolver({ key: "bso-rpc", provider: "https://rpc.example.com" });
    await resolver.resolve({ log, name: "example.bso" });

    expect(http).toHaveBeenCalledWith("https://rpc.example.com", { fetchOptions: { signal: expect.any(AbortSignal) } });

    await resolver.destroy({ log });
  });

  it("uses webSocket() transport for wss:// provider URLs", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));

    const resolver = new BsoResolver({ key: "bso-ws", provider: "wss://rpc.example.com" });
    await resolver.resolve({ log, name: "example.bso" });

    expect(webSocket).toHaveBeenCalledWith("wss://rpc.example.com", { reconnect: false });
    expect(http).not.toHaveBeenCalled();

    await resolver.destroy({ log });
  });

  it("uses webSocket() transport for ws:// provider URLs", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));

    const resolver = new BsoResolver({ key: "bso-ws", provider: "ws://rpc.example.com" });
    await resolver.resolve({ log, name: "example.bso" });

    expect(webSocket).toHaveBeenCalledWith("ws://rpc.example.com", { reconnect: false });
    expect(http).not.toHaveBeenCalled();

    await resolver.destroy({ log });
  });

  it("defaults to .bso when name has no TLD", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    const result = await resolver.resolve({ log, name: "example" });

    expect(result).toEqual({ publicKey: VALID_PUBLIC_KEY });
    expect(getMockGetEnsText()).toHaveBeenCalledWith({
      name: "example.eth",
      key: "bitsocial",
    });

    await resolver.destroy({ log });
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
    const result = await resolver.resolve({ log, name: "example.bso" });

    expect(result).toEqual({
      publicKey: VALID_PUBLIC_KEY,
      name: "memes.bso",
      network: "mainnet",
      owner: "bitsocial",
    });

    await resolver.destroy({ log });
  });

  it("uses last value when metadata keys are duplicated", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi
        .fn()
        .mockResolvedValue(`${VALID_PUBLIC_KEY};network=mainnet;network=testnet`),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    const result = await resolver.resolve({ log, name: "example.bso" });

    expect(result).toEqual({
      publicKey: VALID_PUBLIC_KEY,
      network: "testnet",
    });

    await resolver.destroy({ log });
  });

  it("throws for malformed metadata segments", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(`${VALID_PUBLIC_KEY};bad-segment`),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });

    await expect(
      resolver.resolve({ log, name: "example.bso" })
    ).rejects.toThrow('Invalid bitsocial TXT record: expected "key=value" segment');

    await resolver.destroy({ log });
  });

  it('throws when metadata includes "publicKey" key', async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi
        .fn()
        .mockResolvedValue(`${VALID_PUBLIC_KEY};publicKey=12D3KooWWrongValue`),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });

    await expect(
      resolver.resolve({ log, name: "example.bso" })
    ).rejects.toThrow('Invalid bitsocial TXT record: "publicKey" suffix key is not allowed.');

    await resolver.destroy({ log });
  });

  it("throws when first TXT segment is not a valid IPNS public key", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue("not-a-valid-public-key;network=mainnet"),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });

    await expect(
      resolver.resolve({ log, name: "example.bso" })
    ).rejects.toThrow(
      "Invalid bitsocial TXT record: expected a valid IPNS public key as the first segment."
    );

    await resolver.destroy({ log });
  });

  it("throws for unsupported TLDs", async () => {
    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });

    await expect(
      resolver.resolve({ log, name: "example.com" })
    ).rejects.toThrow('Unsupported TLD in "example.com". Only .bso and .eth domains are supported.');

    await resolver.destroy({ log });
  });

  it("forwards blockNumber to getEnsText when provided", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    const result = await resolver.resolve({ log, name: "example.bso", blockNumber: 23500000n });

    expect(result).toEqual({ publicKey: VALID_PUBLIC_KEY });
    expect(getMockGetEnsText()).toHaveBeenCalledWith({
      name: "example.eth",
      key: "bitsocial",
      blockNumber: 23500000n,
    });

    await resolver.destroy({ log });
  });

  it("resolves at head (blockNumber undefined) when omitted", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    await resolver.resolve({ log, name: "example.bso" });

    expect(getMockGetEnsText()).toHaveBeenCalledWith({
      name: "example.eth",
      key: "bitsocial",
    });
    expect(getMockGetEnsText().mock.calls[0][0]).not.toHaveProperty("blockNumber");

    await resolver.destroy({ log });
  });

  it("enables multicall batching by default", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    await resolver.resolve({ log, name: "example.bso" });

    expect(createPublicClient).toHaveBeenCalledWith(
      expect.objectContaining({
        batch: { multicall: { wait: 200, batchSize: 100_000 } },
      })
    );

    await resolver.destroy({ log });
  });

  it("merges custom batch options with defaults", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));

    const resolver = new BsoResolver({
      key: "bso-viem",
      provider: "viem",
      batch: { wait: 0 },
    });
    await resolver.resolve({ log, name: "example.bso" });

    expect(createPublicClient).toHaveBeenCalledWith(
      expect.objectContaining({
        batch: { multicall: { wait: 0, batchSize: 100_000 } },
      })
    );

    await resolver.destroy({ log });
  });

  it("disables batching with batch: false", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));

    const resolver = new BsoResolver({
      key: "bso-viem",
      provider: "viem",
      batch: false,
    });
    await resolver.resolve({ log, name: "example.bso" });

    expect((createPublicClient as Mock).mock.calls[0][0]).not.toHaveProperty("batch");

    await resolver.destroy({ log });
  });

  it("propagates errors from viem with details", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockRejectedValue(new Error("RPC error")),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });

    try {
      await resolver.resolve({ log, name: "example.bso" });
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

    await resolver.destroy({ log });
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
        log,
        name: "example.bso",
        abortSignal: controller.signal,
      })
    ).rejects.toMatchObject({ name: "AbortError" });

    await resolver.destroy({ log });
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
      log,
      name: "example.bso",
      abortSignal: controller.signal,
    });

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    await resolver.destroy({ log });
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

    const pending1 = resolver.resolve({ log, name: "a.bso" });
    const pending2 = resolver.resolve({ log, name: "b.bso" });

    await resolver.destroy({ log });

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
    await resolver.resolve({ log, name: "example.bso" });

    await resolver.destroy({ log });

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
    await resolver.resolve({ log, name: "example.bso" });

    await resolver.destroy({ log });

    await expect(
      resolver.resolve({ log, name: "example.bso" })
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
    await resolver.resolve({ log, name: "example.bso" });

    await resolver.destroy({ log });

    await expect(
      resolver.resolve({ log, name: "example.bso" })
    ).rejects.toThrow("Cannot resolve after destroy() has been called.");
  });

  it("passes destroy signal to http() transport fetchOptions", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));

    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    await resolver.resolve({ log, name: "example.bso" });

    // Capture the signal passed to http()
    const httpCall = (http as Mock).mock.calls[0];
    const signal = httpCall[1]?.fetchOptions?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);

    await resolver.destroy({ log });

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
    await resolver.resolve({ log, name: "example.bso" });
    await resolver.destroy({ log });

    await expect(
      resolver.resolve({ log, name: "example.bso" })
    ).rejects.toThrow("Cannot resolve after destroy() has been called.");
  });

  it("destroy() is idempotent", async () => {
    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    await resolver.resolve({ log, name: "example.bso" });
    await resolver.destroy({ log });
    await resolver.destroy({ log }); // should not throw
  });

  it("destroy() is a no-op if resolve() was never called", async () => {
    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });
    await resolver.destroy({ log }); // should not throw
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

    await r1.resolve({ log, name: "a.bso" });
    await r2.resolve({ log, name: "b.bso" });

    expect(createPublicClient).toHaveBeenCalledTimes(2);

    await r1.destroy({ log });
    await r2.destroy({ log });
  });
});

describe("BsoResolver logging through the passed log", () => {
  const KEYED_HTTP = "https://mainnet.infura.io/v3/SECRET_API_KEY?apikey=SECRET_QUERY";
  const KEYED_WS = "wss://user:SECRET_PASSWORD@mainnet.infura.io/ws/v3/SECRET_API_KEY";
  const SECRETS = ["SECRET_API_KEY", "SECRET_QUERY", "SECRET_PASSWORD", "/v3/"];

  function viemLikeError(url: string): Error {
    // viem's `message` embeds the request URL; `shortMessage` does not.
    return Object.assign(new Error(`HTTP request failed.\n\nURL: ${url}`), {
      shortMessage: "HTTP request failed.",
    });
  }

  function loggedText(spy: Mock): string {
    return JSON.stringify(spy.mock.calls);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs a failed resolve to the passed log.trace", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockRejectedValue(viemLikeError(KEYED_HTTP)),
    }));
    const resolver = new BsoResolver({ key: "bso-infura", provider: KEYED_HTTP });

    await expect(resolver.resolve({ log, name: "example.bso" })).rejects.toThrow();

    expect(log.trace).toHaveBeenCalledTimes(1);
    expect(loggedText(log.trace)).toContain("example.bso");
    expect(loggedText(log.trace)).toContain("mainnet.infura.io");
    expect(loggedText(log.trace)).toContain("HTTP request failed.");
    await resolver.destroy({ log });
  });

  it("logs the message of errors that are not from viem", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue("not-a-valid-public-key"),
    }));
    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });

    await expect(resolver.resolve({ log, name: "example.bso" })).rejects.toThrow();

    expect(loggedText(log.trace)).toContain("Invalid bitsocial TXT record");
    await resolver.destroy({ log });
  });

  it("does not log on a successful resolve", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
    }));
    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });

    await resolver.resolve({ log, name: "example.bso" });

    expect(log.trace).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    await resolver.destroy({ log });
  });

  it("logs only the provider host, never the key in its path, query or userinfo", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockRejectedValue(viemLikeError(KEYED_HTTP)),
    }));
    const resolver = new BsoResolver({ key: "bso-infura", provider: KEYED_HTTP });

    const error: any = await resolver.resolve({ log, name: "example.bso" }).catch((e) => e);

    for (const secret of SECRETS) {
      expect(loggedText(log.trace)).not.toContain(secret);
    }
    expect(error.details.provider).toBe("mainnet.infura.io");
    await resolver.destroy({ log });
  });

  it("logs a failed WebSocket close to the log passed to destroy()", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(VALID_PUBLIC_KEY),
      transport: {
        type: "webSocket",
        getRpcClient: vi.fn().mockRejectedValue(viemLikeError(KEYED_WS)),
      },
    }));
    const resolver = new BsoResolver({ key: "bso-ws", provider: KEYED_WS });
    const resolveLog = createTestLog();
    await resolver.resolve({ log: resolveLog, name: "example.bso" });

    await resolver.destroy({ log });

    expect(log.error).toHaveBeenCalledTimes(1);
    expect(resolveLog.error).not.toHaveBeenCalled();
    expect(loggedText(log.error)).toContain("mainnet.infura.io");
    for (const secret of SECRETS) {
      expect(loggedText(log.error)).not.toContain(secret);
    }
  });

  it("logs an unparseable provider as a placeholder", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockRejectedValue(new Error("boom")),
    }));
    const resolver = new BsoResolver({ key: "bso-bad", provider: "not a url SECRET_API_KEY" });

    const error: any = await resolver.resolve({ log, name: "example.bso" }).catch((e) => e);

    expect(loggedText(log.trace)).toContain("<invalid provider url>");
    expect(loggedText(log.trace)).not.toContain("SECRET_API_KEY");
    expect(error.details.provider).toBe("<invalid provider url>");
    await resolver.destroy({ log });
  });

  it("resolve() throws TypeError when log is missing", async () => {
    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });

    await expect(
      resolver.resolve({ name: "example.bso" } as any)
    ).rejects.toThrow(new TypeError('resolve(): "log" is required'));
    expect(createPublicClient).not.toHaveBeenCalled();
  });

  it("destroy() throws TypeError when log is missing", async () => {
    const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });

    await expect((resolver.destroy as any)()).rejects.toThrow(
      new TypeError('destroy(): "log" is required')
    );
    await expect((resolver.destroy as any)({})).rejects.toThrow(
      new TypeError('destroy(): "log" is required')
    );
  });
});
