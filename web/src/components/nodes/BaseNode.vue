<script setup lang="ts">
import { computed } from 'vue';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import type { WorkflowNodeData } from '@/types/workflow';
import { NODE_CATALOG } from '@/lib/nodeCatalog';
import { useWorkflowStore } from '@/stores/workflow';

const props = defineProps<NodeProps<WorkflowNodeData>>();
const store = useWorkflowStore();

/** Literal class strings so Tailwind's scanner keeps them in the build. */
const ACCENT: Record<WorkflowNodeData['kind'], { icon: string; border: string; active: string }> = {
  agent: { icon: 'text-agent', border: 'border-agent/60', active: 'ring-agent' },
  tool: { icon: 'text-tool', border: 'border-tool/60', active: 'ring-tool' },
  knowledge: { icon: 'text-knowledge', border: 'border-knowledge/60', active: 'ring-knowledge' },
  output: { icon: 'text-output', border: 'border-output/60', active: 'ring-output' },
};

const meta = computed(() => NODE_CATALOG[props.data.kind]);
const accent = computed(() => ACCENT[props.data.kind]);
const state = computed(() => store.nodeStatus(props.id));
const selected = computed(() => store.selectedNodeId === props.id);
const Icon = computed(() => meta.value.icon);
</script>

<template>
  <div
    class="min-w-44 rounded-xl border bg-surface-2 px-3 py-2.5 shadow-lg transition"
    :class="[
      accent.border,
      state === 'active' ? `ring-2 ${accent.active} animate-pulse` : '',
      state === 'done' ? 'opacity-70' : '',
      selected ? 'ring-2 ring-primary' : '',
    ]"
  >
    <Handle v-if="data.kind !== 'knowledge'" type="target" :position="Position.Left" />
    <div class="flex items-center gap-2.5">
      <component :is="Icon" class="size-5 shrink-0" :class="accent.icon" />
      <div class="min-w-0">
        <p class="truncate text-sm font-semibold text-foreground">{{ data.label }}</p>
        <p class="text-[11px] uppercase tracking-wide text-muted">{{ meta.label }}</p>
      </div>
    </div>
    <Handle v-if="data.kind !== 'output'" type="source" :position="Position.Right" />
  </div>
</template>
