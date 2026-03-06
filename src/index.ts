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

export function normalizeEthAliasDomain(address: string): string {
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
  const ethName = normalizeEthAliasDomain(name);
  const normalized = normalize(ethName);

  const transport =
    provider === "viem" ? http() : http(provider);

  const client = createPublicClient({
    chain: mainnet,
    transport,
  });

  const result = await client.getEnsText({
    name: normalized,
    key: "bitsocial",
  });

  return result ?? undefined;
}
