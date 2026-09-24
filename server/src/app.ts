import { Hono } from "hono";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { runWorkflow } from "./agent/loop.js";
import { RunEvent, RunRequest } from "./agent/schema.js";
import {
  DEFAULT_LIMITS,
  DEFAULT_RATE_LIMIT,
  DEFAULT_RATE_WINDOW_MS,
  checkRunLimits,
  clientKey,
  createRateLimiter,
} from "./guards.js";
import type { RateLimiter, RunLimits } from "./guards.js";

const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_UNPROCESSABLE = 422;
const HTTP_TOO_MANY_REQUESTS = 429;

export interface AppOptions {
  readonly limits?: RunLimits;
  readonly rateLimiter?: RateLimiter;
  readonly corsOrigin?: string;
}

/** Stream one run's events onto SSE in emission order, one `RunEvent` per frame. */
function streamRun(context: Context, request: RunRequest): Response {
  return streamSSE(context, async (stream) => {
    const pending: RunEvent[] = [];
    let finished = false;
    let wake: (() => void) | null = null;
    const emit = (event: RunEvent): void => {
      pending.push(event);
      wake?.();
      wake = null;
    };

    const runner = runWorkflow(request.graph, request.input, emit)
      .catch((error) =>
        emit({
          type: "error",
          message: error instanceof Error ? error.message : "run failed",
        }),
      )
      .finally(() => {
        finished = true;
        wake?.();
        wake = null;
      });

    for (;;) {
      const event = pending.shift();
      if (event) {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        });
        continue;
      }
      if (finished) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
    await runner;
  });
}

/**
 * Build the HTTP app: health check plus the SSE run endpoint, guarded by a
 * per-IP rate limit, a body-size cap and graph-size caps. Shared by the
 * local Node server and the Vercel Functions.
 */
export function createApp(options: AppOptions = {}): Hono {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const rateLimiter =
    options.rateLimiter ??
    createRateLimiter({
      limit: DEFAULT_RATE_LIMIT,
      windowMs: DEFAULT_RATE_WINDOW_MS,
    });
  const corsOrigin = options.corsOrigin ?? "http://localhost:5173";

  const app = new Hono();
  app.use(
    "/api/*",
    cors({
      origin:
        corsOrigin === "*"
          ? "*"
          : corsOrigin.split(",").map((value) => value.trim()),
    }),
  );

  app.get("/api/health", (context) =>
    context.json({
      status: "ok",
      mode: process.env.ANTHROPIC_API_KEY ? "live" : "mock",
      limits,
    }),
  );

  app.post(
    "/api/run",
    async (context, next) => {
      const decision = rateLimiter.check(clientKey(context.req.raw.headers));
      if (decision.allowed) return next();
      context.header("Retry-After", String(decision.retryAfterSeconds));
      return context.json(
        { error: "rate limit exceeded" },
        HTTP_TOO_MANY_REQUESTS,
      );
    },
    bodyLimit({
      maxSize: limits.maxBodyBytes,
      onError: (context) =>
        context.json(
          { error: `body exceeds ${limits.maxBodyBytes} bytes` },
          HTTP_PAYLOAD_TOO_LARGE,
        ),
    }),
    async (context) => {
      const parsed = RunRequest.safeParse(
        await context.req.json().catch(() => null),
      );
      if (!parsed.success) {
        return context.json({ error: parsed.error.flatten() }, 400);
      }
      const overLimit = checkRunLimits(parsed.data, limits);
      if (overLimit) {
        return context.json({ error: overLimit }, HTTP_UNPROCESSABLE);
      }
      return streamRun(context, parsed.data);
    },
  );

  return app;
}
