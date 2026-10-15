import { describe, expect, it } from "vitest";
import { inningsPitched, pitcherKey, pitchingLines, UNNAMED_PITCHER } from "./pitching";
import type { LoggedPlay } from "./boxScore";
import { INITIAL_GAME_STATE, applyPlayToState, type GameState, type Play } from "@/types/game";

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
    log.push({ play: p, before: state, after });
    state = after;
  }
  return log;
}

const by = (pitcher: string) => ({
  out: (batter: string) =>
    play({ action: "ground out", batter, pitcher, runners: [{ from: "home", to: "out", runner: batter }], outs_recorded: 1 }),
  k: (batter: string) =>
    play({ action: "strikeout", batter, pitcher, runners: [{ from: "home", to: "out", runner: batter }], outs_recorded: 1 }),
  walk: (batter: string) => play({ action: "walk", batter, pitcher, runners: [{ from: "home", to: "1st", runner: batter }] }),
  single: (batter: string, extra: Play["runners"] = [], rbi = 0) =>
    play({ action: "single", batter, pitcher, rbi, runners: [...extra, { from: "home", to: "1st", runner: batter }] }),
  homer: (batter: string, extra: Play["runners"] = []) =>
    play({
      action: "home run",
      batter,
      pitcher,
      rbi: extra.length + 1,
      runners: [...extra, { from: "home", to: "home", runner: batter }],
    }),
});

const holmes = by("Clay Holmes");
const diaz = by("Edwin Díaz");

describe("inningsPitched", () => {
  it.each([
    [0, "0.0"],
    [1, "0.1"],
    [3, "1.0"],
    [17, "5.2"],
    [27, "9.0"],
  ])("%i outs -> %s", (outs, ip) => {
    expect(inningsPitched(outs)).toBe(ip);
  });
});

describe("pitchingLines", () => {
  it("counts outs, batters faced and the main stats", () => {
    const [line] = pitchingLines(
      playGame([holmes.k("A"), holmes.walk("B"), holmes.single("C"), holmes.out("D"), holmes.homer("E", [
        { from: "2nd", to: "home", runner: "B" },
        { from: "1st", to: "home", runner: "C" },
      ])])
    );
    expect(line).toMatchObject({ name: "Clay Holmes", team: "home", outs: 2, bf: 5, h: 2, hr: 1, bb: 1, k: 1, r: 3 });
  });

  it("charges the home team's pitcher in the top half and the away pitcher in the bottom", () => {
    const lines = pitchingLines(playGame([holmes.out("A"), holmes.out("B"), holmes.out("C"), by("Away Ace").k("H1")]));
    expect(lines.map((l) => [l.name, l.team, l.outs])).toEqual([
      ["Away Ace", "away", 1],
      ["Clay Holmes", "home", 3],
    ]);
  });

  it("never credits more than the three outs an inning has", () => {
    const log = playGame([
      holmes.out("A"),
      holmes.out("B"),
      play({
        action: "ground out",
        batter: "C",
        pitcher: "Clay Holmes",
        outs_recorded: 2,
        runners: [{ from: "home", to: "out" }, { from: "1st", to: "out" }],
      }),
    ]);
    expect(pitchingLines(log)[0].outs).toBe(3);
  });

  it("charges a run to the pitcher who put that runner on, after a pitching change", () => {
    const log = playGame([
      holmes.walk("Soto"),
      holmes.single("Lindor", [{ from: "1st", to: "2nd", runner: "Soto" }]),
      // Díaz comes in; the single scores Soto, who Holmes walked
      diaz.single("Alonso", [
        { from: "2nd", to: "home", runner: "Soto" },
        { from: "1st", to: "2nd", runner: "Lindor" },
      ], 1),
      // and Lindor, also Holmes's runner, scores on Díaz's next pitch
      diaz.single("Nimmo", [
        { from: "2nd", to: "home", runner: "Lindor" },
        { from: "1st", to: "2nd", runner: "Alonso" },
      ], 1),
      // Alonso is Díaz's own runner
      diaz.single("Vientos", [
        { from: "2nd", to: "home", runner: "Alonso" },
        { from: "1st", to: "2nd", runner: "Nimmo" },
      ], 1),
    ]);
    const [holmesLine, diazLine] = pitchingLines(log);
    expect(holmesLine).toMatchObject({ name: "Clay Holmes", r: 2, bf: 2, h: 1, bb: 1 });
    expect(diazLine).toMatchObject({ name: "Edwin Díaz", r: 1, bf: 3, h: 3 });
  });

  it("charges the reliever for the batter's own run on a home run", () => {
    const log = playGame([holmes.walk("Soto"), diaz.homer("Lindor", [{ from: "1st", to: "home", runner: "Soto" }])]);
    const [holmesLine, diazLine] = pitchingLines(log);
    expect(holmesLine.r).toBe(1);
    expect(diazLine.r).toBe(1);
    expect(diazLine.hr).toBe(1);
  });

  it("works out whose run it was when the play only lists the batter", () => {
    // the parser listed only the batter, but Holmes's runner was on third
    const log = playGame([
      holmes.single("Soto"),
      play({ action: "stolen base", pitcher: "Clay Holmes", runners: [{ from: "1st", to: "2nd", runner: "Soto" }] }),
      play({ action: "stolen base", pitcher: "Clay Holmes", runners: [{ from: "2nd", to: "3rd", runner: "Soto" }] }),
      diaz.homer("Lindor"),
    ]);
    const [holmesLine, diazLine] = pitchingLines(log);
    expect(holmesLine.r).toBe(1);
    expect(diazLine.r).toBe(1);
  });

  it("charges the pitcher on the mound when nobody can account for a run", () => {
    // two runs claimed with nobody on base and only the batter listed
    const log = playGame([play({ action: "double", batter: "Soto", pitcher: "Clay Holmes", rbi: 2, runners: [{ from: "home", to: "2nd" }] })]);
    expect(pitchingLines(log)[0].r).toBe(2);
  });

  it("starts every half-inning with nobody's runners on base", () => {
    const log = playGame([
      holmes.walk("Soto"),
      holmes.out("A"),
      holmes.out("B"),
      holmes.out("C"),
      by("Away Ace").out("H1"),
      by("Away Ace").out("H2"),
      by("Away Ace").out("H3"),
      // a new inning: Soto walks again, this time off Díaz, and scores
      diaz.walk("Soto"),
      diaz.homer("Lindor", [{ from: "1st", to: "home", runner: "Soto" }]),
    ]);
    const holmesLine = pitchingLines(log).find((l) => l.name === "Clay Holmes")!;
    const diazLine = pitchingLines(log).find((l) => l.name === "Edwin Díaz")!;
    expect(holmesLine.r).toBe(0);
    expect(diazLine.r).toBe(2);
  });

  it("doesn't count steals and wild pitches as batters faced", () => {
    const log = playGame([
      holmes.single("Soto"),
      play({ action: "wild pitch", pitcher: "Clay Holmes", runners: [{ from: "1st", to: "2nd", runner: "Soto" }] }),
    ]);
    expect(pitchingLines(log)[0].bf).toBe(1);
  });

  it("collects plays with no pitcher named under one line", () => {
    const log = playGame([play({ action: "single", runners: [{ from: "home", to: "1st" }] })]);
    expect(pitchingLines(log)[0]).toMatchObject({ name: UNNAMED_PITCHER, team: "home", h: 1 });
  });

  it("adds the pitch count kept for each pitcher", () => {
    const log = playGame([holmes.k("A"), diaz.k("B")]);
    const lines = pitchingLines(log, { [pitcherKey("home", "Clay Holmes")]: 14 });
    expect(lines.map((l) => l.pitches)).toEqual([14, null]);
  });

  it("is empty before any plays", () => {
    expect(pitchingLines([])).toEqual([]);
  });
});
