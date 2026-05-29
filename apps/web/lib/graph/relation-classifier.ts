import { generateCompletion } from "@/lib/llm/client";
import type { ProviderKey } from "@/lib/llm/provider";

export type RelationType = "related" | "supports" | "example_of" | "none";

export type RelationDecision = {
  relation_type: RelationType;
  confidence: number;
  evidence_summary: string;
  decision_reason: string;
};

export type RelationClassifierInput = {
  source: { title: string; summary: string; tags: string[]; concepts: string[] };
  target: { title: string; summary: string; tags: string[]; concepts: string[] };
  recall: { similarity: number; overlap: string[]; keywordHits: string[]; sourceChunk?: number };
  mode?: "conservative" | "balanced";
};

const RELATION_TYPES = ["related", "supports", "example_of", "none"] as const;
const DEFAULT_DECISION: RelationDecision = {
  relation_type: "none",
  confidence: 0.2,
  evidence_summary: "证据不足，保守不建边",
  decision_reason: "fallback_default",
};

function clampConfidence(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_DECISION.confidence;
  return Math.max(0, Math.min(1, n));
}

function normalizeDecision(raw: unknown): RelationDecision {
  if (!raw || typeof raw !== "object") return DEFAULT_DECISION;
  const obj = raw as Record<string, unknown>;
  const relationType = String(obj.relation_type || "").trim() as RelationType;
  const normalizedType = (RELATION_TYPES as readonly string[]).includes(relationType) ? relationType : "none";
  const evidence = String(obj.evidence_summary || "").trim() || DEFAULT_DECISION.evidence_summary;
  const reason = String(obj.decision_reason || "").trim() || "missing_reason";
  return {
    relation_type: normalizedType,
    confidence: clampConfidence(obj.confidence),
    evidence_summary: evidence.slice(0, 180),
    decision_reason: reason.slice(0, 120),
  };
}

function safeJsonParse(text: string): unknown {
  const raw = (text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function buildSystemPrompt(mode: "conservative" | "balanced"): string {
  const guard = mode === "conservative" ? "证据不够就输出 none，不要强行建边。" : "尽量识别合理关系，但不要编造。";
  return [
    "你是知识图谱关系判型器。",
    "任务：在 related/supports/example_of/none 中做单选。",
    "规则：",
    "1) 只基于输入字段判断，不得编造。",
    "2) related=同主题或互补；supports=观点/方法上的支撑；example_of=案例/示例关系。",
    "3) confidence 取值 [0,1]。",
    `4) ${guard}`,
    "5) 只输出固定 JSON，不要 markdown，不要解释，不要额外字段。",
  ].join("\n");
}

function buildUserPrompt(input: RelationClassifierInput): string {
  const mode = input.mode || "conservative";
  return JSON.stringify(
    {
      mode,
      schema: {
        relation_type: "related|supports|example_of|none",
        confidence: "number(0-1)",
        evidence_summary: "string<=180",
        decision_reason: "string<=120",
      },
      source_note: input.source,
      target_note: input.target,
      recall_signals: input.recall,
    },
    null,
    2
  );
}

export async function classifyRelation(input: RelationClassifierInput): Promise<RelationDecision> {
  const mode = input.mode || "conservative";
  const provider = (process.env.LLM_RELATION_PROVIDER || "deepseek") as ProviderKey;
  const model = process.env.LLM_RELATION_MODEL || process.env.DEEPSEEK_RELATION_MODEL || "deepseek-v4-pro";
  const raw = await generateCompletion(buildSystemPrompt(mode), buildUserPrompt(input), {
    useCase: "relation",
    provider,
    model,
    temperature: 0.05,
    maxOutputTokens: 220,
  });
  return normalizeDecision(safeJsonParse(raw));
}

