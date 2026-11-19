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

const NO_BALL_IN_PLAY = new Set(["strikeout", "walk", "hit by pitch", "stolen base", "caught stealing", "pickoff", "wild pitch", "passed ball", "balk"]);

export function isBallInPlay(play: Play): boolean {
  return !NO_BALL_IN_PLAY.has(play.action.toLowerCase()) && !!(play.field_zone || play.hit_location);
}

export const isHit = (play: Play) => HIT_ACTIONS.has(play.action.toLowerCase());

export const markerColor = (play: Play) => HIT_COLORS[(play.hit_type || "").toLowerCase()] ?? DEFAULT_COLOR;

// Where the ball went, from the words in the play-by-play. Checked in order,
// so the specific phrases come before the general ones ("left-center" before
// "left", "between short and third" before "short"). The area says whether
// the words point at the infield or the outfield; how far the ball went
// still depends on what happened (see depth below).
const DIRECTIONS: [RegExp, number, "infield" | "outfield"][] = [
  [/left.{0,12}line|third.{0,12}line/, -41, "outfield"],
  [/right.{0,12}line|first.{0,12}line/, 41, "outfield"],
  [/left.{0,3}cent(er|re)/, -22, "outfield"],
  [/right.{0,3}cent(er|re)/, 22, "outfield"],
  [/short.{0,14}third|third.{0,14}short|\bhole\b|left side/, -27, "infield"],
  [/first.{0,14}second|second.{0,14}first|right side/, 26, "infield"],
  [/up the middle|through the middle|middle|past the pitcher|back up the box/, 0, "infield"],
  [/left/, -29, "outfield"],
  [/right/, 29, "outfield"],
  [/cent(er|re)/, 0, "outfield"],
  [/short/, -15, "infield"],
  [/third/, -36, "infield"],
  [/second/, 15, "infield"],
  [/first/, 36, "infield"],
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

// where each fielder stands, as [angle, distance from home]: where an out
// was made, or an error committed, when the words don't say more
const FIELDER_SPOTS: Record<string, [number, number]> = {
  "1": [0, 44],
  "2": [0, 14],
  "3": [36, 86],
  "4": [15, 98],
  "5": [-36, 86],
  "6": [-15, 98],
  "7": [-29, 150],
  "8": [0, 160],
  "9": [29, 150],
};

const OUTS_IN_PLAY = new Set([
  "ground out",
  "fly out",
  "line out",
  "pop out",
  "sacrifice fly",
  "sacrifice bunt",
  "fielder's choice",
  "error",
]);

export interface SprayPolar {
  // 0 is straight out to center field, negative toward left
  angle: number;
  // distance from home plate, in the chart's units (the fence is 180)
  radius: number;
}

// Where a ball in play goes on the chart, before the small nudge that keeps
// dots apart. The direction comes from the play's words (hit_location), or
// the fielder who made the play, or the zone. The distance comes from what
// happened:
// - a home run clears the fence; a triple reaches the wall, a double the
//   warning track or the gap, even "down the line" from an infield word
// - a single the words place in the infield got through to the outfield
//   grass, unless it was a bunt or the words say it stayed in the infield
// - an out, or an error, is drawn where the fielder who handled it stands,
//   and a fly ball caught in the outfield sits deeper than a liner or a
//   blooper
export function sprayPolar(play: Play): SprayPolar {
  const action = play.action.toLowerCase();
  const type = (play.hit_type || "").toLowerCase();
  const where = (play.hit_location || "").toLowerCase();
  const fielder = play.fielders_involved?.[0];
  const spot = fielder ? FIELDER_SPOTS[fielder] : undefined;

  let angle: number;
  let area: "infield" | "outfield";
  const said = DIRECTIONS.find(([pattern]) => pattern.test(where));
  if (said) [, angle, area] = said;
  else if (spot) [angle, area] = [spot[0], spot[1] > 100 ? "outfield" : "infield"];
  else [angle, area] = ZONE_DIRECTIONS[play.field_zone ?? 3] ?? [0, "outfield"];

  if (action === "home run") return { angle, radius: FIELD.fence + 18 };
  if (action === "triple") return { angle, radius: FIELD.fence - 14 };
  if (action === "double") return { angle, radius: type === "ground ball" ? 148 : 154 };

  if (action === "single") {
    const stayedIn = type === "bunt" || /infield|bunt|dribbl|swinging bunt|in front of the plate/.test(where);
    if (stayedIn) {
      if (/catcher|plate|home/.test(where)) return { angle, radius: 18 };
      return { angle, radius: type === "bunt" ? 34 : spot && spot[1] <= 100 ? spot[1] - 6 : 80 };
    }
    // through the infield or over it: the outfield grass in front of the
    // fielder who picked it up
    if (type === "line drive") return { angle, radius: 126 };
    if (type === "fly ball" || type === "pop up") return { angle, radius: 120 };
    return { angle, radius: 116 };
  }

  if (OUTS_IN_PLAY.has(action)) {
    if (type === "bunt" || action === "sacrifice bunt") return { angle, radius: /catcher|plate|home/.test(where) ? 18 : 34 };
    const outfield = spot ? spot[1] > 100 : area === "outfield";
    if (outfield) {
      if (type === "pop up" || action === "pop out") return { angle, radius: 116 };
      if (type === "line drive" || action === "line out") return { angle, radius: 136 };
      if (type === "ground ball") return { angle, radius: 120 };
      return { angle, radius: 156 };
    }
    if (/catcher|plate|home/.test(where) || fielder === "2") return { angle, radius: 16 };
    if (/pitcher|mound/.test(where) || fielder === "1") return { angle, radius: type === "pop up" || action === "pop out" ? 52 : 44 };
    const base = spot ? spot[1] : 90;
    if (type === "pop up" || action === "pop out") return { angle, radius: base - 16 };
    if (type === "line drive" || action === "line out") return { angle, radius: base - 4 };
    return { angle, radius: base };
  }

  return { angle, radius: area === "infield" ? 86 : 132 };
}

// a small, repeatable nudge so plays to the same spot don't hide each other
function spread(index: number): [number, number] {
  const a = ((index * 37) % 11) - 5; // -5..5 degrees
  const r = ((index * 53) % 13) - 6; // -6..6 px
  return [a * 0.8, r];
}

export function sprayPoint(play: Play, index: number) {
  // a dot the scorer dragged stays exactly where they put it
  if (play.spray && Number.isFinite(play.spray.x) && Number.isFinite(play.spray.y)) return { x: play.spray.x, y: play.spray.y };
  const { angle, radius } = sprayPolar(play);
  const [da, dr] = spread(index);
  // keep the dot inside fair territory however it is nudged, and a home run
  // beyond the fence
  const a = Math.max(-43, Math.min(43, angle + da));
  const r = radius > FIELD.fence ? Math.max(FIELD.fence + 8, radius + dr) : Math.min(FIELD.fence - 4, Math.max(10, radius + dr));
  return toXY(a, r);
}

// the chart point back to an angle (0 is center field, negative is left) and
// a distance from home
export function toPolar(point: { x: number; y: number }): SprayPolar {
  const dx = point.x - FIELD.home.x;
  const dy = FIELD.home.y - point.y;
  return { angle: (Math.atan2(dx, dy) * 180) / Math.PI, radius: Math.hypot(dx, dy) };
}

// Words for a spot on the chart, in the same terms the play-by-play uses, so
// a dot dragged to the left-center gap reads "left-center gap" in the log
export function describeSpot(point: { x: number; y: number }): string {
  const { angle, radius } = toPolar(point);
  if (Math.abs(angle) > 45 || point.y > FIELD.home.y) return `foul territory, ${angle < 0 ? "third" : "first"} base side`;
  if (radius > FIELD.fence) {
    const side = angle < -15 ? "left field" : angle > 15 ? "right field" : "center field";
    return `over the fence in ${side}`;
  }
  if (radius < 26) return "in front of the plate";
  if (radius < FIELD.dirt) {
    if (radius < 58 && Math.abs(angle) < 12) return "pitcher";
    if (angle < -27) return "third base";
    if (angle < -6) return "shortstop";
    if (angle <= 6) return "up the middle";
    if (angle <= 27) return "second base";
    return "first base";
  }
  const depth = radius < 125 ? "shallow " : radius > 162 ? "deep " : "";
  const where =
    // halfway between the angles sprayPolar draws each of these at, so a dot
    // left where the words put it reads back the same words
    angle < -36 ? "left field line" : angle < -25.5 ? "left field" : angle < -11 ? "left-center gap" : angle <= 11 ? "center field" : angle <= 25.5 ? "right-center gap" : angle <= 36 ? "right field" : "right field line";
  return depth + where;
}

// home, the three bases and home again: the path a runner takes
const BASE_PATH = ["home", "1st", "2nd", "3rd", "home"] as const;
const BASE_POINTS: Record<string, { x: number; y: number }> = { home: FIELD.home, "1st": BASES.first, "2nd": BASES.second, "3rd": BASES.third };

// the points a runner passes going from one base to another, home last when
// he scores; a runner put out is drawn to the base he was going for
export function runnerPath(from: string, to: string): { x: number; y: number }[] {
  const start = from === "home" ? 0 : BASE_PATH.indexOf(from as (typeof BASE_PATH)[number]);
  if (start < 0) return [];
  const end = to === "out" ? Math.min(start + 1, 4) : to === "home" ? 4 : BASE_PATH.indexOf(to as (typeof BASE_PATH)[number], 1);
  if (end <= start) return [];
  return BASE_PATH.slice(start, end + 1).map((b) => BASE_POINTS[b]);
}

export const basePoint = (base: "first" | "second" | "third") => BASES[base];
