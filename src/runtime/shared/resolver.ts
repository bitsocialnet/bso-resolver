import Logger from "@pkcprotocol/pkc-logger";
import type { NameResolverInterface } from "@pkcprotocol/pkc-js";
import { createPublicClient, http, webSocket, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";

const log = Logger("bitsocial:bso-resolver");

export interface CanResolveBsoArgs {
  name: string;
}

export interface BsoResolveResult {
  publicKey: string;
  [key: string]: string;
}

export interface BsoResolverBatchOptions {
  /** Milliseconds to wait for more concurrent resolves before flushing the
   *  batch as a single Multicall3.aggregate3 eth_call. Same semantics as
   *  viem's `batch.multicall.wait`. */
  wait?: number;
  /** Maximum calldata size (in bytes) of a batched call before it is split.
   *  Same semantics as viem's `batch.multicall.batchSize`. Each resolve is
   *  ~500-600 bytes, so viem's default of 1024 would split after ~2 calls. */
  batchSize?: number;
}

export const DEFAULT_BATCH_OPTIONS: Required<BsoResolverBatchOptions> = {
  wait: 200,
  batchSize: 100_000,
};

export interface BsoResolverArgs {
  key: string;
  provider: string;
  /** Batch concurrent resolves into a single Multicall3.aggregate3 eth_call.
   *  Defaults to `DEFAULT_BATCH_OPTIONS`. Pass `false` to disable batching,
   *  or `{ wait: 0 }` to only coalesce same-tick bursts. */
  batch?: false | BsoResolverBatchOptions;
}

export interface ResolverRuntime {
  createClient(
    provider: string,
    destroySignal: AbortSignal,
    batch?: false | BsoResolverBatchOptions
  ): PublicClient;
}

export function isBsoAliasDomain(address: string): boolean {
  const lower = address.toLowerCase();
  return lower.endsWith(".eth") || lower.endsWith(".bso");
}

export function normalizeBsoAliasDomain(address: string): string {
  return address.endsWith(".bso") ? address.slice(0, -4) + ".eth" : address;
}

function createAbortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(abortSignal?: AbortSignal): void {
  if (abortSignal?.aborted) {
    throw createAbortError();
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isWebSocketUrl(url: string): boolean {
  return url.startsWith("ws://") || url.startsWith("wss://");
}

function isValidIpnsPublicKey(value: string): boolean {
  const base58Value = value.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(base58Value)) {
    return false;
  }

  if (base58Value.startsWith("12D3Koo")) {
    return base58Value.length === 52;
  }

  if (base58Value.startsWith("Qm")) {
    return base58Value.length === 46;
  }

  return false;
}

function parseBitsocialTxtRecord(record: string): BsoResolveResult {
  const segments = record.split(";").map((segment) => segment.trim());
  const firstSegment = segments[0];
  if (!firstSegment) {
    throw new Error("Invalid bitsocial TXT record: missing publicKey.");
  }

  if (!isValidIpnsPublicKey(firstSegment)) {
    throw new Error(
      "Invalid bitsocial TXT record: expected a valid IPNS public key as the first segment."
    );
  }

  const parsed: BsoResolveResult = {
    publicKey: firstSegment,
  };

  for (const segment of segments.slice(1)) {
    const separatorIndex = segment.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(
        `Invalid bitsocial TXT record: expected "key=value" segment, received "${segment}".`
      );
    }

    const key = segment.slice(0, separatorIndex).trim();
    if (!key) {
      throw new Error("Invalid bitsocial TXT record: metadata key cannot be empty.");
    }

    if (key === "publicKey") {
      throw new Error(`Invalid bitsocial TXT record: "${key}" suffix key is not allowed.`);
    }

    const value = segment.slice(separatorIndex + 1).trim();
    parsed[key] = value;
  }

  return parsed;
}

async function withAbortSignal<T>(
  promise: Promise<T>,
  abortSignal?: AbortSignal
): Promise<T> {
  if (!abortSignal) {
    return promise;
  }

  throwIfAborted(abortSignal);

  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(createAbortError());
    };

    abortSignal.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (result) => {
        abortSignal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error) => {
        abortSignal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

async function resolveWithClient({
  client,
  name,
  blockNumber,
}: {
  client: PublicClient;
  name: string;
  blockNumber?: bigint | undefined;
}): Promise<BsoResolveResult | undefined> {
  const resolvedName = name.includes(".") ? name : `${name}.bso`;

  if (!isBsoAliasDomain(resolvedName)) {
    throw new Error(`Unsupported TLD in "${name}". Only .bso and .eth domains are supported.`);
  }

  const ethName = normalizeBsoAliasDomain(resolvedName);
  const normalized = normalize(ethName);

  try {
    const result = await client.getEnsText({
      name: normalized,
      key: "bitsocial",
      ...(blockNumber !== undefined ? { blockNumber } : {}),
    });

    if (result == null) {
      return undefined;
    }

    return parseBitsocialTxtRecord(result);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    if (error instanceof Error) {
      (error as any).details = { name, resolvedName, ethName, normalized, blockNumber, chain: "mainnet" };
    }
    throw error;
  }
}

class ResolverRuntimeImpl implements ResolverRuntime {
  createClient(
    provider: string,
    destroySignal: AbortSignal,
    batch?: false | BsoResolverBatchOptions
  ): PublicClient {
    const url = provider === "viem" ? undefined : provider;
    let transport;

    if (url && isWebSocketUrl(url)) {
      transport = webSocket(url, { reconnect: false });
    } else {
      transport = http(url, { fetchOptions: { signal: destroySignal } });
    }

    return createPublicClient({
      chain: mainnet,
      transport,
      ...(batch === false
        ? {}
        : { batch: { multicall: { ...DEFAULT_BATCH_OPTIONS, ...batch } } }),
    });
  }
}

export function createResolverRuntime(): ResolverRuntime {
  return new ResolverRuntimeImpl();
}

export function canResolveBso({ name }: CanResolveBsoArgs): boolean {
  return isBsoAliasDomain(name);
}

export abstract class BaseBsoResolver implements NameResolverInterface {
  readonly key: string;
  readonly provider: string;

  private readonly runtime: ResolverRuntime;
  private readonly batch: false | BsoResolverBatchOptions | undefined;
  private readonly _destroyController = new AbortController();
  private _client: PublicClient | null = null;
  private _initialized = false;
  private _destroyed = false;

  protected constructor({ key, provider, batch }: BsoResolverArgs, runtime: ResolverRuntime) {
    this.key = key;
    this.provider = provider;
    this.batch = batch;
    this.runtime = runtime;
  }

  canResolve({ name }: CanResolveBsoArgs): boolean {
    return canResolveBso({ name });
  }

  async resolve({
    name,
    blockNumber,
    abortSignal,
  }: {
    name: string;
    blockNumber?: bigint;
    abortSignal?: AbortSignal;
  }): Promise<BsoResolveResult | undefined> {
    if (this._destroyed) {
      throw new Error("Cannot resolve after destroy() has been called.");
    }

    if (!this._initialized) {
      this._client = this.runtime.createClient(
        this.provider,
        this._destroyController.signal,
        this.batch
      );
      this._initialized = true;
    }

    const combinedSignal = abortSignal
      ? AbortSignal.any([this._destroyController.signal, abortSignal])
      : this._destroyController.signal;

    try {
      return await withAbortSignal(
        resolveWithClient({ client: this._client!, name, blockNumber }),
        combinedSignal
      );
    } catch (error) {
      if (error instanceof Error && (error as any).details) {
        (error as any).details.provider = this.provider;
      }
      log.trace(
        `Failed to resolve "${name}" with provider "${this.provider}": ${error instanceof Error ? error.message : error}`
      );
      throw error;
    }
  }

  async destroy(): Promise<void> {
    if (!this._initialized || this._destroyed) return;
    this._destroyed = true;

    // Abort all in-flight resolves and cancel HTTP fetches via transport signal
    this._destroyController.abort();

    // Close WebSocket connection if applicable
    try {
      if (this._client?.transport?.type === "webSocket") {
        const rpcClient = await (this._client.transport as any).getRpcClient();
        rpcClient.close();
      }
    } catch (error) {
      log.error(
        `Failed to close WebSocket for provider "${this.provider}": ${error instanceof Error ? error.message : error}`
      );
    }

    this._client = null;
  }
}
