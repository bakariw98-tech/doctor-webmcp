// Agent command inbox — the closed control loop for the dashboard.
// POST /api/stage/command { action, ... } -> { ok, id } | { ok:false, error }
//
// The remote agent (no WebMCP in its browser) drives the dashboard through
// this endpoint instead of dropping raw JSON into the chat. The command is
// validated, stored as an invisible kind:"command" message, and the agent
// gets a synchronous ack. The page picks the command up on its next poll,
// executes it through the same runCommand() the WebMCP tools use, and posts
// a kind:"action" receipt card ("▸ show_stage · view: watch → switched to watch ✓")
// the agent reads on its next read_messages — so the loop is closed:
// ack on send, receipt card on execute.
//
// Actions:
//   show_stage   { view: home|watch|build|files }
//   open_file    { path }
//   preview_file { path }   (opens the file AND shows the HTML preview)
//   dock         { video_id }
//   announce     { text }   (stage banner: "Brodie · <text>")
import { chatConfigured, postMessage } from "../_lib/chat-store.js";
import type { ApiRequest, ApiResponse } from "../_lib/types.js";

const ACTIONS = ["show_stage", "open_file", "preview_file", "dock", "announce", "display_videos", "play_video"];
const STAGES = ["home", "watch", "build", "files", "taste"];

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  if (!chatConfigured())
    return res.status(503).json({ ok: false, error: "Chat database is not connected." });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";
  if (ACTIONS.indexOf(action) === -1)
    return res.status(400).json({ ok: false, error: "Unknown action. Use one of: " + ACTIONS.join(", ") });

  const params: Record<string, string | string[]> = { action };
  if (action === "show_stage") {
    const view = typeof body.view === "string" ? body.view : "";
    if (STAGES.indexOf(view) === -1)
      return res.status(400).json({ ok: false, error: "view must be one of: " + STAGES.join(", ") });
    params.view = view;
  }
  if (action === "open_file" || action === "preview_file") {
    const path = typeof body.path === "string" ? body.path.trim() : "";
    if (!path || path.indexOf("..") !== -1)
      return res.status(400).json({ ok: false, error: "A valid file path is required." });
    params.path = path;
  }
  if (action === "dock") {
    const video_id = typeof body.video_id === "string" ? body.video_id.trim() : "";
    if (!video_id)
      return res.status(400).json({ ok: false, error: "A video_id is required." });
    params.video_id = video_id;
  }
  if (action === "announce") {
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 120) : "";
    if (!text)
      return res.status(400).json({ ok: false, error: "Banner text is required." });
    params.text = text;
  }
  if (action === "display_videos") {
    const ids = Array.isArray(body.video_ids)
      ? body.video_ids.filter((v): v is string => typeof v === "string" && v.length > 0).slice(0, 12)
      : [];
    if (!ids.length)
      return res.status(400).json({ ok: false, error: "video_ids (non-empty array) is required." });
    params.video_ids = ids;
  }
  if (action === "play_video") {
    const video_id = typeof body.video_id === "string" ? body.video_id.trim() : "";
    if (!video_id)
      return res.status(400).json({ ok: false, error: "A video_id is required." });
    params.video_id = video_id;
  }

  try {
    const message = await postMessage({ name: "Brodie", text: JSON.stringify(params), kind: "command" });
    return res.status(200).json({ ok: true, id: message.id });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err instanceof Error ? err.message : "command store failed" });
  }
}
