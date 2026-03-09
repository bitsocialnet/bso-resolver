import { createPublicClient, http, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import { createCache, isCacheStale, type ResolverCache } from "./cache.js";

// --- Types ---

export type { CacheEntry, ResolverCache } from "./cache.js";

export interface CanResolveBsoArgs {
  name: string;
}

export interface ResolveBsoArgs {
  name: string;
  provider: string;
  abortSignal?: AbortSignal;
}

export interface BsoResolveResult {
  publicKey: string;
  [key: string]: string;
}

export interface CreateBsoResolverArgs {
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

// --- Main API ---

export function canResolveBso({ name }: CanResolveBsoArgs): boolean {
  return isBsoAliasDomain(name);
}

/**
 * Stateless resolution — creates a fresh viem client per call, no caching.
 * Use `createBsoResolver` for a stateful resolver with caching and singleton client.
 */
export async function resolveBso({
  name,
  provider,
  abortSignal,
}: ResolveBsoArgs): Promise<BsoResolveResult | undefined> {
  throwIfAborted(abortSignal);

  const transport = provider === "viem"
    ? abortSignal
      ? http(undefined, { fetchOptions: { signal: abortSignal } })
      : http()
    : abortSignal
      ? http(provider, { fetchOptions: { signal: abortSignal } })
      : http(provider);

  const client = createPublicClient({
    chain: mainnet,
    transport,
  });

  try {
    return await resolveWithClient({ client, name, abortSignal });
  } catch (error) {
    if (error instanceof Error && (error as any).details) {
      (error as any).details.provider = provider;
    }
    throw error;
  }
}

/**
 * Creates a stateful BSO resolver with a singleton viem client and in-memory cache.
 * Both the client and cache are lazily initialized on the first `resolve()` call
 * and persist for the lifetime of the resolver.
 *
 * Returns an object compatible with plebbit-js's NameResolverSchema.
 */
export function createBsoResolver({ provider, dataPath }: CreateBsoResolverArgs) {
  let client: PublicClient | null = null;
  let cachePromise: Promise<ResolverCache> | null = null;

  return {
    key: "bso-resolver",
    provider,
    dataPath,
    canResolve: ({ name }: CanResolveBsoArgs) => canResolveBso({ name }),
    resolve: async ({ name, abortSignal }: { name: string; provider: string; abortSignal?: AbortSignal }) => {
      // Lazy init singletons on first call
      if (!client) {
        const transport = provider === "viem" ? http() : http(provider);
        client = createPublicClient({ chain: mainnet, transport });
      }
      if (!cachePromise) {
        cachePromise = createCache({ dataPath });
      }
      const cache = await cachePromise;

      // Check cache
      const cached = await cache.get(name);
      if (cached && !isCacheStale(cached)) {
        return cached.value;
      }

      // Resolve using singleton client
      const result = await resolveWithClient({ client, name, abortSignal });

      // Store in cache
      if (result) {
        await cache.set(name, { value: result, timestampMs: Date.now() });
      }

      return result;
    },
  };
}
