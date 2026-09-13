// Taste Room results — the agent's side of the WebMCP loop.
// POST /api/taste/results { job_id, images: [{ slot, contentType, dataBase64, styleLabel?, tags? }] }
// The agent generated the variations itself and uploads them back into the room.
import { tasteConfigured, getJob, completeJob, failJob } from "../_lib/taste-store.js";
import type { ApiRequest, ApiResponse } from "../_lib/types.js";

const MAX_IMAGE_B64 = 2_000_000; // ~1.5MB binary per image

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST only" });
    return;
  }
  if (!tasteConfigured()) {
    res.status(503).json({ ok: false, error: "Taste database is not connected." });
    return;
  }
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const jobId = str(body.job_id).trim();
    if (!jobId) {
      res.status(400).json({ ok: false, error: "job_id is required." });
      return;
    }
    const job = await getJob(jobId);
    if (!job) {
      res.status(404).json({ ok: false, error: "Job not found." });
      return;
    }

    // The agent can also report failure honestly instead of going silent.
    if (str(body.action) === "failed") {
      await failJob(jobId);
      res.status(200).json({ ok: true, status: "failed" });
      return;
    }

    const raw = body.images;
    if (!Array.isArray(raw) || raw.length === 0) {
      res.status(400).json({ ok: false, error: "images is required." });
      return;
    }
    const images = [];
    for (const item of raw.slice(0, 4)) {
      const it = (item ?? {}) as Record<string, unknown>;
      const slot = str(it.slot).trim().slice(0, 16) || "a";
      const contentType = str(it.contentType).trim() || "image/jpeg";
      if (contentType !== "image/jpeg" && contentType !== "image/png" && contentType !== "image/webp") {
        res.status(400).json({ ok: false, error: "contentType must be image/jpeg, image/png, or image/webp." });
        return;
      }
      const dataBase64 = str(it.dataBase64).replace(/\s+/g, "");
      if (!dataBase64 || dataBase64.length > MAX_IMAGE_B64) {
        res.status(413).json({ ok: false, error: "Image too large (1.5MB max each)." });
        return;
      }
      if (!/^[A-Za-z0-9+/=]+$/.test(dataBase64)) {
        res.status(400).json({ ok: false, error: "dataBase64 is not valid base64." });
        return;
      }
      const tags = Array.isArray(it.tags)
        ? (it.tags as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 12)
        : [];
      images.push({
        slot,
        contentType,
        dataBase64,
        styleLabel: str(it.styleLabel).trim().slice(0, 60),
        tags,
      });
    }
    await completeJob(jobId, images);
    res.status(200).json({ ok: true, status: "done", count: images.length });
  } catch (err) {
    res.status(502).json({ ok: false, error: err instanceof Error ? err.message : "taste results request failed" });
  }
}
