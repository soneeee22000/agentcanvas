import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWorkflow, upstreamFor } from "./loop.js";
import type { RunEvent, WorkflowGraph, WorkflowNode } from "./schema.js";

const QUESTION = "How does GraphRAG ground an agent's answer?";
const SEED_SNIPPET =
  "GraphRAG builds an entity-and-relationship knowledge graph";
const CLAUDE_REPLY = "stubbed claude reply";

function node(
  id: string,
  kind: WorkflowNode["kind"],
  prompt?: string,
): WorkflowNode {
  return { id, kind, label: id, config: prompt ? { prompt } : {} };
}

/** A fetch stand-in that records each Anthropic request body and streams one text delta. */
function stubAnthropic(): Array<{ system: string; userContent: string }> {
  const requests: Array<{ system: string; userContent: string }> = [];
  const sseBody = `data: ${JSON.stringify({
    type: "content_block_delta",
    delta: { text: CLAUDE_REPLY },
  })}\n\n`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as {
        system: string;
        messages: Array<{ content: string }>;
      };
      requests.push({
        system: body.system,
        userContent: body.messages[0]?.content ?? "",
      });
      return new Response(sseBody, { status: 200 });
    }),
  );
  return requests;
}

/** Run a workflow to completion under fake timers and collect every emitted event. */
async function collectRun(graph: WorkflowGraph): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  const run = runWorkflow(graph, QUESTION, (event) => events.push(event));
  await vi.runAllTimersAsync();
  await run;
  return events;
}

describe("runWorkflow with a live model", () => {
  let requests: Array<{ system: string; userContent: string }>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    requests = stubAnthropic();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends the agent downstream of retrieval both the question and the snippets", async () => {
    const graph: WorkflowGraph = {
      nodes: [node("k", "knowledge"), node("a", "agent", "Answer it.")],
      edges: [{ id: "e1", source: "k", target: "a" }],
    };
    await collectRun(graph);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.system).toBe("Answer it.");
    expect(requests[0]?.userContent).toContain(QUESTION);
    expect(requests[0]?.userContent).toContain(SEED_SNIPPET);
  });

  it("routes context along edges, so an unconnected agent gets only the question", async () => {
    const graph: WorkflowGraph = {
      nodes: [
        node("k", "knowledge"),
        node("wired", "agent", "wired"),
        node("loose", "agent", "loose"),
      ],
      edges: [{ id: "e1", source: "k", target: "wired" }],
    };
    await collectRun(graph);
    const loose = requests.find((request) => request.system === "loose");
    expect(loose?.userContent).toContain(QUESTION);
    expect(loose?.userContent).not.toContain(SEED_SNIPPET);
    const wired = requests.find((request) => request.system === "wired");
    expect(wired?.userContent).toContain(SEED_SNIPPET);
  });

  it("queries retrieval with the question even when it sits downstream of an agent", async () => {
    const graph: WorkflowGraph = {
      nodes: [node("a", "agent", "Plan."), node("k", "knowledge")],
      edges: [{ id: "e1", source: "a", target: "k" }],
    };
    const events = await collectRun(graph);
    const call = events.find((event) => event.type === "tool_call");
    expect(call?.type === "tool_call" ? call.args.query : null).toBe(QUESTION);
  });
});

describe("runWorkflow in mock mode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("ANTHROPIC_API_KEY", "");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("streams the full event sequence and finishes with the output node's answer", async () => {
    const graph: WorkflowGraph = {
      nodes: [node("k", "knowledge"), node("a", "agent"), node("o", "output")],
      edges: [
        { id: "e1", source: "k", target: "a" },
        { id: "e2", source: "a", target: "o" },
      ],
    };
    const events = await collectRun(graph);
    expect(events[0]?.type).toBe("run_started");
    expect(
      events.filter((event) => event.type === "node_completed"),
    ).toHaveLength(3);
    const agentDone = events.find(
      (event) => event.type === "node_completed" && event.nodeId === "a",
    );
    const last = events.at(-1);
    expect(last?.type).toBe("run_completed");
    expect(last?.type === "run_completed" ? last.output : "").toBe(
      agentDone?.type === "node_completed" ? agentDone.output : "missing",
    );
  });
});

describe("upstreamFor", () => {
  it("counts a predecessor once even when several edges wire it to the same node", () => {
    const graph: WorkflowGraph = {
      nodes: [node("a", "knowledge"), node("b", "output")],
      edges: [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "a", target: "b" },
        { id: "e3", source: "a", target: "b" },
      ],
    };
    const outputs = new Map([["a", "snippets"]]);
    expect(upstreamFor("b", graph, outputs)).toBe("snippets");
  });
});

describe("runWorkflow output size", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("ANTHROPIC_API_KEY", "");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("does not multiply the output when duplicate edges chain pass-through nodes", async () => {
    const duplicated = (source: string, target: string) =>
      [1, 2, 3].map((copy) => ({
        id: `${source}-${target}-${copy}`,
        source,
        target,
      }));
    const graph: WorkflowGraph = {
      nodes: [node("k", "knowledge"), node("o1", "output"), node("o2", "output")],
      edges: [...duplicated("k", "o1"), ...duplicated("o1", "o2")],
    };
    const events = await collectRun(graph);
    const retrieval = events.find(
      (event) => event.type === "node_completed" && event.nodeId === "k",
    );
    const last = events.at(-1);
    expect(last?.type === "run_completed" ? last.output : "").toBe(
      retrieval?.type === "node_completed" ? retrieval.output : "missing",
    );
  });
});
