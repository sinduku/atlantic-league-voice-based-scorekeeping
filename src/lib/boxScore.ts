import type { GameState, Play } from "@/types/game";

// Builds the line score and batting lines from the confirmed plays. Each play
// is logged with the game state before and after it, so runs come from the
// actual change in score rather than from what the play claims.

export type Team = "away" | "home";

export interface LoggedPlay {
  play: Play;
  before: GameState;
  after: GameState;
  // the batting-order slot (0-8) this plate appearance was credited to, when
  // the batting team had a lineup entered; who is due up next is worked out
  // from it, so undoing a play puts the order back too
  slot?: number | null;
}

export interface TeamLine {
  // null for an inning the team hasn't batted in yet
  runsByInning: (number | null)[];
  runs: number;
  hits: number;
  errors: number;
}

export interface LineScore {
  innings: number;
  away: TeamLine;
  home: TeamLine;
}

export interface BattingLine {
  name: string;
  team: Team;
  pa: number;
  ab: number;
  r: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  bb: number;
  k: number;
}

export const HIT_ACTIONS = new Set(["single", "double", "triple", "home run"]);

// these happen between pitches and aren't anyone's plate appearance
const NOT_A_PLATE_APPEARANCE = new Set(["stolen base", "wild pitch", "passed ball", "balk"]);
// a plate appearance that doesn't count as an at bat
const NOT_AN_AT_BAT = new Set(["walk", "hit by pitch", "sacrifice fly"]);

export const isPlateAppearance = (action: string) => !NOT_A_PLATE_APPEARANCE.has(action.toLowerCase());

export const UNNAMED_BATTER = "Unnamed batter";

export const battingTeam = (half: GameState["half"]): Team => (half === "top" ? "away" : "home");
// the parser fills half from the game, so a play without one is from the top
export const teamOf = (play: Pick<Play, "half">): Team => (play.half === "bottom" ? "home" : "away");
const fieldingTeam = (half: GameState["half"]): Team => (half === "top" ? "home" : "away");

export function lineScore(log: LoggedPlay[], current: GameState): LineScore {
  const innings = Math.max(9, current.inning, ...log.map((e) => e.before.inning));
  const empty = (): TeamLine => ({ runsByInning: new Array(innings).fill(null), runs: 0, hits: 0, errors: 0 });
  const lines = { away: empty(), home: empty() };

  // an inning counts as batted once its half has started
  for (let i = 1; i <= innings; i++) {
    if (i <= current.inning) lines.away.runsByInning[i - 1] = 0;
    if (i < current.inning || (i === current.inning && current.half === "bottom")) lines.home.runsByInning[i - 1] = 0;
  }

  for (const { play, before, after } of log) {
    const team = battingTeam(before.half);
    const runs = after.score[team] - before.score[team];
    const index = before.inning - 1;
    lines[team].runsByInning[index] = (lines[team].runsByInning[index] ?? 0) + runs;
    lines[team].runs += runs;
    const action = play.action.toLowerCase();
    if (HIT_ACTIONS.has(action)) lines[team].hits++;
    if (action === "error") lines[fieldingTeam(before.half)].errors++;
  }

  return { innings, ...lines };
}

export function battingLines(log: LoggedPlay[]): BattingLine[] {
  const lines = new Map<string, BattingLine>();
  const order: string[] = [];
  // the first batting-order slot each batter was credited to, so a box score
  // with a lineup reads 1 through 9 with pinch hitters under who they replaced
  const slotOf = new Map<string, number>();

  const lineFor = (team: Team, name: string) => {
    const key = `${team}:${name.toLowerCase()}`;
    if (!lines.has(key)) {
      lines.set(key, { name, team, pa: 0, ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, k: 0 });
      order.push(key);
    }
    return lines.get(key)!;
  };

  for (const { play, before, slot } of log) {
    const team = battingTeam(before.half);
    const action = play.action.toLowerCase();
    const batter = play.batter?.trim() || null;

    if (!NOT_A_PLATE_APPEARANCE.has(action)) {
      const name = batter ?? UNNAMED_BATTER;
      const key = `${team}:${name.toLowerCase()}`;
      if (slot != null && !slotOf.has(key)) slotOf.set(key, slot);
      const line = lineFor(team, name);
      line.pa++;
      if (!NOT_AN_AT_BAT.has(action)) line.ab++;
      if (HIT_ACTIONS.has(action)) line.h++;
      if (action === "double") line.doubles++;
      if (action === "triple") line.triples++;
      if (action === "home run") line.hr++;
      if (action === "walk") line.bb++;
      if (action === "strikeout") line.k++;
      line.rbi += play.rbi || 0;
    }

    // runs go to whoever crossed the plate; the batter if they came from home
    for (const r of play.runners) {
      if (r.to.toLowerCase() !== "home") continue;
      const name = r.runner?.trim() || (r.from.toLowerCase() === "home" ? batter : null);
      if (name) lineFor(team, name).r++;
    }
  }

  // away batters then home, each team in batting-order slot; batters without a
  // slot come after the slotted ones in the order they first appeared, since
  // Array.sort is stable
  const teamRank = (key: string) => (lines.get(key)!.team === "away" ? 0 : 1);
  const position = (key: string) => slotOf.get(key) ?? Number.MAX_SAFE_INTEGER;
  return [...order]
    .sort((a, b) => teamRank(a) - teamRank(b) || position(a) - position(b))
    .map((key) => lines.get(key)!);
}

export function inningLabel(state: Pick<GameState, "half" | "inning">): string {
  return `${state.half === "top" ? "▲" : "▼"}${state.inning}`;
}
