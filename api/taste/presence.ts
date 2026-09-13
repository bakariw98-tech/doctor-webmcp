// Taste Room presence — so you can tell the agent is actually there.
// GET  /api/taste/presence -> { ok, alive, lastSeen, lastSeenAgoSec, note }
// POST /api/taste/presence { note? } -> { ok } (the worker heartbeats every run)
import { tasteConfigured, heartbeat, getPresence } from "../_lib/taste-store.js";
import type { ApiRequest, ApiResponse } from "../_lib/types.js";

const ALIVE_MS = 5 * 60 * 1000;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!tasteConfigured()) {
    res.status(503).json({ ok: false, error: "Taste database is not connected." });
    return;
  }
  try {
    if (req.method === "POST") {
      const body = (req.body ?? {}) as Record<string, unknown>;
      await heartbeat(str(body.note).trim().slice(0, 120));
      res.status(200).json({ ok: true });
      return;
    }
    const p = await getPresence();
    if (!p) {
      res.status(200).json({ ok: true, alive: false, lastSeen: null, lastSeenAgoSec: null, note: "" });
      return;
    }
    const agoSec = Math.max(0, Math.round((Date.now() - p.lastSeen) / 1000));
    res.status(200).json({
      ok: true,
      alive: Date.now() - p.lastSeen < ALIVE_MS,
      lastSeen: p.lastSeen,
      lastSeenAgoSec: agoSec,
      note: p.note,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err instanceof Error ? err.message : "presence request failed" });
  }
}
