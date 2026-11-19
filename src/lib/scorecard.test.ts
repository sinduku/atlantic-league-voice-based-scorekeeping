import { describe, expect, it } from "vitest";
import { INITIAL_GAME_STATE, applyPlayToState, type GameState, type Play } from "@/types/game";
import type { LoggedPlay } from "./boxScore";
import { checkPlay } from "./checkPlay";
import { parseShorthand } from "./shorthand";
import { cellAt, notation, scorecard } from "./scorecard";

const play = (p: Partial<Play> & Pick<Play, "action">): Play => ({
  description: p.action,
  runners: [],
  rbi: 0,
  outs_recorded: 0,
  fielders_involved: [],
  confidence: "high",
  ...p,
});

function playGame(plays: (Play | string)[]) {
  let state: GameState = INITIAL_GAME_STATE;
  const log: LoggedPlay[] = [];
  for (const p of plays) {
    const parsed = typeof p === "string" ? parseShorthand(p, state)! : p;
    const checked = checkPlay(parsed, state).play;
    const after = applyPlayToState(state, checked);
    log.push({ play: checked, before: state, after, slot: null });
    state = after;
  }
  return { log, state };
}

describe("scorebook notation", () => {
  it.each([
    [play({ action: "ground out", fielders_involved: ["6", "3"], outs_recorded: 1 }), "6-3"],
    [play({ action: "ground out", fielders_involved: ["6", "4", "3"], outs_recorded: 2 }), "6-4-3 DP"],
    [play({ action: "ground out", fielders_involved: ["3"], outs_recorded: 1 }), "3U"],
    [play({ action: "fly out", fielders_involved: ["8"] }), "F8"],
    [play({ action: "line out", fielders_involved: ["9"] }), "L9"],
    [play({ action: "pop out", fielders_involved: ["4"] }), "P4"],
    [play({ action: "sacrifice fly", fielders_involved: ["9"] }), "SF9"],
    [play({ action: "error", fielders_involved: ["5"] }), "E5"],
    [play({ action: "strikeout", pitches: ["B", "C", "C", "C"] }), "ꓘ"],
    [play({ action: "strikeout", pitches: ["S", "S", "S"] }), "K"],
    [play({ action: "double" }), "2B"],
  ])("%#: %s", (p, expected) => {
    expect(notation(p)).toBe(expected);
  });
});

describe("the scorecard", () => {
  it("follows a runner around the bases from the box he batted in", () => {
    const single = play({ action: "single", batter: "A", runners: [{ from: "home", to: "1st", runner: "A" }] });
    const sb = play({ action: "stolen base", runners: [{ from: "1st", to: "2nd", runner: "A" }] });
    const double = play({ action: "double", batter: "B", rbi: 1, runners: [{ from: "2nd", to: "home", runner: "A" }, { from: "home", to: "2nd", runner: "B" }] });
    const { log } = playGame([single, sb, double, "K", "6-3", "F8"]);
    const card = scorecard(log, "away");
    const a = cellAt(card, 0, { inning: 1, around: 0 })!;
    expect(a).toMatchObject({ notation: "1B", reached: 4, scored: true, notes: ["SB", "2B"] });
    const b = cellAt(card, 1, { inning: 1, around: 0 })!;
    expect(b).toMatchObject({ notation: "2B", reached: 2, scored: false, rbi: 1, out: null });
    expect(cellAt(card, 2, { inning: 1, around: 0 })).toMatchObject({ notation: "K", out: 1 });
    expect(cellAt(card, 3, { inning: 1, around: 0 })).toMatchObject({ notation: "6-3", out: 2 });
    expect(cellAt(card, 4, { inning: 1, around: 0 })).toMatchObject({ notation: "F8", out: 3 });
    // the next inning starts with the sixth spot
    expect(card.cells.filter((c) => c.inning === 1)).toHaveLength(5);
  });

  it("marks the out a runner made on someone else's double play", () => {
    const { log } = playGame(["walk", "6-4-3", "F7"]);
    const card = scorecard(log, "away");
    expect(cellAt(card, 0, { inning: 1, around: 0 })).toMatchObject({ notation: "BB", reached: 1, out: 1 });
    expect(cellAt(card, 1, { inning: 1, around: 0 })).toMatchObject({ notation: "6-4-3 DP", out: 2 });
    expect(cellAt(card, 2, { inning: 1, around: 0 })).toMatchObject({ out: 3 });
  });

  it("scores everyone on base when a walk is forced in with the bases loaded", () => {
    const { log } = playGame(["walk", "walk", "walk", "walk"]);
    const card = scorecard(log, "away");
    expect(cellAt(card, 0, { inning: 1, around: 0 })).toMatchObject({ scored: true, reached: 4 });
    expect(cellAt(card, 3, { inning: 1, around: 0 })).toMatchObject({ reached: 1 });
  });

  it("adds a column for an inning a spot bats twice in", () => {
    const walks = Array.from({ length: 10 }, () => "walk");
    const { log } = playGame(walks);
    const card = scorecard(log, "away");
    expect(card.columns.filter((c) => c.inning === 1)).toEqual([
      { inning: 1, around: 0 },
      { inning: 1, around: 1 },
    ]);
    expect(cellAt(card, 0, { inning: 1, around: 1 })).toMatchObject({ notation: "BB" });
  });

  it("leaves the other team's plays out", () => {
    const { log } = playGame(["K", "K", "K", "walk"]);
    expect(scorecard(log, "home").cells).toHaveLength(1);
    expect(scorecard(log, "away").cells).toHaveLength(3);
  });
});
