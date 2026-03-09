import { createCache, isCacheStale } from "./cache.js";
import {
  BaseBsoResolver,
  createResolverRuntime,
  canResolveBso,
  isBsoAliasDomain,
  normalizeBsoAliasDomain,
  type BsoResolverArgs,
} from "../shared/resolver.js";

export type {
  BsoResolveResult,
  BsoResolverArgs,
  CanResolveBsoArgs,
} from "../shared/resolver.js";
export type { CacheEntry, ResolverCache } from "../shared/cache.js";

const runtime = createResolverRuntime({ createCache, isCacheStale });

export function _resetRegistries(): void {
  runtime.resetRegistries();
}

export class BsoResolver extends BaseBsoResolver {
  constructor(args: BsoResolverArgs) {
    super(args, runtime);
  }
}

export { canResolveBso };
export { isBsoAliasDomain, normalizeBsoAliasDomain };
