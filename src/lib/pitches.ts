import type { Play } from "@/types/game";
import { isPlateAppearance } from "@/lib/boxScore";

// Pitch by pitch. Every pitch of the at bat in progress is kept until the
// play that ends it is confirmed, then goes onto that play, so the log has
// the whole sequence and the count each plate appearance ended on, and pitch
// counts come from the pitches themselves.
//
// Codes follow the usual scorebook letters:
//   B ball, C called strike, S swinging strike, F foul, T foul tip,
//   X put in play, H hit by pitch

export type PitchCode = "B" | "C" | "S" | "F" | "T" | "X" | "H";

export const PITCH_LABELS: Record<PitchCode, string> = {
  B: "Ball",
  C: "Called strike",
  S: "Swinging strike",
  F: "Foul",
  T: "Foul tip",
  X: "In play",
  H: "Hit by pitch",
};

export interface Count {
  balls: number;
  strikes: number;
}

// a foul only counts as a strike before two; a foul tip always does
export function countOf(pitches: readonly PitchCode[]): Count {
  let balls = 0;
  let strikes = 0;
  for (const p of pitches) {
    if (p === "B") balls++;
    else if (p === "C" || p === "S" || p === "T") strikes++;
    else if (p === "F" && strikes < 2) strikes++;
  }
  return { balls: Math.min(balls, 4), strikes: Math.min(strikes, 3) };
}

export const formatCount = ({ balls, strikes }: Count) => `${balls}-${strikes}`;

// pitch counts are written pitches-strikes; anything but a ball or a hit
// batter counts as a strike, a ball put in play included
export const isStrike = (p: PitchCode) => p !== "B" && p !== "H";

// the plate appearance is over on the pitch: four balls or three strikes
export function decided(pitches: readonly PitchCode[]): "walk" | "strikeout" | null {
  const { balls, strikes } = countOf(pitches);
  if (balls >= 4) return "walk";
  if (strikes >= 3) return "strikeout";
  return null;
}

// a single pitch said or typed on its own: "ball", "strike looking", "foul".
// "ball four" and "strike three" are left to the play shorthand, which scores
// the walk or strikeout and gets the deciding pitch added on confirm
const PITCH_WORDS: [RegExp, PitchCode][] = [
  [/^ball(?: (?:one|two|three|1|2|3))?$/, "B"],
  [/^(?:called strike|strike looking|strike called|looking strike|taken for a strike)(?: (?:one|two|1|2))?$/, "C"],
  [/^(?:swinging strike|strike swinging|swing and (?:a )?miss|swung on and missed|whiff|swinging)(?: (?:one|two|1|2))?$/, "S"],
  [/^strike(?: (?:one|two|1|2))?$/, "C"],
  [/^foul tip$/, "T"],
  [/^(?:foul|foul ball|fouled off|fouled back|foul back)$/, "F"],
];

export function parsePitch(transcript: string): PitchCode | null {
  const s = transcript
    .toLowerCase()
    .replace(/[.,!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [pattern, code] of PITCH_WORDS) if (pattern.test(s)) return code;
  return null;
}

const BALL_IN_PLAY_ENDS = new Set(["walk", "strikeout", "hit by pitch"]);

// The pitches that go onto a confirmed play: the at bat so far, plus the
// pitch that ended it when the scorer named the result without calling that
// pitch ("Soto singles", "ball four"). An intentional walk has no pitches.
// Plays between pitches (a steal, a pickoff) take none, unless they end the
// half-inning: then the batter's pitches go with them, since he starts over
// next inning.
export function pitchesForPlay(play: Play, pending: readonly PitchCode[], opts: { endsHalf: boolean; said?: string }): PitchCode[] {
  const action = play.action.toLowerCase();
  if (!isPlateAppearance(action)) return opts.endsHalf ? [...pending] : [];
  const pitches = [...pending];
  const { balls, strikes } = countOf(pending);
  if (action === "walk") {
    if (balls < 4 && !/\b(intentional|ibb|intentionally)\b/i.test(opts.said ?? "")) pitches.push("B");
  } else if (action === "strikeout") {
    if (strikes < 3) {
      const looking = /\b(looking|called|rung up|backwards|caught looking)\b/i.test(`${opts.said ?? ""} ${play.description}`);
      pitches.push(looking ? "C" : "S");
    }
  } else if (action === "hit by pitch") {
    pitches.push("H");
  } else if (!BALL_IN_PLAY_ENDS.has(action)) {
    pitches.push("X");
  }
  return pitches;
}

// taking a play back puts its at bat back in progress, without the pitch
// that ended it
export function pitchesToRestore(play: Play): PitchCode[] {
  const pitches = (play.pitches ?? []) as PitchCode[];
  return isPlateAppearance(play.action) ? pitches.slice(0, -1) : [...pitches];
}

export const sequence = (pitches: readonly string[] | null | undefined) => (pitches ?? []).join("");
