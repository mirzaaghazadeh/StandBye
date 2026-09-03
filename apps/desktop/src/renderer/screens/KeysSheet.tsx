import { useEffect, useState } from "react";
import { store, useStore } from "../state/store";
import { Button, KV, Progress, Segmented, Switch, ago } from "../ui/kit";
import { ProvidersPanel } from "../components/ProvidersPanel";
import { GitSettingsPanel } from "../components/GitSettingsPanel";
import { Ic } from "../ui/icons";
import type { Autonomy, GitSettings } from "@crew/shared";
import { AUTONOMY_LABEL, AUTONOMY_RULE } from "@crew/shared";

type Tab = "team" | "providers" | "data" | "updates";

export function KeysSheet({ tab: initialTab }: { tab?: Tab }) {
  const team = useStore((s) => s.team);
  const [tab, setTab] = useState<Tab>(initialTab ?? (team ? "team" : "providers"));
  const [dataDir, setDataDir] = useState("");
  const [keepWorking, setKeepWorking] = useState(false);
  useEffect(() => { void window.crew.dataDir().then(setDataDir); }, []);
  useEffect(() => { void window.crew.settingsGet().then((s) => setKeepWorking(s.keepWorkingWhenClosed)); }, []);

  return (
    // The providers browser is two panes, so it needs the room; the other tabs read better narrow.
    <div className="sheet" style={{ width: tab === "providers" ? 860 : 660, height: 600 }}>
      <div className="sheet-h">
        <b>Settings</b>
        <Segmented value={tab} onChange={setTab} options={[{ value: "team", label: "Team" }, { value: "providers", label: "Providers" }, { value: "data", label: "Data" }, { value: "updates", label: "Updates" }]} />
        <span className="grow" />
      </div>
      <div className="sheet-body scroll" style={{ flexDirection: "column", padding: "18px 20px", gap: 16 }}>
        {tab === "team" && (team ? <TeamSettings /> : <div className="empty" style={{ fontSize: 12 }}>No team yet.</div>)}
        {tab === "providers" && (
          <>
            <div style={{ fontSize: 12, color: "var(--ink-4)" }}>Bring what you already pay for. Keys are encrypted with the macOS keychain and only ever sent to the provider itself; a coding-agent CLI keeps its own login and Standbye never sees it.</div>
            <ProvidersPanel />
          </>
        )}
        {tab === "updates" && <UpdatesSettings />}
        {tab === "data" && (
          <div style={{ fontSize: 12, color: "var(--ink-3)", display: "flex", flexDirection: "column", gap: 10 }}>
            <div>Data folder: <span className="mono sel">{dataDir}</span> · <a onClick={() => void window.crew.openPath(dataDir)}>Show in Finder</a></div>
            <div>Agents are folders in there: <span className="mono">agent.json</span>, <span className="mono">SOUL.md</span>, <span className="mono">RULES.md</span>, <span className="mono">MEMORY.md</span>, <span className="mono">skills/</span>. Edit them by hand any time; the next run picks it up. Channels, questions and runs live in <span className="mono">crew.db</span>.</div>
            <div style={{ marginTop: 8, border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <Switch on={keepWorking} onChange={(v) => { setKeepWorking(v); void window.crew.settingsSet({ keepWorkingWhenClosed: v }); }} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 500, fontSize: 12.5 }}>Keep working when Standbye is closed</span>
                  <span style={{ display: "block", fontSize: 11, color: "var(--ink-4)", lineHeight: 1.45 }}>
                    {keepWorking
                      ? "Agents keep checking in, running and spending after you quit. Reopening attaches to the same session."
                      : "Quitting stops the team. Nothing runs and nothing is spent until you open Standbye again."}
                  </span>
                </span>
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              <div className="grp-t">Join from Claude Code</div>
              <div>Any MCP client can act as a teammate. Register this stdio server in Claude Code with the agent id it should act as:</div>
              <pre className="mono sel" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: 10, fontSize: 11, overflowX: "auto", margin: "6px 0 0" }}>{`CREW_AGENT=kai CREW_PORT=<port> CREW_TOKEN=<token> node <app>/packages/supervisor/dist/mcp/stdio.js`}</pre>
            </div>
            {team && (
              <div style={{ marginTop: "auto", paddingTop: 12 }}>
                <Button danger onClick={() => store.openSheet({ kind: "removeTeam", teamId: team.id })}>Remove This Team…</Button>
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

/**
 * What Standbye knows about newer versions of itself. The main process does the work and owns the
 * state; this panel only ever shows it and offers the one action that makes sense right now.
 */
function UpdatesSettings() {
  const u = useStore((s) => s.update);
  if (!u) return <div className="empty" style={{ fontSize: 12 }}>Loading…</div>;
  const v = u.release?.version;

  const line = (() => {
    if (u.stage === "checking") return "Checking for updates…";
    if (u.stage === "downloading") return `Downloading Standbye ${v}…`;
    if (u.stage === "ready") return `Standbye ${v} is ready to install.`;
    if (u.stage === "available") return `Standbye ${v} is available.`;
    if (u.stage === "error") return v ? `Could not download Standbye ${v}.` : "Could not check for updates.";
    return `Standbye ${u.current} is the latest version.`;
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 12, color: "var(--ink-3)" }}>
      <div style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: "block", fontWeight: 600, fontSize: 13, color: "var(--ink-1)" }}>{line}</span>
            <span style={{ display: "block", fontSize: 11, color: "var(--ink-4)", marginTop: 2 }}>
              You are running {u.current}
              {u.checkedAt ? ` · checked ${ago(u.checkedAt)}` : ""}
            </span>
          </span>
          {u.stage === "ready" && <Button primary onClick={() => void window.crew.updates.install()}>Restart &amp; Install</Button>}
          {u.stage === "available" && u.canInstall && <Button primary onClick={() => void window.crew.updates.download()}>Download</Button>}
          {u.stage === "available" && !u.canInstall && u.release && <Button primary onClick={() => void window.crew.openPath(u.release!.url)}>Get It…</Button>}
          {u.stage === "error" && <Button onClick={() => void window.crew.updates.check()}>Try Again</Button>}
          {u.stage === "idle" && <Button onClick={() => void window.crew.updates.check()}>Check Now</Button>}
        </div>
        {u.stage === "downloading" && (
          <div style={{ marginTop: 10 }}>
            <Progress value={u.progress} max={1} />
            <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 4 }}>{Math.round(u.progress * 100)}% of {u.release?.assetName}</div>
          </div>
        )}
        {u.stage === "ready" && (
          <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 8, lineHeight: 1.5 }}>
            Nothing is replaced until Standbye closes, so a run in progress is safe. It also installs
            by itself the next time you quit.
          </div>
        )}
        {u.stage === "error" && u.error && <div style={{ fontSize: 11, color: "var(--red-ink)", marginTop: 8 }}>{u.error}</div>}
        {u.stage === "available" && !u.canInstall && (
          <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 8, lineHeight: 1.5 }}>
            This build cannot replace itself — a development run, a Linux <span className="mono">.deb</span> that belongs
            to your package manager, or a release with no download for this machine. The release page has the file.
          </div>
        )}
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", padding: "10px 12px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <Switch on={u.autoUpdate} onChange={(on) => void window.crew.updates.setAuto(on)} />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontWeight: 500, fontSize: 12.5, color: "var(--ink-1)" }}>Keep Standbye up to date</span>
            <span style={{ display: "block", fontSize: 11, color: "var(--ink-4)", lineHeight: 1.45 }}>
              {u.autoUpdate
                ? "New versions download on their own and install when you restart or quit. Standbye never restarts itself while you are working."
                : "Standbye still tells you when a version is out, but downloads and installs nothing until you ask."}
            </span>
          </span>
        </div>
      </div>

      {u.release?.notes && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", padding: "10px 12px" }}>
          <div className="grp-t" style={{ marginTop: 0 }}>What&rsquo;s new in {u.release.version}</div>
          <div className="scroll" style={{ maxHeight: 180, whiteSpace: "pre-wrap", fontSize: 11.5, lineHeight: 1.55, color: "var(--ink-3)" }}>{u.release.notes}</div>
          <div style={{ marginTop: 8 }}><a onClick={() => u.release && void window.crew.openPath(u.release.url)}>Open the release page</a></div>
        </div>
      )}
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
  const [workspace, setWorkspace] = useState(team.workspaceRoot ?? "");
  const [git, setGit] = useState<GitSettings | null>(team.git ?? null);
  const [autonomy, setAutonomy] = useState<Autonomy>(team.autonomy ?? "pr");
  useEffect(() => { setName(team.name); setOwner(team.ownerName); setCharter(team.charter); setCap(String(team.dailyCapUsd)); setDepth(String(team.chatDepthCap)); setWorkspace(team.workspaceRoot ?? ""); setGit(team.git ?? null); setAutonomy(team.autonomy ?? "pr"); }, [team.id]);
  const dirty = name !== team.name || owner !== team.ownerName || charter !== team.charter || Number(cap) !== team.dailyCapUsd || Number(depth) !== team.chatDepthCap || (workspace.trim() || null) !== team.workspaceRoot || JSON.stringify(git) !== JSON.stringify(team.git ?? null) || autonomy !== (team.autonomy ?? "pr");
  const save = async () => {
    const t = await store.rpc<typeof team>("team.update", { name: name.trim() || team.name, ownerName: owner.trim() || team.ownerName, charter: charter.trim(), dailyCapUsd: Math.max(0, Number(cap) || 0), chatDepthCap: Math.max(1, Math.round(Number(depth) || 6)), workspaceRoot: workspace.trim() || null, git, autonomy });
    store.toast(t.workspaceRoot !== team.workspaceRoot ? "Saved. New runs use the new workspace." : "Team settings saved.");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", padding: "8px 12px" }}>
        <KV k="Team name"><input className="field" value={name} onChange={(e) => setName(e.target.value)} /></KV>
        <KV k="Your name"><input className="field" value={owner} onChange={(e) => setOwner(e.target.value)} /></KV>
        <KV k="Workspace">
          <input className="field mono" style={{ flex: 1, fontSize: 11 }} placeholder="/path/to/the/repo this team works in" value={workspace} onChange={(e) => setWorkspace(e.target.value)} />
          <Button sm icon={<Ic.Folder size={12} />} onClick={() => void window.crew.pickFolder().then((p) => p && setWorkspace(p))}>Choose…</Button>
        </KV>
        <div style={{ fontSize: 11, color: "var(--ink-4)", padding: "0 0 6px 102px" }}>This team's working directory. Agents run and edit files only inside it.</div>
      </div>
      <GitSettingsPanel workspace={workspace.trim() || null} value={git} onChange={setGit} />
      <div style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", padding: "8px 12px" }}>
        <div className="grp-t" style={{ marginTop: 4 }}>Charter</div>
        <textarea className="field" style={{ width: "100%", minHeight: 70 }} value={charter} onChange={(e) => setCharter(e.target.value)} />
        <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 4 }}>The standing goal every agent sees in its context. Two or three sentences.</div>
      </div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", padding: "8px 12px" }}>
        <div className="grp-t" style={{ marginTop: 4 }}>How much they decide alone</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "2px 0 8px" }}>
          {(["propose", "pr", "auto"] as Autonomy[]).map((level) => (
            <label key={level} style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "default" }}>
              <input type="radio" name="autonomy" checked={autonomy === level} onChange={() => setAutonomy(level)} style={{ marginTop: 2 }} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 500, fontSize: 12.5 }}>{AUTONOMY_LABEL[level]}</span>
                <span style={{ display: "block", fontSize: 11, color: "var(--ink-4)", lineHeight: 1.45 }}>{AUTONOMY_RULE[level]}</span>
              </span>
            </label>
          ))}
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-4)", paddingBottom: 4 }}>
          Agents keep their own backlog either way — they notice work, write it down and rank it. This decides how far they may take it without you.
        </div>
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
