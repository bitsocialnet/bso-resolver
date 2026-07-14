import { describe, it, expect, vi, afterEach } from "vitest";
import {
  decodeFunctionData,
  encodeFunctionResult,
  multicall3Abi,
  type Hex,
} from "viem";
import { BsoResolver } from "@bitsocial/bso-resolver";

// Uses the real viem client against a stubbed fetch to verify that concurrent
// resolves are coalesced into a single Multicall3.aggregate3 eth_call.

const VALID_PUBLIC_KEY = "12D3KooWN5rLmRJ8fWMwTtkDN7w2RgPPGRM4mtWTnfbjpi1Sh7zR";
const RESOLVER_ADDRESS = "0x231b0ee14048e9dccd1d247744d114a4eb5e8e63";

// ENS universal resolver function used by viem's getEnsText (viem >= 2.23)
const universalResolverResolveAbi = [
  {
    name: "resolveWithGateways",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "name", type: "bytes" },
      { name: "data", type: "bytes" },
      { name: "gateways", type: "string[]" },
    ],
    outputs: [
      { name: "", type: "bytes" },
      { name: "address", type: "address" },
    ],
  },
] as const;

const textResolverAbi = [
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

function encodeUniversalResolverResult(txtValue: string): Hex {
  const textResult = encodeFunctionResult({
    abi: textResolverAbi,
    functionName: "text",
    result: txtValue,
  });
  return encodeFunctionResult({
    abi: universalResolverResolveAbi,
    functionName: "resolveWithGateways",
    result: [textResult, RESOLVER_ADDRESS],
  });
}

interface CapturedEthCall {
  to: Hex;
  data: Hex;
  block: string;
}

// Stubs global fetch with a JSON-RPC handler that answers both plain
// universal-resolver eth_calls and Multicall3.aggregate3 batches.
function stubRpc(): CapturedEthCall[] {
  const captured: CapturedEthCall[] = [];

  vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    if (body.method !== "eth_call") {
      throw new Error(`Unexpected RPC method: ${body.method}`);
    }

    const [{ to, data }, block] = body.params;
    captured.push({ to, data, block });

    let result: Hex;
    if (data.startsWith("0x82ad56cb")) {
      // aggregate3(calls[]) — answer every inner call with a valid TXT record
      const decoded = decodeFunctionData({ abi: multicall3Abi, data });
      const calls = decoded.args[0];
      result = encodeFunctionResult({
        abi: multicall3Abi,
        functionName: "aggregate3",
        result: calls.map(() => ({
          success: true,
          returnData: encodeUniversalResolverResult(VALID_PUBLIC_KEY),
        })),
      });
    } else {
      result = encodeUniversalResolverResult(VALID_PUBLIC_KEY);
    }

    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
      { headers: { "Content-Type": "application/json" } }
    );
  });

  return captured;
}

function decodedBatchCallCount(call: CapturedEthCall): number {
  const decoded = decodeFunctionData({ abi: multicall3Abi, data: call.data });
  return decoded.args[0].length;
}

describe("BsoResolver multicall batching (real viem client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("coalesces concurrent resolves into a single aggregate3 eth_call", async () => {
    const captured = stubRpc();
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

    await resolver.destroy();
  });

  // Block numbers must be >= 23085558: viem's mainnet chain config marks the
  // ENS universal resolver as deployed at that block and getEnsText throws
  // ChainDoesNotSupportContract for older blockNumbers.
  const HISTORICAL_BLOCK = 23_500_000n;

  it("coalesces concurrent resolves pinned to the same blockNumber", async () => {
    const captured = stubRpc();
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
    const captured = stubRpc();
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
    const captured = stubRpc();
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
      expect(call.data.startsWith("0x82ad56cb")).toBe(false);
    }

    await resolver.destroy();
  });
});
