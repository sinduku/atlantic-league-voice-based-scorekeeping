
// validates and repairs a "play" object parsed from the LLM's JSON response.
// Returns one of:
//   { ok: false, reason }              -> unusable, caller should reject
//   { ok: true, play, patched: false } -> valid as-is
//   { ok: true, play, patched: true }  -> some fields were missing/wrong type, so we filled in safe defaults
function validatePlay(raw) {
// guard against non-object input (null, array, string, etc.)
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "not an object" };
  }

  // hard requirements to run scoring
  if (typeof raw.action !== "string" || !raw.action.trim()) {
    return { ok: false, reason: "missing action" };
  }
  if (typeof raw.description !== "string" || !raw.description.trim()) {
    return { ok: false, reason: "missing description" };
  }
  // tracks if we had to substitute any default values
  // if so, confidence = "low" and we flag for the caller 
  let patched = false;
  // if the values is valid, return it
  // otherwise, returns a fallback value
  const num = (v, fallback) => {
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    patched = true;
    return fallback;
  };
  const strArray = (v) => {
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v;
    patched = true;
    return [];
  };
  // checks that the play contains "from" and "to" 
  const runnerArray = (v) => {
    if (
      Array.isArray(v) &&
      v.every((r) => r && typeof r.from === "string" && typeof r.to === "string")
    ) {
      return v;
    }
    patched = true;
    return [];
  };
  // checks that the confidence is an expected value, otherwise defaults to "low"
  const confidence = ["high", "medium", "low"].includes(raw.confidence)
    ? raw.confidence
    : (patched = true, "low");
  // constructs the final play object
  const play = {
    inning: typeof raw.inning === "number" ? raw.inning : null,
    half: raw.half === "top" || raw.half === "bottom" ? raw.half : null,
    batter: typeof raw.batter === "string" ? raw.batter : null,
    pitcher: typeof raw.pitcher === "string" ? raw.pitcher : null,
    action: raw.action,
    description: raw.description,
    runners: runnerArray(raw.runners),
    rbi: num(raw.rbi, 0),
    outs_recorded: num(raw.outs_recorded, 0),
    fielders_involved: strArray(raw.fielders_involved),
    hit_location: typeof raw.hit_location === "string" ? raw.hit_location : null,
    hit_type: typeof raw.hit_type === "string" ? raw.hit_type : null,
    hit_hardness: typeof raw.hit_hardness === "string" ? raw.hit_hardness : null,
    field_zone: typeof raw.field_zone === "number" ? raw.field_zone : null,
    pitch_type: typeof raw.pitch_type === "string" ? raw.pitch_type : null,
    pitch_location: typeof raw.pitch_location === "string" ? raw.pitch_location : null,
    count: typeof raw.count === "string" ? raw.count : null,
    // if we patched, we set confidence to low 
    confidence: patched ? "low" : confidence,
  };

  return { ok: true, play, patched };
}

module.exports = { validatePlay };