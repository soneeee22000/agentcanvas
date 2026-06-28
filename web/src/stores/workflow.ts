import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { runGraph } from "@/lib/api";
import type {
  CanvasEdge,
  CanvasNode,
  Citation,
  NodeKind,
  RunEvent,
  TraceEntry,
  WorkflowNodeData,
} from "@/types/workflow";
import { NODE_CATALOG } from "@/lib/nodeCatalog";

export type WorkflowNode = CanvasNode;
export type RunStatus = "idle" | "running" | "done" | "error";

const NODE_SPACING_X = 300;

const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Math.floor(performance.now() * 1000)}`;

/** A small starter workflow so the canvas is never empty. */
function seedNodes(): WorkflowNode[] {
  return [
    {
      id: "knowledge-1",
      type: "workflow",
      position: { x: 40, y: 160 },
      data: { kind: "knowledge", label: "Knowledge Graph", config: {} },
    },
    {
      id: "agent-1",
      type: "workflow",
      position: { x: 360, y: 160 },
      data: {
        kind: "agent",
        label: "Reasoner",
        config: {
          prompt:
            "Answer the question using only the retrieved snippets, and cite them.",
        },
      },
    },
    {
      id: "output-1",
      type: "workflow",
      position: { x: 680, y: 160 },
      data: { kind: "output", label: "Answer", config: {} },
    },
  ];
}

function seedEdges(): CanvasEdge[] {
  return [
    { id: "e-k-a", source: "knowledge-1", target: "agent-1" },
    { id: "e-a-o", source: "agent-1", target: "output-1" },
  ];
}

export const useWorkflowStore = defineStore("workflow", () => {
  const nodes = ref<WorkflowNode[]>(seedNodes());
  const edges = ref<CanvasEdge[]>(seedEdges());
  const input = ref(
    "Explain how GraphRAG makes an agent’s reasoning transparent.",
  );

  const status = ref<RunStatus>("idle");
  const activeNodeId = ref<string | null>(null);
  const completed = ref<Set<string>>(new Set());
  const trace = ref<TraceEntry[]>([]);
  const finalOutput = ref("");
  const errorMessage = ref("");
  const selectedNodeId = ref<string | null>(null);

  const labelOf = (nodeId: string): string =>
    nodes.value.find((node) => node.id === nodeId)?.data?.label ?? nodeId;

  const nodeStatus = (nodeId: string): "idle" | "active" | "done" => {
    if (activeNodeId.value === nodeId) return "active";
    return completed.value.has(nodeId) ? "done" : "idle";
  };

  const selectedNode = computed<WorkflowNode | null>(
    () => nodes.value.find((node) => node.id === selectedNodeId.value) ?? null,
  );

  function selectNode(nodeId: string | null): void {
    selectedNodeId.value = nodeId;
  }

  /** Drop a fresh node of `kind` onto the canvas and select it for editing. */
  function addNode(kind: NodeKind): void {
    const meta = NODE_CATALOG[kind];
    const id = newId();
    nodes.value = [
      ...nodes.value,
      {
        id,
        type: "workflow",
        position: {
          x: 80 + nodes.value.length * NODE_SPACING_X * 0.25,
          y: 360,
        },
        data: { kind, label: meta.label, config: {} },
      },
    ];
    selectedNodeId.value = id;
  }

  /** Patch a node's editable fields (label and kind-specific config). */
  function updateNode(
    nodeId: string,
    patch: { label?: string; config?: Record<string, string> },
  ): void {
    nodes.value = nodes.value.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            data: {
              ...node.data,
              ...(patch.label !== undefined ? { label: patch.label } : {}),
              ...(patch.config
                ? { config: { ...node.data.config, ...patch.config } }
                : {}),
            },
          }
        : node,
    );
  }

  /** Remove a node along with any edges touching it. */
  function removeNode(nodeId: string): void {
    nodes.value = nodes.value.filter((node) => node.id !== nodeId);
    edges.value = edges.value.filter(
      (edge) => edge.source !== nodeId && edge.target !== nodeId,
    );
    if (selectedNodeId.value === nodeId) selectedNodeId.value = null;
  }

  /** Restore the starter workflow — handy to recover after experimenting. */
  function resetGraph(): void {
    nodes.value = seedNodes();
    edges.value = seedEdges();
    selectedNodeId.value = null;
    resetRun();
    status.value = "idle";
  }

  function addEdge(connection: { source: string; target: string }): void {
    const id = `e-${connection.source}-${connection.target}`;
    if (edges.value.some((edge) => edge.id === id)) return;
    edges.value = [
      ...edges.value,
      { id, source: connection.source, target: connection.target },
    ];
  }

  function resetRun(): void {
    activeNodeId.value = null;
    completed.value = new Set();
    trace.value = [];
    finalOutput.value = "";
    errorMessage.value = "";
  }

  /** Fold one streamed RunEvent into the reactive run state. */
  function apply(event: RunEvent): void {
    switch (event.type) {
      case "node_started":
        activeNodeId.value = event.nodeId;
        return;
      case "thought":
        appendThought(event.nodeId, event.text);
        return;
      case "tool_call":
        pushEntry(
          event.nodeId,
          `Calling ${event.tool}(${JSON.stringify(event.args)})`,
          [],
        );
        return;
      case "tool_result":
        pushEntry(
          event.nodeId,
          `Retrieved ${event.citations.length} grounded snippet(s)`,
          event.citations,
        );
        return;
      case "node_completed":
        completed.value = new Set(completed.value).add(event.nodeId);
        activeNodeId.value = null;
        return;
      case "run_completed":
        finalOutput.value = event.output;
        status.value = "done";
        return;
      case "error":
        errorMessage.value = event.message;
        status.value = "error";
        return;
      default:
        return;
    }
  }

  /** Coalesce consecutive thought deltas for the same node into one growing entry. */
  function appendThought(nodeId: string, text: string): void {
    const last = trace.value[trace.value.length - 1];
    if (last && last.nodeId === nodeId && last.citations.length === 0) {
      last.text += text;
      return;
    }
    pushEntry(nodeId, text, []);
  }

  function pushEntry(
    nodeId: string,
    text: string,
    citations: Citation[],
  ): void {
    trace.value = [
      ...trace.value,
      { nodeId, label: labelOf(nodeId), text, citations },
    ];
  }

  async function run(): Promise<void> {
    if (status.value === "running") return;
    resetRun();
    status.value = "running";
    try {
      await runGraph(
        {
          nodes: nodes.value.map((node) => ({
            id: node.id,
            data: node.data as WorkflowNodeData,
          })),
          edges: edges.value.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
          })),
          input: input.value,
        },
        apply,
      );
      if (status.value === "running") status.value = "done";
    } catch (error) {
      errorMessage.value =
        error instanceof Error ? error.message : "run failed";
      status.value = "error";
    }
  }

  const isRunning = computed(() => status.value === "running");

  return {
    nodes,
    edges,
    input,
    status,
    isRunning,
    activeNodeId,
    selectedNodeId,
    selectedNode,
    trace,
    finalOutput,
    errorMessage,
    nodeStatus,
    selectNode,
    addNode,
    updateNode,
    removeNode,
    resetGraph,
    addEdge,
    run,
    resetRun,
  };
});
