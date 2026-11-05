import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { Play } from "@/types/game";

// Saving is best-effort: a scorekeeper at a live game has to keep working when
// the database is unreachable, so nothing here throws. Callers get a result
// object and decide how loudly to complain.
export type SaveResult<T> = { ok: true; data: T } | { ok: false; error: string };

function failure(error: unknown): { ok: false; error: string } {
  if (typeof error === "string") return { ok: false, error };
  if (error instanceof Error) return { ok: false, error: error.message };
  return { ok: false, error: "Unknown database error" };
}

// creates the row that plays hang off of. team names are optional so scoring
// can start before the lineups are known.
export async function createGame(
  homeTeam: string | null = null,
  awayTeam: string | null = null
): Promise<SaveResult<string>> {
  try {
    const { data, error } = await supabase
      .from("games")
      .insert({ home_team: homeTeam, away_team: awayTeam })
      .select("id")
      .single();

    if (error) return failure(error.message);
    if (!data?.id) return failure("Database did not return a game id");
    return { ok: true, data: data.id };
  } catch (e) {
    return failure(e);
  }
}

// stores one confirmed play. play_index keeps the log ordered even when two
// rows land inside the same timestamp.
export async function savePlay(
  gameId: string,
  playIndex: number,
  play: Play
): Promise<SaveResult<null>> {
  try {
    const { error } = await supabase.from("plays").insert({
      game_id: gameId,
      play_index: playIndex,
      data: play as unknown as Json,
    });

    if (error) return failure(error.message);
    return { ok: true, data: null };
  } catch (e) {
    return failure(e);
  }
}

// removes a play that was undone, so the saved log matches the screen
export async function deletePlay(gameId: string, playIndex: number): Promise<SaveResult<null>> {
  try {
    const { error } = await supabase.from("plays").delete().eq("game_id", gameId).eq("play_index", playIndex);
    if (error) return failure(error.message);
    return { ok: true, data: null };
  } catch (e) {
    return failure(e);
  }
}

// rewrites the saved plays from one point on, after a play there was changed
// or removed. delete and insert rather than update, which the site's database
// role isn't allowed to do
export async function replacePlaysFrom(gameId: string, fromIndex: number, plays: Play[]): Promise<SaveResult<null>> {
  try {
    const removed = await supabase.from("plays").delete().eq("game_id", gameId).gte("play_index", fromIndex);
    if (removed.error) return failure(removed.error.message);
    if (!plays.length) return { ok: true, data: null };
    const { error } = await supabase.from("plays").insert(
      plays.map((play, i) => ({ game_id: gameId, play_index: fromIndex + i, data: play as unknown as Json }))
    );
    if (error) return failure(error.message);
    return { ok: true, data: null };
  } catch (e) {
    return failure(e);
  }
}
