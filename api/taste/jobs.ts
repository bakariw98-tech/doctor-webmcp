// Taste Room jobs — the room's side of the WebMCP loop.
// POST /api/taste/jobs { prompt, likes?, dislikes? } -> { ok, job_id, status }
// POST /api/taste/jobs { action: "claim", job_id }   -> { ok } (agent picked it up)
// GET  /api/taste/jobs?id=<id>                      -> { ok, job, images? }
// GET  /api/taste/jobs?status=pending               -> { ok, jobs } (agent polls)
import {
  tasteConfigured,
  createJob,
  getJob,
  listPendingJobs,
  claimJob,
  listJobImages,
} from "../_lib/taste-store.js";
import type { ApiRequest, ApiResponse } from "../_lib/types.js";
import { q } from "../_lib/types.js";

const SITE = "https://doctor-webmcp.vercel.app";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").slice(0, 40);
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!tasteConfigured()) {
    res.status(503).json({ ok: false, error: "Taste database is not connected." });
    return;
  }
  try {
    if (req.method === "POST") {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (str(body.action) === "claim") {
        const jobId = str(body.job_id).trim();
        if (!jobId) {
          res.status(400).json({ ok: false, error: "job_id is required." });
          return;
        }
        const claimed = await claimJob(jobId);
        res.status(200).json({ ok: claimed });
        return;
      }
      const prompt = str(body.prompt).trim().slice(0, 300);
      if (!prompt) {
        res.status(400).json({ ok: false, error: "A prompt is required." });
        return;
      }
      const job = await createJob(prompt, strArr(body.likes), strArr(body.dislikes));
      res.status(200).json({ ok: true, job_id: job.id, status: job.status });
      return;
    }

    if (req.method === "GET" || !req.method) {
      if (q(req, "status") === "pending") {
        const jobs = await listPendingJobs();
        res.status(200).json({ ok: true, jobs: jobs.map((j) => ({ id: j.id, prompt: j.prompt, likes: j.likes, dislikes: j.dislikes })) });
        return;
      }
      const id = q(req, "id").trim();
      if (!id) {
        res.status(400).json({ ok: false, error: "id is required." });
        return;
      }
      const job = await getJob(id);
      if (!job) {
        res.status(404).json({ ok: false, error: "Job not found." });
        return;
      }
      const out: Record<string, unknown> = {
        ok: true,
        job: { id: job.id, prompt: job.prompt, status: job.status },
      };
      if (job.status === "done") {
        const images = await listJobImages(job.id);
        out.images = images.map((img) => ({
          slot: img.slot,
          url: SITE + "/api/taste/image?job_id=" + encodeURIComponent(job.id) + "&slot=" + encodeURIComponent(img.slot),
          styleLabel: img.styleLabel,
          tags: img.tags,
        }));
      }
      res.status(200).json(out);
      return;
    }

    res.status(405).json({ ok: false, error: "GET or POST only" });
  } catch (err) {
    res.status(502).json({ ok: false, error: err instanceof Error ? err.message : "taste jobs request failed" });
  }
}
