import { useEffect, useState } from "react";
import { store, useStore } from "../state/store";
import { Button, KV, Segmented } from "../ui/kit";
import { ProvidersPanel } from "../components/ProvidersPanel";
import { Ic } from "../ui/icons";

type Tab = "team" | "providers" | "data";

export function KeysSheet() {
  const team = useStore((s) => s.team);
  const [tab, setTab] = useState<Tab>(team ? "team" : "providers");
  const [dataDir, setDataDir] = useState("");
  useEffect(() => { void window.crew.dataDir().then(setDataDir); }, []);

  return (
    <div className="sheet" style={{ width: 660, height: 600 }}>
      <div className="sheet-h">
        <b>Settings</b>
        <Segmented value={tab} onChange={setTab} options={[{ value: "team", label: "Team" }, { value: "providers", label: "Providers" }, { value: "data", label: "Data" }]} />
        <span className="grow" />
      </div>
      <div className="sheet-body scroll" style={{ flexDirection: "column", padding: "18px 20px", gap: 16 }}>
        {tab === "team" && (team ? <TeamSettings /> : <div className="empty" style={{ fontSize: 12 }}>No team yet.</div>)}
        {tab === "providers" && (
          <>
            <div style={{ fontSize: 12, color: "var(--ink-4)" }}>Keys are encrypted with the macOS keychain and only ever sent to the provider itself.</div>
            <ProvidersPanel />
          </>
        )}
        {tab === "data" && (
          <div style={{ fontSize: 12, color: "var(--ink-3)", display: "flex", flexDirection: "column", gap: 10 }}>
            <div>Data folder: <span className="mono sel">{dataDir}</span> · <a onClick={() => void window.crew.openPath(dataDir)}>Show in Finder</a></div>
            <div>Agents are folders in there: <span className="mono">agent.json</span>, <span className="mono">SOUL.md</span>, <span className="mono">RULES.md</span>, <span className="mono">MEMORY.md</span>, <span className="mono">skills/</span>. Edit them by hand any time; the next run picks it up. Channels, questions and runs live in <span className="mono">crew.db</span>.</div>
            <div style={{ marginTop: 8 }}>
              <div className="grp-t">Join from Claude Code</div>
              <div>Any MCP client can act as a teammate. Register this stdio server in Claude Code with the agent id it should act as:</div>
              <pre className="mono sel" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: 10, fontSize: 11, overflowX: "auto", margin: "6px 0 0" }}>{`CREW_AGENT=kai CREW_PORT=<port> CREW_TOKEN=<token> node <app>/packages/supervisor/dist/mcp/stdio.js`}</pre>
            </div>
            {team && (
              <div style={{ marginTop: "auto", paddingTop: 12 }}>
                <Button danger onClick={() => { if (confirm("Delete the whole team, its agents and channels? Run history is kept.")) void store.deleteTeam().then(() => store.openSheet({ kind: "onboarding" })); }}>Delete Team…</Button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="sheet-f">
        <span className="grow" />
        <Button lg primary onClick={() => store.openSheet(team ? { kind: "none" } : { kind: "onboarding" })}>Done</Button>
      </div>
    </div>
  );
}

function TeamSettings() {
  const team = useStore((s) => s.team)!;
  const [name, setName] = useState(team.name);
  const [owner, setOwner] = useState(team.ownerName);
  const [charter, setCharter] = useState(team.charter);
  const [cap, setCap] = useState(String(team.dailyCapUsd));
  const [depth, setDepth] = useState(String(team.chatDepthCap));
  useEffect(() => { setName(team.name); setOwner(team.ownerName); setCharter(team.charter); setCap(String(team.dailyCapUsd)); setDepth(String(team.chatDepthCap)); }, [team.id]);
  const dirty = name !== team.name || owner !== team.ownerName || charter !== team.charter || Number(cap) !== team.dailyCapUsd || Number(depth) !== team.chatDepthCap;
  const save = async () => {
    await store.rpc("team.update", { name: name.trim() || team.name, ownerName: owner.trim() || team.ownerName, charter: charter.trim(), dailyCapUsd: Math.max(0, Number(cap) || 0), chatDepthCap: Math.max(1, Math.round(Number(depth) || 6)) });
    store.toast("Team settings saved.");
  };
  const pickWorkspace = async () => { const p = await window.crew.pickFolder(); if (p) { await store.rpc("team.update", { workspaceRoot: p }); store.toast("Workspace changed for future runs."); } };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", padding: "8px 12px" }}>
        <KV k="Team name"><input className="field" value={name} onChange={(e) => setName(e.target.value)} /></KV>
        <KV k="Your name"><input className="field" value={owner} onChange={(e) => setOwner(e.target.value)} /></KV>
        <KV k="Workspace">
          <span className="mono cell" style={{ fontSize: 11, color: "var(--ink-3)", flex: 1 }}>{team.workspaceRoot ?? "none"}</span>
          <Button sm icon={<Ic.Folder size={12} />} onClick={() => void pickWorkspace()}>Change…</Button>
        </KV>
      </div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", padding: "8px 12px" }}>
        <div className="grp-t" style={{ marginTop: 4 }}>Charter</div>
        <textarea className="field" style={{ width: "100%", minHeight: 70 }} value={charter} onChange={(e) => setCharter(e.target.value)} />
        <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 4 }}>The standing goal every agent sees in its context. Two or three sentences.</div>
      </div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", padding: "8px 12px" }}>
        <KV k="Team cap"><span className="mono" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 3 }}>$<input className="field mono" style={{ width: 64 }} value={cap} onChange={(e) => setCap(e.target.value)} /><span style={{ color: "var(--ink-5)", fontSize: 11 }}>/ day, all agents together</span></span></KV>
        <KV k="Chat depth"><span className="mono" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 3 }}><input className="field mono" style={{ width: 48 }} value={depth} onChange={(e) => setDepth(e.target.value)} /><span style={{ color: "var(--ink-5)", fontSize: 11 }}>agent-to-agent replies before a thread stops waking people</span></span></KV>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button primary onClick={() => void save()} disabled={!dirty}>Save</Button>
      </div>
    </div>
  );
}
