import type { RunEvent, WorkflowNodeData } from "@/types/workflow";

interface GraphPayload {
  nodes: {
    id: string;
    kind: string;
    label: string;
    config: Record<string, string>;
  }[];
  edges: { id: string; source: string; target: string }[];
}

export interface RunGraphInput {
  nodes: { id: string; data: WorkflowNodeData }[];
  edges: { id: string; source: string; target: string }[];
  input: string;
}

/** Translate the VueFlow scene into the server's WorkflowGraph contract. */
function toPayload(input: RunGraphInput): GraphPayload {
  return {
    nodes: input.nodes.map((node) => ({
      id: node.id,
      kind: node.data.kind,
      label: node.data.label,
      config: node.data.config,
    })),
    edges: input.edges,
  };
}

/** Pull complete `data:` JSON frames out of an SSE buffer, returning the remainder. */
function drainFrames(
  buffer: string,
  onEvent: (event: RunEvent) => void,
): string {
  const chunks = buffer.split("\n\n");
  const remainder = chunks.pop() ?? "";
  for (const chunk of chunks) {
    const dataLine = chunk.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) continue;
    try {
      onEvent(JSON.parse(dataLine.slice("data:".length).trim()) as RunEvent);
    } catch {
      /* ignore keep-alive / partial frames */
    }
  }
  return remainder;
}

/**
 * Start a run and stream `RunEvent`s as the agent emits them.
 * Resolves once the stream closes.
 */
export async function runGraph(
  input: RunGraphInput,
  onEvent: (event: RunEvent) => void,
): Promise<void> {
  const response = await fetch("/api/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ graph: toPayload(input), input: input.input }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Run failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = drainFrames(buffer, onEvent);
  }
}
