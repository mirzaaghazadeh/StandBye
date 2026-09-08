import { useEffect, useState, type ReactNode } from "react";
import { PROVIDERS, providerLabel, type AgentDraft, type GitSettings, type Provider, type TeamDraft } from "@crew/shared";
import { store, useStore } from "../state/store";
import { Ic } from "../ui/icons";
import { Avatar, Button, Popup, Segmented } from "../ui/kit";
import { ModelPicker } from "../components/ModelPicker";
import { BudgetEditor } from "../components/BudgetEditor";
import { GitSettingsPanel } from "../components/GitSettingsPanel";

/**
 * New Team: a real two-step. First the brief (how to start, what they need, which folder),
 * then a full-width review of the draft. One primary action per step — Draft, then Create.
 */
export function BuilderSheet({ mode: initialMode }: { mode?: "describe" | "template" }) {
  const draft = useStore((s) => s.builderDraft);
  const busy = useStore((s) => s.builderBusy);
  const team = useStore((s) => s.team);
  const teamCount = useStore((s) => s.teams.length);
  const providers = useStore((s) => s.providers);
  const [step, setStep] = useState<"brief" | "review">(draft && !busy ? "review" : "brief");
  const [mode, setMode] = useState<"describe" | "template">(initialMode ?? "describe");
  const [description, setDescription] = useState("");
  const [ownerName, setOwnerName] = useState(team?.ownerName ?? "");
  const [workspace, setWorkspace] = useState<string | null>(store.get().pendingWorkspace);
  const [git, setGit] = useState<GitSettings | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Only providers that can return structured JSON can write the draft: Claude and anything
  // OpenAI-compatible. A coding CLI or a cloud can still run the team it produces.
  const readyAll = PROVIDERS.filter((p) => providers?.[p.id]?.ready).map((p) => p.id);
  const ready = PROVIDERS.filter((p) => providers?.[p.id]?.ready && (p.id === "anthropic" || p.kind === "openai")).map((p) => p.id);
  const [drafter, setDrafter] = useState<Provider>(ready[0] ?? "anthropic");
  useEffect(() => { if (ready.length && !ready.includes(drafter)) setDrafter(ready[0]!); }, [ready.join(","), drafter]);

  const canDescribe = description.trim().length > 10 && ready.length > 0;
  const canSubmit = !busy && (mode === "template" || canDescribe);
  const drafterModel = providers?.[drafter]?.defaultModel ?? "";
  const owner = ownerName.trim() || "Owner";

  const leave = () => {
    store.setDraft(null);
    store.openSheet(teamCount > 0 ? { kind: "none" } : { kind: "onboarding" });
  };

  const submit = async () => {
    if (mode === "describe") await store.draftTeam(description.trim(), owner, workspace, drafter, "describe");
    else await store.draftTeam("", owner, workspace, undefined, "template");
    if (store.get().builderDraft) setStep("review");
  };

  const create = () => draft && void store.createTeam(draft, workspace, owner, git);
  const updateAgent = (i: number, patch: Partial<AgentDraft>) => draft && store.setDraft({ ...draft, agents: draft.agents.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const removeAgent = (i: number) => draft && store.setDraft({ ...draft, agents: draft.agents.filter((_, j) => j !== i) });

  return (
    <div className="sheet">
      <div className="sheet-h">
        <b>New Team</b>
        <span className="grow" />
        <Stepper step={step} />
        <button className="ibtn" onClick={leave} title="Close"><Ic.X size={14} /></button>
      </div>

      {step === "brief" ? (
        <div className="sheet-body builder-brief">
          <div className="builder-brief-inner">
            <div>
              <div className="grp-t">How should this team start?</div>
              <div className="builder-paths">
                <PathCard
                  icon={<Ic.Sparkle size={16} />}
                  title="Describe"
                  body="A model writes the roles from what you type."
                  selected={mode === "describe"}
                  onClick={() => setMode("describe")}
                />
                <PathCard
                  icon={<Ic.Team size={16} />}
                  title="Template"
                  body="Solo dev team: lead, backend, reviewer, docs."
                  selected={mode === "template"}
                  onClick={() => setMode("template")}
                />
                <PathCard
                  icon={<Ic.Edit size={16} />}
                  title="By hand"
                  body="Pick each teammate yourself."
                  selected={false}
                  onClick={() => store.openSheet({ kind: "manual" })}
                />
              </div>
            </div>

            <div>
              <div className="grp-t">Your name</div>
              <input className="field field-lg" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="How the team should address you" />
            </div>

            {mode === "describe" ? (
              <div>
                <div className="grp-t">What do you need?</div>
                <textarea
                  className="field"
                  style={{ minHeight: 128 }}
                  autoFocus
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) void submit(); }}
                  placeholder="I'm building a Python API on my own. I want a small dev team that keeps shipping while I sleep: someone to plan, someone to write backend code, someone to review and test, someone to keep docs current. Ask me before anything risky."
                />
                {ready.length === 0 && (
                  <div style={{ fontSize: 11.5, color: "var(--amber-ink)", marginTop: 6, lineHeight: 1.45 }}>
                    Describe needs Claude or an API key so a model can draft the roles.
                    {readyAll.length
                      ? " The template still works with the CLI you set up."
                      : <>{" "}<a onClick={() => store.openSheet(team ? { kind: "keys", tab: "providers" } : { kind: "onboarding" })}>Set one up</a>, or start from the template.</>}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.5, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)" }}>
                <b style={{ fontWeight: 600, color: "var(--ink)" }}>Solo dev team.</b> A tech lead who plans and reports, a backend engineer, a reviewer/tester, and a docs writer. Good starting point for one person with one repo. Edit anyone after it drafts.
              </div>
            )}

            <div>
              <div className="grp-t">Workspace</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input className="field mono" style={{ flex: 1, fontSize: 12, height: 28 }} placeholder="/path/to/the/repo this team works in" value={workspace ?? ""} onChange={(e) => setWorkspace(e.target.value || null)} />
                <Button icon={<Ic.Folder size={13} />} onClick={() => void window.crew.pickFolder().then((p) => p && setWorkspace(p))}>Choose…</Button>
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 4 }}>Each team has its own working directory. Agents only touch files inside it.</div>
            </div>
            <GitSettingsPanel workspace={workspace} value={git} onChange={setGit} />

            {mode === "describe" && ready.length > 0 && (
              <div>
                <div className="grp-t">Draft with</div>
                {ready.length <= 3
                  ? <Segmented value={drafter} onChange={setDrafter} options={ready.map((p) => ({ value: p, label: providerLabel(p) }))} />
                  : <Popup value={drafter} onChange={setDrafter} options={ready.map((p) => ({ value: p, label: providerLabel(p) }))} style={{ width: 200 }} />}
                <div className="mono" style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 6 }}>{drafterModel}</div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <ReviewPane
          draft={draft}
          busy={busy}
          mode={mode}
          description={description}
          expanded={expanded}
          setExpanded={setExpanded}
          onEditBrief={() => setStep("brief")}
          onUpdate={updateAgent}
          onRemove={removeAgent}
          onYes={(q) => {
            const next = `${description.trim()}\n\nAnswer: yes, ${q}`;
            setDescription(next);
            setMode("describe");
            void store.draftTeam(next.trim(), owner, workspace, drafter, "describe");
          }}
        />
      )}

      <div className="sheet-f">
        {step === "review" && draft && (
          <span style={{ fontSize: 12, color: "var(--ink-4)" }}>Estimated <span className="mono">${draft.estimatedDailyUsd.low} – {draft.estimatedDailyUsd.high}</span> per day at normal activity. Sleeping is free.</span>
        )}
        {step === "brief" && busy && (
          <span style={{ fontSize: 12, color: "var(--ink-4)" }}>This usually takes 20–60 seconds.</span>
        )}
        <span className="grow" />
        <Button lg onClick={step === "review" ? () => setStep("brief") : leave}>{step === "review" || teamCount === 0 ? "Back" : "Cancel"}</Button>
        {step === "brief" ? (
          <Button lg primary onClick={() => void submit()} disabled={!canSubmit}>
            {busy ? "Drafting…" : mode === "describe" ? "Draft Team" : "Use Template"}
          </Button>
        ) : (
          <>
            <Button lg onClick={() => void submit()} disabled={!canSubmit}>{busy ? "Drafting…" : "Redraft"}</Button>
            <Button lg primary onClick={create} disabled={!draft || draft.agents.length === 0 || busy}>Create Team</Button>
          </>
        )}
      </div>
    </div>
  );
}

function Stepper({ step }: { step: "brief" | "review" }) {
  const onReview = step === "review";
  return (
    <span className="builder-step">
      <span className="builder-dot builder-dot-on">{onReview ? <Ic.Check size={10} stroke="#fff" strokeWidth={3.5} /> : 1}</span>
      Brief
      <span className="builder-step-line" />
      <span className={"builder-dot" + (onReview ? " builder-dot-on" : "")}>2</span>
      Review
    </span>
  );
}

function PathCard({ icon, title, body, selected, onClick }: { icon: ReactNode; title: string; body: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" className={"onboard-card builder-path" + (selected ? " onboard-card-hero" : "")} onClick={onClick}>
      <span className="builder-path-icon">{icon}</span>
      <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
      <span style={{ fontSize: 11.5, color: "var(--ink-4)", lineHeight: 1.35 }}>{body}</span>
    </button>
  );
}

function ReviewPane({
  draft, busy, mode, description, expanded, setExpanded, onEditBrief, onUpdate, onRemove, onYes,
}: {
  draft: TeamDraft | null;
  busy: boolean;
  mode: "describe" | "template";
  description: string;
  expanded: Record<string, boolean>;
  setExpanded: (v: Record<string, boolean>) => void;
  onEditBrief: () => void;
  onUpdate: (i: number, patch: Partial<AgentDraft>) => void;
  onRemove: (i: number) => void;
  onYes: (q: string) => void;
}) {
  const recap = mode === "template" ? "Solo dev template" : (description.trim().split("\n")[0] || "Your description");
  return (
    <div className="sheet-body" style={{ flexDirection: "column", background: "var(--surface)", overflow: "hidden" }}>
      <div className="builder-recap">
        <span className="cell">{busy ? "Thinking about your team…" : recap}</span>
        <a onClick={onEditBrief}>Edit brief</a>
      </div>
      <div className="th" style={{ height: 30 }}>
        <span style={{ flex: 1 }}>Proposed team</span><span style={{ width: 200 }}>Model</span><span style={{ width: 64, textAlign: "right" }}>Per day</span><span style={{ width: 28 }} />
      </div>
      {!draft ? (
        <div className="empty" style={{ fontSize: 12 }}>The draft appears here.</div>
      ) : (
        <div className="scroll" style={{ flex: 1, minHeight: 0 }}>
          {draft.agents.map((a, i) => {
            const open = expanded[a.name] ?? i === 0;
            return (
              <div key={a.name + i}>
                <div className="orow">
                  <button className="tri" onClick={() => setExpanded({ ...expanded, [a.name]: !open })}>{open ? <Ic.TriDown /> : <Ic.TriRight />}</button>
                  <Avatar name={a.name} color={a.color} size={24} />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", gap: 6 }}><input className="field" style={{ width: 84, flexShrink: 0, height: 20 }} value={a.name} onChange={(e) => onUpdate(i, { name: e.target.value })} /><input className="field" style={{ flex: 1, minWidth: 40, height: 20 }} value={a.role} onChange={(e) => onUpdate(i, { role: e.target.value })} /></span>
                  <span style={{ width: 200 }}>
                    <ModelPicker value={a.model} provider={a.provider} onChange={(model, provider) => onUpdate(i, { model, provider })} width={196} small />
                  </span>
                  <span className="mono" style={{ width: 64, textAlign: "right", fontSize: 12 }}>${a.dailyBudgetUsd.toFixed(2)}</span>
                  <button className="ibtn" style={{ width: 28 }} onClick={() => onRemove(i)} title="Remove"><Ic.X size={12} /></button>
                </div>
                {open && (
                  <>
                    {a.responsibilities.map((r, j) => <div key={j} className="ochild">{r}</div>)}
                    <div className="ochild">Checks in every {a.heartbeatMinutes} min · channels {a.channels.map((c) => "#" + c.replace(/^#/, "")).join(", ")}</div>
                    <div className="ochild" style={{ paddingTop: 6, paddingBottom: 6 }}>
                      <BudgetEditor compact workHours={14} budget={{ dailyUsd: a.dailyBudgetUsd, perRunUsd: a.perRunBudgetUsd ?? 2, hourlyUsd: a.hourlyBudgetUsd ?? null, capBy: a.capBy ?? "day" }}
                        onChange={(b) => onUpdate(i, { dailyBudgetUsd: b.dailyUsd, perRunBudgetUsd: b.perRunUsd, hourlyBudgetUsd: b.hourlyUsd ?? null, capBy: b.capBy })} />
                    </div>
                    <div className="ochild" style={{ alignItems: "flex-start" }}><textarea className="field mono" style={{ width: "100%", minHeight: 90, fontSize: 11.5 }} value={a.soul} onChange={(e) => onUpdate(i, { soul: e.target.value })} /></div>
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
              <Button sm onClick={() => onYes(q)} disabled={busy}>Yes, redraft</Button>
              <Button sm onClick={() => store.setDraft({ ...draft, questionsForOwner: draft.questionsForOwner.filter((_, j) => j !== i) })}>No</Button>
            </div>
          ))}
          <div style={{ height: 16 }} />
        </div>
      )}
    </div>
  );
}
