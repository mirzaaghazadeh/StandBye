import { useEffect, useState } from "react";
import { store, useStore } from "../state/store";
import { Button } from "../ui/kit";

export function KeysSheet() {
  const keys = useStore((s) => s.keys);
  const team = useStore((s) => s.team);
  const [anthropic, setAnthropic] = useState("");
  const [openrouter, setOpenrouter] = useState("");
  const [dataDir, setDataDir] = useState("");
  useEffect(() => { void window.crew.dataDir().then(setDataDir); }, []);

  const save = async () => {
    const patch: Record<string, string> = {};
    if (anthropic.trim()) patch.anthropic = anthropic.trim();
    if (openrouter.trim()) patch.openrouter = openrouter.trim();
    if (Object.keys(patch).length) await store.saveKeys(patch);
    setAnthropic(""); setOpenrouter("");
    if (!team) store.openSheet({ kind: "builder" });
    else store.closeSheet();
  };

  return (
    <div className="sheet" style={{ width: 560, height: 440 }}>
      <div className="sheet-h"><b>Settings</b><span style={{ fontSize: 12, color: "var(--ink-4)" }}>Bring your own keys. They're encrypted with your OS keychain and never leave this Mac except to the provider.</span></div>
      <div className="sheet-body" style={{ flexDirection: "column", padding: "18px 20px", gap: 16 }}>
        <KeyRow label="Anthropic" hint="Claude Opus 5 for real work, Haiku 4.5 for check-ins. Powers the Claude runner and the team builder." present={keys.anthropic} value={anthropic} onChange={setAnthropic} placeholder="sk-ant-…" onClear={() => void store.saveKeys({ anthropic: "" })} />
        <KeyRow label="OpenRouter" hint="Any tool-capable model, default GLM 5.3. Cheaper agents for review, tests and docs." present={keys.openrouter} value={openrouter} onChange={setOpenrouter} placeholder="sk-or-…" onClear={() => void store.saveKeys({ openrouter: "" })} />
        <div style={{ fontSize: 12, color: "var(--ink-4)", marginTop: "auto" }}>
          Data folder: <span className="mono sel">{dataDir}</span> · <a onClick={() => void window.crew.openPath(dataDir)}>Show in Finder</a>
          <div style={{ marginTop: 6 }}>Agents are folders in there. Edit a SOUL.md by hand any time; the next run picks it up.</div>
        </div>
      </div>
      <div className="sheet-f">
        {team && <Button danger onClick={() => { if (confirm("Delete the whole team, its agents and channels? Runs history is kept.")) void store.deleteTeam().then(() => store.closeSheet()); }}>Delete Team…</Button>}
        <span className="grow" />
        <Button lg onClick={() => (team ? store.closeSheet() : store.openSheet({ kind: "builder" }))}>{team ? "Cancel" : "Skip"}</Button>
        <Button lg primary onClick={() => void save()} disabled={!anthropic.trim() && !openrouter.trim() && !(keys.anthropic || keys.openrouter)}>{team ? "Save" : "Continue"}</Button>
      </div>
    </div>
  );
}

function KeyRow({ label, hint, present, value, onChange, placeholder, onClear }: { label: string; hint: string; present: boolean; value: string; onChange: (v: string) => void; placeholder: string; onClear: () => void }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span className="dot dot-lg" style={{ background: present ? "var(--green)" : "var(--ink-6)" }} />
        <b style={{ fontWeight: 600 }}>{label}</b>
        <span style={{ fontSize: 11, color: "var(--ink-4)" }}>{present ? "key saved" : "no key"}</span>
        {present && <a style={{ fontSize: 11, marginLeft: "auto" }} onClick={onClear}>Remove</a>}
      </div>
      <input className="field field-lg mono" type="password" placeholder={present ? "Paste a new key to replace" : placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      <div style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 6 }}>{hint}</div>
    </div>
  );
}
