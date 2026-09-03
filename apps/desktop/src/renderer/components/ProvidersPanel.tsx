import { useEffect, useMemo, useState } from "react";
import {
  GROUP_BLURB, GROUP_LABEL, GROUP_ORDER, PROVIDERS, providerSpec,
  type Provider, type ProviderConfig, type ProviderGroup, type ProviderSpec, type ProviderState,
} from "@crew/shared";
import { store, useStore } from "../state/store";
import { Button, KV, Switch } from "../ui/kit";
import { Ic } from "../ui/icons";
import { ProviderMark } from "../ui/brand";
import { ModelPicker } from "./ModelPicker";

/**
 * The providers screen: every way into a model the app supports, in one browsable list.
 *
 * Two panes, because there are thirty-odd of them. On the left the catalog, grouped the way the
 * owner thinks about it — what they are already signed in to, what they already pay for, plain
 * keys, their own Mac — with a filter that defaults to "Ready & detected" so a first run shows
 * three or four rows, not thirty. On the right, one provider at a time: what it needs, a field
 * for it, the models it will use, and a Test button that answers the only question that matters
 * before an agent runs at 3am.
 */
export function ProvidersPanel({ compact }: { compact?: boolean }) {
  const providers = useStore((s) => s.providers);
  const [filter, setFilter] = useState<"suggested" | "all">("suggested");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Provider>("anthropic");

  const visible = useMemo(() => {
    if (!providers) return [];
    const needle = q.trim().toLowerCase();
    return PROVIDERS.filter((p) => {
      const st = providers[p.id];
      if (needle) return `${p.name} ${p.by} ${p.blurb} ${p.id}`.toLowerCase().includes(needle);
      if (filter === "all") return true;
      // "Suggested" is what this Mac can plausibly run today: anything ready, anything whose
      // credentials or binary we found, and the two that are on out of the box.
      return Boolean(st?.ready || st?.hasKey || st?.hasLogin || st?.cliPath || p.id === "anthropic" || p.id === "openrouter");
    });
  }, [providers, filter, q]);

  // Keep the selection on screen when the filter or the search narrows the list.
  useEffect(() => {
    if (visible.length && !visible.some((p) => p.id === selected)) setSelected(visible[0]!.id);
  }, [visible, selected]);

  if (!providers) return <div style={{ color: "var(--ink-4)", fontSize: 12 }}>Loading…</div>;

  const readyCount = PROVIDERS.filter((p) => providers[p.id]?.ready).length;
  const groups = GROUP_ORDER.map((g) => ({ group: g, items: visible.filter((p) => p.group === g) })).filter((g) => g.items.length);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div className="search" style={{ flex: 1, width: "auto" }}>
          <Ic.Search size={13} />
          <input placeholder={`Search ${PROVIDERS.length} providers`} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {!q.trim() && (
          <Button sm onClick={() => setFilter(filter === "all" ? "suggested" : "all")}>
            {filter === "all" ? "Show suggested" : `Show all ${PROVIDERS.length}`}
          </Button>
        )}
        <span style={{ fontSize: 11, color: readyCount ? "var(--green)" : "var(--amber)", whiteSpace: "nowrap" }}>
          {readyCount ? `${readyCount} ready` : "none ready"}
        </span>
      </div>

      <div style={{ display: "flex", gap: 10, flex: 1, minHeight: compact ? 300 : 340 }}>
        <div className="scroll" style={{ width: 208, flexShrink: 0, border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", overflowX: "hidden" }}>
          {groups.map(({ group, items }) => (
            <div key={group}>
              <div className="li-sec" style={{ position: "sticky", top: 0, zIndex: 1 }}>{GROUP_LABEL[group]}</div>
              {items.map((p) => (
                <ProviderRow key={p.id} spec={p} state={providers[p.id]} selected={p.id === selected} onSelect={() => setSelected(p.id)} />
              ))}
            </div>
          ))}
          {!groups.length && <div style={{ padding: 12, fontSize: 12, color: "var(--ink-4)" }}>Nothing matches "{q}".</div>}
        </div>

        <div className="scroll" style={{ flex: 1, minWidth: 0, border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", padding: "12px 14px" }}>
          <ProviderDetail key={selected} spec={providerSpec(selected)!} state={providers[selected]} />
        </div>
      </div>
    </div>
  );
}

function ProviderRow({ spec, state, selected, onSelect }: { spec: ProviderSpec; state?: ProviderState; selected: boolean; onSelect: () => void }) {
  const dot = state?.ready ? "var(--green)" : state?.enabled ? "var(--amber)" : "var(--ink-6)";
  return (
    <button className={"li" + (selected ? " li-sel" : "")} style={{ padding: "6px 10px", gap: 8, alignItems: "center", width: "100%" }} onClick={onSelect}>
      <ProviderMark id={spec.id} />
      <span className="cell" style={{ flex: 1, minWidth: 0, fontWeight: selected ? 600 : 500 }}>{spec.name}</span>
      <span className="dot" style={{ width: 6, height: 6, flexShrink: 0, background: dot }} />
    </button>
  );
}


// ---------------------------------------------------------------- detail pane

function ProviderDetail({ spec, state }: { spec: ProviderSpec; state?: ProviderState }) {
  const [key, setKey] = useState("");
  const [fields, setFields] = useState<Record<string, string>>(state?.settings ?? {});
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; detail: string } | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [command, setCommand] = useState("");

  useEffect(() => { setKey(""); setFields(state?.settings ?? {}); setTest(null); setAdvanced(false); }, [spec.id]);
  useEffect(() => {
    if (spec.kind !== "cli") { setCommand(""); return; }
    void store.rpc<string>("providers.command", { id: spec.id }).then(setCommand).catch(() => setCommand(""));
  }, [spec.id, state?.defaultModel, state?.cli?.bin, state?.cli?.args?.join(" ")]);

  if (!state) return <div style={{ fontSize: 12, color: "var(--ink-4)" }}>Unknown provider.</div>;

  const set = (patch: Partial<ProviderConfig>) => void store.setProviders({ [spec.id]: patch });
  const saveKey = async (value: string) => {
    setBusy(true);
    try { await store.saveKeys({ [spec.id]: value.trim() }); setKey(""); setTest(null); }
    finally { setBusy(false); }
  };
  const saveFields = async () => {
    setBusy(true);
    try { await store.setProviders({ [spec.id]: { settings: fields } }); store.toast("Saved."); }
    finally { setBusy(false); }
  };
  const runTest = async () => {
    setBusy(true); setTest(null);
    try { setTest(await store.testProvider(spec.id, { settings: fields })); }
    catch (e) { setTest({ ok: false, detail: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  const fieldsDirty = JSON.stringify(fields) !== JSON.stringify(state.settings ?? {});
  const showModels = spec.kind !== "cli" || !spec.cli?.fixedModel;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <ProviderMark id={spec.id} size={30} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <b style={{ fontWeight: 600, fontSize: 13 }}>{spec.name}</b>
            <span style={{ fontSize: 11, color: "var(--ink-5)" }}>{spec.by}</span>
            <span className="grow" />
            <Switch on={state.enabled} onChange={(v) => set({ enabled: v })} />
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 2 }}>{spec.blurb}</div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
        <span className="dot" style={{ width: 7, height: 7, background: state.ready ? "var(--green)" : state.enabled ? "var(--amber)" : "var(--ink-6)" }} />
        <span style={{ color: state.ready ? "var(--green)" : "var(--ink-3)" }}>{state.ready ? "Ready" : state.blocker || "Not ready"}</span>
      </div>

      <div style={{ fontSize: 11, color: "var(--ink-5)", lineHeight: 1.5, borderLeft: "2px solid var(--border)", paddingLeft: 8 }}>
        {GROUP_BLURB[spec.group as ProviderGroup]}
      </div>

      {/* ---- credentials ---- */}
      {spec.auth === "login" && (
        <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
          {state.hasLogin ? "Signed in with the Claude Code login on this Mac." : "No Claude login found. Run `claude` in a terminal once to sign in, or paste a key below."}
        </div>
      )}
      {spec.auth === "cli" && spec.cli && (
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", display: "flex", flexDirection: "column", gap: 4 }}>
          <div>{state.cliPath ? <>Found <span className="mono sel" style={{ fontSize: 11 }}>{state.cliPath}</span></> : <>Not installed. Install it with:</>}</div>
          {!state.cliPath && <div className="mono sel" style={{ fontSize: 11, color: "var(--ink-4)" }}>{spec.cli.install}</div>}
          <div style={{ color: "var(--ink-5)" }}>
            {spec.cli.mcp
              ? "It joins the team properly: channels, mentions, questions to you, and a summary when it finishes."
              : "This CLI cannot be handed the team's tools on the command line, so it works one shot at a time — it does the task and its last paragraph becomes the run summary."}
          </div>
        </div>
      )}
      {spec.auth === "cloud" && (
        <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
          Uses this Mac's {spec.id === "bedrock" ? "AWS" : "Google Cloud"} credentials. Nothing is stored by StandBye.
        </div>
      )}
      {(spec.auth === "key" || spec.auth === "login") && (
        <div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              className="field mono" type="password" style={{ flex: 1, minWidth: 0 }}
              placeholder={state.hasKey ? "Replace API key" : spec.keyPlaceholder ?? "API key"}
              value={key} onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && key.trim() && void saveKey(key)}
            />
            <Button onClick={() => void saveKey(key)} disabled={!key.trim() || busy}>Save</Button>
            {state.hasKey && <Button onClick={() => void saveKey("")} disabled={busy}>Remove</Button>}
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-5)", marginTop: 4 }}>
            {state.hasKey ? "A key is saved, encrypted with the macOS keychain. " : ""}
            {spec.keyUrl && <a onClick={() => void window.crew.openPath(spec.keyUrl!)}>Get a key</a>}
            {spec.keyUrl && " · "}
            <a onClick={() => void window.crew.openPath(spec.docsUrl)}>Docs</a>
          </div>
        </div>
      )}

      {/* ---- endpoint, region, project ---- */}
      {(spec.fields ?? []).length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {spec.fields!.map((f) => (
            <div key={f.key}>
              <KV k={f.label}>
                <input className="field mono" style={{ flex: 1, minWidth: 0, fontSize: 11 }} placeholder={f.placeholder} value={fields[f.key] ?? ""} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })} />
              </KV>
              {f.hint && <div style={{ fontSize: 10.5, color: "var(--ink-5)", padding: "0 0 2px 102px" }}>{f.hint}</div>}
            </div>
          ))}
          {fieldsDirty && <div style={{ display: "flex", justifyContent: "flex-end" }}><Button primary sm onClick={() => void saveFields()} disabled={busy}>Save</Button></div>}
        </div>
      )}

      {/* ---- models ---- */}
      {showModels && state.enabled && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <KV k="Default model"><ModelPicker only={spec.id} provider={spec.id} value={state.defaultModel} onChange={(m) => set({ defaultModel: m })} width={240} /></KV>
          <KV k="Check-ins on"><ModelPicker only={spec.id} provider={spec.id} value={state.checkinModel} onChange={(m) => set({ checkinModel: m })} width={240} /></KV>
          <div style={{ fontSize: 10.5, color: "var(--ink-5)", padding: "2px 0 0 102px" }}>
            The default does the real work. Check-ins are the short wake-ups every few minutes; they run on the cheap model and only hand off when there is something to do.
          </div>
        </div>
      )}

      {/* ---- how it is invoked, for CLI providers ---- */}
      {spec.kind === "cli" && spec.cli && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <a style={{ fontSize: 11 }} onClick={() => setAdvanced(!advanced)}>{advanced ? "Hide" : "Show"} the command StandBye runs</a>
          {advanced && (
            <>
              <pre className="mono sel" style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: 8, fontSize: 10.5, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{command || "…"}</pre>
              <CliOverride spec={spec} state={state} onSave={(cli) => set({ cli })} />
            </>
          )}
        </div>
      )}

      {/* ---- test ---- */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
        <Button onClick={() => void runTest()} disabled={busy}>{busy ? "Testing…" : "Test connection"}</Button>
        {test && (
          <span style={{ fontSize: 11, color: test.ok ? "var(--green)" : "var(--red, #c0392b)", flex: 1, minWidth: 0 }}>
            {test.ok ? "✓ " : "✗ "}{test.detail}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The escape hatch. Vendors rename their headless flag now and then, and when that happens the
 * fix should be one field in Settings rather than waiting for a release.
 */
function CliOverride({ spec, state, onSave }: { spec: ProviderSpec; state: ProviderState; onSave: (cli: { bin?: string; args?: string[] }) => void }) {
  const [bin, setBin] = useState(state.cli?.bin ?? spec.cli!.bin);
  const [args, setArgs] = useState((state.cli?.args ?? spec.cli!.args).join(" "));
  const dirty = bin !== (state.cli?.bin ?? spec.cli!.bin) || args !== (state.cli?.args ?? spec.cli!.args).join(" ");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <KV k="Binary"><input className="field mono" style={{ flex: 1, fontSize: 11 }} value={bin} onChange={(e) => setBin(e.target.value)} /></KV>
      <KV k="Arguments"><input className="field mono" style={{ flex: 1, fontSize: 11 }} value={args} onChange={(e) => setArgs(e.target.value)} /></KV>
      <div style={{ fontSize: 10.5, color: "var(--ink-5)", padding: "0 0 0 102px" }}>
        <span className="mono">{"{prompt}"}</span>, <span className="mono">{"{model}"}</span> and <span className="mono">{"{cwd}"}</span> are filled in. An argument that ends up empty takes the flag in front of it with it.
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
        {(state.cli?.bin || state.cli?.args) && <Button sm onClick={() => { setBin(spec.cli!.bin); setArgs(spec.cli!.args.join(" ")); onSave({}); }}>Reset</Button>}
        <Button sm primary disabled={!dirty} onClick={() => onSave({ bin: bin.trim(), args: args.trim().split(/\s+/).filter(Boolean) })}>Save</Button>
      </div>
    </div>
  );
}
