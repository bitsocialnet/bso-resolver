import Logger from "@pkcprotocol/pkc-logger";
import { createPublicClient, http, webSocket, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import type { CacheEntry, ResolverCache } from "./cache.js";

const log = Logger("bitsocial:bso-resolver");

export interface CanResolveBsoArgs {
  name: string;
}

export interface BsoResolveResult {
  publicKey: string;
  [key: string]: string;
}

export interface BsoResolverArgs {
  key: string;
  provider: string;
  dataPath?: string;
}

export interface ResolverBindings {
  createCache(args?: { dataPath?: string }): Promise<ResolverCache>;
  isCacheStale(entry: CacheEntry, ttlMs?: number): boolean;
}

export interface ResolverRuntime {
  createClient(provider: string, destroySignal: AbortSignal): PublicClient;
  acquireCache(dataPath?: string): Promise<ResolverCache>;
  releaseCache(dataPath?: string): Promise<void>;
  isCacheStale(entry: CacheEntry, ttlMs?: number): boolean;
  resetRegistries(): void;
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
      throw new Error('Invalid bitsocial TXT record: "publicKey" suffix key is not allowed.');
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
}: {
  client: PublicClient;
  name: string;
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
      (error as any).details = { name, resolvedName, ethName, normalized, chain: "mainnet" };
    }
    throw error;
  }
}

interface CacheRegistryEntry {
  cachePromise: Promise<ResolverCache>;
  refCount: number;
}

class ResolverRuntimeImpl implements ResolverRuntime {
  private readonly _createCache: ResolverBindings["createCache"];
  readonly isCacheStale: ResolverBindings["isCacheStale"];
  private readonly cacheRegistry = new Map<string, CacheRegistryEntry>();

  constructor({ createCache, isCacheStale }: ResolverBindings) {
    this._createCache = createCache;
    this.isCacheStale = isCacheStale;
  }

  createClient(provider: string, destroySignal: AbortSignal): PublicClient {
    const url = provider === "viem" ? undefined : provider;
    let transport;

    if (url && isWebSocketUrl(url)) {
      transport = webSocket(url, { reconnect: false });
    } else {
      transport = http(url, { fetchOptions: { signal: destroySignal } });
    }

    return createPublicClient({ chain: mainnet, transport });
  }

  acquireCache(dataPath?: string): Promise<ResolverCache> {
    const key = this.cacheRegistryKey(dataPath);
    const existing = this.cacheRegistry.get(key);
    if (existing) {
      existing.refCount++;
      return existing.cachePromise;
    }
    const cachePromise = this._createCache({ dataPath });
    this.cacheRegistry.set(key, { cachePromise, refCount: 1 });
    return cachePromise;
  }

  async releaseCache(dataPath?: string): Promise<void> {
    const key = this.cacheRegistryKey(dataPath);
    const entry = this.cacheRegistry.get(key);
    if (!entry) return;
    entry.refCount--;
    if (entry.refCount <= 0) {
      this.cacheRegistry.delete(key);
      const cache = await entry.cachePromise;
      await cache.destroy();
    }
  }

  resetRegistries(): void {
    this.cacheRegistry.clear();
  }

  private cacheRegistryKey(dataPath?: string): string {
    if (dataPath) return `sqlite:${dataPath}`;
    if (typeof indexedDB !== "undefined") return "indexeddb";
    return "memory";
  }
}

export function createResolverRuntime(bindings: ResolverBindings): ResolverRuntime {
  return new ResolverRuntimeImpl(bindings);
}

export function canResolveBso({ name }: CanResolveBsoArgs): boolean {
  return isBsoAliasDomain(name);
}

export abstract class BaseBsoResolver {
  readonly key: string;
  readonly provider: string;
  readonly dataPath: string | undefined;

  private readonly runtime: ResolverRuntime;
  private readonly _destroyController = new AbortController();
  private _client: PublicClient | null = null;
  private _cachePromise: Promise<ResolverCache> | null = null;
  private _initialized = false;
  private _destroyed = false;
  private _pendingResolves = new Map<string, Promise<BsoResolveResult | undefined>>();

  protected constructor({ key, provider, dataPath }: BsoResolverArgs, runtime: ResolverRuntime) {
    this.key = key;
    this.provider = provider;
    this.dataPath = dataPath;
    this.runtime = runtime;
  }

  canResolve({ name }: CanResolveBsoArgs): boolean {
    return canResolveBso({ name });
  }

  async resolve({
    name,
    abortSignal,
  }: {
    name: string;
    abortSignal?: AbortSignal;
  }): Promise<BsoResolveResult | undefined> {
    if (this._destroyed) {
      throw new Error("Cannot resolve after destroy() has been called.");
    }

    if (!this._initialized) {
      this._client = this.runtime.createClient(this.provider, this._destroyController.signal);
      this._cachePromise = this.runtime.acquireCache(this.dataPath);
      this._initialized = true;
    }

    const cache = await this._cachePromise!;

    // Re-check after await — destroy() may have been called while waiting for the cache
    if (this._destroyed) {
      throw createAbortError();
    }

    const cached = await cache.get(name);

    if (cached) {
      if (!this.runtime.isCacheStale(cached)) {
        return cached.value as BsoResolveResult;
      }
      // stale — return immediately, refresh in background (no user abort signal)
      this._resolveAndCache(cache, name).catch(() => {});
      return cached.value as BsoResolveResult;
    }

    // no cache at all — must block and wait
    const sharedPromise = this._resolveAndCache(cache, name);

    // Wrap with combined signal so this caller can be aborted independently
    const combinedSignal = abortSignal
      ? AbortSignal.any([this._destroyController.signal, abortSignal])
      : this._destroyController.signal;

    return await withAbortSignal(sharedPromise, combinedSignal);
  }

  private _resolveAndCache(
    cache: ResolverCache,
    name: string,
  ): Promise<BsoResolveResult | undefined> {
    const existing = this._pendingResolves.get(name);
    if (existing) return existing;

    const promise = resolveWithClient({ client: this._client!, name })
      .then(async (result) => {
        if (result) {
          await cache.set(name, { value: result, timestampMs: Date.now() });
        }
        return result;
      })
      .catch((error) => {
        if (error instanceof Error && (error as any).details) {
          (error as any).details.provider = this.provider;
        }
        log.error(
          `Failed to resolve "${name}" with provider "${this.provider}": ${error instanceof Error ? error.message : error}`
        );
        throw error;
      })
      .finally(() => {
        this._pendingResolves.delete(name);
      });

    this._pendingResolves.set(name, promise);
    return promise;
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

    await this.runtime.releaseCache(this.dataPath);

    this._client = null;
    this._cachePromise = null;
  }
}
