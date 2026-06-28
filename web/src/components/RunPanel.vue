<script setup lang="ts">
import { AlertTriangle, FileText, Sparkles } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { useWorkflowStore } from '@/stores/workflow';

const store = useWorkflowStore();
const { trace, finalOutput, errorMessage, status } = storeToRefs(store);
</script>

<template>
  <section class="flex flex-col overflow-hidden bg-surface">
    <header class="flex items-center gap-2 border-b border-border px-4 py-3">
      <Sparkles class="size-4 text-primary" />
      <h2 class="text-sm font-semibold text-foreground">Reasoning trace</h2>
    </header>

    <div class="flex-1 space-y-3 overflow-y-auto p-4">
      <p v-if="status === 'idle' && trace.length === 0" class="text-sm text-muted">
        Run the workflow to watch each node think — every step is grounded with citations.
      </p>

      <article
        v-for="(entry, index) in trace"
        :key="index"
        class="rounded-lg border border-border bg-surface-2 p-3"
      >
        <p class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{{ entry.label }}</p>
        <p class="whitespace-pre-wrap text-sm text-foreground">{{ entry.text }}</p>
        <ul v-if="entry.citations.length" class="mt-2 space-y-1.5">
          <li
            v-for="citation in entry.citations"
            :key="citation.source"
            class="flex items-start gap-2 rounded-md bg-background/60 p-2 text-xs"
          >
            <FileText class="mt-0.5 size-3.5 shrink-0 text-knowledge" />
            <span class="min-w-0">
              <span class="block font-medium text-knowledge">{{ citation.source }}</span>
              <span class="block text-muted">{{ citation.snippet }}</span>
            </span>
            <span class="ml-auto shrink-0 tabular-nums text-muted">{{ (citation.score * 100).toFixed(0) }}%</span>
          </li>
        </ul>
      </article>

      <div v-if="errorMessage" class="flex items-start gap-2 rounded-lg border border-tool/50 bg-tool/10 p-3 text-sm">
        <AlertTriangle class="mt-0.5 size-4 shrink-0 text-tool" />
        <span class="text-foreground">{{ errorMessage }}</span>
      </div>
    </div>

    <footer v-if="finalOutput" class="border-t border-border p-4">
      <p class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Final answer</p>
      <p class="whitespace-pre-wrap text-sm text-foreground">{{ finalOutput }}</p>
    </footer>
  </section>
</template>
