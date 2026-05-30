import { generateCompletion } from "@/lib/llm/client";
import type { ProviderKey } from "@/lib/llm/provider";

export type RelationType = "related" | "supports" | "example_of" | "weak_related" | "fallback" | "none";

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

const RELATION_TYPES = ["related", "supports", "example_of", "weak_related", "fallback", "none"] as const;
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
    "任务：在 related/supports/example_of/weak_related/fallback/none 中做单选。",
    "规则：",
    "1) 只基于输入字段判断，不得编造；判断方向为 source -> target。",
    "2) 类型定义（带结构证据要求，从严到松）：",
    "   - example_of：必须是“定义/方法/规范 -> 其实例/模板/案例/具体落地”的方向性关系。仅同主题不足以判 example_of。",
    "   - supports：一篇的观点/方法/结论被另一篇用论据、数据或原理明确支撑。仅相关、仅同主题不足以判 supports。",
    "   - related：同主题或互补，但不构成实例或支撑关系。",
    "   - weak_related：主题仅有弱交集，多为泛词层面的关联。",
    "3) 泛词降权：当主要共享信号是泛词（如 AI、产品经理、系统、方法、prompt、agent、rag、模型）时，最多判 related/weak_related，禁止判 supports/example_of。",
    "4) confidence 取值 [0,1] 并按证据强度校准：",
    "   - 结构证据充分（实例关系或明确支撑）-> supports/example_of 给 0.70~0.85；",
    "   - 证据中等（同主题且有具体共享概念）-> related 给 0.58~0.70；",
    "   - 仅泛词或主题相邻 -> weak_related 给 0.45~0.55。",
    `5) ${guard}`,
    "6) 只输出固定 JSON，不要 markdown，不要解释，不要额外字段。",
  ].join("\n");
}

function buildUserPrompt(input: RelationClassifierInput): string {
  const mode = input.mode || "conservative";
  return JSON.stringify(
    {
      mode,
      schema: {
        relation_type: "related|supports|example_of|weak_related|fallback|none",
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
