import { describe, expect, it } from "vitest";
import { INITIAL_GAME_STATE, applyPlayToState, runsScored, type GameState, type Play } from "@/types/game";
import { battingLines, battingTeam, lineScore, type LoggedPlay, type Team } from "./boxScore";
import { checkPlay } from "./checkPlay";
import { openQuestions } from "./clarify";
import { pitchingLines } from "./pitching";
import { replayLog } from "./replay";
import { scorecard } from "./scorecard";
import { parseShorthand } from "./shorthand";

// Stress test: hundreds of random games played through the same steps as the
// page (parse, check against the bases, answer whatever the app asks, apply),
// with the bookkeeping checked after every play. Plays are a mix of the
// scorer's shorthand and the kind of incomplete play the AI sends back (a
// walk that only moves the batter, a single that forgets the runner on
// first), since those are what lost runners before.

// a small seeded generator, so a failure can be replayed exactly
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES: Record<Team, string[]> = {
  away: ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9"],
  home: ["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9"],
};

const base = (p: Partial<Play> & Pick<Play, "action">): Play => ({
  description: p.action,
  runners: [],
  rbi: 0,
  outs_recorded: 0,
  fielders_involved: [],
  confidence: "high",
  ...p,
});

const occupied = (s: GameState) => (["first", "second", "third"] as const).filter((k) => s.runners[k]);
const BASE_OF = { first: "1st", second: "2nd", third: "3rd" } as const;

function randomPlay(r: () => number, state: GameState, batter: string): Play | null {
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const on = occupied(state);
  const roll = r();
  const shorthand = (t: string) => {
    const p = parseShorthand(t, state);
    return p ? { ...p, batter } : null;
  };
  if (roll < 0.14) return base({ action: "walk", batter, runners: [{ from: "home", to: "1st", runner: batter }] });
  if (roll < 0.17) return base({ action: "hit by pitch", batter, runners: [{ from: "home", to: "1st", runner: batter }] });
  if (roll < 0.27) return base({ action: "single", batter, hit_location: pick(["left field", "center field", "right field"]), runners: [{ from: "home", to: "1st", runner: batter }] });
  if (roll < 0.31) return base({ action: "double", batter, hit_location: "left-center gap", runners: [{ from: "home", to: "2nd", runner: batter }] });
  if (roll < 0.32) return base({ action: "triple", batter, hit_location: "right field line", runners: [{ from: "home", to: "3rd", runner: batter }] });
  if (roll < 0.35) return base({ action: "home run", batter, hit_location: "left field", rbi: on.length + 1, runners: [{ from: "home", to: "home", runner: batter }] });
  if (roll < 0.37 && on.length) {
    const k = pick(on);
    const next = k === "first" ? "2nd" : k === "second" ? "3rd" : "home";
    const ahead = k === "first" ? "second" : k === "second" ? "third" : null;
    if (ahead && state.runners[ahead]) return null;
    return base({ action: pick(["stolen base", "wild pitch", "passed ball"]), runners: [{ from: BASE_OF[k], to: next, runner: state.runners[k] }] });
  }
  if (roll < 0.39 && on.length === 1) return shorthand(pick(["CS", "picked off"]));
  if (roll < 0.45) return shorthand("E" + pick(["4", "5", "6"]));
  if (roll < 0.62) return shorthand(pick(["K", "K looking", "struck out swinging"]));
  if (roll < 0.8) return shorthand(pick(["6-3", "4-3", "5-3", "U3", "1-3"]));
  if (roll < 0.9) return shorthand(pick(["F7", "F8", "F9", "L6", "P4"]));
  if (roll < 0.95 && state.runners.first && state.outs < 2) return shorthand("6-4-3");
  if (state.runners.third && state.outs < 2) {
    return base({ action: "sacrifice fly", batter, fielders_involved: ["8"], hit_location: "center field", rbi: 1, outs_recorded: 1, runners: [{ from: "3rd", to: "home", runner: state.runners.third }, { from: "home", to: "out", runner: batter }] });
  }
  return shorthand("F8");
}

// answers whatever the app asks, picking an option at random, the way a scorer
// would tap through the questions
function settle(play: Play, state: GameState, transcript: string, r: () => number): Play {
  let current = checkPlay(play, state).play;
  const resolved: string[] = [];
  for (let i = 0; i < 12; i++) {
    const q = openQuestions(current, { state, transcript, resolved }).find((x) => x.required && !x.textEntry);
    if (!q) return current;
    const option = q.options[Math.floor(r() * q.options.length)];
    current = checkPlay(option.play, state).play;
    resolved.push(q.id, ...(option.resolves ?? []));
  }
  return current;
}

interface Played {
  log: LoggedPlay[];
  state: GameState;
}

function playRandomGame(seed: number, maxPlays = 400): Played {
  const r = rng(seed);
  let state: GameState = INITIAL_GAME_STATE;
  const log: LoggedPlay[] = [];
  const up: Record<Team, number> = { away: 0, home: 0 };

  for (let n = 0; n < maxPlays && !state.final; n++) {
    const team = battingTeam(state.half);
    const batter = NAMES[team][up[team] % 9];
    const raw = randomPlay(r, state, batter);
    if (!raw) continue;
    const pitcher = team === "away" ? "Home ace" : "Away ace";
    const play = settle({ ...raw, pitcher, pitches: ["B", "C", "X"] }, state, raw.description, r);
    const before = state;
    const after = applyPlayToState(before, play);
    const pa = !["stolen base", "wild pitch", "passed ball", "caught stealing", "pickoff"].includes(play.action);
    log.push({ play, before, after, slot: pa ? up[team] % 9 : null });
    if (pa) up[team]++;
    checkStep(before, play, after, seed, n);
    state = after;
  }
  return { log, state };
}

// what must hold after every play
function checkStep(before: GameState, play: Play, after: GameState, seed: number, n: number) {
  const where = `seed ${seed}, play ${n} (${play.action})`;
  const halfOver = after.half !== before.half || after.inning !== before.inning || !!after.final;

  // nobody is on two bases at once
  const names = occupied(after).map((k) => after.runners[k]!.toLowerCase());
  expect(new Set(names).size, `${where}: a runner on two bases`).toBe(names.length);

  // the score only goes up, and only for the side at bat
  const team = battingTeam(before.half);
  const other = team === "away" ? "home" : "away";
  expect(after.score[other], where).toBe(before.score[other]);
  expect(after.score[team], where).toBeGreaterThanOrEqual(before.score[team]);

  if (!halfOver) {
    // a runner the play didn't move is still on his base, and nobody vanished:
    // runners after = before + batter safe - scored - put out
    // (a home run brings everyone in whether the play lists them or not)
    for (const k of occupied(before)) {
      if (play.action === "home run" || play.runners.some((r) => r.from === BASE_OF[k])) continue;
      expect(after.runners[k], `${where}: ${before.runners[k]} left ${k} without moving`).toBe(before.runners[k]);
    }
    for (const r of play.runners) {
      if (r.to === "1st" || r.to === "2nd" || r.to === "3rd") {
        const key = r.to === "1st" ? "first" : r.to === "2nd" ? "second" : "third";
        expect(after.runners[key], `${where}: nobody where ${r.runner ?? "a runner"} went`).not.toBeNull();
      }
    }
    expect(after.outs, where).toBe(before.outs + play.outs_recorded);
    expect(after.outs, where).toBeLessThan(3);
  }

  // every run the play counts is a runner who crossed the plate
  if (!after.final) expect(after.score[team] - before.score[team], where).toBe(runsScored(play, before));
}

// what must hold for a whole game
function checkGame({ log, state }: Played, seed: number) {
  const where = `seed ${seed}`;
  const line = lineScore(log, state);
  for (const team of ["away", "home"] as Team[]) {
    expect(line[team].runs, where).toBe(state.score[team]);
    const byInning = line[team].runsByInning.reduce<number>((a, b) => a + (b ?? 0), 0);
    expect(byInning, where).toBe(state.score[team]);
    expect(line[team].lob, where).toBeGreaterThanOrEqual(0);
    expect(line[team].lob, where).toBeLessThanOrEqual(3 * line.innings);

    const runsByBatter = battingLines(log)
      .filter((b) => b.team === team)
      .reduce((a, b) => a + b.r, 0);
    const pitchers = pitchingLines(log).filter((p) => p.team !== team);
    const allowed = pitchers.reduce((a, p) => a + p.r, 0);
    // a walk-off counts only the winning run, though more runners may cross
    const walkOff = log.some((e) => e.after.final && e.before.half === "bottom" && team === "home");
    if (!walkOff) {
      expect(runsByBatter, `${where}: ${team} runs by batter`).toBe(state.score[team]);
      expect(allowed, `${where}: runs charged to ${team}'s opponents`).toBe(state.score[team]);
      const card = scorecard(log, team);
      expect(card.cells.filter((c) => c.scored).length, `${where}: ${team} scorecard runs`).toBe(state.score[team]);
    }
    for (const p of pitchers) expect(p.er, where).toBeLessThanOrEqual(p.r);
  }
  const pitches = pitchingLines(log).reduce((a, p) => a + (p.pitches ?? 0), 0);
  expect(pitches, where).toBe(log.reduce((a, e) => a + (e.play.pitches?.length ?? 0), 0));

  // playing the log again from the first pitch lands in the same place
  const again = replayLog(log);
  expect(again.state, `${where}: replay`).toEqual(state);
  expect(again.problems, `${where}: replay`).toEqual([]);
}

describe("stress: random games", () => {
  it("keeps every runner, run and out straight over 500 games", () => {
    let plays = 0;
    let finished = 0;
    let walks = 0;
    const started = performance.now();
    for (let seed = 1; seed <= 500; seed++) {
      const game = playRandomGame(seed);
      checkGame(game, seed);
      plays += game.log.length;
      walks += game.log.filter((e) => e.play.action === "walk").length;
      if (game.state.final) finished++;
    }
    const ms = performance.now() - started;
    console.info(`[stress] 500 games, ${plays} plays (${walks} walks), ${finished} finished, ${ms.toFixed(0)}ms`);
    expect(finished).toBe(500);
  }, 60_000);

  it("walks ten batters in a row without losing anyone", () => {
    let state: GameState = INITIAL_GAME_STATE;
    for (let i = 0; i < 10; i++) {
      const b = NAMES.away[i % 9] + (i >= 9 ? "b" : "");
      const play = checkPlay(base({ action: "walk", batter: b, runners: [{ from: "home", to: "1st", runner: b }] }), state).play;
      state = applyPlayToState(state, play);
    }
    expect(state.score.away).toBe(7);
    expect(occupied(state)).toHaveLength(3);
  });

  it("handles a very long game quickly", () => {
    // twenty games end to end: far longer than any real game, to see that
    // nothing slows down as the log grows
    const many = Array.from({ length: 20 }, (_, i) => playRandomGame(9000 + i).log).flat();
    const t0 = performance.now();
    lineScore(many, many[many.length - 1].after);
    battingLines(many);
    pitchingLines(many);
    scorecard(many, "away");
    replayLog(many);
    const ms = performance.now() - t0;
    console.info(`[stress] ${many.length}-play log: box score, pitching, scorecard and replay in ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(1500);
  });
});
