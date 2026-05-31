/**
 * Phase 5C graph evaluation script.
 * Usage: npx ts-node scripts/evaluate-graph.ts <graph.json> [gold-standard.json]
 * Outputs: relation_recall@K, relation_type_precision, evidence_summary_usable_rate
 */
import * as fs from "fs";

interface Edge { source: string; target: string; type: string; confidence: number; evidence?: Record<string, unknown>; }
interface Node { id: string; label: string; }
interface Graph { nodes: Node[]; edges: Edge[]; }
interface GoldPair { source: string; target: string; expectedType: string; strength: string; }

function main() {
  const graphPath = process.argv[2];
  const goldPath = process.argv[3] || __dirname + "/gold-standard.json";
  if (!graphPath) { console.error("Usage: npx ts-node scripts/evaluate-graph.ts <graph.json>"); process.exit(1); }

  const raw = JSON.parse(fs.readFileSync(graphPath, "utf-8"));
  const g: Graph = raw.graph || raw;
  const gold: { pairs: GoldPair[] } = JSON.parse(fs.readFileSync(goldPath, "utf-8"));

  // Build label->id index (lower-cased, substring match)
  const labelIndex: Array<{ node: Node; lower: string }> = g.nodes.map((n) => ({ node: n, lower: n.label.toLowerCase() }));
  const edgeSet = new Map<string, Edge>();
  for (const e of g.edges) edgeSet.set(`${e.source}::${e.target}`, e);

  let totalGold = 0, found = 0, typeCorrect = 0;
  let usableEvidence = 0, totalEdges = g.edges.length;
  const badcases: string[] = [];

  for (const p of gold.pairs) {
    const src = labelIndex.filter((x) => x.lower.includes(p.source.toLowerCase()));
    const tgt = labelIndex.filter((x) => x.lower.includes(p.target.toLowerCase()));
    if (!src.length || !tgt.length) continue;
    totalGold++;

    let matched: Edge | undefined;
    for (const s of src) {
      for (const t of tgt) {
        if (s.node.id === t.node.id) continue;
        const key = `${s.node.id}::${t.node.id}`;
        const e = edgeSet.get(key);
        if (e && !matched) matched = e;
      }
    }

    if (matched) {
      found++;
      if (matched.type === p.expectedType) typeCorrect++;
      else badcases.push(`${p.source} ↔ ${p.target}: expected=${p.expectedType} got=${matched.type}`);
    } else if (p.expectedType !== "none") {
      badcases.push(`${p.source} ↔ ${p.target}: expected=${p.expectedType} but not connected`);
    } else {
      found++; // correctly not connected
      typeCorrect++;
    }
  }

  // evidence_summary_usable_rate
  for (const e of g.edges) {
    const ev = (e.evidence as Record<string, unknown> | undefined);
    const summary = typeof ev?.evidence_summary === "string" ? ev!.evidence_summary : "";
    if (summary.length > 20 && !summary.includes("LLM判据=无")) usableEvidence++;
  }

  const result = {
    relation_recall: totalGold > 0 ? (found / totalGold).toFixed(3) : "N/A",
    relation_type_precision: found > 0 ? (typeCorrect / found).toFixed(3) : "N/A",
    evidence_summary_usable_rate: totalEdges > 0 ? (usableEvidence / totalEdges).toFixed(3) : "N/A",
    gold_pairs_evaluated: totalGold,
    total_edges: totalEdges,
    edges_with_usable_evidence: usableEvidence,
    badcases,
  };

  console.log(JSON.stringify(result, null, 2));
}

main();
