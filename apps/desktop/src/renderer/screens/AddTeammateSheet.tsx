import { useEffect, useState } from "react";
import { PROVIDERS, type AgentDraft, type Budget, type Provider } from "@crew/shared";
import { store, useStore } from "../state/store";
import { ModelPicker } from "../components/ModelPicker";
import { BudgetEditor } from "../components/BudgetEditor";
import { Ic } from "../ui/icons";
import { Button } from "../ui/kit";
import { PRESETS, SWATCHES } from "./ManualTeamSheet";

const DEFAULT_RULES = ["Never push to main without approval", "Only touch files inside the repo folder"];

/** Hiring one more agent into the team you are already in: same fields as a new team, one at a time. */
export function AddTeammateSheet() {
  const team = useStore((s) => s.team);
  const agents = useStore((s) => s.agents);
  const providers = useStore((s) => s.providers);
  const owner = team?.ownerName || "the owner";
  const defaultProvider: Provider =
    providers?.anthropic?.ready
      ? "anthropic"
      : PROVIDERS.find((p) => providers?.[p.id]?.ready)?.id ?? "anthropic";

  const first = PRESETS[0]!;
  const [presetRole, setPresetRole] = useState(first.role);
  const [name, setName] = useState(first.name);
  const [role, setRole] = useState(first.role === "Custom" ? "Teammate" : first.role);
  const [soul, setSoul] = useState(first.soul(owner, first.name));
  const [resp, setResp] = useState(first.responsibilities.join("\n"));
  const [provider, setProvider] = useState<Provider>(defaultProvider);
  const [model, setModel] = useState(providers?.[defaultProvider]?.defaultModel ?? "");
  const [heartbeat, setHeartbeat] = useState(first.heartbeat);
  const [budget, setBudget] = useState<Budget>({ dailyUsd: first.daily, perRunUsd: 2, hourlyUsd: null, capBy: "day" });
  const [color, setColor] = useState(SWATCHES[0]!);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Only providers that can return structured JSON can write a draft, same rule as New Team.
  const drafters = PROVIDERS.filter((p) => (p.id === "anthropic" || p.kind === "openai") && providers?.[p.id]?.ready).map((p) => p.id);
  const [drafter, setDrafter] = useState<Provider>(drafters[0] ?? "anthropic");
  const [description, setDescription] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  useEffect(() => {
    if (drafters.length > 0 && !drafters.includes(drafter)) setDrafter(drafters[0]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafters.length]);

  const applyPreset = (r: string) => {
    const p = PRESETS.find((x) => x.role === r);
    if (!p) return;
    setPresetRole(p.role);
    setName(p.name);
    setRole(p.role === "Custom" ? "Teammate" : p.role);
    setSoul(p.soul(owner, p.name));
    setResp(p.responsibilities.join("\n"));
    setHeartbeat(p.heartbeat);
    setBudget((b) => ({ ...b, dailyUsd: p.daily }));
  };

  const dupe = agents.some((a) => a.name.toLowerCase() === name.trim().toLowerCase());
  const ready = name.trim().length > 0 && soul.trim().length > 0 && model.length > 0 && !dupe && !saving;

  const save = async () => {
    if (!ready) return;
    setSaving(true);
    setErr(null);
    const draft: AgentDraft = {
      name: name.trim(),
      role: role.trim() || "Teammate",
      provider,
      model,
      soul: soul.trim(),
      rules: DEFAULT_RULES,
      responsibilities: resp.split("\n").map((s) => s.trim()).filter(Boolean),
      heartbeatMinutes: heartbeat,
      dailyBudgetUsd: budget.dailyUsd,
      perRunBudgetUsd: budget.perRunUsd,
      hourlyBudgetUsd: budget.hourlyUsd,
      capBy: budget.capBy,
      channels: ["general"],
      color,
    };
    try {
      await store.createAgent(draft);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  /** Describe it → the drafter fills the form; the owner still reviews and presses Add to Team. */
  const draftOne = async () => {
    setDrafting(true);
    setDraftErr(null);
    try {
      const d = await store.draftTeammate(description.trim(), owner, drafter);
      setPresetRole("Custom");
      setName(d.name);
      setRole(d.role);
      setSoul(d.soul);
      setResp(d.responsibilities.join("\n"));
      setProvider(d.provider);
      setModel(d.model);
      setHeartbeat(d.heartbeatMinutes ?? 30);
      setBudget({ dailyUsd: d.dailyBudgetUsd, perRunUsd: d.perRunBudgetUsd ?? 0.5, hourlyUsd: d.hourlyBudgetUsd, capBy: d.capBy });
      setColor(d.color);
    } catch (e) {
      setDraftErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(false);
    }
  };

  return (
    <div className="sheet">
      <div className="sheet-h">
        <b>Add teammate</b>
        <span style={{ fontSize: 12, color: "var(--ink-4)" }}>
          One more agent joins {team?.name ?? "the team"}. Soul and rules stay editable later.
        </span>
        <span className="grow" />
        <button className="ibtn" onClick={() => store.closeSheet()}><Ic.X size={14} /></button>
      </div>
      <div className="sheet-body" style={{ display: "grid", gridTemplateColumns: "300px minmax(0, 1fr)" }}>
        <div style={{ borderRight: "1px solid var(--border)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
          <div>
            <div className="grp-t">Describe this teammate</div>
            <textarea
              className="field"
              style={{ minHeight: 72 }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A patient reviewer who reads every diff before the owner does, posts findings in the channel, and never edits code."
            />
            {drafters.length > 0 && (
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                <Button onClick={() => void draftOne()} disabled={description.trim().length < 10 || drafting}>
                  {drafting ? "Drafting…" : "Draft it"}
                </Button>
                <select
                  className="field"
                  style={{ width: 150 }}
                  value={drafter}
                  disabled={drafting}
                  onChange={(e) => setDrafter(e.target.value as Provider)}
                >
                  {drafters.map((id) => (
                    <option key={id} value={id}>{PROVIDERS.find((p) => p.id === id)?.name ?? id}</option>
                  ))}
                </select>
              </div>
            )}
            <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 4 }}>Fills the form below; you review before adding.</div>
            {draftErr && <div style={{ fontSize: 12, color: "crimson", marginTop: 6 }}>{draftErr}</div>}
          </div>
          <div>
            <div className="grp-t">Start from a role</div>
            <select className="field" value={presetRole} onChange={(e) => applyPreset(e.target.value)}>
              {PRESETS.map((p) => (
                <option key={p.role} value={p.role}>{p.role}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="grp-t">Name</div>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada" />
          </div>
          <div>
            <div className="grp-t">Role</div>
            <input className="field" value={role} onChange={(e) => setRole(e.target.value)} />
          </div>
          <ModelPicker
            value={model}
            provider={provider}
            onChange={(m, p) => { setModel(m); setProvider(p); }}
          />
          <div>
            <div className="grp-t">Check in every</div>
            <input
              className="field"
              type="number"
              min={5}
              max={720}
              value={heartbeat}
              onChange={(e) => setHeartbeat(Math.min(720, Math.max(5, Number(e.target.value) || 30)))}
            />
          </div>
          <BudgetEditor budget={budget} workHours={14} onChange={setBudget} />
          <div>
            <div className="grp-t">Color</div>
            <div style={{ display: "flex", gap: 6 }}>
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  aria-label={c}
                  onClick={() => setColor(c)}
                  style={{
                    width: 22, height: 22, borderRadius: 11, background: c, border: "none", cursor: "pointer",
                    outline: c === color ? "2px solid var(--ink)" : "none", outlineOffset: 2,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
          <div>
            <div className="grp-t">Soul</div>
            <textarea
              className="field"
              style={{ minHeight: 180 }}
              value={soul}
              onChange={(e) => setSoul(e.target.value)}
              placeholder="Who they are and how they work."
            />
          </div>
          <div>
            <div className="grp-t">Standing duties — one per line</div>
            <textarea className="field" style={{ minHeight: 90 }} value={resp} onChange={(e) => setResp(e.target.value)} />
          </div>
          {dupe && (
            <div style={{ fontSize: 12, color: "crimson" }}>
              A teammate named “{name.trim()}” is already on this team.
            </div>
          )}
          {err && <div style={{ fontSize: 12, color: "crimson" }}>{err}</div>}
        </div>
      </div>
      <div className="sheet-f">
        <span style={{ fontSize: 12, color: "var(--ink-4)" }}>They join #general and check in on schedule. First check-in lands within a minute.</span>
        <span className="grow" />
        <Button lg onClick={() => store.closeSheet()}>Cancel</Button>
        <Button lg primary onClick={() => void save()} disabled={!ready}>Add to Team</Button>
      </div>
    </div>
  );
}
