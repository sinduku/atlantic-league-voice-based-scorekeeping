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
}

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
}

export const INITIAL_GAME_STATE: GameState = {
  inning: 1,
  half: "top",
  outs: 0,
  score: { away: 0, home: 0 },
  runners: { first: null, second: null, third: null },
};

export function applyPlayToState(state: GameState, play: Play): GameState {
  const next = {
    ...state,
    outs: state.outs + play.outs_recorded,
    score: { ...state.score },
    runners: { ...state.runners },
  };

  // Apply RBIs to score
  if (play.rbi > 0) {
    if (state.half === "top") {
      next.score.away += play.rbi;
    } else {
      next.score.home += play.rbi;
    }
  }

  // Apply runner movements from the AI response
  for (const r of play.runners) {
    const fromKey = baseToKey(r.from);
    const toKey = baseToKey(r.to);
    const runnerName = r.runner || (fromKey ? next.runners[fromKey] : null);

    // Clear origin base
    if (fromKey && next.runners[fromKey]) {
      next.runners[fromKey] = null;
    }

    // Place on destination base (if not scored/out)
    if (toKey && r.to !== "home" && r.to !== "out") {
      next.runners[toKey] = runnerName || "runner";
    }
  }

  // If batter reached base (hit, walk, HBP, error, FC)
  const reachActions = ["single", "double", "triple", "walk", "hit by pitch", "error", "fielder's choice"];
  if (play.batter && reachActions.includes(play.action.toLowerCase())) {
    const dest = actionToBase(play.action.toLowerCase());
    if (dest) {
      next.runners[dest] = play.batter;
    }
  }

  // Home run: clear all bases
  if (play.action.toLowerCase() === "home run") {
    next.runners = { first: null, second: null, third: null };
  }

  // Check for 3 outs → flip half-inning
  if (next.outs >= 3) {
    next.outs = 0;
    next.runners = { first: null, second: null, third: null };
    if (state.half === "top") {
      next.half = "bottom";
    } else {
      next.half = "top";
      next.inning = state.inning + 1;
    }
  }

  return next;
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
