<script setup lang="ts">
import { Plus, RotateCcw } from 'lucide-vue-next';
import { NODE_CATALOG, NODE_KINDS } from '@/lib/nodeCatalog';
import { useWorkflowStore } from '@/stores/workflow';

const store = useWorkflowStore();
</script>

<template>
  <aside class="flex flex-col gap-2 overflow-y-auto bg-surface p-3">
    <p class="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Nodes</p>
    <button
      v-for="kind in NODE_KINDS"
      :key="kind"
      type="button"
      class="group flex items-start gap-2.5 rounded-lg border border-border bg-surface-2 p-2.5 text-left transition hover:border-primary"
      @click="store.addNode(kind)"
    >
      <component :is="NODE_CATALOG[kind].icon" class="mt-0.5 size-4 shrink-0 text-muted group-hover:text-primary" />
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-medium text-foreground">{{ NODE_CATALOG[kind].label }}</span>
        <span class="block text-xs leading-snug text-muted">{{ NODE_CATALOG[kind].description }}</span>
      </span>
      <Plus class="size-4 shrink-0 text-muted opacity-0 transition group-hover:opacity-100" />
    </button>

    <button
      type="button"
      class="mt-auto flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted transition hover:border-primary hover:text-foreground"
      @click="store.resetGraph()"
    >
      <RotateCcw class="size-3.5" />
      Reset workflow
    </button>
  </aside>
</template>
