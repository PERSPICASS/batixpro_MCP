import { config } from "./config.js";

/**
 * Logs structurés JSON. Un `request_id` corrèle les traces MCP aux logs Laravel
 * (propagé via l'en-tête X-Request-Id). Le token n'est JAMAIS journalisé.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

function emit(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  if (LEVELS[level] < LEVELS[config.logLevel]) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...fields,
  });
  // stderr : n'interfère pas avec un éventuel transport stdio.
  process.stderr.write(line + "\n");
}

export const logger = {
  debug: (msg: string, f?: Record<string, unknown>) => emit("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit("error", msg, f),
};
