const test = require("node:test");
const assert = require("node:assert");

const { readConfig } = require("./config.js");
const { DEFAULT_FEWSHOT } = require("./prompt.js");

test("only the key is required; everything else has a default", () => {
  const { ok, config } = readConfig({ OPENAI_API_KEY: "k" });
  assert.equal(ok, true);
  assert.equal(config.AI_BASE_URL, "https://api.openai.com/v1");
  assert.equal(config.AI_MODEL, "gpt-4o-mini");
  assert.equal(config.AI_FALLBACK_MODEL, "");
  assert.equal(config.AI_JSON_MODE, true);
  assert.equal(config.AI_TIMEOUT_MS, 8000);
  assert.equal(config.FEWSHOT_EXAMPLES, DEFAULT_FEWSHOT);
  assert.equal(config.PORT, 3001);
});

test("blank lines in .env count as not set", () => {
  const { config } = readConfig({ OPENAI_API_KEY: "k", AI_REASONING_EFFORT: "", AI_TIMEOUT_MS: "", AI_FALLBACK_MODEL: "" });
  assert.equal(config.AI_REASONING_EFFORT, "");
  assert.equal(config.AI_TIMEOUT_MS, 8000);
});

test("values from .env are converted and tidied", () => {
  const { config } = readConfig({
    OPENAI_API_KEY: "k",
    AI_BASE_URL: "http://localhost:11434/v1/",
    AI_JSON_MODE: "false",
    AI_TIMEOUT_MS: "6000",
    FEWSHOT_EXAMPLES: "0",
  });
  assert.equal(config.AI_BASE_URL, "http://localhost:11434/v1");
  assert.equal(config.AI_JSON_MODE, false);
  assert.equal(config.AI_TIMEOUT_MS, 6000);
  assert.equal(config.FEWSHOT_EXAMPLES, 0);
});

test("bad settings are refused with the name of each one", () => {
  const result = readConfig({ AI_BASE_URL: "api.groq.com", AI_TIMEOUT_MS: "8s", AI_JSON_MODE: "maybe" });
  assert.equal(result.ok, false);
  const names = result.errors.map((e) => e.split(":")[0]);
  assert.deepEqual(names.sort(), ["AI_BASE_URL", "AI_JSON_MODE", "AI_TIMEOUT_MS", "OPENAI_API_KEY"]);
});

test("one call can't be given longer than the whole request", () => {
  const result = readConfig({ OPENAI_API_KEY: "k", AI_TIMEOUT_MS: "3000", AI_ATTEMPT_TIMEOUT_MS: "5000" });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /^AI_ATTEMPT_TIMEOUT_MS/);
});
