import { describe, it, expect, vi, afterEach } from "vitest";
import { BsoResolver } from "@bitsocial/bso-resolver";

// Uses the real viem client against a stubbed fetch that never answers: each
// request settles only when the signal fetch receives is aborted, like a
// provider that accepts the connection and then goes silent.

function stubSilentProvider(): AbortSignal[] {
  const signals: AbortSignal[] = [];

  vi.stubGlobal("fetch", (_url: unknown, init?: RequestInit) => {
    const signal = init?.signal;
    if (!signal) {
      throw new Error("fetch was called without a signal");
    }
    signals.push(signal);

    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });

  return signals;
}

describe("BsoResolver HTTP transport (real viem client)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fails with viem's request timeout when the provider never answers", async () => {
    vi.useFakeTimers();
    const signals = stubSilentProvider();
    const resolver = new BsoResolver({ key: "bso-http", provider: "https://rpc.silent.test" });

    let outcome: unknown = "pending";
    resolver.resolve({ name: "example.bso" }).then(
      (result) => { outcome = result; },
      (error) => { outcome = error; }
    );

    // 200ms batch window, then 4 attempts (1 + 3 retries) of viem's 10s
    // timeout with 150/300/600ms backoff in between.
    await vi.advanceTimersByTimeAsync(45_000);

    expect(signals).toHaveLength(4);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toContain("The request took too long to respond.");

    await resolver.destroy();
  });

  it("destroy() aborts an in-flight request", async () => {
    const signals = stubSilentProvider();
    const resolver = new BsoResolver({
      key: "bso-http",
      provider: "https://rpc.silent.test",
      batch: false,
    });

    const pending = resolver.resolve({ name: "example.bso" });
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0]!.aborted).toBe(false);

    await resolver.destroy();

    expect(signals[0]!.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
