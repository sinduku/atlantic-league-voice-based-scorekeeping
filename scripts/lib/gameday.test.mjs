import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import { extractPlays, describeSituation, sampleByAction, seededRandom } from "./gameday.mjs";
import { parseCsv, toCsv } from "./csv.mjs";

const require = createRequire(import.meta.url);
const { validatePlay } = require("../../server/validatePlay.js");

const pitch = (balls, strikes, extra = {}) => ({
  isPitch: true,
  count: { balls, strikes },
  details: { type: { description: "Four-Seam Fastball" } },
  ...extra,
});

const move = (name, start, end, playIndex, eventType, extra = {}) => ({
  movement: { start, end, isOut: false, ...extra.movement },
  details: { runner: { id: name, fullName: name }, playIndex, eventType },
  credits: extra.credits ?? [],
});

const atBat = (atBatIndex, inning, isTopInning, result, outs, playEvents, runners) => ({
  about: { atBatIndex, inning, isTopInning },
  matchup: { batter: { fullName: "Batter" }, pitcher: { fullName: "Pitcher" } },
  count: { outs },
  result: { awayScore: 0, homeScore: 0, rbi: 0, ...result },
  playEvents,
  runners,
});

// one made-up top of the 1st, the start of the bottom, and an extra inning
const feed = {
  gamePk: 1,
  gameData: { datetime: { officialDate: "2025-07-01" } },
  liveData: {
    plays: {
      allPlays: [
        atBat(0, 1, true, { eventType: "single", description: "Abe singles." }, 0, [
          pitch(0, 0),
          pitch(1, 0),
          pitch(1, 0, {
            hitData: {
              trajectory: "line_drive",
              hardness: "hard",
              location: "8",
              coordinates: { coordX: 125, coordY: 90 },
            },
          }),
        ], [move("Abe", null, "1B", 2, "single")]),

        atBat(
          1,
          1,
          true,
          { eventType: "double", description: "Ben doubles, Abe scores.", rbi: 1, awayScore: 1 },
          0,
          [
            pitch(0, 0),
            { isPitch: false, details: { eventType: "stolen_base_2b", description: "Abe steals 2nd base." } },
            pitch(0, 1),
            pitch(0, 1, { hitData: { trajectory: "fly_ball", location: "7" } }),
          ],
          [
            move("Abe", "1B", "2B", 1, "stolen_base_2b"),
            move("Abe", "2B", "score", 3, "double"),
            move("Ben", null, "2B", 3, "double"),
          ]
        ),

        atBat(2, 1, true, { eventType: "field_out", description: "Cal grounds out, SS to 1B. Ben to 3rd.", awayScore: 1 }, 1, [
          pitch(0, 0, { hitData: { trajectory: "ground_ball", location: "6" } }),
        ], [
          move("Cal", null, null, 0, "field_out", {
            movement: { isOut: true },
            credits: [
              { position: { abbreviation: "SS" }, credit: "f_assist" },
              { position: { abbreviation: "1B" }, credit: "f_putout" },
            ],
          }),
          move("Ben", "2B", "3B", 0, "field_out"),
        ]),

        atBat(3, 1, true, { eventType: "strikeout", description: "Dan strikes out.", awayScore: 1 }, 2, [
          pitch(0, 0),
          pitch(0, 1),
          pitch(0, 2),
        ], [move("Dan", null, null, 2, "strikeout", { movement: { isOut: true } })]),

        atBat(4, 1, true, { eventType: "field_out", description: "Eli pops out to 2B.", awayScore: 1 }, 3, [
          pitch(0, 0, { hitData: { trajectory: "popup", location: "4" } }),
        ], [move("Eli", null, null, 0, "field_out", { movement: { isOut: true } })]),

        atBat(5, 1, false, { eventType: "walk", description: "Fay walks.", awayScore: 1 }, 0, [
          pitch(0, 0),
          pitch(1, 0),
          pitch(2, 0),
          pitch(3, 0),
        ], [move("Fay", null, "1B", 3, "walk")]),

        atBat(6, 10, true, { eventType: "single", description: "Extra innings single." }, 0, [
          pitch(0, 0),
        ], [move("Gus", null, "1B", 0, "single")]),
      ],
    },
  },
};

describe("extractPlays", () => {
  const records = extractPlays(feed);
  const byId = Object.fromEntries(records.map((r) => [r.id, r]));

  it("pulls plate appearances and mid at-bat events, skipping extra innings", () => {
    expect(records.map((r) => r.id)).toEqual(["1-0", "1-1-1", "1-1", "1-2", "1-3", "1-4", "1-5"]);
    expect(records.map((r) => r.label.action)).toEqual([
      "single",
      "stolen base",
      "double",
      "ground out",
      "strikeout",
      "fly out",
      "walk",
    ]);
  });

  it("records the game state from before each play", () => {
    expect(byId["1-1-1"].game_state.runners).toEqual({ first: "Abe", second: null, third: null });
    expect(byId["1-1"].game_state.runners).toEqual({ first: null, second: "Abe", third: null });
    expect(byId["1-2"].game_state).toMatchObject({
      outs: 0,
      score: { away: 1, home: 0 },
      runners: { first: null, second: "Ben", third: null },
    });
    expect(byId["1-4"].game_state).toMatchObject({ outs: 2, runners: { third: "Ben" } });
  });

  it("resets outs and bases at the start of a new half inning", () => {
    expect(byId["1-5"].game_state).toEqual({
      inning: 1,
      half: "bottom",
      outs: 0,
      score: { away: 1, home: 0 },
      runners: { first: null, second: null, third: null },
    });
  });

  it("labels runners, rbi, outs, and fielders in the app's shape", () => {
    expect(byId["1-1-1"].label.runners).toEqual([{ from: "1st", to: "2nd", runner: "Abe" }]);
    expect(byId["1-1"].label).toMatchObject({
      rbi: 1,
      outs_recorded: 0,
      runners: [{ from: "2nd", to: "home", runner: "Abe" }],
      hit_location: "left field",
      hit_type: "fly ball",
    });
    expect(byId["1-2"].label).toMatchObject({
      outs_recorded: 1,
      fielders_involved: ["SS", "1B"],
      runners: [{ from: "2nd", to: "3rd", runner: "Ben" }],
      field_zone: 6,
    });
  });

  it("maps hit data and the count before the last pitch", () => {
    expect(byId["1-0"].label).toMatchObject({
      hit_type: "line drive",
      hit_hardness: "hard",
      hit_location: "center field",
      field_zone: 3,
      count: "1-0",
    });
    expect(byId["1-3"].label.count).toBe("0-1");
  });

  it("produces plays that pass the server's validation untouched", () => {
    for (const record of records) {
      const result = validatePlay(record.label);
      expect(result.ok).toBe(true);
      expect(result.patched).toBe(false);
    }
  });
});

describe("describeSituation", () => {
  it("reads like a scorekeeper would say it", () => {
    expect(describeSituation(extractPlays(feed)[3].game_state)).toBe(
      "Top 1, 0 out, runners on 2nd, away 1 - home 0"
    );
  });
});

describe("sampleByAction", () => {
  it("keeps every rare action before filling up with common ones", () => {
    const records = [
      ...Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, label: { action: "single" } })),
      { id: "b0", label: { action: "balk" } },
    ];
    const picked = sampleByAction(records, 4, seededRandom(1));
    expect(picked).toHaveLength(4);
    expect(picked.map((r) => r.id)).toContain("b0");
  });
});

describe("csv", () => {
  it("round trips commas, quotes, and newlines", () => {
    const rows = [{ id: "1", read_this: 'He said "6-4-3", then\nleft', transcript: "" }];
    const columns = ["id", "read_this", "transcript"];
    expect(parseCsv(toCsv(rows, columns))).toEqual(rows);
  });

  it("handles a byte order mark and windows line endings", () => {
    expect(parseCsv("\uFEFFid,transcript\r\n1,single to left\r\n")).toEqual([
      { id: "1", transcript: "single to left" },
    ]);
  });
});