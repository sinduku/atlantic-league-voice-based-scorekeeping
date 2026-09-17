
// validates and repairs a "play" object parsed from the LLM's JSON response
// using zod schemas. Returns one of:
//   { ok: false, reason }              -> unusable, caller should reject
//   { ok: true, play, patched: false } -> valid as-is
//   { ok: true, play, patched: true }  -> some fields were missing/wrong type, so we filled in safe defaults
const { z } = require("zod");

// hard requirements to run scoring - no fallback for these, reject the play
const requiredSchema = z.object({
  action: z.string().refine((s) => s.trim().length > 0, "empty action"),
  description: z.string().refine((s) => s.trim().length > 0, "empty description"),
});

// builds the full play schema. two kinds of fallback:
//   soft()  -> bad/missing value becomes null, no flag raised
//   patch() -> bad/missing value becomes a safe default and marks the play as patched,
//              which forces confidence to "low" so the scorer knows to double-check
function buildPlaySchema(markPatched) {
  const soft = (schema) => schema.nullable().catch(null);
  const patch = (schema, fallback) =>
    schema.catch(() => {
      markPatched();
      return fallback;
    });

  return z.object({
    inning: soft(z.number()),
    half: soft(z.enum(["top", "bottom"])),
    batter: soft(z.string()),
    pitcher: soft(z.string()),
    action: z.string(),
    description: z.string(),
    runners: patch(
      z.array(
        z.object({
          from: z.string(),
          to: z.string(),
          runner: soft(z.string()),
        })
      ),
      []
    ),
    rbi: patch(z.number(), 0),
    outs_recorded: patch(z.number(), 0),
    fielders_involved: patch(z.array(z.string()), []),
    hit_location: soft(z.string()),
    hit_type: soft(z.string()),
    hit_hardness: soft(z.string()),
    field_zone: soft(z.number()),
    pitch_type: soft(z.string()),
    pitch_location: soft(z.string()),
    count: soft(z.string()),
    confidence: patch(z.enum(["high", "medium", "low"]), "low"),
  });
}

function validatePlay(raw) {
  // guard against non-object input (null, array, string, etc.)
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "not an object" };
  }

  const required = requiredSchema.safeParse(raw);
  if (!required.success) {
    const field = required.error.issues[0]?.path[0] || "required field";
    return { ok: false, reason: `missing ${field}` };
  }

  // tracks if any patch() fallback fired while parsing
  let patched = false;
  const play = buildPlaySchema(() => {
    patched = true;
  }).parse(raw);

  // if we patched, we set confidence to low
  if (patched) {
    play.confidence = "low";
  }

  return { ok: true, play, patched };
}

module.exports = { validatePlay };
