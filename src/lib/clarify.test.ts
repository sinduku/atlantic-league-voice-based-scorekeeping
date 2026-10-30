import { describe, expect, it } from "vitest";
import { describePlay, describeSituation, isSkip, matchAnswer, openQuestions, type ClarifyContext, type Question } from "./clarify";
import { parseShorthand } from "./shorthand";
import { INITIAL_GAME_STATE, applyPlayToState, type GameState, type Play } from "@/types/game";

const state = (runners: Partial<GameState["runners"]> = {}, outs = 0): GameState => ({
  ...INITIAL_GAME_STATE,
  outs,
  runners: { first: null, second: null, third: null, ...runners },
});

const play = (p: Partial<Play> & Pick<Play, "action">): Play => ({
  description: p.action,
  batter: "Batter",
  runners: [],
  rbi: 0,
  outs_recorded: 0,
  fielders_involved: [],
  hit_location: "right field",
  confidence: "high",
  ...p,
});

const ctx = (s: GameState, transcript: string, resolved: string[] = [], extra: Partial<ClarifyContext> = {}): ClarifyContext => ({
  state: s,
  transcript,
  resolved,
  ...extra,
});

const ids = (qs: Question[]) => qs.map((q) => q.id);
const labels = (q: Question) => q.options.map((o) => o.label);
const option = (q: Question, id: string) => {
  const o = q.options.find((x) => x.id === id);
  if (!o) throw new Error(`no option ${id} in ${q.id}: ${q.options.map((x) => x.id).join(", ")}`);
  return o;
};

// answers questions one at a time the way the page does, re-asking after each
function answer(start: Play, c: ClarifyContext, picks: Record<string, string>) {
  let current = start;
  const resolved = [...c.resolved];
  for (let i = 0; i < 10; i++) {
    const open = openQuestions(current, { ...c, resolved }).filter((q) => q.required);
    if (!open.length) return { play: current, resolved };
    const q = open[0];
    const pick = picks[q.id];
    if (!pick) throw new Error(`unexpected question ${q.id}: ${q.prompt}`);
    const chosen = option(q, pick);
    current = chosen.play;
    resolved.push(q.id, ...(chosen.resolves ?? []));
  }
  throw new Error("too many questions");
}

describe("hits with runners on", () => {
  const single = play({ action: "single", batter: "Lindor", runners: [{ from: "home", to: "1st", runner: "Lindor" }] });

  it("asks where an unmentioned runner on second ended up", () => {
    const qs = openQuestions(single, ctx(state({ second: "Juan Soto" }), "Lindor singles to right"));
    expect(ids(qs)).toEqual(["runner:2nd"]);
    expect(qs[0].prompt).toBe("Where did Juan Soto end up? He was on 2nd.");
    expect(labels(qs[0])).toEqual(["Stayed at 2nd", "Went to 3rd", "Scored", "Thrown out"]);
    expect(qs[0].options.find((o) => o.likely)?.label).toBe("Scored");
  });

  it("counts the run and the rbi once the scorer says he scored", () => {
    const qs = openQuestions(single, ctx(state({ second: "Juan Soto" }), "Lindor singles"));
    const scored = option(qs[0], "home").play;
    expect(scored.runners).toContainEqual({ from: "2nd", to: "home", runner: "Juan Soto" });
    expect(scored.rbi).toBe(1);
    expect(scored.outs_recorded).toBe(0);
  });

  it("records an out when the runner was thrown out", () => {
    const qs = openQuestions(single, ctx(state({ second: "Juan Soto" }), "Lindor singles"));
    const out = option(qs[0], "out").play;
    expect(out.outs_recorded).toBe(1);
    expect(out.rbi).toBe(0);
  });

  it("asks nothing when the words already say what the runner did", () => {
    for (const words of ["Lindor singles, Soto scores", "Lindor singles, runner on second scores", "single to right, everyone scores"]) {
      expect(openQuestions(single, ctx(state({ second: "Juan Soto" }), words))).toEqual([]);
    }
  });

  it("asks about the lead runner first, then limits the trailing runner by his answer", () => {
    const s = state({ first: "Lee", second: "Soto" });
    const first = openQuestions(single, ctx(s, "Lindor singles"));
    expect(ids(first)).toEqual(["runner:2nd", "runner:1st"]);
    // forced by the runner behind him, so staying isn't an option
    expect(labels(first[0])).toEqual(["Went to 3rd", "Scored", "Thrown out"]);
    const afterLead = option(first[0], "3rd").play;
    const next = openQuestions(afterLead, ctx(s, "Lindor singles", ["runner:2nd"]));
    // 3rd is taken, so the man from first can only reach 2nd: nothing to ask
    expect(ids(next)).toEqual([]);
  });

  it("lets the trailing runner go further when the lead runner scored", () => {
    const s = state({ first: "Lee", second: "Soto" });
    const afterLead = option(openQuestions(single, ctx(s, "Lindor singles"))[0], "home").play;
    const next = openQuestions(afterLead, ctx(s, "Lindor singles", ["runner:2nd"]));
    expect(labels(next[0])).toEqual(["Went to 2nd", "Went to 3rd", "Scored", "Thrown out"]);
    expect(next[0].options.find((o) => o.likely)?.label).toBe("Went to 2nd");
  });

  it("never asks on a triple or a home run, where everyone scores", () => {
    const loaded = state({ first: "A", second: "B", third: "C" });
    expect(openQuestions(play({ action: "triple" }), ctx(loaded, "triple to the gap"))).toEqual([]);
    expect(openQuestions(play({ action: "home run" }), ctx(loaded, "grand slam"))).toEqual([]);
  });

  it("forces the runner on third home on a bases-loaded single without asking", () => {
    const loaded = state({ first: "A", second: "B", third: "C" });
    const qs = openQuestions(play({ action: "single" }), ctx(loaded, "single"));
    expect(ids(qs)).not.toContain("runner:3rd");
  });

  it("keeps runners ahead of the batter on a double", () => {
    const qs = openQuestions(play({ action: "double", runners: [{ from: "home", to: "2nd" }] }), ctx(state({ first: "Lee" }), "double"));
    expect(labels(qs[0])).toEqual(["Went to 3rd", "Scored", "Thrown out"]);
  });

  it("settles everyone from a run count that matches the runners on base", () => {
    const qs = openQuestions(play({ action: "double" }), ctx(state({ first: "A", second: "B" }), "two-run double down the line"));
    expect(qs).toEqual([]);
  });
});

describe("ground balls with a man on first", () => {
  const groundOut = play({ action: "ground out", runners: [{ from: "home", to: "out" }], outs_recorded: 1, fielders_involved: ["6", "3"] });

  it("asks whether it was a double play, a force or an out at first", () => {
    const qs = openQuestions(groundOut, ctx(state({ first: "Lee" }), "Lindor grounds out to short"));
    expect(ids(qs)).toEqual(["force"]);
    expect(labels(qs[0])).toEqual(["Double play", "Lee forced out at 2nd, batter safe at 1st", "Batter out at 1st, Lee to 2nd"]);
  });

  it("scores each answer correctly", () => {
    const q = openQuestions(groundOut, ctx(state({ first: "Lee" }), "grounds out to short"))[0];
    expect(option(q, "double-play").play).toMatchObject({ action: "ground out", outs_recorded: 2, rbi: 0 });
    expect(option(q, "fielders-choice").play).toMatchObject({ action: "fielder's choice", outs_recorded: 1 });
    expect(option(q, "fielders-choice").play.runners).toContainEqual({ from: "home", to: "1st", runner: "Batter" });
    expect(option(q, "out-at-first").play.runners).toContainEqual({ from: "1st", to: "2nd", runner: "Lee" });
  });

  it("calls it the end of the inning with one out", () => {
    const q = openQuestions(groundOut, ctx(state({ first: "Lee" }, 1), "grounds out"))[0];
    expect(labels(q)[0]).toBe("Double play (inning over)");
  });

  it("doesn't ask with two outs: the out ends the inning", () => {
    expect(openQuestions(groundOut, ctx(state({ first: "Lee", third: "Soto" }, 2), "grounds out to short"))).toEqual([]);
  });

  it("doesn't ask when the words say which", () => {
    for (const words of ["6-4-3 double play", "turned two", "fielder's choice", "forced out at second"]) {
      expect(ids(openQuestions(groundOut, ctx(state({ first: "Lee" }), words)))).not.toContain("force");
    }
  });

  it("takes 6-3 as the batter out at first but still asks where the runner went", () => {
    const shorthand = parseShorthand("6-3", state({ first: "Lee" }))!;
    const qs = openQuestions(shorthand, ctx(state({ first: "Lee" }), "6-3", [], { batterSuggestions: [] }));
    expect(ids(qs)).toContain("runner:1st");
    expect(qs.find((q) => q.id === "runner:1st")!.options.find((o) => o.likely)?.label).toBe("Went to 2nd");
  });

  it("follows a fielder's choice answer with the runner on second, who is now forced", () => {
    const s = state({ first: "Lee", second: "Soto" });
    const start = openQuestions(groundOut, ctx(s, "grounds to short"));
    const fc = option(start[0], "fielders-choice");
    const next = openQuestions(fc.play, ctx(s, "grounds to short", ["force", ...(fc.resolves ?? [])]));
    expect(ids(next)).toEqual(["runner:2nd"]);
    expect(labels(next[0])).toEqual(["Went to 3rd", "Scored", "Thrown out"]);
  });

  it("asks if a runner on third scored on a ground out", () => {
    const shorthand = parseShorthand("4-3", state({ third: "Soto" }))!;
    const q = openQuestions(shorthand, ctx(state({ third: "Soto" }), "4-3"))[0];
    expect(q.id).toBe("runner:3rd");
    expect(option(q, "home").play).toMatchObject({ rbi: 1, outs_recorded: 1 });
  });
});

describe("fly balls", () => {
  const flyOut = play({ action: "fly out", runners: [{ from: "home", to: "out" }], outs_recorded: 1, fielders_involved: ["9"] });

  it("asks if the runner on third tagged and scored, and makes it a sacrifice fly if so", () => {
    const q = openQuestions(flyOut, ctx(state({ third: "Soto" }), "Lindor flies out to right"))[0];
    expect(q.prompt).toBe("Did Soto tag up and score?");
    expect(option(q, "home").play).toMatchObject({ action: "sacrifice fly", rbi: 1, outs_recorded: 1 });
    expect(option(q, "stay").play.action).toBe("fly out");
  });

  it("holds the runners on a pop up or a catch in the infield", () => {
    const s = state({ second: "Soto", third: "Lee" });
    expect(openQuestions({ ...flyOut, hit_type: "pop up" }, ctx(s, "pop up"))).toEqual([]);
    expect(openQuestions({ ...flyOut, fielders_involved: ["6"] }, ctx(s, "F6"))).toEqual([]);
  });

  it("doesn't ask about the runner a sacrifice fly already scored", () => {
    const sac = play({ action: "sacrifice fly", runners: [{ from: "3rd", to: "home" }, { from: "home", to: "out" }], outs_recorded: 1, fielders_involved: ["8"] });
    expect(openQuestions(sac, ctx(state({ third: "Soto" }), "sac fly to center"))).toEqual([]);
  });

  it("doesn't ask with two outs", () => {
    expect(openQuestions(flyOut, ctx(state({ third: "Soto" }, 2), "fly out to right"))).toEqual([]);
  });
});

describe("plays between pitches", () => {
  it("asks who stole when more than one runner could have", () => {
    const steal = play({ action: "stolen base", batter: null, hit_location: null });
    const q = openQuestions(steal, ctx(state({ first: "Lee", second: "Soto" }), "stolen base"))[0];
    expect(q.prompt).toBe("Who stole?");
    // Lee can't take second alone while Soto is still on it
    expect(labels(q)).toEqual(["Soto to 3rd", "Everyone up a base: Soto to 3rd, Lee to 2nd"]);
  });

  it("doesn't ask with one runner, or when the words name him", () => {
    const steal = play({ action: "stolen base", batter: null, hit_location: null });
    expect(openQuestions(steal, ctx(state({ first: "Lee" }), "steal"))).toEqual([]);
    expect(openQuestions(steal, ctx(state({ first: "Lee", second: "Soto" }), "Soto steals third"))).toEqual([]);
  });

  it("offers everyone moving up as the usual answer on a wild pitch", () => {
    const wp = play({ action: "wild pitch", batter: null, hit_location: null });
    const q = openQuestions(wp, ctx(state({ first: "Lee", third: "Soto" }), "wild pitch"))[0];
    const everyone = q.options.find((o) => o.likely)!;
    expect(everyone.play.runners).toEqual([
      { from: "3rd", to: "home", runner: "Soto" },
      { from: "1st", to: "2nd", runner: "Lee" },
    ]);
    expect(everyone.play.rbi).toBe(0);
  });
});

describe("what the play itself left out", () => {
  it("asks who made the error, and places it on the spray chart", () => {
    const error = play({ action: "error", hit_location: null, runners: [{ from: "home", to: "1st" }] });
    const q = openQuestions(error, ctx(state(), "reached on an error")).find((x) => x.id === "error-fielder")!;
    expect(q.options).toHaveLength(9);
    expect(option(q, "6").play).toMatchObject({ fielders_involved: ["6"], hit_location: "shortstop", field_zone: 6 });
  });

  it("asks who was batting when nobody said and there's no lineup", () => {
    const q = openQuestions(play({ action: "strikeout", batter: null }), ctx(state(), "K", [], { batterSuggestions: ["Juan Soto"] }))[0];
    expect(q.id).toBe("batter");
    expect(labels(q)).toEqual(["Juan Soto", "Not sure"]);
    expect(q.textEntry!.apply("Pete Alonso").batter).toBe("Pete Alonso");
  });

  it("doesn't ask for the batter on a steal, which isn't his plate appearance", () => {
    expect(ids(openQuestions(play({ action: "stolen base", batter: null, hit_location: null }), ctx(state({ first: "Lee" }), "steal")))).toEqual([]);
  });

  it("offers an optional question for where a hit went", () => {
    const q = openQuestions(play({ action: "single", hit_location: null }), ctx(state(), "single"))[0];
    expect(q).toMatchObject({ id: "location", required: false });
    expect(option(q, "left-center gap").play.field_zone).toBe(2);
  });

  it("asks which play it was when the parser saw two readings, before anything else", () => {
    const p = play({ action: "single", alternatives: ["error"], hit_location: null });
    const qs = openQuestions(p, ctx(state({ second: "Soto" }), "reached when the shortstop booted it"));
    expect(ids(qs)).toEqual(["action"]);
    expect(labels(qs[0])).toEqual(["Single", "Error"]);
    expect(option(qs[0], "error").reparse).toBe("reached when the shortstop booted it. It was a error.");
    expect(option(qs[0], "single").reparse).toBeUndefined();
  });

  it("asks nothing on a clean play", () => {
    expect(openQuestions(play({ action: "strikeout" }), ctx(state({ first: "Lee" }), "K looking"))).toEqual([]);
    expect(openQuestions(play({ action: "walk" }), ctx(state({ first: "Lee", second: "Soto" }), "ball four"))).toEqual([]);
  });
});

describe("answering out loud", () => {
  const single = play({ action: "single" });
  const q = openQuestions(single, ctx(state({ second: "Juan Soto" }), "single"))[0];

  it.each([
    ["he scored", "home"],
    ["Soto came home", "home"],
    ["third", "3rd"],
    ["he went to third", "3rd"],
    ["held", "stay"],
    ["stayed at second", "stay"],
    ["thrown out at home", "out"],
    ["2", "3rd"],
  ])("%j picks %s", (said, id) => {
    expect(matchAnswer(q, said)?.id).toBe(id);
  });

  it("returns nothing for words that don't fit one answer", () => {
    expect(matchAnswer(q, "banana")).toBeNull();
    expect(matchAnswer(q, "")).toBeNull();
  });

  it("reads yes and no on a tag-up question", () => {
    const fly = play({ action: "fly out", runners: [{ from: "home", to: "out" }], outs_recorded: 1, fielders_involved: ["9"] });
    const tag = openQuestions(fly, ctx(state({ third: "Soto" }), "fly out to right"))[0];
    expect(matchAnswer(tag, "yes")?.id).toBe("home");
    expect(matchAnswer(tag, "no")?.id).toBe("stay");
  });

  it("reads the force-play answers", () => {
    const go = play({ action: "ground out", runners: [{ from: "home", to: "out" }], outs_recorded: 1 });
    const force = openQuestions(go, ctx(state({ first: "Lee" }), "grounds out"))[0];
    expect(matchAnswer(force, "double play")?.id).toBe("double-play");
    expect(matchAnswer(force, "fielder's choice")?.id).toBe("fielders-choice");
    expect(matchAnswer(force, "batter out at first")?.id).toBe("out-at-first");
  });

  it("reads a fielder by number or name", () => {
    const error = play({ action: "error", hit_location: null });
    const fielder = openQuestions(error, ctx(state(), "error")).find((x) => x.id === "error-fielder")!;
    expect(matchAnswer(fielder, "6")?.id).toBe("6");
    expect(matchAnswer(fielder, "the shortstop")?.id).toBe("6");
  });

  it("reads which runners stole", () => {
    const steal = play({ action: "stolen base", batter: null, hit_location: null });
    const who = openQuestions(steal, ctx(state({ first: "Lee", second: "Soto" }), "steal"))[0];
    expect(matchAnswer(who, "Soto stole third")?.label).toBe("Soto to 3rd");
    expect(matchAnswer(who, "double steal")?.label).toMatch(/^Everyone/);
  });

  it("reads a location, with the gaps beating the plain fields", () => {
    const where = openQuestions(play({ action: "single", hit_location: null }), ctx(state(), "single"))[0];
    expect(matchAnswer(where, "left center")?.id).toBe("left-center gap");
    expect(matchAnswer(where, "left")?.id).toBe("left field");
  });

  it("knows a skip", () => {
    expect(isSkip("not sure")).toBe(true);
    expect(isSkip("scored")).toBe(false);
  });
});

describe("a whole situation, start to finish", () => {
  it("settles a single with runners on first and second in two answers, and scores it", () => {
    const s = state({ first: "Lee", second: "Soto" }, 1);
    const single = play({ action: "single", batter: "Lindor", runners: [{ from: "home", to: "1st", runner: "Lindor" }] });
    const { play: done } = answer(single, ctx(s, "Lindor singles to right"), { "runner:2nd": "home", "runner:1st": "3rd" });
    expect(done.runners).toEqual([
      { from: "2nd", to: "home", runner: "Soto" },
      { from: "1st", to: "3rd", runner: "Lee" },
      { from: "home", to: "1st", runner: "Lindor" },
    ]);
    const after = applyPlayToState(s, done);
    expect(after.score.away).toBe(1);
    expect(after.runners).toEqual({ first: "Lindor", second: null, third: "Lee" });
  });

  it("describes the situation the question is about", () => {
    expect(describeSituation(state({ first: "A", third: "B" }, 1))).toBe("1 out, runners on 1st and 3rd");
    expect(describeSituation(state({ first: "A", second: "B", third: "C" }, 2))).toBe("2 outs, bases loaded");
    expect(describeSituation(state())).toBe("0 outs, bases empty");
  });
});

describe("question order", () => {
  it("asks who made the error before where the runners went", () => {
    const error = play({ action: "error", hit_location: null, runners: [{ from: "home", to: "1st" }] });
    const qs = openQuestions(error, ctx(state({ third: "Lockridge" }), "reaches on an error"));
    expect(ids(qs).slice(0, 2)).toEqual(["error-fielder", "runner:3rd"]);
  });
});

describe("describePlay", () => {
  it("says what the answers settled, not what the parser guessed", () => {
    const s = state({ first: "Alex Dickerson", third: "Edwin Rios" }, 1);
    const p = play({
      action: "single",
      batter: "Will Robertson",
      hit_location: "left field",
      runners: [
        { from: "1st", to: "2nd", runner: "Alex Dickerson" },
        { from: "home", to: "1st", runner: "Will Robertson" },
      ],
    });
    expect(describePlay(p, s)).toBe("Will Robertson singles to left field. Edwin Rios holds at 3rd, Alex Dickerson to 2nd.");
  });

  it("names the fielder on an error and calls a two-out grounder a double play", () => {
    expect(describePlay(play({ action: "error", batter: "Dickerson", fielders_involved: ["6"] }), state())).toBe(
      "Dickerson reaches on an error by the shortstop."
    );
    expect(describePlay(play({ action: "ground out", batter: "Kelly", outs_recorded: 2, runners: [{ from: "1st", to: "out" }, { from: "home", to: "out" }] }), state({ first: "Lee" }))).toBe(
      "Kelly grounds into a double play. Lee out."
    );
  });

  it("describes plays between pitches by the event", () => {
    expect(describePlay(play({ action: "wild pitch", runners: [{ from: "3rd", to: "home" }] }), state({ third: "Soto" }))).toBe(
      "Wild pitch. Soto scores."
    );
  });
});
