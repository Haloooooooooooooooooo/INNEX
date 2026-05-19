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
