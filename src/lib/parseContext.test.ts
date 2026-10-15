import { describe, expect, it } from "vitest";
import { buildParseContext } from "./parseContext";
import { INITIAL_GAME_STATE, type GameState, type Play } from "@/types/game";
import type { LoggedPlay } from "./boxScore";

const play = (overrides: Partial<Play>): Play => ({
  action: "ground out",
  description: "Ground out",
  runners: [],
  rbi: 0,
  outs_recorded: 1,
  fielders_involved: [],
  confidence: "high",
  ...overrides,
});

const at = (half: "top" | "bottom", inning = 1): GameState => ({ ...INITIAL_GAME_STATE, half, inning });
const logged = (p: Play, before: GameState): LoggedPlay => ({ play: p, before, after: before });

const TEAMS = { away: "Ducks", home: "Blue Crabs" };

describe("buildParseContext", () => {
  it("names the batting and fielding teams by half", () => {
    expect(buildParseContext([], at("top"), TEAMS)).toMatchObject({ battingTeam: "Ducks", fieldingTeam: "Blue Crabs" });
    expect(buildParseContext([], at("bottom"), TEAMS)).toMatchObject({ battingTeam: "Blue Crabs", fieldingTeam: "Ducks" });
  });

  it("leaves out the placeholder team names", () => {
    const context = buildParseContext([], at("top"), { away: "Away", home: "Home" });
    expect(context.battingTeam).toBeUndefined();
    expect(context.fieldingTeam).toBeUndefined();
  });

  it("takes the pitcher from the last play in the same half", () => {
    const log = [
      logged(play({ pitcher: "Rivera" }), at("top", 1)),
      logged(play({ pitcher: "Okafor" }), at("bottom", 1)),
      logged(play({}), at("top", 2)),
    ];
    expect(buildParseContext(log, at("top", 2), TEAMS).pitcher).toBe("Rivera");
    expect(buildParseContext(log, at("bottom", 2), TEAMS).pitcher).toBe("Okafor");
  });

  it("lists runners on base first, then players named most recently, once each", () => {
    const log = [
      logged(play({ batter: "Ortiz", pitcher: "Rivera" }), at("top")),
      logged(play({ batter: "Jake Smith", runners: [{ from: "1st", to: "2nd", runner: "ortiz" }, { from: "2nd", to: "3rd", runner: "runner" }] }), at("top")),
    ];
    const state = { ...at("top"), runners: { first: "Chen", second: null, third: null } };
    expect(buildParseContext(log, state, TEAMS).players).toEqual(["Chen", "Jake Smith", "ortiz", "Rivera"]);
  });

  it("keeps the list short", () => {
    const log = Array.from({ length: 40 }, (_, i) => logged(play({ batter: `Player ${i}` }), at("top")));
    const players = buildParseContext(log, at("top"), TEAMS).players;
    expect(players).toHaveLength(20);
    expect(players[0]).toBe("Player 39");
  });
});
