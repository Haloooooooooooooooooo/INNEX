export const PARSE_TITLE_PROMPT = `You generate short titles for captured content.
Return only a concise title in the same language as the source text.
Do not use quotes, markdown, bullets, or extra explanation.
Keep the title within 30 characters when possible.`;

export function parseTitleUserPrompt(content: string): string {
  return `Create a short title for this content:\n\n${content.substring(0, 2000)}`;
}

export const PARSE_SUMMARY_PROMPT = `You generate short capture summaries.
Return 1-2 plain-text sentences in the same language as the source text.
Focus only on the main idea.
Do not use markdown, headings, blockquotes, bullet lists, or section numbers.
Do not copy large chunks of the source verbatim.
Keep the summary compact and readable.`;

export function parseSummaryUserPrompt(content: string): string {
  return `Summarize the following content into 1-2 plain-text sentences. Do not use markdown.\n\n${content.substring(0, 3000)}`;
}

export const PARSE_TAGS_PROMPT = `You extract concise topic tags from captured content.
Return only a JSON array of 3 to 8 short tags.
Each tag should be 2 to 6 characters when written in Chinese, or a short phrase when written in English.
Do not return any explanation or extra text.`;

export function parseTagsUserPrompt(content: string): string {
  return `Extract topic tags from the following content and return JSON only:\n\n${content.substring(0, 3000)}`;
}
