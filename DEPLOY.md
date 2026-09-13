# Deploying YouTube Doctor (WebMCP edition)

The project is deploy-ready. Three steps:

## 1. Push to GitHub

```bash
cd ~/workspace/doctor-webmcp
git init
git add .
git commit -m "YouTube Doctor — WebMCP edition"
gh repo create doctor-webmcp --public --source=. --push
```

## 2. Import into Vercel

- Go to https://vercel.com/new and import the `doctor-webmcp` repo.
- Framework preset: **Other** (it's static HTML + serverless functions, no build step).
- No build command, no output directory overrides needed.

## 3. Environment variables + database

In the Vercel project → Settings → Environment Variables:

| Variable | Required? | What it does |
|---|---|---|
| `YOUTUBE_API_KEY` | No — but without it you get demo data | Server-side YouTube Data API v3 key. Never sent to the browser. |
| `DOCTOR_CHANNEL_ID` | No — optional shortcut | A default YouTube channel id (the `UC…` string) for the "his videos" shortcut. The app searches all of YouTube with or without it. |

Then hit **Deploy**. That's it.

## Connecting the chat database (1 minute, one time)

The room chat lives in a free Postgres database — no tokens, no extra accounts.

1. In the Vercel project dashboard, open the **Marketplace** (or Integrations) tab.
2. Find **Neon Postgres**, add it, and connect it to the `doctor-webmcp` project (free tier).
3. Vercel injects `DATABASE_URL` itself — there is nothing to copy.
4. Redeploy (or it picks it up on the next deploy). The chat panel lights up.

That's the whole setup. Messages are just web messages — like DMs. The human types on the page, the agent reads and replies through the `read_messages` / `send_message` tools. The page can be anywhere in the world; the tools are the interface.

## Graceful degradation (by design)

- **No YouTube key:** the API serves 8 built-in demo videos, clearly labeled "demo data". Every tool, the cards, and the player work end to end.
- **No KV database connected:** the chat panel shows a one-line setup hint instead of breaking. Everything else works.

## How the human + agent share the page

1. The human opens the deployed URL on their phone, picks a display name, and types e.g. *"find me a video about gut health"* in the **What do you want to watch?** box (it posts into the room chat).
2. The agent opens the same URL in its browser and calls the page's WebMCP tools: `read_messages` to see what the human typed, `search_videos` to search the channel, `display_videos` to render results as cards, `send_message` to reply. Where WebMCP isn't supported, the identical REST endpoints under `/api/tools/*` and `/api/chat/messages` work the same way.
3. Results render as video cards for the human; tapping a card (or the agent calling `play_video`) loads the embedded player. The human watches right there on the page.
