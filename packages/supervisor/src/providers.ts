import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  APP_NAME, APP_URL, PROVIDERS, providerSpec,
  type Provider, type ProviderConfig, type ProviderSettings, type ProviderSpec, type ProviderState, type ProviderStatus,
} from "@crew/shared";

/**
 * Everything the app needs to know about "can this provider actually run right now".
 *
 * Three separate questions, and the settings screen shows the answer to each:
 *   - is it switched on?                    providers.json, written by the owner
 *   - does it have credentials?             the keychain, the environment, or a login on this Mac
 *   - is the thing it needs installed?      a CLI on PATH, a local server listening
 *
 * The catalog in @crew/shared says which of those apply to a given provider; nothing here
 * names a specific vendor.
 */

export type Keys = Record<string, string>;

/**
 * Headers that put the app's name on a call the owner is paying for. OpenRouter reads these two
 * and shows the title, linked to the URL, beside every request in the owner's activity log — so
 * a StandBye run is identifiable there rather than an anonymous line among their other tools.
 * Sent on billed calls only; the public model catalog needs no attribution.
 */
export const ATTRIBUTION_HEADERS: Record<string, string> = { "HTTP-Referer": APP_URL, "X-Title": APP_NAME };

// ---------------------------------------------------------------- settings file

/** Defaults for a provider the owner has never touched. Only Claude and OpenRouter start switched on. */
function defaultConfig(spec: ProviderSpec): ProviderConfig {
  return {
    enabled: spec.id === "anthropic" || spec.id === "openrouter",
    defaultModel: spec.defaults.main,
    checkinModel: spec.defaults.checkin,
    settings: {},
  };
}

export function defaultSettings(): ProviderSettings {
  return Object.fromEntries(PROVIDERS.map((s) => [s.id, defaultConfig(s)]));
}

export function readSettings(globalDir: string): ProviderSettings {
  const base = defaultSettings();
  const p = path.join(globalDir, "providers.json");
  if (!fs.existsSync(p)) return base;
  try {
    const saved = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, Partial<ProviderConfig>>;
    const blank: ProviderConfig = { enabled: false, defaultModel: "", checkinModel: "", settings: {} };
    for (const [id, cfg] of Object.entries(saved)) {
      // A provider that has since left the catalog keeps its settings rather than having the
      // owner's work dropped on the floor; `statusFor` walks the catalog, so it is simply never
      // reported as ready, and it comes back if the provider returns.
      base[id] = { ...(base[id] ?? blank), ...cfg };
    }
    return base;
  } catch {
    return base;
  }
}

export function writeSettings(globalDir: string, next: ProviderSettings): void {
  fs.mkdirSync(globalDir, { recursive: true });
  fs.writeFileSync(path.join(globalDir, "providers.json"), JSON.stringify(next, null, 2));
}

// ---------------------------------------------------------------- credentials

/** The API key for a provider: what the owner pasted, else the vendor's usual environment variable. */
export function providerKey(spec: ProviderSpec, keys: Keys): string {
  const saved = keys[spec.id];
  if (saved) return saved;
  return (spec.envKey && process.env[spec.envKey]) || "";
}

/** The endpoint to talk to: the owner's override, else the spec's fixed URL. */
export function providerBaseUrl(spec: ProviderSpec, cfg: ProviderConfig | undefined): string {
  return (cfg?.settings?.baseUrl || spec.baseUrl || "").replace(/\/+$/, "");
}

/** The OpenAI-style `/models` endpoint to list from, if there is one. */
export function providerCatalogUrl(spec: ProviderSpec, cfg: ProviderConfig | undefined): string {
  if (cfg?.settings?.baseUrl) return cfg.settings.baseUrl.replace(/\/+$/, "");
  return (spec.catalogUrl ?? "").replace(/\/+$/, "");
}

/** True when Claude Code is signed in on this machine, so the Claude runner works without an API key. */
export function hasClaudeLogin(): boolean {
  if (process.env.CREW_DISABLE_CLAUDE_LOGIN === "1") return false; // tests must never spend
  try {
    if (fs.existsSync(path.join(os.homedir(), ".claude", ".credentials.json"))) return true; // Linux/Windows
    const cfg = path.join(os.homedir(), ".claude.json"); // macOS keeps the token in the Keychain; the account marker lives here
    return fs.existsSync(cfg) && fs.readFileSync(cfg, "utf8").includes('"oauthAccount"');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- finding a CLI

/**
 * Electron hands the supervisor a short PATH, so a CLI installed by npm, Homebrew, bun, uv or
 * nvm is usually not on it. Look in the obvious places too, and cache the answer: this runs on
 * every settings read.
 */
const binCache = new Map<string, { at: number; found: string | null }>();
const BIN_TTL = 30_000;

export function extraBinDirs(): string[] {
  const home = os.homedir();
  const dirs = [
    "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin",
    path.join(home, ".local", "bin"),
    path.join(home, "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".cargo", "bin"),
    path.join(home, ".deno", "bin"),
    path.join(home, ".volta", "bin"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".yarn", "bin"),
    path.join(home, "go", "bin"),
    "/opt/homebrew/opt/node/bin",
  ];
  // Every node version nvm has installed, newest first.
  const nvm = path.join(home, ".nvm", "versions", "node");
  try {
    if (fs.existsSync(nvm)) {
      for (const v of fs.readdirSync(nvm).sort().reverse()) dirs.push(path.join(nvm, v, "bin"));
    }
  } catch { /* no nvm */ }
  return dirs;
}

/** Absolute path to a CLI binary, or null when it is not installed. */
export function findBin(bin: string): string | null {
  const hit = binCache.get(bin);
  if (hit && Date.now() - hit.at < BIN_TTL) return hit.found;
  let found: string | null = null;
  if (bin.includes("/")) {
    found = fs.existsSync(bin) ? bin : null;
  } else {
    const fromPath = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
    for (const dir of [...fromPath, ...extraBinDirs()]) {
      const p = path.join(dir, bin);
      try {
        if (fs.existsSync(p) && (fs.statSync(p).mode & 0o111) !== 0) { found = p; break; }
      } catch { /* unreadable dir */ }
    }
  }
  binCache.set(bin, { at: Date.now(), found });
  return found;
}

/** Forget what we found, so the Test button re-checks after the owner installs something. */
export function forgetBins(): void {
  binCache.clear();
}

/** PATH the CLI runner hands its child, so a CLI can find node, git and its own helpers. */
export function childPath(): string {
  const seen = new Set<string>();
  const parts = [...(process.env.PATH ?? "").split(path.delimiter), ...extraBinDirs()].filter((d) => d && !seen.has(d) && seen.add(d));
  return parts.join(path.delimiter);
}

/** Does this machine have working AWS / GCP credentials? Best effort: used only for a status line. */
function hasCloudCreds(spec: ProviderSpec): boolean {
  const home = os.homedir();
  if (spec.id === "bedrock") {
    if (process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE || process.env.AWS_BEARER_TOKEN_BEDROCK) return true;
    return fs.existsSync(path.join(home, ".aws", "credentials")) || fs.existsSync(path.join(home, ".aws", "config"));
  }
  if (spec.id === "vertex") {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
    return fs.existsSync(path.join(home, ".config", "gcloud", "application_default_credentials.json"));
  }
  return false;
}

// ---------------------------------------------------------------- status

function requiredFields(spec: ProviderSpec): string[] {
  return (spec.fields ?? []).filter((f) => !f.optional).map((f) => f.key);
}

/** One provider's full picture: config, what it has, and the one sentence that says what is missing. */
export function stateFor(spec: ProviderSpec, cfg: ProviderConfig, keys: Keys): ProviderState {
  const key = providerKey(spec, keys);
  const login = spec.id === "anthropic" && hasClaudeLogin();
  const cliPath = spec.cli ? findBin(cfg.cli?.bin || spec.cli.bin) : null;
  const missing = requiredFields(spec).filter((f) => !(cfg.settings?.[f] ?? "").trim());
  const configured = missing.length === 0;

  let blocker = "";
  if (!configured) {
    const labels = missing.map((k) => spec.fields?.find((f) => f.key === k)?.label ?? k);
    blocker = `Fill in ${labels.join(" and ")}.`;
  } else if (spec.auth === "key" && !key) {
    blocker = "Paste an API key.";
  } else if (spec.auth === "login" && !key && !login) {
    blocker = "Sign in to Claude Code on this Mac, or paste an Anthropic API key.";
  } else if (spec.auth === "cli" && !cliPath) {
    blocker = `${spec.cli?.bin ?? spec.name} is not installed.`;
  } else if (spec.auth === "cloud" && !hasCloudCreds(spec)) {
    blocker = spec.id === "bedrock" ? "No AWS credentials found on this Mac." : "No Google Cloud credentials found on this Mac.";
  }

  const credentialed = blocker === "";
  return {
    ...cfg,
    hasKey: Boolean(key),
    hasLogin: login,
    cliPath,
    configured,
    ready: cfg.enabled && credentialed,
    blocker: credentialed ? (cfg.enabled ? "" : "Switched off.") : blocker,
  };
}

export function statusFor(settings: ProviderSettings, keys: Keys): ProviderStatus {
  const out: ProviderStatus = {};
  for (const spec of PROVIDERS) out[spec.id] = stateFor(spec, settings[spec.id] ?? defaultConfig(spec), keys);
  return out;
}

/** Provider ids that can run right now, in catalog order. */
export function readyProviders(status: ProviderStatus): Provider[] {
  return PROVIDERS.filter((s) => status[s.id]?.ready).map((s) => s.id);
}

/**
 * The provider to prefer for new work. Claude first when it is ready — it is the only one with
 * the full harness and the app is designed around it — then whatever else is on, in catalog order.
 */
export function preferredProvider(status: ProviderStatus): Provider | null {
  if (status.anthropic?.ready) return "anthropic";
  return readyProviders(status)[0] ?? null;
}

// ---------------------------------------------------------------- connection test

export interface ProbeResult {
  ok: boolean;
  /** One line for the owner: the version string, the model count, or what went wrong. */
  detail: string;
}

/** Ask the provider whether these credentials work, without spending anything meaningful. */
export async function probeProvider(id: string, cfg: ProviderConfig, keys: Keys): Promise<ProbeResult> {
  const spec = providerSpec(id);
  if (!spec) return { ok: false, detail: `Unknown provider ${id}` };

  if (spec.kind === "cli") {
    const bin = cfg.cli?.bin || spec.cli!.bin;
    const found = (forgetBins(), findBin(bin));
    if (!found) return { ok: false, detail: `${bin} is not installed. ${spec.cli!.install}` };
    try {
      const out = execFileSync(found, spec.cli!.versionArgs ?? ["--version"], { encoding: "utf8", timeout: 15_000, env: { ...process.env, PATH: childPath() } });
      return { ok: true, detail: `${bin} ${out.trim().split("\n")[0]}` };
    } catch (e) {
      // A CLI that refuses --version is still installed; say so rather than calling it broken.
      return { ok: true, detail: `${bin} found at ${found} (it did not answer --version: ${short(e)})` };
    }
  }

  if (spec.auth === "cloud") {
    return hasCloudCreds(spec)
      ? { ok: true, detail: "Credentials found on this Mac. The first run will confirm they reach the model." }
      : { ok: false, detail: spec.id === "bedrock" ? "No AWS credentials. Run `aws configure` or `aws sso login`." : "No Google Cloud credentials. Run `gcloud auth application-default login`." };
  }

  const key = providerKey(spec, keys);
  if (spec.auth === "key" && !key) return { ok: false, detail: "No API key saved." };

  const base = providerCatalogUrl(spec, cfg) || providerBaseUrl(spec, cfg);
  if (!base) return { ok: false, detail: "No base URL to test." };

  // Claude's own key is checked against the Anthropic models endpoint, which wants its own headers.
  const anthropicNative = spec.id === "anthropic";
  const url = `${base}/models`;
  const headers: Record<string, string> = anthropicNative
    ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
    : key ? { authorization: `Bearer ${key}` } : {};
  if (spec.id === "anthropic" && !key) return { ok: true, detail: "Using the Claude Code login on this Mac." };

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return { ok: false, detail: `${res.status} ${res.statusText} from ${url}${res.status === 401 || res.status === 403 ? " — the key was rejected." : ""}` };
    const json = (await res.json()) as { data?: unknown[]; models?: unknown[] };
    const n = (json.data ?? json.models ?? []).length;
    return { ok: true, detail: n ? `Connected. ${n} models available.` : "Connected." };
  } catch (e) {
    return { ok: false, detail: `Could not reach ${url}: ${short(e)}` };
  }
}

function short(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 160);
}
