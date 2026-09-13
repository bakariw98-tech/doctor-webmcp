// GET /api/tools/details?id=...
import { videoDetails } from "../_lib/youtube.js";
import { q, type ApiRequest, type ApiResponse } from "../_lib/types.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method && req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const id = q(req, "id").trim();
  if (!id) return res.status(400).json({ error: "Missing required query param: id" });
  try {
    const { video, demo } = await videoDetails(id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    return res.status(200).json({ demo, video });
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "details failed" });
  }
}
