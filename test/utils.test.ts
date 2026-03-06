import { describe, it, expect } from "vitest";
import {
  isEthAliasDomain,
  normalizeEthAliasDomain,
  canResolveBso,
} from "../src/index.js";

describe("isEthAliasDomain", () => {
  it("returns true for .eth domains", () => {
    expect(isEthAliasDomain("example.eth")).toBe(true);
  });

  it("returns true for .bso domains", () => {
    expect(isEthAliasDomain("example.bso")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isEthAliasDomain("example.ETH")).toBe(true);
    expect(isEthAliasDomain("example.BSO")).toBe(true);
    expect(isEthAliasDomain("example.Eth")).toBe(true);
  });

  it("returns false for .com domains", () => {
    expect(isEthAliasDomain("example.com")).toBe(false);
  });

  it("returns false for .sol domains", () => {
    expect(isEthAliasDomain("example.sol")).toBe(false);
  });

  it("returns false for strings without a dot", () => {
    expect(isEthAliasDomain("example")).toBe(false);
  });
});

describe("normalizeEthAliasDomain", () => {
  it("converts .bso to .eth", () => {
    expect(normalizeEthAliasDomain("example.bso")).toBe("example.eth");
  });

  it("leaves .eth unchanged", () => {
    expect(normalizeEthAliasDomain("example.eth")).toBe("example.eth");
  });

  it("handles subdomains", () => {
    expect(normalizeEthAliasDomain("sub.example.bso")).toBe("sub.example.eth");
  });

  it("does not replace .bso in the middle of a name", () => {
    expect(normalizeEthAliasDomain("bso.example.eth")).toBe("bso.example.eth");
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
