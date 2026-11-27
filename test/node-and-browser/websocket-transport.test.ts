import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { encodeFunctionResult, type Hex } from "viem";
import { BsoResolver } from "@bitsocial/bso-resolver";

// Uses the real viem client against a fake platform WebSocket (viem loads it
// through isows, which picks up the global WebSocket on first use), so tests
// can drive connects, server-side closes and destroy() deterministically.

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

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  /** Every socket created, in order. */
  static instances: FakeWebSocket[] = [];
  /** New sockets open on their own; when false they stay connecting until open(). */
  static autoOpen = true;
  /** eth_call requests get an answer; when false they stay pending. */
  static answer = true;

  readyState: number = FakeWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly ethCalls: { id: number; method: string }[] = [];

  constructor(readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
    if (FakeWebSocket.autoOpen) {
      setTimeout(() => this.open(), 0);
    }
  }

  open(): void {
    if (this.readyState !== FakeWebSocket.CONNECTING) return;
    this.readyState = FakeWebSocket.OPEN;
    this.emit(new Event("open"));
  }

  send(data: string): void {
    const body = JSON.parse(data);
    if (body.method !== "eth_call") return; // keep-alive pings
    this.ethCalls.push(body);
    if (!FakeWebSocket.answer) return;

    const response = JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      result: encodeUniversalResolverResult(VALID_PUBLIC_KEY),
    });
    setTimeout(() => {
      if (this.readyState !== FakeWebSocket.OPEN) return;
      this.emit(Object.assign(new Event("message"), { data: response }));
    }, 0);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit(new Event("close"));
  }

  /** The server or the network closes the connection. */
  drop(): void {
    this.close();
  }

  private emit(event: Event): void {
    this.dispatchEvent(event);
    if (event.type === "open") this.onopen?.(event);
  }
}

// viem caches socket clients per URL, so each test uses its own provider URL.
let urlCounter = 0;
function uniqueProvider(): string {
  urlCounter += 1;
  return `wss://rpc-${urlCounter}.ws.test`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("BsoResolver WebSocket transport (real viem client)", () => {
  beforeAll(() => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeWebSocket.autoOpen = true;
    FakeWebSocket.answer = true;
  });

  it("resolves over a WebSocket and closes it on destroy()", async () => {
    const resolver = new BsoResolver({ key: "bso-ws", provider: uniqueProvider(), batch: false });

    await expect(resolver.resolve({ name: "example.bso" })).resolves.toEqual({
      publicKey: VALID_PUBLIC_KEY,
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
    const [socket] = FakeWebSocket.instances;
    expect(socket!.ethCalls).toHaveLength(1);

    await resolver.destroy();

    await vi.waitFor(() => expect(socket!.readyState).toBe(FakeWebSocket.CLOSED));
  });

  it("destroy() completes when closing the socket throws", async () => {
    const resolver = new BsoResolver({ key: "bso-ws", provider: uniqueProvider(), batch: false });
    await resolver.resolve({ name: "example.bso" });
    const [socket] = FakeWebSocket.instances;
    socket!.close = () => {
      throw new Error("close failed");
    };

    await expect(resolver.destroy()).resolves.toBeUndefined();
    await expect(
      resolver.resolve({ name: "example.bso" })
    ).rejects.toThrow("Cannot resolve after destroy() has been called.");
  });

  it("destroy() during an in-flight request does not open another socket", async () => {
    FakeWebSocket.answer = false;
    const resolver = new BsoResolver({ key: "bso-ws", provider: uniqueProvider(), batch: false });

    const pending = resolver.resolve({ name: "example.bso" });
    await vi.waitFor(() => expect(FakeWebSocket.instances[0]?.ethCalls).toHaveLength(1));

    await resolver.destroy();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    // Longer than viem's first retry delay (150ms)
    await sleep(500);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]!.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it("destroy() inside the batch window opens no socket and sends nothing", async () => {
    const resolver = new BsoResolver({
      key: "bso-ws",
      provider: uniqueProvider(),
      batch: { wait: 100 },
    });

    const pending = resolver.resolve({ name: "example.bso" });
    await resolver.destroy();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    // Longer than the batch window
    await sleep(500);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("destroy() does not wait for a connect in progress, and closes that socket once it opens", async () => {
    FakeWebSocket.autoOpen = false;
    const resolver = new BsoResolver({ key: "bso-ws", provider: uniqueProvider(), batch: false });

    const pending = resolver.resolve({ name: "example.bso" });
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));

    const outcome = await Promise.race([
      resolver.destroy().then(() => "destroyed"),
      sleep(500).then(() => "still waiting"),
    ]);
    expect(outcome).toBe("destroyed");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    const [socket] = FakeWebSocket.instances;
    socket!.open();
    await vi.waitFor(() => expect(socket!.readyState).toBe(FakeWebSocket.CLOSED));
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(socket!.ethCalls).toHaveLength(0);
  });

  it("sends on its own socket when an earlier resolver on the same URL finishes connecting late", async () => {
    // viem caches one socket client per URL. A connect that the destroyed
    // resolver A started finishes after B's, takes over that cache entry and is
    // then closed, which empties it. B must keep using the socket it connected.
    const provider = uniqueProvider();
    FakeWebSocket.autoOpen = false;

    const resolverA = new BsoResolver({ key: "bso-ws", provider, batch: false });
    const pendingA = resolverA.resolve({ name: "a.bso" });
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    await resolverA.destroy();
    await expect(pendingA).rejects.toMatchObject({ name: "AbortError" });

    const resolverB = new BsoResolver({ key: "bso-ws", provider, batch: false });
    const pendingB = resolverB.resolve({ name: "b.bso" });
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
    const [socketA, socketB] = FakeWebSocket.instances;

    socketB!.open();
    await expect(pendingB).resolves.toEqual({ publicKey: VALID_PUBLIC_KEY });

    socketA!.open();
    await vi.waitFor(() => expect(socketA!.readyState).toBe(FakeWebSocket.CLOSED));

    FakeWebSocket.autoOpen = true;
    await expect(resolverB.resolve({ name: "c.bso" })).resolves.toEqual({
      publicKey: VALID_PUBLIC_KEY,
    });

    await resolverB.destroy();
    await vi.waitFor(() =>
      expect(FakeWebSocket.instances.map((socket) => socket.readyState)).toEqual([
        FakeWebSocket.CLOSED,
        FakeWebSocket.CLOSED,
      ])
    );
    expect(socketA!.ethCalls).toHaveLength(0);
    expect(socketB!.ethCalls).toHaveLength(2);
  });

  it("opens a new socket on the next resolve after the server closes the connection", async () => {
    const resolver = new BsoResolver({ key: "bso-ws", provider: uniqueProvider(), batch: false });
    await expect(resolver.resolve({ name: "a.bso" })).resolves.toEqual({
      publicKey: VALID_PUBLIC_KEY,
    });

    FakeWebSocket.instances[0]!.drop();

    await expect(resolver.resolve({ name: "b.bso" })).resolves.toEqual({
      publicKey: VALID_PUBLIC_KEY,
    });
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1]!.ethCalls).toHaveLength(1);

    await resolver.destroy();
    await vi.waitFor(() =>
      expect(FakeWebSocket.instances[1]!.readyState).toBe(FakeWebSocket.CLOSED)
    );
  });
});
