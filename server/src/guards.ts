import type { RunRequest } from "./agent/schema.js";

/** Size caps that keep one public run cheap and short. */
export interface RunLimits {
  readonly maxBodyBytes: number;
  readonly maxNodes: number;
  readonly maxEdges: number;
  readonly maxInputChars: number;
}

export const DEFAULT_LIMITS: RunLimits = {
  maxBodyBytes: 16 * 1024,
  maxNodes: 12,
  maxEdges: 24,
  maxInputChars: 500,
};

export const DEFAULT_RATE_LIMIT = 10;
export const DEFAULT_RATE_WINDOW_MS = 60_000;

const MS_PER_SECOND = 1000;
const UNKNOWN_CLIENT = "unknown";

/** Outcome of one rate-limit check. */
export interface RateDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string): RateDecision;
  size(): number;
}

export interface RateLimiterOptions {
  readonly limit: number;
  readonly windowMs: number;
  readonly now?: () => number;
}

interface Window {
  startedAt: number;
  count: number;
}

/**
 * Fixed-window, in-memory rate limiter keyed by client.
 * State lives in one process: on serverless it is per instance, not global.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? Date.now;
  const windows = new Map<string, Window>();

  const evictExpired = (at: number): void => {
    for (const [key, window] of windows) {
      if (at - window.startedAt >= options.windowMs) windows.delete(key);
    }
  };

  return {
    check(key: string): RateDecision {
      const at = now();
      evictExpired(at);
      const window = windows.get(key) ?? { startedAt: at, count: 0 };
      windows.set(key, window);
      if (window.count < options.limit) {
        window.count += 1;
        return { allowed: true, retryAfterSeconds: 0 };
      }
      const remainingMs = window.startedAt + options.windowMs - at;
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(remainingMs / MS_PER_SECOND),
      };
    },
    size: () => windows.size,
  };
}

/**
 * The client address to rate-limit on. Vercel sets `x-real-ip` and
 * `x-forwarded-for` itself; behind no proxy both are absent and all
 * requests share one key.
 */
export function clientKey(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const firstHop = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return firstHop || UNKNOWN_CLIENT;
}

/** Return why a parsed run request exceeds the limits, or null when it fits. */
export function checkRunLimits(
  request: RunRequest,
  limits: RunLimits,
): string | null {
  if (request.graph.nodes.length > limits.maxNodes) {
    return `graph has ${request.graph.nodes.length} nodes; the limit is ${limits.maxNodes}`;
  }
  if (request.graph.edges.length > limits.maxEdges) {
    return `graph has ${request.graph.edges.length} edges; the limit is ${limits.maxEdges}`;
  }
  if (request.input.length > limits.maxInputChars) {
    return `input is ${request.input.length} characters; the limit is ${limits.maxInputChars}`;
  }
  return null;
}
