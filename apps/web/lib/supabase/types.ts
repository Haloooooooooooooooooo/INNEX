export type CaptureItemType = "text" | "url" | "image" | "document" | "video" | "attachment_group";

export type CaptureItemStatus = "later" | "pending" | "crystallized";

export interface Profile {
  id: string;
  username: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface CaptureItem {
  id: string;
  user_id: string;
  type: CaptureItemType;
  title: string;
  source: string;
  source_url: string | null;
  raw_content: string | null;
  my_understanding: string | null;
  notebook?: string | null;
  summary: string | null;
  parse_debug?: ParseDebugInfo | null;
  status: CaptureItemStatus;
  tags: string[];
  created_at: string;
  updated_at: string;
  attachments?: Attachment[];
  sources?: CaptureItemSource[];
}

export interface Attachment {
  id: string;
  capture_item_id: string;
  user_id: string;
  file_name: string;
  file_type: string;
  file_size: number | null;
  storage_path: string | null;
  created_at: string;
}

export interface ParseDebugInfo {
  input_source: "content" | "url_content" | "attachment_extracted_text" | "file_extracted_text" | "none";
  detected_type: CaptureItemType;
  readable: boolean | "partial";
  extracted_chars: number;
  model_summary_attempted: boolean;
  model_summary_succeeded: boolean;
  model_tags_attempted: boolean;
  model_tags_succeeded: boolean;
  url_fetch_succeeded?: boolean;
  file_extract_succeeded?: boolean;
  file_extract_count?: number;
  stages?: {
    detect?: { ok: boolean };
    extract?: { ok: boolean; strategy?: string; chars?: number };
    summarize?: { attempted: boolean; ok: boolean };
    tags?: { attempted: boolean; ok: boolean };
  };
  notes?: string[];
}

export type CaptureItemSourceType =
  | "user_input"
  | "url_body"
  | "attachment_text"
  | "image_ocr"
  | "supplemental_text"
  | "user_understanding"
  | "raw_content_fallback";

export interface CaptureItemSource {
  id: string;
  capture_item_id: string;
  user_id: string;
  source_type: CaptureItemSourceType;
  source_label: string | null;
  source_ref: string | null;
  source_url: string | null;
  content: string;
  is_primary: boolean;
  parse_status: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SourceChunk {
  id: string;
  capture_item_source_id: string;
  capture_item_id: string;
  user_id: string;
  chunk_index: number;
  content: string;
  token_count: number | null;
  created_at: string;
}

// === Phase 2 types ===

export interface Note {
  id: string;
  user_id: string;
  capture_item_id: string | null;
  title: string;
  content: string;
  summary: string | null;
  concepts: string[];
  tags: string[];
  source: string | null;
  source_url: string | null;
  created_at: string;
  updated_at: string;
}

export type NoteRelationType = "related" | "supports" | "example_of";

export interface NoteRelation {
  id: string;
  user_id: string;
  source_note_id: string;
  target_note_id: string;
  relation_type: NoteRelationType;
  created_at: string;
}

export interface AiAnswerCitation {
  note_id: string;
  chunk_index: number;
  title: string;
  excerpt: string;
  source?: "knowledge" | "web";
  url?: string;
  fetched_at?: string;
}

export interface AiAnswer {
  id: string;
  user_id: string;
  note_id: string | null;
  question: string;
  answer: string;
  citations: AiAnswerCitation[];
  saved_to_note: boolean;
  created_at: string;
}

export interface NoteChunk {
  id: string;
  user_id: string;
  note_id: string;
  chunk_index: number;
  content: string;
  token_count: number | null;
  created_at: string;
}

export interface InternalizeResponse {
  note: Note;
  relations: NoteRelation[];
  concepts: string[];
  status: "success" | "error";
  message?: string;
}

export interface QaResponse {
  answer: string;
  citations: AiAnswerCitation[];
  answerId: string | null;
  sessionId?: string;
  mode?: "notes" | "general" | "online";
  intent?: "fact_query" | "summary" | "comparison" | "action_advice" | "retrospective";
  intentConfidence?: number;
  evidence_level?: "high" | "low" | "unknown";
  evidence_score?: number;
  evidence_items?: Array<{ note_id: string; title: string; chunk_index: number }>;
  uncertainties?: string[];
  retrieval?: { topK: number; threshold: number };
  retrieval_stage?: string;
  filters?: { tags: string[]; source?: string; dateGte?: string; dateLte?: string };
}

export interface QaSession {
  id: string;
  title: string;
  mode: "notes" | "general" | "online";
  pinned_note_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface QaMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations: AiAnswerCitation[];
  trace_id: string | null;
  created_at: string;
}

export interface NoteListItem {
  id: string;
  capture_item_id?: string | null;
  title: string;
  summary: string | null;
  tags: string[];
  concepts: string[];
  source: string | null;
  created_at: string;
}
