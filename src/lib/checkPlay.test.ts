import { describe, it, expect } from "vitest";
import { checkPlay } from "./checkPlay";
import { INITIAL_GAME_STATE, type GameState, type Play } from "@/types/game";

const base: Play = {
  action: "stolen base",
  description: "Ohtani steals home",
  runners: [{ from: "3rd", to: "home", runner: "Ohtani" }],
  rbi: 0,
  outs_recorded: 0,
  fielders_involved: [],
  confidence: "medium",
};

const state = (runners: Partial<GameState["runners"]>, outs = 0): GameState => ({
  ...INITIAL_GAME_STATE,
  inning: 4,
  half: "bottom",
  outs,
  runners: { ...INITIAL_GAME_STATE.runners, ...runners },
});

describe("checkPlay", () => {
  it("flags a runner moved off an empty base", () => {
    const { play, warnings } = checkPlay(base, state({}));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Nobody is on 3rd/);
    expect(play.confidence).toBe("low");
  });

  it("passes a play that fits the bases and keeps its confidence", () => {
    const { play, warnings } = checkPlay(base, state({ third: "Ohtani" }));
    expect(warnings).toEqual([]);
    expect(play.confidence).toBe("medium");
  });

  it("names runners the model left anonymous", () => {
    const anonymous = { ...base, runners: [{ from: "3rd", to: "home", runner: null }] };
    expect(checkPlay(anonymous, state({ third: "Chen" })).play.runners[0].runner).toBe("Chen");
  });

  it("takes the inning from the game, not the model", () => {
    const { play } = checkPlay({ ...base, inning: 1, half: "top" }, state({ third: "Ohtani" }));
    expect(play.inning).toBe(4);
    expect(play.half).toBe("bottom");
  });

  it("flags outs that don't add up", () => {
    const wrongCount = { ...base, runners: [{ from: "home", to: "out", runner: null }], outs_recorded: 2 };
    expect(checkPlay(wrongCount, state({})).warnings[0]).toMatch(/2 out\(s\) but puts 1/);
    const fourOuts = { ...base, runners: [{ from: "home", to: "out", runner: null }, { from: "1st", to: "out", runner: null }], outs_recorded: 2 };
    expect(checkPlay(fourOuts, state({ first: "A" }, 2)).warnings.some((w) => /4 outs/.test(w))).toBe(true);
  });
});
