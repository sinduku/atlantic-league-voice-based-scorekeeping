# Voice Scorekeeper ⚾

A real-time baseball scorekeeping app with voice-powered play logging. Built for the Atlantic League.

**Live:** https://sinduku.github.io/atlantic-league-voice-based-scorekeeping/ — open it in
Chrome or Edge, since speech recognition depends on the browser.

## Deployment

Every push to `main` runs `.github/workflows/deploy.yml`, which installs, runs both test
suites, builds, and publishes to GitHub Pages. A failing test stops the deploy.

GitHub Pages only serves static files and cannot keep the AI key secret, so the live site
does not use the Express server. It parses plays through the `parse-play` Supabase edge
function instead, which holds the key on Supabase's side. The function carries a copy of
the server's prompt (`npm run sync:prompt` in `server/` refreshes it, and a test fails if
it falls behind). Replies from either backend are cleaned up in the browser by
`src/lib/normalizePlay.ts` before anything is shown: actions like "double play" are mapped
to ones the scoreboard understands, bases and fielders are reduced to plain values, and
the spray chart zone is worked out from where the ball went.

Changes to the edge function only reach the live site once deployed.
`.github/workflows/deploy-edge-function.yml` does that whenever anything under
`supabase/functions/` changes on `main`, and can also be run by hand from the Actions tab.
It tests first, deploys, then sends one real play to the live function to confirm it works.
It needs a Supabase access token saved as the `SUPABASE_ACCESS_TOKEN` repository secret.

To deploy by hand instead:

```bash
supabase functions deploy parse-play
# optional, fastest: parse with Groq's free tier instead of the Lovable gateway
supabase secrets set GROQ_API_KEY=gsk-your-key
```

The Express server is still what `npm run dev` talks to locally.

## Tech Stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Backend:** Node.js + Express (self-hosted)
- **AI:** Any OpenAI-compatible API (OpenAI, Ollama, Groq, Together, etc.)

## Quick Start

### 1. Start the backend

```bash
cd server
npm install
cp .env.example .env
```

Edit `server/.env` and add your API key. The example is set up for
[Groq](https://console.groq.com/keys), which is free (no card) and the fastest option:

```env
OPENAI_API_KEY=gsk-your-groq-key
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=llama-3.3-70b-versatile
AI_FALLBACK_MODEL=llama-3.1-8b-instant
PORT=3001
```

OpenAI, Gemini and Ollama settings are listed in `server/.env.example`.

Then start it:

```bash
npm start
```

### 2. Start the frontend

In a new terminal:

```bash
npm install
npm run dev
```

The app will be running at `http://localhost:8080` and will call the backend at `http://localhost:3001`.

Run `npm run dev` from the repo root, not from `server/` (there it starts the backend).

## Using Ollama (Free, Fully Local)

If you don't want to pay for an API key, you can use [Ollama](https://ollama.ai) to run models locally:

1. Install Ollama from https://ollama.ai
2. Pull a model: `ollama pull llama3`
3. Set your `server/.env`:

```env
OPENAI_API_KEY=not-needed
AI_BASE_URL=http://localhost:11434/v1
AI_MODEL=llama3
```

## How a play gets scored, and why it's fast

1. **Speech.** Chrome's built-in recognizer transcribes as you talk. With "Send
   automatically when I stop talking" on, the play is sent one second after you pause,
   so there's no button to tap. Turn it off to tap the button yourself.
2. **Names.** `src/lib/correctNames.ts` fixes player names the recognizer gets wrong
   ("ronald acuna" -> "Ronald Acuña", "guerero" -> "Guerrero") by matching against the
   player list in `src/data/players.json`, ignoring accents and allowing for
   sound-alike spellings. Baseball words are never treated as names.
3. **Shorthand, no AI.** `src/lib/shorthand.ts` scores plain shorthand in the browser in
   about a millisecond: "6-3", "6-4-3 double play", "E5", "F8", "L7", "P4", "U3",
   "K looking", "rung up", "ball four", "HBP". Anything longer goes to the AI.
4. **AI.** The server sends a short prompt (~900 tokens) and asks for JSON only, leaving
   out keys it can't tell, which roughly halves the reply. On Groq this takes well
   under a second. The browser also sends who is batting and pitching and the players
   named so far (`src/lib/parseContext.ts`), so names come back spelled the same way
   each time. If a reply isn't a usable play the model gets one retry with the problem
   explained, and if the main model is rate limited, down or too slow the fallback
   model answers, all inside `AI_TIMEOUT_MS`.
5. **Check.** `src/lib/checkPlay.ts` compares the play against the bases. A runner
   moved off an empty base, or outs that don't add up, are listed above the play
   and drop it to low confidence.

The review card shows which path scored the play and how long it took. The server
logs the model time and token counts for every play, each line tagged with a request
id that is also sent back to the browser (it's printed in the console when a play
fails), so a failed play can be found in the log. `GET /api/health?deep=1` also checks
the AI provider accepts the key, for a host's health check.

### Player names

```bash
npm run players:fetch          # this season and last
npm run players:fetch 2026     # one season
```

This pulls every MLB player and the Atlantic League rosters from the MLB Stats API
(statsapi.mlb.com, which carries the Atlantic League as a partner league). If that is
unreachable it falls back to the Chadwick Bureau register for MLB names only. Behind a
proxy, run it with `NODE_USE_ENV_PROXY=1`. Players it misses can be added one per line
in `src/data/extra-players.txt`.

## Features

- 🎙️ Voice-to-play transcription via browser microphone, sent automatically when you pause
- ⌨️ Type a play instead when the mic or the room won't cooperate
- ⚡ Plain shorthand ("6-3", "F8", "K looking") scored instantly in the browser
- 🤖 AI-powered play parsing (batter, action, runners, RBIs) for everything else
- ✅ Every play checked against the bases before you confirm it (Enter confirms, Esc rejects)
- 📊 Live scoreboard and line score (runs by inning, R / H / E) with your team names
- 🎯 Spray chart placed by direction and how the ball was hit; filled dots are hits,
  hollow are outs, and it filters by team
- ↩️ Undo the last confirmed play
- 💾 The game in progress survives a page refresh (Reset starts a new one)
- 📄 Export a PDF game report: line score, spray charts for both teams, batting lines
  and the full play-by-play
- 📑 Export CSVs of the play-by-play and the batting stats for Excel or Google Sheets

## Database (Supabase)

Confirmed plays are saved to the `games` and `plays` tables. Scoring still works
if the database is unreachable — saving happens behind the live scoreboard and a
failure only shows a note under the scoreboard.

| Table | Columns |
|---|---|
| `games` | `id`, `created_at`, `updated_at`, `home_team`, `away_team`, `user_id` |
| `plays` | `id`, `game_id`, `created_at`, `play_index`, `data`, `user_id` |

`plays.data` holds the whole validated play as JSON, and `play_index` keeps the
log in order.

### One-time setup

These tables ship with Row Level Security enabled and no policies, so every write
is rejected until you add them. The app has no sign-in, so it writes as the
`anon` role. Run this once in the Supabase dashboard under **SQL Editor**:

```sql
-- plays are recorded without a signed-in user
alter table public.games alter column user_id drop not null;
alter table public.plays alter column user_id drop not null;

drop policy if exists "anon can insert games" on public.games;
drop policy if exists "anon can read games" on public.games;
drop policy if exists "anon can delete games" on public.games;
create policy "anon can insert games" on public.games for insert to anon with check (true);
create policy "anon can read games" on public.games for select to anon using (true);
create policy "anon can delete games" on public.games for delete to anon using (true);

drop policy if exists "anon can insert plays" on public.plays;
drop policy if exists "anon can read plays" on public.plays;
drop policy if exists "anon can delete plays" on public.plays;
create policy "anon can insert plays" on public.plays for insert to anon with check (true);
create policy "anon can read plays" on public.plays for select to anon using (true);
create policy "anon can delete plays" on public.plays for delete to anon using (true);
```

These policies let anyone holding the publishable key read and write the tables,
which is fine for a demo. Add authentication and scope the policies to
`auth.uid() = user_id` before using this with real data.

### Verifying it works

```bash
npm run check:supabase
```

It writes a game and a play, reads them back, deletes them, and prints what
failed if anything did.

## Scorekeeping shorthand

Scorekeepers do not speak in full sentences. They say "6-4-3", "E5", "F8",
"K looking", "rung up", "twin killing". Plain shorthand is scored in the browser
(see above). For everything else, `server/phrasings.js` teaches the model the
vocabulary: position numbers, abbreviations (BB, HBP, FC, SF, DP...), broadcast
slang (dinger, frozen rope, can of corn, punched out...), and worked
transcript-to-JSON examples, the first few of which go into the system prompt
built by `server/prompt.js`. After changing either file, run
`npm run sync:prompt` in `server/` so the live site gets the same prompt.

```js
"E5" -> { action: "error", fielders_involved: ["5"], field_zone: 6, ... }
```

Two numbering systems are in play and they are not the same:

- **Position numbers** (`fielders_involved`): 1 pitcher, 2 catcher, 3 first, 4 second,
  5 third, 6 shortstop, 7 left, 8 center, 9 right.
- **Spray chart zones** (`field_zone`): where the ball landed, 1 left field line
  through 9 infield. These must match `ZONE_DIRECTIONS` in
  `src/lib/sprayGeometry.ts`, which places the dot.
  A test fails if the two drift apart.

The model is never shown spray chart zone numbers: the browser works the zone out
from `hit_location`, so `field_zone` in the examples is only there for the tests.

Adding a phrasing means adding one entry to `EXAMPLES`. Run the tests after:

```bash
cd server; npm test
```

Every example is checked against the real validator, and the RBI and out counts
are cross-checked against the runner movements.

## Configuration

| Env Variable | Where | Description |
|---|---|---|
| `OPENAI_API_KEY` | `server/.env` | Your AI provider API key |
| `AI_BASE_URL` | `server/.env` | API endpoint URL |
| `AI_MODEL` | `server/.env` | Model name |
| `PORT` | `server/.env` | Backend port (default: 3001) |
| `AI_FALLBACK_MODEL` | `server/.env` | Model tried once when the main one is rate limited, down or slow |
| `AI_JSON_MODE` | `server/.env` | Ask the provider for guaranteed JSON (default: `true`) |
| `AI_REASONING_EFFORT` | `server/.env` | For reasoning models only, e.g. `minimal` or `low` |
| `AI_TIMEOUT_MS` | `server/.env` | Give up on the AI after this long (default: 8000) |
| `FEWSHOT_EXAMPLES` | `server/.env` | Worked examples added to the prompt (default: 4, `0` disables) |
| `VITE_API_URL` | Frontend `.env` | Backend URL (default: `http://localhost:3001`) |
| `VITE_PARSE_URL` | Build env | Full parse endpoint, overrides `VITE_API_URL` (the deploy sets it to the edge function) |
| `BASE_PATH` | Build env | Path the site is served from (the deploy sets `/<repo-name>/`) |
