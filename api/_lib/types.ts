// Shared types. Kept dependency-free so both Vercel functions and local tests can use them.

/** Minimal Vercel-style request/response shapes (no @vercel/node dependency). */
export interface ApiRequest {
  method?: string;
  query: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface ApiResponse {
  status(code: number): ApiResponse;
  json(obj: unknown): void;
  setHeader?(name: string, value: string): void;
}

export interface VideoSummary {
  video_id: string;
  title: string;
  published_at: string; // ISO date string
  thumbnail_url: string;
  duration: string; // human readable, e.g. "12:34"
  demo?: boolean; // true when served from built-in fixture data
}

export interface VideoDetails extends VideoSummary {
  description: string;
  watch_url: string;
}

export interface ChannelInfo {
  channel_id: string | null;
  title: string;
  description: string;
  thumbnail_url: string;
  demo: boolean; // true when no YouTube API key is configured
}

export type ChatKind = "chat" | "result";

export interface ChatMessage {
  id: string;
  name: string;
  text: string;
  kind: ChatKind;
  video_ids?: string[];
  ts: number;
}

export function q(req: ApiRequest, name: string, fallback = ""): string {
  const v = req.query[name];
  if (Array.isArray(v)) return v[0] ?? fallback;
  return v ?? fallback;
}

export function qInt(req: ApiRequest, name: string, fallback: number, min: number, max: number): number {
  const n = parseInt(q(req, name, ""), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
