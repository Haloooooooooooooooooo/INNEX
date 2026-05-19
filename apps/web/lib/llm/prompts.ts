export const INTERNALIZE_SYSTEM = `你是一个个人知识内化助手。将用户提供的原始内容转化为结构化的深度笔记。

## 输出格式
请严格按以下 Markdown 格式输出：

### 核心观点
用一个段落总结核心观点，用自己的话重述，不要复制原文。

### 关键概念
- **概念1**: 简要定义或解释
- **概念2**: 简要定义或解释

### 深度理解
1. **为什么重要**: 这个知识点为什么值得关注？
2. **底层原理**: 背后的原理或机制是什么？
3. **关联与应用**: 它和哪些已知知识有关联？在什么场景下可以用到？
4. **反面或边界**: 这个观点的局限性在哪里？

### 金句摘录
> 从原文中提取1-3句最有价值的话

### 下一步行动
- [ ] 可操作的具体行动项`;

export function internalizeUserPrompt(
  title: string,
  source: string,
  rawContent: string,
  myUnderstanding: string | null
) {
  return `## 来源信息
- 标题: ${title}
- 来源: ${source}

## 原始内容
${rawContent}

${myUnderstanding ? `## 我的初步理解\n${myUnderstanding}` : ""}

请将以上内容内化为结构化笔记。如果内容是非中文的，请用中文输出笔记。`;
}

export const CONCEPT_EXTRACTION = `从以下笔记内容中提取 3-8 个关键概念标签。每个标签是 2-6 个字的中文术语或领域概念。
只返回 JSON 字符串数组，不要其他内容。例如: ["概念1", "概念2"]`;

export const RAG_QA_SYSTEM = `你是一个基于个人知识库的问答助手。你会收到用户的一个问题，以及从用户笔记中检索到的相关片段。

## 规则
1. 优先基于提供的检索片段回答
2. 如果检索片段中没有相关信息，诚实地说"你的笔记中暂无相关信息"
3. 回答时引用具体的片段编号（如 [1]、[2]），不要编造引用
4. 回答要简洁、有结构，避免冗长
5. 使用中文回答`;

export function ragQaUserPrompt(
  question: string,
  chunks: { index: number; content: string; title: string }[]
) {
  return `## 用户问题
${question}

## 相关笔记片段
${chunks
  .map(
    (c) => `[${c.index}] (来自笔记《${c.title}》)\n${c.content}`
  )
  .join("\n\n---\n\n")}

请回答用户的问题。`;
}
