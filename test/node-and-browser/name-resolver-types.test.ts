import { expectTypeOf, test } from "vitest";
import type { NameResolverInterface } from "@pkcprotocol/pkc-js";
import { BsoResolver } from "../../src/index.js";

test("BsoResolver structurally satisfies pkc-js NameResolverInterface", () => {
  expectTypeOf<BsoResolver>().toExtend<NameResolverInterface>();
});
