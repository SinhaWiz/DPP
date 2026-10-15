export interface Logger {
  debug(msg: string, extra?: unknown): void;
  info(msg: string, extra?: unknown): void;
  warn(msg: string, extra?: unknown): void;
  error(msg: string, extra?: unknown): void;
}

const LEVELS = ["debug", "info", "warn", "error"] as const;

/** Minimal leveled console logger, so core modules don't depend on the web framework. */
export function createLogger(level: string = "info"): Logger {
  const min = level === "silent" ? 99 : Math.max(0, LEVELS.indexOf(level as (typeof LEVELS)[number]));
  const make = (name: (typeof LEVELS)[number], i: number) => (msg: string, extra?: unknown) => {
    if (i < min) return;
    const line = `${new Date().toISOString()} ${name.toUpperCase().padEnd(5)} ${msg}`;
    (name === "error" ? console.error : name === "warn" ? console.warn : console.log)(line, ...(extra === undefined ? [] : [extra]));
  };
  return {
    debug: make("debug", 0),
    info: make("info", 1),
    warn: make("warn", 2),
    error: make("error", 3),
  };
}

export const silentLogger: Logger = createLogger("silent");
