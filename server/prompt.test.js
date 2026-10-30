const test = require("node:test");
const assert = require("node:assert");

const { ACTIONS, EXAMPLES } = require("./phrasings.js");
const { DEFAULT_FEWSHOT, buildStaticPrompt, buildSystemPrompt, describeState } = require("./prompt.js");
const { readEdgePrompt } = require("./sync-prompt.js");

// every token is paid on every play; this keeps the prompt from creeping back up
test("the default prompt stays short", () => {
  const prompt = buildStaticPrompt();
  assert.ok(prompt.length < 4000, `prompt is ${prompt.length} characters (~${Math.round(prompt.length / 4)} tokens)`);
});

test("the prompt lists every action the scoreboard understands", () => {
  const prompt = buildStaticPrompt();
  for (const action of ACTIONS) assert.ok(prompt.includes(action), `missing ${action}`);
});

test("the example count can be turned down to none", () => {
  assert.ok(buildStaticPrompt(DEFAULT_FEWSHOT).includes(EXAMPLES[0].transcript));
  const none = buildStaticPrompt(0);
  assert.equal(none.includes("EXAMPLES"), false);
  assert.ok(none.length < buildStaticPrompt().length);
});

test("game state goes at the end so the front of the prompt never changes", () => {
  const state = {
    inning: 3,
    half: "bottom",
    outs: 2,
    score: { away: 1, home: 4 },
    runners: { first: "Chen", second: null, third: "Soto" },
  };
  const prompt = buildSystemPrompt(buildStaticPrompt(), state);
  assert.ok(prompt.startsWith(buildStaticPrompt()));
  assert.ok(prompt.endsWith("STATE: bottom 3, 2 outs, away 1 home 4, 1st: Chen, 2nd: empty, 3rd: Soto"));
});

test("a missing game state reads as the start of the game", () => {
  assert.match(describeState(null), /start of game.*bases empty/);
  assert.match(describeState(undefined), /start of game/);
});

test("the edge function carries the current prompt (run npm run sync:prompt)", () => {
  assert.equal(readEdgePrompt(), buildStaticPrompt(), "supabase/functions/parse-play/index.ts is out of date");
});

test("the batter due up goes in the context, marked as overridable", () => {
  const { describeContext } = require("./prompt.js");
  const text = describeContext({ batter: "Juan Soto", players: [] });
  assert.match(text, /^AT BAT: Juan Soto \(the batter unless the words name another\)$/m);
  assert.equal(describeContext({ players: [] }), "");
});

// the edge function carries its own copy of describeContext for the live
// site; this catches the two drifting apart
test("the edge function describes context with the same lines as the server", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { describeContext } = require("./prompt.js");
  const edge = fs.readFileSync(path.join(__dirname, "..", "supabase", "functions", "parse-play", "index.ts"), "utf8");
  const sample = describeContext({ battingTeam: "A", fieldingTeam: "B", batter: "C", pitcher: "D", players: ["E"] });
  for (const line of sample.split("\n")) {
    const label = line.slice(0, line.indexOf(":") + 1);
    assert.ok(edge.includes(`${label} `), `edge function is missing "${label}"`);
  }
  assert.ok(edge.includes("(the batter unless the words name another)"), "edge function's AT BAT line differs");
  assert.ok(/batter: cleanName\(input\.batter\)/.test(edge), "edge function doesn't read the batter from the context");
});
