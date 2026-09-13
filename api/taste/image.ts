// Serves a taste variation the agent uploaded.
// GET /api/taste/image?job_id=<id>&slot=<slot> -> { ok, dataUri }
// (Data-URI JSON keeps this working through the minimal ApiResponse shape;
// the room fetches it and drops it straight into an <img>.)
import { tasteConfigured, getImageBytes } from "../_lib/taste-store.js";
import type { ApiRequest, ApiResponse } from "../_lib/types.js";
import { q } from "../_lib/types.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const jobId = q(req, "job_id").trim();
  const slot = q(req, "slot").trim() || "a";
  if (!jobId || !tasteConfigured()) {
    res.status(404).json({ ok: false, error: "Not found." });
    return;
  }
  try {
    const img = await getImageBytes(jobId, slot);
    if (!img) {
      res.status(404).json({ ok: false, error: "Not found." });
      return;
    }
    res.status(200).json({
      ok: true,
      dataUri: "data:" + img.contentType + ";base64," + img.data.toString("base64"),
    });
  } catch {
    res.status(404).json({ ok: false, error: "Not found." });
  }
}
