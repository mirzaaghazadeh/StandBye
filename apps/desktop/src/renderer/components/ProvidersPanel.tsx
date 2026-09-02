import { useState } from "react";
import { store, useStore } from "../state/store";
import { Button, Switch } from "../ui/kit";

/**
 * Provider switches used by the first-open wizard and by Settings.
 * Claude can run on the Claude Code login on this Mac or on an API key; OpenRouter needs a key.
 */
export function ProvidersPanel() {
  const providers = useStore((s) => s.providers);
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  if (!providers) return <div style={{ color: "var(--ink-4)", fontSize: 12 }}>Loading…</div>;

  const saveKey = async (which: "anthropic" | "openrouter", value: string) => {
    setBusy(which);
    try { await store.saveKeys({ [which]: value.trim() }); if (which === "anthropic") setAnthropicKey(""); else setOpenrouterKey(""); }
    finally { setBusy(null); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <ProviderRow
        title="Claude"
        enabled={providers.anthropic.enabled}
        onToggle={(v) => void store.setProviders({ anthropic: { enabled: v } })}
        ready={providers.anthropic.ready}
        status={
          providers.anthropic.hasKey ? "API key saved"
          : providers.anthropic.hasLogin ? "Using the Claude Code login on this Mac"
          : "Sign in to Claude Code once, or paste an API key"
        }
        hint="Opus 5 for real work, Haiku 4.5 for check-ins. The login covers the agents; the team builder needs an API key."
      >
        <div style={{ display: "flex", gap: 6 }}>
          <input className="field mono" type="password" placeholder={providers.anthropic.hasKey ? "Replace API key" : "sk-ant-… (optional with a login)"} value={anthropicKey} onChange={(e) => setAnthropicKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && anthropicKey.trim() && void saveKey("anthropic", anthropicKey)} />
          <Button onClick={() => void saveKey("anthropic", anthropicKey)} disabled={!anthropicKey.trim() || busy === "anthropic"}>Save</Button>
          {providers.anthropic.hasKey && <Button onClick={() => void saveKey("anthropic", "")}>Remove</Button>}
        </div>
      </ProviderRow>

      <ProviderRow
        title="OpenRouter"
        enabled={providers.openrouter.enabled}
        onToggle={(v) => void store.setProviders({ openrouter: { enabled: v } })}
        ready={providers.openrouter.ready}
        status={providers.openrouter.hasKey ? "API key saved" : "Paste an API key"}
        hint="Hundreds of tool-capable models from one key. GLM 5.3 by default; good for reviewers, testers and docs."
      >
        <div style={{ display: "flex", gap: 6 }}>
          <input className="field mono" type="password" placeholder={providers.openrouter.hasKey ? "Replace API key" : "sk-or-…"} value={openrouterKey} onChange={(e) => setOpenrouterKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && openrouterKey.trim() && void saveKey("openrouter", openrouterKey)} />
          <Button onClick={() => void saveKey("openrouter", openrouterKey)} disabled={!openrouterKey.trim() || busy === "openrouter"}>Save</Button>
          {providers.openrouter.hasKey && <Button onClick={() => void saveKey("openrouter", "")}>Remove</Button>}
        </div>
      </ProviderRow>

      <ProviderRow title="Other OpenAI-compatible" enabled={false} onToggle={() => undefined} ready={false} status="Coming next: Ollama, LM Studio, any base URL" hint="" disabled />
    </div>
  );
}

function ProviderRow({ title, enabled, onToggle, ready, status, hint, children, disabled }: {
  title: string; enabled: boolean; onToggle: (v: boolean) => void; ready: boolean; status: string; hint: string; children?: React.ReactNode; disabled?: boolean;
}) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)", padding: "10px 12px", opacity: disabled ? 0.55 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Switch on={enabled} onChange={disabled ? () => undefined : onToggle} />
        <b style={{ fontWeight: 600 }}>{title}</b>
        <span className="dot" style={{ width: 7, height: 7, background: ready ? "var(--green)" : enabled ? "var(--amber)" : "var(--ink-6)" }} />
        <span style={{ fontSize: 11, color: "var(--ink-4)" }}>{status}</span>
      </div>
      {enabled && children && <div style={{ marginTop: 8 }}>{children}</div>}
      {enabled && hint && <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 6 }}>{hint}</div>}
    </div>
  );
}
