/**
 * Client mirror of the server's schema contracts (`server/src/agent/schema.ts`).
 * Kept as hand-written types so the web app has zero runtime coupling to the
 * backend bundle; the server's Zod schemas remain the source of truth.
 */

export type NodeKind = "agent" | "tool" | "knowledge" | "output";

export interface WorkflowNodeData {
  kind: NodeKind;
  label: string;
  config: Record<string, string>;
}

/**
 * The node shape AgentCanvas stores and reasons about. Deliberately our own
 * lightweight interface rather than VueFlow's deeply-recursive `Node` type —
 * this keeps `data` strongly typed and avoids TS2589 in the store. It is cast
 * to VueFlow's `Node` only at the canvas binding boundary.
 */
export interface CanvasNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: WorkflowNodeData;
}

/** Lightweight edge counterpart to {@link CanvasNode}; cast to VueFlow's `Edge` at the boundary. */
export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
}

export interface Citation {
  source: string;
  snippet: string;
  score: number;
}

export type RunEvent =
  | { type: "run_started"; runId: string }
  | { type: "node_started"; nodeId: string }
  | { type: "thought"; nodeId: string; text: string }
  | {
      type: "tool_call";
      nodeId: string;
      tool: string;
      args: Record<string, string>;
    }
  | { type: "tool_result"; nodeId: string; tool: string; citations: Citation[] }
  | { type: "node_completed"; nodeId: string; output: string }
  | { type: "run_completed"; runId: string; output: string }
  | { type: "error"; message: string };

/** A line in the run-panel transcript, derived from the streamed RunEvents. */
export interface TraceEntry {
  nodeId: string;
  label: string;
  text: string;
  citations: Citation[];
}
