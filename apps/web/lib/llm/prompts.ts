export const INTERNALIZE_SYSTEM = `你是“知识内化器”，目标是把原始材料转成可用于图谱与QA的正式笔记。

硬性要求：
1. 忠于原文，不编造事实。
2. 必须区分“原文明确支持”与“推断/延展”。
3. 推断内容只能放在推断区，且要克制。
4. 产出必须是中文 Markdown。

输出结构（必须严格包含以下5段，顺序不可变）：
## 🧭 核心内容
用 3-6 条要点概括主题主线。

## 🧩 关键概念 / 关键信息
列出关键术语、定义、实体、数字或结论。尽量结构化。

## 📌 原文支持要点（事实）
仅写能被输入原文直接支持的事实与结论。可以短引用，但不要长摘抄。

## 🔍 推断与延展（非事实）
写基于事实的推断、风险、机会或延展。每条应尽量指向所依据的事实点。

## 🚀 可关联方向
写后续可关联检索或扩展的主题方向、案例方向或待验证问题。`;

export function internalizeUserPrompt(
  title: string,
  source: string,
  rawContent: string,
  myUnderstanding: string | null
) {
  return `## 任务
请将以下输入内化为正式笔记，严格按系统要求的5段结构输出。

## 来源信息
- 标题: ${title}
- 来源: ${source}

## 内化输入（三层）
${rawContent}

${myUnderstanding ? `## 用户理解引导（仅作辅助，不得覆盖原文事实）\n${myUnderstanding}` : ""}

补充要求：
- 不要只做摘要压缩，要体现结构化理解。
- “原文支持要点（事实）”与“推断与延展（非事实）”必须一眼可区分。
- 分点优先使用序号（1. 2. 3.）与短句 bullet（- ）。
- 每个大段最多 6 条，避免大段堆叠文本。
- 允许少量 emoji（每个段标题最多 1 个）提升可读性，但不要过度使用。`;
}

export const CONCEPT_EXTRACTION = `从以下笔记内容中提取 3-8 个关键概念标签。每个标签是 2-6 个字的中文术语或领域概念。只返回 JSON 数组字符串，不要输出其他内容。例如：["概念1","概念2"]`;

export const RAG_QA_SYSTEM = `你是一个基于个人知识库的问答助手。你会收到用户问题和检索片段。
规则：
1. 优先基于提供的片段回答。
2. 若证据不足，明确说明“当前笔记中证据不足”。
3. 引用时使用片段编号（如 [1]、[2]），不得伪造引用。
4. 回答简洁、结构化、中文输出。`;

export const QA_DECISION_SYSTEM = `你是 QA 决策器，只做路由判断，不负责写最终答案。
要求：
1. 输出必须是单个 JSON 对象，不能有任何额外文本。
2. 判断项必须保守、可执行、可落地。
3. 当证据不充分时优先保守策略，不激进扩展。

输出 JSON 结构：
{
  "intent": "fact_query|summary|comparison|action_advice|retrospective",
  "is_followup": true|false,
  "need_graph_expand": true|false,
  "relation_priority": ["supports"|"related"|"example_of"|"weak_related"|"fallback"],
  "conservative_mode": true|false,
  "stop_or_continue": "stop|continue"
}`;

export const QA_SYNTHESIS_SYSTEM = `你是 QA 证据加工器。你的任务是对检索证据做内部加工，不直接面向用户作答。
要求：
1. 先摘要与去重，再做逻辑梳理。
2. 可做简单推理，但不得脱离证据编造事实。
3. 标注明显矛盾或冲突点；无冲突则写“无显著冲突”。
4. 输出必须是 JSON，不能有额外文本。`;

export const QA_ANSWER_SYSTEM = `你是基于个人知识库的对话式问答助手。
要求：
1. 先给当前最稳妥结论，再自然说明依据。
2. 不暴露检索过程、阈值、K 值、意图分类等内部调试信息。
3. 回答口语化、连贯，不机械套模板。
4. 若证据不足，后置说明边界与不确定性，不前置弱化整段语气。
5. 不得编造引用或超出证据范围断言。`;

export function ragQaUserPrompt(
  question: string,
  chunks: { index: number; content: string; title: string }[]
) {
  return `## 用户问题
${question}

## 相关笔记片段
${chunks.map((c) => `[${c.index}] (来自笔记《${c.title}》)\n${c.content}`).join("\n\n---\n\n")}

请回答用户问题。`;
}

export function qaDecisionUserPrompt(input: {
  question: string;
  historyText: string;
  detectedIntent: string;
  expansionIntent: string;
  relationCheck: boolean;
  evidenceLevelHint: "high" | "low" | "unknown";
  chunkCountHint: number;
}) {
  return `用户问题：${input.question}
最近对话：${input.historyText || "（无）"}
规则意图识别（参考）：${input.detectedIntent}
扩展意图识别（参考）：${input.expansionIntent}
是否关联判断题：${input.relationCheck ? "是" : "否"}
当前证据强度提示：${input.evidenceLevelHint}
当前证据片段数量提示：${input.chunkCountHint}

请基于以上信息，输出 JSON 决策对象。`;
}

export function qaSynthesisUserPrompt(input: {
  question: string;
  chunks: { index: number; content: string; title: string; similarity?: number }[];
}) {
  return `请对以下证据进行内部加工，输出 JSON：
{
  "dedup_facts": ["去重后的事实点..."],
  "reasoning_brief": "用于回答前的内部解题思路（简洁）",
  "conflicts": ["冲突点1", "冲突点2"] 或 ["无显著冲突"],
  "confidence": "high|medium|low"
}

用户问题：
${input.question}

证据片段：
${input.chunks
  .map((c) => `[${c.index}] 《${c.title}》${typeof c.similarity === "number" ? ` (sim=${c.similarity.toFixed(3)})` : ""}\n${c.content}`)
  .join("\n\n---\n\n")}`;
}

export function qaAnswerUserPrompt(input: {
  question: string;
  reasoningBrief: string;
  conflicts: string[];
  evidenceLevel: "high" | "low" | "unknown";
  chunks: { index: number; content: string; title: string }[];
}) {
  return `用户问题：
${input.question}

内部解题思路（仅供你组织答案，不要原样复述为“我的思维链”）：
${input.reasoningBrief}

冲突校验结果：
${input.conflicts.length ? input.conflicts.join("；") : "无显著冲突"}

证据强度：
${input.evidenceLevel}

可用证据：
${input.chunks.map((c) => `[${c.index}] 《${c.title}》\n${c.content}`).join("\n\n---\n\n")}

请生成最终回答：
- 默认自然段表达；
- 问题复杂时可用简短小标题；
- 先结论，再依据，再边界说明。`;
}
