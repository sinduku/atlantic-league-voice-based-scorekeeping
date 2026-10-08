// The system prompt for /api/parse-play, kept short because every token in it
// is paid for on every play, in money and in latency.
//
// It is split in two: STATIC_PROMPT never changes, and the game state goes on
// the end. Providers that cache prompts reuse the unchanged front, and
// supabase/functions/parse-play holds a copy of STATIC_PROMPT for the live
// site - `npm run sync:prompt` in server/ refreshes that copy, and a test
// fails if the two drift apart.

const { ACTIONS, buildNotationLegend, buildFewShotBlock } = require("./phrasings");

// worked examples in the prompt. more parse names and runners more reliably
// but cost prompt tokens and latency; 0 turns them off
const DEFAULT_FEWSHOT = 4;

function buildStaticPrompt(fewShot = DEFAULT_FEWSHOT) {
  const examples = buildFewShotBlock(fewShot);
  return `Turn a baseball scorekeeper's spoken words into one scored play. Reply with one JSON object only.

Always include action, description, runners, rbi, outs_recorded, fielders_involved, confidence. Add other keys only when the words tell you; never write null.
action: ${ACTIONS.join(" | ")}
description: under 12 words
batter, pitcher: names
runners: [{"from","to","runner"}] everyone who moved or was put out, batter included as from "home". Bases: home, 1st, 2nd, 3rd; to can be "out"
fielders_involved: position numbers as strings
hit_type: ground ball | line drive | fly ball | pop up | bunt. hit_location: e.g. shortstop, left-center gap. hit_hardness: soft | medium | hard
pitch_type, pitch_location, count: only if said
confidence: high | medium | low

RULES
- Only runners listed in STATE are on base. Never move a runner off an empty base; if the words seem to, confidence low.
- Forced runners advance; unmentioned runners stay. A home run scores everyone on base.
- outs_recorded = runners sent "out". rbi = runners reaching home, none on an error, wild pitch, passed ball, balk, steal or double play.
- Mangled words may be names ("show hey" = Shohei); use the intended name.
- Unsure: best guess, confidence low.

SHORTHAND
${buildNotationLegend()}${examples ? `

EXAMPLES
${examples}` : ""}`;
}

function describeState(gameState) {
  if (!gameState) return "STATE: start of game, top 1, 0 outs, bases empty";
  const r = gameState.runners || {};
  const base = (name) => name || "empty";
  return `STATE: ${gameState.half || "top"} ${gameState.inning || 1}, ${gameState.outs || 0} outs, away ${gameState.score?.away || 0} home ${gameState.score?.home || 0}, 1st: ${base(r.first)}, 2nd: ${base(r.second)}, 3rd: ${base(r.third)}`;
}

function buildSystemPrompt(staticPrompt, gameState) {
  return `${staticPrompt}\n\n${describeState(gameState)}`;
}

module.exports = { DEFAULT_FEWSHOT, buildStaticPrompt, describeState, buildSystemPrompt };
