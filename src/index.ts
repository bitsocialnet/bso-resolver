import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";

// --- Types ---

export interface CanResolveBsoArgs {
  name: string;
}

export interface ResolveBsoArgs {
  name: string;
  provider: string;
  abortSignal?: AbortSignal;
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

// --- Main API ---

export function canResolveBso({ name }: CanResolveBsoArgs): boolean {
  return isBsoAliasDomain(name);
}

export async function resolveBso({
  name,
  provider,
  abortSignal,
}: ResolveBsoArgs): Promise<string | undefined> {
  const resolvedName = name.includes(".") ? name : `${name}.bso`;

  if (!isBsoAliasDomain(resolvedName)) {
    throw new Error(`Unsupported TLD in "${name}". Only .bso and .eth domains are supported.`);
  }

  const ethName = normalizeBsoAliasDomain(resolvedName);
  const normalized = normalize(ethName);

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
    const result = await withAbortSignal(
      client.getEnsText({
        name: normalized,
        key: "bitsocial",
      }),
      abortSignal
    );

    return result ?? undefined;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    if (error instanceof Error) {
      (error as any).details = { name, resolvedName, provider, ethName, normalized, chain: "mainnet" };
    }
    throw error;
  }
}
