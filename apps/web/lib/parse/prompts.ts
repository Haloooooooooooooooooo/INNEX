export const PARSE_TITLE_PROMPT = `你是一个标题提炼助手。从以下内容中提炼一个简洁的标题（不超过 30 个字）。
只返回标题文本，不要引号、不要其他内容。`;

export function parseTitleUserPrompt(content: string): string {
  return `为以下内容起一个标题：\n\n${content.substring(0, 2000)}`;
}

export const PARSE_SUMMARY_PROMPT = `你是一个摘要助手。用 1-2 句简洁的中文总结以下内容的核心要点。
只返回摘要文本，不要引号、不要其他内容。`;

export function parseSummaryUserPrompt(content: string): string {
  return `总结以下内容：\n\n${content.substring(0, 3000)}`;
}

export const PARSE_TAGS_PROMPT = `你是一个标签提取助手。从以下内容中提取 3-8 个关键标签。
每个标签 2-6 个字，中文术语或领域概念。
只返回 JSON 字符串数组，不要其他内容。例如: ["标签1", "标签2", "标签3"]`;

export function parseTagsUserPrompt(content: string): string {
  return `提取标签：\n\n${content.substring(0, 3000)}`;
}
