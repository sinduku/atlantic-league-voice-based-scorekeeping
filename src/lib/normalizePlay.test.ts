import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  normalizeAction,
  normalizeBase,
  normalizeFielder,
  normalizePlay,
  zoneFor,
} from "./normalizePlay";

const require = createRequire(import.meta.url);
const { EXAMPLES } = require("../../server/phrasings.js") as {
  EXAMPLES: { transcript: string; play: Record<string, unknown> }[];
};

// captured verbatim from the deployed parse-play edge function for the
// transcript "six four three double play" with a runner on first
const EDGE_FUNCTION_REPLY = {
  inning: 1,
  half: "top",
  batter: null,
  pitcher: null,
  action: "double play",
  description:
    "Ground ball to shortstop — 6-4-3 double play. Lee forced out at second; batter out at first.",
  runners: [
    { from: "1B", to: "2B (out at 2B)", runner: "Lee" },
    { from: "Home", to: "1B (out at 1B)", runner: null },
  ],
  rbi: 0,
  outs_recorded: 2,
  fielders_involved: ["6 (shortstop)", "4 (second base)", "3 (first base)"],
  hit_location: "shortstop",
  hit_type: "ground ball",
  hit_hardness: null,
  field_zone: 8,
  pitch_type: null,
  pitch_location: null,
  count: null,
  confidence: "medium",
  clarifying_questions: [{ field: "batter", question: "Who was the batter?" }],
};

describe("normalizePlay on the live edge function's reply", () => {
  const result = normalizePlay(EDGE_FUNCTION_REPLY);

  it("accepts it without lowering confidence", () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patched).toBe(false);
    expect(result.play.confidence).toBe("medium");
  });

  it("turns 'double play' into an action the scoreboard understands", () => {
    if (!result.ok) throw new Error("rejected");
    expect(result.play.action).toBe("ground out");
  });

  it("cleans fielders down to position numbers", () => {
    if (!result.ok) throw new Error("rejected");
    expect(result.play.fielders_involved).toEqual(["6", "4", "3"]);
  });

  it("cleans base names the scoreboard can read", () => {
    if (!result.ok) throw new Error("rejected");
    expect(result.play.runners).toEqual([
      { from: "1st", to: "out", runner: "Lee" },
      { from: "home", to: "out", runner: null },
    ]);
  });

  it("corrects the spray zone to the shortstop area", () => {
    if (!result.ok) throw new Error("rejected");
    expect(result.play.field_zone).toBe(6);
  });

  it("drops fields the app does not use", () => {
    if (!result.ok) throw new Error("rejected");
    expect(result.play).not.toHaveProperty("clarifying_questions");
  });
});

describe("normalizePlay on the shorthand library", () => {
  it.each(EXAMPLES.map((e) => [e.transcript, e.play] as const))(
    "%s passes through unchanged and unpatched",
    (_transcript, play) => {
      const result = normalizePlay(structuredClone(play));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.patched).toBe(false);
      expect(result.play.action).toBe(play.action);
      expect(result.play.fielders_involved).toEqual(play.fielders_involved);
      expect(result.play.rbi).toBe(play.rbi);
      expect(result.play.outs_recorded).toBe(play.outs_recorded);
      expect(result.play.field_zone).toBe(play.field_zone ?? null);
    }
  );

  // the library's zones were written by hand against SprayChart, so this is
  // an independent check that the derivation agrees with them
  it.each(
    EXAMPLES.filter((e) => e.play.field_zone != null).map(
      (e) => [e.transcript, e.play] as const
    )
  )("derives the right zone for %s", (_transcript, play) => {
    expect(zoneFor(play.hit_location as string, play.fielders_involved as string[])).toBe(
      play.field_zone
    );
  });
});

describe("normalizePlay rejection and fallback", () => {
  it.each([null, undefined, "single to left", 42, ["single"]])("rejects %j", (input) => {
    expect(normalizePlay(input).ok).toBe(false);
  });

  it("rejects a play with no action", () => {
    expect(normalizePlay({ description: "something happened" })).toEqual({
      ok: false,
      reason: "missing action",
    });
  });

  it("patches junk numbers and flags the play for review", () => {
    const result = normalizePlay({
      action: "single",
      description: "a hit",
      runners: "first base",
      rbi: "two",
      outs_recorded: NaN,
      fielders_involved: [],
      confidence: "high",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patched).toBe(true);
    expect(result.play.rbi).toBe(0);
    expect(result.play.runners).toEqual([]);
    expect(result.play.confidence).toBe("low");
  });

  it("flags a fielder it cannot place", () => {
    const result = normalizePlay({
      action: "ground out",
      description: "x",
      runners: [],
      rbi: 0,
      outs_recorded: 1,
      fielders_involved: ["Jones"],
      confidence: "high",
    });
    expect(result.ok && result.patched).toBe(true);
  });

  it("never gives a zone to a play with no ball in play", () => {
    const result = normalizePlay({
      action: "K",
      description: "struck out",
      runners: [],
      rbi: 0,
      outs_recorded: 1,
      fielders_involved: ["1", "2"],
      field_zone: 9,
      confidence: "high",
    });
    expect(result.ok && result.play.action).toBe("strikeout");
    expect(result.ok && result.play.field_zone).toBeNull();
  });
});

describe("individual normalizers", () => {
  it.each([
    ["groundout", null, "ground out"],
    ["Line Out", null, "fly out"],
    ["Fielders-Choice", null, "fielder's choice"],
    ["HBP", null, "hit by pitch"],
    ["triple play", "line drive", "fly out"],
    ["double play", "ground ball", "ground out"],
    ["something new", null, "something new"],
  ])("action %s (%s) -> %s", (raw, hitType, expected) => {
    expect(normalizeAction(raw, hitType)).toBe(expected);
  });

  it.each([
    ["1B", "1st"],
    ["second base", "2nd"],
    ["3rd", "3rd"],
    ["Home", "home"],
    ["scores", "home"],
    ["2B (out at 2B)", "out"],
    ["out", "out"],
  ])("base %s -> %s", (raw, expected) => {
    expect(normalizeBase(raw)).toBe(expected);
  });

  it.each([
    ["6", "6"],
    [6, "6"],
    ["6 (shortstop)", "6"],
    ["shortstop", "6"],
    ["center fielder", "8"],
    ["Jones", null],
    [12, null],
  ])("fielder %j -> %j", (raw, expected) => {
    expect(normalizeFielder(raw)).toBe(expected);
  });
});
