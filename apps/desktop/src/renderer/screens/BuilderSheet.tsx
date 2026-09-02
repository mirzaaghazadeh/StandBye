import { useEffect, useState } from "react";
import type { AgentDraft, GitSettings } from "@crew/shared";
import { store, useStore } from "../state/store";
import { Ic } from "../ui/icons";
import { Avatar, Button, Segmented } from "../ui/kit";
import { ModelPicker } from "../components/ModelPicker";
import { BudgetEditor } from "../components/BudgetEditor";
import { GitSettingsPanel } from "../components/GitSettingsPanel";

/** New Team sheet: describe → draft → review outline → create. Mirrors the design's sheet. */
export function BuilderSheet({ mode: initialMode }: { mode?: "describe" | "template" }) {
  const draft = useStore((s) => s.builderDraft);
  const busy = useStore((s) => s.builderBusy);
  const keys = useStore((s) => s.keys);
  const team = useStore((s) => s.team);
  const [mode, setMode] = useState<"describe" | "template">(initialMode ?? "describe");
  const [description, setDescription] = useState("");
  const [ownerName, setOwnerName] = useState(team?.ownerName ?? "");
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [git, setGit] = useState<GitSettings | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const providers = useStore((s) => s.providers);
  const ready = (["anthropic", "openrouter"] as const).filter((p) => providers?.[p].ready);
  const [drafter, setDrafter] = useState<"anthropic" | "openrouter">(ready[0] ?? "anthropic");
  useEffect(() => { if (initialMode === "template" && !draft && !busy) doTemplate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const canDraft = description.trim().length > 10 && !busy && ready.length > 0;
  const doDraft = () => void store.draftTeam(description.trim(), ownerName.trim() || "Owner", workspace, drafter, "describe");
  const doTemplate = () => void store.draftTeam("", ownerName.trim() || "Owner", workspace, undefined, "template");
  const drafterModel = providers?.[drafter]?.defaultModel ?? "";
  const create = () => draft && void store.createTeam(draft, workspace, ownerName.trim() || "Owner", git);
  const updateAgent = (i: number, patch: Partial<AgentDraft>) => draft && store.setDraft({ ...draft, agents: draft.agents.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const removeAgent = (i: number) => draft && store.setDraft({ ...draft, agents: draft.agents.filter((_, j) => j !== i) });

  return (
    <div className="sheet">
      <div className="sheet-h">
        <b>New Team</b>
        <Segmented value={mode} onChange={setMode} options={[{ value: "describe", label: "Describe" }, { value: "template", label: "From Template" }]} />
        <span className="grow" />
        <span style={{ fontSize: 12, color: "var(--ink-4)" }}>{draft ? "Step 2 of 2 · Review the draft" : "Step 1 of 2 · Tell it what you need"}</span>
        <button className="ibtn" onClick={() => store.openSheet(team ? { kind: "none" } : { kind: "onboarding" })} title="Close"><Ic.X size={14} /></button>
      </div>

      <div className="sheet-body" style={{ display: "grid", gridTemplateColumns: "330px minmax(0, 1fr)" }}>
        <div style={{ borderRight: "1px solid var(--border)", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
          <div>
            <div className="grp-t">Your name</div>
            <input className="field" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="How the team should address you" />
          </div>
          {mode === "describe" ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <div className="grp-t">What do you need?</div>
              <textarea className="field" style={{ flex: 1, minHeight: 170 }} value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="I'm building a Python API on my own. I want a small dev team that keeps shipping while I sleep: someone to plan, someone to write backend code, someone to review and test, someone to keep docs current. Ask me before anything risky." />
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
              <b style={{ fontWeight: 600 }}>Solo dev team</b>: a tech lead who plans and reports, a backend engineer, a reviewer/tester on OpenRouter, and a docs writer. Good starting point for one person with one repo.
            </div>
          )}
          <div>
            <div className="grp-t">Workspace</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input className="field mono" style={{ flex: 1, fontSize: 11 }} placeholder="/path/to/the/repo this team works in" value={workspace ?? ""} onChange={(e) => setWorkspace(e.target.value || null)} />
              <Button icon={<Ic.Folder size={13} />} onClick={() => void window.crew.pickFolder().then((p) => p && setWorkspace(p))}>Choose…</Button>
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 4 }}>Each team has its own working directory. Agents only touch files inside it.</div>
          </div>
          <GitSettingsPanel workspace={workspace} value={git} onChange={setGit} compact />
          <div>
            <div className="grp-t">Keys</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="dot" style={{ width: 7, height: 7, background: keys.anthropic ? "var(--green)" : "var(--ink-6)" }} />Anthropic {keys.anthropic ? "" : <a onClick={() => store.openSheet({ kind: "keys" })}>add</a>}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="dot" style={{ width: 7, height: 7, background: keys.openrouter ? "var(--green)" : "var(--ink-6)" }} />OpenRouter {keys.openrouter ? "" : <a onClick={() => store.openSheet({ kind: "keys" })}>add</a>}</span>
            </div>
          </div>
          {mode === "describe" && ready.length > 0 && (
            <div>
              <div className="grp-t">Draft with</div>
              <Segmented value={drafter} onChange={setDrafter} options={ready.map((p) => ({ value: p, label: p === "anthropic" ? "Claude" : "OpenRouter" }))} />
              <div className="mono" style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 6 }}>{drafterModel}</div>
            </div>
          )}
          <div style={{ marginTop: "auto" }}>
            {mode === "describe"
              ? <Button primary onClick={doDraft} disabled={!canDraft}>{busy ? "Drafting… (20–60 s)" : draft ? "Redraft" : "Draft Team"}</Button>
              : <Button primary onClick={doTemplate} disabled={busy}>{busy ? "Loading…" : "Use Template"}</Button>}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", background: "var(--surface)", overflow: "hidden" }}>
          <div className="th" style={{ height: 30 }}>
            <span style={{ flex: 1 }}>Proposed team</span><span style={{ width: 200 }}>Model</span><span style={{ width: 64, textAlign: "right" }}>Per day</span><span style={{ width: 28 }} />
          </div>
          {!draft ? (
            <div className="empty" style={{ fontSize: 12 }}>{busy ? "Thinking about your team…" : "The draft appears here."}</div>
          ) : (
            <div className="scroll" style={{ flex: 1 }}>
              {draft.agents.map((a, i) => {
                const open = expanded[a.name] ?? i === 0;
                return (
                  <div key={a.name + i}>
                    <div className="orow">
                      <button className="tri" onClick={() => setExpanded({ ...expanded, [a.name]: !open })}>{open ? <Ic.TriDown /> : <Ic.TriRight />}</button>
                      <Avatar name={a.name} color={a.color} size={24} />
                      <span style={{ flex: 1, minWidth: 0, display: "flex", gap: 6 }}><input className="field" style={{ width: 84, flexShrink: 0, height: 20 }} value={a.name} onChange={(e) => updateAgent(i, { name: e.target.value })} /><input className="field" style={{ flex: 1, minWidth: 40, height: 20 }} value={a.role} onChange={(e) => updateAgent(i, { role: e.target.value })} /></span>
                      <span style={{ width: 200 }}>
                        <ModelPicker value={a.model} provider={a.provider} onChange={(model, provider) => updateAgent(i, { model, provider })} width={196} small />
                      </span>
                      <span className="mono" style={{ width: 64, textAlign: "right", fontSize: 12 }}>${a.dailyBudgetUsd.toFixed(2)}</span>
                      <button className="ibtn" style={{ width: 28 }} onClick={() => removeAgent(i)} title="Remove"><Ic.X size={12} /></button>
                    </div>
                    {open && (
                      <>
                        {a.responsibilities.map((r, j) => <div key={j} className="ochild">{r}</div>)}
                        <div className="ochild">Checks in every {a.heartbeatMinutes} min · channels {a.channels.map((c) => "#" + c.replace(/^#/, "")).join(", ")}</div>
                        <div className="ochild" style={{ paddingTop: 6, paddingBottom: 6 }}>
                          <BudgetEditor compact workHours={14} budget={{ dailyUsd: a.dailyBudgetUsd, perRunUsd: a.perRunBudgetUsd ?? 2, hourlyUsd: a.hourlyBudgetUsd ?? null, capBy: a.capBy ?? "day" }}
                            onChange={(b) => updateAgent(i, { dailyBudgetUsd: b.dailyUsd, perRunBudgetUsd: b.perRunUsd, hourlyBudgetUsd: b.hourlyUsd ?? null, capBy: b.capBy })} />
                        </div>
                        <div className="ochild" style={{ alignItems: "flex-start" }}><textarea className="field mono" style={{ width: "100%", minHeight: 90, fontSize: 11.5 }} value={a.soul} onChange={(e) => updateAgent(i, { soul: e.target.value })} /></div>
                      </>
                    )}
                  </div>
                );
              })}
              <div className="orow" style={{ marginTop: 6 }}><span className="tri" /><span style={{ flex: 1, fontWeight: 600 }}>Channels</span></div>
              <div className="ochild" style={{ paddingLeft: 30, flexWrap: "wrap" }}>
                <span className="mono" style={{ fontSize: 12 }}>#general</span><span>everyone</span>
                {draft.channels.map((c) => <span key={c.name} style={{ display: "contents" }}><span style={{ color: "var(--ink-6)" }}>·</span><span className="mono" style={{ fontSize: 12 }}>#{c.name.replace(/^#/, "")}</span><span>{c.members.join(", ")}</span></span>)}
              </div>
              <div className="orow"><span className="tri" /><span style={{ flex: 1, fontWeight: 600 }}>Guardrails</span></div>
              <div className="ochild" style={{ paddingLeft: 30 }}><span className="pill" style={{ background: "var(--red-bg)", color: "var(--red-ink)" }}>Ask you</span><span>{draft.guardrails.join(" · ")}</span></div>
              <div className="ochild" style={{ paddingLeft: 30 }}><span className="pill">Cap</span><span>$<input className="field mono" style={{ width: 50, display: "inline-block", height: 20 }} value={draft.dailyCapUsd} onChange={(e) => store.setDraft({ ...draft, dailyCapUsd: Number(e.target.value) || 0 })} />/day for the team · agents pause when reached</span></div>
              {draft.questionsForOwner.map((q, i) => (
                <div key={i} style={{ margin: "14px 12px 0", padding: "10px 12px", border: "1px solid var(--q-border)", borderRadius: 7, background: "var(--q-card)", display: "flex", alignItems: "center", gap: 10 }}>
                  <Ic.Question size={16} stroke="var(--accent)" />
                  <span style={{ flex: 1, fontSize: 12 }}>{q}</span>
                  <Button sm onClick={() => { setDescription((d) => d + `\n\nAnswer: yes, ${q}`); setMode("describe"); }}>Yes, redraft</Button>
                  <Button sm onClick={() => store.setDraft({ ...draft, questionsForOwner: draft.questionsForOwner.filter((_, j) => j !== i) })}>No</Button>
                </div>
              ))}
              <div style={{ height: 16 }} />
            </div>
          )}
        </div>
      </div>

      <div className="sheet-f">
        {draft && <span style={{ fontSize: 12, color: "var(--ink-4)" }}>Estimated <span className="mono">${draft.estimatedDailyUsd.low} – {draft.estimatedDailyUsd.high}</span> per day at normal activity. Sleeping is free.</span>}
        <span className="grow" />
        <Button lg onClick={() => store.openSheet({ kind: "onboarding" })}>Back</Button>
        <Button lg primary onClick={create} disabled={!draft || draft.agents.length === 0}>Create Team</Button>
      </div>
    </div>
  );
}
