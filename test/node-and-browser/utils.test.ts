import { describe, it, expect } from "vitest";
import {
  isBsoAliasDomain,
  normalizeBsoAliasDomain,
  canResolveBso,
} from "@bitsocial/bso-resolver";

describe("isBsoAliasDomain", () => {
  it("returns true for .eth domains", () => {
    expect(isBsoAliasDomain("example.eth")).toBe(true);
  });

  it("returns true for .bso domains", () => {
    expect(isBsoAliasDomain("example.bso")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isBsoAliasDomain("example.ETH")).toBe(true);
    expect(isBsoAliasDomain("example.BSO")).toBe(true);
    expect(isBsoAliasDomain("example.Eth")).toBe(true);
  });

  it("returns false for .com domains", () => {
    expect(isBsoAliasDomain("example.com")).toBe(false);
  });

  it("returns false for .sol domains", () => {
    expect(isBsoAliasDomain("example.sol")).toBe(false);
  });

  it("returns false for strings without a dot", () => {
    expect(isBsoAliasDomain("example")).toBe(false);
  });
});

describe("normalizeBsoAliasDomain", () => {
  it("converts .bso to .eth", () => {
    expect(normalizeBsoAliasDomain("example.bso")).toBe("example.eth");
  });

  it("leaves .eth unchanged", () => {
    expect(normalizeBsoAliasDomain("example.eth")).toBe("example.eth");
  });

  it("handles subdomains", () => {
    expect(normalizeBsoAliasDomain("sub.example.bso")).toBe("sub.example.eth");
  });

  it("does not replace .bso in the middle of a name", () => {
    expect(normalizeBsoAliasDomain("bso.example.eth")).toBe("bso.example.eth");
  });
});

describe("canResolveBso", () => {
  it("returns true for .bso names", () => {
    expect(canResolveBso({ name: "example.bso" })).toBe(true);
  });

  it("returns true for .eth names", () => {
    expect(canResolveBso({ name: "example.eth" })).toBe(true);
  });

  it("returns false for other names", () => {
    expect(canResolveBso({ name: "example.com" })).toBe(false);
    expect(canResolveBso({ name: "example.sol" })).toBe(false);
    expect(canResolveBso({ name: "example" })).toBe(false);
  });
});
