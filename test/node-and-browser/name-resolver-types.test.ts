import { expectTypeOf, test } from "vitest";
import type { Logger as PkcJsLogger, NameResolverInterface } from "@pkcprotocol/pkc-js";
import { BsoResolver } from "../../src/index.js";

test("BsoResolver structurally satisfies pkc-js NameResolverInterface", () => {
  expectTypeOf<BsoResolver>().toExtend<NameResolverInterface>();
});

test("the Logger pkc-js passes is accepted as resolve()/destroy() log", () => {
  type ResolveLog = Parameters<BsoResolver["resolve"]>[0]["log"];
  type DestroyLog = Parameters<BsoResolver["destroy"]>[0]["log"];
  expectTypeOf<PkcJsLogger>().toExtend<ResolveLog>();
  expectTypeOf<PkcJsLogger>().toExtend<DestroyLog>();
});

test("log is required in resolve() and destroy()", () => {
  type ResolveArgs = Parameters<BsoResolver["resolve"]>[0];
  type DestroyArgs = Parameters<BsoResolver["destroy"]>[0];
  expectTypeOf<{ name: string }>().not.toExtend<ResolveArgs>();
  expectTypeOf<{}>().not.toExtend<DestroyArgs>();
});
