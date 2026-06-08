export const PARSE_TITLE_PROMPT = `你负责为收录内容生成短标题。
只返回一个简洁标题，语言与原文保持一致。
不要使用引号、Markdown、项目符号或额外解释。
标题尽量控制在 30 个字符以内。`;

export function parseTitleUserPrompt(content: string): string {
  return `请为以下内容生成一个短标题：\n\n${content.substring(0, 2000)}`;
}

export const PARSE_SUMMARY_PROMPT = `你负责为收录内容生成短摘要。
返回 1-2 句纯文本摘要，语言与原文保持一致。
只概括主要内容和核心结论。
不要使用 Markdown、标题、引用块、项目符号或章节编号。
不要大段复制原文。
摘要要简洁、可读。`;

export function parseSummaryUserPrompt(content: string): string {
  return `请将以下内容总结成 1-2 句纯文本摘要，不要使用 Markdown：\n\n${content.substring(0, 3000)}`;
}

export const PARSE_TAGS_PROMPT = `你负责从收录内容中提取简洁主题标签。
只返回一个 JSON 数组，包含 3 到 8 个短标签。
中文标签应尽量为 2 到 6 个字；英文标签应为简短短语。
不要返回解释、Markdown 或任何额外文本。`;

export function parseTagsUserPrompt(content: string): string {
  return `请从以下内容中提取主题标签，只返回 JSON 数组：\n\n${content.substring(0, 3000)}`;
}
