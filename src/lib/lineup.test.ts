import { describe, expect, it } from "vitest";
import {
  EMPTY_LINEUPS,
  applyLineup,
  changePitcher,
  cleanName,
  dueUpSlot,
  findInLineup,
  lineupNames,
  newLineup,
  ordinal,
  parseBattingOrder,
  samePlayer,
  substitute,
  type Lineups,
} from "./lineup";
import { battingLines, type LoggedPlay } from "./boxScore";
import { INITIAL_GAME_STATE, applyPlayToState, type GameState, type Play } from "@/types/game";

const AWAY = [
  "Juan Soto",
  "Francisco Lindor",
  "Pete Alonso",
  "Brandon Nimmo",
  "Mark Vientos",
  "Jeff McNeil",
  "Francisco Alvarez",
  "Jesse Winker",
  "Tyrone Taylor",
];
const HOME = Array.from({ length: 9 }, (_, i) => `Home Batter ${i + 1}`);
const TEAMS = { away: "Ducks", home: "Blue Crabs" };

const lineups = (): Lineups => ({
  away: newLineup(AWAY, "Away Ace"),
  home: newLineup(HOME, "Clay Holmes"),
});

const play = (p: Partial<Play> & Pick<Play, "action">): Play => ({
  description: p.action,
  runners: [],
  rbi: 0,
  outs_recorded: 0,
  fielders_involved: [],
  confidence: "high",
  ...p,
});

const groundOut = () => play({ action: "ground out", runners: [{ from: "home", to: "out" }], outs_recorded: 1 });
const single = () => play({ action: "single", runners: [{ from: "home", to: "1st" }] });

// scores plays the way the page does: lineup first, then the game state
function scoreGame(plays: Play[], cards: Lineups = lineups()) {
  let state: GameState = INITIAL_GAME_STATE;
  const log: LoggedPlay[] = [];
  for (const raw of plays) {
    const team = state.half === "top" ? "away" : "home";
    const checked = applyLineup(raw, state, cards, dueUpSlot(team, log), TEAMS);
    const after = applyPlayToState(state, checked.play);
    log.push({ play: checked.play, before: state, after, slot: checked.slot });
    state = after;
  }
  return { log, state };
}

describe("reading a typed or pasted lineup", () => {
  it.each([
    ["1. Juan Soto RF", "Juan Soto"],
    ["2) Francisco Lindor (SS)", "Francisco Lindor"],
    ["3.Pete Alonso", "Pete Alonso"],
    ["Aaron Judge, DH", "Aaron Judge"],
    ["  Ronald   Acuña Jr.  ", "Ronald Acuña Jr."],
  ])("%j -> %j", (raw, name) => {
    expect(cleanName(raw)).toBe(name);
  });

  it("takes nine players and skips blank lines", () => {
    const result = parseBattingOrder(["", ...AWAY.map((n, i) => `${i + 1}. ${n}`), ""].join("\n"));
    expect(result).toEqual({ ok: true, batters: AWAY });
  });

  it("allows no batting order at all, for tracking pitching only", () => {
    expect(parseBattingOrder("  \n ")).toEqual({ ok: true, batters: [] });
  });

  it("refuses a batting order of the wrong length", () => {
    const result = parseBattingOrder(AWAY.slice(0, 8).join("\n"));
    expect(result.ok).toBe(false);
    expect("error" in result && result.error).toMatch(/needs 9 .* has 8/);
  });
});

describe("matching names", () => {
  it.each([
    ["Soto", "Juan Soto", true],
    ["juan soto", "Juan Soto", true],
    ["acuna", "Ronald Acuña Jr.", true],
    ["Ronald Acuna", "Ronald Acuña Jr.", true],
    ["Juan Soto", "Gregory Soto", false],
    ["Soto", "Lindor", false],
    ["", "Juan Soto", false],
  ])("%j and %j: %s", (a, b, same) => {
    expect(samePlayer(a, b)).toBe(same);
  });

  it("finds a player in the game before one who was replaced", () => {
    const card = substitute(newLineup(["Soto", ...AWAY.slice(1)], ""), 0, "Luisangel Acuña");
    expect(findInLineup(card, "Acuña")).toEqual({ slot: 0, current: true, name: "Luisangel Acuña" });
    expect(findInLineup(card, "Soto")).toEqual({ slot: 0, current: false, name: "Soto" });
    expect(findInLineup(card, "Nobody")).toBeNull();
  });

  it("collects every name on both cards", () => {
    const cards = lineups();
    cards.away = substitute(cards.away, 3, "Pinch Hitter");
    expect(lineupNames(cards)).toEqual(expect.arrayContaining(["Juan Soto", "Pinch Hitter", "Brandon Nimmo", "Clay Holmes"]));
  });
});

describe("substitutions", () => {
  it("keeps the replaced player in the slot's history", () => {
    const card = substitute(newLineup(AWAY, "Ace"), 3, "Starling Marte");
    expect(card.slots[3]).toEqual(["Brandon Nimmo", "Starling Marte"]);
    expect(card.slots[2]).toEqual(["Pete Alonso"]);
  });

  it("ignores substituting a player for himself", () => {
    const card = newLineup(AWAY, "Ace");
    expect(substitute(card, 0, "soto")).toBe(card);
    expect(substitute(card, 0, "  ")).toBe(card);
  });

  it("adds a new pitcher and keeps the old ones", () => {
    const card = changePitcher(newLineup(AWAY, "Kodai Senga"), "Edwin Díaz");
    expect(card.pitchers).toEqual(["Kodai Senga", "Edwin Díaz"]);
    expect(changePitcher(card, "edwin diaz")).toBe(card);
  });
});

describe("who is due up", () => {
  it("starts at the leadoff spot and follows the order", () => {
    const { log } = scoreGame([groundOut(), single()]);
    expect(dueUpSlot("away", log)).toBe(2);
    expect(dueUpSlot("home", log)).toBe(0);
  });

  it("goes back to the top after the ninth batter", () => {
    const { log } = scoreGame(Array.from({ length: 9 }, single));
    expect(log.map((e) => e.play.batter)).toEqual(AWAY);
    expect(dueUpSlot("away", log)).toBe(0);
  });

  it("doesn't move on for plays that aren't a plate appearance", () => {
    const { log } = scoreGame([single(), play({ action: "stolen base", runners: [{ from: "1st", to: "2nd" }] })]);
    expect(dueUpSlot("away", log)).toBe(1);
  });

  it("carries each team's place in the order across innings", () => {
    const { log, state } = scoreGame([groundOut(), groundOut(), groundOut(), groundOut()]);
    expect(state.half).toBe("bottom");
    expect(log[3].play.batter).toBe("Home Batter 1");
    expect(dueUpSlot("away", log)).toBe(3);
    expect(dueUpSlot("home", log)).toBe(1);
  });

  it("follows the order back after an undo", () => {
    const { log } = scoreGame([single(), single(), single()]);
    expect(dueUpSlot("away", log.slice(0, -1))).toBe(2);
  });

  it("uses the batter the scorer marked as up", () => {
    expect(dueUpSlot("away", [], 6)).toBe(6);
  });
});

describe("applyLineup", () => {
  const due = (slot: number) => applyLineup(groundOut(), INITIAL_GAME_STATE, lineups(), slot, TEAMS);

  it("fills in the batter due up and the pitcher on the mound", () => {
    const result = due(4);
    expect(result.play.batter).toBe("Mark Vientos");
    expect(result.play.pitcher).toBe("Clay Holmes");
    expect(result.slot).toBe(4);
    expect(result.warnings).toEqual([]);
    expect(result.play.confidence).toBe("high");
  });

  it("puts the batter's name on the runner coming from home", () => {
    const result = applyLineup(single(), INITIAL_GAME_STATE, lineups(), 0, TEAMS);
    expect(result.play.runners).toEqual([{ from: "home", to: "1st", runner: "Juan Soto" }]);
  });

  it("spells named players the way the lineup has them", () => {
    const named = play({ action: "double", batter: "soto", pitcher: "holmes", runners: [{ from: "2nd", to: "home", runner: "Lindor" }] });
    const result = applyLineup(named, INITIAL_GAME_STATE, lineups(), 0, TEAMS);
    expect(result.play.batter).toBe("Juan Soto");
    expect(result.play.pitcher).toBe("Clay Holmes");
    expect(result.play.runners[0].runner).toBe("Francisco Lindor");
    expect(result.warnings).toEqual([]);
  });

  it("flags a batter hitting out of turn and credits the spot he bats in", () => {
    const result = applyLineup(play({ action: "single", batter: "Alonso" }), INITIAL_GAME_STATE, lineups(), 0, TEAMS);
    expect(result.slot).toBe(2);
    expect(result.warnings).toEqual(["Pete Alonso bats 3rd, but Juan Soto (1st) is due up."]);
    expect(result.play.confidence).toBe("low");
  });

  it("flags a batter who isn't in the lineup and credits the spot due up", () => {
    const result = applyLineup(play({ action: "walk", batter: "Mystery Man" }), INITIAL_GAME_STATE, lineups(), 5, TEAMS);
    expect(result.slot).toBe(5);
    expect(result.play.batter).toBe("Mystery Man");
    expect(result.warnings[0]).toMatch(/Mystery Man isn't in the Ducks lineup.*pinch hitting for Jeff McNeil/);
  });

  it("flags a player who has already been replaced", () => {
    const cards = lineups();
    cards.away = substitute(cards.away, 0, "Pinch Hitter");
    const result = applyLineup(play({ action: "single", batter: "Soto" }), INITIAL_GAME_STATE, cards, 0, TEAMS);
    expect(result.warnings).toEqual(["Juan Soto was replaced by Pinch Hitter and is out of the game."]);
  });

  it("flags a pitcher who isn't the one on the mound", () => {
    const result = applyLineup(play({ action: "strikeout", pitcher: "Someone Else" }), INITIAL_GAME_STATE, lineups(), 0, TEAMS);
    expect(result.play.pitcher).toBe("Someone Else");
    expect(result.warnings[0]).toMatch(/Clay Holmes is pitching for Blue Crabs, but the play names Someone Else/);
  });

  it("leaves the batter alone on a steal, which isn't his plate appearance", () => {
    const steal = play({ action: "stolen base", runners: [{ from: "1st", to: "2nd" }] });
    const result = applyLineup(steal, INITIAL_GAME_STATE, lineups(), 3, TEAMS);
    expect(result.play.batter).toBeUndefined();
    expect(result.slot).toBeNull();
  });

  it("uses the home lineup in the bottom of the inning", () => {
    const bottom = { ...INITIAL_GAME_STATE, half: "bottom" as const };
    const result = applyLineup(groundOut(), bottom, lineups(), 0, TEAMS);
    expect(result.play.batter).toBe("Home Batter 1");
    expect(result.play.pitcher).toBe("Away Ace");
  });

  it("changes nothing without a lineup", () => {
    const original = groundOut();
    const result = applyLineup(original, INITIAL_GAME_STATE, EMPTY_LINEUPS, 0, TEAMS);
    expect(result).toEqual({ play: original, slot: null, warnings: [] });
  });

  it("fills the pitcher even when only the pitcher was entered", () => {
    const cards: Lineups = { away: { slots: [], pitchers: [] }, home: newLineup([], "Clay Holmes") };
    const result = applyLineup(groundOut(), INITIAL_GAME_STATE, cards, 0, TEAMS);
    expect(result.play.pitcher).toBe("Clay Holmes");
    expect(result.play.batter).toBeUndefined();
    expect(result.slot).toBeNull();
  });
});

describe("box score with a lineup", () => {
  it("lists batters in batting order with a pinch hitter under the starter", () => {
    const cards = lineups();
    // the 9th hitter bats first, which puts him first in order of appearance
    const first = scoreGame([], cards);
    const log = [...first.log];
    let state = first.state;
    const add = (raw: Play, slot: number) => {
      const checked = applyLineup(raw, state, cards, slot, TEAMS);
      const after = applyPlayToState(state, checked.play);
      log.push({ play: checked.play, before: state, after, slot: checked.slot });
      state = after;
    };
    add(single(), 8);
    add(single(), 0);
    cards.away = substitute(cards.away, 1, "Pinch Hitter");
    add(single(), 1);
    const names = battingLines(log).filter((b) => b.team === "away").map((b) => b.name);
    expect(names).toEqual(["Juan Soto", "Pinch Hitter", "Tyrone Taylor"]);
  });
});

describe("ordinal", () => {
  it.each([
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [4, "4th"],
    [9, "9th"],
    [11, "11th"],
    [12, "12th"],
    [21, "21st"],
  ])("%i -> %s", (n, s) => {
    expect(ordinal(n)).toBe(s);
  });
});
