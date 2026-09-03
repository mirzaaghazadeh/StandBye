/**
 * The provider catalog: every way into a model that the app supports, in one list.
 *
 * There are only three things the supervisor actually knows how to drive, so every entry
 * below is one of them:
 *
 *   kind "claude"  the Claude Agent SDK — the full Claude Code harness. Native Anthropic, and
 *                  every endpoint that speaks the Anthropic Messages API (the coding plans from
 *                  MiniMax, DeepSeek, Moonshot and Z.ai, and Claude through AWS, GCP or Azure).
 *   kind "openai"  the AI SDK tool loop against an OpenAI-compatible base URL, with our own
 *                  workspace file/shell tools. OpenRouter, the labs' own APIs, the inference
 *                  clouds, and a model running on this Mac.
 *   kind "cli"     someone else's headless coding agent, spawned as a subprocess, with the team
 *                  tools handed to it over stdio MCP. This is how a ChatGPT plan, a Copilot seat
 *                  or a Cursor subscription becomes a teammate: their CLI already holds the login.
 *
 * Adding a provider means adding an entry here. The runners, the settings screen, the model
 * picker and the team builder all read this list; none of them has a provider name in it.
 */

import type { ModelInfo } from "./index.js";

export type ProviderKind = "claude" | "openai" | "cli";

/**
 * What the owner has to supply before this provider can run.
 *  key    an API key we store in the OS keychain
 *  login  a login already on this Mac that we detect (the Claude Code login)
 *  cli    the CLI's own account; we only check that the binary is installed
 *  none   a local server, no credentials at all
 *  cloud  the machine's AWS/GCP credentials, plus the fields below
 */
export type ProviderAuth = "key" | "login" | "cli" | "none" | "cloud";

export type ProviderGroup = "claude" | "plans" | "clis" | "apis" | "clouds" | "local";

export const GROUP_LABEL: Record<ProviderGroup, string> = {
  claude: "Claude",
  plans: "Coding plans",
  clis: "Coding agents you already pay for",
  apis: "API keys",
  clouds: "Your cloud account",
  local: "On this Mac",
};

export const GROUP_BLURB: Record<ProviderGroup, string> = {
  claude: "A Claude Pro or Max login on this Mac, or an Anthropic API key. Both drive the full Claude Code harness.",
  plans: "Coding plans that speak the Anthropic API. Same harness, someone else's models, flat monthly price.",
  clis: "A subscription you already have. Standbye spawns the CLI in headless mode and hands it the team tools over MCP, so it keeps its own login and you pay nothing extra per run.",
  apis: "Plain API keys. Agents get our workspace file and shell tools, gated by the same permission rules.",
  clouds: "Claude billed through an account you already have.",
  local: "A model on your own machine. No key, no bill, no data leaving the Mac.",
};

/** An extra field the owner fills in beyond the key: a base URL, a region, a project id. */
export interface ProviderField {
  key: string;
  label: string;
  placeholder?: string;
  hint?: string;
  optional?: boolean;
}

/** How to spawn someone else's coding agent in headless mode. */
export interface CliSpec {
  /** Binary name, looked up on PATH. */
  bin: string;
  /**
   * Argument template. `{prompt}` is replaced with the run prompt, `{model}` with the model id
   * (the whole argument is dropped when no model is set), `{cwd}` with the workspace.
   */
  args: string[];
  /**
   * How this CLI takes an MCP server on the command line, so the agent can talk to its team.
   *  "file"  a flag pointing at a JSON config file we write   (`--mcp-config <file>`)
   *  "json"  the same JSON inline as the flag's value
   *  "codex" repeated `-c mcp_servers.team.…=…` overrides
   *  none    the CLI only reads MCP servers from its own config; the agent still runs, it just
   *          cannot post to channels, so the settings screen says so.
   */
  mcp?: { flag: string; format: "file" | "json" | "codex" };
  /** How to install it, shown when the binary is missing. */
  install: string;
  /** Args that print a version, used by the Test button. Defaults to `--version`. */
  versionArgs?: string[];
  /** Set when the CLI cannot take a model id; the model picker is then hidden. */
  fixedModel?: boolean;
}

export interface ProviderSpec {
  id: string;
  /** Product name, as the vendor writes it. */
  name: string;
  /** Who makes it. */
  by: string;
  /** One line: what you are bringing. Mirrors the landing page. */
  blurb: string;
  kind: ProviderKind;
  auth: ProviderAuth;
  group: ProviderGroup;
  docsUrl: string;
  /** Where to get a key. */
  keyUrl?: string;
  keyPlaceholder?: string;
  /** Fixed endpoint. Absent when the owner supplies one through `fields`. */
  baseUrl?: string;
  /** An OpenAI-style `/models` endpoint, when the vendor has one, so the picker lists what the key can reach. */
  catalogUrl?: string;
  fields?: ProviderField[];
  /** Models we know about without asking. Always shown; a live catalog is merged on top. */
  models: ModelInfo[];
  defaults: { main: string; checkin: string };
  cli?: CliSpec;
  /** An environment variable holding the key, honoured when the owner has not pasted one. */
  envKey?: string;
  /** Claude-kind providers that need extra environment to reach a cloud rather than an endpoint. */
  env?: Record<string, string>;
}

/** Terse helper so the tables below stay readable. */
function m(id: string, name: string, provider: string, inP: number | null, outP: number | null, ctx: number | null, tags: string[] = []): ModelInfo {
  return { id, name, provider, inputPerM: inP, outputPerM: outP, context: ctx, tools: true, tags };
}

// ---------------------------------------------------------------- Claude

const CLAUDE_MODELS: ModelInfo[] = [
  m("claude-opus-5", "Claude Opus 5", "anthropic", 5, 25, 1_000_000, ["default", "reasoning"]),
  m("claude-sonnet-5", "Claude Sonnet 5", "anthropic", 2, 10, 1_000_000, ["balanced"]),
  m("claude-haiku-4-5", "Claude Haiku 4.5", "anthropic", 1, 5, 200_000, ["cheap", "check-ins"]),
  m("claude-opus-4-8", "Claude Opus 4.8", "anthropic", 5, 25, 1_000_000, ["reasoning"]),
  m("claude-opus-4-7", "Claude Opus 4.7", "anthropic", 5, 25, 1_000_000),
  m("claude-sonnet-4-6", "Claude Sonnet 4.6", "anthropic", 3, 15, 1_000_000),
  m("claude-fable-5-1", "Claude Fable 5.1", "anthropic", 10, 50, 1_000_000, ["most capable", "expensive"]),
];

// ---------------------------------------------------------------- the catalog

export const PROVIDERS: ProviderSpec[] = [
  // ---- Claude itself ----
  {
    id: "anthropic",
    name: "Claude",
    by: "Anthropic",
    blurb: "Your Claude Pro or Max login, or an API key",
    kind: "claude",
    auth: "login",
    group: "claude",
    docsUrl: "https://code.claude.com/docs/en/agent-sdk",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyPlaceholder: "sk-ant-… (optional with a login)",
    envKey: "ANTHROPIC_API_KEY",
    catalogUrl: "https://api.anthropic.com/v1",
    models: CLAUDE_MODELS,
    defaults: { main: "claude-opus-5", checkin: "claude-haiku-4-5" },
  },

  // ---- coding plans that speak the Anthropic API ----
  {
    id: "minimax",
    name: "MiniMax",
    by: "MiniMax",
    blurb: "M2 on a MiniMax token plan",
    kind: "claude",
    auth: "key",
    group: "plans",
    docsUrl: "https://platform.minimax.io/docs/token-plan/other-tools",
    keyUrl: "https://platform.minimax.io/user-center/basic-information/interface-key",
    baseUrl: "https://api.minimax.io/anthropic",
    models: [m("MiniMax-M2", "MiniMax M2", "minimax", null, null, 200_000, ["default"])],
    defaults: { main: "MiniMax-M2", checkin: "MiniMax-M2" },
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    by: "DeepSeek",
    blurb: "DeepSeek on its Anthropic-compatible endpoint",
    kind: "claude",
    auth: "key",
    group: "plans",
    docsUrl: "https://api-docs.deepseek.com/guides/anthropic_api",
    keyUrl: "https://platform.deepseek.com/api_keys",
    baseUrl: "https://api.deepseek.com/anthropic",
    catalogUrl: "https://api.deepseek.com/v1",
    models: [
      m("deepseek-chat", "DeepSeek Chat", "deepseek", null, null, 128_000, ["default"]),
      m("deepseek-reasoner", "DeepSeek Reasoner", "deepseek", null, null, 128_000, ["reasoning"]),
    ],
    defaults: { main: "deepseek-chat", checkin: "deepseek-chat" },
  },
  {
    id: "moonshot",
    name: "Kimi Code",
    by: "Moonshot",
    blurb: "Kimi on a Kimi membership or a key",
    kind: "claude",
    auth: "key",
    group: "plans",
    docsUrl: "https://www.kimi.com/code/docs/en/third-party-tools/claude-code.html",
    keyUrl: "https://platform.moonshot.ai/console/api-keys",
    baseUrl: "https://api.moonshot.ai/anthropic",
    catalogUrl: "https://api.moonshot.ai/v1",
    models: [
      m("kimi-k2-turbo-preview", "Kimi K2 Turbo", "moonshot", null, null, 256_000, ["default"]),
      m("kimi-k2-0905-preview", "Kimi K2", "moonshot", null, null, 256_000),
    ],
    defaults: { main: "kimi-k2-turbo-preview", checkin: "kimi-k2-turbo-preview" },
  },
  {
    id: "zai",
    name: "GLM Coding Plan",
    by: "Z.ai",
    blurb: "GLM on a Z.ai coding plan",
    kind: "claude",
    auth: "key",
    group: "plans",
    docsUrl: "https://docs.z.ai/devpack/overview",
    keyUrl: "https://z.ai/manage-apikey/apikey-list",
    baseUrl: "https://api.z.ai/api/anthropic",
    catalogUrl: "https://api.z.ai/api/paas/v4",
    models: [
      m("glm-4.6", "GLM 4.6", "zai", null, null, 200_000, ["default"]),
      m("glm-4.5-air", "GLM 4.5 Air", "zai", null, null, 128_000, ["cheap", "check-ins"]),
    ],
    defaults: { main: "glm-4.6", checkin: "glm-4.5-air" },
  },

  // ---- Claude through a cloud you already have ----
  {
    id: "bedrock",
    name: "Amazon Bedrock",
    by: "AWS",
    blurb: "Claude billed through your AWS account",
    kind: "claude",
    auth: "cloud",
    group: "clouds",
    docsUrl: "https://code.claude.com/docs/en/amazon-bedrock",
    env: { CLAUDE_CODE_USE_BEDROCK: "1" },
    fields: [
      { key: "region", label: "Region", placeholder: "us-east-1", hint: "Sets AWS_REGION for the run." },
      { key: "profile", label: "AWS profile", placeholder: "default", hint: "Leave empty to use the ambient credentials.", optional: true },
    ],
    models: [
      m("us.anthropic.claude-sonnet-4-5-20250929-v1:0", "Claude Sonnet 4.5 (Bedrock)", "bedrock", 3, 15, 200_000, ["default"]),
      m("us.anthropic.claude-haiku-4-5-20251001-v1:0", "Claude Haiku 4.5 (Bedrock)", "bedrock", 1, 5, 200_000, ["cheap", "check-ins"]),
    ],
    defaults: { main: "us.anthropic.claude-sonnet-4-5-20250929-v1:0", checkin: "us.anthropic.claude-haiku-4-5-20251001-v1:0" },
  },
  {
    id: "vertex",
    name: "Vertex AI",
    by: "Google Cloud",
    blurb: "Claude billed through your GCP project",
    kind: "claude",
    auth: "cloud",
    group: "clouds",
    docsUrl: "https://code.claude.com/docs/en/google-vertex-ai",
    env: { CLAUDE_CODE_USE_VERTEX: "1" },
    fields: [
      { key: "project", label: "Project id", placeholder: "my-gcp-project", hint: "Sets ANTHROPIC_VERTEX_PROJECT_ID." },
      { key: "region", label: "Region", placeholder: "us-east5", hint: "Sets CLOUD_ML_REGION." },
    ],
    models: [
      m("claude-sonnet-4-5@20250929", "Claude Sonnet 4.5 (Vertex)", "vertex", 3, 15, 200_000, ["default"]),
      m("claude-haiku-4-5@20251001", "Claude Haiku 4.5 (Vertex)", "vertex", 1, 5, 200_000, ["cheap", "check-ins"]),
    ],
    defaults: { main: "claude-sonnet-4-5@20250929", checkin: "claude-haiku-4-5@20251001" },
  },
  {
    id: "foundry",
    name: "Azure AI Foundry",
    by: "Microsoft",
    blurb: "Claude through your Azure resource",
    kind: "claude",
    auth: "key",
    group: "clouds",
    docsUrl: "https://code.claude.com/docs/en/microsoft-foundry",
    keyPlaceholder: "Foundry API key",
    fields: [
      { key: "baseUrl", label: "Endpoint", placeholder: "https://<resource>.services.ai.azure.com/anthropic", hint: "The Anthropic-compatible endpoint from your Foundry resource." },
    ],
    models: [m("claude-sonnet-4-5", "Claude Sonnet 4.5 (Foundry)", "foundry", null, null, 200_000, ["default"])],
    defaults: { main: "claude-sonnet-4-5", checkin: "claude-sonnet-4-5" },
  },

  // ---- coding agents you already pay for ----
  {
    id: "codex",
    name: "Codex",
    by: "OpenAI",
    blurb: "Your ChatGPT plan, through the Codex CLI",
    kind: "cli",
    auth: "cli",
    group: "clis",
    docsUrl: "https://developers.openai.com/codex/cli",
    cli: {
      bin: "codex",
      args: ["exec", "--skip-git-repo-check", "--cd", "{cwd}", "--model", "{model}", "{prompt}"],
      mcp: { flag: "-c", format: "codex" },
      install: "npm i -g @openai/codex   ·   then `codex login`",
    },
    models: [
      m("gpt-5.1-codex", "GPT-5.1 Codex", "codex", null, null, 400_000, ["default"]),
      m("gpt-5.1-codex-mini", "GPT-5.1 Codex mini", "codex", null, null, 400_000, ["cheap", "check-ins"]),
    ],
    defaults: { main: "gpt-5.1-codex", checkin: "gpt-5.1-codex-mini" },
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    by: "GitHub",
    blurb: "Your Copilot seat, through the Copilot CLI",
    kind: "cli",
    auth: "cli",
    group: "clis",
    docsUrl: "https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli",
    cli: {
      bin: "copilot",
      args: ["-p", "{prompt}", "--allow-all-tools", "--no-color", "--model", "{model}"],
      mcp: { flag: "--mcp-config", format: "file" },
      install: "npm i -g @github/copilot   ·   then `copilot` and /login",
    },
    models: [
      m("claude-sonnet-4.5", "Claude Sonnet 4.5", "copilot", null, null, 200_000, ["default"]),
      m("gpt-5.1", "GPT-5.1", "copilot", null, null, 200_000),
    ],
    defaults: { main: "claude-sonnet-4.5", checkin: "claude-sonnet-4.5" },
  },
  {
    id: "cursor",
    name: "Cursor",
    by: "Cursor",
    blurb: "Your Cursor plan, through cursor-agent",
    kind: "cli",
    auth: "cli",
    group: "clis",
    docsUrl: "https://cursor.com/docs/cli/headless",
    cli: {
      bin: "cursor-agent",
      args: ["-p", "{prompt}", "--output-format", "text", "--force", "--model", "{model}"],
      install: "curl https://cursor.com/install -fsS | bash   ·   then `cursor-agent login`",
    },
    models: [
      m("sonnet-4.5", "Claude Sonnet 4.5", "cursor", null, null, 200_000, ["default"]),
      m("gpt-5.1", "GPT-5.1", "cursor", null, null, 200_000),
      m("auto", "Auto", "cursor", null, null, null, ["cheap", "check-ins"]),
    ],
    defaults: { main: "sonnet-4.5", checkin: "auto" },
  },
  {
    id: "opencode",
    name: "OpenCode",
    by: "Anomaly",
    blurb: "ChatGPT and Copilot OAuth, or any key you have",
    kind: "cli",
    auth: "cli",
    group: "clis",
    docsUrl: "https://opencode.ai/docs/cli",
    cli: {
      bin: "opencode",
      args: ["run", "--model", "{model}", "{prompt}"],
      install: "curl -fsSL https://opencode.ai/install | bash   ·   then `opencode auth login`",
    },
    models: [
      m("anthropic/claude-sonnet-4-5", "Claude Sonnet 4.5", "opencode", null, null, 200_000, ["default"]),
      m("openai/gpt-5.1", "GPT-5.1", "opencode", null, null, 400_000),
    ],
    defaults: { main: "anthropic/claude-sonnet-4-5", checkin: "anthropic/claude-sonnet-4-5" },
  },
  {
    id: "droid",
    name: "Droid",
    by: "Factory",
    blurb: "Your Factory plan or key",
    kind: "cli",
    auth: "cli",
    group: "clis",
    docsUrl: "https://docs.factory.ai/cli/user-guides/automation",
    cli: {
      bin: "droid",
      args: ["exec", "--auto", "high", "--model", "{model}", "{prompt}"],
      install: "curl -fsSL https://app.factory.ai/cli | sh   ·   then `droid` and log in",
    },
    models: [
      m("claude-sonnet-4-5", "Claude Sonnet 4.5", "droid", null, null, 200_000, ["default"]),
      m("gpt-5.1-codex", "GPT-5.1 Codex", "droid", null, null, 400_000),
    ],
    defaults: { main: "claude-sonnet-4-5", checkin: "claude-sonnet-4-5" },
  },
  {
    id: "amp",
    name: "Amp",
    by: "Sourcegraph",
    blurb: "Your Amp account",
    kind: "cli",
    auth: "cli",
    group: "clis",
    docsUrl: "https://ampcode.com/manual#cli",
    cli: {
      bin: "amp",
      args: ["-x", "{prompt}", "--dangerously-allow-all"],
      mcp: { flag: "--mcp-config", format: "file" },
      install: "npm i -g @sourcegraph/amp   ·   then `amp login`",
      fixedModel: true,
    },
    models: [m("amp", "Amp (chooses its own model)", "amp", null, null, null, ["default"])],
    defaults: { main: "amp", checkin: "amp" },
  },
  {
    id: "vibe",
    name: "Mistral Vibe",
    by: "Mistral",
    blurb: "Your Le Chat Pro plan or a Mistral key",
    kind: "cli",
    auth: "cli",
    group: "clis",
    docsUrl: "https://docs.mistral.ai/vibe/code/cli",
    cli: {
      bin: "vibe",
      args: ["-p", "{prompt}", "--yolo", "--model", "{model}"],
      install: "npm i -g @mistralai/vibe   ·   then `vibe login`",
    },
    models: [
      m("devstral-medium-latest", "Devstral Medium", "vibe", null, null, 256_000, ["default"]),
      m("devstral-small-latest", "Devstral Small", "vibe", null, null, 256_000, ["cheap", "check-ins"]),
    ],
    defaults: { main: "devstral-medium-latest", checkin: "devstral-small-latest" },
  },
  {
    id: "kimi-cli",
    name: "Kimi CLI",
    by: "Moonshot",
    blurb: "Your Kimi membership, through the Kimi CLI",
    kind: "cli",
    auth: "cli",
    group: "clis",
    docsUrl: "https://moonshotai.github.io/kimi-cli",
    cli: {
      bin: "kimi",
      args: ["--print", "{prompt}"],
      install: "uv tool install --python 3.13 kimi-cli   ·   then `kimi` and log in",
      fixedModel: true,
    },
    models: [m("kimi", "Kimi (CLI default)", "kimi-cli", null, null, 256_000, ["default"])],
    defaults: { main: "kimi", checkin: "kimi" },
  },
  {
    id: "goose",
    name: "Goose",
    by: "Block",
    blurb: "Whatever keys and subscriptions Goose is configured with",
    kind: "cli",
    auth: "cli",
    group: "clis",
    docsUrl: "https://block.github.io/goose/docs/guides/goose-cli-commands",
    cli: {
      bin: "goose",
      args: ["run", "-t", "{prompt}"],
      install: "brew install block-goose-cli   ·   then `goose configure`",
      fixedModel: true,
    },
    models: [m("goose", "Goose (configured provider)", "goose", null, null, null, ["default"])],
    defaults: { main: "goose", checkin: "goose" },
  },
  {
    id: "cline",
    name: "Cline",
    by: "Cline",
    blurb: "Cline credits or your own keys",
    kind: "cli",
    auth: "cli",
    group: "clis",
    docsUrl: "https://docs.cline.bot/cline-cli/overview",
    cli: {
      bin: "cline",
      args: ["task", "{prompt}", "--yolo", "--output-format", "text"],
      install: "npm i -g @cline/cli   ·   then `cline auth`",
      fixedModel: true,
    },
    models: [m("cline", "Cline (configured model)", "cline", null, null, null, ["default"])],
    defaults: { main: "cline", checkin: "cline" },
  },
  {
    id: "kilo",
    name: "Kilo",
    by: "Kilo Code",
    blurb: "A Kilo Pass or your own keys",
    kind: "cli",
    auth: "cli",
    group: "clis",
    docsUrl: "https://kilo.ai/docs/code-with-ai/platforms/cli",
    cli: {
      bin: "kilo",
      args: ["--yes", "{prompt}"],
      install: "npm i -g @kilocode/cli   ·   then `kilo login`",
      fixedModel: true,
    },
    models: [m("kilo", "Kilo (configured model)", "kilo", null, null, null, ["default"])],
    defaults: { main: "kilo", checkin: "kilo" },
  },
  {
    id: "devin",
    name: "Devin",
    by: "Cognition",
    blurb: "Your Devin plan",
    kind: "cli",
    auth: "cli",
    group: "clis",
    docsUrl: "https://docs.devin.ai/cli/reference/commands",
    cli: {
      bin: "devin",
      args: ["-p", "{prompt}"],
      install: "npm i -g @cognition/devin-cli   ·   then `devin login`",
      fixedModel: true,
    },
    models: [m("devin", "Devin", "devin", null, null, null, ["default"])],
    defaults: { main: "devin", checkin: "devin" },
  },
  {
    id: "warp",
    name: "Warp",
    by: "Warp",
    blurb: "Your Warp plan",
    kind: "cli",
    auth: "cli",
    group: "clis",
    docsUrl: "https://docs.warp.dev/code/cli-reference",
    cli: {
      bin: "warp",
      args: ["agent", "run", "--prompt", "{prompt}"],
      install: "Install Warp from warp.dev, then enable the `warp` CLI in Settings",
      fixedModel: true,
    },
    models: [m("warp", "Warp (configured model)", "warp", null, null, null, ["default"])],
    defaults: { main: "warp", checkin: "warp" },
  },
  {
    id: "auggie",
    name: "Auggie",
    by: "Augment",
    blurb: "Your Augment plan",
    kind: "cli",
    auth: "cli",
    group: "clis",
    docsUrl: "https://docs.augmentcode.com/cli/reference",
    cli: {
      bin: "auggie",
      args: ["--print", "{prompt}", "--dont-save-session"],
      mcp: { flag: "--mcp-config", format: "file" },
      install: "npm i -g @augmentcode/auggie   ·   then `auggie login`",
      fixedModel: true,
    },
    models: [m("auggie", "Auggie (configured model)", "auggie", null, null, null, ["default"])],
    defaults: { main: "auggie", checkin: "auggie" },
  },

  // ---- plain API keys ----
  {
    id: "openrouter",
    name: "OpenRouter",
    by: "OpenRouter",
    blurb: "Hundreds of tool-capable models from one key",
    kind: "openai",
    auth: "key",
    group: "apis",
    docsUrl: "https://openrouter.ai/docs",
    keyUrl: "https://openrouter.ai/keys",
    keyPlaceholder: "sk-or-…",
    baseUrl: "https://openrouter.ai/api/v1",
    catalogUrl: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    models: [
      m("z-ai/glm-5.3", "Z.AI: GLM 5.3", "openrouter", null, null, 1_310_720, ["default"]),
      m("z-ai/glm-5.3-flash", "Z.AI: GLM 5.3 Flash", "openrouter", null, null, 1_310_720, ["cheap", "check-ins"]),
    ],
    defaults: { main: "z-ai/glm-5.3", checkin: "z-ai/glm-5.3-flash" },
  },
  {
    id: "openai",
    name: "OpenAI API",
    by: "OpenAI",
    blurb: "GPT and gpt-oss by key",
    kind: "openai",
    auth: "key",
    group: "apis",
    docsUrl: "https://platform.openai.com/docs",
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-…",
    baseUrl: "https://api.openai.com/v1",
    catalogUrl: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY",
    models: [
      m("gpt-5.1", "GPT-5.1", "openai", null, null, 400_000, ["default"]),
      m("gpt-5.1-mini", "GPT-5.1 mini", "openai", null, null, 400_000, ["cheap", "check-ins"]),
    ],
    defaults: { main: "gpt-5.1", checkin: "gpt-5.1-mini" },
  },
  {
    id: "google",
    name: "Google AI Studio",
    by: "Google",
    blurb: "Gemini by key",
    kind: "openai",
    auth: "key",
    group: "apis",
    docsUrl: "https://ai.google.dev/gemini-api/docs/openai",
    keyUrl: "https://aistudio.google.com/apikey",
    keyPlaceholder: "AIza…",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    catalogUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    envKey: "GEMINI_API_KEY",
    models: [
      m("gemini-2.5-pro", "Gemini 2.5 Pro", "google", null, null, 1_000_000, ["default"]),
      m("gemini-2.5-flash", "Gemini 2.5 Flash", "google", null, null, 1_000_000, ["cheap", "check-ins"]),
    ],
    defaults: { main: "gemini-2.5-pro", checkin: "gemini-2.5-flash" },
  },
  {
    id: "xai",
    name: "xAI",
    by: "xAI",
    blurb: "Grok, OpenAI-compatible, by key",
    kind: "openai",
    auth: "key",
    group: "apis",
    docsUrl: "https://docs.x.ai/docs/overview",
    keyUrl: "https://console.x.ai",
    keyPlaceholder: "xai-…",
    baseUrl: "https://api.x.ai/v1",
    catalogUrl: "https://api.x.ai/v1",
    envKey: "XAI_API_KEY",
    models: [
      m("grok-4", "Grok 4", "xai", null, null, 256_000, ["default"]),
      m("grok-4-fast", "Grok 4 Fast", "xai", null, null, 2_000_000, ["cheap", "check-ins"]),
    ],
    defaults: { main: "grok-4", checkin: "grok-4-fast" },
  },
  {
    id: "mistral",
    name: "Mistral API",
    by: "Mistral",
    blurb: "Devstral and Mistral Large",
    kind: "openai",
    auth: "key",
    group: "apis",
    docsUrl: "https://docs.mistral.ai/api",
    keyUrl: "https://console.mistral.ai/api-keys",
    baseUrl: "https://api.mistral.ai/v1",
    catalogUrl: "https://api.mistral.ai/v1",
    envKey: "MISTRAL_API_KEY",
    models: [
      m("devstral-medium-latest", "Devstral Medium", "mistral", null, null, 256_000, ["default"]),
      m("mistral-large-latest", "Mistral Large", "mistral", null, null, 128_000),
      m("mistral-small-latest", "Mistral Small", "mistral", null, null, 128_000, ["cheap", "check-ins"]),
    ],
    defaults: { main: "devstral-medium-latest", checkin: "mistral-small-latest" },
  },
  {
    id: "qwen",
    name: "Qwen",
    by: "Alibaba Model Studio",
    blurb: "Qwen by key",
    kind: "openai",
    auth: "key",
    group: "apis",
    docsUrl: "https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope",
    keyUrl: "https://modelstudio.console.alibabacloud.com/?tab=playground#/api-key",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    catalogUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    envKey: "DASHSCOPE_API_KEY",
    models: [
      m("qwen3-coder-plus", "Qwen3 Coder Plus", "qwen", null, null, 1_000_000, ["default"]),
      m("qwen3-coder-flash", "Qwen3 Coder Flash", "qwen", null, null, 1_000_000, ["cheap", "check-ins"]),
    ],
    defaults: { main: "qwen3-coder-plus", checkin: "qwen3-coder-flash" },
  },
  {
    id: "groq",
    name: "Groq",
    by: "Groq",
    blurb: "Open-weight models, very fast",
    kind: "openai",
    auth: "key",
    group: "apis",
    docsUrl: "https://console.groq.com/docs/openai",
    keyUrl: "https://console.groq.com/keys",
    keyPlaceholder: "gsk_…",
    baseUrl: "https://api.groq.com/openai/v1",
    catalogUrl: "https://api.groq.com/openai/v1",
    envKey: "GROQ_API_KEY",
    models: [
      m("moonshotai/kimi-k2-instruct-0905", "Kimi K2 Instruct", "groq", null, null, 256_000, ["default"]),
      m("llama-3.3-70b-versatile", "Llama 3.3 70B", "groq", null, null, 128_000, ["cheap", "check-ins"]),
    ],
    defaults: { main: "moonshotai/kimi-k2-instruct-0905", checkin: "llama-3.3-70b-versatile" },
  },
  {
    id: "together",
    name: "Together AI",
    by: "Together",
    blurb: "Open-weight models by key",
    kind: "openai",
    auth: "key",
    group: "apis",
    docsUrl: "https://docs.together.ai/docs/openai-api-compatibility",
    keyUrl: "https://api.together.ai/settings/api-keys",
    baseUrl: "https://api.together.xyz/v1",
    catalogUrl: "https://api.together.xyz/v1",
    envKey: "TOGETHER_API_KEY",
    models: [
      m("Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8", "Qwen3 Coder 480B", "together", null, null, 256_000, ["default"]),
      m("moonshotai/Kimi-K2-Instruct-0905", "Kimi K2 Instruct", "together", null, null, 256_000),
    ],
    defaults: { main: "Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8", checkin: "Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8" },
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    by: "Fireworks",
    blurb: "Open-weight models by key",
    kind: "openai",
    auth: "key",
    group: "apis",
    docsUrl: "https://fireworks.ai/docs/tools-sdks/openai-compatibility",
    keyUrl: "https://fireworks.ai/account/api-keys",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    catalogUrl: "https://api.fireworks.ai/inference/v1",
    envKey: "FIREWORKS_API_KEY",
    models: [
      m("accounts/fireworks/models/kimi-k2-instruct-0905", "Kimi K2 Instruct", "fireworks", null, null, 256_000, ["default"]),
      m("accounts/fireworks/models/qwen3-coder-480b-a35b-instruct", "Qwen3 Coder 480B", "fireworks", null, null, 256_000),
    ],
    defaults: { main: "accounts/fireworks/models/kimi-k2-instruct-0905", checkin: "accounts/fireworks/models/kimi-k2-instruct-0905" },
  },
  {
    id: "custom",
    name: "Any OpenAI-compatible endpoint",
    by: "you",
    blurb: "Point it at a base URL and paste a key",
    kind: "openai",
    auth: "key",
    group: "apis",
    docsUrl: "https://platform.openai.com/docs/api-reference/chat",
    keyPlaceholder: "API key, if the endpoint wants one",
    fields: [
      { key: "baseUrl", label: "Base URL", placeholder: "https://example.com/v1", hint: "Must serve /chat/completions." },
      { key: "model", label: "Model id", placeholder: "my-model", hint: "Used when the endpoint has no /models list.", optional: true },
    ],
    models: [],
    defaults: { main: "", checkin: "" },
  },

  // ---- on this Mac ----
  {
    id: "ollama",
    name: "Ollama",
    by: "local",
    blurb: "Models on your own Mac",
    kind: "openai",
    auth: "none",
    group: "local",
    docsUrl: "https://docs.ollama.com/openai",
    baseUrl: "http://127.0.0.1:11434/v1",
    catalogUrl: "http://127.0.0.1:11434/v1",
    fields: [{ key: "baseUrl", label: "Base URL", placeholder: "http://127.0.0.1:11434/v1", hint: "Change only if Ollama listens elsewhere.", optional: true }],
    models: [m("qwen3-coder:30b", "Qwen3 Coder 30B", "ollama", 0, 0, 256_000, ["free", "default"])],
    defaults: { main: "qwen3-coder:30b", checkin: "qwen3-coder:30b" },
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    by: "local",
    blurb: "Models on your own Mac",
    kind: "openai",
    auth: "none",
    group: "local",
    docsUrl: "https://lmstudio.ai/docs/developer/openai-compat/chat-completions",
    baseUrl: "http://127.0.0.1:1234/v1",
    catalogUrl: "http://127.0.0.1:1234/v1",
    fields: [{ key: "baseUrl", label: "Base URL", placeholder: "http://127.0.0.1:1234/v1", hint: "Start the LM Studio server first (Developer tab).", optional: true }],
    models: [],
    defaults: { main: "", checkin: "" },
  },
];

/**
 * Brand colours for the little monogram tile each provider gets in the picker. Kept here rather
 * than in the app so the landing page and the settings screen show the same mark.
 */
const ACCENTS: Record<string, string> = {
  anthropic: "#D97757", openrouter: "#6467F2",
  minimax: "#E4462F", deepseek: "#4D6BFE", moonshot: "#0E1116", zai: "#2563EB",
  bedrock: "#FF9900", vertex: "#4285F4", foundry: "#0078D4",
  codex: "#10A37F", copilot: "#24292E", cursor: "#0F0F0F", opencode: "#1D1C1A", droid: "#0F172A",
  amp: "#F34E3F", vibe: "#FA520F", "kimi-cli": "#0E1116", goose: "#3B4A8C", cline: "#3B5BDB",
  kilo: "#6D28D9", devin: "#0EA5E9", warp: "#01A0C6", auggie: "#16A34A",
  openai: "#10A37F", google: "#4285F4", xai: "#0F0F0F", mistral: "#FA520F", qwen: "#615CED",
  groq: "#F55036", together: "#0F6FFF", fireworks: "#5B21B6", custom: "#7A756C",
  ollama: "#0F0F0F", lmstudio: "#4B32C3",
};

/** The colour for a provider's mark, and a readable fallback for one we have no brand for. */
export function providerAccent(id: string): string {
  return ACCENTS[id] ?? "#7A756C";
}

/**
 * Where initials do not say the right thing. "Azure AI Foundry" derives to AA, and Bedrock is
 * the AWS one — the letters people actually look for are not always the first two.
 */
const MONOGRAMS: Record<string, string> = {
  bedrock: "AWS",
  foundry: "Az",
  codex: "Cx",
  openai: "AI",
  custom: "···",
};

/** Two or three letters for the tile of a provider no icon set carries. */
export function providerMonogram(id: string): string {
  if (MONOGRAMS[id]) return MONOGRAMS[id];
  const name = BY_ID.get(id)?.name ?? id;
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  // Title case either way, so "Together AI" and "Droid" sit next to each other as Ta and Dr
  // rather than TA and Dr.
  const two = words.length >= 2 ? (words[0]?.[0] ?? "") + (words[1]?.[0] ?? "") : name.slice(0, 2);
  return two.charAt(0).toUpperCase() + two.slice(1).toLowerCase();
}

export const PROVIDER_IDS: string[] = PROVIDERS.map((p) => p.id);

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

export function providerSpec(id: string): ProviderSpec | undefined {
  return BY_ID.get(id);
}

/** Never throws: an agent on a provider that has since been removed still renders. */
export function providerLabel(id: string): string {
  return BY_ID.get(id)?.name ?? id;
}

export function providersInGroup(group: ProviderGroup): ProviderSpec[] {
  return PROVIDERS.filter((p) => p.group === group);
}

export const GROUP_ORDER: ProviderGroup[] = ["claude", "clis", "plans", "apis", "local", "clouds"];
