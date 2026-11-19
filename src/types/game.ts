export interface GameState {
  inning: number;
  half: "top" | "bottom";
  outs: number;
  score: { away: number; home: number };
  runners: {
    first: string | null;
    second: string | null;
    third: string | null;
  };
  // set once the game is over: the home team leads after the top of the last
  // scheduled inning, someone leads after a full extra inning, or the home team
  // goes ahead in the bottom of the last inning (a walk-off). Missing from
  // games saved before it existed, which reads as not over
  final?: boolean;
}

// Atlantic League games are nine innings; the second game of a doubleheader
// can be scheduled for seven
export const REGULATION_INNINGS = 9;

export interface Play {
  inning?: number | null;
  half?: string | null;
  batter?: string | null;
  pitcher?: string | null;
  action: string;
  description: string;
  runners: { from: string; to: string; runner?: string | null }[];
  rbi: number;
  outs_recorded: number;
  fielders_involved: string[];
  hit_location?: string | null;
  hit_type?: string | null;
  hit_hardness?: string | null;
  field_zone?: number | null;
  pitch_type?: string | null;
  pitch_location?: string | null;
  count?: string | null;
  confidence: "high" | "medium" | "low";
  // other actions the words could equally mean, when the parser saw more than
  // one reading; the scorer is asked to pick
  alternatives?: string[] | null;
  // every pitch of the plate appearance, in order (see src/lib/pitches.ts):
  // B ball, C called strike, S swinging strike, F foul, T foul tip, X in
  // play, H hit by pitch. Missing on plays scored without pitches
  pitches?: string[] | null;
  // where the scorer dragged the ball on the spray chart, in the chart's
  // own units; when set it wins over the spot worked out from the words
  spray?: { x: number; y: number; was?: string | null } | null;
  // a manager's challenge of the call on this play, and how it came out
  challenge?: Challenge | null;
}

export interface Challenge {
  // the team that challenged
  team: "away" | "home";
  // "stands": the call on the field was upheld; "overturned": it was
  // reversed, and the play was scored again the way the review saw it
  result: "stands" | "overturned";
  note?: string | null;
}

export const INITIAL_GAME_STATE: GameState = {
  inning: 1,
  half: "top",
  outs: 0,
  score: { away: 0, home: 0 },
  runners: { first: null, second: null, third: null },
};

export function applyPlayToState(state: GameState, play: Play, innings: number = REGULATION_INNINGS): GameState {
  const next: GameState = {
    ...state,
    outs: state.outs + play.outs_recorded,
    score: { ...state.score },
    runners: runnersAfter(state, play),
  };

  const runs = runsScored(play, state);
  if (runs > 0) {
    if (state.half === "top") {
      next.score.away += runs;
    } else {
      next.score.home += runs;
    }
  }

  const lastInning = state.inning >= innings;

  // Walk-off: the home team goes ahead in the bottom of the last inning (or any
  // extra one) and the game ends on the spot. Only the run that wins it
  // counts, unless it was a home run, when every run does (rule 7.01(g))
  if (state.half === "bottom" && lastInning && next.score.home > next.score.away && state.score.home <= state.score.away) {
    if (play.action.toLowerCase() !== "home run") next.score.home = state.score.away + 1;
    next.outs = Math.min(next.outs, 3);
    next.final = true;
    return next;
  }

  // Check for 3 outs → flip half-inning, unless that ends the game
  if (next.outs >= 3) {
    next.runners = { first: null, second: null, third: null };
    // the home team doesn't bat in the last inning if it's already ahead, and
    // an extra inning that ends with someone ahead ends the game
    const homeAhead = state.half === "top" && lastInning && next.score.home > next.score.away;
    const decided = state.half === "bottom" && lastInning && next.score.home !== next.score.away;
    if (homeAhead || decided) {
      next.outs = 3;
      next.final = true;
      return next;
    }
    next.outs = 0;
    if (state.half === "top") {
      next.half = "bottom";
    } else {
      next.half = "top";
      next.inning = state.inning + 1;
    }
  }

  return next;
}

// Where everyone stands once the play is over, before a third out clears the
// bases. Runners still on base when a half-inning ends were left on base.
export function runnersAfter(state: GameState, play: Play): GameState["runners"] {
  const runners = { ...state.runners };

  // Apply runner movements from the AI response
  for (const r of play.runners) {
    const fromKey = baseToKey(r.from);
    const toKey = baseToKey(r.to);
    const runnerName = r.runner || (fromKey ? runners[fromKey] : null);

    // Clear origin base
    if (fromKey && runners[fromKey]) {
      runners[fromKey] = null;
    }

    // Place on destination base (if not scored/out)
    if (toKey && r.to !== "home" && r.to !== "out") {
      runners[toKey] = runnerName || "runner";
    }
  }

  // If batter reached base (hit, walk, HBP, error, FC)
  const reachActions = ["single", "double", "triple", "walk", "hit by pitch", "error", "fielder's choice"];
  if (play.batter && reachActions.includes(play.action.toLowerCase())) {
    const dest = actionToBase(play.action.toLowerCase());
    if (dest) {
      runners[dest] = play.batter;
    }
  }

  // Home run: clear all bases
  if (play.action.toLowerCase() === "home run") {
    return { first: null, second: null, third: null };
  }

  return runners;
}

// A runner can't share a base. When the batter, or another runner, takes a
// base whose runner the play doesn't move, that runner is forced up one, and
// so on ahead of him. A parser reading "Soto walks" with the bases loaded
// often moves only the batter; without this the runner on first vanished
// and the run forced in from third never scored. Runners the play does move
// are left as they are, so this only ever fills in the forced minimum.
const FORCED_RBI = new Set(["walk", "hit by pitch", "single", "double", "triple"]);
const BASES = ["1st", "2nd", "3rd"] as const;
const KEYS = { "1st": "first", "2nd": "second", "3rd": "third" } as const;

export function withForcedRunners(play: Play, state: GameState): Play {
  const action = play.action.toLowerCase();
  // a home run brings in everyone on base, listed or not, and the batter: each
  // of them is a run for the box score and an rbi for the batter
  if (action === "home run") {
    const listed = new Set(play.runners.map((r) => r.from));
    const added: Play["runners"] = BASES.filter((b) => state.runners[KEYS[b]] && !listed.has(b)).map((b) => {
      const name = state.runners[KEYS[b]]!;
      return { from: b, to: "home", runner: name.toLowerCase() === "runner" ? null : name };
    });
    if (!listed.has("home")) added.push({ from: "home", to: "home", runner: play.batter ?? null });
    if (!added.length) return play;
    const runners = [...play.runners, ...added].sort((a, b) => (a.from === "home" ? 9 : -BASES.indexOf(a.from as (typeof BASES)[number])) - (b.from === "home" ? 9 : -BASES.indexOf(b.from as (typeof BASES)[number])));
    const crossed = runners.filter((r) => r.to === "home").length;
    return { ...play, runners, rbi: Math.max(play.rbi || 0, crossed) };
  }
  const moved = new Set(play.runners.map((r) => r.from));
  const coming = new Set(play.runners.filter((r) => r.to !== "out" && r.to !== "home").map((r) => r.to));
  if (!moved.has("home")) {
    const reach = actionToBase(action);
    if (reach) coming.add(reach === "first" ? "1st" : reach === "second" ? "2nd" : "3rd");
  }
  const added: Play["runners"] = [];
  BASES.forEach((base, i) => {
    const runner = state.runners[KEYS[base]];
    if (!runner || moved.has(base) || !coming.has(base)) return;
    const to = BASES[i + 1] ?? "home";
    added.push({ from: base, to, runner: runner.toLowerCase() === "runner" ? null : runner });
    coming.add(to);
  });
  if (!added.length) return play;
  const forcedIn = added.some((r) => r.to === "home") && FORCED_RBI.has(action) ? 1 : 0;
  // lead runner first, the way the parsers list them
  const order = (r: Play["runners"][number]) => (r.from === "home" ? 9 : -BASES.indexOf(r.from as (typeof BASES)[number]));
  return { ...play, runners: [...play.runners, ...added].sort((a, b) => order(a) - order(b)), rbi: (play.rbi || 0) + forcedIn };
}

// Every runner who crosses the plate counts, not just the ones credited as
// RBIs - a run on a wild pitch, passed ball or error is still a run. The rbi
// count is a floor in case the parser credited runs without listing the
// runners, and a home run always scores the batter plus everyone on base.
export function runsScored(play: Play, state: GameState): number {
  const crossed = play.runners.filter((r) => r.to.toLowerCase() === "home").length;
  let runs = Math.max(crossed, play.rbi || 0);
  if (play.action.toLowerCase() === "home run") {
    const onBase = [state.runners.first, state.runners.second, state.runners.third].filter(Boolean).length;
    runs = Math.max(runs, onBase + 1);
  }
  return runs;
}

function baseToKey(base: string): "first" | "second" | "third" | null {
  const b = base.toLowerCase().replace(/\s+/g, "");
  if (b === "1st" || b === "first" || b === "1b" || b === "firstbase") return "first";
  if (b === "2nd" || b === "second" || b === "2b" || b === "secondbase") return "second";
  if (b === "3rd" || b === "third" || b === "3b" || b === "thirdbase") return "third";
  return null;
}

function actionToBase(action: string): "first" | "second" | "third" | null {
  if (["single", "walk", "hit by pitch", "error", "fielder's choice"].includes(action)) return "first";
  if (action === "double") return "second";
  if (action === "triple") return "third";
  return null;
}
