import type { GameState, Play } from "@/types/game";
import { zoneFor } from "@/lib/normalizePlay";

// Scores pure scorekeeping shorthand in the browser, with no network call:
// "6-4-3 double play", "E5", "F8", "K looking", "ball four", "HBP". These are
// the most common things a scorekeeper says and the model adds nothing but a
// second of waiting to them. Anything with more in it (a name, a hit, a runner
// doing something) returns null and goes to the model as before.
//
// Runners not forced by the play are left where they are. The scorer still
// reviews every play before it counts, same as a parsed one.

const POSITION_NAMES: Record<string, string> = {
  "1": "pitcher",
  "2": "catcher",
  "3": "first base",
  "4": "second base",
  "5": "third base",
  "6": "shortstop",
  "7": "left field",
  "8": "center field",
  "9": "right field",
};

const NUMBER_WORDS: Record<string, string> = {
  one: "1",
  won: "1",
  two: "2",
  to: "2",
  too: "2",
  three: "3",
  four: "4",
  for: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  ate: "8",
  nine: "9",
};

// the recognizer writes the same spoken shorthand many ways: "6-4-3", "643",
// "6:43", "six four three", "6 for 3". All of them come out as "6 4 3"
export function normalizeShorthand(transcript: string): string {
  let s = transcript
    .toLowerCase()
    .replace(/[.,!?]+$/g, "")
    .replace(/(\d):(\d)/g, "$1$2")
    .replace(/[-–—/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = s.split(" ");
  const isDigit = (w?: string) => !!w && (/^[1-9]$/.test(w) || /^(one|two|three|four|five|six|seven|eight|nine)$/.test(w));
  // homophones only count as numbers between other numbers, so "fly out to 8"
  // keeps its "to" while "6 to 3" reads as 6-3
  s = words
    .map((w, i) => {
      if (/^(one|two|three|four|five|six|seven|eight|nine)$/.test(w)) return NUMBER_WORDS[w];
      if (w in NUMBER_WORDS && isDigit(words[i - 1]) && isDigit(words[i + 1])) return NUMBER_WORDS[w];
      return w;
    })
    .join(" ");

  // "643" -> "6 4 3", "e5" -> "e 5", "f8" -> "f 8"
  s = s.replace(/\b([efglpu])([1-9])\b/g, "$1 $2");
  s = s.replace(/\b[1-9]{2,3}\b/g, (m) => m.split("").join(" "));
  return s.replace(/\s+/g, " ").trim();
}

// batter to first, and each runner pushed along only if the base behind them
// is being taken. a run forced in from third counts as an rbi on a walk or hbp
function forcedAdvance(state: GameState) {
  const runners: Play["runners"] = [];
  const occupied = state.runners;
  let scored = 0;
  if (occupied.first) {
    if (occupied.second) {
      if (occupied.third) {
        runners.push({ from: "3rd", to: "home", runner: occupied.third });
        scored++;
      }
      runners.push({ from: "2nd", to: "3rd", runner: occupied.second });
    }
    runners.push({ from: "1st", to: "2nd", runner: occupied.first });
  }
  runners.push({ from: "home", to: "1st", runner: null });
  return { runners, scored };
}

function play(fields: Partial<Play> & Pick<Play, "action" | "description">, state: GameState): Play {
  return {
    inning: state.inning,
    half: state.half,
    batter: null,
    pitcher: null,
    runners: [],
    rbi: 0,
    outs_recorded: 0,
    fielders_involved: [],
    hit_location: null,
    hit_type: null,
    hit_hardness: null,
    field_zone: null,
    pitch_type: null,
    pitch_location: null,
    count: null,
    confidence: "high",
    ...fields,
  };
}

function ballInPlay(fielders: string[], hitType: string) {
  const hit_location = POSITION_NAMES[fielders[0]];
  return {
    fielders_involved: fielders,
    hit_location,
    hit_type: hitType,
    field_zone: zoneFor(hit_location, fielders),
  };
}

const batterOut = [{ from: "home", to: "out", runner: null }];

export function parseShorthand(transcript: string, state: GameState): Play | null {
  const s = normalizeShorthand(transcript);

  // strikeouts. "strike three" arrives here as "strike 3"
  let m = s.match(
    /^(?:k|strike ?out|struck out|strike 3|punch(?:ed)? out|backwards k|called strike 3|rung up|caught looking)(?: (looking|swinging))?$/
  );
  if (m) {
    const looking = m[1] === "looking" || /^(?:backwards|called|rung|caught)/.test(s);
    return play(
      {
        action: "strikeout",
        description: looking ? "Called strike three, batter caught looking" : "Strikeout swinging",
        runners: batterOut,
        outs_recorded: 1,
        fielders_involved: ["1", "2"],
      },
      state
    );
  }

  // walks and hit batsmen push runners along only where forced
  const hbp = /^(?:hbp|hit by (?:a |the )?pitch|hit batter|plunked|drilled|beaned)$/.test(s);
  if (hbp || /^(?:bb|walk|walks|ball 4|base on balls|free pass|ibb|intentional walk)$/.test(s)) {
    const { runners, scored } = forcedAdvance(state);
    return play(
      {
        action: hbp ? "hit by pitch" : "walk",
        description: hbp ? "Batter hit by the pitch, takes first base" : "Batter walks",
        runners,
        rbi: scored,
      },
      state
    );
  }

  // E5, "error 5", "error on the 5"
  m = s.match(/^(?:e|error)(?: on)?(?: the)? ([1-9])$/);
  if (m) {
    const { runners } = forcedAdvance(state);
    const fielder = m[1];
    return play(
      {
        action: "error",
        description: `Error on the ${POSITION_NAMES[fielder].replace(/ base$/, " baseman").replace(/ field$/, " fielder")}, batter safe at first`,
        runners,
        ...ballInPlay([fielder], "ground ball"),
      },
      state
    );
  }

  // F8 / L7 / P4: caught in the air by that fielder
  m = s.match(/^(f|l|p|fly out|flies out|flied out|line out|lined out|pop out|popped out|pop up|popped up)(?: to)?(?: the)? ([1-9])$/);
  if (m) {
    const kind = m[1][0];
    const hitType = kind === "l" ? "line drive" : kind === "p" ? "pop up" : "fly ball";
    const fielder = m[2];
    return play(
      {
        action: "fly out",
        description: `${hitType === "line drive" ? "Line out" : hitType === "pop up" ? "Pop out" : "Fly out"} to ${POSITION_NAMES[fielder]}`,
        runners: batterOut,
        outs_recorded: 1,
        ...ballInPlay([fielder], hitType),
      },
      state
    );
  }

  // U3: unassisted ground out. G6: ground ball to that fielder, thrown to first
  m = s.match(/^(u|g|unassisted|ground out|grounds out|grounded out)(?: to)?(?: the)? ([1-9])$/);
  if (m) {
    const fielder = m[2];
    const unassisted = m[1] === "u" || m[1] === "unassisted" || fielder === "3";
    const fielders = unassisted ? [fielder] : [fielder, "3"];
    return play(
      {
        action: "ground out",
        description: unassisted
          ? `Ground out, unassisted by the ${POSITION_NAMES[fielder]}`
          : `Ground out, ${fielders.join("-")}`,
        runners: batterOut,
        outs_recorded: 1,
        ...ballInPlay(fielders, "ground ball"),
      },
      state
    );
  }

  // "6 3", "6 4 3 double play", "4 6 3 dp", optionally "ground out 6 3"
  m = s.match(/^(?:ground(?:s|ed)? (?:out|ball) |grounder )?([1-9](?: [1-9]){1,2})(?: (dp|double play|gidp|ground(?:ed)? into (?:a )?double play))?$/);
  if (m) {
    const fielders = m[1].split(" ");
    const doublePlay = !!m[2] || fielders.length === 3;
    if (!doublePlay) {
      return play(
        {
          action: "ground out",
          description: `Ground out, ${fielders.join("-")}`,
          runners: batterOut,
          outs_recorded: 1,
          ...ballInPlay(fielders, "ground ball"),
        },
        state
      );
    }
    // the textbook double play needs a runner on first and fewer than two outs;
    // anything else is unusual enough to hand to the model
    if (!state.runners.first || state.outs >= 2 || fielders.length !== 3) return null;
    return play(
      {
        action: "ground out",
        description: `Ground ball, ${fielders.join("-")} double play`,
        runners: [
          { from: "1st", to: "out", runner: state.runners.first },
          { from: "home", to: "out", runner: null },
        ],
        outs_recorded: 2,
        ...ballInPlay(fielders, "ground ball"),
      },
      state
    );
  }

  return null;
}
