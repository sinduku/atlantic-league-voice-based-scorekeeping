import { describe, expect, it } from "vitest";
import { INITIAL_GAME_STATE, applyPlayToState, withForcedRunners, type GameState, type Play } from "@/types/game";
import { checkPlay } from "./checkPlay";
import { battingLines, lineScore, type LoggedPlay } from "./boxScore";
import { pitchingLines } from "./pitching";

const play = (p: Partial<Play> & Pick<Play, "action">): Play => ({
  description: p.action,
  runners: [],
  rbi: 0,
  outs_recorded: 0,
  fielders_involved: [],
  confidence: "high",
  ...p,
});
// what the parser tends to send for "X walks": only the batter
const walk = (batter: string) => play({ action: "walk", batter, pitcher: "Ace", runners: [{ from: "home", to: "1st", runner: batter }] });

// scores plays the way the page does: checked against the bases, then applied
function playGame(plays: Play[], start: GameState = INITIAL_GAME_STATE) {
  let state = start;
  const log: LoggedPlay[] = [];
  for (const p of plays) {
    const checked = checkPlay(p, state).play;
    const after = applyPlayToState(state, checked);
    log.push({ play: checked, before: state, after });
    state = after;
  }
  return { log, state };
}

describe("walking batter after batter", () => {
  it("keeps every runner and forces runs in once the bases are loaded", () => {
    const { log, state } = playGame(["A", "B", "C", "D", "E", "F"].map(walk));
    expect(state.runners).toEqual({ first: "F", second: "E", third: "D" });
    expect(state.score.away).toBe(3);
    expect(lineScore(log, state).away.runs).toBe(3);
    // each forced-in run is an rbi for the batter who walked, and a run for the runner
    const lines = battingLines(log);
    expect(lines.find((l) => l.name === "D")?.rbi).toBe(1);
    expect(lines.find((l) => l.name === "A")?.r).toBe(1);
    expect(lines.find((l) => l.name === "C")?.r).toBe(1);
    expect(pitchingLines(log)[0]).toMatchObject({ bb: 6, r: 3, er: 3 });
  });

  it("does the same for hit batters", () => {
    const hbp = (b: string) => play({ action: "hit by pitch", batter: b, runners: [{ from: "home", to: "1st", runner: b }] });
    const { state } = playGame(["A", "B", "C", "D"].map(hbp));
    expect(state.runners).toEqual({ first: "D", second: "C", third: "B" });
    expect(state.score.away).toBe(1);
  });

  it("only pushes the runners who are forced", () => {
    // runners on first and third: the walk forces the man on first, not third
    const start = { ...INITIAL_GAME_STATE, runners: { first: "A", second: null, third: "C" } };
    const { state } = playGame([walk("B")], start);
    expect(state.runners).toEqual({ first: "B", second: "A", third: "C" });
    expect(state.score.away).toBe(0);
  });

  it("leaves a play that already moves the runners alone", () => {
    const start = { ...INITIAL_GAME_STATE, runners: { first: "A", second: null, third: null } };
    const full = play({ action: "walk", batter: "B", runners: [{ from: "1st", to: "2nd", runner: "A" }, { from: "home", to: "1st", runner: "B" }] });
    expect(withForcedRunners(full, start)).toBe(full);
  });

  it("never lets a single put the batter on top of a runner the play forgot", () => {
    const start = { ...INITIAL_GAME_STATE, runners: { first: "A", second: null, third: null } };
    const single = play({ action: "single", batter: "B", runners: [{ from: "home", to: "1st", runner: "B" }] });
    const { state } = playGame([single], start);
    expect(state.runners).toEqual({ first: "B", second: "A", third: null });
  });
});
