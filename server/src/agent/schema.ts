import { z } from "zod";

/**
 * Schema contracts for AgentCanvas.
 *
 * This module is the single source of truth for the language agents and humans
 * speak to each other in: the shape of a workflow graph, the shape of a run
 * request, and the streamed events the UI renders as a run unfolds. The web app
 * mirrors these types in `web/src/types/workflow.ts`.
 */

/** The kind of node in an agentic workflow graph. */
export const NodeKind = z.enum(["agent", "tool", "knowledge", "output"]);
export type NodeKind = z.infer<typeof NodeKind>;

/** A node on the canvas. `config` carries kind-specific settings (prompt, corpus id...). */
export const WorkflowNode = z.object({
  id: z.string(),
  kind: NodeKind,
  label: z.string(),
  config: z.record(z.string()).default({}),
});
export type WorkflowNode = z.infer<typeof WorkflowNode>;

/** A directed connection between two nodes. */
export const WorkflowEdge = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
});
export type WorkflowEdge = z.infer<typeof WorkflowEdge>;

/** A whole workflow: nodes plus the edges that order their execution. */
export const WorkflowGraph = z.object({
  nodes: z.array(WorkflowNode),
  edges: z.array(WorkflowEdge),
});
export type WorkflowGraph = z.infer<typeof WorkflowGraph>;

/** The payload the UI posts to start a run. */
export const RunRequest = z.object({
  graph: WorkflowGraph,
  input: z.string().min(1, "input must not be empty"),
});
export type RunRequest = z.infer<typeof RunRequest>;

/** A single citation grounding an agent claim back to a source document. */
export const Citation = z.object({
  source: z.string(),
  snippet: z.string(),
  score: z.number().min(0).max(1),
});
export type Citation = z.infer<typeof Citation>;

/**
 * The streamed contract between the agent (server) and the human (UI).
 *
 * Every event names the `nodeId` it belongs to so the canvas can light the
 * matching node and stream its reasoning in step — this is what makes the
 * agent's "thought process" transparent rather than a black box.
 */
export const RunEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run_started"), runId: z.string() }),
  z.object({ type: z.literal("node_started"), nodeId: z.string() }),
  z.object({
    type: z.literal("thought"),
    nodeId: z.string(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("tool_call"),
    nodeId: z.string(),
    tool: z.string(),
    args: z.record(z.string()),
  }),
  z.object({
    type: z.literal("tool_result"),
    nodeId: z.string(),
    tool: z.string(),
    citations: z.array(Citation),
  }),
  z.object({
    type: z.literal("node_completed"),
    nodeId: z.string(),
    output: z.string(),
  }),
  z.object({
    type: z.literal("run_completed"),
    runId: z.string(),
    output: z.string(),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type RunEvent = z.infer<typeof RunEvent>;
