import { describe, it, expect, vi, afterEach } from "vitest";
import {
  decodeFunctionData,
  encodeFunctionResult,
  multicall3Abi,
  type Hex,
} from "viem";
import { namehash } from "viem/ens";
import { BsoResolver } from "@bitsocial/bso-resolver";
import { BSO_REGISTRY } from "../../src/runtime/shared/resolver.js";

// Uses the real viem client against a stubbed fetch to verify that concurrent
// resolves are coalesced into a single Multicall3.aggregate3 eth_call.

const VALID_PUBLIC_KEY = "12D3KooWN5rLmRJ8fWMwTtkDN7w2RgPPGRM4mtWTnfbjpi1Sh7zR";
const AGGREGATE3_SELECTOR = "0x82ad56cb";

const registryTextAbi = [
  {
    name: "text",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

interface CapturedEthCall {
  to: Hex;
  data: Hex;
  block: string;
}

// Answers a registry text(node, key) call. Records are keyed by node, and a
// node without an entry reads as the empty string, like the real registry.
function answerTextCall(data: Hex, records: Record<string, string>): Hex {
  const decoded = decodeFunctionData({ abi: registryTextAbi, data });
  const [node, key] = decoded.args;
  expect(key).toBe("bitsocial");
  return encodeFunctionResult({
    abi: registryTextAbi,
    functionName: "text",
    result: records[node] ?? "",
  });
}

// Stubs global fetch with a JSON-RPC handler that answers both plain registry
// eth_calls and Multicall3.aggregate3 batches of them.
function stubRpc(
  records: Record<string, string>,
  { failWith }: { failWith?: string } = {}
): CapturedEthCall[] {
  const captured: CapturedEthCall[] = [];

  vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    if (body.method !== "eth_call") {
      throw new Error(`Unexpected RPC method: ${body.method}`);
    }

    const [{ to, data }, block] = body.params;
    captured.push({ to, data, block });

    if (failWith) {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: failWith } }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    let result: Hex;
    if (data.startsWith(AGGREGATE3_SELECTOR)) {
      const decoded = decodeFunctionData({ abi: multicall3Abi, data });
      result = encodeFunctionResult({
        abi: multicall3Abi,
        functionName: "aggregate3",
        result: decoded.args[0].map((call) => ({
          success: true,
          returnData: answerTextCall(call.callData, records),
        })),
      });
    } else {
      result = answerTextCall(data, records);
    }

    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
      { headers: { "Content-Type": "application/json" } }
    );
  });

  return captured;
}

function decodedBatchCalls(call: CapturedEthCall) {
  const decoded = decodeFunctionData({ abi: multicall3Abi, data: call.data });
  return decoded.args[0];
}

function decodedBatchCallCount(call: CapturedEthCall): number {
  return decodedBatchCalls(call).length;
}

const ALL_NAMES = ["a.bso", "b.bso", "c.bso"];
const ALL_RECORDS = Object.fromEntries(
  ALL_NAMES.map((name) => [namehash(name), VALID_PUBLIC_KEY])
);

describe("BsoResolver multicall batching (real viem client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("coalesces concurrent resolves into a single aggregate3 eth_call", async () => {
    const captured = stubRpc(ALL_RECORDS);
    const resolver = new BsoResolver({
      key: "bso-batch",
      provider: "https://rpc.batch.test",
      batch: { wait: 50 },
    });

    const results = await Promise.all([
      resolver.resolve({ name: "a.bso" }),
      resolver.resolve({ name: "b.bso" }),
      resolver.resolve({ name: "c.bso" }),
    ]);

    expect(results).toEqual([
      { publicKey: VALID_PUBLIC_KEY },
      { publicKey: VALID_PUBLIC_KEY },
      { publicKey: VALID_PUBLIC_KEY },
    ]);
    expect(captured).toHaveLength(1);
    expect(decodedBatchCallCount(captured[0])).toBe(3);
    expect(captured[0].to.toLowerCase()).toBe(
      BSO_REGISTRY.chain.contracts.multicall3.address.toLowerCase()
    );
    for (const call of decodedBatchCalls(captured[0])) {
      expect(call.target.toLowerCase()).toBe(BSO_REGISTRY.address.toLowerCase());
    }

    await resolver.destroy();
  });

  // Any block at or after the registry's deployment.
  const HISTORICAL_BLOCK = BSO_REGISTRY.deploymentBlock + 1_000n;

  it("coalesces concurrent resolves pinned to the same blockNumber", async () => {
    const captured = stubRpc(ALL_RECORDS);
    const resolver = new BsoResolver({
      key: "bso-batch-block",
      provider: "https://rpc.batch.test",
      batch: { wait: 50 },
    });

    const results = await Promise.all([
      resolver.resolve({ name: "a.bso", blockNumber: HISTORICAL_BLOCK }),
      resolver.resolve({ name: "b.bso", blockNumber: HISTORICAL_BLOCK }),
    ]);

    expect(results).toEqual([
      { publicKey: VALID_PUBLIC_KEY },
      { publicKey: VALID_PUBLIC_KEY },
    ]);
    expect(captured).toHaveLength(1);
    expect(decodedBatchCallCount(captured[0])).toBe(2);
    expect(captured[0].block).toBe(`0x${HISTORICAL_BLOCK.toString(16)}`);

    await resolver.destroy();
  });

  it("does not merge resolves pinned to different blockNumbers", async () => {
    const captured = stubRpc(ALL_RECORDS);
    const resolver = new BsoResolver({
      key: "bso-batch-blocks",
      provider: "https://rpc.batch.test",
      batch: { wait: 50 },
    });

    await Promise.all([
      resolver.resolve({ name: "a.bso", blockNumber: HISTORICAL_BLOCK }),
      resolver.resolve({ name: "b.bso", blockNumber: HISTORICAL_BLOCK + 1n }),
    ]);

    expect(captured).toHaveLength(2);
    expect(new Set(captured.map((call) => call.block)).size).toBe(2);

    await resolver.destroy();
  });

  it("sends individual eth_calls with batch: false", async () => {
    const captured = stubRpc(ALL_RECORDS);
    const resolver = new BsoResolver({
      key: "bso-no-batch",
      provider: "https://rpc.batch.test",
      batch: false,
    });

    const results = await Promise.all([
      resolver.resolve({ name: "a.bso" }),
      resolver.resolve({ name: "b.bso" }),
      resolver.resolve({ name: "c.bso" }),
    ]);

    expect(results).toEqual([
      { publicKey: VALID_PUBLIC_KEY },
      { publicKey: VALID_PUBLIC_KEY },
      { publicKey: VALID_PUBLIC_KEY },
    ]);
    expect(captured).toHaveLength(3);
    for (const call of captured) {
      expect(call.data.startsWith(AGGREGATE3_SELECTOR)).toBe(false);
      expect(call.to.toLowerCase()).toBe(BSO_REGISTRY.address.toLowerCase());
    }

    await resolver.destroy();
  });
  it("returns each name's own record from a batch, undefined for empty ones", async () => {
    const otherKey = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
    const captured = stubRpc({
      [namehash("a.bso")]: VALID_PUBLIC_KEY,
      [namehash("blog.c.bso")]: `${otherKey};network=testnet`,
    });
    const resolver = new BsoResolver({
      key: "bso-batch-mixed",
      provider: "https://rpc.batch.test",
      batch: { wait: 50 },
    });

    const results = await Promise.all([
      resolver.resolve({ name: "a.bso" }),
      resolver.resolve({ name: "unregistered.bso" }),
      resolver.resolve({ name: "blog.c.bso" }),
    ]);

    expect(results).toEqual([
      { publicKey: VALID_PUBLIC_KEY },
      undefined,
      { publicKey: otherKey, network: "testnet" },
    ]);
    expect(captured).toHaveLength(1);

    await resolver.destroy();
  });

  it("rejects every resolve in a batch when the batched eth_call fails", async () => {
    const captured = stubRpc(ALL_RECORDS, { failWith: "rate limited" });
    const resolver = new BsoResolver({
      key: "bso-batch-fail",
      provider: "https://rpc.batch.test",
      batch: { wait: 50 },
    });

    const results = await Promise.allSettled(
      ALL_NAMES.map((name) => resolver.resolve({ name }))
    );

    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
      "rejected",
    ]);
    expect(captured.every((call) => call.data.startsWith(AGGREGATE3_SELECTOR))).toBe(true);

    await resolver.destroy();
  });
});
