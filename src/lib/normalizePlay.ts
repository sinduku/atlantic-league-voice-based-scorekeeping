import { z } from "zod";
import type { Play } from "@/types/game";

// The deployed parse-play edge function runs an older prompt than server/, and
// its replies drift from the shape the app expects: "double play" as an action,
// "2B (out at 2B)" as a base, "6 (shortstop)" as a fielder, and spray zones
// numbered differently from SprayChart. Every parsed play goes through here
// before the UI sees it, so the scoreboard and spray chart get one shape no
// matter which backend answered.

const NO_BALL_IN_PLAY = new Set([
  "strikeout",
  "walk",
  "hit by pitch",
  "stolen base",
  "wild pitch",
  "passed ball",
  "balk",
]);

const CANONICAL_ACTIONS = [
  "single",
  "double",
  "triple",
  "home run",
  "strikeout",
  "walk",
  "fly out",
  "ground out",
  "hit by pitch",
  "error",
  "fielder's choice",
  "stolen base",
  "wild pitch",
  "passed ball",
  "balk",
  "sacrifice fly",
];

// lowercased, apostrophes dropped, hyphens and underscores read as spaces, so
// "Fielder's-Choice" and "fielders choice" land on the same key
const actionKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const ACTION_ALIASES: Record<string, string> = {
  ...Object.fromEntries(CANONICAL_ACTIONS.map((a) => [actionKey(a), a])),
  "groundout": "ground out",
  "ground ball out": "ground out",
  "grounder": "ground out",
  "flyout": "fly out",
  "fly ball out": "fly out",
  "lineout": "fly out",
  "line out": "fly out",
  "line drive out": "fly out",
  "popout": "fly out",
  "pop out": "fly out",
  "popup": "fly out",
  "pop up": "fly out",
  "pop fly": "fly out",
  "foul out": "fly out",
  "foulout": "fly out",
  "strike out": "strikeout",
  "struck out": "strikeout",
  "strikeout looking": "strikeout",
  "strikeout swinging": "strikeout",
  "k": "strikeout",
  "base on balls": "walk",
  "bb": "walk",
  "intentional walk": "walk",
  "ibb": "walk",
  "hbp": "hit by pitch",
  "hit batter": "hit by pitch",
  "homer": "home run",
  "homerun": "home run",
  "hr": "home run",
  "grand slam": "home run",
  "sac fly": "sacrifice fly",
  "sf": "sacrifice fly",
  "fc": "fielder's choice",
  "fielder choice": "fielder's choice",
  "steal": "stolen base",
  "sb": "stolen base",
  "wp": "wild pitch",
  "pb": "passed ball",
  "reached on error": "error",
  "1b": "single",
  "2b": "double",
  "3b": "triple",
};

const AIRBORNE = new Set(["fly ball", "line drive", "pop up"]);

export function normalizeAction(raw: string, hitType?: string | null): string {
  const key = actionKey(raw);
  // a double or triple play is an out on the batter; which kind depends on how
  // the ball was hit. matched anywhere in the phrase, since the model words it
  // as "ground into double play", "lined into a triple play" and so on
  if (/\b(double|triple) play\b|^(dp|tp|gidp)$/.test(key)) {
    return hitType && AIRBORNE.has(hitType.toLowerCase()) ? "fly out" : "ground out";
  }
  return ACTION_ALIASES[key] ?? key;
}

export function normalizeBase(raw: string): string {
  const s = raw.toLowerCase().trim();
  if (/\bout\b/.test(s)) return "out";
  if (/home|plate|scor|batter/.test(s)) return "home";
  if (/\b(first|1st|1b)\b|^1$/.test(s)) return "1st";
  if (/\b(second|2nd|2b)\b|^2$/.test(s)) return "2nd";
  if (/\b(third|3rd|3b)\b|^3$/.test(s)) return "3rd";
  return raw.trim();
}

const POSITION_NAMES: [RegExp, string][] = [
  [/pitcher/, "1"],
  [/catcher/, "2"],
  [/first/, "3"],
  [/second/, "4"],
  [/third/, "5"],
  [/short/, "6"],
  [/left/, "7"],
  [/cent(er|re)/, "8"],
  [/right/, "9"],
];

// "6", 6, "6 (shortstop)" and "shortstop" all mean position 6. anything else
// (a player name, say) cannot be placed and comes back null
export function normalizeFielder(raw: unknown): string | null {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= 1 && raw <= 9 ? String(raw) : null;
  }
  if (typeof raw !== "string") return null;
  const leading = raw.match(/^\s*([1-9])\b/);
  if (leading) return leading[1];
  const s = raw.toLowerCase();
  for (const [pattern, position] of POSITION_NAMES) {
    if (pattern.test(s)) return position;
  }
  return null;
}

// Zone numbers follow ZONE_COORDS in SprayChart.tsx. Infield words are checked
// before outfield ones so "third base line" lands in the infield, not left field.
const ZONE_BY_FIELDER: Record<string, number> = {
  "1": 9,
  "2": 9,
  "3": 8,
  "4": 7,
  "5": 6,
  "6": 6,
  "7": 1,
  "8": 3,
  "9": 5,
};

export function zoneFor(hitLocation: string | null | undefined, fielders: string[] = []): number | null {
  if (hitLocation) {
    const s = hitLocation.toLowerCase();
    if (/shortstop|third/.test(s)) return 6;
    if (/second|middle/.test(s)) return 7;
    if (/first/.test(s)) return 8;
    if (/pitcher|mound|catcher|plate/.test(s)) return 9;
    const left = /left/.test(s);
    const right = /right/.test(s);
    const center = /cent(er|re)/.test(s);
    if (left && center) return 2;
    if (right && center) return 4;
    if (center) return 3;
    if (left) return 1;
    if (right) return 5;
  }
  const first = fielders[0];
  return first ? ZONE_BY_FIELDER[first] ?? null : null;
}

function buildPlaySchema(markPatched: () => void) {
  // soft: a bad value becomes null quietly. patch: a bad value becomes a safe
  // default and drops confidence to "low" so the scorer double-checks it
  const soft = <T extends z.ZodTypeAny>(schema: T) => schema.nullable().catch(null);
  const patch = <T extends z.ZodTypeAny>(schema: T, fallback: z.infer<T>) =>
    schema.catch(() => {
      markPatched();
      return fallback;
    });

  return z.object({
    inning: soft(z.number()),
    half: soft(z.enum(["top", "bottom"])),
    batter: soft(z.string()),
    pitcher: soft(z.string()),
    action: z.string(),
    description: z.string(),
    runners: patch(
      z.array(
        z.object({
          from: z.string(),
          to: z.string(),
          runner: soft(z.string()),
        })
      ),
      []
    ),
    rbi: patch(z.number(), 0),
    outs_recorded: patch(z.number(), 0),
    fielders_involved: patch(z.array(z.string()), []),
    hit_location: soft(z.string()),
    hit_type: soft(z.string()),
    hit_hardness: soft(z.string()),
    field_zone: soft(z.number().int().min(1).max(9)),
    pitch_type: soft(z.string()),
    pitch_location: soft(z.string()),
    count: soft(z.string()),
    confidence: patch(z.enum(["high", "medium", "low"]), "low"),
  });
}

export type NormalizeResult =
  | { ok: true; play: Play; patched: boolean }
  | { ok: false; reason: string };

export function normalizePlay(raw: unknown): NormalizeResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "not an object" };
  }
  const input = raw as Record<string, unknown>;

  // without these two there is nothing to score, so no fallback is attempted
  for (const field of ["action", "description"] as const) {
    const value = input[field];
    if (typeof value !== "string" || !value.trim()) {
      return { ok: false, reason: `missing ${field}` };
    }
  }

  let patched = false;
  const markPatched = () => {
    patched = true;
  };

  const hitType = typeof input.hit_type === "string" ? input.hit_type : null;
  const action = normalizeAction(input.action as string, hitType);

  let fielders: unknown = input.fielders_involved;
  if (Array.isArray(fielders)) {
    const mapped = fielders.map(normalizeFielder);
    // an unplaceable fielder is information lost, so the play gets reviewed
    if (mapped.some((f) => f === null)) markPatched();
    fielders = mapped.filter((f): f is string => f !== null);
  }

  let runners: unknown = input.runners;
  if (Array.isArray(runners)) {
    runners = runners.map((r) =>
      r && typeof r === "object" && typeof r.from === "string" && typeof r.to === "string"
        ? { ...r, from: normalizeBase(r.from), to: normalizeBase(r.to) }
        : r
    );
  }

  // derive the zone from where the ball went rather than trusting the model's
  // number, since the two prompts in this repo disagreed on the numbering
  let fieldZone: unknown = null;
  if (!NO_BALL_IN_PLAY.has(action)) {
    const hitLocation = typeof input.hit_location === "string" ? input.hit_location : null;
    const derived = zoneFor(hitLocation, Array.isArray(fielders) ? (fielders as string[]) : []);
    fieldZone = derived ?? input.field_zone;
  }

  const play = buildPlaySchema(markPatched).parse({
    ...input,
    action,
    description: (input.description as string).trim(),
    fielders_involved: fielders,
    runners,
    field_zone: fieldZone,
  });

  if (patched) play.confidence = "low";
  return { ok: true, play: play as Play, patched };
}
