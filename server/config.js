// Reads and checks the server's settings from the environment. A typo in .env
// (AI_TIMEOUT_MS=8s, a base URL without https://) used to fall back to a
// default without a word; now the server refuses to start and says which
// setting is wrong.
const { z } = require("zod");
const { DEFAULT_FEWSHOT } = require("./prompt");

const flag = z
  .enum(["true", "false", "1", "0", "yes", "no"])
  .transform((v) => v === "true" || v === "1" || v === "yes");

const MISSING_KEY = "is not set. Copy .env.example to .env and add your key";

const ms = (fallback) => z.coerce.number().int().min(500).max(60000).default(fallback);

const envSchema = z
  .object({
    OPENAI_API_KEY: z.string({ error: MISSING_KEY }).min(1, MISSING_KEY),
    // defaults match the original setup so an existing .env keeps working;
    // .env.example points at Groq's free tier, which answers much faster
    AI_BASE_URL: z
      .string()
      .url("must be a full URL such as https://api.groq.com/openai/v1")
      .default("https://api.openai.com/v1")
      .transform((url) => url.replace(/\/+$/, "")),
    AI_MODEL: z.string().min(1).default("gpt-4o-mini"),
    // tried when the main model is rate limited, down or too slow. free tiers
    // cap requests per minute and per day, so a smaller model keeps the game going
    AI_FALLBACK_MODEL: z.string().default(""),
    // ask the provider for guaranteed JSON. every provider in .env.example
    // supports it; set to false for one that rejects response_format
    AI_JSON_MODE: flag.default(true),
    // only for reasoning models (gpt-5*, o*, gpt-oss). "minimal" or "low" keeps
    // them from thinking for seconds about a ground out
    AI_REASONING_EFFORT: z.enum(["", "minimal", "low", "medium", "high"]).default(""),
    // the whole request, every retry included. stays under the browser's 10s
    // limit so the scorer gets the server's error rather than a bare timeout
    AI_TIMEOUT_MS: ms(8000),
    // one call to the model. shorter than the total so a hung main model still
    // leaves time for the fallback
    AI_ATTEMPT_TIMEOUT_MS: ms(5000),
    FEWSHOT_EXAMPLES: z.coerce.number().int().min(0).max(20).default(DEFAULT_FEWSHOT),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    // pretty prints logs for a person at a terminal; "json" is one object per
    // line for a host's log viewer. the default picks by whether stdout is a terminal
    LOG_FORMAT: z.enum(["", "pretty", "json"]).default(""),
  })
  .refine((c) => c.AI_ATTEMPT_TIMEOUT_MS <= c.AI_TIMEOUT_MS, {
    message: "must not be longer than AI_TIMEOUT_MS",
    path: ["AI_ATTEMPT_TIMEOUT_MS"],
  });

// blank lines in .env (AI_FALLBACK_MODEL=) mean "not set", same as leaving them out
function withoutBlanks(env) {
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => key === "AI_FALLBACK_MODEL" || value !== ""));
}

// returns { ok: true, config } or { ok: false, errors: ["AI_TIMEOUT_MS: ..."] }
function readConfig(env = process.env) {
  const parsed = envSchema.safeParse(withoutBlanks(env));
  if (parsed.success) return { ok: true, config: parsed.data };
  const errors = parsed.error.issues.map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`);
  return { ok: false, errors };
}

module.exports = { readConfig };
