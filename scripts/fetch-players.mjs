// Builds src/data/players.json, the name list the transcript corrector uses to
// fix player names the browser's speech recognition mangles ("a coon ya" ->
// "Acuña").
//
//   node scripts/fetch-players.mjs            # this season and last
//   node scripts/fetch-players.mjs 2026       # a specific season
//
// Sources, in order:
//   1. MLB Stats API (statsapi.mlb.com) - every MLB player for the season, and
//      the Atlantic League rosters, which the same API carries as a partner
//      league under the independent leagues sport.
//   2. Chadwick Bureau register on GitHub - fallback for the MLB list when the
//      Stats API is unreachable. It has no Atlantic League data.
//
// Behind a proxy, run with NODE_USE_ENV_PROXY=1 so Node's fetch uses it.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "players.json");
const STATS = "https://statsapi.mlb.com/api/v1";
const CHADWICK = "https://raw.githubusercontent.com/chadwickbureau/register/master/data";

const thisYear = new Date().getFullYear();
const seasons = process.argv[2] ? [Number(process.argv[2])] : [thisYear, thisYear - 1];

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res.json();
}

async function mlbFromStatsApi(season) {
  const teams = await getJson(`${STATS}/teams?sportId=1&season=${season}`);
  const abbr = new Map(teams.teams.map((t) => [t.id, t.abbreviation]));
  const { people } = await getJson(`${STATS}/sports/1/players?season=${season}`);
  return people.map((p) => [p.fullName, "MLB", abbr.get(p.currentTeam?.id) ?? null]);
}

// the Atlantic League sits under the independent leagues sport, so look the
// teams up by league name rather than hard coding ids that change by season
async function atlanticFromStatsApi(season) {
  const { sports } = await getJson(`${STATS}/sports`);
  const players = [];
  for (const sport of sports.filter((s) => s.id !== 1)) {
    const { teams = [] } = await getJson(`${STATS}/teams?sportId=${sport.id}&season=${season}`);
    for (const team of teams.filter((t) => /atlantic/i.test(t.league?.name ?? ""))) {
      let roster = [];
      for (const type of ["fullSeason", "active"]) {
        const data = await getJson(`${STATS}/teams/${team.id}/roster?season=${season}&rosterType=${type}`).catch(() => null);
        roster = data?.roster ?? [];
        if (roster.length) break;
      }
      for (const r of roster) players.push([r.person.fullName, "ALPB", team.abbreviation ?? team.teamName ?? null]);
    }
  }
  return players;
}

// minimal CSV split that honours quoted fields
function splitCsv(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

async function mlbFromChadwick(sinceSeason) {
  const players = [];
  for (const shard of "0123456789abcdef") {
    const res = await fetch(`${CHADWICK}/people-${shard}.csv`, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`${res.status} from Chadwick shard ${shard}`);
    const [header, ...rows] = (await res.text()).split("\n");
    const col = Object.fromEntries(splitCsv(header).map((name, i) => [name, i]));
    for (const row of rows) {
      const f = splitCsv(row);
      if (Number(f[col.mlb_played_last]) < sinceSeason) continue;
      const name = [f[col.name_first], f[col.name_last], f[col.name_suffix]].filter(Boolean).join(" ");
      if (name) players.push([name, "MLB", null]);
    }
  }
  return players;
}

async function attempt(label, fn) {
  try {
    const result = await fn();
    console.log(`  ${label}: ${result.length} players`);
    return result;
  } catch (e) {
    console.warn(`  ${label}: failed (${e.message})`);
    return [];
  }
}

const sources = [];
let mlb = [];
let atlantic = [];

for (const season of seasons) {
  console.log(`Season ${season}`);
  const m = await attempt("MLB (Stats API)", () => mlbFromStatsApi(season));
  if (m.length) sources.push(`MLB Stats API ${season}`);
  mlb.push(...m);
  const a = await attempt("Atlantic League (Stats API)", () => atlanticFromStatsApi(season));
  if (a.length) sources.push(`MLB Stats API Atlantic League ${season}`);
  atlantic.push(...a);
}

if (!mlb.length) {
  console.log("Falling back to the Chadwick register for MLB");
  mlb = await attempt("MLB (Chadwick)", () => mlbFromChadwick(Math.min(...seasons)));
  if (mlb.length) sources.push(`Chadwick Bureau register, MLB players since ${Math.min(...seasons)}`);
}

if (!atlantic.length) {
  console.warn("WARNING: no Atlantic League players found - the list will only hold MLB names.");
}

// Atlantic League first, so a name that appears in both keeps the ALPB team
const seen = new Set();
const players = [];
for (const p of [...atlantic, ...mlb]) {
  const key = p[0].toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);
  players.push(p);
}
players.sort((a, b) => a[0].localeCompare(b[0]));

if (!players.length) {
  console.error("No players fetched, leaving the existing file alone.");
  process.exit(1);
}

writeFileSync(
  OUT,
  JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), sources, players }) + "\n"
);
console.log(`Wrote ${players.length} players to ${path.relative(process.cwd(), OUT)}`);
