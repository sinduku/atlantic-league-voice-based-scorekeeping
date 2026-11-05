import { INITIAL_GAME_STATE, REGULATION_INNINGS, applyPlayToState, type GameState, type Play } from "@/types/game";
import { checkPlay } from "@/lib/checkPlay";
import { inningLabel, type LoggedPlay } from "@/lib/boxScore";

// Changing or removing a play partway through the game changes everything
// after it: the score, the outs, who is on base, even which half-inning a
// later play falls in. Rather than patch the later plays, the whole game is
// played again from the first pitch with the corrected list.
//
// Later plays keep what the scorer confirmed. Each is re-anchored to the
// inning it now falls in, and a runner moving off a base takes the name of
// whoever is now standing there. A play that no longer fits (it moves a runner
// off an empty base, or makes a fourth out) is kept as it was and reported,
// so the scorer can fix it too instead of having it quietly rewritten.

export interface ReplayProblem {
  // position in the replayed log
  index: number;
  message: string;
}

export interface ReplayResult {
  log: LoggedPlay[];
  state: GameState;
  problems: ReplayProblem[];
}

const BASE_KEY = { "1st": "first", "2nd": "second", "3rd": "third" } as const;

export function replayLog(
  entries: Pick<LoggedPlay, "play" | "slot">[],
  innings: number = REGULATION_INNINGS,
  start: GameState = INITIAL_GAME_STATE
): ReplayResult {
  const log: LoggedPlay[] = [];
  const problems: ReplayProblem[] = [];
  let state = start;

  entries.forEach(({ play, slot }, index) => {
    const before = state;
    const label = `#${index + 1} (${inningLabel(before)})`;
    if (before.final) {
      problems.push({ index, message: `${label}: the game was already over before this play.` });
    }

    // the runner now on each base, in place of whoever was there before the edit
    const runners = play.runners.map((r) => {
      const key = BASE_KEY[r.from as keyof typeof BASE_KEY];
      const now = key ? before.runners[key] : null;
      return now && now.toLowerCase() !== "runner" ? { ...r, runner: now } : r;
    });
    const checked = checkPlay({ ...play, runners }, before);
    for (const warning of checked.warnings) problems.push({ index, message: `${label}: ${warning}` });

    // the scorer's confidence stands; only where the play happened changes
    const replayed: Play = { ...checked.play, confidence: play.confidence };
    const after = applyPlayToState(before, replayed, innings);
    log.push({ play: replayed, before, after, slot });
    state = after;
  });

  return { log, state, problems };
}

// the plays, in order, with one changed or taken out
export function withEdit(log: LoggedPlay[], index: number, change: { play: Play; slot: number | null } | null) {
  const entries = log.map(({ play, slot }) => ({ play, slot }));
  if (change) entries[index] = change;
  else entries.splice(index, 1);
  return entries;
}
