// The provider catalog and everything that reads it: settings, readiness, credentials,
// and the command line a coding-agent CLI is spawned with.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeCrew, tempDir } from "./helpers.mjs";
import { PROVIDERS, providerSpec, providerMonogram, providerAccent, DEFAULT_MODELS } from "@crew/shared";
import { defaultSettings, readSettings, writeSettings, statusFor, preferredProvider, readyProviders, providerKey, providerBaseUrl } from "../dist/providers.js";
import { substitute, previewCommand, cliRunner } from "../dist/runners/cli.js";

test("the catalog is internally consistent", async (t) => {
  await t.test("ids are unique", () => {
    const ids = PROVIDERS.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  await t.test("every provider says how to reach it", () => {
    for (const p of PROVIDERS) {
      if (p.kind === "cli") {
        assert.ok(p.cli, `${p.id} is a CLI provider with no cli spec`);
        assert.ok(p.cli.install, `${p.id} does not say how to install it`);
        assert.ok(p.cli.args.some((a) => a.includes("{prompt}")), `${p.id} never passes the prompt`);
      } else if (p.auth !== "cloud" && p.id !== "anthropic") {
        // Either a fixed endpoint, or a field the owner fills in with one. A cloud carries its
        // own switch in `env` instead, and Anthropic is the one endpoint the SDK already knows.
        const hasField = (p.fields ?? []).some((f) => f.key === "baseUrl");
        assert.ok(p.baseUrl || hasField, `${p.id} has neither a base URL nor a field for one`);
      } else if (p.auth === "cloud") {
        assert.ok(p.env && Object.keys(p.env).length, `${p.id} is a cloud with no environment switch`);
      }
    }
  });

  await t.test("defaults name a model the provider actually lists, where it lists any", () => {
    for (const p of PROVIDERS) {
      if (!p.models.length) continue; // the endpoint is asked at runtime
      const ids = p.models.map((m) => m.id);
      assert.ok(ids.includes(p.defaults.main), `${p.id} default ${p.defaults.main} is not in its own list`);
      assert.ok(ids.includes(p.defaults.checkin), `${p.id} check-in ${p.defaults.checkin} is not in its own list`);
    }
  });

  await t.test("every model is tagged with the provider that owns it", () => {
    for (const p of PROVIDERS) for (const m of p.models) assert.equal(m.provider, p.id, `${m.id} claims provider ${m.provider}`);
  });

  await t.test("DEFAULT_MODELS covers the whole catalog", () => {
    for (const p of PROVIDERS) assert.deepEqual(DEFAULT_MODELS[p.id], p.defaults);
  });

  await t.test("every provider has a mark to draw", () => {
    for (const p of PROVIDERS) {
      assert.match(providerAccent(p.id), /^#[0-9a-fA-F]{6}$/, `${p.id} has no accent colour`);
      // The fallback for a vendor no icon set carries. Three glyphs is what the tile holds
      // before the type has to shrink past legibility.
      const mono = providerMonogram(p.id);
      assert.ok(mono.length >= 1 && mono.length <= 3, `${p.id} monogram "${mono}" does not fit its tile`);
    }
  });

  await t.test("the landing page's promise is covered", () => {
    // One entry per way in that the site advertises. If a tile is added there, it is added here.
    for (const id of ["anthropic", "openrouter", "codex", "copilot", "cursor", "opencode", "droid", "amp", "vibe", "kimi-cli", "goose", "cline", "kilo", "devin", "warp", "auggie",
      "minimax", "deepseek", "moonshot", "zai", "ollama", "lmstudio", "bedrock", "vertex", "foundry", "openai", "google", "xai", "mistral", "qwen", "groq", "together", "fireworks"]) {
      assert.ok(providerSpec(id), `the catalog is missing ${id}`);
    }
  });
});

test("provider settings on disk", async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  await t.test("a fresh install has Claude and OpenRouter on, and nothing else", () => {
    const s = defaultSettings();
    assert.equal(s.anthropic.enabled, true);
    assert.equal(s.openrouter.enabled, true);
    assert.equal(s.codex.enabled, false);
    assert.equal(s.ollama.enabled, false);
  });

  await t.test("what is written is what is read back", () => {
    const s = defaultSettings();
    s.ollama = { ...s.ollama, enabled: true, defaultModel: "llama3.3", settings: { baseUrl: "http://127.0.0.1:9999/v1" } };
    writeSettings(dir, s);
    const back = readSettings(dir);
    assert.equal(back.ollama.enabled, true);
    assert.equal(back.ollama.settings.baseUrl, "http://127.0.0.1:9999/v1");
    assert.equal(back.anthropic.defaultModel, DEFAULT_MODELS.anthropic.main, "untouched providers keep their defaults");
  });

  await t.test("a provider added to the catalog after the file was written gets its defaults", () => {
    fs.writeFileSync(path.join(dir, "providers.json"), JSON.stringify({ anthropic: { enabled: false } }));
    const back = readSettings(dir);
    assert.equal(back.anthropic.enabled, false);
    assert.equal(back.groq.enabled, false);
    assert.equal(back.groq.defaultModel, DEFAULT_MODELS.groq.main);
  });

  await t.test("a corrupt file falls back rather than taking the supervisor down", () => {
    fs.writeFileSync(path.join(dir, "providers.json"), "{ not json");
    assert.equal(readSettings(dir).anthropic.enabled, true);
  });
});

test("readiness", async (t) => {
  await t.test("a key provider is not ready until it has a key", () => {
    const s = defaultSettings();
    s.groq = { ...s.groq, enabled: true };
    assert.equal(statusFor(s, {}).groq.ready, false);
    assert.match(statusFor(s, {}).groq.blocker, /API key/);
    assert.equal(statusFor(s, { groq: "gsk_test" }).groq.ready, true);
  });

  await t.test("switched off beats having a key", () => {
    const s = defaultSettings();
    const st = statusFor(s, { groq: "gsk_test" }).groq;
    assert.equal(st.hasKey, true);
    assert.equal(st.ready, false);
    assert.match(st.blocker, /Switched off/);
  });

  await t.test("a provider with required fields says which one is missing", () => {
    const s = defaultSettings();
    s.vertex = { ...s.vertex, enabled: true, settings: { project: "p" } };
    assert.match(statusFor(s, {}).vertex.blocker, /Region/);
  });

  await t.test("a local endpoint needs no credentials at all", () => {
    const s = defaultSettings();
    s.ollama = { ...s.ollama, enabled: true };
    assert.equal(statusFor(s, {}).ollama.ready, true);
  });

  await t.test("preferred is Claude when Claude works, else the first that does", () => {
    const s = defaultSettings();
    assert.equal(preferredProvider(statusFor(s, {})), null, "nothing is ready with no keys and no login");
    assert.equal(preferredProvider(statusFor(s, { openrouter: "sk-or-x" })), "openrouter");
    assert.equal(preferredProvider(statusFor(s, { openrouter: "sk-or-x", anthropic: "sk-ant-x" })), "anthropic");
  });

  await t.test("ready providers come back in catalog order", () => {
    const s = defaultSettings();
    s.groq = { ...s.groq, enabled: true };
    const ready = readyProviders(statusFor(s, { openrouter: "k", groq: "k", anthropic: "k" }));
    assert.deepEqual(ready, ["anthropic", "openrouter", "groq"]);
  });
});

test("credentials", async (t) => {
  await t.test("a saved key wins over the environment", () => {
    const spec = providerSpec("openrouter");
    process.env.OPENROUTER_API_KEY = "from-env";
    t.after(() => { delete process.env.OPENROUTER_API_KEY; });
    assert.equal(providerKey(spec, { openrouter: "saved" }), "saved");
    assert.equal(providerKey(spec, {}), "from-env", "a key already in the environment just works");
  });

  await t.test("a base URL the owner set overrides the catalog's", () => {
    const spec = providerSpec("ollama");
    assert.equal(providerBaseUrl(spec, { settings: {} }), "http://127.0.0.1:11434/v1");
    assert.equal(providerBaseUrl(spec, { settings: { baseUrl: "http://elsewhere:1234/v1/" } }), "http://elsewhere:1234/v1", "trailing slash trimmed");
  });
});

test("the command a coding-agent CLI is spawned with", async (t) => {
  await t.test("placeholders are filled in", () => {
    assert.deepEqual(
      substitute(["exec", "--cd", "{cwd}", "--model", "{model}", "{prompt}"], { prompt: "do the thing", model: "gpt-5.1", cwd: "/repo" }),
      ["exec", "--cd", "/repo", "--model", "gpt-5.1", "do the thing"],
    );
  });

  await t.test("an empty value takes its flag with it", () => {
    // A CLI that chooses its own model must not be handed a bare `--model` with nothing after it.
    assert.deepEqual(substitute(["-p", "{prompt}", "--model", "{model}"], { prompt: "hi", model: "", cwd: "/repo" }), ["-p", "hi"]);
    assert.deepEqual(substitute(["exec", "--model", "{model}", "{prompt}"], { prompt: "hi", model: "", cwd: "/r" }), ["exec", "hi"]);
  });

  await t.test("a subcommand before an empty placeholder is not eaten", () => {
    // Only a flag is dropped; `run` and `exec` are positional and must survive.
    assert.deepEqual(substitute(["run", "{model}", "{prompt}"], { prompt: "hi", model: "", cwd: "/r" }), ["run", "hi"]);
  });

  await t.test("a placeholder inside a longer argument is substituted, not dropped", () => {
    assert.deepEqual(substitute(["--cwd={cwd}"], { prompt: "", model: "", cwd: "/repo" }), ["--cwd=/repo"]);
  });

  await t.test("the preview shows the owner exactly what will run", () => {
    const spec = providerSpec("codex");
    const cmd = previewCommand(spec, { enabled: true, defaultModel: "gpt-5.1-codex", checkinModel: "gpt-5.1-codex" }, "gpt-5.1-codex");
    assert.match(cmd, /^codex exec /);
    assert.match(cmd, /gpt-5\.1-codex/);
    assert.match(cmd, /"<the run prompt>"/);
  });

  await t.test("an owner's override replaces the catalog's invocation", () => {
    const spec = providerSpec("codex");
    const cmd = previewCommand(spec, { enabled: true, defaultModel: "m", checkinModel: "m", cli: { bin: "codex2", args: ["go", "{prompt}"] } }, "m");
    assert.equal(cmd, 'codex2 go "<the run prompt>"');
  });

  await t.test("a CLI that picks its own model gets no model argument", () => {
    const spec = providerSpec("amp");
    const cmd = previewCommand(spec, { enabled: true, defaultModel: "amp", checkinModel: "amp" }, "amp");
    assert.ok(!cmd.includes("--model"), cmd);
  });
});

test("agents can be moved onto any provider in the catalog", async (t) => {
  const { crew } = makeCrew(t);

  await t.test("a run is refused while the provider is switched off, whichever provider it is", () => {
    crew.updateAgent("kai", { provider: "groq", model: "llama-3.3-70b-versatile" });
    const v = crew.budgetAllows("kai");
    assert.equal(v.ok, false);
    assert.match(v.reason, /Groq is turned off/);
  });

  await t.test("turning it on lets the run through", () => {
    crew.setProviders({ groq: { enabled: true } });
    assert.equal(crew.budgetAllows("kai").ok, true, "credentials are the runner's problem, not the budget's");
  });

  await t.test("an agent on a provider this build has never heard of is stopped with an explanation", () => {
    crew.updateAgent("kai", { provider: "some-dead-vendor" });
    const v = crew.budgetAllows("kai");
    assert.equal(v.ok, false);
    assert.match(v.reason, /does not offer/);
  });

  await t.test("providerConfig never throws for an unknown provider", () => {
    assert.equal(crew.providerConfig("some-dead-vendor").enabled, false);
  });
});

test("spawning a coding-agent CLI", async (t) => {
  // A stand-in for somebody else's agent: it prints what it was given and exits. This exercises
  // the whole spawn path — argument templating, the workspace as cwd, streamed output turned
  // into run steps, the exit code — without spending anyone's subscription.
  const { crew, dataDir } = makeCrew(t);
  const bin = path.join(dataDir, "fake-agent");
  const workspace = path.join(dataDir, "ws");
  fs.mkdirSync(workspace, { recursive: true });

  const run = (script, { model = "some-model", fixedModel = false } = {}) => {
    fs.writeFileSync(bin, script, { mode: 0o755 });
    const agent = crew.getAgent("kai");
    const r = crew.createRun(agent.id, { kind: "manual", prompt: "go" }, model);
    const spec = { ...providerSpec("codex"), cli: { ...providerSpec("codex").cli, fixedModel } };
    return cliRunner({
      crew, agent, run: r, mode: "full", model, cwd: workspace,
      system: "SYSTEM", prompt: "PROMPT", signal: new AbortController().signal,
      spec,
      config: { enabled: true, defaultModel: model, checkinModel: model, cli: { bin, args: ["--model", "{model}", "--cd", "{cwd}", "{prompt}"] } },
      ctx: { crew, agentId: agent.id, run: r, depth: 0, onDone: () => {}, onEscalate: () => {} },
    }).then((out) => ({ out, runId: r.id }));
  };

  await t.test("the prompt, the model and the workspace all reach the CLI", async () => {
    const { out } = await run('#!/bin/sh\necho "args: $@"\necho "cwd: $(pwd)"\n');
    assert.equal(out.error, undefined, out.error);
    assert.match(out.text, /--model some-model/);
    assert.match(out.text, /--cd .*ws/);
    assert.match(out.text, /SYSTEM/);
    assert.match(out.text, /PROMPT/);
    assert.match(out.text, /cwd: .*ws/, "it runs inside the team's workspace");
  });

  await t.test("a run on a subscription costs nothing to record", async () => {
    const { out } = await run("#!/bin/sh\necho done\n");
    assert.equal(out.costUsd, 0);
    assert.equal(out.inputTokens, 0);
  });

  await t.test("what it printed becomes the run summary when it has no team tools", async () => {
    let summary = null;
    const agent = crew.getAgent("kai");
    const r = crew.createRun(agent.id, { kind: "manual", prompt: "go" }, "m");
    fs.writeFileSync(bin, '#!/bin/sh\necho "first paragraph"\necho ""\necho "Fixed the retry bug and opened a PR."\n', { mode: 0o755 });
    const spec = { ...providerSpec("cursor") }; // cursor has no mcp flag, so it is one-shot
    await cliRunner({
      crew, agent, run: r, mode: "full", model: "m", cwd: workspace,
      system: "S", prompt: "P", signal: new AbortController().signal, spec,
      config: { enabled: true, defaultModel: "m", checkinModel: "m", cli: { bin, args: ["{prompt}"] } },
      ctx: { crew, agentId: agent.id, run: r, depth: 0, onDone: (s) => { summary = s; } },
    });
    assert.equal(summary, "Fixed the retry bug and opened a PR.");
  });

  await t.test("a non-zero exit is reported with what the CLI said", async () => {
    const { out } = await run('#!/bin/sh\necho "not logged in" >&2\nexit 3\n');
    assert.match(out.error, /exited 3/);
    assert.match(out.error, /not logged in/);
  });

  await t.test("a missing binary tells the owner how to install it", async () => {
    const agent = crew.getAgent("kai");
    const r = crew.createRun(agent.id, { kind: "manual", prompt: "go" }, "m");
    const out = await cliRunner({
      crew, agent, run: r, mode: "full", model: "m", cwd: workspace,
      system: "S", prompt: "P", signal: new AbortController().signal, spec: providerSpec("codex"),
      config: { enabled: true, defaultModel: "m", checkinModel: "m", cli: { bin: "definitely-not-installed-xyz" } },
      ctx: { crew, agentId: agent.id, run: r, depth: 0 },
    });
    assert.equal(out.failure, "auth");
    assert.match(out.error, /not installed/);
    assert.match(out.error, /npm i -g @openai\/codex/);
  });

  await t.test("the output shows up as run steps the owner can watch", async () => {
    const { runId } = await run("#!/bin/sh\necho hello from the agent\n");
    const steps = crew.db.listSteps(runId);
    assert.ok(steps.some((s) => s.text.includes("hello from the agent")), JSON.stringify(steps));
  });
});
