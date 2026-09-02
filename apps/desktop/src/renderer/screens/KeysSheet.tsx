import { useEffect, useState } from "react";
import { store, useStore } from "../state/store";
import { Button } from "../ui/kit";
import { ProvidersPanel } from "../components/ProvidersPanel";

export function KeysSheet() {
  const team = useStore((s) => s.team);
  const [dataDir, setDataDir] = useState("");
  useEffect(() => { void window.crew.dataDir().then(setDataDir); }, []);

  return (
    <div className="sheet" style={{ width: 620, height: 560 }}>
      <div className="sheet-h"><b>Settings</b><span style={{ fontSize: 12, color: "var(--ink-4)" }}>Providers and keys. Keys are encrypted with the macOS keychain and only sent to the provider itself.</span></div>
      <div className="sheet-body" style={{ flexDirection: "column", padding: "18px 20px", gap: 16, overflowY: "auto" }}>
        <ProvidersPanel />
        <div style={{ fontSize: 12, color: "var(--ink-4)", marginTop: "auto" }}>
          Data folder: <span className="mono sel">{dataDir}</span> · <a onClick={() => void window.crew.openPath(dataDir)}>Show in Finder</a>
          <div style={{ marginTop: 6 }}>Agents are folders in there. Edit a SOUL.md by hand any time; the next run picks it up.</div>
        </div>
      </div>
      <div className="sheet-f">
        {team && <Button danger onClick={() => { if (confirm("Delete the whole team, its agents and channels? Run history is kept.")) void store.deleteTeam().then(() => store.openSheet({ kind: "onboarding" })); }}>Delete Team…</Button>}
        <span className="grow" />
        <Button lg primary onClick={() => store.openSheet(team ? { kind: "none" } : { kind: "onboarding" })}>Done</Button>
      </div>
    </div>
  );
}
