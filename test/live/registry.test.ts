import { describe, it, expect, vi, afterEach } from "vitest";
import { BsoResolver } from "@bitsocial/bso-resolver";
import { BSO_REGISTRY } from "../../src/runtime/shared/resolver.js";

// Reads the deployed BSIP-13 registry (see BSO_REGISTRY) through public RPCs.
// Expected records come from the BSIP-13 seed list:
// https://github.com/bitsocialnet/BSIPs/blob/master/assets/bsip-13/seed-list.json

// Providers that serve the registry's chain, in order of preference. A test
// passes if it passes on any one of them, so one endpoint being down or
// rate-limited does not fail the run.
const PROVIDERS = [
  "https://sepolia.gateway.tenderly.co",
  "viem",
  "https://ethereum-sepolia-rpc.publicnode.com",
];

// Providers that keep historical state, needed for `blockNumber` resolves.
const ARCHIVE_PROVIDERS = ["https://sepolia.gateway.tenderly.co", "viem"];

// A block after the seed list was written to the registry.
const SEEDED_BLOCK = BSO_REGISTRY.deploymentBlock + 32n;

async function withResolver<T>(
  run: (resolver: BsoResolver) => Promise<T>,
  providers: string[] = PROVIDERS
): Promise<T> {
  let lastError: unknown;
  for (const provider of providers) {
    const resolver = new BsoResolver({ key: `bso-live-${provider}`, provider });
    try {
      return await run(resolver);
    } catch (error) {
      lastError = error;
    } finally {
      await resolver.destroy();
    }
  }
  throw lastError;
}

function resolveLive(name: string, blockNumber?: bigint, providers?: string[]) {
  return withResolver(
    (resolver) =>
      resolver.resolve({ name, ...(blockNumber !== undefined ? { blockNumber } : {}) }),
    providers
  );
}

describe(`BSIP-13 registry on ${BSO_REGISTRY.chain.name} (live)`, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves a seeded name to its seed-list record", async () => {
    expect(await resolveLive("3dcg-posting.bso")).toEqual({
      publicKey: "12D3KooWBRCcwxWTx23tyK7Uhqs9ViE3MnSgvWSLip2ikrWaD3c2",
    });
  });

  it("resolves a seeded subdomain, hashing every label", async () => {
    expect(await resolveLive("blog.bitsocial.bso")).toEqual({
      publicKey: "12D3KooWSuX9mVvLCfPa1f421Le88phwhuqMHEcW4pd6Q9uEjAcQ",
    });
    // The parent is registered with no record, so a wrong node would not
    // accidentally return the subdomain's value.
    expect(await resolveLive("bitsocial.bso")).toBeUndefined();
  });

  it("resolves a name registered through commit-reveal after the seed", async () => {
    // bso-resolver-test.bso was registered for this suite at block 12222930 and
    // its record set at block 12222931. It is not on the seed list. The
    // registration expires on 2027-11-27 unless renewed.
    expect(await resolveLive("bso-resolver-test.bso")).toEqual({
      publicKey: "12D3KooWN5rLmRJ8fWMwTtkDN7w2RgPPGRM4mtWTnfbjpi1Sh7zR",
    });
    // One block before the record was set, the name is registered with no record.
    expect(
      await resolveLive("bso-resolver-test.bso", 12_222_930n, ARCHIVE_PROVIDERS)
    ).toBeUndefined();
  });

  it("returns undefined for seeded names with an empty record", async () => {
    expect(await resolveLive("5chan.bso")).toBeUndefined();
    expect(await resolveLive("rinse.bso")).toBeUndefined();
  });

  it("returns undefined for an unregistered name", async () => {
    expect(
      await resolveLive("bso-resolver-live-test-never-registered-7f3a9c.bso")
    ).toBeUndefined();
  });

  it("returns undefined for an unregistered non-ASCII name", async () => {
    expect(await resolveLive("日本語.bso")).toBeUndefined();
  });

  it("defaults a bare name to .bso", async () => {
    expect(await resolveLive("3dcg-posting")).toEqual({
      publicKey: "12D3KooWBRCcwxWTx23tyK7Uhqs9ViE3MnSgvWSLip2ikrWaD3c2",
    });
  });

  it("resolves a burst of concurrent names in a single eth_call", async () => {
    await withResolver(async (resolver) => {
      // Restored in `finally` so a failed attempt's calls are not counted
      // against the next provider.
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      try {
        const results = await Promise.all(
          [
            "3dcg-posting.bso",
            "blog.bitsocial.bso",
            "5chan.bso",
            "日本語.bso",
            "bso-resolver-live-test-never-registered-7f3a9c.bso",
          ].map((name) => resolver.resolve({ name }))
        );

        expect(results).toEqual([
          { publicKey: "12D3KooWBRCcwxWTx23tyK7Uhqs9ViE3MnSgvWSLip2ikrWaD3c2" },
          { publicKey: "12D3KooWSuX9mVvLCfPa1f421Le88phwhuqMHEcW4pd6Q9uEjAcQ" },
          undefined,
          undefined,
          undefined,
        ]);

        const ethCalls = fetchSpy.mock.calls.filter(([, init]) =>
          String(init?.body).includes('"eth_call"')
        );
        expect(ethCalls).toHaveLength(1);
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  it("resolves at a historical blockNumber", async () => {
    expect(
      await resolveLive("blog.bitsocial.bso", SEEDED_BLOCK, ARCHIVE_PROVIDERS)
    ).toEqual({
      publicKey: "12D3KooWSuX9mVvLCfPa1f421Le88phwhuqMHEcW4pd6Q9uEjAcQ",
    });
    // At the deployment block the registry exists but nothing is seeded yet.
    expect(
      await resolveLive("blog.bitsocial.bso", BSO_REGISTRY.deploymentBlock, ARCHIVE_PROVIDERS)
    ).toBeUndefined();
  });

  it("throws for a blockNumber before the registry was deployed", async () => {
    await withResolver(async (resolver) => {
      await expect(
        resolver.resolve({
          name: "blog.bitsocial.bso",
          blockNumber: BSO_REGISTRY.deploymentBlock - 1n,
        })
      ).rejects.toThrow(/returned no data/);
    }, ARCHIVE_PROVIDERS);
  });
});
