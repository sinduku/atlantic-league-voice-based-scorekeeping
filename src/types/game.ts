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
