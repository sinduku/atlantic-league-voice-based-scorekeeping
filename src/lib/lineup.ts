import { battingTeam, isPlateAppearance, type LoggedPlay, type Team } from "@/lib/boxScore";
import type { GameState, Play } from "@/types/game";

// Each team's card for the game in progress: nine batting-order slots and the
// pitchers used. A slot keeps everyone who has held it, oldest first, so a
// pinch hitter takes over the slot without losing that the starter batted
// there. The last name in a slot, and the last pitcher, are the ones in now.
//
// The lineup only says who is in the game now. Who batted and pitched in each
// play is stored on the play itself, so substitutions never rewrite history.

export const SLOTS = 9;

export interface TeamLineup {
  slots: string[][];
  pitchers: string[];
}

export type Lineups = Record<Team, TeamLineup>;

export const EMPTY_LINEUPS: Lineups = {
  away: { slots: [], pitchers: [] },
  home: { slots: [], pitchers: [] },
};

export const otherTeam = (team: Team): Team => (team === "away" ? "home" : "away");

export const hasBattingOrder = (lineup: TeamLineup) =>
  lineup.slots.length === SLOTS && lineup.slots.every((slot) => slot.length > 0);

export const currentBatter = (lineup: TeamLineup, slot: number): string | null =>
  lineup.slots[slot]?.[lineup.slots[slot].length - 1] ?? null;

export const currentPitcher = (lineup: TeamLineup): string | null =>
  lineup.pitchers[lineup.pitchers.length - 1] ?? null;

export const ordinal = (n: number) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};

// every name on both cards, starters and substitutes, for name correction
export function lineupNames(lineups: Lineups): string[] {
  return (["away", "home"] as Team[]).flatMap((team) => [...lineups[team].slots.flat(), ...lineups[team].pitchers]);
}

// "1. Juan Soto RF", "2) Lindor (SS)" and "Judge" all come out as the name
const ORDER_NUMBER = /^\s*\d{1,2}\s*[.):-]?\s*/;
const POSITION = /\s*(\((?:[^)]*)\)|,?\s+\b(P|C|1B|2B|3B|SS|LF|CF|RF|DH|PH|PR)\b)\s*$/i;

export function cleanName(raw: string): string {
  return raw.replace(ORDER_NUMBER, "").replace(POSITION, "").replace(/\s+/g, " ").trim();
}

export type LineupInput = { ok: true; batters: string[] } | { ok: false; error: string };

// The batting order as typed or pasted, one player per line. Blank means no
// batting order yet, which is allowed: pitching can be tracked without one.
export function parseBattingOrder(text: string): LineupInput {
  const batters = text.split(/\r?\n/).map(cleanName).filter(Boolean);
  if (batters.length === 0 || batters.length === SLOTS) return { ok: true, batters };
  return { ok: false, error: `A batting order needs ${SLOTS} players, one per line. This has ${batters.length}.` };
}

export function newLineup(batters: string[], pitcher: string): TeamLineup {
  const name = cleanName(pitcher);
  return { slots: batters.map((b) => [b]), pitchers: name ? [name] : [] };
}

export function substitute(lineup: TeamLineup, slot: number, name: string): TeamLineup {
  const cleaned = cleanName(name);
  const current = currentBatter(lineup, slot);
  if (!cleaned || (current && samePlayer(cleaned, current))) return lineup;
  return { ...lineup, slots: lineup.slots.map((s, i) => (i === slot ? [...s, cleaned] : s)) };
}

export function changePitcher(lineup: TeamLineup, name: string): TeamLineup {
  const cleaned = cleanName(name);
  const current = currentPitcher(lineup);
  if (!cleaned || (current && samePlayer(cleaned, current))) return lineup;
  return { ...lineup, pitchers: [...lineup.pitchers, cleaned] };
}

// lowercased, accents and punctuation gone, and Jr. / III dropped so the last
// word is the surname
const fold = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv)$/, "")
    .replace(/\s+/g, " ")
    .trim();

// The same player, allowing for accents, case and a surname on its own:
// "Soto" is Juan Soto, "acuna" is Ronald Acuña. Two different full names are
// different players even when the surnames match.
export function samePlayer(a: string, b: string): boolean {
  const x = fold(a);
  const y = fold(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const xs = x.split(" ");
  const ys = y.split(" ");
  if (xs.length === 1) return ys[ys.length - 1] === x;
  if (ys.length === 1) return xs[xs.length - 1] === y;
  return false;
}

interface SlotMatch {
  slot: number;
  // false when the name matches someone who has since been replaced
  current: boolean;
  name: string;
}

// players in the game now win over replaced ones, so a starter and the pinch
// hitter who replaced him are never confused
export function findInLineup(lineup: TeamLineup, name: string): SlotMatch | null {
  for (let slot = 0; slot < lineup.slots.length; slot++) {
    const now = currentBatter(lineup, slot);
    if (now && samePlayer(name, now)) return { slot, current: true, name: now };
  }
  for (let slot = 0; slot < lineup.slots.length; slot++) {
    const earlier = lineup.slots[slot].slice(0, -1).find((n) => samePlayer(name, n));
    if (earlier) return { slot, current: false, name: earlier };
  }
  return null;
}

// The slot that bats next for a team: one after whoever last batted for them,
// or the leadoff spot before anyone has. `marked` is the scorer's choice when
// they say who is up themselves, for a game picked up partway through.
export function dueUpSlot(team: Team, log: LoggedPlay[], marked?: number | null): number {
  if (marked != null) return marked;
  for (let i = log.length - 1; i >= 0; i--) {
    const { play, before, slot } = log[i];
    if (battingTeam(before.half) !== team || !isPlateAppearance(play.action)) continue;
    if (slot != null) return (slot + 1) % SLOTS;
  }
  return 0;
}

export interface LineupCheck {
  play: Play;
  // the slot to record the plate appearance against, or null without a lineup
  slot: number | null;
  warnings: string[];
}

// Fills in what the lineup knows and the play left out: the batter due up
// (shorthand like "6-3" never names one) and the pitcher on the mound. Names
// the play does give are spelled the way the lineup has them, and any that
// don't fit the lineup are flagged for the scorer, not changed.
export function applyLineup(
  play: Play,
  state: GameState,
  lineups: Lineups,
  dueUp: number,
  teamNames: Record<Team, string>
): LineupCheck {
  const batting = battingTeam(state.half);
  const fielding = otherTeam(batting);
  const warnings: string[] = [];
  const next: Play = { ...play };
  let slot: number | null = null;

  const pitcher = currentPitcher(lineups[fielding]);
  if (pitcher) {
    if (!next.pitcher?.trim() || samePlayer(next.pitcher, pitcher)) {
      next.pitcher = pitcher;
    } else {
      warnings.push(
        `${pitcher} is pitching for ${teamNames[fielding]}, but the play names ${next.pitcher}. If there was a pitching change, change the pitcher first.`
      );
    }
  }

  const lineup = lineups[batting];
  if (hasBattingOrder(lineup) && isPlateAppearance(next.action)) {
    const dueName = currentBatter(lineup, dueUp)!;
    const named = next.batter?.trim();
    if (!named) {
      next.batter = dueName;
      slot = dueUp;
    } else {
      const match = findInLineup(lineup, named);
      if (!match) {
        warnings.push(
          `${named} isn't in the ${teamNames[batting]} lineup. If they're pinch hitting for ${dueName}, enter them as a substitute.`
        );
        slot = dueUp;
      } else {
        next.batter = match.name;
        slot = match.slot;
        if (!match.current) {
          warnings.push(`${match.name} was replaced by ${currentBatter(lineup, match.slot)} and is out of the game.`);
        } else if (match.slot !== dueUp) {
          warnings.push(
            `${match.name} bats ${ordinal(match.slot + 1)}, but ${dueName} (${ordinal(dueUp + 1)}) is due up.`
          );
        }
      }
    }
  }

  // runners take the lineup's spelling too, so a run scored by "Soto" lands on
  // Juan Soto's batting line rather than starting a new one
  if (hasBattingOrder(lineup)) {
    next.runners = next.runners.map((r) => {
      if (r.from === "home" && next.batter) return { ...r, runner: next.batter };
      const named = r.runner?.trim();
      const match = named ? findInLineup(lineup, named) : null;
      return match ? { ...r, runner: match.name } : r;
    });
  }

  if (warnings.length) next.confidence = "low";
  return { play: next, slot, warnings };
}
