export type QaIntent =
  | "fact_query"
  | "summary"
  | "comparison"
  | "action_advice"
  | "retrospective";

export function detectIntent(question: string): { intent: QaIntent; confidence: number } {
  const q = question.trim().toLowerCase();

  const rules: Array<{ intent: QaIntent; confidence: number; keywords: string[] }> = [
    { intent: "comparison", confidence: 0.86, keywords: ["对比", "区别", "差异", "哪个好", "vs", "versus", "取舍"] },
    { intent: "action_advice", confidence: 0.82, keywords: ["怎么做", "如何做", "下一步", "建议", "方案", "落地", "执行"] },
    { intent: "summary", confidence: 0.8, keywords: ["总结", "概括", "提炼", "要点", "梳理"] },
    { intent: "retrospective", confidence: 0.78, keywords: ["复盘", "问题", "不足", "改进", "优化点", "教训"] },
    { intent: "fact_query", confidence: 0.74, keywords: ["是什么", "定义", "含义", "为什么", "何时", "谁"] },
  ];

  for (const rule of rules) {
    if (rule.keywords.some((k) => q.includes(k))) {
      return { intent: rule.intent, confidence: rule.confidence };
    }
  }

  return { intent: "fact_query", confidence: 0.55 };
}

export function intentLabel(intent: QaIntent): string {
  switch (intent) {
    case "fact_query":
      return "事实查询";
    case "summary":
      return "总结归纳";
    case "comparison":
      return "对比决策";
    case "action_advice":
      return "执行建议";
    case "retrospective":
      return "复盘反思";
    default:
      return "事实查询";
  }
}

// Detects "is X related to Y" style questions. These should be allowed to answer
// "暂无直接关联" (no direct relation found) instead of the generic "证据不足" refusal.
// Requires BOTH a relation word AND a yes/no judgement marker, so action questions
// like "怎么建立关联" do not match.
export function isRelationCheckQuestion(question: string): boolean {
  const q = (question || "").trim().toLowerCase();
  if (!q) return false;
  const relationWords = ["关联", "关系", "联系", "相关", "有关"];
  const judgementMarkers = ["是否", "有没有", "有无", "是不是", "存在", "吗", "么", "?", "？"];
  const hasRelation = relationWords.some((w) => q.includes(w));
  if (!hasRelation) return false;
  return judgementMarkers.some((m) => q.includes(m));
}

// Phase 5.3: expansion intent — orthogonal to the primary QaIntent. It expresses
// what *kind* of graph expansion would help, and maps directly to a preferred
// relation type for graph-guided retrieval (Phase 5.5). "none" means no specific
// expansion preference (fall back to primary-intent priority).
export type QaExpansionIntent =
  | "evidence_strengthening"
  | "example_request"
  | "related_topic_expansion"
  | "none";

export function detectExpansionIntent(question: string): QaExpansionIntent {
  const q = (question || "").trim().toLowerCase();
  if (!q) return "none";

  // example / case request -> example_of
  const exampleMarkers = ["例子", "案例", "举例", "示例", "实例", "模板", "样例", "demo", "example", "case", "怎么用", "用法"];
  // evidence strengthening -> supports
  const evidenceMarkers = ["依据", "证据", "为什么", "原因", "凭什么", "支撑", "论据", "数据", "证明", "理由", "怎么证明", "可靠吗"];
  // related-topic expansion -> related
  const relatedMarkers = ["相关", "关联", "类似", "还有什么", "其他", "延伸", "拓展", "扩展", "周边", "相近", "相似主题"];

  // example/evidence are more specific than related; check them first.
  if (exampleMarkers.some((m) => q.includes(m))) return "example_request";
  if (evidenceMarkers.some((m) => q.includes(m))) return "evidence_strengthening";
  if (relatedMarkers.some((m) => q.includes(m))) return "related_topic_expansion";
  return "none";
}


