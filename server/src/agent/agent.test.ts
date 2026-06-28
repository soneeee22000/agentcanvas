import { describe, expect, it } from "vitest";
import { topoOrder, parseDelta } from "./loop.js";
import { searchKnowledgeGraph, neighbors } from "./tools.js";
import type { WorkflowGraph } from "./schema.js";

function node(id: string, kind: "agent" | "tool" | "knowledge" | "output") {
  return { id, kind, label: id, config: {} };
}

describe("topoOrder", () => {
  it("orders nodes so producers run before consumers", () => {
    const graph: WorkflowGraph = {
      nodes: [node("c", "output"), node("a", "knowledge"), node("b", "agent")],
      edges: [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "c" },
      ],
    };
    const order = topoOrder(graph).map((n) => n.id);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
  });

  it("still returns every node when the graph has a cycle", () => {
    const graph: WorkflowGraph = {
      nodes: [node("a", "agent"), node("b", "agent")],
      edges: [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "a" },
      ],
    };
    expect(
      topoOrder(graph)
        .map((n) => n.id)
        .sort(),
    ).toEqual(["a", "b"]);
  });
});

describe("parseDelta", () => {
  it("extracts text from a content_block_delta line", () => {
    const line = `data: ${JSON.stringify({
      type: "content_block_delta",
      delta: { text: "hello" },
    })}`;
    expect(parseDelta(line)).toBe("hello");
  });

  it("ignores non-data lines, [DONE], and other event types", () => {
    expect(parseDelta("event: message_stop")).toBeNull();
    expect(parseDelta("data: [DONE]")).toBeNull();
    expect(
      parseDelta(`data: ${JSON.stringify({ type: "message_start" })}`),
    ).toBeNull();
  });

  it("returns null for malformed JSON rather than throwing", () => {
    expect(parseDelta("data: {not json")).toBeNull();
  });
});

describe("searchKnowledgeGraph", () => {
  it("returns the keyword-matched seed first", () => {
    const citations = searchKnowledgeGraph("graphrag entity");
    expect(citations[0]?.source).toContain("graphrag-overview");
  });

  it("expands one hop to a connected subgraph", () => {
    const citations = searchKnowledgeGraph("graphrag");
    const expanded = citations.filter((c) => c.source.includes("1-hop:"));
    expect(expanded.length).toBeGreaterThan(0);
  });

  it("scores expanded neighbours below their seed", () => {
    const citations = searchKnowledgeGraph("graphrag entity");
    const seed = citations.find((c) => !c.source.includes("1-hop:"));
    const hop = citations.find((c) => c.source.includes("1-hop:"));
    expect(seed && hop ? seed.score >= hop.score : true).toBe(true);
  });

  it("never returns empty, even for an unmatched query", () => {
    expect(searchKnowledgeGraph("zzzz").length).toBeGreaterThan(0);
  });
});

describe("neighbors", () => {
  it("treats edges as undirected for traversal", () => {
    expect(neighbors("citations").map((n) => n.id)).toContain("schema");
    expect(neighbors("schema").map((n) => n.id)).toContain("citations");
  });
});
