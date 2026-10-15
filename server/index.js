require("dotenv").config();
const { readConfig } = require("./config");
const { createLogger } = require("./logger");
const { createApp } = require("./app");

const settings = readConfig();
if (!settings.ok) {
  console.error("ERROR: server/.env has settings the server can't use:");
  for (const error of settings.errors) console.error(`  - ${error}`);
  process.exit(1);
}
const config = settings.config;

const logger = createLogger({ level: config.LOG_LEVEL, format: config.LOG_FORMAT });
const app = createApp({ config, logger });

const server = app.listen(config.PORT, () => {
  logger.info(
    {
      model: config.AI_MODEL,
      fallbackModel: config.AI_FALLBACK_MODEL || undefined,
      baseUrl: config.AI_BASE_URL,
      promptTokens: app.locals.promptTokens,
    },
    `Voice Scorekeeper API running on http://localhost:${config.PORT}`
  );
});

server.on("error", (err) => {
  logger.fatal({ err }, err.code === "EADDRINUSE" ? `port ${config.PORT} is already in use` : "server failed to start");
  process.exit(1);
});

// a host restarting the server sends SIGTERM; Ctrl+C sends SIGINT. stop taking
// new requests and let the plays already being parsed finish, but no longer
// than one parse could take
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down, finishing requests in flight");

  server.close((err) => {
    if (err) logger.error({ err }, "error while closing the server");
    process.exit(err ? 1 : 0);
  });
  setTimeout(() => {
    logger.warn("requests still open, exiting anyway");
    process.exit(1);
  }, config.AI_TIMEOUT_MS + 1000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
