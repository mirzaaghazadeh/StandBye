import { APICallError, AISDKError } from "ai";
import type { Agent, ProviderConfig, ProviderSpec, Run } from "@crew/shared";
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
  /** The catalog entry for the agent's provider: endpoint, auth, CLI invocation. */
  spec: ProviderSpec;
  /** The owner's settings for it: models, base URL, region, CLI overrides. */
  config: ProviderConfig;
}

/**
 * Why a run failed, in terms the owner can act on. `auth` and `credit` mean the agent
 * cannot work at all until the owner fixes something; nothing pauses the agent today —
 * executeRun does not consume `failure` (owner decided 2026-09-03 to keep it that way).
 */
export type FailureKind =
  | "auth"       // missing, invalid or expired key / login
  | "credit"     // out of credit or quota
  | "rate_limit" // 429, retry later
  | "model"      // unknown or unavailable model id
  | "context"    // prompt too long for the model
  | "network"    // could not reach the provider
  | "timeout"    // provider or run timed out
  | "budget"     // our own per-run cap
  | "provider"   // provider-side error (5xx, overloaded)
  | "other";

export interface RunnerOutput {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  /** Input tokens served from the provider's cache rather than charged at full rate. */
  cachedTokens?: number;
  /** Final assistant text, if any */
  text: string;
  error?: string;
  failure?: FailureKind;
}

export type Runner = (input: RunnerInput) => Promise<RunnerOutput>;

export interface Failure {
  kind: FailureKind;
  /** One line the owner can act on, plus the original message for context. */
  text: string;
}

/** True when the failure means this agent cannot do anything until the owner intervenes. */
export function blocksAgent(kind: FailureKind | undefined): boolean {
  return kind === "auth" || kind === "credit";
}

/**
 * Turn whatever a provider threw into something a person can act on.
 *
 * `who` is the provider's display name from the catalog, so the advice names the thing the
 * owner recognises ("Groq is rate limiting this key") rather than an internal id.
 *
 * Shapes handled, verified against the installed SDKs:
 *  - AI SDK `APICallError` (statusCode, responseBody) and its siblings (`LoadAPIKeyError`,
 *    `NoSuchModelError`), used by the OpenAI-compatible runner.
 *  - Node network errors (`code` = ECONNREFUSED / ENOTFOUND / …), thrown by fetch under both.
 *  - Anthropic API error payloads passed through the Claude Code CLI as text
 *    (`authentication_error`, `rate_limit_error`, `not_found_error`, `request_too_large`, …).
 */
export function classifyFailure(e: unknown, who = "The provider"): Failure {
  const raw = errorText(e);
  const status = statusOf(e);
  const body = `${raw} ${bodyOf(e)}`.toLowerCase();

  const has = (...needles: string[]) => needles.some((n) => body.includes(n));

  // Our own abort, surfaced by the AI SDK / fetch as an AbortError.
  if (name(e) === "AbortError" || has("aborted", "the operation was aborted")) return { kind: "timeout", text: "Stopped before the model finished." };

  // Network: the request never reached the provider.
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code === "string" && ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "EPIPE", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) {
    return { kind: code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" ? "timeout" : "network", text: `Could not reach ${who} (${code}). Check this Mac's internet connection.` };
  }
  if (has("fetch failed", "network error", "getaddrinfo", "socket hang up", "econnrefused", "enotfound")) {
    return { kind: "network", text: `Could not reach ${who}. Check this Mac's internet connection.` };
  }
  // A streamed response that stops mid-body: undici reports the bare word "terminated", with the
  // real cause (a closed socket, a body timeout) only on `cause`. Two long runs died this way and
  // were recorded with no failure kind at all, which reads like the agent did something wrong.
  if (raw.trim().toLowerCase() === "terminated" || has("und_err_socket", "und_err_body_timeout", "other side closed", "premature close")) {
    return { kind: "network", text: `${who} closed the connection part-way through the reply. The work up to that point was kept; the agent will pick it up at its next check-in.` };
  }

  // Credit / quota. Check before auth: a 402 also mentions billing.
  if (status === 402 || has("credit balance is too low", "insufficient credits", "insufficient_quota", "quota exceeded", "billing", "payment required", "add credits")) {
    return { kind: "credit", text: `${who} has no credit left. Top up that account, or switch this agent to another provider in its settings.` };
  }

  // Auth: missing, wrong or expired credentials.
  if (status === 401 || status === 403 || name(e) === "AI_LoadAPIKeyError" || has("authentication_error", "invalid x-api-key", "invalid api key", "invalid_api_key", "no auth credentials", "unauthorized", "permission_error", "oauth token has expired", "please run /login", "api key not valid")) {
    return { kind: "auth", text: `${who} rejected the credentials. Check the key (or the login) for it in Settings › Providers.` };
  }

  // Rate limited.
  if (status === 429 || has("rate_limit_error", "rate limit", "too many requests")) {
    return { kind: "rate_limit", text: `${who} is rate limiting this key. The agent will try again at its next check-in; lower its check-in frequency if it keeps happening.` };
  }

  // Unknown model.
  if (status === 404 || name(e) === "AI_NoSuchModelError" || has("not_found_error", "model not found", "no endpoints found", "is not a valid model")) {
    return { kind: "model", text: `${who} does not have that model. Pick another model for this agent in its settings.` };
  }

  // Context window.
  if (status === 413 || has("prompt is too long", "request_too_large", "context length", "context_length_exceeded", "maximum context", "too many tokens")) {
    return { kind: "context", text: "The conversation grew past the model's context window. Trim the agent's memory or skills, or move it to a model with a larger context." };
  }

  // Provider-side trouble.
  if ((typeof status === "number" && status >= 500) || has("overloaded_error", "internal server error", "service unavailable", "bad gateway")) {
    return { kind: "provider", text: `${who} had a server error (${status ?? "5xx"}). This usually clears on its own; the agent will retry at its next check-in.` };
  }

  return { kind: "other", text: raw.slice(0, 300) || `${who} failed without a message.` };
}

/** Same classification for an error we only have as text (the Claude CLI reports failures that way). */
export function classifyText(text: string, who = "The provider"): Failure {
  return classifyFailure(new Error(text), who);
}

function name(e: unknown): string {
  return (e as { name?: string } | undefined)?.name ?? "";
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return String(e);
}

function statusOf(e: unknown): number | undefined {
  if (APICallError.isInstance(e)) return e.statusCode;
  const s = (e as { status?: number; statusCode?: number } | undefined) ?? {};
  return typeof s.statusCode === "number" ? s.statusCode : typeof s.status === "number" ? s.status : undefined;
}

function bodyOf(e: unknown): string {
  if (APICallError.isInstance(e)) return `${e.responseBody ?? ""} ${JSON.stringify(e.data ?? "")}`;
  if (AISDKError.isInstance(e) && e.cause) return errorText(e.cause);
  const cause = (e as { cause?: unknown } | undefined)?.cause;
  return cause ? errorText(cause) : "";
}
