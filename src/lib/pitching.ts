import { HIT_ACTIONS, battingTeam, isPlateAppearance, type LoggedPlay, type Team } from "@/lib/boxScore";

// Pitching lines built from the confirmed plays, the same way batting lines
// are. Each play is charged to the pitcher it names (filled from the lineup
// when one is entered).
//
// Runs follow the inherited-runner rule: a run belongs to the pitcher who put
// that runner on base, even if he has been relieved by the time the runner
// scores.
//
// Earned runs follow the parts of rule 9.16 the log can see, and an official
// scorer's judgment can still differ:
// - a runner who reached on an error never scores an earned run
// - a run that scores on an error or a passed ball is unearned
// - each error that let the batter reach counts as the out it should have
//   been, and once those and the real outs make three, every later run in the
//   inning is unearned
// Errors made on some other play (a single plus a throwing error, say) aren't
// logged as errors, so they can't be taken out.

export interface PitchingLine {
  name: string;
  team: Team;
  outs: number;
  bf: number;
  h: number;
  r: number;
  // earned runs, as far as the log can tell (see above)
  er: number;
  bb: number;
  hbp: number;
  k: number;
  hr: number;
  // from the tap counter; null when nobody counted
  pitches: number | null;
}

export const UNNAMED_PITCHER = "Unnamed pitcher";

export const pitcherKey = (team: Team, name: string) => `${team}:${name.trim().toLowerCase()}`;

// 17 outs is 5.2 innings: the digit after the point is outs, not tenths
export const inningsPitched = (outs: number) => `${Math.floor(outs / 3)}.${outs % 3}`;

const fieldingTeam = (half: "top" | "bottom"): Team => (half === "top" ? "home" : "away");

export function pitchingLines(log: LoggedPlay[], pitchCounts: Record<string, number> = {}): PitchingLine[] {
  const lines = new Map<string, PitchingLine>();
  const order: string[] = [];

  const lineFor = (team: Team, name: string) => {
    const key = pitcherKey(team, name);
    if (!lines.has(key)) {
      lines.set(key, { name, team, outs: 0, bf: 0, h: 0, r: 0, er: 0, bb: 0, hbp: 0, k: 0, hr: 0, pitches: pitchCounts[key] ?? null });
      order.push(key);
    }
    return key;
  };

  // runner name -> the pitcher who let him on, for the half-inning in progress
  let responsible = new Map<string, string>();
  // runners who reached on an error, and the outs errors cost the defense
  let reachedOnError = new Set<string>();
  let errorOuts = 0;
  let half = "";

  for (const { play, before, after } of log) {
    const thisHalf = `${before.inning}-${before.half}`;
    if (thisHalf !== half) {
      // the bases are empty at the start of every half-inning
      responsible = new Map();
      reachedOnError = new Set();
      errorOuts = 0;
      half = thisHalf;
    }

    const batting = battingTeam(before.half);
    const key = lineFor(fieldingTeam(before.half), play.pitcher?.trim() || UNNAMED_PITCHER);
    const line = lines.get(key)!;
    const action = play.action.toLowerCase();
    const batter = play.batter?.trim() || null;

    // the third out ends the inning, so a play can't record more than are left
    line.outs += Math.max(0, Math.min(play.outs_recorded || 0, 3 - before.outs));
    if (isPlateAppearance(action)) line.bf++;
    if (HIT_ACTIONS.has(action)) line.h++;
    if (action === "home run") line.hr++;
    if (action === "walk") line.bb++;
    if (action === "hit by pitch") line.hbp++;
    if (action === "strikeout") line.k++;

    // charge each run to whoever let that runner on; the score is the
    // authority on how many runs there were, the runner list on whose they were
    const runs = Math.max(0, after.score[batting] - before.score[batting]);
    // the inning would already be over had the errors been outs
    const pastThreeOuts = before.outs + errorOuts >= 3;
    const unearnedPlay = action === "error" || action === "passed ball";
    const charge = (owner: string, runner: string | null) => {
      const line = lines.get(owner)!;
      line.r++;
      const tainted = !!runner && reachedOnError.has(runner.toLowerCase());
      if (!tainted && !unearnedPlay && !pastThreeOuts) line.er++;
    };
    let charged = 0;
    for (const r of play.runners) {
      if (charged >= runs || r.to.toLowerCase() !== "home") continue;
      const runner = r.runner?.trim() || (r.from.toLowerCase() === "home" ? batter : null);
      const owner = (runner && responsible.get(runner.toLowerCase())) || key;
      charge(owner, runner);
      charged++;
    }
    // runs the play didn't put a runner to, like a home run that only lists
    // the batter, came from whoever was on base and isn't mentioned, lead
    // runner first. anything still unaccounted for goes to the pitcher on
    // the mound
    const mentioned = new Set(play.runners.map((r) => r.from.toLowerCase()));
    const unlisted = [
      ["3rd", before.runners.third],
      ["2nd", before.runners.second],
      ["1st", before.runners.first],
    ] as const;
    for (const [base, runner] of unlisted) {
      if (charged >= runs || !runner || mentioned.has(base)) continue;
      const owner = responsible.get(runner.toLowerCase()) || key;
      charge(owner, runner);
      responsible.delete(runner.toLowerCase());
      charged++;
    }
    for (; charged < runs; charged++) charge(key, null);

    if (action === "error") {
      errorOuts++;
      if (batter) reachedOnError.add(batter.toLowerCase());
    }

    for (const r of play.runners) {
      const to = r.to.toLowerCase();
      if (to !== "home" && to !== "out") continue;
      const runner = r.runner?.trim() || (r.from.toLowerCase() === "home" ? batter : null);
      if (runner) responsible.delete(runner.toLowerCase());
    }
    for (const runner of [after.runners.first, after.runners.second, after.runners.third]) {
      if (runner && !responsible.has(runner.toLowerCase())) responsible.set(runner.toLowerCase(), key);
    }
  }

  // away pitchers then home, each in the order they came into the game
  const teamRank = (k: string) => (lines.get(k)!.team === "away" ? 0 : 1);
  return [...order].sort((a, b) => teamRank(a) - teamRank(b)).map((k) => lines.get(k)!);
}
