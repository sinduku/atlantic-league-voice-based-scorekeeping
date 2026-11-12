import { describe, expect, it } from "vitest";
import { countOf, decided, parsePitch, pitchesForPlay, pitchesToRestore, type PitchCode } from "./pitches";
import { pitchingLines } from "./pitching";
import { INITIAL_GAME_STATE, applyPlayToState, type Play } from "@/types/game";

const play = (p: Partial<Play> & Pick<Play, "action">): Play => ({
  description: p.action,
  runners: [],
  rbi: 0,
  outs_recorded: 0,
  fielders_involved: [],
  confidence: "high",
  ...p,
});

describe("the count", () => {
  it("counts balls and strikes, with fouls only up to two strikes", () => {
    expect(countOf(["B", "C", "F", "F", "F", "B"])).toEqual({ balls: 2, strikes: 2 });
  });

  it("counts a foul tip as a strike even with two", () => {
    expect(countOf(["C", "S", "T"])).toEqual({ balls: 0, strikes: 3 });
    expect(decided(["C", "S", "T"])).toBe("strikeout");
  });

  it("decides the at bat on ball four or strike three", () => {
    expect(decided(["B", "B", "B"])).toBeNull();
    expect(decided(["B", "B", "B", "C", "B"])).toBe("walk");
    expect(decided(["F", "F", "F", "F"])).toBeNull();
  });
});

describe("parsePitch", () => {
  it.each([
    ["ball", "B"],
    ["Ball two.", "B"],
    ["strike", "C"],
    ["called strike", "C"],
    ["strike looking", "C"],
    ["swinging strike", "S"],
    ["swing and a miss", "S"],
    ["foul ball", "F"],
    ["fouled off", "F"],
    ["foul tip", "T"],
  ])("%s is %s", (words, code) => {
    expect(parsePitch(words)).toBe(code);
  });

  it("leaves plays, ball four and strike three to the play parser", () => {
    for (const words of ["ball four", "strike three", "Soto singles", "6-3", "foul out to the catcher", "ball in the dirt, runner to second"]) {
      expect(parsePitch(words)).toBeNull();
    }
  });
});

describe("pitches on a confirmed play", () => {
  const pending: PitchCode[] = ["B", "C", "F"];

  it("adds the pitch put in play", () => {
    expect(pitchesForPlay(play({ action: "single" }), pending, { endsHalf: false })).toEqual(["B", "C", "F", "X"]);
    expect(pitchesForPlay(play({ action: "ground out" }), [], { endsHalf: false })).toEqual(["X"]);
  });

  it("adds ball four or strike three only when it wasn't logged already", () => {
    expect(pitchesForPlay(play({ action: "walk" }), ["B", "B", "B", "B"], { endsHalf: false })).toEqual(["B", "B", "B", "B"]);
    expect(pitchesForPlay(play({ action: "walk" }), ["B", "B", "B"], { endsHalf: false })).toEqual(["B", "B", "B", "B"]);
    expect(pitchesForPlay(play({ action: "strikeout" }), ["C", "C"], { endsHalf: false, said: "K looking" })).toEqual(["C", "C", "C"]);
    expect(pitchesForPlay(play({ action: "strikeout" }), ["C", "C"], { endsHalf: false, said: "struck out" })).toEqual(["C", "C", "S"]);
  });

  it("throws no pitch on an intentional walk", () => {
    expect(pitchesForPlay(play({ action: "walk" }), [], { endsHalf: false, said: "intentional walk" })).toEqual([]);
  });

  it("adds the pitch that hit the batter", () => {
    expect(pitchesForPlay(play({ action: "hit by pitch" }), ["B"], { endsHalf: false })).toEqual(["B", "H"]);
  });

  it("leaves the count alone on a steal, but takes it along when a caught stealing ends the inning", () => {
    expect(pitchesForPlay(play({ action: "stolen base" }), pending, { endsHalf: false })).toEqual([]);
    expect(pitchesForPlay(play({ action: "caught stealing" }), pending, { endsHalf: true })).toEqual(pending);
  });

  it("puts the at bat back in progress when the play is undone", () => {
    expect(pitchesToRestore(play({ action: "single", pitches: ["B", "C", "X"] }))).toEqual(["B", "C"]);
    expect(pitchesToRestore(play({ action: "caught stealing", pitches: ["B"] }))).toEqual(["B"]);
  });
});

describe("pitch counts from the log", () => {
  it("counts pitches and strikes for the pitcher who threw them, on top of taps", () => {
    const single = play({ action: "single", pitcher: "Ace", runners: [{ from: "home", to: "1st" }], pitches: ["B", "C", "F", "X"] });
    const walk = play({ action: "walk", pitcher: "Ace", runners: [{ from: "home", to: "1st" }], pitches: ["B", "B", "B", "B"] });
    const s1 = applyPlayToState(INITIAL_GAME_STATE, single);
    const log = [
      { play: single, before: INITIAL_GAME_STATE, after: s1 },
      { play: walk, before: s1, after: applyPlayToState(s1, walk) },
    ];
    const [line] = pitchingLines(log, { "home:ace": 2 });
    expect(line.pitches).toBe(10);
    expect(line.strikes).toBe(3);
  });

  it("leaves strikes unknown when pitches were only tapped", () => {
    const k = play({ action: "strikeout", pitcher: "Ace", runners: [{ from: "home", to: "out" }], outs_recorded: 1 });
    const [line] = pitchingLines([{ play: k, before: INITIAL_GAME_STATE, after: applyPlayToState(INITIAL_GAME_STATE, k) }], { "home:ace": 5 });
    expect(line.pitches).toBe(5);
    expect(line.strikes).toBeNull();
  });
});
