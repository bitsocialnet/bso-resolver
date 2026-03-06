import { describe, it, expect, vi, beforeEach } from "vitest";
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

import { createPublicClient, http } from "viem";
import { resolveBso } from "../src/index.js";

function getMockGetEnsText(): Mock {
  const client = (createPublicClient as Mock).mock.results.at(-1)?.value;
  return client.getEnsText;
}

describe("resolveBso", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mock implementation so each test gets a fresh mock client
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn(),
    }));
  });

  it('resolves .eth name with provider="viem"', async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue("QmSomeIpnsHash"),
    }));

    const result = await resolveBso({ name: "example.eth", provider: "viem" });

    expect(result).toBe("QmSomeIpnsHash");
    expect(http).toHaveBeenCalledWith();
    expect(getMockGetEnsText()).toHaveBeenCalledWith({
      name: "example.eth",
      key: "bitsocial",
    });
  });

  it("resolves .bso name by normalizing to .eth first", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue("QmSomeIpnsHash"),
    }));

    const result = await resolveBso({ name: "example.bso", provider: "viem" });

    expect(result).toBe("QmSomeIpnsHash");
    expect(getMockGetEnsText()).toHaveBeenCalledWith({
      name: "example.eth",
      key: "bitsocial",
    });
  });

  it("returns undefined when TXT record not found", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue(null),
    }));

    const result = await resolveBso({ name: "unknown.eth", provider: "viem" });

    expect(result).toBeUndefined();
  });

  it("passes custom URL to http() transport", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue("QmHash"),
    }));

    await resolveBso({
      name: "example.eth",
      provider: "https://rpc.example.com",
    });

    expect(http).toHaveBeenCalledWith("https://rpc.example.com");
  });

  it("passes abort signal to http() transport with provider=viem", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue("QmHash"),
    }));

    const controller = new AbortController();

    await resolveBso({
      name: "example.eth",
      provider: "viem",
      abortSignal: controller.signal,
    });

    expect(http).toHaveBeenCalledWith(undefined, {
      fetchOptions: { signal: controller.signal },
    });
  });

  it("passes abort signal to http() transport with custom URL", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue("QmHash"),
    }));

    const controller = new AbortController();

    await resolveBso({
      name: "example.eth",
      provider: "https://rpc.example.com",
      abortSignal: controller.signal,
    });

    expect(http).toHaveBeenCalledWith("https://rpc.example.com", {
      fetchOptions: { signal: controller.signal },
    });
  });

  it("defaults to .bso when name has no TLD", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue("QmHash"),
    }));

    const result = await resolveBso({ name: "example", provider: "viem" });

    expect(result).toBe("QmHash");
    expect(getMockGetEnsText()).toHaveBeenCalledWith({
      name: "example.eth",
      key: "bitsocial",
    });
  });

  it("throws for unsupported TLDs", async () => {
    await expect(
      resolveBso({ name: "example.com", provider: "viem" })
    ).rejects.toThrow('Unsupported TLD in "example.com". Only .bso and .eth domains are supported.');
  });

  it("propagates errors from viem with details", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockRejectedValue(new Error("RPC error")),
    }));

    try {
      await resolveBso({ name: "example.eth", provider: "viem" });
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
  });

  it("rejects immediately with AbortError for pre-aborted signal", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockResolvedValue("QmHash"),
    }));

    const controller = new AbortController();
    controller.abort();

    await expect(
      resolveBso({
        name: "example.eth",
        provider: "viem",
        abortSignal: controller.signal,
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(createPublicClient).not.toHaveBeenCalled();
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
    const pending = resolveBso({
      name: "example.eth",
      provider: "viem",
      abortSignal: controller.signal,
    });

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
