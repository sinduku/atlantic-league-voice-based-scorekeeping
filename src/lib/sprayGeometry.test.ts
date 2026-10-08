import { describe, it, expect } from "vitest";
import { FIELD, isBallInPlay, isHit, sprayPoint } from "./sprayGeometry";
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
