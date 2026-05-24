import type { QaIntent } from "@/lib/qa/intent";

type RetrievalPreset = { topK: number; threshold: number };

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function retrievalPreset(intent: QaIntent): RetrievalPreset {
  const defaults: Record<QaIntent, RetrievalPreset> = {
    fact_query: { topK: 5, threshold: 0.72 },
    summary: { topK: 10, threshold: 0.62 },
    comparison: { topK: 12, threshold: 0.6 },
    action_advice: { topK: 8, threshold: 0.64 },
    retrospective: { topK: 9, threshold: 0.62 },
  };

  const d = defaults[intent];
  return {
    topK: envNumber(`QA_${intent.toUpperCase()}_TOPK`, d.topK),
    threshold: envNumber(`QA_${intent.toUpperCase()}_THRESHOLD`, d.threshold),
  };
}

export function onlineMaxEvidence(): number {
  return envNumber("QA_ONLINE_MAX_EVIDENCE", 4);
}

export function qaContextRounds(): number {
  return envNumber("QA_CONTEXT_ROUNDS", 8);
}

