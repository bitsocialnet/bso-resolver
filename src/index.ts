import { createPublicClient, http, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import { createCache, isCacheStale, type ResolverCache } from "./cache.js";

// --- Types ---

export type { CacheEntry, ResolverCache } from "./cache.js";

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

// --- Utility functions ---

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

// --- Core resolution (uses provided client) ---

async function resolveWithClient({
  client,
  name,
  abortSignal,
}: {
  client: PublicClient;
  name: string;
  abortSignal?: AbortSignal;
}): Promise<BsoResolveResult | undefined> {
  const resolvedName = name.includes(".") ? name : `${name}.bso`;

  if (!isBsoAliasDomain(resolvedName)) {
    throw new Error(`Unsupported TLD in "${name}". Only .bso and .eth domains are supported.`);
  }

  const ethName = normalizeBsoAliasDomain(resolvedName);
  const normalized = normalize(ethName);

  throwIfAborted(abortSignal);

  try {
    const result = await withAbortSignal(
      client.getEnsText({
        name: normalized,
        key: "bitsocial",
      }),
      abortSignal
    );

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

// --- Singleton registries (module-private) ---

interface ClientRegistryEntry {
  client: PublicClient;
  refCount: number;
}

interface CacheRegistryEntry {
  cachePromise: Promise<ResolverCache>;
  refCount: number;
}

const clientRegistry = new Map<string, ClientRegistryEntry>();
const cacheRegistry = new Map<string, CacheRegistryEntry>();

function cacheRegistryKey(dataPath?: string): string {
  if (dataPath) return `sqlite:${dataPath}`;
  if (typeof indexedDB !== "undefined") return "indexeddb";
  return "memory";
}

function acquireClient(provider: string): PublicClient {
  const existing = clientRegistry.get(provider);
  if (existing) {
    existing.refCount++;
    return existing.client;
  }
  const transport = provider === "viem" ? http() : http(provider);
  const client = createPublicClient({ chain: mainnet, transport });
  clientRegistry.set(provider, { client, refCount: 1 });
  return client;
}

function releaseClient(provider: string): void {
  const entry = clientRegistry.get(provider);
  if (!entry) return;
  entry.refCount--;
  if (entry.refCount <= 0) {
    clientRegistry.delete(provider);
  }
}

function acquireCache(dataPath?: string): Promise<ResolverCache> {
  const key = cacheRegistryKey(dataPath);
  const existing = cacheRegistry.get(key);
  if (existing) {
    existing.refCount++;
    return existing.cachePromise;
  }
  const cachePromise = createCache({ dataPath });
  cacheRegistry.set(key, { cachePromise, refCount: 1 });
  return cachePromise;
}

async function releaseCache(dataPath?: string): Promise<void> {
  const key = cacheRegistryKey(dataPath);
  const entry = cacheRegistry.get(key);
  if (!entry) return;
  entry.refCount--;
  if (entry.refCount <= 0) {
    cacheRegistry.delete(key);
    const cache = await entry.cachePromise;
    await cache.destroy();
  }
}

/** @internal — for testing only */
export function _resetRegistries(): void {
  clientRegistry.clear();
  cacheRegistry.clear();
}

// --- Main API ---

export function canResolveBso({ name }: CanResolveBsoArgs): boolean {
  return isBsoAliasDomain(name);
}

/**
 * BSO name resolver with shared viem client and persistent cache.
 *
 * Resources (viem client, cache/DB connection) are lazily initialized on the
 * first `resolve()` call and shared across instances with the same `provider`
 * or `dataPath` via internal reference-counted registries.
 *
 * Call `destroy()` when done to release resources. The underlying client or
 * DB connection is only closed when the last resolver using it is destroyed.
 */
export class BsoResolver {
  readonly key: string;
  readonly provider: string;
  readonly dataPath: string | undefined;

  private _client: PublicClient | null = null;
  private _cachePromise: Promise<ResolverCache> | null = null;
  private _initialized = false;
  private _destroyed = false;

  constructor({ key, provider, dataPath }: BsoResolverArgs) {
    this.key = key;
    this.provider = provider;
    this.dataPath = dataPath;
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

    // Lazy acquisition of shared resources on first call
    if (!this._initialized) {
      this._client = acquireClient(this.provider);
      this._cachePromise = acquireCache(this.dataPath);
      this._initialized = true;
    }

    const cache = await this._cachePromise!;

    // Check cache
    const cached = await cache.get(name);
    if (cached && !isCacheStale(cached)) {
      return cached.value as BsoResolveResult;
    }

    // Resolve using shared client
    try {
      const result = await resolveWithClient({ client: this._client!, name, abortSignal });

      // Store in cache
      if (result) {
        await cache.set(name, { value: result, timestampMs: Date.now() });
      }

      return result;
    } catch (error) {
      if (error instanceof Error && (error as any).details) {
        (error as any).details.provider = this.provider;
      }
      throw error;
    }
  }

  async destroy(): Promise<void> {
    if (!this._initialized || this._destroyed) return;
    this._destroyed = true;

    releaseClient(this.provider);
    await releaseCache(this.dataPath);

    this._client = null;
    this._cachePromise = null;
  }
}
