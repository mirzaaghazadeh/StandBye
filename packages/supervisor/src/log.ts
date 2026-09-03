import fs from "node:fs";
import path from "node:path";

/**
 * Timestamped logging to `<dataDir>/logs/supervisor.log`, mirrored to stderr so a
 * terminal-run supervisor still prints. The file rotates once to `.1` at ~5 MB, so a
 * long-running supervisor never eats the disk and yesterday's crash is still readable.
 *
 * Before initLog() (and if the file can't be opened) it degrades to stderr only.
 */

const MAX_BYTES = 5 * 1024 * 1024;

let stream: fs.WriteStream | null = null;
let logFile = "";
let bytes = 0;

export interface LogScope {
  /** agent id, e.g. "kai" */
  agent?: string;
  /** run id */
  run?: string;
  /** team id */
  team?: string;
}

export function initLog(dataDir: string): string | null {
  try {
    const dir = path.join(dataDir, "logs");
    fs.mkdirSync(dir, { recursive: true });
    logFile = path.join(dir, "supervisor.log");
    bytes = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
    rotateIfNeeded();
    open();
    return logFile;
  } catch (e) {
    process.stderr.write(`[crew] could not open log file: ${String(e)}\n`);
    stream = null;
    return null;
  }
}

function open(): void {
  stream = fs.createWriteStream(logFile, { flags: "a" });
  stream.on("error", (e) => {
    process.stderr.write(`[crew] log write failed: ${String(e)}\n`);
    stream = null;
  });
}

function rotateIfNeeded(): void {
  if (bytes < MAX_BYTES || !logFile) return;
  try {
    stream?.end();
    stream = null;
    fs.renameSync(logFile, logFile + ".1"); // keep exactly one previous file
    bytes = 0;
    open();
  } catch {
    bytes = 0; // don't retry every line if rotation is impossible
  }
}

function scopeText(scope?: LogScope): string {
  if (!scope) return "";
  const parts = [scope.team && `team=${scope.team}`, scope.agent && `agent=${scope.agent}`, scope.run && `run=${scope.run}`].filter(Boolean);
  return parts.length ? ` [${parts.join(" ")}]` : "";
}

function write(level: "info" | "warn" | "error", msg: string, scope?: LogScope): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)}${scopeText(scope)} ${msg}\n`;
  process.stderr.write(line);
  if (!stream) return;
  bytes += Buffer.byteLength(line);
  stream.write(line);
  rotateIfNeeded();
}

export function log(msg: string, scope?: LogScope): void {
  write("info", msg, scope);
}
export function warn(msg: string, scope?: LogScope): void {
  write("warn", msg, scope);
}
export function logError(msg: string, scope?: LogScope): void {
  write("error", msg, scope);
}

/** Flush before exit; the process may end before the stream drains otherwise. */
export function closeLog(): void {
  stream?.end();
  stream = null;
}

export function logPath(): string {
  return logFile;
}
