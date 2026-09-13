# YouTube Doctor — WebMCP edition

A single web page that is **both** a WebMCP tool surface for AI browser agents **and** a shared room where a human and an agent are on the same page.

The human types *"find me a video about gut health"*. A browser-use agent with the same page open reads it, calls the page's WebMCP tools to search (no clicking, no typing into YouTube), and renders the results back into the page as watchable video cards. Nobody pays per-search API credits — the agent does the searching with its own already-running brain.

## What's here

```
index.html            the page (prompt, results, player, chat)
style.css             dark, mobile-first styling
app.js                WebMCP registration, generative UI, chat polling
vercel.json           nodejs20.x for /api functions
api/
  _lib/
    types.ts          shared types + tiny req/res/query helpers
    fixtures.ts       8 demo videos (used when no YouTube key is set)
    youtube.ts        YouTube Data API v3 client (server-side only)
    chat-store.ts      Vercel KV chat store: the room's messages, no external accounts
  tools/
    search.ts         GET /api/tools/search?q=...&max=...&channel=...&order=...
    trending.ts       GET /api/tools/trending?max=...
    details.ts        GET /api/tools/details?id=...
    channel.ts        GET /api/tools/channel
  chat/
    messages.ts       GET/POST /api/chat/messages
```

## WebMCP tools (registered via `navigator.modelContext`)

| Tool | What it does |
|---|---|
| `search_videos` | Search **all of YouTube**: `{ query?, max_results?, channel_id?, order? }` — `channel_id` narrows to one channel; omit `query` with a channel for its latest uploads |
| `list_trending_videos` | What's popular on YouTube right now: `{ max_results? }` |
| `get_video_details` | Full details for one video: `{ video_id }` |
| `display_videos` | **Generative UI** — renders video cards into the page: `{ video_ids[] }` |
| `play_video` | Loads a video into the embedded player: `{ video_id }` |
| `read_messages` | Read the room chat — how the agent sees what the human typed: `{ limit? }` |
| `send_message` | Post into the room chat as the agent: `{ text, name?, kind?, video_ids? }` |

Every tool's `execute` calls the matching REST endpoint above, so the two surfaces can never drift apart. The REST endpoints work today with zero WebMCP support — that's the day-one hedge.

## Local dev / testing

```bash
npm install
npm run typecheck   # tsc --noEmit
```

API routes are plain dependency-free functions; the fixture path (no credentials) is fully testable offline.

## Environment variables

`YOUTUBE_API_KEY` → live YouTube search, else demo fixtures.
`DOCTOR_CHANNEL_ID` (optional) → a default channel for the "his videos" shortcut. The app searches all of YouTube with or without it.
Connect a **KV** database in the Vercel dashboard (Storage tab) → shared room chat, else a setup hint. No tokens to copy — Vercel injects the credentials.
