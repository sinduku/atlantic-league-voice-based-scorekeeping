const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { validatePlay } = require("./validatePlay.js");
const {
  EXAMPLES,
  ACTIONS,
  NO_RBI_ACTIONS,
  FIELD_ZONES,
  POSITIONS,
  buildFewShotBlock,
  buildNotationLegend,
} = require("./phrasings.js");

test("library is not empty", () => {
  assert.ok(EXAMPLES.length >= 15, `only ${EXAMPLES.length} examples`);
});

test("every example passes validation without being patched", () => {
  for (const { transcript, play } of EXAMPLES) {
    const result = validatePlay(structuredClone(play));
    assert.ok(result.ok, `"${transcript}" was rejected: ${result.reason}`);
    assert.equal(result.patched, false, `"${transcript}" had to be patched`);
    assert.equal(result.play.confidence, "high", `"${transcript}" lost its confidence`);
  }
});

test("every action is one the parser is allowed to emit", () => {
  for (const { transcript, play } of EXAMPLES) {
    assert.ok(ACTIONS.includes(play.action), `"${transcript}" uses action "${play.action}"`);
  }
});

test("field_zone values are real spray chart zones", () => {
  for (const { transcript, play } of EXAMPLES) {
    if (play.field_zone === undefined || play.field_zone === null) continue;
    assert.ok(
      Object.hasOwn(FIELD_ZONES, play.field_zone),
      `"${transcript}" uses unknown zone ${play.field_zone}`
    );
  }
});

test("plays with a ball in play carry a zone, plays without one do not", () => {
  const noBallInPlay = ["walk", "hit by pitch", "strikeout", "stolen base", "wild pitch", "passed ball", "balk"];
  for (const { transcript, play } of EXAMPLES) {
    const hasZone = play.field_zone !== undefined && play.field_zone !== null;
    if (noBallInPlay.includes(play.action)) {
      assert.equal(hasZone, false, `"${transcript}" should not have a field_zone`);
    } else {
      assert.equal(hasZone, true, `"${transcript}" is missing a field_zone`);
    }
  }
});

test("fielders_involved only uses valid position numbers", () => {
  for (const { transcript, play } of EXAMPLES) {
    for (const f of play.fielders_involved) {
      assert.match(f, /^[1-9]$/, `"${transcript}" has fielder "${f}"`);
      assert.ok(Object.hasOwn(POSITIONS, Number(f)), `"${transcript}" has fielder "${f}"`);
    }
  }
});

test("transcripts are unique", () => {
  const seen = new Set();
  for (const { transcript } of EXAMPLES) {
    const key = transcript.toLowerCase();
    assert.equal(seen.has(key), false, `duplicate transcript: ${transcript}`);
    seen.add(key);
  }
});

// a run scored on a passed ball, wild pitch, balk, error or steal of home does
// not credit the batter, so those actions are expected to score with rbi 0
test("rbi count matches the runners who scored, minus unearned ones", () => {
  for (const { transcript, play } of EXAMPLES) {
    const scored = play.runners.filter((r) => r.to === "home").length;
    const expected = NO_RBI_ACTIONS.includes(play.action) ? 0 : scored;
    assert.equal(play.rbi, expected, `"${transcript}" claims ${play.rbi} rbi, expected ${expected}`);
  }
});

test("outs_recorded matches the number of runners retired", () => {
  for (const { transcript, play } of EXAMPLES) {
    const out = play.runners.filter((r) => r.to === "out").length;
    assert.equal(play.outs_recorded, out, `"${transcript}" claims ${play.outs_recorded} outs but retired ${out}`);
  }
});

// guards against the spray chart being renumbered without updating this library
test("FIELD_ZONES matches ZONE_COORDS in SprayChart.tsx", () => {
  const chartPath = path.join(__dirname, "..", "src", "components", "SprayChart.tsx");
  const source = fs.readFileSync(chartPath, "utf8");
  const block = source.match(/ZONE_COORDS[^=]*=\s*\{([\s\S]*?)\n\};/);
  assert.ok(block, "could not find ZONE_COORDS in SprayChart.tsx");
  const chartZones = [...block[1].matchAll(/^\s*(\d+):/gm)].map((m) => Number(m[1])).sort();
  const libraryZones = Object.keys(FIELD_ZONES).map(Number).sort();
  assert.deepEqual(libraryZones, chartZones, "zone numbers have drifted apart");
});

test("few-shot block renders one parseable pair per line", () => {
  const lines = buildFewShotBlock().split("\n");
  assert.equal(lines.length, EXAMPLES.length);
  for (const line of lines) {
    const at = line.indexOf(" -> ");
    assert.ok(at > 0, `line has no arrow: ${line}`);
    const json = line.slice(at + 4);
    const parsed = JSON.parse(json);
    assert.ok(parsed.action && parsed.description);
    assert.equal(json.includes("null"), false, "nulls should be stripped from the prompt");
  }
});

test("notation legend mentions the shorthand it claims to teach", () => {
  const legend = buildNotationLegend();
  for (const token of ["6-4-3", "E5", "shortstop", "FIELD_ZONE"]) {
    assert.ok(legend.includes(token), `legend is missing ${token}`);
  }
});
