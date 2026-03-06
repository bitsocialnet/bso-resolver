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

  it("propagates errors from viem", async () => {
    (createPublicClient as Mock).mockImplementation(() => ({
      getEnsText: vi.fn().mockRejectedValue(new Error("RPC error")),
    }));

    await expect(
      resolveBso({ name: "example.eth", provider: "viem" })
    ).rejects.toThrow("RPC error");
  });
});
