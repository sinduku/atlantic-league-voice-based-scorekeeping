import { describe, it, expect } from "vitest";
import { buildNameIndex, correctNames, soundKey } from "./correctNames";
import players from "@/data/players.json";

const index = buildNameIndex([
  "Ronald Acuña Jr.",
  "Elly De La Cruz",
  "Fernando Tatis Jr.",
  "Aaron Judge",
  "Vladimir Guerrero Jr.",
  "A. J. Puk",
  "Trevor Story",
  "Ben Singleton",
  "Gary Sánchez",
]);

describe("correctNames", () => {
  it.each([
    ["acuna singles to left", "Acuña singles to left"],
    ["Ronald Acuna doubles", "Ronald Acuña doubles"],
    ["de la cruz steals second", "De La Cruz steals second"],
    ["tatis grounds out 6-3", "Tatis grounds out 6-3"],
    ["Guerero homers", "Guerrero homers"],
    ["AJ Puk strikes out the side", "A. J. Puk strikes out the side"],
    ["sanchez, the catcher, throws", "Sánchez, the catcher, throws"],
    ["acuna's single", "Acuña's single"],
  ])("%s -> %s", (input, expected) => {
    expect(correctNames(input, index)).toBe(expected);
  });

  it("never turns baseball words into names", () => {
    for (const t of [
      "single to center, runner scores from second",
      "ground ball to short, 6-4-3 double play",
      "line drive to right field",
      "fly out to the left fielder",
      "ball four",
    ]) {
      expect(correctNames(t, index)).toBe(t);
    }
  });

  it("leaves the transcript alone without an index", () => {
    expect(correctNames("acuna singles", null)).toBe("acuna singles");
  });

  it("gives sound-alike spellings the same key", () => {
    expect(soundKey("Sánchez")).toBe(soundKey("sanches"));
    expect(soundKey("Phillips")).toBe(soundKey("Filips"));
  });
});

// against the real player list: everyday scorekeeping words sit a letter or a
// sound away from somebody's surname, and each of these once came back as one
describe("correctNames with the full player list", () => {
  const league = buildNameIndex((players as { players: string[][] }).players.map((p) => p[0]));

  it.each([
    "Dickerson reaches when the shortstop bobbles it",
    "he beats the throw",
    "a chopper to third",
    "a frozen rope into the gap",
    "can of corn to left",
    "dinger to left",
    "throwing error on the third baseman",
    "around third and heads home",
    "about to score",
    "still at second",
    "throws wide of first",
    "where did the runner go",
    "after the throw he was safe",
    "slow roller to short",
    "dribbler down the line",
    "blooper to shallow center",
    "plunked on the elbow",
    "rung up on a curve",
    "twin killing to end the inning",
    "booted by the shortstop",
    "tags up and scores",
    "runners hold",
  ])("leaves %j alone", (phrase) => {
    expect(correctNames(phrase, league).toLowerCase()).toBe(phrase.toLowerCase());
  });

  it("still corrects a misheard real name", () => {
    expect(correctNames("mookie bets doubles", league)).toContain("Betts");
  });
});
