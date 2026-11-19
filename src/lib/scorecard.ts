import type { GameState, Play } from "@/types/game";
import { battingTeam, isPlateAppearance, type LoggedPlay, type Team } from "@/lib/boxScore";

// The game as a paper scorecard: one row per batting-order spot, one column
// per inning, and in each box the plate appearance the way a scorer draws it,
// with the result in scorebook notation (1B, 6-3, F8, K), the bases the batter
// went on to reach as a runner, the out he made, and a filled diamond if he
// scored.
//
// A runner is followed from the plate appearance that put him on base through
// every later play in the half-inning, by the base he stands on rather than
// by name, so unnamed batters are drawn just as well.

type Base = "1st" | "2nd" | "3rd";
const BASES: Base[] = ["1st", "2nd", "3rd"];
const RANK: Record<string, number> = { home: 0, "1st": 1, "2nd": 2, "3rd": 3 };
const BATTER_REACHES: Record<string, Base> = {
  single: "1st",
  walk: "1st",
  "hit by pitch": "1st",
  error: "1st",
  "fielder's choice": "1st",
  double: "2nd",
  triple: "3rd",
};

export interface ScorecardCell {
  // the plate appearance's place in the log
  index: number;
  team: Team;
  // batting-order spot, 0-8
  slot: number;
  inning: number;
  // the second time a spot bats in one inning (batting around), 1 and so on
  around: number;
  batter: string | null;
  notation: string;
  // 0 put out at the plate or never reached, 1-3 the furthest base reached
  // safely, 4 scored
  reached: number;
  scored: boolean;
  // the out of the inning he made, batting or running, 1-3
  out: number | null;
  rbi: number;
  pitches: number;
  count: string | null;
  // how he moved on later plays: SB, WP, CS and the like
  notes: string[];
}

export interface ScorecardRow {
  slot: number;
  // everyone who batted in the spot, starter first
  names: string[];
}

export interface Scorecard {
  team: Team;
  rows: ScorecardRow[];
  // one per inning, plus an extra for an inning a spot batted twice in
  columns: { inning: number; around: number }[];
  cells: ScorecardCell[];
}

export function notation(play: Play): string {
  const action = play.action.toLowerCase();
  const f = play.fielders_involved ?? [];
  const throws = f.join("-");
  const dp = play.outs_recorded >= 2 ? (play.outs_recorded >= 3 ? " TP" : " DP") : "";
  switch (action) {
    case "single":
      return "1B";
    case "double":
      return "2B";
    case "triple":
      return "3B";
    case "home run":
      return "HR";
    case "walk":
      return play.pitches && play.pitches.length === 0 ? "IBB" : "BB";
    case "hit by pitch":
      return "HBP";
    case "strikeout": {
      const last = play.pitches?.[play.pitches.length - 1];
      const looking = last === "C" || /\b(looking|called|rung up)\b/i.test(play.description);
      // the backwards K is the scorebook's strikeout looking
      return looking ? "ꓘ" : "K";
    }
    case "ground out":
      return (f.length === 1 ? `${f[0]}U` : throws || "G") + dp;
    case "fly out":
      return `F${f[0] ?? ""}${dp}`;
    case "line out":
      return `L${f[0] ?? ""}${dp}`;
    case "pop out":
      return `P${f[0] ?? ""}${dp}`;
    case "sacrifice fly":
      return `SF${f[0] ?? ""}`;
    case "sacrifice bunt":
      return `SH${throws ? ` ${throws}` : ""}`;
    case "error":
      return `E${f[0] ?? ""}`;
    case "fielder's choice":
      return `FC${f[0] ?? ""}`;
    default:
      return action.toUpperCase().slice(0, 4);
  }
}

const RUNNER_NOTE: Record<string, string> = {
  "stolen base": "SB",
  "caught stealing": "CS",
  pickoff: "PO",
  "wild pitch": "WP",
  "passed ball": "PB",
  balk: "BK",
  error: "E",
};

// how far a runner went on someone else's plate appearance: "the batter's
// single", written as the batter's spot (#4) in some scorebooks; here the
// result's notation
const advanceNote = (play: Play) => RUNNER_NOTE[play.action.toLowerCase()] ?? notation(play);

export function scorecard(log: LoggedPlay[], team: Team, scheduled = 9): Scorecard {
  const cells: ScorecardCell[] = [];
  const rows = new Map<number, ScorecardRow>();
  let order = 0;
  // who stands on each base, as the box of the plate appearance that put him
  // there; boxes of the other team's half are never touched
  let on: Record<Base, ScorecardCell | null> = { "1st": null, "2nd": null, "3rd": null };
  let half = "";
  let outs = 0;
  const seen = new Map<string, number>();
  let lastInning = 0;

  for (let index = 0; index < log.length; index++) {
    const { play, before, slot } = log[index];
    lastInning = Math.max(lastInning, before.inning);
    if (battingTeam(before.half) !== team) continue;
    const thisHalf = `${before.inning}-${before.half}`;
    if (thisHalf !== half) {
      half = thisHalf;
      on = { "1st": null, "2nd": null, "3rd": null };
      outs = before.outs;
    }

    const action = play.action.toLowerCase();
    let cell: ScorecardCell | null = null;
    if (isPlateAppearance(action)) {
      const spot = slot ?? order % 9;
      order = slot != null ? slot + 1 : order + 1;
      const key = `${spot}:${before.inning}`;
      const around = seen.get(key) ?? 0;
      seen.set(key, around + 1);
      const name = play.batter?.trim() || null;
      const row = rows.get(spot) ?? { slot: spot, names: [] };
      if (name && !row.names.some((n) => n.toLowerCase() === name.toLowerCase())) row.names.push(name);
      rows.set(spot, row);
      cell = {
        index,
        team,
        slot: spot,
        inning: before.inning,
        around,
        batter: name,
        notation: notation(play),
        reached: 0,
        scored: false,
        out: null,
        rbi: play.rbi || 0,
        pitches: play.pitches?.length ?? 0,
        count: play.count ?? null,
        notes: [],
      };
      cells.push(cell);
    }

    // everyone is placed from where they stood before the play, so the order
    // the play lists them in doesn't matter
    const was = { ...on };
    const moved = new Set<string>();
    let made = 0;
    const outAt = () => {
      made++;
      return outs < 3 ? ++outs : outs;
    };
    for (const r of play.runners) {
      const box = r.from === "home" ? cell : was[r.from as Base] ?? null;
      if (r.from !== "home") {
        moved.add(r.from);
        if (on[r.from as Base] === box) on[r.from as Base] = null;
      }
      if (!box) {
        if (r.to === "out") outAt();
        continue;
      }
      if (r.from !== "home" && box !== cell) box.notes.push(advanceNote(play));
      if (r.to === "out") {
        box.out = outAt();
      } else if (r.to === "home") {
        box.reached = 4;
        box.scored = true;
      } else if (RANK[r.to]) {
        box.reached = Math.max(box.reached, RANK[r.to]);
        on[r.to as Base] = box;
      }
    }

    if (cell) {
      const batterListed = play.runners.some((r) => r.from === "home");
      if (!batterListed) {
        if (action === "home run") {
          cell.reached = 4;
          cell.scored = true;
        } else if (BATTER_REACHES[action]) {
          const base = BATTER_REACHES[action];
          cell.reached = Math.max(cell.reached, RANK[base]);
          on[base] = cell;
        } else if (play.outs_recorded > play.runners.filter((r) => r.to === "out").length) {
          cell.out = outAt();
        }
      }
      // a home run brings in everyone still on base
      if (action === "home run") {
        for (const b of BASES) {
          const box = on[b];
          if (box && !moved.has(b)) {
            box.reached = 4;
            box.scored = true;
            box.notes.push("HR");
          }
          on[b] = null;
        }
      }
    }
    // a play that records outs without saying whose still counts them
    while (made < play.outs_recorded) outAt();
  }

  const innings = Math.max(scheduled, lastInning);
  const columns: Scorecard["columns"] = [];
  for (let inning = 1; inning <= innings; inning++) {
    const extra = Math.max(0, ...cells.filter((c) => c.inning === inning).map((c) => c.around));
    for (let around = 0; around <= extra; around++) columns.push({ inning, around });
  }
  return {
    team,
    rows: Array.from({ length: 9 }, (_, slot) => rows.get(slot) ?? { slot, names: [] }),
    columns,
    cells,
  };
}

// the box for a spot in a column, if that spot batted there
export const cellAt = (card: Scorecard, slot: number, column: { inning: number; around: number }) =>
  card.cells.find((c) => c.slot === slot && c.inning === column.inning && c.around === column.around) ?? null;

// whether this half-inning is the one being played now
export const isNow = (state: GameState, team: Team, inning: number) => battingTeam(state.half) === team && state.inning === inning && !state.final;
