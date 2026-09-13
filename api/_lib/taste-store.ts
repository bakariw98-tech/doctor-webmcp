// Taste Room job queue — the WebMCP way.
// The room posts a job. An agent (Brodie) on the other end picks it up,
// generates the two variations itself, and uploads them back.
// Backed by Neon Postgres. Tables are created on first use.
import { neon } from "@neondatabase/serverless";

export function tasteConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function sql() {
  return neon(process.env.DATABASE_URL as string);
}

async function ensureTables(): Promise<void> {
  await sql()`
    CREATE TABLE IF NOT EXISTS taste_jobs (
      id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      likes TEXT NOT NULL DEFAULT '[]',
      dislikes TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`;
  await sql()`
    CREATE TABLE IF NOT EXISTS taste_images (
      job_id TEXT NOT NULL,
      slot TEXT NOT NULL,
      content_type TEXT NOT NULL,
      data_base64 TEXT NOT NULL,
      style_label TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      created_at BIGINT NOT NULL,
      PRIMARY KEY (job_id, slot)
    )`;
  await sql()`CREATE INDEX IF NOT EXISTS idx_taste_jobs_status ON taste_jobs (status)`;
  await sql()`
    CREATE TABLE IF NOT EXISTS taste_presence (
      id TEXT PRIMARY KEY,
      last_seen BIGINT NOT NULL,
      note TEXT NOT NULL DEFAULT ''
    )`;
}

// ---- Presence: the room knows the agent is actually there ----

export async function heartbeat(note: string): Promise<void> {
  await ensureTables();
  const now = Date.now();
  await sql()`INSERT INTO taste_presence (id, last_seen, note)
    VALUES ('brodie', ${now}, ${note})
    ON CONFLICT (id) DO UPDATE SET last_seen = EXCLUDED.last_seen, note = EXCLUDED.note`;
}

export async function getPresence(): Promise<{ lastSeen: number; note: string } | null> {
  await ensureTables();
  const rows = (await sql()`SELECT last_seen, note FROM taste_presence
    WHERE id = 'brodie' LIMIT 1`) as unknown as { last_seen: number | string; note: string }[];
  if (!rows.length) return null;
  return { lastSeen: Number(rows[0].last_seen), note: rows[0].note };
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export interface TasteJob {
  id: string;
  prompt: string;
  likes: string[];
  dislikes: string[];
  status: "pending" | "working" | "done" | "failed";
  created_at: number;
  updated_at: number;
}

interface JobRow {
  id: string;
  prompt: string;
  likes: string;
  dislikes: string;
  status: string;
  created_at: number | string;
  updated_at: number | string;
}

function toJob(row: JobRow): TasteJob {
  const s = row.status;
  return {
    id: row.id,
    prompt: row.prompt,
    likes: safeArr(row.likes),
    dislikes: safeArr(row.dislikes),
    status: s === "working" || s === "done" || s === "failed" ? s : "pending",
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  };
}

function safeArr(v: string): string[] {
  try {
    const a = JSON.parse(v);
    return Array.isArray(a) ? a.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function createJob(prompt: string, likes: string[], dislikes: string[]): Promise<TasteJob> {
  await ensureTables();
  const now = Date.now();
  const id = newId();
  await sql()`INSERT INTO taste_jobs (id, prompt, likes, dislikes, status, created_at, updated_at)
    VALUES (${id}, ${prompt}, ${JSON.stringify(likes)}, ${JSON.stringify(dislikes)}, 'pending', ${now}, ${now})`;
  return { id, prompt, likes, dislikes, status: "pending", created_at: now, updated_at: now };
}

export async function getJob(id: string): Promise<TasteJob | null> {
  await ensureTables();
  const rows = (await sql()`SELECT id, prompt, likes, dislikes, status, created_at, updated_at
    FROM taste_jobs WHERE id = ${id} LIMIT 1`) as unknown as JobRow[];
  return rows.length ? toJob(rows[0]) : null;
}

export async function listPendingJobs(): Promise<TasteJob[]> {
  await ensureTables();
  const rows = (await sql()`SELECT id, prompt, likes, dislikes, status, created_at, updated_at
    FROM taste_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 10`) as unknown as JobRow[];
  return rows.map(toJob);
}

export async function listRecentJobs(limit = 10): Promise<TasteJob[]> {
  await ensureTables();
  const rows = (await sql()`SELECT id, prompt, likes, dislikes, status, created_at, updated_at
    FROM taste_jobs ORDER BY created_at DESC LIMIT ${limit}`) as unknown as JobRow[];
  return rows.map(toJob);
}

export async function claimJob(id: string): Promise<boolean> {
  await ensureTables();
  const now = Date.now();
  const rows = (await sql()`UPDATE taste_jobs SET status = 'working', updated_at = ${now}
    WHERE id = ${id} AND status = 'pending' RETURNING id`) as unknown as { id: string }[];
  return rows.length > 0;
}

export async function failJob(id: string): Promise<void> {
  await ensureTables();
  const now = Date.now();
  await sql()`UPDATE taste_jobs SET status = 'failed', updated_at = ${now} WHERE id = ${id}`;
}

export interface TasteImageInput {
  slot: string;
  contentType: string;
  dataBase64: string;
  styleLabel: string;
  tags: string[];
}

export async function completeJob(id: string, images: TasteImageInput[]): Promise<void> {
  await ensureTables();
  const now = Date.now();
  for (const img of images) {
    await sql()`INSERT INTO taste_images (job_id, slot, content_type, data_base64, style_label, tags, created_at)
      VALUES (${id}, ${img.slot}, ${img.contentType}, ${img.dataBase64}, ${img.styleLabel}, ${JSON.stringify(img.tags)}, ${now})
      ON CONFLICT (job_id, slot) DO UPDATE SET
        content_type = EXCLUDED.content_type,
        data_base64 = EXCLUDED.data_base64,
        style_label = EXCLUDED.style_label,
        tags = EXCLUDED.tags,
        created_at = EXCLUDED.created_at`;
  }
  await sql()`UPDATE taste_jobs SET status = 'done', updated_at = ${now} WHERE id = ${id}`;
}

export interface TasteImageMeta {
  slot: string;
  styleLabel: string;
  tags: string[];
}

export async function listJobImages(jobId: string): Promise<TasteImageMeta[]> {
  await ensureTables();
  const rows = (await sql()`SELECT slot, style_label, tags FROM taste_images
    WHERE job_id = ${jobId} ORDER BY slot ASC`) as unknown as { slot: string; style_label: string; tags: string }[];
  return rows.map((r) => ({ slot: r.slot, styleLabel: r.style_label, tags: safeArr(r.tags) }));
}

export async function getImageBytes(jobId: string, slot: string): Promise<{ contentType: string; data: Buffer } | null> {
  await ensureTables();
  const rows = (await sql()`SELECT content_type, data_base64 FROM taste_images
    WHERE job_id = ${jobId} AND slot = ${slot} LIMIT 1`) as unknown as { content_type: string; data_base64: string }[];
  if (!rows.length) return null;
  return { contentType: rows[0].content_type, data: Buffer.from(rows[0].data_base64, "base64") };
}
