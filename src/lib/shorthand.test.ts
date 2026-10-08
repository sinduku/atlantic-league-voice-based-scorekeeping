import { describe, it, expect } from "vitest";
import { parseShorthand, normalizeShorthand } from "./shorthand";
import { normalizePlay } from "./normalizePlay";
import { INITIAL_GAME_STATE, applyPlayToState, type GameState } from "@/types/game";

const empty = INITIAL_GAME_STATE;
const withRunners = (runners: Partial<GameState["runners"]>, outs = 0): GameState => ({
  ...empty,
  outs,
  runners: { ...empty.runners, ...runners },
});

describe("normalizeShorthand", () => {
  it.each([
    ["6-4-3", "6 4 3"],
    ["643", "6 4 3"],
    ["6:43", "6 4 3"],
    ["six four three", "6 4 3"],
    ["6 for 3", "6 4 3"],
    ["six to three", "6 2 3"],
    ["E5", "e 5"],
    ["F8.", "f 8"],
    ["fly out to eight", "fly out to 8"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeShorthand(input)).toBe(expected);
  });
});

describe("parseShorthand", () => {
  it.each([
    ["K", "strikeout", 1],
    ["K looking", "strikeout", 1],
    ["strike three", "strikeout", 1],
    ["struck out swinging", "strikeout", 1],
    ["rung up", "strikeout", 1],
    ["punched out", "strikeout", 1],
    ["F8", "fly out", 1],
    ["L7", "fly out", 1],
    ["P4", "fly out", 1],
    ["fly out to eight", "fly out", 1],
    ["U3", "ground out", 1],
    ["6-3", "ground out", 1],
    ["four three", "ground out", 1],
    ["E5", "error", 0],
    ["error on the six", "error", 0],
    ["ball four", "walk", 0],
    ["walk", "walk", 0],
    ["HBP", "hit by pitch", 0],
    ["hit by a pitch", "hit by pitch", 0],
    ["plunked", "hit by pitch", 0],
    ["free pass", "walk", 0],
  ])("%s is a %s", (input, action, outs) => {
    const play = parseShorthand(input, empty);
    expect(play?.action).toBe(action);
    expect(play?.outs_recorded).toBe(outs);
  });

  it("leaves anything with more in it to the model", () => {
    for (const t of [
      "Rodriguez singles to right",
      "double off the wall",
      "Judge 6-3",
      "sac fly to right",
      "home run",
      "stolen base",
      "",
    ]) {
      expect(parseShorthand(t, empty)).toBeNull();
    }
  });

  it("marks the K looking description", () => {
    expect(parseShorthand("K looking", empty)?.description).toMatch(/looking/);
    expect(parseShorthand("rung up", empty)?.description).toMatch(/looking/);
    expect(parseShorthand("K swinging", empty)?.description).not.toMatch(/looking/);
  });

  it("turns a double play into two outs when there is a runner on first", () => {
    const play = parseShorthand("6-4-3 double play", withRunners({ first: "Chen" }))!;
    expect(play.outs_recorded).toBe(2);
    expect(play.fielders_involved).toEqual(["6", "4", "3"]);
    expect(play.runners).toEqual([
      { from: "1st", to: "out", runner: "Chen" },
      { from: "home", to: "out", runner: null },
    ]);
    const next = applyPlayToState(withRunners({ first: "Chen" }), play);
    expect(next.outs).toBe(2);
    expect(next.runners.first).toBeNull();
  });

  it("hands an impossible double play to the model", () => {
    expect(parseShorthand("6-4-3 DP", empty)).toBeNull();
    expect(parseShorthand("6-4-3 DP", withRunners({ first: "Chen" }, 2))).toBeNull();
  });

  it("forces runners along on a walk and scores one with the bases loaded", () => {
    const loaded = withRunners({ first: "A", second: "B", third: "C" });
    const play = parseShorthand("ball four", loaded)!;
    expect(play.rbi).toBe(1);
    const next = applyPlayToState(loaded, play);
    expect(next.score.away).toBe(1);
    expect(next.runners).toEqual({ first: "runner", second: "A", third: "B" });
  });

  it("does not move an unforced runner on a walk", () => {
    const play = parseShorthand("walk", withRunners({ third: "C" }))!;
    expect(play.runners).toEqual([{ from: "home", to: "1st", runner: null }]);
    expect(play.rbi).toBe(0);
  });

  it("puts balls in play on the spray chart", () => {
    expect(parseShorthand("F8", empty)?.field_zone).toBe(3);
    expect(parseShorthand("6-3", empty)?.field_zone).toBe(6);
    expect(parseShorthand("K", empty)?.field_zone).toBeNull();
  });

  it("produces plays that pass normalization untouched", () => {
    for (const t of ["K", "F8", "6-3", "E5", "walk", "HBP", "U3", "G6"]) {
      const result = normalizePlay(parseShorthand(t, empty));
      expect(result.ok && result.patched).toBe(false);
    }
  });
});
