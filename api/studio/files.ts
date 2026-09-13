// Vibe Coding Studio file API (backed by Neon Postgres via the Vercel Marketplace).
// GET    /api/studio/files          -> { files: [{ path, updated_at }] } (seeds on first empty list)
// GET    /api/studio/files?path=<p> -> { path, content }
// POST   /api/studio/files { path, content } -> { file: { path, updated_at } }
// DELETE /api/studio/files?path=<p> -> { deleted }
import {
  studioConfigured,
  listFiles,
  getFile,
  upsertFile,
  deleteFile,
  validatePath,
  MAX_CONTENT_BYTES,
} from "../_lib/studio-store.js";
import type { ApiRequest, ApiResponse } from "../_lib/types.js";
import { q } from "../_lib/types.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!studioConfigured()) {
    return res.status(503).json({
      error:
        "Studio database is not connected (add the Neon Postgres integration in the Vercel dashboard and connect it to this project).",
    });
  }

  try {
    if (req.method === "GET" || !req.method) {
      const raw = q(req, "path");
      if (raw) {
        const path = validatePath(raw);
        if (!path) return res.status(400).json({ error: "Invalid path." });
        const file = await getFile(path);
        if (!file) return res.status(404).json({ error: "Not found." });
        return res.status(200).json({ path: file.path, content: file.content });
      }
      const files = await listFiles();
      return res.status(200).json({ files });
    }

    if (req.method === "POST") {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const path = validatePath(body.path);
      if (!path) return res.status(400).json({ error: "Invalid path." });
      if (typeof body.content !== "string") return res.status(400).json({ error: "content must be a string." });
      if (body.content.length > MAX_CONTENT_BYTES) {
        return res.status(413).json({ error: "File too large (200KB max)." });
      }
      const file = await upsertFile(path, body.content);
      return res.status(200).json({ file: { path: file.path, updated_at: file.updated_at } });
    }

    if (req.method === "DELETE") {
      const path = validatePath(q(req, "path"));
      if (!path) return res.status(400).json({ error: "Invalid path." });
      const ok = await deleteFile(path);
      if (!ok) return res.status(404).json({ error: "Not found." });
      return res.status(200).json({ deleted: path });
    }

    return res.status(405).json({ error: "GET, POST, or DELETE only" });
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "studio request failed" });
  }
}
