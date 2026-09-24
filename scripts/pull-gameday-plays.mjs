// Pulls finished MLB games from the Gameday feed and turns their plays into
// labeled examples for the parsing model: the play description to read aloud,
// the game state before it, and the correct structured play.
//
//   node scripts/pull-gameday-plays.mjs
//   node scripts/pull-gameday-plays.mjs --season=2025 --games=40 --count=500
//
// Writes to data/gameday/:
//   plays.jsonl        one labeled play per line (the answer key)
//   reading-sheet.csv  what to read aloud, with an empty transcript column
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  describeSituation,
  extractPlays,
  sampleByAction,
  seededRandom,
  shuffle,
} from "./lib/gameday.mjs";
import { toCsv } from "./lib/csv.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://statsapi.mlb.com/api";

function readArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const match = arg.match(/^--([\w-]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

const args = readArgs(process.argv.slice(2));
const season = Number(args.season ?? 2025);
const gameCount = Number(args.games ?? 40);
const playCount = Number(args.count ?? 500);
const seed = Number(args.seed ?? 42);
const outDir = resolve(projectRoot, args.out ?? "data/gameday");

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} from ${url}`);
  return response.json();
}

// 1. every finished regular season game that season
const schedule = await getJson(
  `${API}/v1/schedule?sportId=1&gameType=R&season=${season}` +
    `&startDate=${season}-03-01&endDate=${season}-10-15`
);
const finished = schedule.dates
  .flatMap((date) => date.games)
  .filter((game) => game.status?.abstractGameState === "Final");

if (finished.length === 0) {
  console.error(`FAIL  no finished games found for ${season}`);
  process.exitCode = 1;
  throw new Error("no games");
}

// 2. spread the games across the whole season so we get a mix of teams,
// broadcasters' phrasing, and early/late season situations
const step = Math.max(1, Math.floor(finished.length / gameCount));
const chosen = finished.filter((_, i) => i % step === 0).slice(0, gameCount);
console.log(`Found ${finished.length} finished games in ${season}, pulling ${chosen.length}\n`);

const allRecords = [];
for (const game of chosen) {
  try {
    const feed = await getJson(`${API}/v1.1/game/${game.gamePk}/feed/live`);
    const records = extractPlays(feed);
    allRecords.push(...records);
    console.log(`PASS  ${game.gamePk} ${game.officialDate} - ${records.length} plays`);
  } catch (e) {
    console.error(`SKIP  ${game.gamePk}: ${e.message}`);
  }
  // the stats api is public, no need to hammer it
  await sleep(250);
}

// 3. pick the plays, keeping rare actions in
const random = seededRandom(seed);
const picked = sampleByAction(allRecords, playCount, random);
const ordered = shuffle(picked, random);

// 4. write the answer key and the sheet to record from
mkdirSync(outDir, { recursive: true });
writeFileSync(
  resolve(outDir, "plays.jsonl"),
  ordered.map((record) => JSON.stringify(record)).join("\n") + "\n"
);
writeFileSync(
  resolve(outDir, "reading-sheet.csv"),
  toCsv(
    ordered.map((record) => ({
      id: record.id,
      situation: describeSituation(record.game_state),
      read_this: record.label.description,
      transcript: "",
    })),
    ["id", "situation", "read_this", "transcript"]
  )
);

const byAction = {};
for (const record of ordered) {
  byAction[record.label.action] = (byAction[record.label.action] ?? 0) + 1;
}
console.log(`\nKept ${ordered.length} of ${allRecords.length} plays:`);
for (const [action, count] of Object.entries(byAction).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${action.padEnd(18)} ${count}`);
}
console.log(`\nWrote ${resolve(outDir, "plays.jsonl")}`);
console.log(`Wrote ${resolve(outDir, "reading-sheet.csv")}`);