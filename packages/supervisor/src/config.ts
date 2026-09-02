import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export interface SupervisorOptions {
  dataDir: string;
  port: number;
  token: string;
}

export function defaultDataDir(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Standbye");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? os.homedir(), "Standbye");
  }
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "standbye");
}

export function parseArgs(argv: string[]): SupervisorOptions {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const dataDir = get("--data") ?? process.env.CREW_DATA_DIR ?? defaultDataDir();
  const port = Number(get("--port") ?? process.env.CREW_PORT ?? 47311);
  const token = get("--token") ?? process.env.CREW_TOKEN ?? "dev";
  fs.mkdirSync(dataDir, { recursive: true });
  return { dataDir, port, token };
}

export const DEFAULTS = {
  heartbeatMinutes: 30,
  workHours: { start: "08:00", end: "22:00" },
  agentDailyUsd: 3,
  agentPerRunUsd: 2,
  teamDailyCapUsd: 10,
  chatDepthCap: 6,
  maxTurns: 60,
  approvalTimeoutMinutes: 20,
  questionDefaultMinutes: 120,
  maxConcurrentRuns: 3,
  /** A full run is stopped after this long; check-ins much sooner. */
  runTimeoutMinutes: 20,
  checkinTimeoutMinutes: 4,
};
