import { describe, it, expect } from "vitest";
import { average, battingCsv, fileBaseName, playByPlayCsv, toCsv } from "./exportCsv";
import { INITIAL_GAME_STATE, applyPlayToState, type Play } from "@/types/game";

const info = { teamNames: { away: "Long Island Ducks", home: "York Revolution" }, date: new Date("2026-10-08T19:00:00Z") };

const single: Play = {
  action: "single",
  description: 'Acuña lines one, "a rocket", to left',
  batter: "Acuña",
  runners: [{ from: "home", to: "1st", runner: "Acuña" }],
  rbi: 0,
  outs_recorded: 0,
  fielders_involved: ["7"],
  hit_type: "line drive",
  hit_location: "left field",
  confidence: "high",
};
const log = [{ play: single, before: INITIAL_GAME_STATE, after: applyPlayToState(INITIAL_GAME_STATE, single) }];

describe("csv export", () => {
  it("quotes commas and quotes", () => {
    expect(toCsv([["a,b", 'say "hi"', 3, null]])).toBe('"a,b","say ""hi""",3,');
  });

  it("writes one row per play with the team batting", () => {
    const [header, row] = playByPlayCsv(log, info).split("\r\n");
    expect(header).toContain("Long Island Ducks score");
    expect(row).toContain("Long Island Ducks");
    expect(row).toContain("Acuña home to 1st");
    expect(row).toContain('"Acuña lines one, ""a rocket"", to left"');
  });

  it("writes batting lines with an average", () => {
    const [, row] = battingCsv(log, info).split("\r\n");
    expect(row).toBe("Long Island Ducks,Acuña,1,1,0,1,0,0,0,0,0,0,1.000");
    expect(average(1, 3)).toBe(".333");
    expect(average(0, 0)).toBe("---");
  });

  it("names files after the matchup and the day", () => {
    expect(fileBaseName(info)).toBe("long-island-ducks-at-york-revolution-2026-10-08");
  });
});
