// turns an MLB Gameday live feed into labeled plays in the same shape
// /api/parse-play returns, so a transcript of someone reading the play aloud
// can be paired with an answer we already know is right.
//
// each allPlays entry is one plate appearance. things that happen during it
// (steals, wild pitches, balks) are pulled out as their own plays because a
// scorekeeper calls them separately.

// gameday result eventType -> app action. anything not listed is skipped
const AT_BAT_ACTIONS = {
  single: "single",
  double: "double",
  triple: "triple",
  home_run: "home run",
  strikeout: "strikeout",
  strikeout_double_play: "strikeout",
  walk: "walk",
  intent_walk: "walk",
  hit_by_pitch: "hit by pitch",
  field_error: "error",
  fielders_choice: "fielder's choice",
  fielders_choice_out: "fielder's choice",
  // batter safe at first while a runner is forced, which the app scores as a FC
  force_out: "fielder's choice",
  sac_fly: "sacrifice fly",
  sac_fly_double_play: "sacrifice fly",
  grounded_into_double_play: "ground out",
};

// outs that depend on how the ball was hit. the app only has ground/fly outs,
// so line drives and pop ups count as fly outs
const BATTED_OUTS = ["field_out", "double_play", "triple_play"];

// mid at-bat events, keyed by the playEvent's eventType
const RUNNER_ACTIONS = {
  stolen_base_2b: "stolen base",
  stolen_base_3b: "stolen base",
  stolen_base_home: "stolen base",
  wild_pitch: "wild pitch",
  passed_ball: "passed ball",
  balk: "balk",
};

const BASE_KEYS = { "1B": "first", "2B": "second", "3B": "third" };
const BASE_NAMES = { "1B": "1st", "2B": "2nd", "3B": "3rd", score: "home" };

const HIT_TYPES = {
  ground_ball: "ground ball",
  line_drive: "line drive",
  fly_ball: "fly ball",
  popup: "pop up",
  bunt_grounder: "bunt",
  bunt_popup: "bunt",
  bunt_line_drive: "bunt",
};

// hitData.location is the fielder position number that fielded the ball
const POSITION_NAMES = {
  1: "pitcher",
  2: "catcher",
  3: "first base",
  4: "second base",
  5: "third base",
  6: "shortstop",
  7: "left field",
  8: "center field",
  9: "right field",
};

// infield positions -> the spray chart's infield zones (see SprayChart.tsx)
const INFIELD_ZONES = { 1: 7, 2: 9, 3: 8, 4: 8, 5: 6, 6: 6 };

// home plate in gameday's hit coordinate space
const PLATE_X = 125.42;
const PLATE_Y = 198.27;

function outAction(eventType, trajectory) {
  if (!BATTED_OUTS.includes(eventType)) return null;
  if (trajectory === "ground_ball" || trajectory === "bunt_grounder") return "ground out";
  if (trajectory) return "fly out";
  return null;
}

// outfield balls are split into the chart's five outfield zones by spray angle
function fieldZone(hitData) {
  const position = Number(hitData?.location);
  if (INFIELD_ZONES[position]) return INFIELD_ZONES[position];

  const x = hitData?.coordinates?.coordX;
  const y = hitData?.coordinates?.coordY;
  if (typeof x !== "number" || typeof y !== "number") {
    return { 7: 1, 8: 3, 9: 5 }[position] ?? null;
  }

  // 0 is straight up the middle, negative is toward the left field line
  const angle = (Math.atan2(x - PLATE_X, PLATE_Y - y) * 180) / Math.PI;
  if (angle < -27) return 1;
  if (angle < -9) return 2;
  if (angle <= 9) return 3;
  if (angle <= 27) return 4;
  return 5;
}

// gameday sometimes splits one runner's trip into segments (1B->2B, 2B->3B),
// so collapse them into a single start/end per runner
function mergeRunners(entries) {
  const byRunner = new Map();
  for (const entry of entries) {
    const id = entry.details?.runner?.id ?? entry.details?.runner?.fullName;
    const movement = entry.movement ?? {};
    const existing = byRunner.get(id);
    if (!existing) {
      byRunner.set(id, {
        name: entry.details?.runner?.fullName ?? null,
        start: movement.start ?? null,
        end: movement.end ?? null,
        isOut: Boolean(movement.isOut),
        credits: [...(entry.credits ?? [])],
      });
    } else {
      existing.end = movement.end ?? existing.end;
      existing.isOut = existing.isOut || Boolean(movement.isOut);
      existing.credits.push(...(entry.credits ?? []));
    }
  }
  return [...byRunner.values()];
}

function fieldersInvolved(runners) {
  const fielders = [];
  for (const runner of runners) {
    for (const credit of runner.credits) {
      const position = credit.position?.abbreviation ?? credit.position?.code;
      if (position && !fielders.includes(position)) fielders.push(position);
    }
  }
  return fielders;
}

// runners already on base, in the {from, to, runner} shape the app uses. the
// batter is left out because applyPlayToState places them from the action
function labelRunners(runners) {
  return runners
    .filter((r) => BASE_KEYS[r.start] && (r.isOut || BASE_NAMES[r.end]))
    .map((r) => ({
      from: BASE_NAMES[r.start],
      to: r.isOut ? "out" : BASE_NAMES[r.end],
      runner: r.name,
    }));
}

function applyRunners(state, runners, half) {
  const next = {
    ...state,
    score: { ...state.score },
    runners: { ...state.runners },
  };

  // clear every starting base first so a runner moving up into a base another
  // runner just left isn't wiped out
  for (const r of runners) {
    const from = BASE_KEYS[r.start];
    if (from && next.runners[from] === r.name) next.runners[from] = null;
  }
  for (const r of runners) {
    if (r.isOut) {
      next.outs += 1;
    } else if (r.end === "score") {
      next.score[half === "top" ? "away" : "home"] += 1;
    } else if (BASE_KEYS[r.end]) {
      next.runners[BASE_KEYS[r.end]] = r.name;
    }
  }
  return next;
}

function countBefore(playEvents, index) {
  for (let i = index - 1; i >= 0; i--) {
    const count = playEvents[i]?.count;
    if (playEvents[i]?.isPitch && count) return `${count.balls}-${count.strikes}`;
  }
  return "0-0";
}

function snapshot(state) {
  return {
    ...state,
    score: { ...state.score },
    runners: { ...state.runners },
  };
}

function basePlay(allPlay, half) {
  return {
    inning: allPlay.about.inning,
    half,
    batter: allPlay.matchup?.batter?.fullName ?? null,
    pitcher: allPlay.matchup?.pitcher?.fullName ?? null,
  };
}

function atBatLabel(allPlay, half, runners) {
  const result = allPlay.result;
  const playEvents = allPlay.playEvents ?? [];
  const hitEvent = [...playEvents].reverse().find((e) => e.hitData);
  const hitData = hitEvent?.hitData;
  const action =
    AT_BAT_ACTIONS[result.eventType] ?? outAction(result.eventType, hitData?.trajectory);
  if (!action) return null;

  const lastPitchIndex = playEvents.map((e) => Boolean(e.isPitch)).lastIndexOf(true);
  const lastPitch = playEvents[lastPitchIndex];

  return {
    ...basePlay(allPlay, half),
    action,
    description: result.description,
    runners: labelRunners(runners),
    rbi: result.rbi ?? 0,
    outs_recorded: runners.filter((r) => r.isOut).length,
    fielders_involved: fieldersInvolved(runners),
    hit_location: POSITION_NAMES[Number(hitData?.location)] ?? null,
    hit_type: HIT_TYPES[hitData?.trajectory] ?? null,
    hit_hardness: hitData?.hardness ?? null,
    field_zone: hitData ? fieldZone(hitData) : null,
    pitch_type: lastPitch?.details?.type?.description ?? null,
    pitch_location: null,
    count: lastPitchIndex >= 0 ? countBefore(playEvents, lastPitchIndex) : null,
    confidence: "high",
  };
}

function runnerEventLabel(allPlay, half, event, index, runners) {
  const action = RUNNER_ACTIONS[event?.details?.eventType];
  if (!action) return null;

  return {
    ...basePlay(allPlay, half),
    action,
    description: event.details.description,
    runners: labelRunners(runners),
    rbi: 0,
    outs_recorded: runners.filter((r) => r.isOut).length,
    fielders_involved: fieldersInvolved(runners),
    hit_location: null,
    hit_type: null,
    hit_hardness: null,
    field_zone: null,
    pitch_type: null,
    pitch_location: null,
    count: countBefore(allPlay.playEvents ?? [], index),
    confidence: "high",
  };
}

// walks a whole game in order, tracking outs/score/bases so every play comes
// with the game state a scorekeeper would have been looking at before it.
// extra innings are skipped since the automatic runner on 2nd never shows up
// in the movement data and would throw the tracked bases off
export function extractPlays(feed, { maxInning = 9 } = {}) {
  const gamePk = feed.gamePk ?? feed.gameData?.game?.pk;
  const gameDate = feed.gameData?.datetime?.officialDate ?? null;
  const allPlays = feed.liveData?.plays?.allPlays ?? [];

  const records = [];
  let state = null;

  for (const allPlay of allPlays) {
    const { inning } = allPlay.about;
    const half = allPlay.about.isTopInning ? "top" : "bottom";
    if (inning > maxInning) break;

    // new half inning: bases clear and outs reset, the score carries over
    if (!state || state.inning !== inning || state.half !== half) {
      state = {
        inning,
        half,
        outs: 0,
        score: state ? state.score : { away: 0, home: 0 },
        runners: { first: null, second: null, third: null },
      };
    }

    // group runner movements by the playEvent that caused them. the last
    // group is the plate appearance's result, anything earlier happened mid at-bat
    const groups = new Map();
    for (const entry of allPlay.runners ?? []) {
      const index = entry.details?.playIndex ?? -1;
      if (!groups.has(index)) groups.set(index, []);
      groups.get(index).push(entry);
    }
    const indexes = [...groups.keys()].sort((a, b) => a - b);
    const resultIndex = indexes.length > 0 ? indexes[indexes.length - 1] : null;

    for (const index of indexes) {
      if (index === resultIndex) continue;
      const runners = mergeRunners(groups.get(index));
      const event = allPlay.playEvents?.[index];
      const label = runnerEventLabel(allPlay, half, event, index, runners);
      if (label) {
        records.push({
          id: `${gamePk}-${allPlay.about.atBatIndex}-${index}`,
          game_pk: gamePk,
          game_date: gameDate,
          gameday_event: event.details.eventType,
          game_state: snapshot(state),
          label,
        });
      }
      state = applyRunners(state, runners, half);
    }

    const runners = resultIndex === null ? [] : mergeRunners(groups.get(resultIndex));
    const label = atBatLabel(allPlay, half, runners);
    if (label) {
      records.push({
        id: `${gamePk}-${allPlay.about.atBatIndex}`,
        game_pk: gamePk,
        game_date: gameDate,
        gameday_event: allPlay.result.eventType,
        game_state: snapshot(state),
        label,
      });
    }
    state = applyRunners(state, runners, half);

    // trust gameday's own totals over our tracking so one odd play can't
    // snowball through the rest of the game
    if (typeof allPlay.count?.outs === "number") state.outs = allPlay.count.outs;
    if (typeof allPlay.result?.awayScore === "number") {
      state.score = { away: allPlay.result.awayScore, home: allPlay.result.homeScore };
    }
  }

  return records;
}

// plain-english version of the game state for the reading sheet, so whoever
// records the play knows the situation they're calling it in
export function describeSituation(gameState) {
  const { inning, half, outs, score, runners } = gameState;
  const occupied = [
    runners.first && "1st",
    runners.second && "2nd",
    runners.third && "3rd",
  ].filter(Boolean);
  const bases = occupied.length === 0 ? "bases empty" : `runners on ${occupied.join(", ")}`;
  const halfName = half === "top" ? "Top" : "Bottom";
  return `${halfName} ${inning}, ${outs} out, ${bases}, away ${score.away} - home ${score.home}`;
}

// small seeded rng (mulberry32) so the same seed always picks the same plays
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(items, random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// real games are mostly outs and singles, so a straight random sample would
// leave balks and triples with a handful of examples. this takes plays round
// robin across actions until it has enough, so rare actions get everything we
// found and common ones fill the rest
export function sampleByAction(records, count, random) {
  const buckets = new Map();
  for (const record of shuffle(records, random)) {
    const action = record.label.action;
    if (!buckets.has(action)) buckets.set(action, []);
    buckets.get(action).push(record);
  }

  const picked = [];
  while (picked.length < count && buckets.size > 0) {
    for (const [action, bucket] of buckets) {
      if (picked.length >= count) break;
      picked.push(bucket.pop());
      if (bucket.length === 0) buckets.delete(action);
    }
  }
  return picked;
}