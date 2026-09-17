// Verifies that games and plays can actually be written to and read back from
// Supabase, using the same credentials and table shape the app uses.
//
//   node scripts/check-supabase.mjs
//
// Any rows it creates are deleted again before it exits.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readEnvFile(path) {
  const env = {};
  let contents;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return env;
  }
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!match || line.trim().startsWith("#")) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = { ...readEnvFile(resolve(projectRoot, ".env")), ...process.env };
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error("FAIL  VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing from .env");
  process.exitCode = 1;
  throw new Error("missing Supabase credentials");
}

console.log(`Checking ${url}\n`);

const supabase = createClient(url, key, { auth: { persistSession: false } });

function explain(error) {
  if (error.code === "42501" || /row-level security/i.test(error.message)) {
    return [
      "Row Level Security is blocking this write.",
      "Add insert/select policies for the anon role on this table (see README).",
    ].join(" ");
  }
  if (error.code === "23502") {
    return "A NOT NULL column has no value - user_id most likely still requires a signed-in user.";
  }
  return error.message;
}

let gameId = null;
let failed = false;

// 1. insert a game
const { data: game, error: gameError } = await supabase
  .from("games")
  .insert({ home_team: "Check Home", away_team: "Check Away" })
  .select("id")
  .single();

if (gameError) {
  console.error(`FAIL  insert into games: ${explain(gameError)}`);
  failed = true;
} else {
  gameId = game.id;
  console.log(`PASS  insert into games (id ${gameId})`);

  // 2. insert a play attached to that game
  const samplePlay = {
    action: "single",
    description: "Connection check - safe to delete",
    runners: [],
    rbi: 0,
    outs_recorded: 0,
    fielders_involved: [],
    confidence: "high",
  };

  const { error: playError } = await supabase
    .from("plays")
    .insert({ game_id: gameId, play_index: 0, data: samplePlay });

  if (playError) {
    console.error(`FAIL  insert into plays: ${explain(playError)}`);
    failed = true;
  } else {
    console.log("PASS  insert into plays");

    // 3. read it back, which is the part that proves it persisted
    const { data: rows, error: readError } = await supabase
      .from("plays")
      .select("play_index, data")
      .eq("game_id", gameId);

    if (readError) {
      console.error(`FAIL  read back plays: ${explain(readError)}`);
      failed = true;
    } else if (!rows || rows.length === 0) {
      console.error("FAIL  read back plays: the row was written but cannot be read (select policy missing)");
      failed = true;
    } else {
      console.log(`PASS  read back ${rows.length} play row(s)`);
    }
  }
}

// 4. clean up whatever was created
if (gameId) {
  await supabase.from("plays").delete().eq("game_id", gameId);
  const { error: cleanupError } = await supabase.from("games").delete().eq("id", gameId);
  console.log(
    cleanupError
      ? `NOTE  could not remove test rows (${cleanupError.message}) - delete game ${gameId} by hand`
      : "PASS  test rows cleaned up"
  );
}

console.log(
  failed
    ? "\nPersistence is NOT working yet. Fix the failure above and run this again."
    : "\nPersistence is working: games and plays are being saved and read back."
);

// setting the code rather than calling process.exit() lets the http client
// close its sockets first, which node is strict about on windows
process.exitCode = failed ? 1 : 0;
