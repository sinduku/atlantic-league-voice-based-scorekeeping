import { describe, expect, it } from "vitest";
import { INITIAL_GAME_STATE, applyPlayToState, type GameState, type Play } from "@/types/game";
import { lineScore, type LoggedPlay } from "./boxScore";

const play = (p: Partial<Play> & Pick<Play, "action">): Play => ({
  description: p.action,
  runners: [],
  rbi: 0,
  outs_recorded: 0,
  fielders_involved: [],
  confidence: "high",
  ...p,
});

const out = play({ action: "ground out", runners: [{ from: "home", to: "out" }], outs_recorded: 1 });
const at = (inning: number, half: "top" | "bottom", away: number, home: number, extra: Partial<GameState> = {}): GameState => ({
  ...INITIAL_GAME_STATE,
  inning,
  half,
  score: { away, home },
  ...extra,
});

const threeOuts = (state: GameState, innings?: number) => {
  let s = state;
  for (let i = 0; i < 3; i++) s = applyPlayToState(s, out, innings);
  return s;
};

describe("the end of the game", () => {
  it("ends after the top of the ninth when the home team is ahead", () => {
    const end = threeOuts(at(9, "top", 2, 3));
    expect(end.final).toBe(true);
    expect(end.half).toBe("top");
    expect(end.inning).toBe(9);
  });

  it("plays the bottom of the ninth when the home team is behind or tied", () => {
    for (const [away, home] of [[3, 2], [3, 3]]) {
      const end = threeOuts(at(9, "top", away, home));
      expect(end.final).toBeFalsy();
      expect(end.half).toBe("bottom");
    }
  });

  it("ends after the bottom of the ninth with the away team ahead", () => {
    const end = threeOuts(at(9, "bottom", 4, 2));
    expect(end.final).toBe(true);
    expect(end.inning).toBe(9);
  });

  it("goes to extra innings when tied, and ends after a full extra inning with a leader", () => {
    const tenth = threeOuts(at(9, "bottom", 2, 2));
    expect(tenth.final).toBeFalsy();
    expect(tenth.inning).toBe(10);
    expect(tenth.half).toBe("top");
    const awayScores = applyPlayToState(tenth, play({ action: "home run", runners: [{ from: "home", to: "home" }], rbi: 1 }));
    const end = threeOuts(threeOuts(awayScores));
    expect(end.final).toBe(true);
    expect(end.score).toEqual({ away: 3, home: 2 });
  });

  it("never ends before the last scheduled inning", () => {
    const end = threeOuts(at(8, "bottom", 0, 9));
    expect(end.final).toBeFalsy();
    expect(end.inning).toBe(9);
  });

  it("ends a seven-inning game after seven", () => {
    expect(threeOuts(at(7, "top", 0, 1), 7).final).toBe(true);
    expect(threeOuts(at(7, "top", 0, 1)).final).toBeFalsy();
  });

  describe("walk-offs", () => {
    const loaded = { runners: { first: "A", second: "B", third: "C" } };

    it("ends the game the moment the home team goes ahead, counting only the winning run", () => {
      const double = play({
        action: "double",
        batter: "D",
        runners: [
          { from: "3rd", to: "home", runner: "C" },
          { from: "2nd", to: "home", runner: "B" },
          { from: "1st", to: "home", runner: "A" },
          { from: "home", to: "2nd", runner: "D" },
        ],
        rbi: 3,
      });
      const end = applyPlayToState(at(9, "bottom", 4, 4, { outs: 1, ...loaded }), double);
      expect(end.final).toBe(true);
      expect(end.score).toEqual({ away: 4, home: 5 });
      expect(end.outs).toBe(1);
    });

    it("counts every run on a walk-off home run", () => {
      const slam = play({ action: "home run", batter: "D", runners: [{ from: "home", to: "home", runner: "D" }], rbi: 4 });
      const end = applyPlayToState(at(10, "bottom", 4, 4, loaded), slam);
      expect(end.final).toBe(true);
      expect(end.score.home).toBe(8);
    });

    it("doesn't end the game on a run that only ties it", () => {
      const single = play({ action: "single", batter: "D", runners: [{ from: "3rd", to: "home", runner: "C" }, { from: "home", to: "1st" }], rbi: 1 });
      const tied = applyPlayToState(at(9, "bottom", 4, 3, { runners: { first: null, second: null, third: "C" } }), single);
      expect(tied.final).toBeFalsy();
      expect(tied.score.home).toBe(4);
    });
  });
});

describe("the line score at the end", () => {
  it("leaves the unplayed bottom of the ninth empty", () => {
    let state = at(9, "top", 1, 2);
    const log: LoggedPlay[] = [];
    for (let i = 0; i < 3; i++) {
      const after = applyPlayToState(state, out);
      log.push({ play: out, before: state, after });
      state = after;
    }
    const score = lineScore(log, state);
    expect(score.innings).toBe(9);
    expect(score.home.runsByInning[8]).toBeNull();
    expect(score.away.runsByInning[8]).toBe(0);
  });

  it("shows seven columns for a seven-inning game", () => {
    expect(lineScore([], INITIAL_GAME_STATE, 7).innings).toBe(7);
  });
});
