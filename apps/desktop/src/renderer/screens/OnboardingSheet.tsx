import { useEffect, useState } from "react";
import { PROVIDERS, providerSpec, type Provider, type ProviderSpec, type ProviderState, type ProviderStatus } from "@crew/shared";
import { canDraftTeam, store, useStore } from "../state/store";
import { Ic } from "../ui/icons";
import { Button } from "../ui/kit";
import { ProviderMark } from "../ui/brand";
import { ClaudeRuntimeRow, ProvidersPanel } from "../components/ProvidersPanel";

type View =
  | { kind: "pick" }
  | { kind: "clis" }
  | { kind: "catalog" }
  | { kind: "finish"; id: Provider };

/**
 * First open: pick one path this Mac can run on, finish its one missing action, then
 * the builder. The 34-provider catalog stays behind "Show all" and in Settings.
 */
export function OnboardingSheet() {
  const providers = useStore((s) => s.providers);
  const hasTeams = useStore((s) => s.teams.length > 0);
  const [view, setView] = useState<View>({ kind: "pick" });

  const goToTeam = () => store.openSheet({ kind: "builder", mode: canDraftTeam(providers) ? "describe" : "template" });

  if (!providers) {
    return (
      <div className="sheet" style={{ width: 640, height: 480 }}>
        <div className="sheet-h"><b>{hasTeams ? "New team" : "Welcome to StandBye"}</b></div>
        <div className="sheet-body" style={{ alignItems: "center", justifyContent: "center", color: "var(--ink-4)", fontSize: 12 }}>Loading…</div>
      </div>
    );
  }

  const catalog = view.kind === "catalog";
  const claude = providers.anthropic;
  const claudeLogin = Boolean(claude?.hasLogin);

  return (
    <div className="sheet" style={{ width: catalog ? 860 : 640, height: catalog ? 600 : 560 }}>
      <div className="sheet-h">
        <b>{hasTeams ? "New team" : "Welcome to StandBye"}</b>
        <span className="grow" />
        <Steps view={view} />
        {hasTeams && <button className="ibtn" onClick={() => store.closeSheet()}><Ic.X size={14} /></button>}
      </div>

      {view.kind === "pick" && <PickPane providers={providers} onView={setView} />}
      {view.kind === "clis" && <CliPane providers={providers} onPick={(id) => setView({ kind: "finish", id })} />}
      {view.kind === "catalog" && (
        <div className="sheet-body" style={{ flexDirection: "column", padding: "16px 20px", gap: 10, overflowY: "auto" }}>
          <div style={{ fontSize: 12, color: "var(--ink-4)" }}>Every way into a model. Pick one, set it up, then continue. You can add more later in Settings.</div>
          <ProvidersPanel />
        </div>
      )}
      {view.kind === "finish" && <FinishPane id={view.id} providers={providers} />}

      <div className="sheet-f">
        {view.kind !== "pick" && <Button lg onClick={() => setView({ kind: "pick" })}>Back</Button>}
        <span className="grow" />
        {view.kind === "pick" && claudeLogin && (
          <Button lg primary onClick={() => runtimeMissing(claude) ? setView({ kind: "finish", id: "anthropic" }) : goToTeam()}>
            Continue with Claude
          </Button>
        )}
        {view.kind === "catalog" && (
          <Button lg primary onClick={goToTeam} disabled={!anyReady(providers)} title={anyReady(providers) ? undefined : "Turn on at least one provider"}>
            Continue
          </Button>
        )}
        {view.kind === "finish" && <FinishFooter state={providers[view.id]} onDone={goToTeam} />}
      </div>
    </div>
  );
}

function PickPane({ providers, onView }: { providers: ProviderStatus; onView: (v: View) => void }) {
  const claude = providerSpec("anthropic")!;
  const claudeState = providers.anthropic;
  const claudeLogin = Boolean(claudeState?.hasLogin);
  const otherDetected = PROVIDERS.filter((p) => p.id !== "anthropic" && p.group !== "apis" && detected(providers[p.id]));
  const detectedClis = PROVIDERS.filter((p) => p.group === "clis" && detected(providers[p.id]));
  const empty = !claudeLogin && otherDetected.length === 0 && !detected(providers.openrouter);

  return (
    <div className="sheet-body" style={{ flexDirection: "column", padding: "18px 24px", gap: 14, overflowY: "auto" }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{claudeLogin ? "Claude is signed in on this Mac" : "What should the team run on?"}</div>
        <div style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 2 }}>Bring a login or a key you already pay for. It stays in the macOS keychain. Add more later in Settings.</div>
      </div>

      {claudeLogin && (
        <ProviderCard spec={claude} state={claudeState} hero onClick={() => onView({ kind: "finish", id: "anthropic" })} />
      )}

      {claudeLogin && otherDetected.length > 0 && (
        <div>
          <div className="onboard-kicker">Also on this Mac</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {otherDetected.map((p) => (
              <ProviderCard key={p.id} spec={p} state={providers[p.id]} onClick={() => onView({ kind: "finish", id: p.id })} />
            ))}
          </div>
        </div>
      )}

      {claudeLogin && (
        <div>
          <div className="onboard-kicker">Or paste a key</div>
          <ProviderCard spec={providerSpec("openrouter")!} state={providers.openrouter} onClick={() => onView({ kind: "finish", id: "openrouter" })} />
        </div>
      )}

      {!claudeLogin && detectedClis.length > 0 && (
        <div>
          <div className="onboard-kicker">On this Mac</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {detectedClis.map((p) => (
              <ProviderCard key={p.id} spec={p} state={providers[p.id]} hero={detectedClis.length === 1} onClick={() => onView({ kind: "finish", id: p.id })} />
            ))}
          </div>
        </div>
      )}

      {empty && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <ProviderCard
            spec={providerSpec("openrouter")!}
            state={providers.openrouter}
            hero
            title="OpenRouter"
            body="Paste a key. Agents pick from the public catalog. No 199 MB download."
            onClick={() => onView({ kind: "finish", id: "openrouter" })}
          />
          <ProviderCard
            spec={claude}
            state={claudeState}
            title="Claude"
            body="Sign in with Claude Code once, or paste an Anthropic key. Needs the runtime."
            onClick={() => onView({ kind: "finish", id: "anthropic" })}
          />
          <StarterCard
            icon={<Ic.Person size={18} stroke="var(--ink-3)" />}
            title="A CLI I already pay for"
            body="Codex, Copilot, Cursor, Kimi and the rest. We spawn the CLI you already logged into."
            onClick={() => onView({ kind: "clis" })}
          />
        </div>
      )}

      {!claudeLogin && !empty && (
        <div>
          <div className="onboard-kicker">Or start with a key</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <ProviderCard spec={providerSpec("openrouter")!} state={providers.openrouter} onClick={() => onView({ kind: "finish", id: "openrouter" })} />
            <ProviderCard spec={claude} state={claudeState} onClick={() => onView({ kind: "finish", id: "anthropic" })} />
          </div>
        </div>
      )}

      <a onClick={() => onView({ kind: "catalog" })} style={{ fontSize: 12 }}>Show all {PROVIDERS.length} providers</a>
    </div>
  );
}

function CliPane({ providers, onPick }: { providers: ProviderStatus; onPick: (id: Provider) => void }) {
  const clis = PROVIDERS.filter((p) => p.group === "clis");
  const found = clis.filter((p) => providers[p.id]?.cliPath);
  const rest = clis.filter((p) => !providers[p.id]?.cliPath);
  return (
    <div className="sheet-body" style={{ flexDirection: "column", padding: "18px 24px", gap: 12, overflowY: "auto" }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>A CLI you already pay for</div>
        <div style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 2 }}>StandBye spawns it in headless mode. It keeps its own login, so there is no extra per-run bill.</div>
      </div>
      {found.length > 0 && (
        <div>
          <div className="onboard-kicker">Found on this Mac</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {found.map((p) => <ProviderCard key={p.id} spec={p} state={providers[p.id]} onClick={() => onPick(p.id)} />)}
          </div>
        </div>
      )}
      <div>
        {found.length > 0 && <div className="onboard-kicker">Not installed</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rest.map((p) => <ProviderCard key={p.id} spec={p} state={providers[p.id]} onClick={() => onPick(p.id)} />)}
        </div>
      </div>
    </div>
  );
}

function FinishPane({ id, providers }: { id: Provider; providers: ProviderStatus }) {
  const spec = providerSpec(id)!;
  const state = providers[id]!;
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; detail: string } | null>(null);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    if (!state.enabled) void store.setProviders({ [id]: { enabled: true } });
  }, [id, state.enabled]);

  const saveKey = async () => {
    if (!key.trim()) return;
    setBusy(true);
    try { await store.saveKeys({ [id]: key.trim() }); setKey(""); setTest(null); }
    finally { setBusy(false); }
  };

  const heading = runtimeMissing(state)
    ? "Download the Claude runtime"
    : state.ready ? `${spec.name} is ready`
    : spec.auth === "cli" ? (state.cliPath ? `${spec.name} is on this Mac` : `Install ${spec.name}`)
    : spec.auth === "login" && state.hasLogin ? `${spec.name} is signed in`
    : `Set up ${spec.name}`;

  return (
    <div className="sheet-body" style={{ flexDirection: "column", padding: "18px 24px", gap: 14, overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <ProviderMark id={spec.id} size={30} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{heading}</div>
          <div style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 2 }}>{finishBlurb(spec, state)}</div>
        </div>
      </div>

      {state.runtime && <ClaudeRuntimeRow rt={state.runtime} prominent />}

      {spec.auth === "login" && !state.hasLogin && (
        <div style={{ fontSize: 12, color: "var(--ink-3)" }}>No Claude login found. Run <span className="mono">claude</span> in a terminal once to sign in, or paste a key below.</div>
      )}
      {spec.auth === "cli" && spec.cli && (
        <div style={{ fontSize: 12, color: "var(--ink-3)", display: "flex", flexDirection: "column", gap: 6 }}>
          {state.cliPath
            ? <>Found <span className="mono sel">{state.cliPath}</span></>
            : <>Not installed. Install it with:</>}
          {!state.cliPath && <div className="mono sel" style={{ fontSize: 11, color: "var(--ink-4)" }}>{spec.cli.install}</div>}
        </div>
      )}

      {(spec.auth === "key" || spec.auth === "login") && (spec.auth === "key" || advanced || !state.hasLogin) && (
        <div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              className="field mono" type="password" style={{ flex: 1, minWidth: 0 }}
              placeholder={state.hasKey ? "Replace API key" : spec.keyPlaceholder ?? "API key"}
              value={key} onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && key.trim() && void saveKey()}
            />
            <Button onClick={() => void saveKey()} disabled={!key.trim() || busy}>Save</Button>
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-5)", marginTop: 4 }}>
            {spec.keyUrl && <a onClick={() => void window.crew.openPath(spec.keyUrl!)}>Get a key</a>}
            {spec.keyUrl && spec.docsUrl && " · "}
            {spec.docsUrl && <a onClick={() => void window.crew.openPath(spec.docsUrl)}>Docs</a>}
          </div>
        </div>
      )}

      {(spec.auth === "login" && state.hasLogin) && (
        <a style={{ fontSize: 12 }} onClick={() => setAdvanced(!advanced)}>{advanced ? "Hide" : "Paste a key instead"}</a>
      )}

      {state.ready && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Button onClick={async () => {
            setBusy(true); setTest(null);
            try { setTest(await store.testProvider(id)); }
            catch (e) { setTest({ ok: false, detail: e instanceof Error ? e.message : String(e) }); }
            finally { setBusy(false); }
          }} disabled={busy}>{busy ? "Testing…" : "Test connection"}</Button>
          {test && <span style={{ fontSize: 11, color: test.ok ? "var(--green)" : "var(--red-ink)" }}>{test.ok ? "✓ " : "✗ "}{test.detail}</span>}
        </div>
      )}
    </div>
  );
}

function FinishFooter({ state, onDone }: { state?: ProviderState; onDone: () => void }) {
  if (!state) return null;
  const missing = runtimeMissing(state);
  const progress = useStore((s) => s.claudeRuntime);
  const downloading = Boolean(progress && !progress.done);

  const continueAnyway = () => {
    if (missing && !downloading) void store.installClaudeRuntime().catch(() => undefined);
    if (missing) store.toast("Downloading the Claude runtime. The first Claude run waits on it.");
    onDone();
  };

  if (missing) {
    return <Button lg onClick={continueAnyway}>{downloading ? "Continue while it downloads" : "Continue anyway"}</Button>;
  }

  return (
    <Button lg primary onClick={onDone} disabled={!state.ready} title={state.ready ? undefined : (state.blocker || "Finish setting this up")}>
      Continue
    </Button>
  );
}

function ProviderCard({ spec, state, hero, title, body, onClick }: {
  spec: ProviderSpec; state?: ProviderState; hero?: boolean; title?: string; body?: string; onClick: () => void;
}) {
  const st = statusOf(spec, state);
  return (
    <button type="button" className={"onboard-card" + (hero ? " onboard-card-hero" : "")} onClick={onClick}>
      <ProviderMark id={spec.id} size={22} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{title ?? spec.name}</span>
          <span className="dot" style={{ width: 6, height: 6, background: st.color }} />
          <span style={{ fontSize: 11, color: st.color === "var(--ink-6)" ? "var(--ink-5)" : st.color }}>{st.label}</span>
        </span>
        <span style={{ display: "block", fontSize: 12, color: "var(--ink-4)", marginTop: 2, lineHeight: 1.4 }}>{body ?? spec.blurb}</span>
      </span>
    </button>
  );
}

function StarterCard({ icon, title, body, onClick }: { icon: React.ReactNode; title: string; body: string; onClick: () => void }) {
  return (
    <button type="button" className="onboard-card" onClick={onClick}>
      <span style={{ width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
        <span style={{ display: "block", fontSize: 12, color: "var(--ink-4)", marginTop: 2, lineHeight: 1.4 }}>{body}</span>
      </span>
    </button>
  );
}

function Steps({ view }: { view: View }) {
  const finishing = view.kind === "finish";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-4)" }}>
      <Dot n={1} on={!finishing} done={finishing} /> Providers
      <span style={{ width: 16, height: 1, background: "var(--border)" }} />
      <Dot n={2} on={false} /> Team
    </span>
  );
}

function Dot({ n, on, done }: { n: number; on: boolean; done?: boolean }) {
  return (
    <span style={{ width: 18, height: 18, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, background: on || done ? "var(--accent)" : "var(--border)", color: on || done ? "#fff" : "var(--ink-4)" }}>
      {done ? <Ic.Check size={10} stroke="#fff" strokeWidth={3.5} /> : n}
    </span>
  );
}

function detected(state?: ProviderState): boolean {
  return Boolean(state?.hasLogin || state?.hasKey || state?.cliPath);
}

function runtimeMissing(state?: ProviderState): boolean {
  return Boolean(state?.runtime && !state.runtime.installed && !state.runtime.unsupported);
}

function anyReady(providers: ProviderStatus): boolean {
  return Object.values(providers).some((p) => p.ready);
}

function mb(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

function statusOf(spec: ProviderSpec, state?: ProviderState): { color: string; label: string } {
  if (!state) return { color: "var(--ink-6)", label: "Not set up" };
  if (runtimeMissing(state) && (state.hasLogin || state.hasKey || state.ready)) {
    return { color: "var(--amber)", label: `Needs runtime (${mb(state.runtime!.bytes)})` };
  }
  if (state.ready) return { color: "var(--green)", label: "Ready" };
  if (state.hasLogin) return { color: "var(--green)", label: "Signed in" };
  if (state.cliPath) return { color: "var(--amber)", label: "Found" };
  if (state.hasKey) return { color: "var(--amber)", label: "Key saved" };
  if (spec.auth === "cli") return { color: "var(--ink-6)", label: "Not installed" };
  return { color: "var(--ink-6)", label: state.blocker || "Not set up" };
}

function finishBlurb(spec: ProviderSpec, state: ProviderState): string {
  if (runtimeMissing(state)) return "Once, shared by every team. Skip it and the first run fetches it on the clock (~3 min).";
  if (state.ready) return "You can test the connection, then make the team.";
  if (spec.auth === "cli") return spec.cli?.mcp
    ? "It joins the team properly: channels, mentions, questions to you, and a summary when it finishes."
    : "This CLI works one shot at a time — it does the task and its last paragraph becomes the run summary.";
  if (spec.auth === "login") return spec.blurb;
  return "Encrypted with the macOS keychain. Only sent to the provider itself.";
}
