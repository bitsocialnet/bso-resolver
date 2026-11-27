import { vi, type Mock } from "vitest";
import type { Logger } from "@pkcprotocol/pkc-logger";

export type TestLog = Logger & { trace: Mock; error: Mock };

/** Spy stand-in for the `log` pkc-js passes to `resolve()` and `destroy()`. */
export function createTestLog(): TestLog {
  const log = vi.fn() as unknown as TestLog;
  Object.assign(log, {
    trace: vi.fn(),
    error: vi.fn(),
    namespace: "test",
    tags: Object.freeze({}),
    setTags: vi.fn(),
    child: vi.fn(() => log),
    getLogs: vi.fn(() => ({ entries: [] })),
    addListener: vi.fn(() => () => {}),
    removeListener: vi.fn(),
  });
  return log;
}
