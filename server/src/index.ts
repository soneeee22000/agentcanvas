import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const DEFAULT_PORT = 8787;

// Demo default is the Vite dev origin; set CORS_ORIGIN (comma-separated, or "*")
// to widen it. Avoids a blanket wildcard in the committed code.
const app = createApp({ corsOrigin: process.env.CORS_ORIGIN });

const port = Number(process.env.PORT ?? DEFAULT_PORT);
serve({ fetch: app.fetch, port }, (info) => {
  const mode = process.env.ANTHROPIC_API_KEY
    ? "live (Anthropic)"
    : "mock (no key)";
  console.log(
    `AgentCanvas server on http://localhost:${info.port} — agent mode: ${mode}`,
  );
});
