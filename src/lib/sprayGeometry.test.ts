import { describe, it, expect } from "vitest";
import { BASES, FIELD, describeSpot, isBallInPlay, isHit, runnerPath, sprayPoint, sprayPolar, toPolar, toXY } from "./sprayGeometry";
import { parseShorthand } from "./shorthand";
import { INITIAL_GAME_STATE } from "@/types/game";
import type { Play } from "@/types/game";

const play = (p: Partial<Play>): Play => ({
  action: "single",
  description: "",
  runners: [],
  rbi: 0,
  outs_recorded: 0,
  fielders_involved: [],
  confidence: "high",
  ...p,
});

const distance = (p: { x: number; y: number }) => Math.hypot(p.x - FIELD.home.x, p.y - FIELD.home.y);
const inFair = (p: { x: number; y: number }) => Math.abs(p.x - FIELD.home.x) <= FIELD.home.y - p.y + 0.01;

describe("sprayPoint", () => {
  it("puts left field on the left and right field on the right", () => {
    expect(sprayPoint(play({ hit_location: "left field", hit_type: "fly ball" }), 0).x).toBeLessThan(FIELD.home.x);
    expect(sprayPoint(play({ hit_location: "right field", hit_type: "fly ball" }), 0).x).toBeGreaterThan(FIELD.home.x);
  });

  it("sends home runs over the fence and keeps fly outs inside it", () => {
    expect(distance(sprayPoint(play({ action: "home run", hit_location: "left field" }), 0))).toBeGreaterThan(FIELD.fence);
    expect(distance(sprayPoint(play({ action: "fly out", hit_location: "center field", hit_type: "fly ball" }), 3))).toBeLessThan(FIELD.fence);
  });

  it("keeps grounders to short in the infield", () => {
    const p = sprayPoint(play({ action: "ground out", hit_location: "shortstop", hit_type: "ground ball" }), 2);
    expect(distance(p)).toBeLessThan(FIELD.dirt);
    expect(p.x).toBeLessThan(FIELD.home.x);
  });

  it("falls back to the zone when there is no location", () => {
    expect(sprayPoint(play({ field_zone: 5, hit_type: "line drive" }), 0).x).toBeGreaterThan(FIELD.home.x);
  });

  it("never leaves fair territory, whatever the nudge", () => {
    for (let i = 0; i < 40; i++) {
      expect(inFair(sprayPoint(play({ hit_location: "left field line", hit_type: "line drive" }), i))).toBe(true);
      expect(inFair(sprayPoint(play({ hit_location: "right field line", hit_type: "ground ball" }), i))).toBe(true);
    }
  });
});

describe("isBallInPlay and isHit", () => {
  it("skips plays where nothing was hit", () => {
    expect(isBallInPlay(play({ action: "strikeout", field_zone: 3 }))).toBe(false);
    expect(isBallInPlay(play({ action: "fly out", field_zone: 3 }))).toBe(true);
    expect(isBallInPlay(play({ action: "single" }))).toBe(false);
  });

  it("tells hits from outs", () => {
    expect(isHit(play({ action: "double" }))).toBe(true);
    expect(isHit(play({ action: "fly out" }))).toBe(false);
  });
});

// where the play-by-play says the ball went, and where the chart puts it
describe("sprayPolar matches the play-by-play", () => {
  const at = (p: Partial<Play>) => sprayPolar(play(p));
  const infield = (r: number) => r < FIELD.dirt;
  const outfield = (r: number) => r > FIELD.dirt && r < FIELD.fence;

  it("keeps a bunt down the third base line in front of the plate, on the left", () => {
    const p = at({ action: "single", hit_location: "third base line", hit_type: "bunt" });
    expect(p.radius).toBeLessThan(50);
    expect(p.angle).toBeLessThan(-35);
  });

  it("sends a single up the middle through to center field", () => {
    const p = at({ action: "single", hit_location: "up the middle", hit_type: "ground ball" });
    expect(Math.abs(p.angle)).toBeLessThan(5);
    expect(outfield(p.radius)).toBe(true);
  });

  it("puts a ground ball single through the hole on the left side of the outfield grass", () => {
    const p = at({ action: "single", hit_location: "between short and third", hit_type: "ground ball" });
    expect(p.angle).toBeLessThan(-20);
    expect(outfield(p.radius)).toBe(true);
  });

  it("keeps an infield single in the infield", () => {
    expect(infield(at({ action: "single", hit_location: "infield single to short", hit_type: "ground ball", fielders_involved: ["6"] }).radius)).toBe(true);
  });

  it("puts a double down the line in the corner and a triple near the wall", () => {
    const corner = at({ action: "double", hit_location: "third base line", hit_type: "ground ball" });
    expect(corner.angle).toBeLessThan(-38);
    expect(outfield(corner.radius)).toBe(true);
    expect(at({ action: "triple", hit_location: "right-center gap" }).radius).toBeGreaterThan(at({ action: "double", hit_location: "right-center gap" }).radius);
  });

  it("draws outs where the fielder who made them stands", () => {
    const sixThree = at({ action: "ground out", hit_location: "shortstop", fielders_involved: ["6", "3"], hit_type: "ground ball" });
    expect(sixThree.angle).toBeLessThan(0);
    expect(infield(sixThree.radius)).toBe(true);
    const fourThree = at({ action: "ground out", hit_location: "second base", fielders_involved: ["4", "3"], hit_type: "ground ball" });
    expect(fourThree.angle).toBeGreaterThan(0);
    expect(at({ action: "ground out", fielders_involved: ["1", "3"] }).radius).toBeLessThan(50);
    expect(at({ action: "pop out", fielders_involved: ["2"] }).radius).toBeLessThan(25);
  });

  it("puts a caught fly ball deeper than a liner, and a liner deeper than a pop up, to the same outfielder", () => {
    const fly = at({ action: "fly out", fielders_involved: ["8"], hit_location: "center field", hit_type: "fly ball" }).radius;
    const liner = at({ action: "line out", fielders_involved: ["8"], hit_location: "center field", hit_type: "line drive" }).radius;
    const pop = at({ action: "pop out", fielders_involved: ["8"], hit_location: "center field", hit_type: "pop up" }).radius;
    expect(fly).toBeGreaterThan(liner);
    expect(liner).toBeGreaterThan(pop);
    expect(outfield(pop)).toBe(true);
  });

  it("places shorthand the same way it reads", () => {
    const s = INITIAL_GAME_STATE;
    const f7 = sprayPolar(parseShorthand("F7", s)!);
    expect(f7.angle).toBeLessThan(-20);
    expect(outfield(f7.radius)).toBe(true);
    const p4 = sprayPolar(parseShorthand("P4", s)!);
    expect(p4.angle).toBeGreaterThan(0);
    expect(infield(p4.radius)).toBe(true);
    const e5 = sprayPolar(parseShorthand("E5", s)!);
    expect(e5.angle).toBeLessThan(-30);
    expect(infield(e5.radius)).toBe(true);
  });
});

describe("dragging a dot", () => {
  it("names the spot it was dropped on in the play-by-play's words", () => {
    expect(describeSpot(toXY(-22, 150))).toBe("left-center gap");
    expect(describeSpot(toXY(30, 170))).toBe("deep right field");
    expect(describeSpot(toXY(0, 115))).toBe("shallow center field");
    expect(describeSpot(toXY(-40, 140))).toBe("left field line");
    expect(describeSpot(toXY(-15, 90))).toBe("shortstop");
    expect(describeSpot(toXY(0, 15))).toBe("in front of the plate");
    expect(describeSpot(toXY(-20, FIELD.fence + 15))).toBe("over the fence in left field");
    expect(describeSpot(toXY(-60, 120))).toMatch(/^foul territory/);
  });

  it("puts a dragged ball exactly where it was dropped", () => {
    expect(sprayPoint(play({ hit_location: "left field", spray: { x: 42, y: 77 } }), 3)).toEqual({ x: 42, y: 77 });
  });

  it("round-trips a point through its angle and distance", () => {
    const p = toPolar(toXY(-25, 130));
    expect(p.angle).toBeCloseTo(-25);
    expect(p.radius).toBeCloseTo(130);
  });
});

describe("runner paths", () => {
  it("follows the bases from where he started to where he ended", () => {
    expect(runnerPath("1st", "3rd")).toEqual([BASES.first, BASES.second, BASES.third]);
    expect(runnerPath("2nd", "home")).toEqual([BASES.second, BASES.third, FIELD.home]);
    expect(runnerPath("home", "home")).toHaveLength(5);
    // put out going for the next base
    expect(runnerPath("1st", "out")).toEqual([BASES.first, BASES.second]);
    expect(runnerPath("2nd", "2nd")).toEqual([]);
  });
});

describe("words and dots agree", () => {
  it("reads a dot back as the outfield words that placed it", () => {
    for (const where of ["left field line", "left field", "left-center gap", "center field", "right-center gap", "right field", "right field line"]) {
      const p = sprayPolar(play({ action: "double", hit_location: where }));
      expect(describeSpot(toXY(p.angle, p.radius))).toBe(where);
    }
  });
});
