import {
  Bot,
  Database,
  FileOutput,
  Wrench,
  type LucideIcon,
} from "lucide-vue-next";
import type { NodeKind } from "@/types/workflow";

/** Presentation metadata for each node kind — drives the palette and custom nodes. */
export interface NodeKindMeta {
  kind: NodeKind;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Tailwind token suffix, e.g. `agent` resolves to `text-agent` / `border-agent`. */
  accent: "agent" | "tool" | "knowledge" | "output";
}

export const NODE_CATALOG: Record<NodeKind, NodeKindMeta> = {
  agent: {
    kind: "agent",
    label: "Agent",
    description: "Reasons over its inputs and produces an answer.",
    icon: Bot,
    accent: "agent",
  },
  tool: {
    kind: "tool",
    label: "Tool",
    description: "Calls an external function and returns its result.",
    icon: Wrench,
    accent: "tool",
  },
  knowledge: {
    kind: "knowledge",
    label: "Knowledge",
    description:
      "Seeds by keyword, then expands 1 hop over the knowledge graph.",
    icon: Database,
    accent: "knowledge",
  },
  output: {
    kind: "output",
    label: "Output",
    description: "Formats the final answer for the user.",
    icon: FileOutput,
    accent: "output",
  },
};

export const NODE_KINDS: NodeKind[] = ["agent", "tool", "knowledge", "output"];
