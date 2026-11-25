import { describe, it, expect } from "vitest";
import { namehash, normalize } from "viem/ens";
import {
  BSO_REGISTRY,
  isBsoName,
  canResolveBso,
} from "../../src/runtime/shared/resolver.js";

describe("isBsoName", () => {
  it("returns true for .bso names", () => {
    expect(isBsoName("example.bso")).toBe(true);
    expect(isBsoName("sub.example.bso")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isBsoName("example.BSO")).toBe(true);
    expect(isBsoName("example.Bso")).toBe(true);
  });

  it("returns false for other TLDs", () => {
    expect(isBsoName("example.eth")).toBe(false);
    expect(isBsoName("example.com")).toBe(false);
    expect(isBsoName("example.sol")).toBe(false);
    expect(isBsoName("bso.example.eth")).toBe(false);
  });

  it("returns false for strings without a dot", () => {
    expect(isBsoName("example")).toBe(false);
    expect(isBsoName("bso")).toBe(false);
  });
});

describe("canResolveBso", () => {
  it("returns true for .bso names", () => {
    expect(canResolveBso({ name: "example.bso" })).toBe(true);
  });

  it("returns false for other names", () => {
    expect(canResolveBso({ name: "example.eth" })).toBe(false);
    expect(canResolveBso({ name: "example.com" })).toBe(false);
    expect(canResolveBso({ name: "example.sol" })).toBe(false);
    expect(canResolveBso({ name: "example" })).toBe(false);
  });
});

describe("BSIP-13 node vectors", () => {
  it("matches the BSIP-13 example for memes.bso", () => {
    expect(namehash(normalize("memes.bso"))).toBe(
      "0x32766e8bc53e343c21d132d673d112b27f0e1aa11965199b934d29721837a941"
    );
  });
});

describe("BSO_REGISTRY", () => {
  // The registry is not deployed on mainnet yet, so this branch points at the
  // Sepolia deployment. Remove `.fails` in the commit that switches
  // BSO_REGISTRY to mainnet: until then this expected failure is the reminder
  // that the package must not be released.
  it.fails("points at the mainnet registry", () => {
    expect(BSO_REGISTRY.chain.id).toBe(1);
  });
});
