# Deploying AgentCanvas (keyless, mock mode)

One Vercel project serves both halves:

- the Vue app, built by Vite to `web/dist` and served as static files;
- the Hono server, as two Vercel Functions on the Node.js runtime: `api/run.ts` (`POST /api/run`, the SSE stream) and `api/health.ts` (`GET /api/health`).

Both functions export the same app from `server/src/app.ts` (`createApp()`). The local dev server (`server/src/index.ts`) uses that app too. With no `ANTHROPIC_API_KEY` the runner uses the deterministic mock, so a public deploy costs nothing per run apart from function time.

## Guards on `POST /api/run`

| Guard      | Default                        | Response when exceeded            |
| ---------- | ------------------------------ | --------------------------------- |
| Rate limit | 10 runs per client IP per 60 s | `429` with a `Retry-After` header |
| Body size  | 16,384 bytes                   | `413`, before the body is parsed  |
| Graph size | 12 nodes, 24 edges             | `422`                             |
| Question   | 500 characters                 | `422`                             |

The values are in `server/src/guards.ts` (`DEFAULT_LIMITS`, `DEFAULT_RATE_LIMIT`, `DEFAULT_RATE_WINDOW_MS`). `GET /api/health` reports the mode and the active limits. Tests: `server/src/guards.test.ts` and `server/src/app.test.ts`.

**Limitation of the rate limit.** It is an in-memory fixed window. On Vercel it holds per function instance: a new instance starts with an empty count, so the limit is not global. It still caps a single client hammering one warm instance. A global limit would need a shared store (for example Upstash Redis), which this deploy does not use. The client IP comes from `x-real-ip`, then the first `x-forwarded-for` hop. Vercel sets both headers. The local Node server (`server/src/index.ts`) has no proxy in front of it, so there a client can set these headers itself and pick its own rate-limit key.

Worst case at these limits: a chain of 12 agent nodes in mock mode took 15.7 s end to end in the local check below. `api/run.ts` has `maxDuration: 60` in `vercel.json`.

**Response size.** Output and pass-through nodes forward their upstream text, so a graph can make the response larger than the request. Before 2026-09-24 a predecessor wired in by several edges was counted once per edge: 9 nodes chained with 3 duplicate edges per hop (24 edges, a 1,556-byte request) streamed an 8,909,561-byte response. `upstreamFor` in `server/src/agent/loop.ts` now counts each predecessor once, and the same request streams 8,705 bytes. Fan-in over distinct edges still adds up: the largest case measured, 12 nodes each fed by the two nodes before it plus 3 extra edges into the last node (24 edges, a 1,690-byte request), streamed 290,729 bytes in 4.3 s. There is no cap on response size beyond what the node and edge caps imply.

## Files

| File            | Purpose                                                                      |
| --------------- | ---------------------------------------------------------------------------- |
| `vercel.json`   | `npm ci`, `npm run build`, output `web/dist`, function `maxDuration`s        |
| `api/run.ts`    | Default-exports `createApp()`. Vercel calls its `fetch`                      |
| `api/health.ts` | Same app, for the health route                                               |
| `tsconfig.json` | Root config Vercel uses to compile `api/`. `npm run typecheck:api` checks it |

## Before the first deploy

Needed: a Vercel account (Hobby is enough) and the Vercel CLI (`npm i -g vercel`, tested with 50.35.0). No other accounts, keys or cloud resources.

**Do not set `ANTHROPIC_API_KEY` on this project.** Setting it switches every public run to live Claude calls billed to that key, with only the per-instance rate limit in front of it.

`CORS_ORIGIN` is not needed. The web app calls `/api/run` on its own origin.

## Commands

From the repo root:

```bash
vercel login
vercel link                    # create the project; accept the settings from vercel.json
vercel pull --yes              # fetch project settings into .vercel/ (gitignored)
vercel build                   # optional: local production build into .vercel/output
vercel deploy --prebuilt       # preview deploy of that build
# or skip the local build:
vercel deploy                  # preview deploy, built on Vercel
vercel deploy --prod           # production
```

Check the deploy (replace the host):

```bash
HOST=https://<project>.vercel.app
curl -s $HOST/api/health
# expect {"status":"ok","mode":"mock","limits":{...}}

curl -sN -X POST $HOST/api/run -H "content-type: application/json" \
  --data '{"graph":{"nodes":[{"id":"kg","kind":"knowledge","label":"Knowledge graph","config":{}},{"id":"a","kind":"output","label":"Answer","config":{}}],"edges":[{"id":"e1","source":"kg","target":"a"}]},"input":"How does GraphRAG ground an answer?"}'
# expect SSE frames from event: run_started to event: run_completed
```

Then open the host in a browser and press **Run workflow**. Before linking the demo anywhere, check that the page `<title>` is AgentCanvas. The bare `agentcanvas.vercel.app` may belong to someone else; use the host Vercel assigns to your project.

## Local verification (2026-09-24, no Vercel login)

`vercel build` works without logging in when `.vercel/project.json` exists. It was written by hand for this check (`{"projectId":"local-build-check","orgId":"local-build-check","settings":{"framework":null,"installCommand":"npm ci","buildCommand":"npm run build","outputDirectory":"web/dist","nodeVersion":"22.x"}}`) and deleted afterwards. The build produced `static/` (index.html plus assets) and `functions/api/run.func` and `functions/api/health.func` (runtime `nodejs22.x`, `maxDuration` 60 and 10). The first attempt failed because `npm ci` could not unlink a locked `esbuild.exe` on Windows. The retry succeeded.

A small Node script served `.vercel/output` locally: static files, and requests to `/api/run` and `/api/health` passed to the compiled function bundles' `fetch`. Vercel's router was not emulated. Results:

- `GET /api/health`: `{"status":"ok","mode":"mock","limits":{"maxBodyBytes":16384,"maxNodes":12,"maxEdges":24,"maxInputChars":500}}`.
- `GET /`: 200, `text/html`.
- Starter workflow (knowledge graph, reasoner, answer): HTTP 200, 14 SSE events from `run_started` to `run_completed`, 2.3 s total, first byte after 14 ms. Events arrived as they were emitted, not all at once: `run_started` at 151 ms, `tool_result` at 799 ms, the reasoner's three thoughts at 1127, 1450 and 1777 ms, `run_completed` at 2432 ms (timings from a second run).
- 13 nodes: 422 `graph has 13 nodes; the limit is 12`. A 20 KB body: 413 `body exceeds 16384 bytes`.
- 12 requests from one IP: 10 answered (400, since the payload was deliberately invalid and still counted), then 429 with `retry-after: 60`. A different IP was then served normally.
- 12 chained agent nodes: HTTP 200, 62 events, 15.7 s.

Not verified locally: Vercel's own routing and streaming through its edge network. Check both on the first preview deploy with the `curl` commands above.
