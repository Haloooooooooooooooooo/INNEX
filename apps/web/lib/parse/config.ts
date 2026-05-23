export const PARSE_RULES = {
  TEXT_MIN_LENGTH: 50,
  IMAGE_READ_MAX_COUNT: 10,
  DOCUMENT_READ_MAX_BYTES: 2 * 1024 * 1024,
  ATTACHMENT_GROUP_READ_MAX_BYTES: 5 * 1024 * 1024,
} as const;

export type ParseNotReadableReason =
  | "text_too_short"
  | "document_too_large"
  | "video_not_readable"
  | "image_too_many"
  | "attachment_group_too_large";

