import type { Play } from "@/types/game";
import { HIT_ACTIONS } from "@/lib/boxScore";

// Where a batted ball lands on the spray chart. The field is drawn in a
// 300 x 260 box with home plate at the bottom; a ball is placed by its
// direction (from hit_location, or the zone when that's all there is) and its
// distance (from how it was hit), so a grounder, a liner and a home run to
// left field land in different places instead of on one spot.
//
// SprayChart.tsx draws this on screen and exportPdf.ts draws it in the PDF,
// so both use these numbers.

export const FIELD = {
  width: 300,
  height: 260,
  home: { x: 150, y: 230 },
  // home to the fence, the same in every direction
  fence: 180,
  // home to the back of the infield dirt
  dirt: 100,
  // home to first, second and third
  base: 64,
};

// angle 0 is straight out to center field, negative is toward left
export function toXY(angleDeg: number, radius: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: FIELD.home.x + radius * Math.sin(a), y: FIELD.home.y - radius * Math.cos(a) };
}

export const BASES = {
  first: toXY(45, FIELD.base),
  second: toXY(0, FIELD.base * Math.SQRT2),
  third: toXY(-45, FIELD.base),
};

export const HIT_COLORS: Record<string, string> = {
  "ground ball": "#b45309",
  "line drive": "#dc2626",
  "fly ball": "#2563eb",
  "pop up": "#6b7280",
  bunt: "#ca8a04",
};
const DEFAULT_COLOR = "#7c3aed";

export const LEGEND = [
  { label: "Ground ball", color: HIT_COLORS["ground ball"] },
  { label: "Line drive", color: HIT_COLORS["line drive"] },
  { label: "Fly ball", color: HIT_COLORS["fly ball"] },
  { label: "Pop up", color: HIT_COLORS["pop up"] },
  { label: "Bunt", color: HIT_COLORS.bunt },
];

const NO_BALL_IN_PLAY = new Set(["strikeout", "walk", "hit by pitch", "stolen base", "wild pitch", "passed ball", "balk"]);

export function isBallInPlay(play: Play): boolean {
  return !NO_BALL_IN_PLAY.has(play.action.toLowerCase()) && !!(play.field_zone || play.hit_location);
}

export const isHit = (play: Play) => HIT_ACTIONS.has(play.action.toLowerCase());

export const markerColor = (play: Play) => HIT_COLORS[(play.hit_type || "").toLowerCase()] ?? DEFAULT_COLOR;

// checked in order, so the specific phrases come before the general ones
const DIRECTIONS: [RegExp, number, "infield" | "outfield"][] = [
  [/left.{0,6}line|third.{0,6}line/, -40, "outfield"],
  [/right.{0,6}line|first.{0,6}line/, 40, "outfield"],
  [/left.{0,3}cent(er|re)/, -22, "outfield"],
  [/right.{0,3}cent(er|re)/, 22, "outfield"],
  [/left/, -30, "outfield"],
  [/right/, 30, "outfield"],
  [/cent(er|re)/, 0, "outfield"],
  [/hole/, -16, "infield"],
  [/short/, -20, "infield"],
  [/third/, -34, "infield"],
  [/second/, 14, "infield"],
  [/middle/, 0, "infield"],
  [/first/, 34, "infield"],
  [/pitcher|mound/, 0, "infield"],
  [/catcher|plate|home/, 0, "infield"],
];

// field_zone numbers, as normalizePlay.ts assigns them. server/phrasings.test.js
// checks FIELD_ZONES there against the keys here
export const ZONE_DIRECTIONS: Record<number, [number, "infield" | "outfield"]> = {
  1: [-38, "outfield"],
  2: [-22, "outfield"],
  3: [0, "outfield"],
  4: [22, "outfield"],
  5: [38, "outfield"],
  6: [-22, "infield"],
  7: [6, "infield"],
  8: [28, "infield"],
  9: [0, "infield"],
};

function direction(play: Play): [number, "infield" | "outfield"] {
  const where = (play.hit_location || "").toLowerCase();
  for (const [pattern, angle, area] of DIRECTIONS) {
    if (pattern.test(where)) return [angle, area];
  }
  return ZONE_DIRECTIONS[play.field_zone ?? 3] ?? [0, "outfield"];
}

function distance(play: Play, area: "infield" | "outfield"): number {
  const action = play.action.toLowerCase();
  const type = (play.hit_type || "").toLowerCase();
  const where = (play.hit_location || "").toLowerCase();

  if (action === "home run") return FIELD.fence + 18;
  if (area === "infield") {
    if (/catcher|plate|home/.test(where)) return 16;
    if (type === "bunt") return 32;
    if (/pitcher|mound/.test(where)) return 44;
    if (type === "pop up") return 62;
    if (type === "line drive") return 82;
    return 76;
  }
  // a hit that rolled to the wall goes deeper than the catch on a fly out
  const extra = action === "triple" ? 22 : action === "double" ? 12 : 0;
  if (type === "fly ball") return Math.min(150 + extra, FIELD.fence - 6);
  if (type === "line drive") return 128 + extra;
  if (type === "pop up") return 108;
  if (type === "ground ball") return 112 + extra;
  return 132 + extra;
}

// a small, repeatable nudge so plays to the same spot don't hide each other
function spread(index: number): [number, number] {
  const a = ((index * 37) % 11) - 5; // -5..5 degrees
  const r = ((index * 53) % 13) - 6; // -6..6 px
  return [a * 0.8, r];
}

export function sprayPoint(play: Play, index: number) {
  const [angle, area] = direction(play);
  const [da, dr] = spread(index);
  // keep the dot inside fair territory however it is nudged
  const a = Math.max(-43, Math.min(43, angle + da));
  return toXY(a, Math.max(10, distance(play, area) + dr));
}
