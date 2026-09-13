// Shared chat room, backed by Neon Postgres (free tier via Vercel Marketplace).
// Add the Neon integration in the Vercel dashboard and connect it to this
// project — Vercel injects DATABASE_URL automatically. Nothing to copy.
import { neon } from "@neondatabase/serverless";
import type { ChatKind, ChatMessage } from "./types.js";

const MAX_KEEP = 200;

export function chatConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function sql() {
  return neon(process.env.DATABASE_URL as string);
}

async function ensureTable(): Promise<void> {
  await sql()`
    CREATE TABLE IF NOT EXISTS ydoc_messages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      text TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'chat',
      video_ids TEXT,
      ts BIGINT NOT NULL
    )`;
  await sql()`CREATE INDEX IF NOT EXISTS idx_ydoc_messages_ts ON ydoc_messages (ts)`;
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

interface Row {
  id: string;
  name: string;
  text: string;
  kind: string;
  video_ids: string | null;
  ts: string | number;
}

function toMessage(row: Row): ChatMessage {
  const k = row.kind;
  return {
    id: row.id,
    name: row.name,
    text: row.text,
    kind: k === "result" || k === "command" || k === "system" || k === "action" ? k : "chat",
    video_ids: row.video_ids ? (JSON.parse(row.video_ids) as string[]) : undefined,
    ts: Number(row.ts),
  };
}

export async function getMessages(limit = 50): Promise<ChatMessage[]> {
  await ensureTable();
  const rows = (await sql()`
    SELECT id, name, text, kind, video_ids, ts
    FROM ydoc_messages
    ORDER BY ts DESC
    LIMIT ${limit}`) as Row[];
  return rows.reverse().map(toMessage);
}

export async function postMessage(input: {
  name: string;
  text: string;
  kind: ChatKind;
  video_ids?: string[];
}): Promise<ChatMessage> {
  await ensureTable();
  const msg: ChatMessage = {
    id: newId(),
    name: input.name.slice(0, 40),
    text: input.text.slice(0, 2000),
    kind: input.kind,
    video_ids: input.video_ids?.slice(0, 12),
    ts: Date.now(),
  };
  await sql()`
    INSERT INTO ydoc_messages (id, name, text, kind, video_ids, ts)
    VALUES (${msg.id}, ${msg.name}, ${msg.text}, ${msg.kind},
            ${msg.video_ids ? JSON.stringify(msg.video_ids) : null}, ${msg.ts})`;
  await sql()`
    DELETE FROM ydoc_messages
    WHERE id NOT IN (SELECT id FROM ydoc_messages ORDER BY ts DESC LIMIT ${MAX_KEEP})`;
  return msg;
}
