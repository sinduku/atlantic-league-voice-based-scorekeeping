import type { GameState, Play } from "@/types/game";
import { isPlateAppearance } from "@/lib/boxScore";
import { zoneFor } from "@/lib/normalizePlay";
import { normalizeShorthand } from "@/lib/shorthand";

// Works out what a scorer's words left open, so the app asks instead of
// guessing. "Kelly singles" with a runner on second doesn't say whether that
// runner scored; "grounds out to short" with a man on first doesn't say
// whether it was a double play. The parser has to put something down for
// both, and whatever it puts down is an assumption.
//
// A question is only asked when the rules and the situation leave more than
// one legal outcome: a triple scores everyone, a walk only moves forced
// runners, and with two outs a fly out ends the inning, so none of those ask.
// Each option carries the play as it would be with that answer, so answering
// is just taking it.

export interface MatchSpec {
  // every group needs one of its words; any shortcut on its own is enough
  groups: string[][];
  shortcuts?: string[];
  // words that rule this option out ("out at home" is not "scored")
  not?: string[];
}

export interface ClarifyOption {
  id: string;
  label: string;
  likely?: boolean;
  play: Play;
  match: MatchSpec;
  // other questions this answer settles too
  resolves?: string[];
  // when set, the play is parsed again from this text instead of taking `play`
  reparse?: string;
}

export interface Question {
  id: string;
  prompt: string;
  situation: string;
  options: ClarifyOption[];
  required: boolean;
  textEntry?: { placeholder: string; apply: (text: string) => Play };
}

export interface ClarifyContext {
  state: GameState;
  transcript: string;
  // questions already answered or skipped
  resolved: readonly string[];
  // names to offer when the batter is unknown, most likely first
  batterSuggestions?: string[];
}

type Base = "1st" | "2nd" | "3rd";
const KEY: Record<Base, "first" | "second" | "third"> = { "1st": "first", "2nd": "second", "3rd": "third" };
const RANK: Record<string, number> = { "1st": 1, "2nd": 2, "3rd": 3, home: 4 };
const BASE_AT: Record<number, Base> = { 1: "1st", 2: "2nd", 3: "3rd" };
const OUT = -1;

const BASE_WORDS: Record<Base, string[]> = {
  "1st": ["first", "1st"],
  "2nd": ["second", "2nd"],
  "3rd": ["third", "3rd"],
};
const SCORED_WORDS = ["scored", "scores", "score", "scoring", "came in", "came home", "crossed", "home", "run"];
const STAYED_WORDS = ["stayed", "stay", "stays", "held", "holds", "hold", "stood", "didn't move", "did not move", "stayed put", "no advance"];
const OUT_WORDS = ["out", "thrown out", "tagged out", "doubled off", "picked off", "caught"];

const NO_RBI = new Set(["error", "wild pitch", "passed ball", "balk", "stolen base"]);
const BETWEEN_PITCHES = new Set(["stolen base", "wild pitch", "passed ball"]);
const NO_BALL_IN_PLAY = new Set(["strikeout", "walk", "hit by pitch", "stolen base", "wild pitch", "passed ball", "balk"]);
const BATTER_TO: Record<string, number> = {
  single: 1,
  error: 1,
  "fielder's choice": 1,
  walk: 1,
  "hit by pitch": 1,
  double: 2,
  triple: 3,
  "home run": 4,
};

const POSITIONS: [string, string, string[]][] = [
  ["1", "Pitcher", ["pitcher", "1", "one"]],
  ["2", "Catcher", ["catcher", "2", "two"]],
  ["3", "First baseman", ["first baseman", "first base", "first", "3", "three"]],
  ["4", "Second baseman", ["second baseman", "second base", "second", "4", "four"]],
  ["5", "Third baseman", ["third baseman", "third base", "third", "5", "five"]],
  ["6", "Shortstop", ["shortstop", "short", "6", "six"]],
  ["7", "Left fielder", ["left fielder", "left field", "left", "7", "seven"]],
  ["8", "Center fielder", ["center fielder", "center field", "center", "8", "eight"]],
  ["9", "Right fielder", ["right fielder", "right field", "right", "9", "nine"]],
];
const LOCATION_OF: Record<string, string> = {
  "1": "pitcher",
  "2": "catcher",
  "3": "first base",
  "4": "second base",
  "5": "third base",
  "6": "shortstop",
  "7": "left field",
  "8": "center field",
  "9": "right field",
};

// ---------------------------------------------------------------- words

export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9'\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (text: string, phrase: string) => new RegExp(`(^|[\\s-])${escape(phrase)}($|[\\s-])`).test(text);

// what the scorer said, folded, plus its shorthand reading ("six three" -> "6 3")
function heard(transcript: string): string {
  const folded = fold(transcript);
  return `${folded} | ${normalizeShorthand(transcript)}`;
}

const SAYS_DOUBLE_PLAY = /\b(double play|dp|gidp|twin killing|turned two|turns two|turn two|two for one)\b|\b[1-9][ -][1-9][ -][1-9]\b/;
const SAYS_FIELDERS_CHOICE = /\b(fielder'?s choice|fc|force out|forced out|force play|forced at|force at)\b/;
const SAYS_OUT_AT_FIRST = /\b[1-9][ -]3\b|\bu ?3\b|\bout at first\b|\bthrows? (him )?out at first\b|\bto first for the out\b/;
const ALL_SCORE =
  /\b(everyone|everybody|all (the )?runners|all three|both runners|both)\b.{0,15}\b(scor\w*|came (in|home))\b|\bclear(s|ed|ing)? the bases\b|\bbases[ -]clearing\b|\bgrand slam\b/;
const ALL_HOLD = /\brunners? (hold|held|stay|stayed|stood)\b|\bnobody (moved|advanced|scored)\b|\b(everyone|everybody) (held|stayed)\b/;
const ALL_MOVE = /\b(runners|everyone|everybody|all runners)\b.{0,10}\b(move|moved|moves|advance|advanced|advances|up)\b/;
const RUN_COUNT = /\b(one|two|three|four|1|2|3|4)[ -]run\b|\b(one|two|three|four|1|2|3|4) runs? (scor\w*|came in|in)\b|\b(one|two|three|four|1|2|3|4) rbi\b/;
const NUMBER: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };

// ---------------------------------------------------------------- runners

interface OnBase {
  base: Base;
  rank: number;
  name: string | null;
}

// lead runner first: his answer limits where the ones behind him can go
function runnersOn(state: GameState): OnBase[] {
  const on: OnBase[] = [];
  for (const base of ["3rd", "2nd", "1st"] as Base[]) {
    const name = state.runners[KEY[base]];
    if (name) on.push({ base, rank: RANK[base], name: name.toLowerCase() === "runner" ? null : name });
  }
  return on;
}

const who = (r: OnBase) => r.name ?? `the runner on ${r.base}`;
const whoCap = (r: OnBase) => (r.name ? r.name : `The runner on ${r.base}`);

function surname(name: string): string {
  const words = fold(name).split(" ").filter((w) => !/^(jr|sr|ii|iii|iv)$/.test(w));
  return words[words.length - 1] ?? "";
}

// whether the words said anything about this runner: his name, or which base
// he was on ("runner on second scores", "from first to third")
function mentions(said: string, r: OnBase): boolean {
  if (r.name) {
    const last = surname(r.name);
    if (last.length >= 3 && has(said, last)) return true;
    if (said.includes(fold(r.name))) return true;
  }
  // "on second" alone is left out on purpose: "safe on first" is the batter
  return BASE_WORDS[r.base].some(
    (b) =>
      new RegExp(`\\b(from|runner on|man on|guy on|runner at|runner from|lead runner on|trail(?:ing)? runner on) ${b}\\b`).test(said) ||
      new RegExp(`\\b${b} base runner\\b`).test(said)
  );
}

// words that settle every runner at once
function settlesEveryone(said: string, on: OnBase[]): boolean {
  if (ALL_SCORE.test(said) || ALL_HOLD.test(said) || ALL_MOVE.test(said)) return true;
  const m = said.match(RUN_COUNT);
  if (m) {
    const word = (m[1] ?? m[2] ?? m[4] ?? "").toLowerCase();
    const n = NUMBER[word] ?? Number(word);
    if (n === on.length) return true;
  }
  return false;
}

const entryFrom = (play: Play, from: string) => play.runners.find((r) => r.from === from);

function destRank(play: Play, r: OnBase): number {
  const entry = entryFrom(play, r.base);
  if (!entry) return r.rank;
  if (entry.to === "out") return OUT;
  return RANK[entry.to] ?? r.rank;
}

function batterRank(play: Play): number {
  const entry = entryFrom(play, "home");
  if (entry) return entry.to === "out" ? OUT : RANK[entry.to] ?? 0;
  return BATTER_TO[play.action.toLowerCase()] ?? OUT;
}

const ORDER: Record<string, number> = { "3rd": 0, "2nd": 1, "1st": 2, home: 3 };
const sortRunners = (runners: Play["runners"]) => [...runners].sort((a, b) => (ORDER[a.from] ?? 9) - (ORDER[b.from] ?? 9));

// puts the runner from `base` at `to`; staying put is no entry at all
function setRunner(play: Play, state: GameState, base: Base, to: string): Play {
  const name = state.runners[KEY[base]];
  const others = play.runners.filter((r) => r.from !== base);
  const entry = to === base ? [] : [{ from: base, to, runner: name && name.toLowerCase() !== "runner" ? name : null }];
  return { ...play, runners: sortRunners([...others, ...entry]) };
}

function setBatter(play: Play, to: string): Play {
  const entry = entryFrom(play, "home");
  const others = play.runners.filter((r) => r.from !== "home");
  return { ...play, runners: sortRunners([...others, { from: "home", to, runner: entry?.runner ?? play.batter ?? null }]) };
}

// outs and rbi follow from where everyone ended up
function recount(play: Play): Play {
  const action = play.action.toLowerCase();
  const outs = play.runners.filter((r) => r.to === "out").length;
  const scored = play.runners.filter((r) => r.to === "home").length;
  const noRbi = NO_RBI.has(action) || (action === "ground out" && outs >= 2);
  return { ...play, outs_recorded: outs, rbi: noRbi ? 0 : scored };
}

export function describeSituation(state: GameState): string {
  const outs = `${state.outs} ${state.outs === 1 ? "out" : "outs"}`;
  const occupied = (["1st", "2nd", "3rd"] as Base[]).filter((b) => state.runners[KEY[b]]);
  const bases =
    occupied.length === 0
      ? "bases empty"
      : occupied.length === 3
        ? "bases loaded"
        : occupied.length === 1
          ? `runner on ${occupied[0]}`
          : `runners on ${occupied.join(" and ")}`;
  return `${outs}, ${bases}`;
}

// ---------------------------------------------------------------- options

function fateOption(play: Play, state: GameState, r: OnBase, to: number, opts: { likely?: boolean; tag?: boolean } = {}): ClarifyOption {
  if (to === OUT) {
    return {
      id: "out",
      label: opts.tag ? "Doubled off / thrown out" : "Thrown out",
      play: recount(setRunner(play, state, r.base, "out")),
      match: { groups: [OUT_WORDS] },
      likely: opts.likely,
    };
  }
  if (to === 4) {
    return {
      id: "home",
      label: opts.tag ? "Tagged up and scored" : "Scored",
      play: recount(setRunner(play, state, r.base, "home")),
      match: { groups: [SCORED_WORDS], shortcuts: opts.tag ? ["yes", "tagged", "tagged up", "tag up"] : [], not: OUT_WORDS },
      likely: opts.likely,
    };
  }
  const base = BASE_AT[to];
  if (to === r.rank) {
    return {
      id: "stay",
      label: `Stayed at ${base}`,
      play: recount(setRunner(play, state, r.base, base)),
      match: { groups: [STAYED_WORDS], shortcuts: opts.tag ? ["no", "didn't tag", "did not tag"] : [], not: OUT_WORDS },
      likely: opts.likely,
    };
  }
  return {
    id: base,
    label: opts.tag ? `Tagged up to ${base}` : `Went to ${base}`,
    play: recount(setRunner(play, state, r.base, base)),
    match: { groups: [BASE_WORDS[base]], shortcuts: opts.tag ? ["yes", "tagged", "tagged up", "tag up"] : [], not: OUT_WORDS },
    likely: opts.likely,
  };
}

// where a runner can end up: no further back than he started (or one base on
// if forced), never past the runner ahead of him unless both score, and
// never level with or behind a runner behind him whose spot is already
// settled (a double-play answer can put the man from first on second first)
function legalRange(play: Play, r: OnBase, on: OnBase[], minRank: number, settled: (b: OnBase) => boolean): number[] {
  // a lead runner still to be asked about is only the parser's guess, so it
  // doesn't limit this one yet; the question is worked out again once he's
  // answered for
  const ahead = on
    .filter((a) => a.rank > r.rank && settled(a))
    .map((a) => destRank(play, a))
    .filter((d) => d !== OUT);
  const max = ahead.length ? Math.min(...ahead.map((d) => (d === 4 ? 4 : d - 1))) : 4;
  const behind = on
    .filter((b) => b.rank < r.rank && settled(b))
    .map((b) => destRank(play, b))
    .filter((d) => d !== OUT && d !== 4);
  const min = behind.length ? Math.max(minRank, Math.max(...behind) + 1) : minRank;
  const range: number[] = [];
  for (let k = min; k <= max; k++) range.push(k);
  return range;
}

const LIKELY: Record<string, Partial<Record<Base, number>>> = {
  single: { "1st": 2, "2nd": 4, "3rd": 4 },
  error: { "1st": 2, "2nd": 4, "3rd": 4 },
  double: { "1st": 3, "2nd": 4, "3rd": 4 },
};

function fateQuestion(play: Play, state: GameState, r: OnBase, range: number[], likely?: number): Question | null {
  // with only one place to go there is nothing to ask; a runner thrown out on
  // a forced move would have been said
  if (range.length < 2) return null;
  const options = range.map((k) => fateOption(play, state, r, k, { likely: k === likely }));
  options.push(fateOption(play, state, r, OUT));
  return {
    id: `runner:${r.base}`,
    prompt: `Where did ${who(r)} end up? ${r.name ? `He was on ${r.base}.` : ""}`.trim(),
    situation: describeSituation(state),
    options,
    required: true,
  };
}

// ---------------------------------------------------------------- questions

function actionQuestion(play: Play, alternatives: string[], ctx: ClarifyContext): Question {
  const current = play.action.toLowerCase();
  return {
    id: "action",
    prompt: `"${ctx.transcript.trim()}" could be more than one play. Which was it?`,
    situation: describeSituation(ctx.state),
    required: true,
    options: [current, ...alternatives].map((action, i) => ({
      id: action,
      label: action[0].toUpperCase() + action.slice(1),
      likely: i === 0,
      play,
      match: { groups: [action.split(" ")] },
      reparse: i === 0 ? undefined : `${ctx.transcript.trim()}. It was a ${action}.`,
    })),
  };
}

function forceQuestion(play: Play, state: GameState, r: OnBase): Question {
  const others = (p: Play) => p.runners.filter((e) => e.from !== "home" && e.from !== "1st");
  const base = (runners: Play["runners"]): Play => ({ ...play, runners: sortRunners([...others(play), ...runners]) });
  const runner = r.name;
  const doublePlay = recount({
    ...base([
      { from: "1st", to: "out", runner },
      { from: "home", to: "out", runner: play.batter ?? null },
    ]),
    action: "ground out",
  });
  const fieldersChoice = recount({
    ...base([
      { from: "1st", to: "out", runner },
      { from: "home", to: "1st", runner: play.batter ?? null },
    ]),
    action: "fielder's choice",
  });
  const outAtFirst = recount({
    ...base([
      { from: "1st", to: "2nd", runner },
      { from: "home", to: "out", runner: play.batter ?? null },
    ]),
    action: "ground out",
  });
  return {
    id: "force",
    prompt: `What happened with ${who(r)} on 1st?`,
    situation: describeSituation(state),
    required: true,
    options: [
      {
        id: "double-play",
        label: state.outs === 1 ? "Double play (inning over)" : "Double play",
        play: doublePlay,
        resolves: ["runner:1st"],
        match: { groups: [["double play", "dp", "both", "two outs"]] },
      },
      {
        id: "fielders-choice",
        label: `${whoCap(r)} forced out at 2nd, batter safe at 1st`,
        play: fieldersChoice,
        resolves: ["runner:1st", "fc-out"],
        match: { groups: [["fielder's choice", "fielders choice", "fc", "forced", "force", "safe at first", "safe"]] },
      },
      {
        id: "out-at-first",
        label: `Batter out at 1st, ${who(r)} to 2nd`,
        play: outAtFirst,
        resolves: ["runner:1st"],
        match: { groups: [["batter out", "out at first", "to second", "advanced", "moved up", "got to second"]] },
      },
    ],
  };
}

function fcOutQuestion(play: Play, state: GameState, on: OnBase[]): Question {
  return {
    id: "fc-out",
    prompt: "Who was put out on the fielder's choice?",
    situation: describeSituation(state),
    required: true,
    options: on.map((r) => {
      const next = BASE_AT[r.rank + 1] ?? "home";
      const withOut = recount(setBatter(setRunner(play, state, r.base, "out"), "1st"));
      return {
        id: r.base,
        label: `${whoCap(r)}, at ${next}`,
        play: withOut,
        resolves: [`runner:${r.base}`],
        match: { groups: [[...(r.name ? [surname(r.name)] : []), ...BASE_WORDS[r.base], ...(next === "home" ? ["home", "plate"] : BASE_WORDS[next as Base])]] },
      };
    }),
  };
}

function advanceQuestion(play: Play, state: GameState, on: OnBase[], action: string): Question | null {
  // every combination of runners moving up one base that doesn't put two on
  // the same bag
  const options: ClarifyOption[] = [];
  const total = 1 << on.length;
  for (let mask = 1; mask < total; mask++) {
    const movers = on.filter((_, i) => mask & (1 << i));
    const stays = on.filter((_, i) => !(mask & (1 << i)));
    const landing = movers.map((m) => m.rank + 1);
    if (landing.some((l) => stays.some((s) => s.rank === l))) continue;
    let next: Play = { ...play, runners: play.runners.filter((e) => e.from === "home") };
    for (const m of movers) next = setRunner(next, state, m.base, m.rank + 1 === 4 ? "home" : BASE_AT[m.rank + 1]);
    next = recount(next);
    const everyone = movers.length === on.length;
    const parts = movers.map((m) => `${whoCap(m)} to ${m.rank + 1 === 4 ? "home" : BASE_AT[m.rank + 1]}`);
    options.push({
      id: movers.map((m) => m.base).join("+"),
      label: everyone && on.length > 1 ? `Everyone up a base: ${parts.join(", ")}` : parts.join(", "),
      likely: everyone && action !== "stolen base",
      play: next,
      match: {
        groups: movers.map((m) => [...(m.name ? [surname(m.name)] : []), ...BASE_WORDS[m.base]]),
        shortcuts: everyone ? ["everyone", "everybody", "all of them", "both", "double steal", "triple steal"] : [],
      },
    });
  }
  if (options.length < 2) return null;
  return {
    id: "advance",
    prompt: action === "stolen base" ? "Who stole?" : "Which runners moved up?",
    situation: describeSituation(state),
    required: true,
    options,
  };
}

function errorFielderQuestion(play: Play, state: GameState): Question {
  return {
    id: "error-fielder",
    prompt: "Who made the error?",
    situation: describeSituation(state),
    required: true,
    options: POSITIONS.map(([n, label, words]) => {
      const location = play.hit_location || LOCATION_OF[n];
      return {
        id: n,
        // the key badge already shows the position number
        label,
        play: { ...play, fielders_involved: [n], hit_location: location, field_zone: zoneFor(location, [n]) },
        match: { groups: [words] },
      };
    }),
  };
}

function batterQuestion(play: Play, ctx: ClarifyContext): Question {
  const named = (name: string): Play => {
    const entry = entryFrom(play, "home");
    const runners = entry ? play.runners.map((r) => (r.from === "home" ? { ...r, runner: name } : r)) : play.runners;
    return { ...play, batter: name, runners };
  };
  const suggestions = (ctx.batterSuggestions ?? []).slice(0, 4);
  return {
    id: "batter",
    prompt: "Who was batting?",
    situation: describeSituation(ctx.state),
    required: true,
    options: [
      ...suggestions.map((name) => ({ id: `name:${name}`, label: name, play: named(name), match: { groups: [[surname(name)]] } })),
      { id: "unknown", label: "Not sure", play, match: { groups: [["not sure", "don't know", "dont know", "unknown", "skip"]] } },
    ],
    textEntry: { placeholder: "Batter's name", apply: (text) => named(text.trim()) },
  };
}

// [hit_location, label, words that pick it, words that rule it out]. the
// gaps rule out the plain fields, so "left center" never reads as "left"
const LOCATIONS: [string, string, string[], string[]][] = [
  ["left field", "Left field", ["left field", "left"], ["center", "infield", "side"]],
  ["left-center gap", "Left-center", ["left center", "left-center"], []],
  ["center field", "Center field", ["center field", "center", "middle"], ["left", "right"]],
  ["right-center gap", "Right-center", ["right center", "right-center"], []],
  ["right field", "Right field", ["right field", "right"], ["center", "infield", "side"]],
  ["shortstop", "Infield, left side", ["left side", "shortstop", "short", "third base"], []],
  ["second base", "Infield, right side", ["right side", "second base", "first base"], []],
];

function locationQuestion(play: Play, state: GameState): Question {
  return {
    id: "location",
    prompt: "Where was it hit? (for the spray chart)",
    situation: describeSituation(state),
    required: false,
    options: LOCATIONS.map(([location, label, words, not]) => ({
      id: location,
      label,
      play: { ...play, hit_location: location, field_zone: zoneFor(location, play.fielders_involved) },
      match: { groups: [words], not },
    })),
  };
}

function runnerQuestions(play: Play, ctx: ClarifyContext, said: string, done: Set<string>): Question[] {
  const { state } = ctx;
  const action = play.action.toLowerCase();
  const on = runnersOn(state);
  if (!on.length || action === "home run" || action === "triple") return [];
  // the inning is over: where the runners stood no longer counts
  if (state.outs + play.outs_recorded >= 3) return [];
  if (settlesEveryone(said, on)) return [];

  const settled = (r: OnBase) => done.has(`runner:${r.base}`) || mentions(said, r);
  const unsettled = (r: OnBase) => !settled(r);

  if (BETWEEN_PITCHES.has(action)) {
    // naming any runner says who moved; the parse already has him
    if (on.length < 2 || done.has("advance") || on.some((r) => mentions(said, r))) return [];
    const q = advanceQuestion(play, state, on, action);
    return q ? [q] : [];
  }

  const questions: Question[] = [];

  if (action in BATTER_TO && action !== "walk" && action !== "hit by pitch") {
    // the batter is safe: runners behind full bases are forced, and nobody can
    // stop on a base the batter took
    const batter = batterRank(play);
    const occupied = (rank: number) => on.some((r) => r.rank === rank);
    for (const r of on) {
      if (!unsettled(r)) continue;
      if (action === "fielder's choice" && destRank(play, r) === OUT && (done.has("force") || done.has("fc-out") || SAYS_FIELDERS_CHOICE.test(said))) continue;
      let forced = batter >= 1;
      for (let k = 1; k < r.rank; k++) if (!occupied(k)) forced = false;
      const min = Math.max(r.rank + (forced ? 1 : 0), batter >= 1 && batter < 4 ? batter + 1 : 0);
      const q = fateQuestion(play, state, r, legalRange(play, r, on, min, settled), LIKELY[action]?.[r.base]);
      if (q) questions.push(q);
    }
    return questions;
  }

  if (action === "ground out") {
    for (const r of on) {
      if (!unsettled(r)) continue;
      // part of a double play the play already describes
      if (destRank(play, r) === OUT && (SAYS_DOUBLE_PLAY.test(said) || done.has("force"))) continue;
      const q = fateQuestion(play, state, r, legalRange(play, r, on, r.rank, settled), r.base === "1st" ? 2 : undefined);
      if (q) questions.push(q);
    }
    return questions;
  }

  if (action === "fly out" || action === "sacrifice fly") {
    // a pop up or a catch in the infield holds the runners
    const fielders = play.fielders_involved.map(Number).filter(Boolean);
    const infield = (play.hit_type ?? "").toLowerCase() === "pop up" || (fielders.length > 0 && fielders.every((f) => f <= 6));
    if (infield) return [];
    for (const r of on) {
      if (!unsettled(r)) continue;
      if (action === "sacrifice fly" && r.base === "3rd") continue;
      const range = legalRange(play, r, on, r.rank, settled).filter((k) => k <= r.rank + 1);
      if (range.length < 2) continue;
      const options = range.map((k) => {
        const option = fateOption(play, state, r, k, { tag: true, likely: r.base === "1st" && k === r.rank });
        // a run scored on a caught fly ball makes it a sacrifice fly
        if (k === 4) option.play = recount({ ...option.play, action: "sacrifice fly" });
        else if (action === "sacrifice fly" && r.base === "3rd") option.play = recount({ ...option.play, action: "fly out" });
        return option;
      });
      options.push(fateOption(play, state, r, OUT, { tag: true }));
      const next = BASE_AT[r.rank + 1] ?? "home";
      questions.push({
        id: `runner:${r.base}`,
        prompt: r.base === "3rd" ? `Did ${who(r)} tag up and score?` : `Did ${who(r)} tag up and go to ${next}?`,
        situation: describeSituation(state),
        required: true,
        options,
      });
    }
    return questions;
  }

  return [];
}

export function openQuestions(play: Play, ctx: ClarifyContext): Question[] {
  const done = new Set(ctx.resolved);
  const said = heard(ctx.transcript);
  const action = play.action.toLowerCase();
  const { state } = ctx;

  // what kind of play it was comes first; everything else depends on it
  const alternatives = (play.alternatives ?? []).map((a) => a.toLowerCase()).filter((a) => a !== action);
  if (alternatives.length && !done.has("action")) return [actionQuestion(play, alternatives, ctx)];

  const questions: Question[] = [];
  const first = runnersOn(state).find((r) => r.base === "1st");

  // who booted it is part of what happened, so it's asked before where the
  // runners went, the way a scorer would tell it
  if (action === "error" && play.fielders_involved.length === 0 && !done.has("error-fielder")) {
    questions.push(errorFielderQuestion(play, state));
  }

  const groundBall = action === "ground out" || action === "fielder's choice";
  const forceOpen =
    groundBall &&
    !!first &&
    state.outs < 2 &&
    !done.has("force") &&
    !SAYS_DOUBLE_PLAY.test(said) &&
    !SAYS_FIELDERS_CHOICE.test(said) &&
    !SAYS_OUT_AT_FIRST.test(said) &&
    !mentions(said, first);
  if (forceOpen) {
    questions.push(forceQuestion(play, state, first!));
  } else {
    const on = runnersOn(state);
    const putOut = play.runners.some((r) => r.from !== "home" && r.to === "out");
    if (action === "fielder's choice" && on.length > 1 && !putOut && !done.has("fc-out")) {
      questions.push(fcOutQuestion(play, state, on));
    } else {
      questions.push(...runnerQuestions(play, ctx, said, done));
    }
  }

  if (isPlateAppearance(action) && !play.batter?.trim() && !done.has("batter")) {
    questions.push(batterQuestion(play, ctx));
  }

  const inPlay = !NO_BALL_IN_PLAY.has(action);
  if (inPlay && !play.hit_location && play.fielders_involved.length === 0 && !done.has("location")) {
    questions.push(locationQuestion(play, state));
  }

  return questions.filter((q) => !done.has(q.id));
}

// ---------------------------------------------------------------- answers

const SKIP = /^(skip|not sure|don'?t know|no idea|pass)$/;

function score(spec: MatchSpec, text: string): number | null {
  if (spec.not?.some((w) => has(text, fold(w)))) return null;
  if (spec.shortcuts?.some((w) => has(text, fold(w)))) return 100;
  if (!spec.groups.length) return null;
  return spec.groups.every((g) => g.some((w) => has(text, fold(w)))) ? spec.groups.length : null;
}

// Reads a spoken or typed answer ("he scored", "third", "double play", "6")
// against the open question. Returns null unless exactly one option fits, so
// a mumble never picks an answer by accident.
export function matchAnswer(question: Question, text: string): ClarifyOption | null {
  const t = fold(text);
  if (!t) return null;
  const pick = t.match(/^(?:option |number )?([1-9])$/);
  const digitsMeanPositions = question.id === "error-fielder";
  if (pick && !digitsMeanPositions) return question.options[Number(pick[1]) - 1] ?? null;

  const scored = question.options
    .map((option) => ({ option, score: score(option.match, t) }))
    .filter((s): s is { option: ClarifyOption; score: number } => s.score !== null);
  if (!scored.length) return null;
  const best = Math.max(...scored.map((s) => s.score));
  const top = scored.filter((s) => s.score === best);
  return top.length === 1 ? top[0].option : null;
}

export const isSkip = (text: string) => SKIP.test(fold(text));

// ---------------------------------------------------------------- description

const VERB: Record<string, string> = {
  single: "singles",
  double: "doubles",
  triple: "triples",
  "home run": "homers",
  walk: "walks",
  "hit by pitch": "is hit by a pitch",
  strikeout: "strikes out",
  "ground out": "grounds out",
  "fly out": "flies out",
  "sacrifice fly": "hits a sacrifice fly",
  error: "reaches on an error",
  "fielder's choice": "reaches on a fielder's choice",
};
const EVENT: Record<string, string> = {
  "stolen base": "Stolen base",
  "wild pitch": "Wild pitch",
  "passed ball": "Passed ball",
  balk: "Balk",
};
const FIELDER: Record<string, string> = Object.fromEntries(POSITIONS.map(([n, label]) => [n, label.toLowerCase()]));

// Once the scorer has answered, the parser's own description may say things
// that are no longer true ("Rios scores" when he held), and it goes into the
// log and the exports. This writes one from the settled play instead.
export function describePlay(play: Play, state: GameState): string {
  const action = play.action.toLowerCase();
  const batter = play.batter?.trim() || "Batter";
  let lead: string;
  if (EVENT[action]) {
    lead = EVENT[action];
  } else if (action === "ground out" && play.outs_recorded >= 2) {
    lead = `${batter} grounds into a double play`;
  } else {
    lead = `${batter} ${VERB[action] ?? action}`;
    if (action === "error" && play.fielders_involved[0] && FIELDER[play.fielders_involved[0]]) {
      lead += ` by the ${FIELDER[play.fielders_involved[0]]}`;
    } else if (play.hit_location && !NO_BALL_IN_PLAY.has(action)) {
      lead += ` to ${play.hit_location}`;
    }
  }

  const clauses: string[] = [];
  for (const r of runnersOn(state)) {
    const name = r.name ?? `Runner on ${r.base}`;
    const entry = entryFrom(play, r.base);
    if (!entry) clauses.push(`${name} holds at ${r.base}`);
    else if (entry.to === "home") clauses.push(`${name} scores`);
    else if (entry.to === "out") clauses.push(`${name} out`);
    else clauses.push(`${name} to ${entry.to}`);
  }
  return clauses.length ? `${lead}. ${clauses.join(", ")}.` : `${lead}.`;
}
