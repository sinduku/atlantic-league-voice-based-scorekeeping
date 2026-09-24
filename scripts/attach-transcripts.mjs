// Joins the transcripts recorded in the reading sheet back onto their labeled
// plays and splits them into train/test sets.
//
//   node scripts/attach-transcripts.mjs
//   node scripts/attach-transcripts.mjs --sheet=path/to/exported.csv --test-share=0.2
//
// Rows with an empty transcript are skipped, so this can be re-run as more
// plays get recorded. To add a shorthand variant of a play ("6-4-3 DP"), copy
// its row and change the transcript; both rows become examples.
//
// The split is by game, not by play, so plays from one game never show up on
// both sides and inflate the test score.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { seededRandom, shuffle } from "./lib/gameday.mjs";
import { parseCsv } from "./lib/csv.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const match = arg.match(/^--([\w-]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

const args = readArgs(process.argv.slice(2));
const dataDir = resolve(projectRoot, args.out ?? "data/gameday");
const sheetPath = resolve(projectRoot, args.sheet ?? "data/gameday/reading-sheet.csv");
const testShare = Number(args["test-share"] ?? 0.2);
const seed = Number(args.seed ?? 42);

const plays = new Map(
  readFileSync(resolve(dataDir, "plays.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const record = JSON.parse(line);
      return [record.id, record];
    })
);

const examples = [];
let unknown = 0;
for (const row of parseCsv(readFileSync(sheetPath, "utf8"))) {
  const transcript = row.transcript?.trim();
  if (!transcript) continue;

  const record = plays.get(row.id?.trim());
  if (!record) {
    console.warn(`SKIP  ${row.id}: not in plays.jsonl`);
    unknown++;
    continue;
  }
  examples.push({
    id: record.id,
    game_pk: record.game_pk,
    transcript,
    game_state: record.game_state,
    label: record.label,
  });
}

if (examples.length === 0) {
  console.error("FAIL  no transcripts found - fill in the transcript column first");
  process.exitCode = 1;
  throw new Error("no transcripts");
}

// hold out whole games until the test set has its share of examples
const games = shuffle([...new Set(examples.map((e) => e.game_pk))], seededRandom(seed));
const testGames = new Set();
let testSize = 0;
for (const game of games) {
  if (testSize >= examples.length * testShare) break;
  testGames.add(game);
  testSize += examples.filter((e) => e.game_pk === game).length;
}

const test = examples.filter((e) => testGames.has(e.game_pk));
const train = examples.filter((e) => !testGames.has(e.game_pk));

const toJsonl = (rows) => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
writeFileSync(resolve(dataDir, "train.jsonl"), toJsonl(train));
writeFileSync(resolve(dataDir, "test.jsonl"), toJsonl(test));

console.log(`${examples.length} transcripts attached${unknown ? `, ${unknown} unknown ids skipped` : ""}`);
console.log(`  train ${train.length} (${games.length - testGames.size} games)`);
console.log(`  test  ${test.length} (${testGames.size} games)`);
console.log(`\nWrote ${resolve(dataDir, "train.jsonl")}`);
console.log(`Wrote ${resolve(dataDir, "test.jsonl")}`);