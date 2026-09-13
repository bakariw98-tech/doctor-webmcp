// Shared chat room, backed by the site's own database (Vercel KV).
// No third-party accounts, no tokens to copy: create a KV store in the
// Vercel dashboard (Storage tab) and connect it to this project — Vercel
// injects KV_REST_API_URL / KV_REST_API_TOKEN automatically.
import { kv } from "@vercel/kv";
import type { ChatKind, ChatMessage } from "./types.js";

const KEY = "ydoc:messages";
const MAX_KEEP = 200;

export function chatConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function getMessages(limit = 50): Promise<ChatMessage[]> {
  const msgs = await kv.lrange<ChatMessage>(KEY, -limit, -1);
  return msgs ?? [];
}

export async function postMessage(input: {
  name: string;
  text: string;
  kind: ChatKind;
  video_ids?: string[];
}): Promise<ChatMessage> {
  const msg: ChatMessage = {
    id: newId(),
    name: input.name.slice(0, 40),
    text: input.text.slice(0, 2000),
    kind: input.kind,
    video_ids: input.video_ids?.slice(0, 12),
    ts: Date.now(),
  };
  await kv.rpush(KEY, msg);
  await kv.ltrim(KEY, -MAX_KEEP, -1);
  return msg;
}
