require("dotenv").config();
const { validatePlay } = require("./validatePlay");
const { DEFAULT_FEWSHOT, buildStaticPrompt, buildSystemPrompt } = require("./prompt");
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const {
  OPENAI_API_KEY,
  // defaults match the original setup so an existing .env keeps working;
  // .env.example points at Groq's free tier, which answers much faster
  AI_BASE_URL = "https://api.openai.com/v1",
  AI_MODEL = "gpt-4o-mini",
  // tried once when the main model is rate limited or down. free tiers cap
  // requests per minute and per day, so a smaller model keeps the game going
  AI_FALLBACK_MODEL = "",
  // ask the provider for guaranteed JSON. every provider in .env.example
  // supports it; set to false for one that rejects response_format
  AI_JSON_MODE = "true",
  // only for reasoning models (gpt-5*, o*, gpt-oss). "minimal" or "low" keeps
  // them from thinking for seconds about a ground out
  AI_REASONING_EFFORT = "",
  AI_TIMEOUT_MS = 8000,
  PORT = 3001,
  FEWSHOT_EXAMPLES = DEFAULT_FEWSHOT,
} = process.env;

if (!OPENAI_API_KEY) {
  console.error("ERROR: OPENAI_API_KEY is not set. Copy .env.example to .env and add your key.");
  process.exit(1);
}

// the prompt's fixed part never changes between requests, so build it once
const fewShot = Number(FEWSHOT_EXAMPLES);
const STATIC_PROMPT = buildStaticPrompt(Number.isFinite(fewShot) ? fewShot : DEFAULT_FEWSHOT);

async function callModel(model, systemPrompt, transcript) {
  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: transcript },
    ],
    // a play is ~60-120 tokens once unknown keys are left out
    max_tokens: 350,
    temperature: 0,
  };
  if (AI_JSON_MODE !== "false") body.response_format = { type: "json_object" };
  if (AI_REASONING_EFFORT) body.reasoning_effort = AI_REASONING_EFFORT;

  return fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(AI_TIMEOUT_MS) || 8000),
  });
}

// pulls the JSON object out of a reply, tolerating code fences and chatter
// from models that ignore JSON mode
function extractJson(content) {
  const cleaned = content
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .replace(/^[\s\S]*?({[\s\S]*})[\s\S]*$/, "$1")
    .trim();
  return JSON.parse(cleaned);
}

app.post("/api/parse-play", async (req, res) => {
  const started = Date.now();

  try {
    const { transcript, gameState } = req.body;

    if (!transcript) {
      return res.status(400).json({ error: "transcript is required" });
    }

    const systemPrompt = buildSystemPrompt(STATIC_PROMPT, gameState);

    let model = AI_MODEL;
    let response;
    try {
      response = await callModel(model, systemPrompt, transcript);
    } catch (e) {
      if (!AI_FALLBACK_MODEL) throw e;
      console.warn(`${model} failed (${e.message}), trying ${AI_FALLBACK_MODEL}`);
    }
    if (AI_FALLBACK_MODEL && (!response || response.status === 429 || response.status >= 500)) {
      if (response) console.warn(`${model} answered ${response.status}, trying ${AI_FALLBACK_MODEL}`);
      model = AI_FALLBACK_MODEL;
      response = await callModel(model, systemPrompt, transcript);
    }
    const modelMs = Date.now() - started;

    if (!response.ok) {
      const text = await response.text();
      console.error("AI API error:", response.status, text);
      const error = response.status === 429 ? "The AI provider is rate limiting us, try again in a moment." : "AI processing failed";
      return res.status(response.status).json({ error });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error("No content in response:", JSON.stringify(data));
      return res.status(500).json({ error: "No content returned from AI" });
    }

    let rawPlay;
    try {
      rawPlay = extractJson(content);
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr, "Raw content:", content);
      return res.status(500).json({ error: "Could not parse AI response as JSON" });
    }

    // rejects a bad play or patches a play with missing fields
    const result = validatePlay(rawPlay);
    if (!result.ok) {
      console.error("Play failed validation:", result.reason, "Raw:", rawPlay);
      return res.status(422).json({ error: "AI response didn't include a valid play. Try rephrasing." });
    }

    if (result.patched) {
      console.warn("Play had to be patched, forcing low confidence:", result.play);
    }

    const totalMs = Date.now() - started;
    const usage = data.usage ? ` ${data.usage.prompt_tokens}+${data.usage.completion_tokens} tokens` : "";
    console.log(`parsed in ${totalMs}ms (model ${modelMs}ms, ${model}${usage}): "${transcript}"`);

    return res.json({
      play: result.play,
      patched: result.patched,
      timing: { model, model_ms: modelMs, total_ms: totalMs },
    });
  } catch (e) {
    if (e.name === "TimeoutError") {
      console.error(`AI call timed out after ${AI_TIMEOUT_MS}ms`);
      return res.status(504).json({ error: "The AI took too long to answer. Try again." });
    }
    console.error("parse-play error:", e);
    return res.status(500).json({ error: e.message || "Unknown error" });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", model: AI_MODEL, fallbackModel: AI_FALLBACK_MODEL || null, baseUrl: AI_BASE_URL });
});

app.listen(PORT, () => {
  console.log(`\n🎙️  Voice Scorekeeper API running on http://localhost:${PORT}`);
  console.log(`   Model: ${AI_MODEL}${AI_FALLBACK_MODEL ? ` (fallback ${AI_FALLBACK_MODEL})` : ""}`);
  console.log(`   API:   ${AI_BASE_URL}`);
  console.log(`   Prompt: ~${Math.round(STATIC_PROMPT.length / 4)} tokens\n`);
});
