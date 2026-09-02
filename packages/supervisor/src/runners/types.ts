import type { Agent, Run } from "@crew/shared";
import type { Crew } from "../crew.js";
import type { ToolContext } from "../tools/team-tools.js";

export interface RunnerInput {
  crew: Crew;
  agent: Agent;
  run: Run;
  mode: "full" | "checkin";
  model: string;
  system: string;
  prompt: string;
  ctx: ToolContext;
  cwd: string;
  signal: AbortSignal;
}

export interface RunnerOutput {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  /** Final assistant text, if any */
  text: string;
  error?: string;
}

export type Runner = (input: RunnerInput) => Promise<RunnerOutput>;
