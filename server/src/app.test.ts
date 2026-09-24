import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { DEFAULT_LIMITS, createRateLimiter } from "./guards.js";

const STARTER_GRAPH = {
  nodes: [
    { id: "k", kind: "knowledge", label: "Knowledge graph", config: {} },
    { id: "o", kind: "output", label: "Answer", config: {} },
  ],
  edges: [{ id: "e1", source: "k", target: "o" }],
};

function postRun(
  app: ReturnType<typeof createApp>,
  body: unknown,
  ip = "1.1.1.1",
): Promise<Response> {
  return Promise.resolve(
    app.request("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function sseEventTypes(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith("event:"))
    .map((line) => line.slice("event:".length).trim());
}

describe("createApp", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports mock mode and the active limits on /api/health", async () => {
    const response = await createApp().request("/api/health");
    const body = (await response.json()) as {
      mode: string;
      limits: typeof DEFAULT_LIMITS;
    };
    expect(body.mode).toBe("mock");
    expect(body.limits.maxNodes).toBe(DEFAULT_LIMITS.maxNodes);
  });

  it("streams a full mock run as SSE, from run_started to run_completed", async () => {
    const response = await postRun(createApp(), {
      graph: STARTER_GRAPH,
      input: "How does GraphRAG ground an answer?",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const types = sseEventTypes(await response.text());
    expect(types[0]).toBe("run_started");
    expect(types).toContain("tool_result");
    expect(types.at(-1)).toBe("run_completed");
  });

  it("refuses a body over the size limit with 413 before parsing it", async () => {
    const app = createApp({ limits: { ...DEFAULT_LIMITS, maxBodyBytes: 256 } });
    const response = await postRun(app, {
      graph: STARTER_GRAPH,
      input: "x".repeat(400),
    });
    expect(response.status).toBe(413);
  });

  it("refuses a graph with too many nodes with 422", async () => {
    const nodes = Array.from(
      { length: DEFAULT_LIMITS.maxNodes + 1 },
      (_, index) => ({
        id: `n${index}`,
        kind: "output",
        label: "n",
        config: {},
      }),
    );
    const response = await postRun(createApp(), {
      graph: { nodes, edges: [] },
      input: "q",
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/nodes/);
  });

  it("still rejects a malformed request with 400", async () => {
    const response = await postRun(createApp(), "not json");
    expect(response.status).toBe(400);
  });

  it("rate-limits runs per client IP with 429 and Retry-After", async () => {
    const app = createApp({
      rateLimiter: createRateLimiter({
        limit: 1,
        windowMs: 60_000,
        now: () => 0,
      }),
    });
    const invalid = { graph: STARTER_GRAPH, input: "" };
    expect((await postRun(app, invalid, "1.1.1.1")).status).toBe(400);
    const limited = await postRun(app, invalid, "1.1.1.1");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect((await postRun(app, invalid, "2.2.2.2")).status).toBe(400);
  });

  it("does not rate-limit the health check", async () => {
    const app = createApp({
      rateLimiter: createRateLimiter({ limit: 1, windowMs: 60_000 }),
    });
    await app.request("/api/health");
    const second = await app.request("/api/health");
    expect(second.status).toBe(200);
  });
});
