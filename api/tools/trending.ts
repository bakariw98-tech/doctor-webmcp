// GET /api/tools/trending?max=... -> what's popular on YouTube right now
import { trendingVideos } from "../_lib/youtube.js";
import { qInt, type ApiRequest, type ApiResponse } from "../_lib/types.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method && req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const max = qInt(req, "max", 8, 1, 25);
  try {
    const { videos, demo } = await trendingVideos(max);
    return res.status(200).json({ count: videos.length, demo, videos });
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "trending failed" });
  }
}
