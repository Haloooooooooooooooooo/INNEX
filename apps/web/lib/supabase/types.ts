export type CaptureItemType = "text" | "url" | "image" | "document" | "video";

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
  summary: string | null;
  status: CaptureItemStatus;
  tags: string[];
  created_at: string;
  updated_at: string;
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

export type NoteRelationType = "related" | "extends" | "contradicts" | "derives_from";

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
}

export interface NoteListItem {
  id: string;
  title: string;
  summary: string | null;
  tags: string[];
  concepts: string[];
  source: string | null;
  created_at: string;
}
