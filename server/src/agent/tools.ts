import type { Citation } from "./schema.js";

/** A tool the agent can call mid-run; it returns grounded citations. */
export interface AgentTool {
  readonly name: string;
  readonly describe: string;
  run(query: string): Promise<Citation[]>;
}

/** A node in the demo knowledge graph: a grounded source with keywords. */
export interface GraphNode {
  readonly id: string;
  readonly source: string;
  readonly snippet: string;
  readonly keywords: readonly string[];
}

/** A typed, directed edge between two knowledge-graph nodes. */
export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly relation: string;
}

const MAX_SEEDS = 2;
const MAX_RESULTS = 4;
const SCORE_DENOMINATOR = 3;
const EXPANSION_DECAY = 0.5;

/**
 * A small but real knowledge graph: typed nodes connected by directed,
 * labelled edges. Retrieval seeds by keyword match, then expands one hop along
 * these edges — so the tool returns a connected subgraph, not isolated chunks
 * (the defining property of GraphRAG).
 */
export const KNOWLEDGE_NODES: readonly GraphNode[] = [
  {
    id: "graphrag",
    source: "graphrag-overview.md#entities",
    snippet:
      "GraphRAG builds an entity-and-relationship knowledge graph from a corpus, then retrieves connected subgraphs instead of isolated chunks.",
    keywords: ["graph", "graphrag", "entity", "relationship", "knowledge"],
  },
  {
    id: "agentic",
    source: "agentic-workflows.md#orchestration",
    snippet:
      "An agentic workflow decomposes a goal into nodes — agents, tools, and retrieval steps — wired so each step hands typed output to the next.",
    keywords: ["agent", "agentic", "workflow", "orchestration", "tool", "node"],
  },
  {
    id: "citations",
    source: "citations.md#grounding",
    snippet:
      "Grounding every claim with a source and a confidence score lets a human audit why the model answered the way it did.",
    keywords: [
      "citation",
      "grounding",
      "source",
      "audit",
      "confidence",
      "transparent",
    ],
  },
  {
    id: "schema",
    source: "schema-contracts.md#events",
    snippet:
      "A discriminated-union event stream is the contract that lets the agent narrate its reasoning to the UI one typed step at a time.",
    keywords: ["schema", "contract", "event", "stream", "type", "reasoning"],
  },
];

/** Directed, typed relations connecting the nodes above. */
export const KNOWLEDGE_EDGES: readonly GraphEdge[] = [
  { from: "graphrag", to: "agentic", relation: "feeds retrieval into" },
  { from: "agentic", to: "schema", relation: "emits events through" },
  { from: "schema", to: "citations", relation: "carries" },
  { from: "graphrag", to: "citations", relation: "grounds" },
];

/** Score corpus relevance by simple keyword overlap with the query. */
function overlapScore(
  queryTerms: readonly string[],
  keywords: readonly string[],
): number {
  return queryTerms.filter((term) => keywords.includes(term)).length;
}

/** 1-hop neighbours of a node id (edges are treated as undirected for traversal). */
export function neighbors(id: string): Array<{ id: string; relation: string }> {
  const out: Array<{ id: string; relation: string }> = [];
  for (const edge of KNOWLEDGE_EDGES) {
    if (edge.from === id) out.push({ id: edge.to, relation: edge.relation });
    else if (edge.to === id)
      out.push({ id: edge.from, relation: edge.relation });
  }
  return out;
}

/**
 * Keyword-seed retrieval followed by 1-hop knowledge-graph expansion. Seeds are
 * the best keyword matches; expansion pulls in their graph neighbours (marked
 * with the connecting relation) so the result is a connected subgraph.
 */
export function searchKnowledgeGraph(query: string): Citation[] {
  const terms = query.toLowerCase().split(/\W+/).filter(Boolean);
  const byId = new Map(KNOWLEDGE_NODES.map((node) => [node.id, node]));

  const ranked = KNOWLEDGE_NODES.map((node) => ({
    node,
    score: overlapScore(terms, node.keywords),
  }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SEEDS);

  const seeds =
    ranked.length > 0 ? ranked : [{ node: KNOWLEDGE_NODES[0]!, score: 1 }];

  const citations: Citation[] = [];
  const included = new Set<string>();

  // Direct (seed) hits.
  for (const { node, score } of seeds) {
    included.add(node.id);
    citations.push({
      source: node.source,
      snippet: node.snippet,
      score: Math.min(1, score / SCORE_DENOMINATOR),
    });
  }

  // 1-hop expansion: walk edges to surface the connected subgraph.
  const seedScore = seeds[0]?.score ?? 1;
  for (const { node } of seeds) {
    for (const hop of neighbors(node.id)) {
      if (included.has(hop.id) || citations.length >= MAX_RESULTS) continue;
      const neighbour = byId.get(hop.id);
      if (!neighbour) continue;
      included.add(hop.id);
      citations.push({
        source: `${neighbour.source} (1-hop: ${hop.relation})`,
        snippet: neighbour.snippet,
        score: Math.min(1, (seedScore / SCORE_DENOMINATOR) * EXPANSION_DECAY),
      });
    }
  }

  return citations.slice(0, MAX_RESULTS);
}

/** The retrieval tool the demo agent calls to ground its answer. */
export const knowledgeGraphTool: AgentTool = {
  name: "knowledge_graph_search",
  describe:
    "Seed by keyword match, then expand one hop along graph edges to retrieve a connected subgraph.",
  run(query: string): Promise<Citation[]> {
    return Promise.resolve(searchKnowledgeGraph(query));
  },
};
