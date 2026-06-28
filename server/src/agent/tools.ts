import type { Citation } from "./schema.js";

/** A tool the agent can call mid-run; it returns grounded citations. */
export interface AgentTool {
  readonly name: string;
  readonly describe: string;
  run(query: string): Promise<Citation[]>;
}

interface CorpusEntry {
  readonly source: string;
  readonly snippet: string;
  readonly keywords: readonly string[];
}

const MAX_RESULTS = 3;

/** A tiny stand-in knowledge-graph corpus so the demo grounds answers without external services. */
const KNOWLEDGE_CORPUS: readonly CorpusEntry[] = [
  {
    source: "graphrag-overview.md#entities",
    snippet:
      "GraphRAG builds an entity-and-relationship knowledge graph from a corpus, then retrieves connected subgraphs instead of isolated chunks.",
    keywords: ["graph", "graphrag", "entity", "relationship", "knowledge"],
  },
  {
    source: "agentic-workflows.md#orchestration",
    snippet:
      "An agentic workflow decomposes a goal into nodes — agents, tools, and retrieval steps — wired so each step hands typed output to the next.",
    keywords: ["agent", "agentic", "workflow", "orchestration", "tool", "node"],
  },
  {
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
    source: "schema-contracts.md#events",
    snippet:
      "A discriminated-union event stream is the contract that lets the agent narrate its reasoning to the UI one typed step at a time.",
    keywords: ["schema", "contract", "event", "stream", "type", "reasoning"],
  },
];

/** Score corpus relevance by simple keyword overlap with the query. */
function overlapScore(
  queryTerms: readonly string[],
  keywords: readonly string[],
): number {
  return queryTerms.filter((term) => keywords.includes(term)).length;
}

/** The retrieval tool the demo agent calls to ground its answer. */
export const knowledgeGraphTool: AgentTool = {
  name: "knowledge_graph_search",
  describe: "Retrieve grounded snippets from the knowledge-graph corpus.",
  async run(query: string): Promise<Citation[]> {
    const terms = query.toLowerCase().split(/\W+/).filter(Boolean);
    const ranked = KNOWLEDGE_CORPUS.map((entry) => ({
      entry,
      score: overlapScore(terms, entry.keywords),
    }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS);

    const pool =
      ranked.length > 0 ? ranked : [{ entry: KNOWLEDGE_CORPUS[0], score: 1 }];
    return pool.map((match) => ({
      source: match.entry.source,
      snippet: match.entry.snippet,
      score: Math.min(1, match.score / MAX_RESULTS),
    }));
  },
};
