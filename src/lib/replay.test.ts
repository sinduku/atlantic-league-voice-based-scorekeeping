import { describe, expect, it } from "vitest";
import { INITIAL_GAME_STATE, applyPlayToState, type GameState, type Play } from "@/types/game";
import type { LoggedPlay } from "./boxScore";
import { replayLog, withEdit } from "./replay";

const play = (p: Partial<Play> & Pick<Play, "action">): Play => ({
  description: p.action,
  runners: [],
  rbi: 0,
  outs_recorded: 0,
  fielders_involved: [],
  confidence: "high",
  ...p,
});

function playGame(plays: Play[]) {
  let state: GameState = INITIAL_GAME_STATE;
  const log: LoggedPlay[] = [];
  for (const p of plays) {
    const after = applyPlayToState(state, p);
    log.push({ play: p, before: state, after, slot: null });
    state = after;
  }
  return log;
}

const single = (batter: string, extra: Play["runners"] = []) =>
  play({ action: "single", batter, runners: [...extra, { from: "home", to: "1st", runner: batter }] });
const out = (batter: string) => play({ action: "ground out", batter, runners: [{ from: "home", to: "out", runner: batter }], outs_recorded: 1 });

describe("replayLog", () => {
  it("plays an unchanged game back to the same place", () => {
    const log = playGame([single("A"), single("B", [{ from: "1st", to: "3rd", runner: "A" }]), out("C")]);
    const result = replayLog(log);
    expect(result.state).toEqual(log[log.length - 1].after);
    expect(result.problems).toEqual([]);
  });

  it("carries a corrected play through to the score after it", () => {
    // A singled, then B's single was logged with A only reaching third
    const log = playGame([single("A"), single("B", [{ from: "1st", to: "3rd", runner: "A" }]), out("C")]);
    const fixed = single("B", [{ from: "1st", to: "home", runner: "A" }]);
    const result = replayLog(withEdit(log, 1, { play: { ...fixed, rbi: 1 }, slot: null }));
    expect(result.state.score.away).toBe(1);
    expect(result.state.runners).toEqual({ first: "B", second: null, third: null });
    expect(result.state.outs).toBe(1);
  });

  it("moves later plays into the half-inning they now fall in", () => {
    // a play changed into the third out pushes the next one to the bottom half
    const log = playGame([out("A"), out("B"), single("C"), single("D", [{ from: "1st", to: "2nd", runner: "C" }])]);
    const result = replayLog(withEdit(log, 2, { play: out("C"), slot: null }));
    expect(result.log[3].play.half).toBe("bottom");
    expect(result.log[3].before.half).toBe("bottom");
    expect(result.problems).toEqual([expect.objectContaining({ index: 3, message: expect.stringContaining("Nobody is on 1st") })]);
  });

  it("puts the runner who is now on a base into later plays that move him", () => {
    // B was logged as reaching first, but it was really E who batted
    const log = playGame([single("B"), play({ action: "stolen base", runners: [{ from: "1st", to: "2nd", runner: "B" }] })]);
    const result = replayLog(withEdit(log, 0, { play: single("E"), slot: null }));
    expect(result.log[1].play.runners[0].runner).toBe("E");
    expect(result.state.runners.second).toBe("E");
  });

  it("takes a play out and plays the rest without it", () => {
    const log = playGame([single("A"), out("B"), out("C")]);
    const result = replayLog(withEdit(log, 0, null));
    expect(result.log).toHaveLength(2);
    expect(result.state.outs).toBe(2);
    expect(result.state.runners.first).toBeNull();
  });

  it("keeps the scorer's confidence on later plays even when they no longer fit", () => {
    const log = playGame([single("A"), play({ action: "stolen base", runners: [{ from: "1st", to: "2nd", runner: "A" }] })]);
    const result = replayLog(withEdit(log, 0, null));
    expect(result.log[0].play.confidence).toBe("high");
    expect(result.problems).toHaveLength(1);
  });

  it("flags a play that comes after the game ended", () => {
    const ninth: GameState = { ...INITIAL_GAME_STATE, inning: 9, score: { away: 0, home: 1 } };
    const result = replayLog([out("A"), out("B"), out("C"), out("D")].map((p) => ({ play: p, slot: null })), 9, ninth);
    expect(result.log[2].after.final).toBe(true);
    expect(result.problems.some((p) => p.index === 3 && /already over/.test(p.message))).toBe(true);
  });
});
