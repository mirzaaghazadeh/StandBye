import { useEffect, useState, type ReactNode, type SyntheticEvent } from "react";
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
    const ok = mode === "describe"
      ? await store.draftTeam(description.trim(), owner, workspace, drafter, "describe")
      : await store.draftTeam("", owner, workspace, undefined, "template");
    if (ok) setStep("review");
  };

  const create = () => draft && void store.createTeam(draft, workspace, owner, git);
  const updateAgent = (i: number, patch: Partial<AgentDraft>) => draft && store.setDraft({ ...draft, agents: draft.agents.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const removeAgent = (i: number) => draft && store.setDraft({ ...draft, agents: draft.agents.filter((_, j) => j !== i) });

  return (
    <div className={"sheet" + (step === "review" ? " sheet-review" : "")}>
      <div className="sheet-h">
        <b>New Team</b>
        <span className="grow" />
        <Stepper step={step} onBrief={() => setStep("brief")} />
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
                  onClick={() => { store.setDraft(null); store.openSheet({ kind: "manual" }); }}
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
          canRedraft={ready.length > 0}
          onYes={(q) => {
            if (ready.length === 0) return;
            const next = `${description.trim()}\n\nAnswer: yes, ${q}`;
            setDescription(next);
            setMode("describe");
            void store.draftTeam(next.trim(), owner, workspace, drafter, "describe");
          }}
        />
      )}

      <div className="sheet-f">
        <span className="grow" style={{ minWidth: 0 }}>
          {step === "review" && draft && (
            <span className="builder-foot-note">
              {draft.agents.length} teammate{draft.agents.length === 1 ? "" : "s"} · Estimated <span className="mono">${draft.estimatedDailyUsd.low} – {draft.estimatedDailyUsd.high}</span> per day at normal activity. Sleeping is free.
            </span>
          )}
          {step === "brief" && busy && (
            <span className="builder-foot-note">This usually takes 20–60 seconds.</span>
          )}
        </span>
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

function Stepper({ step, onBrief }: { step: "brief" | "review"; onBrief: () => void }) {
  const onReview = step === "review";
  return (
    <span className="builder-step">
      <span className="builder-dot builder-dot-on">{onReview ? <Ic.Check size={10} stroke="#fff" strokeWidth={3.5} /> : 1}</span>
      {onReview ? <button type="button" className="builder-step-link" onClick={onBrief}>Brief</button> : "Brief"}
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
  draft, busy, mode, description, expanded, setExpanded, onEditBrief, onUpdate, onRemove, canRedraft, onYes,
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
  canRedraft: boolean;
  onYes: (q: string) => void;
}) {
  const recap = mode === "template" ? "Solo dev template" : (description.trim().split("\n")[0] || "Your description");
  return (
    <div className="sheet-body builder-review">
      <div className="builder-recap">
        <span className="cell">{busy ? "Thinking about your team…" : recap}</span>
        {draft && <span className="builder-recap-meta">{draft.agents.length} teammate{draft.agents.length === 1 ? "" : "s"}</span>}
        <a onClick={onEditBrief}>Edit brief</a>
      </div>
      {!draft ? (
        <div className="empty" style={{ fontSize: 12 }}>The draft appears here.</div>
      ) : (
        <div className="scroll builder-review-scroll">
          <div className="grp-t">Proposed team</div>
          {draft.agents.map((a, i) => {
            const open = expanded[String(i)] ?? i === 0;
            return (
              <AgentCard
                key={i}
                agent={a}
                open={open}
                onToggle={() => setExpanded({ ...expanded, [String(i)]: !open })}
                onUpdate={(patch) => onUpdate(i, patch)}
                onRemove={() => onRemove(i)}
              />
            );
          })}
          <div className="builder-block">
            <div className="grp-t">Channels</div>
            <div className="builder-channel">
              <span className="mono builder-channel-id">#general</span>
              <div className="builder-channel-body">everyone</div>
            </div>
            {draft.channels.map((c) => (
              <div key={c.name} className="builder-channel">
                <span className="mono builder-channel-id">#{c.name.replace(/^#/, "")}</span>
                <div className="builder-channel-body">
                  <div>{c.members.join(", ")}</div>
                  {c.purpose && <div className="builder-channel-purpose">{c.purpose}</div>}
                </div>
              </div>
            ))}
          </div>
          <div className="builder-block">
            <div className="grp-t">Guardrails</div>
            <div className="builder-rails">
              <span className="pill" style={{ background: "var(--red-bg)", color: "var(--red-ink)" }}>Ask you</span>
              {draft.guardrails.map((g) => (
                <span key={g} className="pill" style={{ background: "var(--q-bg)", color: "var(--q-ink)" }}>{g}</span>
              ))}
            </div>
            <div className="builder-cap">
              <span className="pill">Cap</span>
              <span className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                $<input className="field mono" style={{ width: 56 }} value={draft.dailyCapUsd} onChange={(e) => store.setDraft({ ...draft, dailyCapUsd: Number(e.target.value) || 0 })} />
                <span style={{ color: "var(--ink-5)", fontSize: 11 }}>/ day</span>
              </span>
              <span>for the team · agents pause when reached</span>
            </div>
          </div>
          {draft.questionsForOwner.map((q, i) => (
            <div key={i} className="builder-q">
              <Ic.Question size={16} stroke="var(--accent)" />
              <span style={{ flex: 1, fontSize: 12 }}>{q}</span>
              <Button sm onClick={() => onYes(q)} disabled={busy || !canRedraft} title={canRedraft ? undefined : "Redrafting needs Claude or an API key."}>Yes, redraft</Button>
              <Button sm onClick={() => store.setDraft({ ...draft, questionsForOwner: draft.questionsForOwner.filter((_, j) => j !== i) })}>No</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentCard({
  agent: a, open, onToggle, onUpdate, onRemove,
}: {
  agent: AgentDraft;
  open: boolean;
  onToggle: () => void;
  onUpdate: (patch: Partial<AgentDraft>) => void;
  onRemove: () => void;
}) {
  const stop = (e: SyntheticEvent) => e.stopPropagation();
  return (
    <div className={"builder-agent" + (open ? " builder-agent-open" : "")}>
      <div className="builder-agent-h" onClick={onToggle}>
        <button type="button" className="tri" aria-expanded={open} aria-label={open ? "Collapse" : "Expand"} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
          <Ic.TriRight />
        </button>
        <Avatar name={a.name} color={a.color} size={24} />
        <span className="builder-agent-who" onClick={stop}>
          <input className="field" style={{ width: 108, flexShrink: 0 }} value={a.name} onChange={(e) => onUpdate({ name: e.target.value })} />
          <input className="field" style={{ flex: 1, minWidth: 80 }} value={a.role} onChange={(e) => onUpdate({ role: e.target.value })} />
        </span>
        <span className="builder-agent-model" onClick={stop}>
          <ModelPicker value={a.model} provider={a.provider} onChange={(model, provider) => onUpdate({ model, provider })} width={196} small />
        </span>
        <span className="mono builder-agent-cost">${a.dailyBudgetUsd.toFixed(2)}<i>/day</i></span>
        <button type="button" className="ibtn" onClick={(e) => { e.stopPropagation(); onRemove(); }} title={`Remove ${a.name}`}>
          <Ic.X size={12} />
        </button>
      </div>
      <div className="builder-agent-panel">
        <div className="builder-agent-panel-inner" inert={!open || undefined} aria-hidden={!open}>
          <div className="builder-agent-body">
            <div>
              <div className="grp-t">Standing duties</div>
              {a.responsibilities.length > 0 ? (
                <ul className="builder-duties">
                  {a.responsibilities.map((r, j) => <li key={j}>{r}</li>)}
                </ul>
              ) : (
                <div style={{ fontSize: 12, color: "var(--ink-5)" }}>None listed.</div>
              )}
              <div className="grp-t" style={{ marginTop: 12 }}>Check-in</div>
              <div className="builder-meta">
                <span>every {a.heartbeatMinutes} min</span>
                {a.channels.map((c) => <span key={c} className="builder-ch">#{c.replace(/^#/, "")}</span>)}
              </div>
              <div className="grp-t" style={{ marginTop: 12 }}>Budget</div>
              <BudgetEditor compact workHours={14} budget={{ dailyUsd: a.dailyBudgetUsd, perRunUsd: a.perRunBudgetUsd ?? 2, hourlyUsd: a.hourlyBudgetUsd ?? null, capBy: a.capBy ?? "day" }}
                onChange={(b) => onUpdate({ dailyBudgetUsd: b.dailyUsd, perRunBudgetUsd: b.perRunUsd, hourlyBudgetUsd: b.hourlyUsd ?? null, capBy: b.capBy })} />
            </div>
            <div>
              <div className="grp-t">Soul</div>
              <textarea className="field mono sel" style={{ width: "100%", minHeight: 132, fontSize: 11.5 }} value={a.soul} onChange={(e) => onUpdate({ soul: e.target.value })} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
