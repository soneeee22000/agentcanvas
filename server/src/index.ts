import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { runWorkflow } from "./agent/loop.js";
import { RunEvent, RunRequest } from "./agent/schema.js";

const DEFAULT_PORT = 8787;

const app = new Hono();
app.use("/api/*", cors());

app.get("/api/health", (context) =>
  context.json({
    status: "ok",
    mode: process.env.ANTHROPIC_API_KEY ? "live" : "mock",
  }),
);

/**
 * Start a run and stream the agent's reasoning back as Server-Sent Events.
 *
 * The agent loop emits events synchronously; we buffer them on an in-order
 * channel and write each one sequentially, so fast live-streaming deltas can
 * never interleave on the wire. Each SSE frame is one `RunEvent` — the schema
 * contract the UI decodes.
 */
app.post("/api/run", async (context) => {
  const parsed = RunRequest.safeParse(
    await context.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return context.json({ error: parsed.error.flatten() }, 400);
  }

  return streamSSE(context, async (stream) => {
    const pending: RunEvent[] = [];
    let finished = false;
    let wake: (() => void) | null = null;
    const emit = (event: RunEvent): void => {
      pending.push(event);
      wake?.();
      wake = null;
    };

    const runner = runWorkflow(parsed.data.graph, parsed.data.input, emit)
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
});

const port = Number(process.env.PORT ?? DEFAULT_PORT);
serve({ fetch: app.fetch, port }, (info) => {
  const mode = process.env.ANTHROPIC_API_KEY
    ? "live (Anthropic)"
    : "mock (no key)";
  console.log(
    `AgentCanvas server on http://localhost:${info.port} — agent mode: ${mode}`,
  );
});
