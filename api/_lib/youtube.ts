// YouTube Data API v3 access. All calls are server-side — the API key is never
// exposed to the browser. Search spans all of YouTube; a channel id is an
// optional per-call filter, never the walls of the app. When YOUTUBE_API_KEY
// is absent, callers fall back to the fixture dataset.

import { DEMO_CHANNEL, fixtureDetails, fixtureRecent, fixtureSearch } from "./fixtures.js";
import type { ChannelInfo, VideoDetails, VideoSummary } from "./types.js";

const YT = "https://www.googleapis.com/youtube/v3";

export function youTubeConfigured(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY);
}

/** Optional default channel (the "his videos" shortcut). The app works without it. */
export function defaultChannelId(): string | null {
  return process.env.DOCTOR_CHANNEL_ID || null;
}

function key(): string {
  return process.env.YOUTUBE_API_KEY as string;
}

/** "PT12M34S" -> "12:34", "PT1H2M3S" -> "1:02:03". */
export function parseDuration(iso: string): string {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return "";
  const h = parseInt(m[1] ?? "0", 10);
  const min = parseInt(m[2] ?? "0", 10);
  const s = parseInt(m[3] ?? "0", 10);
  const mm = h > 0 ? String(min).padStart(2, "0") : String(min);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

async function ytGet(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(YT + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", key());
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`YouTube API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

interface YTSearchItem {
  id: { videoId?: string };
  snippet: { title: string; publishedAt: string; description: string; thumbnails?: { medium?: { url?: string } } };
}

function toSummaryFromSearch(item: YTSearchItem, durationById: Map<string, string>): VideoSummary | null {
  const id = item.id?.videoId;
  if (!id) return null;
  return {
    video_id: id,
    title: item.snippet.title,
    published_at: item.snippet.publishedAt,
    thumbnail_url: item.snippet.thumbnails?.medium?.url ?? `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    duration: durationById.get(id) ?? "",
  };
}

async function durationsFor(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const data = (await ytGet("/videos", {
    part: "contentDetails",
    id: ids.join(","),
    maxResults: "50",
  })) as { items?: Array<{ id: string; contentDetails: { duration: string } }> };
  for (const item of data.items ?? []) map.set(item.id, parseDuration(item.contentDetails.duration));
  return map;
}

async function youTubeSearch(params: Record<string, string>): Promise<VideoSummary[]> {
  const data = (await ytGet("/search", {
    part: "snippet",
    type: "video",
    maxResults: "25",
    ...params,
  })) as { items?: YTSearchItem[] };
  const items = (data.items ?? []).filter((i) => i.id?.videoId);
  const durations = await durationsFor(items.map((i) => i.id.videoId as string));
  return items
    .map((i) => toSummaryFromSearch(i, durations))
    .filter((v): v is VideoSummary => v !== null);
}

export interface SearchOptions {
  channelId?: string | null;
  order?: "relevance" | "date";
}

/**
 * Search all of YouTube. Pass channelId to narrow to one channel
 * ("his videos"); pass order:"date" with a channel and no query for
 * that channel's latest uploads.
 */
export async function searchVideos(
  query: string,
  max: number,
  opts: SearchOptions = {}
): Promise<{ videos: VideoSummary[]; demo: boolean }> {
  if (!youTubeConfigured()) return { videos: fixtureSearch(query, max), demo: true };
  if (!query && !opts.channelId) throw new Error("Provide a search query, a channel id, or both.");
  const params: Record<string, string> = { order: opts.order ?? "relevance" };
  if (query) params.q = query;
  if (opts.channelId) params.channelId = opts.channelId;
  const videos = (await youTubeSearch(params)).slice(0, max);
  return { videos, demo: false };
}

/** What's popular on YouTube right now (most-popular chart). */
export async function trendingVideos(max: number): Promise<{ videos: VideoSummary[]; demo: boolean }> {
  if (!youTubeConfigured()) return { videos: fixtureRecent(max), demo: true };
  const data = (await ytGet("/videos", {
    part: "snippet,contentDetails",
    chart: "mostPopular",
    regionCode: "US",
    maxResults: String(Math.min(25, Math.max(1, max))),
  })) as {
    items?: Array<{
      id: string;
      snippet: { title: string; publishedAt: string; thumbnails?: { medium?: { url?: string } } };
      contentDetails: { duration: string };
    }>;
  };
  const videos: VideoSummary[] = (data.items ?? []).map((item) => ({
    video_id: item.id,
    title: item.snippet.title,
    published_at: item.snippet.publishedAt,
    thumbnail_url: item.snippet.thumbnails?.medium?.url ?? `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`,
    duration: parseDuration(item.contentDetails.duration),
  }));
  return { videos, demo: false };
}

export async function videoDetails(videoId: string): Promise<{ video: VideoDetails | null; demo: boolean }> {
  if (!youTubeConfigured()) return { video: fixtureDetails(videoId), demo: true };
  const data = (await ytGet("/videos", {
    part: "snippet,contentDetails",
    id: videoId,
    maxResults: "1",
  })) as {
    items?: Array<{
      id: string;
      snippet: {
        title: string;
        description: string;
        publishedAt: string;
        thumbnails?: { medium?: { url?: string } };
      };
      contentDetails: { duration: string };
    }>;
  };
  const item = data.items?.[0];
  if (!item) return { video: null, demo: false };
  return {
    video: {
      video_id: item.id,
      title: item.snippet.title,
      description: item.snippet.description,
      published_at: item.snippet.publishedAt,
      duration: parseDuration(item.contentDetails.duration),
      thumbnail_url:
        item.snippet.thumbnails?.medium?.url ?? `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`,
      watch_url: `https://www.youtube.com/watch?v=${item.id}`,
    },
    demo: false,
  };
}

export async function channelInfo(): Promise<ChannelInfo> {
  if (!youTubeConfigured()) return DEMO_CHANNEL;
  const cid = defaultChannelId();
  if (!cid) {
    return {
      channel_id: null,
      title: "all of YouTube",
      description: "Search all of YouTube. Pass a channel id to narrow to one channel.",
      thumbnail_url: "",
      demo: false,
    };
  }
  const data = (await ytGet("/channels", { part: "snippet", id: cid })) as {
    items?: Array<{ snippet: { title: string; description: string; thumbnails?: { medium?: { url?: string } } } }>;
  };
  const snip = data.items?.[0]?.snippet;
  return {
    channel_id: cid,
    title: snip?.title ?? "Unknown channel",
    description: (snip?.description ?? "").slice(0, 300),
    thumbnail_url: snip?.thumbnails?.medium?.url ?? "",
    demo: false,
  };
}
