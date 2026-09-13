// Agent room-chat tools — synchronous, for agents with no WebMCP in their browser.
//
// The page's WebMCP surface already defines read_messages / send_message, but
// those only run inside a WebMCP-capable browser. A remote agent drives the
// room chat here instead: one call to see what's new, one call to reply.
//
// GET  /api/agent/messages?since=<ts_ms>&limit=<n>
//      -> { ok, configured, messages, newest_ts }
//      since: cursor — only messages with ts greater than this. Omit or 0 for latest.
//      limit: max messages to return (1-50, default 20).
// POST /api/agent/messages { text }
//      -> { ok, message: { id, ts } }
//      Posts into the shared room chat as Brodie, synchronously.
import { chatConfigured, getMessages, postMessage } from "../_lib/chat-store.js";
import { qInt, type ApiRequest, type ApiResponse } from "../_lib/types.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method === "GET" || !req.method) {
    if (!chatConfigured())
      return res.status(200).json({ ok: true, configured: false, messages: [], newest_ts: 0 });
    const since = qInt(req, "since", 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = qInt(req, "limit", 20, 1, 50);
    try {
      const all = await getMessages(50);
      const fresh = all.filter((m) => m.ts > since).slice(-limit);
      const newest_ts = fresh.length ? fresh[fresh.length - 1].ts : since;
      return res.status(200).json({ ok: true, configured: true, messages: fresh, newest_ts });
    } catch (err) {
      return res.status(502).json({ ok: false, error: err instanceof Error ? err.message : "chat read failed" });
    }
  }

  if (req.method === "POST") {
    if (!chatConfigured())
      return res.status(503).json({ ok: false, error: "Chat database is not connected." });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return res.status(400).json({ ok: false, error: "text is required." });
    if (text.length > 2000)
      return res.status(400).json({ ok: false, error: "text is too long (max 2000 chars)." });
    try {
      const message = await postMessage({ name: "Brodie", text, kind: "chat" });
      return res.status(200).json({ ok: true, message: { id: message.id, ts: message.ts } });
    } catch (err) {
      return res.status(502).json({ ok: false, error: err instanceof Error ? err.message : "chat write failed" });
    }
  }

  return res.status(405).json({ ok: false, error: "GET or POST only" });
}
