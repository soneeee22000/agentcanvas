<script setup lang="ts">
import { Loader2, Play } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { useWorkflowStore } from '@/stores/workflow';

const store = useWorkflowStore();
const { input, isRunning } = storeToRefs(store);
</script>

<template>
  <div class="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
    <label class="sr-only" for="run-input">Workflow input</label>
    <input
      id="run-input"
      v-model="input"
      type="text"
      placeholder="Ask the workflow something…"
      class="h-11 flex-1 rounded-lg border border-border bg-surface-2 px-3 text-sm text-foreground outline-none placeholder:text-muted focus:border-primary"
      @keydown.enter="store.run()"
    />
    <button
      type="button"
      class="flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      :disabled="isRunning || !input.trim()"
      @click="store.run()"
    >
      <Loader2 v-if="isRunning" class="size-4 animate-spin" />
      <Play v-else class="size-4" />
      {{ isRunning ? 'Running…' : 'Run workflow' }}
    </button>
  </div>
</template>
