import { randomUUID } from "node:crypto";
import type { RunEvent, WorkflowGraph, WorkflowNode } from "./schema.js";
import { knowledgeGraphTool } from "./tools.js";

/** A sink the loop pushes typed events into; the HTTP layer forwards them as SSE. */
export type Emit = (event: RunEvent) => void;

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 512;
const STEP_DELAY_MS = 320;

const sleep = (ms: number): Promise<void> =>
  new Promise((done) => setTimeout(done, ms));

/**
 * Order nodes so every node runs after the nodes feeding into it (Kahn's algorithm).
 * Cycles are not rejected: nodes left in a cycle are appended in declaration
 * order, so every node still runs exactly once and the loop cannot hang.
 */
export function topoOrder(graph: WorkflowGraph): WorkflowNode[] {
  const indegree = new Map<string, number>(
    graph.nodes.map((node) => [node.id, 0]),
  );
  for (const edge of graph.edges) {
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const queue = graph.nodes.filter(
    (node) => (indegree.get(node.id) ?? 0) === 0,
  );
  const ordered: WorkflowNode[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    ordered.push(node);
    for (const edge of graph.edges.filter(
      (candidate) => candidate.source === node.id,
    )) {
      const next = (indegree.get(edge.target) ?? 0) - 1;
      indegree.set(edge.target, next);
      if (next === 0 && byId.has(edge.target))
        queue.push(byId.get(edge.target)!);
    }
  }
  const seen = new Set(ordered.map((node) => node.id));
  return [...ordered, ...graph.nodes.filter((node) => !seen.has(node.id))];
}

/**
 * Stream a real Claude completion, forwarding text deltas to `onDelta`.
 * The node's prompt is sent as the Anthropic `system` instruction (so editing
 * it in the inspector genuinely steers the model), with the question and the
 * node's upstream context as the user turn.
 */
async function streamClaude(
  system: string,
  userContent: string,
  onDelta: (text: string) => void,
): Promise<string> {
  const response = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.AGENTCANVAS_MODEL ?? DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      stream: true,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Anthropic request failed: ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const delta = parseDelta(line);
      if (delta) {
        full += delta;
        onDelta(delta);
      }
    }
  }
  return full;
}

/** Pull the text out of one Anthropic SSE `data:` line, if it carries a content delta. */
export function parseDelta(line: string): string | null {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice("data:".length).trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    const event = JSON.parse(payload) as {
      type?: string;
      delta?: { text?: string };
    };
    return event.type === "content_block_delta"
      ? (event.delta?.text ?? null)
      : null;
  } catch {
    return null;
  }
}

/**
 * What a node receives: the run's original question plus the outputs of the
 * nodes wired directly into it (empty when it has no incoming edges).
 */
export interface NodeInput {
  readonly question: string;
  readonly upstream: string;
}

const UPSTREAM_SEPARATOR = "\n\n";

/** Compose the user turn for an agent: the question first, then its upstream context. */
export function agentUserContent(input: NodeInput): string {
  const context = input.upstream || "(no upstream context)";
  return `Question:\n${input.question}\n\nContext:\n${context}`;
}

/** Deterministic stand-in for the LLM so the studio runs with no key and no cost. */
async function mockReason(
  node: WorkflowNode,
  input: NodeInput,
  emit: Emit,
): Promise<string> {
  const instruction = node.config.prompt?.trim();
  const lines = [
    `Reading upstream context for "${node.label}".`,
    instruction
      ? `Following its system prompt: "${instruction.slice(0, 80)}"`
      : `Planning how to answer: ${input.question.slice(0, 80)}`,
    input.upstream
      ? "Drafting a grounded response from the upstream snippets."
      : "No upstream snippets are wired in, so answering from the question alone.",
  ];
  for (const text of lines) {
    emit({ type: "thought", nodeId: node.id, text });
    await sleep(STEP_DELAY_MS);
  }
  return input.upstream
    ? `Synthesised answer for "${node.label}" grounded in the knowledge-graph snippets above.`
    : `Synthesised answer for "${node.label}" from the question alone (no snippets wired in).`;
}

/** Run an agent node: think, optionally via a real LLM, and return its output text. */
async function runAgentNode(
  node: WorkflowNode,
  input: NodeInput,
  emit: Emit,
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) return mockReason(node, input, emit);
  const system =
    node.config.prompt?.trim() || "You are a step in an agentic workflow.";
  return streamClaude(system, agentUserContent(input), (delta) =>
    emit({ type: "thought", nodeId: node.id, text: delta }),
  );
}

/** Run a retrieval node: query the knowledge graph with the question and emit citations. */
async function runRetrievalNode(
  node: WorkflowNode,
  input: NodeInput,
  emit: Emit,
): Promise<string> {
  const query = input.question;
  emit({
    type: "tool_call",
    nodeId: node.id,
    tool: knowledgeGraphTool.name,
    args: { query },
  });
  await sleep(STEP_DELAY_MS);
  const citations = await knowledgeGraphTool.run(query);
  emit({
    type: "tool_result",
    nodeId: node.id,
    tool: knowledgeGraphTool.name,
    citations,
  });
  return citations
    .map((citation) => `(${citation.source}) ${citation.snippet}`)
    .join("\n");
}

/** Dispatch a single node by kind and return the output handed along its outgoing edges. */
async function runNode(
  node: WorkflowNode,
  input: NodeInput,
  emit: Emit,
): Promise<string> {
  switch (node.kind) {
    case "knowledge":
    case "tool":
      return runRetrievalNode(node, input, emit);
    case "agent":
      return runAgentNode(node, input, emit);
    case "output":
      emit({
        type: "thought",
        nodeId: node.id,
        text: "Formatting the final answer for the user.",
      });
      return input.upstream || input.question;
    default:
      return input.upstream;
  }
}

/**
 * Gather the outputs of the nodes wired into `nodeId`, in edge declaration order.
 * Predecessors that have not run yet (only possible inside a cycle) contribute nothing.
 */
export function upstreamFor(
  nodeId: string,
  graph: WorkflowGraph,
  outputs: ReadonlyMap<string, string>,
): string {
  return graph.edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => outputs.get(edge.source))
    .filter((output): output is string => Boolean(output))
    .join(UPSTREAM_SEPARATOR);
}

/**
 * Execute a workflow graph in one topological pass, streaming reasoning and
 * citations as typed RunEvents. Every node gets the original question plus the
 * outputs of its direct predecessors; the run's output is the last node's output.
 * The caller supplies `emit`; this function never touches the transport.
 */
export async function runWorkflow(
  graph: WorkflowGraph,
  question: string,
  emit: Emit,
): Promise<void> {
  const runId = randomUUID();
  emit({ type: "run_started", runId });
  const outputs = new Map<string, string>();
  let finalOutput = question;
  for (const node of topoOrder(graph)) {
    emit({ type: "node_started", nodeId: node.id });
    await sleep(STEP_DELAY_MS);
    const upstream = upstreamFor(node.id, graph, outputs);
    finalOutput = await runNode(node, { question, upstream }, emit);
    outputs.set(node.id, finalOutput);
    emit({ type: "node_completed", nodeId: node.id, output: finalOutput });
  }
  emit({ type: "run_completed", runId, output: finalOutput });
}
