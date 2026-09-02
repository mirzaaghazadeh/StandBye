import { useState } from "react";
import type { AgentDraft, GitSettings, Provider, TeamDraft } from "@crew/shared";
import { store, useStore } from "../state/store";
import { Ic } from "../ui/icons";
import { Avatar, Button, Popup } from "../ui/kit";
import { ModelPicker } from "../components/ModelPicker";
import { BudgetEditor } from "../components/BudgetEditor";
import { GitSettingsPanel } from "../components/GitSettingsPanel";

const SWATCHES = ["#E9D9CF", "#D7E3DA", "#DDDCE8", "#F3E4C8", "#D9E6EE", "#EFEDE8"];

interface Preset { role: string; name: string; responsibilities: string[]; soul: (owner: string, name: string) => string; heartbeat: number; daily: number }

const PRESETS: Preset[] = [
  { role: "Tech lead", name: "Ada", heartbeat: 30, daily: 4, responsibilities: ["Daily plan at 09:00 in #general", "Assign and follow up on tasks", "End-of-day report to the owner"],
    soul: (o, n) => `# ${n}, tech lead\n\nYou are ${n}, the tech lead on ${o}'s team. You turn goals into small, well-defined tasks and make sure they get finished.\n\n## How you work\n- Break big asks into tasks a teammate can finish in one sitting. Say what done looks like.\n- Follow up. If a task is stuck for a day, find out why.\n- At the end of the day, post a short report for ${o}.\n\n## How you talk\nCalm, specific, no cheerleading.` },
  { role: "Backend engineer", name: "Kai", heartbeat: 30, daily: 3, responsibilities: ["Implement backend tasks", "Keep main green"],
    soul: (o, n) => `# ${n}, backend engineer\n\nYou are ${n}, the backend engineer on ${o}'s team. You own the API, the worker and the database.\n\n## How you work\n- Ship small pull requests. Tests before merge.\n- Prefer boring tech. When a decision is ${o}'s, ask with a default and keep working.\n\n## How you talk\nDirect and short.` },
  { role: "Frontend engineer", name: "Noor", heartbeat: 30, daily: 3, responsibilities: ["Implement UI tasks", "Keep the UI consistent"],
    soul: (o, n) => `# ${n}, frontend engineer\n\nYou are ${n}, the frontend engineer on ${o}'s team. You own everything the user sees.\n\n## How you work\n- Small, reviewable changes. Match the existing design language.\n- Ask ${o} before changing something visible in a way they haven't asked for.\n\n## How you talk\nConcrete, with screenshots or file paths.` },
  { role: "QA and review", name: "Rex", heartbeat: 30, daily: 2, responsibilities: ["Review every PR", "Run the suite on every change", "Report breakage"],
    soul: (o, n) => `# ${n}, QA and review\n\nYou are ${n}, the reviewer and tester on ${o}'s team. Nothing merges without you having read it and run it.\n\n## How you work\n- Read the diff, run the tests, try to break it. Concrete comments, not opinions.\n- Write the missing test instead of asking for it when it's small.\n\n## How you talk\nBlunt but kind. Evidence first.` },
  { role: "Docs", name: "Sol", heartbeat: 120, daily: 0.5, responsibilities: ["Keep README and docs current", "Draft release notes weekly"],
    soul: (o, n) => `# ${n}, docs\n\nYou are ${n}, the technical writer on ${o}'s team. You keep the docs true to the code.\n\n## How you work\n- When behaviour changes, update the docs: short, exact, with an example.\n- Remove docs that lie.\n\n## How you talk\nPlain words, short sentences.` },
  { role: "Custom", name: "", heartbeat: 30, daily: 2, responsibilities: [], soul: (o, n) => `# ${n}\n\nYou are ${n} on ${o}'s team.\n\n## How you work\n- \n\n## How you talk\n` },
];

/** Build a team by hand: teammates, models, budgets. Everything else uses sensible defaults. */
export function ManualTeamSheet() {
  const providers = useStore((s) => s.providers);
  const team = useStore((s) => s.team);
  const defaultProvider: Provider = providers?.anthropic.ready ? "anthropic" : "openrouter";
  const [ownerName, setOwnerName] = useState(team?.ownerName ?? "");
  const [teamName, setTeamName] = useState("My team");
  const [charter, setCharter] = useState("");
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [git, setGit] = useState<GitSettings | null>(null);
  const [agents, setAgents] = useState<AgentDraft[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [preset, setPreset] = useState(PRESETS[0]!.role);

  const add = () => {
    const p = PRESETS.find((x) => x.role === preset) ?? PRESETS[0]!;
    const name = p.name && !agents.some((a) => a.name === p.name) ? p.name : `Agent ${agents.length + 1}`;
    const a: AgentDraft = {
      name, role: p.role === "Custom" ? "Teammate" : p.role, provider: defaultProvider, model: providers?.[defaultProvider].defaultModel ?? "",
      soul: p.soul(ownerName || "the owner", name), rules: ["Never push to main without approval", "Only touch files inside the repo folder"],
      responsibilities: p.responsibilities, heartbeatMinutes: p.heartbeat, dailyBudgetUsd: p.daily, perRunBudgetUsd: 2, hourlyBudgetUsd: null, capBy: "day",
      channels: ["general"], color: SWATCHES[agents.length % SWATCHES.length]!,
    };
    setAgents([...agents, a]);
    setOpen(agents.length);
  };
  const update = (i: number, patch: Partial<AgentDraft>) => setAgents(agents.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const remove = (i: number) => { setAgents(agents.filter((_, j) => j !== i)); setOpen(null); };

  const daily = agents.reduce((s, a) => s + a.dailyBudgetUsd, 0);
  const create = () => {
    const draft: TeamDraft = {
      name: teamName.trim() || "My team",
      charter: charter.trim() || "Keep the project moving while the owner is away. Ask before anything risky.",
      agents, channels: [], guardrails: ["Push to main", "Any single run over the per-run cap", "Files outside the repo"],
      dailyCapUsd: Math.max(5, Math.ceil(daily * 1.5)), estimatedDailyUsd: { low: +(daily * 0.4).toFixed(0), high: +(daily * 1.1).toFixed(0) }, questionsForOwner: [],
    };
    void store.createTeam(draft, workspace, ownerName.trim() || "Owner", git);
  };

  return (
    <div className="sheet">
      <div className="sheet-h">
        <b>Build your team</b>
        <span style={{ fontSize: 12, color: "var(--ink-4)" }}>Add teammates, pick their models and budgets. Souls are editable now and later.</span>
        <span className="grow" />
        <button className="ibtn" onClick={() => store.openSheet(team ? { kind: "none" } : { kind: "onboarding" })}><Ic.X size={14} /></button>
      </div>

      <div className="sheet-body" style={{ display: "grid", gridTemplateColumns: "300px minmax(0, 1fr)" }}>
        <div style={{ borderRight: "1px solid var(--border)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
          <div><div className="grp-t">Your name</div><input className="field" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="How the team addresses you" /></div>
          <div><div className="grp-t">Team name</div><input className="field" value={teamName} onChange={(e) => setTeamName(e.target.value)} /></div>
          <div><div className="grp-t">Charter</div><textarea className="field" style={{ minHeight: 80 }} value={charter} onChange={(e) => setCharter(e.target.value)} placeholder="The standing goal, in one or two sentences." /></div>
          <div>
            <div className="grp-t">Workspace</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input className="field mono" style={{ flex: 1, fontSize: 11 }} placeholder="/path/to/the/repo this team works in" value={workspace ?? ""} onChange={(e) => setWorkspace(e.target.value || null)} />
              <Button icon={<Ic.Folder size={13} />} onClick={() => void window.crew.pickFolder().then((p) => p && setWorkspace(p))}>Choose…</Button>
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 4 }}>Each team has its own working directory. Agents only touch files inside it.</div>
          </div>
          <GitSettingsPanel workspace={workspace} value={git} onChange={setGit} compact />
          <div style={{ marginTop: "auto" }}>
            <div className="grp-t">Add a teammate</div>
            <div style={{ display: "flex", gap: 6 }}>
              <Popup value={preset} options={PRESETS.map((p) => ({ value: p.role, label: p.role }))} onChange={setPreset} style={{ flex: 1 }} />
              <Button primary icon={<Ic.Plus size={12} />} onClick={add}>Add</Button>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", background: "var(--surface)", overflow: "hidden" }}>
          <div className="th" style={{ height: 30 }}><span style={{ flex: 1 }}>Teammates</span><span style={{ width: 200 }}>Model</span><span style={{ width: 90, textAlign: "right" }}>Budget</span><span style={{ width: 28 }} /></div>
          {agents.length === 0 && <div className="empty" style={{ fontSize: 12 }}>Add your first teammate on the left.</div>}
          <div className="scroll" style={{ flex: 1 }}>
            {agents.map((a, i) => (
              <div key={i}>
                <div className="orow">
                  <button className="tri" onClick={() => setOpen(open === i ? null : i)}>{open === i ? <Ic.TriDown /> : <Ic.TriRight />}</button>
                  <Avatar name={a.name} color={a.color} size={24} />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", gap: 6 }}>
                    <input className="field" style={{ width: 100, height: 20 }} value={a.name} onChange={(e) => update(i, { name: e.target.value })} />
                    <input className="field" style={{ flex: 1, height: 20 }} value={a.role} onChange={(e) => update(i, { role: e.target.value })} />
                  </span>
                  <span style={{ width: 200 }}><ModelPicker value={a.model} provider={a.provider} onChange={(model, provider) => update(i, { model, provider })} width={196} small /></span>
                  <span className="mono" style={{ width: 90, textAlign: "right", fontSize: 12 }}>${a.dailyBudgetUsd.toFixed(2)}/day</span>
                  <button className="ibtn" style={{ width: 28 }} onClick={() => remove(i)}><Ic.X size={12} /></button>
                </div>
                {open === i && (
                  <div style={{ padding: "10px 12px 14px 52px", borderBottom: "1px solid var(--border-soft)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                    <div>
                      <div className="grp-t">Budget</div>
                      <BudgetEditor budget={{ dailyUsd: a.dailyBudgetUsd, perRunUsd: a.perRunBudgetUsd ?? 2, hourlyUsd: a.hourlyBudgetUsd ?? null, capBy: a.capBy ?? "day" }} workHours={14}
                        onChange={(b) => update(i, { dailyBudgetUsd: b.dailyUsd, perRunBudgetUsd: b.perRunUsd, hourlyBudgetUsd: b.hourlyUsd ?? null, capBy: b.capBy })} />
                      <div className="grp-t" style={{ marginTop: 12 }}>Check in every</div>
                      <Popup value={String(a.heartbeatMinutes)} options={["10", "15", "30", "60", "120", "240"].map((m) => ({ value: m, label: `${m} min` }))} onChange={(v) => update(i, { heartbeatMinutes: Number(v) })} />
                      <div className="grp-t" style={{ marginTop: 12 }}>Color</div>
                      <span style={{ display: "flex", gap: 6 }}>{SWATCHES.map((c) => <button key={c} onClick={() => update(i, { color: c })} style={{ width: 18, height: 18, borderRadius: 999, background: c, border: a.color === c ? "2px solid var(--accent)" : "1px solid #cfcbc3", padding: 0 }} />)}</span>
                    </div>
                    <div>
                      <div className="grp-t">Soul</div>
                      <textarea className="field mono" style={{ width: "100%", minHeight: 170, fontSize: 11.5 }} value={a.soul} onChange={(e) => update(i, { soul: e.target.value })} />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="sheet-f">
        <span style={{ fontSize: 12, color: "var(--ink-4)" }}>{agents.length} teammate{agents.length === 1 ? "" : "s"} · up to <span className="mono">${daily.toFixed(2)}</span> per day if everyone hits their cap. Sleeping is free.</span>
        <span className="grow" />
        <Button lg onClick={() => store.openSheet({ kind: "onboarding" })}>Back</Button>
        <Button lg primary onClick={create} disabled={agents.length === 0}>Create Team</Button>
      </div>
    </div>
  );
}
