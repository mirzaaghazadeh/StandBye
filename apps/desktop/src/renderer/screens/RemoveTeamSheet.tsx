import { useState } from "react";
import { store, useStore } from "../state/store";
import { Button } from "../ui/kit";
import { Ic } from "../ui/icons";

/**
 * Removing a team is really two different acts, so this asks which one.
 *
 * Stopping is the safe one and the default: the team leaves the list, its scheduler stops,
 * and nothing it owns is touched. Being on the list is exactly what lets a team wake up and
 * work in the background, so taking it off the list is the off switch.
 *
 * Deleting is the other one, and it is not undoable, so it asks for the team's name first.
 */
export function RemoveTeamSheet({ teamId }: { teamId: string }) {
  const live = useStore((s) => s.teams.find((t) => t.id === teamId));
  const stopped = useStore((s) => s.archived.find((t) => t.id === teamId));
  // A team that is already stopped has only one thing left that can be done to it.
  const [mode, setMode] = useState<"stop" | "delete">(live ? "stop" : "delete");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const team = live
    ? { ...live, alreadyStopped: false }
    : stopped
      ? { id: stopped.id, name: stopped.name, dir: stopped.dir, portable: stopped.portable, working: 0, alreadyStopped: true }
      : null;
  if (!team) return null;

  const confirmed = typed.trim() === team.name;
  const go = async () => {
    setBusy(true);
    try {
      if (mode === "stop") await store.archiveTeam(team.id);
      else await store.deleteTeam(team.id);
    } catch (e) {
      store.toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet" style={{ width: 520, height: team.alreadyStopped ? 360 : 428 }}>
      <div className="sheet-h">
        <b>{team.alreadyStopped ? `Delete ${team.name}?` : `Remove ${team.name}?`}</b>
      </div>
      <div className="sheet-body" style={{ flexDirection: "column", padding: "16px 20px", gap: 10, overflowY: "auto" }}>
        {!team.alreadyStopped && (
          <Choice
            on={mode === "stop"}
            onPick={() => setMode("stop")}
            icon={<Ic.Pause size={14} stroke={mode === "stop" ? "var(--accent)" : "var(--ink-4)"} />}
            title="Stop it and keep everything"
            body={
              team.portable
                ? `It comes off the list, so it stops waking up, running and spending. Its agents, memory and history stay in ${team.dir}, and Open folder… brings it back whenever you want it.`
                : "It comes off the list, so it stops waking up, running and spending. Everything it has done is kept, and you can put it back from this same menu."
            }
          />
        )}
        {team.alreadyStopped && (
          <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
            {team.name} is already stopped, so it is not running or spending anything. The only thing left is to erase it.
          </div>
        )}
        <Choice
          on={mode === "delete"}
          onPick={() => setMode("delete")}
          icon={<Ic.Trash size={14} stroke={mode === "delete" ? "var(--danger, #b3261e)" : "var(--ink-4)"} />}
          title="Delete it and everything it did"
          body={`Erases ${team.dir}: the agents, their memory, every message and every run. This cannot be undone.`}
          danger
        />
        {mode === "delete" && (
          <div style={{ borderTop: "1px solid var(--border-faint)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Type <b>{team.name}</b> to confirm.</span>
            <input
              className="field"
              style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", background: "var(--surface)" }}
              value={typed}
              autoFocus
              placeholder={team.name}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
        )}
        {team.working > 0 && (
          <div style={{ fontSize: 12, color: "var(--ink-3)", background: "#fdf5e6", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 10px" }}>
            {team.working === 1 ? "1 agent is working right now." : `${team.working} agents are working right now.`} Their run is stopped either way.
          </div>
        )}
      </div>
      <div className="sheet-f">
        <span className="grow" />
        <Button lg onClick={() => store.closeSheet()} disabled={busy}>Cancel</Button>
        {mode === "stop" && !team.alreadyStopped
          ? <Button lg primary onClick={() => void go()} disabled={busy}>Stop Team</Button>
          : <Button lg danger onClick={() => void go()} disabled={busy || !confirmed}>Delete Forever</Button>}
      </div>
    </div>
  );
}

function Choice({ on, onPick, icon, title, body, danger }: { on: boolean; onPick: () => void; icon: React.ReactNode; title: string; body: string; danger?: boolean }) {
  return (
    <button
      onClick={onPick}
      style={{
        display: "flex", gap: 10, textAlign: "left", alignItems: "flex-start", width: "100%", cursor: "default",
        border: `1px solid ${on ? (danger ? "var(--danger, #b3261e)" : "var(--accent)") : "var(--border)"}`,
        boxShadow: on ? `0 0 0 2px ${danger ? "rgba(179,38,30,0.14)" : "rgba(60,110,230,0.14)"}` : "none",
        borderRadius: 8, background: "var(--surface)", padding: "10px 12px",
      }}
    >
      <span style={{ marginTop: 1, flexShrink: 0 }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: 600, fontSize: 13, color: danger && on ? "var(--danger, #b3261e)" : "var(--ink-1)" }}>{title}</span>
        <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-4)", lineHeight: 1.45, marginTop: 2, wordBreak: "break-word" }}>{body}</span>
      </span>
    </button>
  );
}
