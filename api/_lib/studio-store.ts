// Vibe Coding Studio file store, backed by Neon Postgres (free tier via Vercel
// Marketplace). Same pattern as chat-store: Vercel injects DATABASE_URL
// automatically; the table is created lazily on first access, and starter
// files are seeded the first time the tree is listed while empty.
import { neon } from "@neondatabase/serverless";

export const MAX_CONTENT_BYTES = 200 * 1024;
const MAX_PATH_LEN = 200;

export interface StudioFile {
  path: string;
  content: string;
  updated_at: number;
}

export interface StudioFileEntry {
  path: string;
  updated_at: number;
}

export function studioConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function sql() {
  return neon(process.env.DATABASE_URL as string);
}

/** Normalize + validate a user-supplied path. Returns the clean path or null. */
export function validatePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let p = raw.trim().replace(/\\/g, "/");
  p = p.replace(/\/{2,}/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!p || p.length > MAX_PATH_LEN) return null;
  const segs = p.split("/");
  for (const s of segs) {
    if (!s || s === "." || s === "..") return null;
    if (!/^[\w][\w.\-+ ]*$/.test(s)) return null;
  }
  return p;
}

async function ensureTable(): Promise<void> {
  await sql()`
    CREATE TABLE IF NOT EXISTS ydoc_studio_files (
      path TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      updated_at BIGINT NOT NULL
    )`;
}

const SEEDS: Array<{ path: string; content: string }> = [
  {
    path: "README.md",
    content:
      "# Studio\n\nWelcome to the vibe coding studio. Build here — the agent writes\nfiles straight into this tree, and you edit them in the calm editor.\n\n- **Files** — anything you create lives here.\n- **Skills** — `skills/<name>/SKILL.md` and supporting files.\n- **Plugins** — `plugins/<name>/...` for installable extras.\n\nTalk to the agent in the room chat (same room as the Watch tab).\nDock a video in the mini player and keep it playing while you work.\n",
  },
  {
    path: "skills/example/SKILL.md",
    content:
      "# Example Skill\n\nA skill is a reusable capability the agent can invoke from the room.\n\n## What it does\n\nDescribe the skill here: when to use it, what it needs, what it returns.\n\n## Files\n\n- `SKILL.md` — this file (required)\n- anything else the skill needs can live next to it\n",
  },
  {
    path: "plugins/example/README.md",
    content:
      "# Example Plugin\n\nA plugin is an installable extra for the studio: a theme, a snippet\npack, a linter config — anything that drops into the tree.\n\n## Install\n\nAsk the agent to install it, or copy the files where they belong.\n",
  },
];

async function seedIfEmpty(): Promise<void> {
  const rows = (await sql()`SELECT COUNT(*)::int AS n FROM ydoc_studio_files`) as Array<{ n: number }>;
  if (rows.length > 0 && rows[0].n > 0) return;
  const now = Date.now();
  for (const f of SEEDS) {
    await sql()`INSERT INTO ydoc_studio_files (path, content, updated_at)
      VALUES (${f.path}, ${f.content}, ${now})
      ON CONFLICT (path) DO NOTHING`;
  }
}

interface Row {
  path: string;
  content?: string;
  updated_at: string | number;
}

export async function listFiles(): Promise<StudioFileEntry[]> {
  await ensureTable();
  await seedIfEmpty();
  const rows = (await sql()`
    SELECT path, updated_at FROM ydoc_studio_files ORDER BY path ASC`) as Row[];
  return rows.map((r) => ({ path: r.path, updated_at: Number(r.updated_at) }));
}

export async function getFile(path: string): Promise<StudioFile | null> {
  await ensureTable();
  const rows = (await sql()`
    SELECT path, content, updated_at FROM ydoc_studio_files WHERE path = ${path} LIMIT 1`) as Row[];
  if (rows.length === 0) return null;
  const r = rows[0];
  return { path: r.path, content: r.content ?? "", updated_at: Number(r.updated_at) };
}

export async function upsertFile(path: string, content: string): Promise<StudioFile> {
  await ensureTable();
  const now = Date.now();
  await sql()`INSERT INTO ydoc_studio_files (path, content, updated_at)
    VALUES (${path}, ${content}, ${now})
    ON CONFLICT (path) DO UPDATE SET content = EXCLUDED.content, updated_at = EXCLUDED.updated_at`;
  return { path, content, updated_at: now };
}

export async function deleteFile(path: string): Promise<boolean> {
  await ensureTable();
  const rows = (await sql()`DELETE FROM ydoc_studio_files WHERE path = ${path} RETURNING path`) as Row[];
  return rows.length > 0;
}
