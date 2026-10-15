import type { LoggedPlay, Team } from "@/lib/boxScore";
import { SLOTS, currentBatter, currentPitcher, hasBattingOrder, type Lineups } from "@/lib/lineup";
import type { GameState } from "@/types/game";

// What the AI parser is told about the game beyond the bases and the score:
// who is batting and pitching, and the players named so far, so "smith"
// comes back spelled the way the earlier plays had it. It costs a few dozen
// prompt tokens. The Supabase edge function ignores it.
export interface ParseContext {
  battingTeam?: string;
  fieldingTeam?: string;
  pitcher?: string;
  players: string[];
}

// the server keeps 25; the most recent are the likeliest to come up again
const MAX_PLAYERS = 20;

// "Away" and "Home" are the placeholders before team names are typed in, and
// applyPlayToState writes "runner" for a runner nobody named
const PLACEHOLDER_TEAMS = new Set(["away", "home"]);
const UNNAMED_RUNNER = "runner";

// with lineups entered, the pitcher comes from the fielding team's card and
// the batting order leads the player list, starting from whoever is due up
export interface LineupContext {
  lineups: Lineups;
  dueUp: number;
}

export function buildParseContext(
  log: LoggedPlay[],
  state: GameState,
  teamNames: Record<Team, string>,
  cards?: LineupContext
): ParseContext {
  const batting: Team = state.half === "top" ? "away" : "home";
  const fielding: Team = batting === "away" ? "home" : "away";
  const teamName = (team: Team) => {
    const name = teamNames[team]?.trim();
    return name && !PLACEHOLDER_TEAMS.has(name.toLowerCase()) ? name : undefined;
  };

  // the same half means the same team in the field, so the last pitcher named
  // in a top half is still pitching in the next top half
  const pitcher =
    (cards && currentPitcher(cards.lineups[fielding])) ??
    [...log].reverse().find((e) => e.before.half === state.half && e.play.pitcher)?.play.pitcher ??
    undefined;

  const players: string[] = [];
  const seen = new Set<string>();
  const add = (name: string | null | undefined) => {
    const trimmed = name?.trim();
    if (!trimmed || trimmed.toLowerCase() === UNNAMED_RUNNER || seen.has(trimmed.toLowerCase())) return;
    seen.add(trimmed.toLowerCase());
    players.push(trimmed);
  };

  const order = cards?.lineups[batting];
  if (order && hasBattingOrder(order)) {
    for (let i = 0; i < SLOTS; i++) add(currentBatter(order, (cards!.dueUp + i) % SLOTS));
  }

  // the runners on base now, then everyone named, most recent first
  add(state.runners.first);
  add(state.runners.second);
  add(state.runners.third);
  for (let i = log.length - 1; i >= 0 && players.length < MAX_PLAYERS; i--) {
    const { play } = log[i];
    add(play.batter);
    add(play.pitcher);
    for (const r of play.runners) add(r.runner);
  }

  return {
    battingTeam: teamName(batting),
    fieldingTeam: teamName(fielding),
    pitcher,
    players: players.slice(0, MAX_PLAYERS),
  };
}
