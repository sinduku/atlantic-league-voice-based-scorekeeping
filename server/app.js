// The Express app, kept apart from index.js so tests can run it against a fake
// AI provider. index.js reads the settings, starts it and shuts it down.
const { randomUUID } = require("node:crypto");
const express = require("express");
const cors = require("cors");
const { validatePlay } = require("./validatePlay");
const { buildStaticPrompt, buildSystemPrompt } = require("./prompt");

// a play is ~60-120 tokens once unknown keys are left out
const MAX_TOKENS = 350;
// at most: the main model, one retry with the problem explained, the fallback
const MAX_ATTEMPTS = 3;
// with less time left than this, another call can't finish, so don't start one
const MIN_ATTEMPT_MS = 750;
// names sent as game context; enough for both lineups' regulars
const MAX_CONTEXT_PLAYERS = 25;
const MAX_NAME_LENGTH = 60;

const TIMEOUT_ERROR = "The AI took too long to answer. Try again.";
const RATE_LIMIT_ERROR = "The AI provider is rate limiting us, try again in a moment.";

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

// a name from the browser, on one line and of a sane length, or undefined.
// it goes into the system prompt, so nothing multi-line gets through
function cleanName(value) {
  if (typeof value !== "string") return undefined;
  const name = value.replace(/\s+/g, " ").trim();
  return name && name.length <= MAX_NAME_LENGTH ? name : undefined;
}

// the optional `context` the browser sends alongside the game state. anything
// malformed is dropped rather than rejected: context only helps, a play
// parses without it
function parseContext(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const seen = new Set();
  const players = [];
  for (const value of Array.isArray(raw.players) ? raw.players : []) {
    const name = cleanName(value);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    players.push(name);
    if (players.length === MAX_CONTEXT_PLAYERS) break;
  }
  return {
    battingTeam: cleanName(raw.battingTeam),
    fieldingTeam: cleanName(raw.fieldingTeam),
    pitcher: cleanName(raw.pitcher),
    // the lineup's batter due up, so "he singles" has a name
    batter: cleanName(raw.batter),
    players,
  };
}

function createApp({ config, logger, fetch: fetchImpl = globalThis.fetch }) {
  const app = express();
  // the request id header is readable from the browser, for matching a
  // failed play to its log line
  app.use(cors({ exposedHeaders: ["X-Request-Id"] }));
  app.use(express.json());

  // every request gets an id, logged with each line it writes and sent back
  // in the X-Request-Id header and the JSON body
  app.use((req, res, next) => {
    const incoming = req.get("x-request-id");
    req.id = incoming && /^[\w-]{1,64}$/.test(incoming) ? incoming : randomUUID();
    req.log = logger.child({ reqId: req.id });
    res.set("X-Request-Id", req.id);
    next();
  });

  // the prompt's fixed part never changes between requests, so build it once
  const STATIC_PROMPT = buildStaticPrompt(config.FEWSHOT_EXAMPLES);
  app.locals.promptTokens = Math.round(STATIC_PROMPT.length / 4);

  const authHeaders = { Authorization: `Bearer ${config.OPENAI_API_KEY}` };

  function callModel(model, messages, timeoutMs) {
    const body = { model, messages, max_tokens: MAX_TOKENS, temperature: 0 };
    if (config.AI_JSON_MODE) body.response_format = { type: "json_object" };
    if (config.AI_REASONING_EFFORT) body.reasoning_effort = config.AI_REASONING_EFFORT;

    return fetchImpl(`${config.AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  // turns one successful HTTP reply into a play, or says what was wrong with
  // it: `problem` is fed back to the model on a retry, `error` goes to the scorer
  async function readReply(response) {
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      return { problem: "the reply was empty", status: 500, error: "No content returned from AI" };
    }

    let raw;
    try {
      raw = extractJson(content);
    } catch {
      return { content, problem: "it was not valid JSON", status: 500, error: "Could not parse AI response as JSON" };
    }

    // rejects a bad play or patches a play with missing fields
    const result = validatePlay(raw);
    if (!result.ok) {
      return {
        content,
        problem: `it is not a usable play (${result.reason})`,
        status: 422,
        error: "AI response didn't include a valid play. Try rephrasing.",
      };
    }
    return { content, play: result.play, patched: result.patched, usage: data.usage };
  }

  // Gets one play out of the model within the deadline. In order of preference:
  //   - the main model's answer
  //   - an unusable answer (bad JSON, no action) gets one retry on the same
  //     model with the problem spelled out; that's cheaper than the scorer
  //     saying the play again
  //   - a rate limit, outage, timeout or second unusable answer moves to
  //     the fallback model
  // Each call is capped at AI_ATTEMPT_TIMEOUT_MS so a hung model can't use up
  // the whole AI_TIMEOUT_MS budget and leave nothing for the fallback.
  async function parsePlay(systemPrompt, transcript, deadline, log) {
    const baseMessages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: transcript },
    ];
    let messages = baseMessages;
    let model = config.AI_MODEL;
    let fellBack = false;
    let retried = false;
    let failure = null;
    const attempts = [];

    const canFallBack = () => Boolean(config.AI_FALLBACK_MODEL) && !fellBack && config.AI_FALLBACK_MODEL !== model;
    const fallBack = (reason) => {
      log.warn({ model, fallback: config.AI_FALLBACK_MODEL, reason }, "trying the fallback model");
      model = config.AI_FALLBACK_MODEL;
      messages = baseMessages;
      fellBack = true;
    };

    while (attempts.length < MAX_ATTEMPTS) {
      const remaining = deadline - Date.now();
      if (remaining < MIN_ATTEMPT_MS) {
        failure ??= { status: 504, error: TIMEOUT_ERROR };
        break;
      }

      const attempt = { model, ms: 0, outcome: "" };
      attempts.push(attempt);
      const started = Date.now();
      try {
        const response = await callModel(model, messages, Math.min(remaining, config.AI_ATTEMPT_TIMEOUT_MS));

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          attempt.outcome = `http ${response.status}`;
          log.error({ model, status: response.status, body: text.slice(0, 500) }, "AI API error");
          failure = { status: response.status, error: response.status === 429 ? RATE_LIMIT_ERROR : "AI processing failed" };
          if ((response.status === 429 || response.status >= 500) && canFallBack()) {
            fallBack(attempt.outcome);
            continue;
          }
          break;
        }

        const reply = await readReply(response);
        if (reply.play) {
          attempt.outcome = "ok";
          return { ok: true, ...reply, model, attempts };
        }

        attempt.outcome = reply.problem;
        log.warn({ model, problem: reply.problem, content: reply.content?.slice(0, 500) }, "unusable reply from the model");
        failure = { status: reply.status, error: reply.error };
        if (!retried && reply.content) {
          retried = true;
          messages = [
            ...messages,
            { role: "assistant", content: reply.content },
            { role: "user", content: `That reply can't be scored: ${reply.problem}. Reply again with one JSON object only, following the rules above.` },
          ];
          continue;
        }
        if (canFallBack()) {
          fallBack(reply.problem);
          continue;
        }
        break;
      } catch (e) {
        const timedOut = e?.name === "TimeoutError";
        attempt.outcome = timedOut ? "timed out" : `failed: ${e?.message}`;
        // expected failures, so the reason is enough; a stack trace says nothing new
        log.warn({ model, error: e?.message, cause: e?.cause?.message }, timedOut ? "AI call timed out" : "AI call failed");
        failure = timedOut ? { status: 504, error: TIMEOUT_ERROR } : { status: 502, error: "Couldn't reach the AI provider. Try again." };
        if (canFallBack()) {
          fallBack(attempt.outcome);
          continue;
        }
        break;
      } finally {
        attempt.ms = Date.now() - started;
      }
    }

    return { ok: false, ...(failure ?? { status: 504, error: TIMEOUT_ERROR }), attempts };
  }

  app.post("/api/parse-play", async (req, res) => {
    const started = Date.now();
    const log = req.log;
    const { transcript, gameState, context } = req.body ?? {};

    if (!transcript) {
      return res.status(400).json({ error: "transcript is required", request_id: req.id });
    }

    try {
      const systemPrompt = buildSystemPrompt(STATIC_PROMPT, gameState, parseContext(context));
      const result = await parsePlay(systemPrompt, transcript, started + config.AI_TIMEOUT_MS, log);
      const totalMs = Date.now() - started;

      if (!result.ok) {
        log.error({ transcript, attempts: result.attempts, totalMs }, "could not parse play");
        return res.status(result.status).json({ error: result.error, request_id: req.id });
      }

      if (result.patched) {
        log.warn({ play: result.play }, "play had to be patched, forcing low confidence");
      }

      const modelMs = result.attempts.reduce((sum, a) => sum + a.ms, 0);
      const tokens = result.usage ? `${result.usage.prompt_tokens}+${result.usage.completion_tokens}` : undefined;
      log.info(
        { transcript, model: result.model, totalMs, modelMs, tokens, attempts: result.attempts.length > 1 ? result.attempts : undefined },
        `parsed in ${totalMs}ms`
      );

      return res.json({
        play: result.play,
        patched: result.patched,
        timing: { model: result.model, model_ms: modelMs, total_ms: totalMs, attempts: result.attempts.length },
        request_id: req.id,
      });
    } catch (e) {
      log.error({ err: e, transcript }, "parse-play error");
      return res.status(500).json({ error: e.message || "Unknown error", request_id: req.id });
    }
  });

  // /api/health answers right away. /api/health?deep=1 also asks the provider
  // for its model list, which catches a wrong key or an unreachable base URL;
  // point a host's health check at that
  app.get("/api/health", async (req, res) => {
    const body = { status: "ok", model: config.AI_MODEL, fallbackModel: config.AI_FALLBACK_MODEL || null, baseUrl: config.AI_BASE_URL };
    if (req.query.deep === undefined) return res.json(body);

    try {
      const response = await fetchImpl(`${config.AI_BASE_URL}/models`, {
        headers: authHeaders,
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) {
        req.log.warn({ status: response.status }, "health check: provider refused");
        return res.status(503).json({ ...body, status: "degraded", provider: `answered ${response.status}` });
      }
      return res.json({ ...body, provider: "ok" });
    } catch (e) {
      req.log.warn({ error: e?.message, cause: e?.cause?.message }, "health check: provider unreachable");
      return res.status(503).json({ ...body, status: "degraded", provider: "unreachable" });
    }
  });

  return app;
}

module.exports = { createApp, parseContext, extractJson };
