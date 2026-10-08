import type { GameState, Play } from "@/types/game";

// Checks a parsed play against the bases as they stand, whichever parser it
// came from. A model will happily score "Ohtani steals home" with nobody on
// third; the scorer should see that before confirming, not after.
//
// It also fills in what the browser knows better than the model: the inning
// and half, and the names of runners already on base.

const BASE_KEY = { "1st": "first", "2nd": "second", "3rd": "third" } as const;

export interface CheckedPlay {
  play: Play;
  warnings: string[];
}

export function checkPlay(play: Play, state: GameState): CheckedPlay {
  const warnings: string[] = [];

  const runners = play.runners.map((r) => {
    const key = BASE_KEY[r.from as keyof typeof BASE_KEY];
    if (!key) return r;
    const onBase = state.runners[key];
    if (!onBase) {
      warnings.push(`Nobody is on ${r.from}, but the play moves a runner from there.`);
      return r;
    }
    return r.runner ? r : { ...r, runner: onBase };
  });

  const fromCounts = new Map<string, number>();
  for (const r of play.runners) fromCounts.set(r.from, (fromCounts.get(r.from) ?? 0) + 1);
  for (const [base, count] of fromCounts) {
    if (count > 1) warnings.push(`Two runners leave ${base}.`);
  }

  const sentOut = play.runners.filter((r) => r.to === "out").length;
  if (sentOut !== play.outs_recorded) {
    warnings.push(`The play records ${play.outs_recorded} out(s) but puts ${sentOut} runner(s) out.`);
  }
  if (state.outs + play.outs_recorded > 3) {
    warnings.push(`That would make ${state.outs + play.outs_recorded} outs in the inning.`);
  }

  return {
    play: {
      ...play,
      inning: state.inning,
      half: state.half,
      runners,
      confidence: warnings.length ? "low" : play.confidence,
    },
    warnings,
  };
}
