export const SCREEN_ORDER = ["phone_call", "voip_list", "ai_summary", "staff_stats", "report"] as const;
export type ScreenType = (typeof SCREEN_ORDER)[number];
export type PhotoKind = "site" | "screen" | "scene";
export type Verdict = "pending" | "match" | "exaggeration" | "unsupported";
export type SourceType = "card" | "photo" | "memo";

export interface Guideline {
  required_keywords: string[];
  title_phrases: string[];
  footer_lines: string[];
  image_order: string[];
  sections: { no: number; title: string; intent: string }[];
  missions: { no: number; text: string; check: "code" | "ai" }[];
  hashtags: string[];
}

export interface CardCitation {
  material_id: string;
  page_no: number;
  cited_text: string;
}

export interface Card {
  id: string;
  code: string;
  claim: string;
  benefit: string;
  condition: string | null;
  citations: CardCitation[];
  priority_score: number;
  status: "active" | "archived";
}

export interface Photo {
  id: string;
  post_id: string;
  storage_path: string;
  masked: boolean;
  kind: PhotoKind | null;
  screen_type: string | null;
  description: string | null;
  order_index: number | null;
  created_at: string;
}

export interface Sentence {
  id: string;
  post_id: string;
  section_no: number;
  order_no: number;
  text: string;
  source_type: SourceType;
  source_ref: string;
  verdict: Verdict;
  verdict_reason: string | null;
  evidence: Evidence[];
  suggestion: string | null;
  deleted: boolean;
}

export interface Evidence {
  material_id: string | null;
  material: string;
  page_no: number;
  quote: string;
}

export interface Post {
  id: string;
  title: string | null;
  memo: string;
  status: "draft" | "approved" | "published";
  hashtags: string[] | null;
  omitted_missions: { no: number; reason: string }[];
  published_url: string | null;
  rewrite_count: number;
  injection_notes: string[];
  is_eval: boolean;
  created_at: string;
  approved_at: string | null;
  published_at: string | null;
}
