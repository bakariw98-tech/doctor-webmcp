// Built-in demo dataset. Used whenever YOUTUBE_API_KEY / DOCTOR_CHANNEL_ID are
// not configured, so the page, tools, and generative UI are fully testable
// with zero credentials. Everything served from here is labeled demo data.

import type { ChannelInfo, VideoDetails, VideoSummary } from "./types.js";

function thumb(title: string, hue: number): string {
  const short = title.length > 34 ? title.slice(0, 34) + "…" : title;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='480' height='360'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='hsl(${hue},55%,32%)'/>` +
    `<stop offset='1' stop-color='hsl(${(hue + 40) % 360},60%,18%)'/></linearGradient></defs>` +
    `<rect width='480' height='360' fill='url(#g)'/>` +
    `<circle cx='240' cy='150' r='46' fill='rgba(255,255,255,0.9)'/>` +
    `<polygon points='228,128 228,172 262,150' fill='hsl(${hue},55%,32%)'/>` +
    `<text x='24' y='262' font-family='Arial,sans-serif' font-size='26' font-weight='bold' fill='#fff'>${short}</text>` +
    `<text x='24' y='300' font-family='Arial,sans-serif' font-size='16' fill='rgba(255,255,255,0.75)'>Sample Health Channel · demo</text>` +
    `</svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg).replace(/'/g, "%27");
}

interface Fixture extends VideoDetails {
  tags: string[];
}

const VIDEOS: Fixture[] = [
  {
    video_id: "dGx7H8k2mQpA",
    title: "The Truth About Gut Health: 5 Foods Your Microbiome Loves",
    description:
      "A plain-English walkthrough of what the gut microbiome actually does, the five foods with the best evidence behind them, and the three habits that quietly wreck gut diversity.",
    published_at: "2026-06-14T15:00:00Z",
    duration: "14:22",
    tags: ["gut health", "microbiome", "digestion", "probiotics", "fiber"],
    watch_url: "https://www.youtube.com/watch?v=dGx7H8k2mQpA",
    thumbnail_url: "",
  },
  {
    video_id: "dGx7H8k2mQpB",
    title: "Why You're Bloated After Every Meal (And How to Fix It)",
    description:
      "Bloating is a symptom, not a diagnosis. Covers the most common causes — eating speed, FODMAPs, low stomach acid — and a simple two-week elimination approach.",
    published_at: "2026-05-02T15:00:00Z",
    duration: "11:47",
    tags: ["gut health", "bloating", "digestion", "FODMAP"],
    watch_url: "https://www.youtube.com/watch?v=dGx7H8k2mQpB",
    thumbnail_url: "",
  },
  {
    video_id: "dGx7H8k2mQpC",
    title: "Sleep: The 90-Minute Rule Nobody Told You About",
    description:
      "Sleep cycles explained without the jargon, why waking up groggy is usually a timing problem, and how to anchor your bedtime to complete 90-minute cycles.",
    published_at: "2026-04-11T15:00:00Z",
    duration: "13:05",
    tags: ["sleep", "energy", "recovery", "circadian rhythm"],
    watch_url: "https://www.youtube.com/watch?v=dGx7H8k2mQpC",
    thumbnail_url: "",
  },
  {
    video_id: "dGx7H8k2mQpD",
    title: "Blood Pressure: What Your Numbers Actually Mean",
    description:
      "Systolic vs diastolic in plain English, why a single high reading means less than you think, and the home-measurement protocol cardiologists recommend.",
    published_at: "2026-03-08T16:00:00Z",
    duration: "16:31",
    tags: ["blood pressure", "heart health", "hypertension"],
    watch_url: "https://www.youtube.com/watch?v=dGx7H8k2mQpD",
    thumbnail_url: "",
  },
  {
    video_id: "dGx7H8k2mQpE",
    title: "Vitamin D: Are You Actually Deficient?",
    description:
      "Who should get tested, what the numbers mean, why more supplement is not always better, and the sunlight math for northern latitudes.",
    published_at: "2026-02-15T16:00:00Z",
    duration: "10:18",
    tags: ["vitamin d", "supplements", "immunity"],
    watch_url: "https://www.youtube.com/watch?v=dGx7H8k2mQpE",
    thumbnail_url: "",
  },
  {
    video_id: "dGx7H8k2mQpF",
    title: "Sugar Cravings Are a Sleep Problem (Here's the Proof)",
    description:
      "The study linking one bad night of sleep to next-day sugar cravings, plus a practical evening routine that breaks the cycle.",
    published_at: "2026-01-19T16:00:00Z",
    duration: "12:56",
    tags: ["sugar", "cravings", "sleep", "nutrition", "habits"],
    watch_url: "https://www.youtube.com/watch?v=dGx7H8k2mQpF",
    thumbnail_url: "",
  },
  {
    video_id: "dGx7H8k2mQpG",
    title: "Walking After Meals: The Cheapest Health Hack There Is",
    description:
      "What the research says about post-meal walks and blood sugar, the minimum effective dose (it's smaller than you think), and how to build the habit.",
    published_at: "2025-12-07T16:00:00Z",
    duration: "9:44",
    tags: ["walking", "blood sugar", "exercise", "habits", "diabetes"],
    watch_url: "https://www.youtube.com/watch?v=dGx7H8k2mQpG",
    thumbnail_url: "",
  },
  {
    video_id: "dGx7H8k2mQpH",
    title: "Cholesterol Numbers, Decoded: LDL, HDL, and What to Do",
    description:
      "Reading a lipid panel without panic, which numbers matter most at different ages, and the lifestyle levers with the biggest effect size.",
    published_at: "2025-11-02T16:00:00Z",
    duration: "15:12",
    tags: ["cholesterol", "LDL", "HDL", "heart health"],
    watch_url: "https://www.youtube.com/watch?v=dGx7H8k2mQpH",
    thumbnail_url: "",
  },
];

// Fill in thumbnails once (kept out of the literal for readability).
const HUES = [160, 150, 210, 0, 45, 280, 120, 200];
VIDEOS.forEach((v, i) => {
  v.thumbnail_url = thumb(v.title, HUES[i % HUES.length]);
});

export const DEMO_CHANNEL: ChannelInfo = {
  channel_id: null,
  title: "Sample Health Channel",
  description:
    "Demo channel data. Connect a real YouTube channel by setting DOCTOR_CHANNEL_ID and YOUTUBE_API_KEY.",
  thumbnail_url: thumb("Sample Health Channel", 160),
  demo: true,
};

function toSummary(v: Fixture): VideoSummary {
  return {
    video_id: v.video_id,
    title: v.title,
    published_at: v.published_at,
    thumbnail_url: v.thumbnail_url,
    duration: v.duration,
    demo: true,
  };
}

function toDetails(v: Fixture): VideoDetails {
  return { ...toSummary(v), description: v.description, watch_url: v.watch_url };
}

/** Score a video against a query: title hits weigh most, then tags, then description. */
function score(v: Fixture, query: string): number {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return 0;
  const title = v.title.toLowerCase();
  const desc = v.description.toLowerCase();
  const tags = v.tags.join(" ").toLowerCase();
  let s = 0;
  for (const w of words) {
    if (title.includes(w)) s += 3;
    if (tags.includes(w)) s += 2;
    if (desc.includes(w)) s += 1;
  }
  return s;
}

export function fixtureSearch(query: string, max: number): VideoSummary[] {
  const ranked = VIDEOS.map((v) => ({ v, s: score(v, query) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || +new Date(b.v.published_at) - +new Date(a.v.published_at));
  return ranked.slice(0, max).map((r) => toSummary(r.v));
}

export function fixtureRecent(max: number): VideoSummary[] {
  return [...VIDEOS]
    .sort((a, b) => +new Date(b.published_at) - +new Date(a.published_at))
    .slice(0, max)
    .map(toSummary);
}

export function fixtureDetails(videoId: string): VideoDetails | null {
  const v = VIDEOS.find((x) => x.video_id === videoId);
  return v ? toDetails(v) : null;
}
