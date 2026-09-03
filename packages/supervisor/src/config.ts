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
  /**
   * Replies in a direct chat run above that cap. Being answered should never wait on the team's
   * work capacity — three long runs used to leave a "hello" queued indefinitely.
   */
  maxConcurrentReplies: 2,
  /**
   * Ceiling on how often one agent may wake in a rolling hour. Budgets cap the money, this caps
   * the churn: without it a pair of agents can answer each other indefinitely on a cheap model.
   * The owner's own messages are never refused by it.
   */
  maxRunsPerHour: 15,
  /** A full run is stopped after this long; check-ins much sooner. */
  runTimeoutMinutes: 20,
  checkinTimeoutMinutes: 4,
};
