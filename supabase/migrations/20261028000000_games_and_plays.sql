-- Everything the app needs in a fresh Supabase project: the tables confirmed
-- plays are saved to, and the access rules that let the site write to them.
-- Paste it into the dashboard's SQL Editor and run it. Running it again is
-- harmless.

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  home_team text,
  away_team text,
  -- the app has no sign-in yet, so games are saved without a user
  user_id uuid
);

create table if not exists public.plays (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- the play's position in the game; undo deletes by it
  play_index integer not null,
  -- the whole validated play as JSON
  data jsonb not null,
  user_id uuid
);

create index if not exists plays_game_id_play_index_idx on public.plays (game_id, play_index);

alter table public.games enable row level security;
alter table public.plays enable row level security;

-- The site writes with the public key, as the anon role, so these let anyone
-- holding that key read, add and remove rows. Fine for a class project; scope
-- them to auth.uid() = user_id once the app has sign-in.
grant usage on schema public to anon;
grant select, insert, delete on public.games, public.plays to anon;

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
