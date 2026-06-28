<script setup lang="ts">
import { computed } from 'vue';
import { Trash2, X } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { useWorkflowStore } from '@/stores/workflow';
import { NODE_CATALOG } from '@/lib/nodeCatalog';

const store = useWorkflowStore();
const { selectedNode } = storeToRefs(store);

const meta = computed(() =>
  selectedNode.value ? NODE_CATALOG[selectedNode.value.data.kind] : null,
);

const label = computed<string>({
  get: () => selectedNode.value?.data.label ?? '',
  set: (value) => {
    if (selectedNode.value) store.updateNode(selectedNode.value.id, { label: value });
  },
});

const prompt = computed<string>({
  get: () => selectedNode.value?.data.config.prompt ?? '',
  set: (value) => {
    if (selectedNode.value)
      store.updateNode(selectedNode.value.id, { config: { prompt: value } });
  },
});
</script>

<template>
  <section v-if="selectedNode && meta" class="flex flex-col gap-3 border-b border-border bg-surface p-4">
    <header class="flex items-center gap-2">
      <component :is="meta.icon" class="size-4 shrink-0" :class="`text-${meta.accent}`" />
      <h2 class="text-sm font-semibold text-foreground">Inspector</h2>
      <span class="text-[11px] uppercase tracking-wide text-muted">{{ meta.label }}</span>
      <button
        type="button"
        class="ml-auto rounded-md p-1 text-muted transition hover:text-foreground"
        aria-label="Close inspector"
        @click="store.selectNode(null)"
      >
        <X class="size-4" />
      </button>
    </header>

    <label class="flex flex-col gap-1">
      <span class="text-[11px] font-semibold uppercase tracking-wide text-muted">Label</span>
      <input
        v-model="label"
        type="text"
        class="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm text-foreground outline-none focus:border-primary"
      />
    </label>

    <label v-if="selectedNode.data.kind === 'agent'" class="flex flex-col gap-1">
      <span class="text-[11px] font-semibold uppercase tracking-wide text-muted">System prompt</span>
      <textarea
        v-model="prompt"
        rows="4"
        placeholder="Instructions this agent reasons with…"
        class="resize-y rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm leading-snug text-foreground outline-none focus:border-primary"
      />
      <span class="text-xs text-muted">Sent to the model as the system instruction for this node.</span>
    </label>

    <p v-else class="rounded-lg bg-surface-2 p-3 text-xs leading-snug text-muted">
      {{ meta.description }}
    </p>

    <button
      type="button"
      class="flex items-center justify-center gap-2 rounded-lg border border-tool/40 bg-tool/10 px-3 py-2 text-sm font-medium text-tool transition hover:bg-tool/20"
      @click="store.removeNode(selectedNode.id)"
    >
      <Trash2 class="size-4" />
      Delete node
    </button>
  </section>
</template>
