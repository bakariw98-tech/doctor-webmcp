// GET /api/tools/channel
import { channelInfo } from "../_lib/youtube.js";
import type { ApiRequest, ApiResponse } from "../_lib/types.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method && req.method !== "GET") return res.status(405).json({ error: "GET only" });
  try {
    const channel = await channelInfo();
    return res.status(200).json({ channel });
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "channel failed" });
  }
}
