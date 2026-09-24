# Why AgentCanvas exists

**A multi-step agent is hard to debug when you only see its final answer.** A workflow that retrieves, reasons and formats can fail in any of those steps: retrieval returns the wrong passages, the prompt drops part of the request, or the model answers without using what it was given. If the only thing on screen is the last message, you cannot tell which step went wrong.

**The failures are quiet.** A step that loses information still returns fluent text. This repo had exactly that bug: the retrieval step replaced the user's question with its snippets, so the agent was told to "answer the question" without ever receiving it. The scripted mock hid it, because the mock does not read its input the way a model does. A test that inspects what the agent is actually sent caught it (`server/src/agent/runWorkflow.test.ts`).

**Who it is for.** AgentCanvas is a portfolio prototype, not a product. It shows one way to make each step visible: every node reports what it started, which tool it called with which arguments, what it got back, and what it passed on, as typed events streamed to the canvas. The same event contract is used by the server, the tests and the UI.

## Layer by layer

| Layer         | Problem                                                              | How AgentCanvas answers it                                                                                                                         |
| ------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Canvas**    | The structure of a workflow lives in code and is hard to see.        | Nodes and edges are drawn and edited in a VueFlow canvas; edges set execution order and decide which outputs each node receives.                   |
| **Contracts** | The UI and the server drift apart and the stream becomes untyped.    | Zod schemas in `server/src/agent/schema.ts` define the graph, the run request and a discriminated-union `RunEvent`; the web app mirrors the types. |
| **Runner**    | A step can silently lose the user's request.                         | One topological pass; each node receives the original question plus the outputs of the nodes wired into it. Tests assert what the agent is sent.   |
| **Retrieval** | Isolated chunks lose the relations between facts.                    | A keyword-seeded search over a 4-node demo graph expands one hop along typed edges and tags each neighbour with its relation.                      |
| **Transport** | Fast token deltas can interleave or arrive out of order on the wire. | The runner only emits into a sink; the HTTP layer drains an in-order queue onto Server-Sent Events, one `RunEvent` per frame.                      |

## What it does not claim

- The knowledge graph is 4 hard-coded nodes and 4 edges. It demonstrates the retrieval shape, not retrieval quality.
- Mock mode is scripted. Its "thoughts" describe what a model would be asked to do; they are not model output.
- There is no hosted deployment. It runs locally, with no API key required.
