// Taste Room — variation generator for the training harness.
// POST /api/taste/generate { prompt, likes?: string[], dislikes?: string[] }
// -> { ok, images: [{ url, styleId, styleLabel, tags, promptUsed }] }
//
// The harness (not the agent) does the "seeing": it picks two divergent
// style directions, steers them with the user's accumulated taste profile,
// and renders both through a real image model. The user's pick is the
// training signal; the profile is the asset.

import type { ApiRequest, ApiResponse } from "../_lib/types.js";

interface Style {
  id: string;
  label: string;
  tags: string[];
  suffix: string;
}

const STYLES: Style[] = [
  { id: "golden", label: "Golden hour", tags: ["warm light", "soft glow"], suffix: "warm golden-hour lighting, soft film grain, cozy atmosphere" },
  { id: "studio", label: "Bold studio", tags: ["high contrast", "studio light"], suffix: "bold studio lighting, high contrast, sharp detail" },
  { id: "minimal", label: "Minimal", tags: ["minimal", "negative space"], suffix: "minimalist composition, generous negative space, clean and simple" },
  { id: "vivid", label: "Vivid", tags: ["saturated color", "dramatic"], suffix: "rich saturated colors, dramatic lighting, vibrant energy" },
  { id: "pastel", label: "Pastel dream", tags: ["pastel", "dreamy"], suffix: "soft pastel tones, dreamy ethereal atmosphere" },
  { id: "noir", label: "Dark cinematic", tags: ["moody", "cinematic"], suffix: "moody dark cinematic lighting, deep shadows, film still" },
  { id: "natural", label: "Natural light", tags: ["natural light", "photorealistic"], suffix: "photorealistic, soft natural daylight, true-to-life color" },
  { id: "vector", label: "Vector art", tags: ["vector", "illustration"], suffix: "clean vector illustration style, flat shapes, crisp edges" },
];

const IMG = "https://image.pollinations.ai/prompt/";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").slice(0, 40);
}

function score(style: Style, likes: string[], dislikes: string[]): number {
  let s = 1;
  const lk = new Set(likes.map((t) => t.toLowerCase()));
  const dk = new Set(dislikes.map((t) => t.toLowerCase()));
  for (const t of style.tags) {
    const lt = t.toLowerCase();
    if (lk.has(lt)) s += 2;
    if (dk.has(lt)) s -= 3;
  }
  return Math.max(0.05, s);
}

function weightedPick(styles: Style[], likes: string[], dislikes: string[], excludeId?: string): Style {
  const pool = styles.filter((s) => s.id !== excludeId);
  const weights = pool.map((s) => score(s, likes, dislikes));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

// Second variation should genuinely differ from the first: minimize tag
// overlap, then apply taste weighting among the most-divergent candidates.
function divergentPick(styles: Style[], first: Style, likes: string[], dislikes: string[]): Style {
  const rest = styles.filter((s) => s.id !== first.id);
  const overlap = (s: Style) => s.tags.filter((t) => first.tags.indexOf(t) !== -1).length;
  const minOverlap = Math.min(...rest.map(overlap));
  const candidates = rest.filter((s) => overlap(s) === minOverlap);
  return weightedPick(candidates, likes, dislikes);
}

function buildUrl(finalPrompt: string): string {
  const seed = Math.floor(Math.random() * 999999);
  return (
    IMG +
    encodeURIComponent(finalPrompt) +
    "?width=768&height=768&seed=" +
    seed +
    "&nologo=true"
  );
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST only" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const prompt = str(body.prompt).trim().slice(0, 300);
  if (!prompt) {
    res.status(400).json({ ok: false, error: "A prompt is required." });
    return;
  }
  const likes = strArr(body.likes);
  const dislikes = strArr(body.dislikes);

  const tasteBits = likes.slice(0, 3);
  const tasteCtx = tasteBits.length ? ", leaning toward " + tasteBits.join(", ") : "";

  const a = weightedPick(STYLES, likes, dislikes);
  const b = divergentPick(STYLES, a, likes, dislikes);

  const promptA = prompt + ", " + a.suffix + tasteCtx;
  const promptB = prompt + ", " + b.suffix + tasteCtx;

  res.status(200).json({
    ok: true,
    images: [
      { url: buildUrl(promptA), styleId: a.id, styleLabel: a.label, tags: a.tags, promptUsed: promptA },
      { url: buildUrl(promptB), styleId: b.id, styleLabel: b.label, tags: b.tags, promptUsed: promptB },
    ],
  });
}
