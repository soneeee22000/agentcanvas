import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMITS,
  checkRunLimits,
  clientKey,
  createRateLimiter,
} from "./guards.js";
import type { RunRequest } from "./agent/schema.js";

const WINDOW_MS = 60_000;

function request(nodeCount: number, edgeCount = 0, input = "q"): RunRequest {
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: `n${index}`,
    kind: "agent" as const,
    label: `n${index}`,
    config: {},
  }));
  const edges = Array.from({ length: edgeCount }, (_, index) => ({
    id: `e${index}`,
    source: "n0",
    target: "n1",
  }));
  return { graph: { nodes, edges }, input };
}

describe("createRateLimiter", () => {
  it("allows up to the limit inside one window, then refuses with a retry delay", () => {
    let now = 0;
    const limiter = createRateLimiter({
      limit: 2,
      windowMs: WINDOW_MS,
      now: () => now,
    });
    expect(limiter.check("1.1.1.1").allowed).toBe(true);
    expect(limiter.check("1.1.1.1").allowed).toBe(true);
    now = 15_000;
    const refused = limiter.check("1.1.1.1");
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(45);
  });

  it("counts each client separately", () => {
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: WINDOW_MS,
      now: () => 0,
    });
    expect(limiter.check("1.1.1.1").allowed).toBe(true);
    expect(limiter.check("2.2.2.2").allowed).toBe(true);
    expect(limiter.check("1.1.1.1").allowed).toBe(false);
  });

  it("opens a fresh window once the previous one has elapsed", () => {
    let now = 0;
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: WINDOW_MS,
      now: () => now,
    });
    expect(limiter.check("1.1.1.1").allowed).toBe(true);
    now = WINDOW_MS;
    expect(limiter.check("1.1.1.1").allowed).toBe(true);
  });

  it("forgets expired clients so memory does not grow without bound", () => {
    let now = 0;
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: WINDOW_MS,
      now: () => now,
    });
    limiter.check("1.1.1.1");
    limiter.check("2.2.2.2");
    now = WINDOW_MS * 2;
    limiter.check("3.3.3.3");
    expect(limiter.size()).toBe(1);
  });
});

describe("clientKey", () => {
  it("prefers x-real-ip", () => {
    const headers = new Headers({
      "x-real-ip": "9.9.9.9",
      "x-forwarded-for": "1.1.1.1, 2.2.2.2",
    });
    expect(clientKey(headers)).toBe("9.9.9.9");
  });

  it("falls back to the first x-forwarded-for hop", () => {
    const headers = new Headers({ "x-forwarded-for": " 1.1.1.1 , 2.2.2.2" });
    expect(clientKey(headers)).toBe("1.1.1.1");
  });

  it("groups requests with no address headers under one key", () => {
    expect(clientKey(new Headers())).toBe("unknown");
  });
});

describe("checkRunLimits", () => {
  it("accepts a graph at the limits", () => {
    const atLimit = request(
      DEFAULT_LIMITS.maxNodes,
      DEFAULT_LIMITS.maxEdges,
      "x".repeat(DEFAULT_LIMITS.maxInputChars),
    );
    expect(checkRunLimits(atLimit, DEFAULT_LIMITS)).toBeNull();
  });

  it("rejects a graph with too many nodes", () => {
    expect(
      checkRunLimits(request(DEFAULT_LIMITS.maxNodes + 1), DEFAULT_LIMITS),
    ).toMatch(/nodes/);
  });

  it("rejects a graph with too many edges", () => {
    expect(
      checkRunLimits(request(2, DEFAULT_LIMITS.maxEdges + 1), DEFAULT_LIMITS),
    ).toMatch(/edges/);
  });

  it("rejects an over-long question", () => {
    const longInput = "x".repeat(DEFAULT_LIMITS.maxInputChars + 1);
    expect(checkRunLimits(request(1, 0, longInput), DEFAULT_LIMITS)).toMatch(
      /input/,
    );
  });
});
