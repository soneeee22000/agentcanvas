<script setup lang="ts">
import { computed, markRaw } from 'vue';
import { VueFlow, type Connection, type Edge, type Node, type NodeMouseEvent } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import { MiniMap } from '@vue-flow/minimap';
import { storeToRefs } from 'pinia';
import { useWorkflowStore } from '@/stores/workflow';
import type { NodeKind } from '@/types/workflow';
import BaseNode from '@/components/nodes/BaseNode.vue';

const store = useWorkflowStore();
const { nodes, edges } = storeToRefs(store);

/** Minimap dot colour per node kind, mirroring the design-token accents. */
const MINIMAP_COLOR: Record<NodeKind, string> = {
  agent: '#7c5cff',
  tool: '#f5a524',
  knowledge: '#2dd4bf',
  output: '#38bdf8',
};

function minimapNodeColor(node: Node): string {
  const kind = (node.data as { kind?: NodeKind } | undefined)?.kind;
  return kind ? MINIMAP_COLOR[kind] : '#8b97ad';
}

// Bridge our lightweight CanvasNode storage to VueFlow's Node type. The cast is
// the single, intentional boundary between the two representations; position
// writeback from dragging flows back into the store through the setter.
const vfNodes = computed<Node[]>({
  get: () => nodes.value as unknown as Node[],
  set: (value) => {
    nodes.value = value as unknown as typeof nodes.value;
  },
});
const vfEdges = computed<Edge[]>({
  get: () => edges.value as unknown as Edge[],
  set: (value) => {
    edges.value = value as unknown as typeof edges.value;
  },
});

/** Register the single custom node type the catalog renders through. */
const nodeTypes = { workflow: markRaw(BaseNode) };

function onConnect(connection: Connection): void {
  store.addEdge({ source: connection.source, target: connection.target });
}

function onNodeClick({ node }: NodeMouseEvent): void {
  store.selectNode(node.id);
}
</script>

<template>
  <VueFlow
    v-model:nodes="vfNodes"
    v-model:edges="vfEdges"
    :node-types="nodeTypes"
    :default-edge-options="{ animated: true, style: { stroke: 'var(--color-primary)' } }"
    fit-view-on-init
    class="size-full"
    @connect="onConnect"
    @node-click="onNodeClick"
    @pane-click="store.selectNode(null)"
  >
    <Background :gap="20" pattern-color="#2a3346" />
    <MiniMap pannable zoomable :node-color="minimapNodeColor" mask-color="rgba(11, 15, 23, 0.6)" />
    <Controls />
  </VueFlow>
</template>
