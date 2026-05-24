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

