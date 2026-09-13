// Shared chat room (backed by Neon Postgres via the Vercel Marketplace).
// GET  /api/chat/messages -> { configured, messages }
// POST /api/chat/messages { name, text, kind?, video_ids? } -> { message }
import { chatConfigured, getMessages, postMessage } from "../_lib/chat-store.js";
import type { ApiRequest, ApiResponse, ChatKind } from "../_lib/types.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method === "GET" || !req.method) {
    if (!chatConfigured()) return res.status(200).json({ configured: false, messages: [] });
    try {
      const messages = await getMessages(50);
      return res.status(200).json({ configured: true, messages });
    } catch (err) {
      return res.status(502).json({ error: err instanceof Error ? err.message : "chat read failed" });
    }
  }

  if (req.method === "POST") {
    if (!chatConfigured()) return res.status(503).json({ error: "Chat database is not connected (add the Neon Postgres integration in the Vercel dashboard and connect it to this project)." });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const kind: ChatKind =
      body.kind === "result" ? "result" : body.kind === "system" ? "system" : "chat";
    const video_ids = Array.isArray(body.video_ids) ? body.video_ids : undefined;
    if (!name || !text) return res.status(400).json({ error: "Both name and text are required." });
    try {
      const message = await postMessage({ name, text, kind, video_ids });
      return res.status(200).json({ message });
    } catch (err) {
      return res.status(502).json({ error: err instanceof Error ? err.message : "chat write failed" });
    }
  }

  return res.status(405).json({ error: "GET or POST only" });
}
