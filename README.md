# Voice Scorekeeper ⚾

A real-time baseball scorekeeping app with voice-powered play logging. Built for the Atlantic League.

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

Edit `server/.env` and add your API key:

```env
OPENAI_API_KEY=sk-your-key-here
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
PORT=3001
```

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

The app will be running at `http://localhost:5173` and will call the backend at `http://localhost:3001`.

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

## Features

- 🎙️ Voice-to-play transcription via browser microphone
- 🤖 AI-powered play parsing (batter, action, runners, RBIs)
- 📊 Live scoreboard with inning tracking
- 🎯 Spray chart visualization
- 📋 Play-by-play log with confirmation flow

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
"K looking". `server/phrasings.js` teaches the model that vocabulary: it holds
the position numbers, the spray chart zones, and a set of worked
transcript-to-JSON examples that are injected into the system prompt.

```js
"E5" -> { action: "error", fielders_involved: ["5"], field_zone: 6, ... }
```

Two numbering systems are in play and they are not the same:

- **Position numbers** (`fielders_involved`): 1 pitcher, 2 catcher, 3 first, 4 second,
  5 third, 6 shortstop, 7 left, 8 center, 9 right.
- **Spray chart zones** (`field_zone`): where the ball landed, 1 left field line
  through 9 infield. These must match `ZONE_COORDS` in
  `src/components/SprayChart.tsx`, because that component is what plots the dot.
  A test fails if the two drift apart.

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
| `FEWSHOT_EXAMPLES` | `server/.env` | Worked examples added to the prompt (default: 8, `0` disables) |
| `VITE_API_URL` | Frontend `.env` | Backend URL (default: `http://localhost:3001`) |
