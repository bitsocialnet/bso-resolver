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
}

// --- Utility functions ---

export function isBsoAliasDomain(address: string): boolean {
  const lower = address.toLowerCase();
  return lower.endsWith(".eth") || lower.endsWith(".bso");
}

export function normalizeBsoAliasDomain(address: string): string {
  return address.endsWith(".bso") ? address.slice(0, -4) + ".eth" : address;
}

// --- Main API ---

export function canResolveBso({ name }: CanResolveBsoArgs): boolean {
  return isBsoAliasDomain(name);
}

export async function resolveBso({
  name,
  provider,
}: ResolveBsoArgs): Promise<string | undefined> {
  const resolvedName = name.includes(".") ? name : `${name}.bso`;

  if (!isBsoAliasDomain(resolvedName)) {
    throw new Error(`Unsupported TLD in "${name}". Only .bso and .eth domains are supported.`);
  }

  const ethName = normalizeBsoAliasDomain(resolvedName);
  const normalized = normalize(ethName);

  const transport =
    provider === "viem" ? http() : http(provider);

  const client = createPublicClient({
    chain: mainnet,
    transport,
  });

  try {
    const result = await client.getEnsText({
      name: normalized,
      key: "bitsocial",
    });

    return result ?? undefined;
  } catch (error) {
    if (error instanceof Error) {
      (error as any).details = { name, resolvedName, provider, ethName, normalized, chain: "mainnet" };
    }
    throw error;
  }
}
