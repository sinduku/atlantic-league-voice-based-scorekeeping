import { describe, it, expect } from "vitest";
import { battingLines, lineScore, type LoggedPlay } from "./boxScore";
import { parseShorthand } from "./shorthand";
import { INITIAL_GAME_STATE, applyPlayToState, runsScored, type GameState, type Play } from "@/types/game";

const play = (p: Partial<Play> & Pick<Play, "action">): Play => ({
  description: p.action,
  runners: [],
  rbi: 0,
  outs_recorded: 0,
  fielders_involved: [],
  confidence: "high",
  ...p,
});

// plays a game through applyPlayToState the way the page does
function playGame(plays: Play[]) {
  let state: GameState = INITIAL_GAME_STATE;
  const log: LoggedPlay[] = [];
  for (const p of plays) {
    const after = applyPlayToState(state, p);
    log.push({ play: p, before: state, after });
    state = after;
  }
  return { log, state };
}

const out = (batter: string) =>
  play({ action: "ground out", batter, runners: [{ from: "home", to: "out", runner: batter }], outs_recorded: 1 });

describe("runsScored", () => {
  it("counts a run that scores without an rbi", () => {
    const state = { ...INITIAL_GAME_STATE, runners: { first: null, second: null, third: "Chen" } };
    const wp = play({ action: "wild pitch", runners: [{ from: "3rd", to: "home", runner: "Chen" }] });
    expect(runsScored(wp, state)).toBe(1);
    expect(applyPlayToState(state, wp).score.away).toBe(1);
  });

  it("scores the batter and everyone on base on a home run, even if runners are missing", () => {
    const loaded = { ...INITIAL_GAME_STATE, runners: { first: "A", second: "B", third: "C" } };
    expect(runsScored(play({ action: "home run", rbi: 1 }), loaded)).toBe(4);
    expect(runsScored(play({ action: "home run" }), INITIAL_GAME_STATE)).toBe(1);
  });
});

describe("lineScore and battingLines", () => {
  const { log, state } = playGame([
    play({ action: "double", batter: "Soto", runners: [{ from: "home", to: "2nd", runner: "Soto" }] }),
    play({
      action: "single",
      batter: "Judge",
      rbi: 1,
      runners: [
        { from: "2nd", to: "home", runner: "Soto" },
        { from: "home", to: "1st", runner: "Judge" },
      ],
    }),
    parseShorthand("K", { ...INITIAL_GAME_STATE, runners: { first: "Judge", second: null, third: null } })!,
    out("Volpe"),
    out("Wells"),
    // bottom of the first
    play({ action: "error", batter: "Ohtani", fielders_involved: ["6"], runners: [{ from: "home", to: "1st", runner: "Ohtani" }] }),
    play({ action: "home run", batter: "Betts", rbi: 2, runners: [{ from: "1st", to: "home", runner: "Ohtani" }, { from: "home", to: "home", runner: "Betts" }] }),
  ]);

  it("splits runs by inning and team", () => {
    const score = lineScore(log, state);
    expect(score.innings).toBe(9);
    expect(score.away.runsByInning.slice(0, 2)).toEqual([1, null]);
    expect(score.home.runsByInning.slice(0, 2)).toEqual([2, null]);
    expect(score.away).toMatchObject({ runs: 1, hits: 2, errors: 1 });
    expect(score.home).toMatchObject({ runs: 2, hits: 1, errors: 0 });
  });

  it("builds a batting line per batter", () => {
    const lines = battingLines(log);
    const by = (name: string) => lines.find((l) => l.name === name)!;
    expect(by("Soto")).toMatchObject({ team: "away", pa: 1, ab: 1, h: 1, doubles: 1, r: 1, rbi: 0 });
    expect(by("Judge")).toMatchObject({ team: "away", h: 1, rbi: 1, r: 0 });
    expect(by("Betts")).toMatchObject({ team: "home", hr: 1, rbi: 2, r: 1 });
    expect(by("Ohtani")).toMatchObject({ team: "home", pa: 1, ab: 1, h: 0, r: 1 });
    // the K came from shorthand with no batter named
    expect(lines.some((l) => l.name === "Unnamed batter" && l.k === 1)).toBe(true);
  });

  it("leaves a walk out of the at bats", () => {
    const { log } = playGame([play({ action: "walk", batter: "Soto", runners: [{ from: "home", to: "1st", runner: "Soto" }] })]);
    expect(battingLines(log)[0]).toMatchObject({ pa: 1, ab: 0, bb: 1 });
  });

  it("runs past nine innings when the game does", () => {
    expect(lineScore([], { ...INITIAL_GAME_STATE, inning: 11 }).innings).toBe(11);
  });
});
