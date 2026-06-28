<script setup lang="ts">
import { Workflow } from 'lucide-vue-next';
import NodePalette from '@/components/NodePalette.vue';
import Toolbar from '@/components/Toolbar.vue';
import Canvas from '@/components/Canvas.vue';
import Inspector from '@/components/Inspector.vue';
import RunPanel from '@/components/RunPanel.vue';
</script>

<template>
  <div class="flex h-screen flex-col bg-background text-foreground">
    <header class="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
      <span class="flex size-8 items-center justify-center rounded-lg bg-primary">
        <Workflow class="size-5 text-primary-foreground" />
      </span>
      <div>
        <h1 class="text-sm font-semibold leading-tight">AgentCanvas</h1>
        <p class="text-xs text-muted">Compose and observe agentic workflows</p>
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      <NodePalette class="w-60 shrink-0 border-r border-border" />
      <main class="flex min-w-0 flex-1 flex-col">
        <Toolbar />
        <div class="min-h-0 flex-1">
          <Canvas />
        </div>
      </main>
      <div class="flex w-96 shrink-0 flex-col border-l border-border">
        <Inspector />
        <RunPanel class="min-h-0 flex-1" />
      </div>
    </div>
  </div>
</template>
