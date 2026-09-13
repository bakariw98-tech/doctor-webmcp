// GET /api/tools/search?q=...&max=...&channel=...&order=relevance|date
// Searches all of YouTube; `channel` (a UC… id) narrows to one channel.
// `q` may be omitted when `channel` is given (with order=date => latest uploads).
import { defaultChannelId, searchVideos } from "../_lib/youtube.js";
import { q, qInt, type ApiRequest, type ApiResponse } from "../_lib/types.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method && req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const query = q(req, "q").trim();
  const channel = q(req, "channel").trim() || defaultChannelId();
  const orderRaw = q(req, "order", "relevance");
  const order = orderRaw === "date" ? "date" : "relevance";
  if (!query && !channel) {
    return res.status(400).json({ error: "Provide q (search keywords) or channel (a channel id), or both." });
  }
  const max = qInt(req, "max", 8, 1, 25);
  try {
    const { videos, demo } = await searchVideos(query, max, { channelId: channel, order });
    return res.status(200).json({ query, channel, order, count: videos.length, demo, videos });
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "search failed" });
  }
}
