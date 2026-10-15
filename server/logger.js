// Structured logs. At a terminal they're printed readably; anywhere else
// (a host's log viewer, a file) each line is one JSON object, so they can be
// searched by request id, model or transcript.
const pino = require("pino");

function createLogger({ level = "info", format = "" } = {}) {
  const pretty = format === "pretty" || (format === "" && process.stdout.isTTY);
  return pino({
    level,
    ...(pretty && {
      transport: {
        target: "pino-pretty",
        options: { ignore: "pid,hostname", translateTime: "SYS:HH:MM:ss" },
      },
    }),
  });
}

module.exports = { createLogger };
