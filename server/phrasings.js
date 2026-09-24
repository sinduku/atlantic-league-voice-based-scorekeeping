// Few-shot phrasing library for /api/parse-play.
//
// Scorekeepers speak in shorthand ("6-4-3", "E5", "F8", "K looking") that a
// model will not reliably decode from field names alone. These worked examples
// teach the notation, and double as fixtures in phrasings.test.js.
//
// Every example must pass validatePlay() unpatched - the test enforces it.

// Standard scorekeeping position numbers, used in fielders_involved.
const POSITIONS = {
  1: "pitcher",
  2: "catcher",
  3: "first baseman",
  4: "second baseman",
  5: "third baseman",
  6: "shortstop",
  7: "left fielder",
  8: "center fielder",
  9: "right fielder",
};

// Spray chart zones. These MUST stay in step with ZONE_COORDS in
// src/components/SprayChart.tsx - that component is what actually plots the
// dot, so its numbering is the source of truth. These are NOT the same numbers
// as POSITIONS above.
const FIELD_ZONES = {
  1: "left field line",
  2: "left-center gap",
  3: "center field",
  4: "right-center gap",
  5: "right field line",
  6: "shortstop / third base area",
  7: "second base area",
  8: "first base area",
  9: "infield / catcher area",
};

// Actions the parser is allowed to emit. Caught stealing, pickoffs and
// sacrifice bunts have no action of their own yet - a sac bunt is recorded as
// a ground out with hit_type "bunt".
const ACTIONS = [
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

const EXAMPLES = [
  {
    transcript: "six four three double play",
    play: {
      action: "ground out",
      description: "Ground ball to shortstop, 6-4-3 double play",
      runners: [
        { from: "1st", to: "out", runner: null },
        { from: "home", to: "out", runner: null },
      ],
      rbi: 0,
      outs_recorded: 2,
      fielders_involved: ["6", "4", "3"],
      hit_location: "shortstop",
      hit_type: "ground ball",
      hit_hardness: "medium",
      field_zone: 6,
      confidence: "high",
    },
  },
  {
    transcript: "E5",
    play: {
      action: "error",
      description: "Ground ball to third, error on the third baseman, batter safe at first",
      runners: [{ from: "home", to: "1st", runner: null }],
      rbi: 0,
      outs_recorded: 0,
      fielders_involved: ["5"],
      hit_location: "third base",
      hit_type: "ground ball",
      hit_hardness: "medium",
      field_zone: 6,
      confidence: "high",
    },
  },
  {
    transcript: "F8",
    play: {
      action: "fly out",
      description: "Fly ball to center field, caught by the center fielder",
      runners: [{ from: "home", to: "out", runner: null }],
      rbi: 0,
      outs_recorded: 1,
      fielders_involved: ["8"],
      hit_location: "center field",
      hit_type: "fly ball",
      hit_hardness: "medium",
      field_zone: 3,
      confidence: "high",
    },
  },
  {
    transcript: "K looking",
    play: {
      action: "strikeout",
      description: "Called strike three, batter caught looking",
      runners: [{ from: "home", to: "out", runner: null }],
      rbi: 0,
      outs_recorded: 1,
      fielders_involved: ["1", "2"],
      confidence: "high",
    },
  },
  {
    transcript: "four three",
    play: {
      action: "ground out",
      description: "Ground ball to second, thrown to first for the out",
      runners: [{ from: "home", to: "out", runner: null }],
      rbi: 0,
      outs_recorded: 1,
      fielders_involved: ["4", "3"],
      hit_location: "second base",
      hit_type: "ground ball",
      hit_hardness: "medium",
      field_zone: 7,
      confidence: "high",
    },
  },
  {
    transcript: "U3",
    play: {
      action: "ground out",
      description: "Ground ball to first, unassisted putout by the first baseman",
      runners: [{ from: "home", to: "out", runner: null }],
      rbi: 0,
      outs_recorded: 1,
      fielders_involved: ["3"],
      hit_location: "first base",
      hit_type: "ground ball",
      hit_hardness: "soft",
      field_zone: 8,
      confidence: "high",
    },
  },
  {
    transcript: "L7",
    play: {
      action: "fly out",
      description: "Line drive to left field, caught by the left fielder",
      runners: [{ from: "home", to: "out", runner: null }],
      rbi: 0,
      outs_recorded: 1,
      fielders_involved: ["7"],
      hit_location: "left field",
      hit_type: "line drive",
      hit_hardness: "hard",
      field_zone: 1,
      confidence: "high",
    },
  },
  {
    transcript: "P4",
    play: {
      action: "fly out",
      description: "Pop up to the second baseman",
      runners: [{ from: "home", to: "out", runner: null }],
      rbi: 0,
      outs_recorded: 1,
      fielders_involved: ["4"],
      hit_location: "second base",
      hit_type: "pop up",
      hit_hardness: "soft",
      field_zone: 7,
      confidence: "high",
    },
  },
  {
    transcript: "Rodriguez lines a single to right center, Chen scores from second",
    play: {
      action: "single",
      description: "Rodriguez lines a single into right-center, Chen scores from second",
      batter: "Rodriguez",
      runners: [
        { from: "2nd", to: "home", runner: "Chen" },
        { from: "home", to: "1st", runner: "Rodriguez" },
      ],
      rbi: 1,
      outs_recorded: 0,
      fielders_involved: ["8", "9"],
      hit_location: "right-center gap",
      hit_type: "line drive",
      hit_hardness: "hard",
      field_zone: 4,
      confidence: "high",
    },
  },
  {
    transcript: "sac fly to right, runner tags from third",
    play: {
      action: "sacrifice fly",
      description: "Fly ball to right field, runner tags from third and scores",
      runners: [
        { from: "3rd", to: "home", runner: null },
        { from: "home", to: "out", runner: null },
      ],
      rbi: 1,
      outs_recorded: 1,
      fielders_involved: ["9"],
      hit_location: "right field",
      hit_type: "fly ball",
      hit_hardness: "medium",
      field_zone: 5,
      confidence: "high",
    },
  },
  {
    transcript: "solo shot to left",
    play: {
      action: "home run",
      description: "Home run to left field, no one on base",
      runners: [{ from: "home", to: "home", runner: null }],
      rbi: 1,
      outs_recorded: 0,
      fielders_involved: [],
      hit_location: "left field",
      hit_type: "fly ball",
      hit_hardness: "hard",
      field_zone: 1,
      confidence: "high",
    },
  },
  {
    transcript: "bunt single down the third base line",
    play: {
      action: "single",
      description: "Bunt single down the third base line",
      runners: [{ from: "home", to: "1st", runner: null }],
      rbi: 0,
      outs_recorded: 0,
      fielders_involved: ["5"],
      hit_location: "third base line",
      hit_type: "bunt",
      hit_hardness: "soft",
      field_zone: 6,
      confidence: "high",
    },
  },
  {
    transcript: "fielder's choice, runner out at second",
    play: {
      action: "fielder's choice",
      description: "Ground ball to short, lead runner forced at second, batter safe at first",
      runners: [
        { from: "1st", to: "out", runner: null },
        { from: "home", to: "1st", runner: null },
      ],
      rbi: 0,
      outs_recorded: 1,
      fielders_involved: ["6", "4"],
      hit_location: "shortstop",
      hit_type: "ground ball",
      hit_hardness: "medium",
      field_zone: 6,
      confidence: "high",
    },
  },
  {
    transcript: "ball four",
    play: {
      action: "walk",
      description: "Batter walks on four balls",
      runners: [{ from: "home", to: "1st", runner: null }],
      rbi: 0,
      outs_recorded: 0,
      fielders_involved: [],
      confidence: "high",
    },
  },
  {
    transcript: "HBP",
    play: {
      action: "hit by pitch",
      description: "Batter hit by the pitch, takes first base",
      runners: [{ from: "home", to: "1st", runner: null }],
      rbi: 0,
      outs_recorded: 0,
      fielders_involved: [],
      confidence: "high",
    },
  },
  {
    transcript: "stolen base, runner takes second",
    play: {
      action: "stolen base",
      description: "Runner steals second base",
      runners: [{ from: "1st", to: "2nd", runner: null }],
      rbi: 0,
      outs_recorded: 0,
      fielders_involved: ["2", "4"],
      confidence: "high",
    },
  },
  {
    transcript: "wild pitch, runner moves up",
    play: {
      action: "wild pitch",
      description: "Wild pitch gets past the catcher, runner advances to second",
      runners: [{ from: "1st", to: "2nd", runner: null }],
      rbi: 0,
      outs_recorded: 0,
      fielders_involved: ["1"],
      confidence: "high",
    },
  },
  {
    transcript: "passed ball, runner scores from third",
    play: {
      action: "passed ball",
      description: "Passed ball, runner scores from third",
      runners: [{ from: "3rd", to: "home", runner: null }],
      rbi: 0,
      outs_recorded: 0,
      fielders_involved: ["2"],
      confidence: "high",
    },
  },
  {
    transcript: "balk",
    play: {
      action: "balk",
      description: "Balk called on the pitcher, runner advances to second",
      runners: [{ from: "1st", to: "2nd", runner: null }],
      rbi: 0,
      outs_recorded: 0,
      fielders_involved: ["1"],
      confidence: "high",
    },
  },
  {
    transcript: "double off the wall in left center",
    play: {
      action: "double",
      description: "Double off the wall in the left-center gap",
      runners: [{ from: "home", to: "2nd", runner: null }],
      rbi: 0,
      outs_recorded: 0,
      fielders_involved: ["7", "8"],
      hit_location: "left-center gap",
      hit_type: "line drive",
      hit_hardness: "hard",
      field_zone: 2,
      confidence: "high",
    },
  },
];

// Runs scored on these do not credit the batter with an RBI, so an example can
// legitimately show a runner reaching home with rbi 0.
const NO_RBI_ACTIONS = ["passed ball", "wild pitch", "balk", "error", "stolen base"];

// drops null/undefined at every level so the prompt does not pay tokens for
// empty fields, including inside the runners array
function compact(value) {
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => [k, compact(v)])
    );
  }
  return value;
}

function buildNotationLegend() {
  const positions = Object.entries(POSITIONS)
    .map(([n, name]) => `${n}=${name}`)
    .join(", ");
  const zones = Object.entries(FIELD_ZONES)
    .map(([n, name]) => `${n}=${name}`)
    .join(", ");
  return [
    `POSITION NUMBERS (for fielders_involved): ${positions}`,
    `A hyphenated sequence is throw order: "6-4-3" is shortstop to second baseman to first baseman.`,
    `"E" plus a number is an error by that fielder ("E5" = error by the third baseman).`,
    `"F"/"L"/"P"/"G" plus a number is a fly out / line out / pop out / ground out to that fielder.`,
    `"U" plus a number is an unassisted putout. "K" is a strikeout, "K looking" is called strike three.`,
    `FIELD_ZONE (spray chart location, NOT position numbers): ${zones}`,
  ].join("\n");
}

// renders examples as compact one-line pairs for the system prompt
function buildFewShotBlock(limit = EXAMPLES.length) {
  return EXAMPLES.slice(0, limit)
    .map((ex) => `"${ex.transcript}" -> ${JSON.stringify(compact(ex.play))}`)
    .join("\n");
}

module.exports = {
  POSITIONS,
  FIELD_ZONES,
  ACTIONS,
  NO_RBI_ACTIONS,
  EXAMPLES,
  compact,
  buildNotationLegend,
  buildFewShotBlock,
};
