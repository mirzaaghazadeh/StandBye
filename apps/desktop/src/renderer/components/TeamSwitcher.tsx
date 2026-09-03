import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { store, useStore } from "../state/store";
import { Ic } from "../ui/icons";

/** Sidebar header: the active team, and a floating menu to switch, open, stop or start one. */
export function TeamSwitcher() {
  const teams = useStore((s) => s.teams);
  const archived = useStore((s) => s.archived);
  const active = useStore((s) => s.activeTeamId);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const current = teams.find((t) => t.id === active);

  useEffect(() => {
    if (!open) return;
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.left });
    void store.loadArchived(); // only the switcher shows stopped teams, so only it pays for the call
    const onDoc = (e: MouseEvent) => { const t = e.target as Node; if (!panel.current?.contains(t) && !btn.current?.contains(t)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <>
      <button ref={btn} className="side-ws" style={{ border: "none", width: "calc(100% - 24px)", textAlign: "left", cursor: "default" }} onClick={() => setOpen((o) => !o)}>
        <span style={{ width: 20, height: 20, borderRadius: 5, background: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Ic.Team size={12} stroke="#fff" />
        </span>
        <span className="side-ws-name">{current?.name ?? "No team yet"}</span>
        <span style={{ fontSize: 11, color: "var(--ink-5)", flexShrink: 0 }}>{current ? `${current.working} working` : ""}</span>
        <Ic.UpDown size={12} stroke="#8C887F" strokeWidth={2.4} />
      </button>
      {open && createPortal(
        <div ref={panel} style={{ position: "fixed", top: pos.top, left: pos.left, width: 300, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 10px 30px rgba(0,0,0,0.18)", zIndex: 100, padding: "6px 0", maxHeight: 460, overflowY: "auto" }}>
          <div className="li-sec" style={{ background: "transparent", borderBottom: "none", paddingTop: 6 }}>Working</div>
          {teams.map((t) => (
            <div key={t.id} className={"li" + (t.id === active ? " li-sel" : "")} style={{ padding: 0, alignItems: "stretch", display: "flex" }}>
              <button style={{ flex: 1, minWidth: 0, display: "flex", gap: 0, alignItems: "center", background: "none", border: "none", textAlign: "left", padding: "7px 0 7px 12px", cursor: "default" }} onClick={() => { setOpen(false); void store.switchTeam(t.id); }}>
                <span style={{ width: 14, display: "inline-flex", justifyContent: "center", flexShrink: 0 }}>{t.id === active && <Ic.Check size={12} stroke="var(--accent)" strokeWidth={3} />}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="cell" style={{ display: "block", fontWeight: 500 }}>{t.name}</span>
                  <span className="cell" style={{ display: "block", fontSize: 10.5, color: "var(--ink-5)" }}>{t.agentCount} agents · {t.working} working{t.needsYou ? ` · ${t.needsYou} need you` : ""} · <span className="mono">${t.spendTodayUsd.toFixed(2)}</span> today</span>
                  <span className="cell mono" style={{ display: "block", fontSize: 10, color: "var(--ink-5)" }}>{t.workspaceRoot ?? "no workspace"}</span>
                </span>
              </button>
              {t.pausedAll && <span className="pill" style={{ alignSelf: "center" }}>Paused</span>}
              <button
                title={`Remove ${t.name} from this list`}
                aria-label={`Remove ${t.name}`}
                style={{ flexShrink: 0, background: "none", border: "none", padding: "0 10px", cursor: "default", display: "flex", alignItems: "center" }}
                onClick={(e) => { e.stopPropagation(); setOpen(false); store.openSheet({ kind: "removeTeam", teamId: t.id }); }}
              >
                <Ic.X size={12} stroke="var(--ink-5)" />
              </button>
            </div>
          ))}
          {teams.length === 0 && <div style={{ padding: "6px 14px 8px", fontSize: 11.5, color: "var(--ink-5)" }}>Nothing is running. Open a folder or start a team.</div>}

          {archived.length > 0 && (
            <>
              <div className="li-sec" style={{ background: "transparent", borderBottom: "none", paddingTop: 8 }} title="Stopped teams keep all their files but never wake up on their own">Stopped</div>
              {archived.map((a) => (
                <div key={a.id} className="li" style={{ padding: 0, alignItems: "stretch", display: "flex", opacity: a.present ? 0.85 : 0.5 }}>
                  <button
                    disabled={!a.present}
                    title={a.present ? `Put ${a.name} back to work` : `${a.name} is no longer in ${a.dir}`}
                    style={{ flex: 1, minWidth: 0, display: "flex", gap: 0, alignItems: "center", background: "none", border: "none", textAlign: "left", padding: "7px 0 7px 12px", cursor: "default" }}
                    onClick={() => { setOpen(false); void store.restoreTeam(a.id); }}
                  >
                    <span style={{ width: 14, display: "inline-flex", justifyContent: "center", flexShrink: 0 }}><Ic.Archive size={11} stroke="var(--ink-5)" /></span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="cell" style={{ display: "block", fontWeight: 500 }}>{a.name}</span>
                      <span className="cell" style={{ display: "block", fontSize: 10.5, color: "var(--ink-5)" }}>{a.present ? `${a.agentCount} agents · click to start again` : "folder missing"}</span>
                      <span className="cell mono" style={{ display: "block", fontSize: 10, color: "var(--ink-5)" }}>{a.workspaceRoot ?? a.dir}</span>
                    </span>
                  </button>
                  <button
                    title={`Delete ${a.name} and everything it did`}
                    aria-label={`Delete ${a.name}`}
                    style={{ flexShrink: 0, background: "none", border: "none", padding: "0 10px", cursor: "default", display: "flex", alignItems: "center" }}
                    onClick={() => { setOpen(false); store.openSheet({ kind: "removeTeam", teamId: a.id }); }}
                  >
                    <Ic.Trash size={12} stroke="var(--ink-5)" />
                  </button>
                </div>
              ))}
            </>
          )}

          <div style={{ borderTop: "1px solid var(--border-faint)", marginTop: 4, paddingTop: 4 }}>
            <button className="li" style={{ padding: "7px 12px", alignItems: "center", gap: 8 }} onClick={() => { setOpen(false); void store.openFolder(); }} title="A folder with a .standbye team opens it; one without offers to create it">
              <Ic.Folder size={13} stroke="var(--ink-3)" />
              <span style={{ fontWeight: 500 }}>Open folder…</span>
            </button>
            <button className="li" style={{ padding: "7px 12px", alignItems: "center", gap: 8 }} onClick={() => { setOpen(false); store.openSheet({ kind: "onboarding" }); }}>
              <Ic.Plus size={13} stroke="var(--accent)" />
              <span style={{ color: "var(--accent)", fontWeight: 500 }}>New team…</span>
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
