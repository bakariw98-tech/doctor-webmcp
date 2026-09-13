// Agent tool catalog — every tool the room gives its agent, in one place.
// GET /api/agent/tools -> { ok, tools: [{ name, description, method, endpoint, params }] }
//
// Two ways to call: the WebMCP tools (navigator.modelContext) when your browser
// has WebMCP, or these plain HTTP endpoints when it doesn't. Same room, same tools.
import type { ApiRequest, ApiResponse } from "../_lib/types.js";

interface AgentTool {
  name: string;
  description: string;
  method: string;
  endpoint: string;
  params: string;
}

const TOOLS: AgentTool[] = [
  {
    name: "read_messages",
    description:
      "Read the room chat. Pass the newest_ts from your last check as since and you get only what's new — this is how you see what the human typed, with no polling loop.",
    method: "GET",
    endpoint: "/api/agent/messages",
    params: "since (cursor, ts in ms — only messages newer than this), limit (1-50, default 20)",
  },
  {
    name: "send_message",
    description:
      "Reply in the room chat as Brodie. The human sees it in the thread immediately — this is how you talk back.",
    method: "POST",
    endpoint: "/api/agent/messages",
    params: '{ "text": "your reply" }',
  },
  {
    name: "stage_command",
    description:
      "Drive the stage itself: switch views, open or preview a studio file, dock a video, or put a banner up. The page runs it and posts a receipt card.",
    method: "POST",
    endpoint: "/api/stage/command",
    params:
      'action: "show_stage" {view: home|watch|build|files|taste}, "open_file" {path}, "preview_file" {path}, "dock" {video_id}, "display_videos" {video_ids[]}, "play_video" {video_id}, "announce" {text}',
  },
  {
    name: "taste_list_jobs",
    description: "See the Taste Room queue. A pending job is yours — nobody else will take it.",
    method: "GET",
    endpoint: "/api/taste/jobs",
    params: "status=pending, or recent=1 for recent work",
  },
  {
    name: "taste_claim_job",
    description: "Claim a taste job before you start it. Only work it when ok comes back true.",
    method: "POST",
    endpoint: "/api/taste/jobs",
    params: '{ "action": "claim", "job_id": "..." }',
  },
  {
    name: "taste_upload_results",
    description:
      "Upload the two variations you made yourself — never a third-party image API. Each image under 1.4MB base64.",
    method: "POST",
    endpoint: "/api/taste/results",
    params: '{ "job_id": "...", "images": [{ "slot": "a"|"b", "contentType": "image/jpeg", "dataBase64": "...", "styleLabel": "...", "tags": ["..."] }] }',
  },
  {
    name: "taste_presence",
    description: "Check in so the human knows you're here. Every run, jobs or not.",
    method: "POST",
    endpoint: "/api/taste/presence",
    params: '{ "note": "what you are doing" } (optional)',
  },
  {
    name: "search_videos",
    description: "Search all of YouTube by keyword, or pull a channel's latest uploads.",
    method: "GET",
    endpoint: "/api/tools/search",
    params: "q, channel, max (1-25), order=relevance|date",
  },
  {
    name: "studio_files",
    description: "The studio: list, read, write, or delete files the human builds with you.",
    method: "GET/POST/DELETE",
    endpoint: "/api/studio/files",
    params: "GET ?path=… to read · POST { path, content } to write · DELETE ?path=… to delete",
  },
];

export default async function handler(_req: ApiRequest, res: ApiResponse) {
  res.status(200).json({ ok: true, tools: TOOLS });
}
