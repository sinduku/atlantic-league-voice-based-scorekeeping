import { describe, expect, it } from "vitest";
import { challengeCounts, challengeLabel } from "./challenges";
import type { Play } from "@/types/game";

const play = (challenge: Play["challenge"]): Play => ({ action: "single", description: "", runners: [], rbi: 0, outs_recorded: 0, fielders_involved: [], confidence: "high", challenge });
const teams = { away: "York Revolution", home: "Long Island Ducks" };

describe("challenges", () => {
  it("reads as the team, the outcome and the note", () => {
    expect(challengeLabel({ team: "home", result: "overturned", note: "tag beat him" }, teams)).toBe("Long Island Ducks challenge: overturned (tag beat him)");
    expect(challengeLabel({ team: "away", result: "stands" }, teams)).toBe("York Revolution challenge: call stands");
  });

  it("counts each team's challenges and how many won", () => {
    const plays = [play({ team: "home", result: "overturned" }), play({ team: "home", result: "stands" }), play(null), play({ team: "away", result: "stands" })];
    expect(challengeCounts(plays)).toEqual({ away: { used: 1, overturned: 0 }, home: { used: 2, overturned: 1 } });
  });
});
