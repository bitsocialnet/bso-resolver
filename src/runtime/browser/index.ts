import {
  BaseBsoResolver,
  createResolverRuntime,
  type BsoResolverArgs,
} from "../shared/resolver.js";

export type { BsoResolveResult, BsoResolverArgs } from "../shared/resolver.js";

const runtime = createResolverRuntime();

export class BsoResolver extends BaseBsoResolver {
  constructor(args: BsoResolverArgs) {
    super(args, runtime);
  }
}
