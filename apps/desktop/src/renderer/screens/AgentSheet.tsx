import { useEffect, useState, type ReactElement } from "react";
import type { Agent, AgentFiles, CronTrigger, PermissionBehavior, PermissionRule, Provider } from "@crew/shared";
import { store, useStore } from "../state/store";
import { Ic } from "../ui/icons";
import { Avatar, Button, Checkbox, IconButton, KV, Popup, Switch } from "../ui/kit";
import { ModelPicker } from "../components/ModelPicker";
import { BudgetEditor, workHoursOf } from "../components/BudgetEditor";

type Tab = "general" | "soul" | "rules" | "wakeups" | "permissions" | "memory" | "budget";

const TABS: { id: Tab; label: string; icon: (p: { size?: number; stroke?: string }) => ReactElement }[] = [
  { id: "general", label: "General", icon: (p) => <Ic.Person {...p} /> },
  { id: "soul", label: "Soul", icon: (p) => <Ic.Flame {...p} /> },
  { id: "rules", label: "Rules", icon: (p) => <Ic.Shield {...p} /> },
  { id: "wakeups", label: "Wake-ups", icon: (p) => <Ic.Clock {...p} /> },
  { id: "permissions", label: "Permissions", icon: (p) => <Ic.Lock {...p} /> },
  { id: "memory", label: "Memory", icon: (p) => <Ic.Note {...p} /> },
  { id: "budget", label: "Budget", icon: (p) => <Ic.Dollar {...p} /> },
];

const SWATCHES = ["#E9D9CF", "#D7E3DA", "#DDDCE8", "#EFEDE8", "#F3E4C8", "#D9E6EE"];
const PERM: { value: PermissionBehavior; label: string }[] = [{ value: "allow", label: "Allow" }, { value: "ask", label: "Ask me" }, { value: "block", label: "Block" }];
const DEFAULT_MODEL: Record<Provider, { main: string; checkin: string }> = { anthropic: { main: "claude-opus-5", checkin: "claude-haiku-4-5" }, openrouter: { main: "z-ai/glm-5.3", checkin: "z-ai/glm-5.3-flash" } };

function isTab(t: string | undefined): t is Tab {
  return TABS.some((x) => x.id === t);
}

export function AgentSheet({ agentId, tab }: { agentId: string; tab?: string }) {
  const agent = useStore((s) => s.agents.find((a) => a.id === agentId));
  const [active, setActive] = useState<Tab>(isTab(tab) ? tab : "general");
  const [files, setFiles] = useState<AgentFiles | null>(null);
  const [dataDir, setDataDir] = useState("");

  useEffect(() => {
    void store.loadAgentFiles(agentId).then(setFiles);
    void window.crew.dataDir().then(setDataDir);
  }, [agentId]);

  if (!agent) return null;
  const folder = dataDir ? `${dataDir}/agents/${agent.id}` : "";

  return (
    <div className="sheet" style={{ width: 760, height: 700 }}>
      <div style={{ flexShrink: 0, background: "#efede8" }}>
        <div style={{ height: 40, display: "flex", alignItems: "center", padding: "0 16px", gap: 10 }}>
          <Avatar agent={agent} size={22} />
          <b style={{ fontWeight: 600 }}>{agent.name} · {agent.role}</b>
          <span className="grow" />
          <IconButton onClick={() => store.closeSheet()}><Ic.X size={14} /></IconButton>
        </div>
        <div className="tabbar">
          {TABS.map((t) => (
            <button key={t.id} className={"tab" + (active === t.id ? " tab-on" : "")} onClick={() => setActive(t.id)}>
              {t.icon({ size: 20, stroke: active === t.id ? "var(--accent)" : "currentColor" })}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="scroll" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "16px 20px", gap: 14 }}>
        {active === "general" && <GeneralTab agent={agent} />}
        {active === "soul" && <FileTab agent={agent} files={files} file="soul" intro={`Who ${agent.name} is and how ${agent.name} works. Plain text, in ${agent.name}'s own words. ${agent.name} may propose edits here after a retrospective; you approve them.`} />}
        {active === "rules" && (
          <>
            <FileTab agent={agent} files={files} file="rules" intro={`Rules ${agent.name} must never break, and standing responsibilities. The model reads this; the app enforces the permission rules below.`} compact />
            <RulesEditor agent={agent} />
          </>
        )}
        {active === "wakeups" && <WakeupsTab agent={agent} />}
        {active === "permissions" && <RulesEditor agent={agent} />}
        {active === "memory" && <FileTab agent={agent} files={files} file="memory" intro="Agents append here with the remember tool. Delete lines you don't want them to keep." />}
        {active === "budget" && <BudgetTab agent={agent} />}
      </div>

      <div className="sheet-f" style={{ height: 48 }}>
        <span style={{ fontSize: 12, color: "var(--ink-4)" }} className="cell">
          Agent folder: <span className="mono sel">{folder}</span>{folder && <> · <a onClick={() => void window.crew.openPath(folder)}>Show in Finder</a></>}
        </span>
        <span className="grow" />
        <Button primary onClick={() => store.closeSheet()}>Done</Button>
      </div>
    </div>
  );
}

// ---------- General ----------

function GeneralTab({ agent }: { agent: Agent }) {
  const set = (patch: Partial<Agent>) => void store.updateAgent(agent.id, patch);
  const [name, setName] = useState(agent.name);
  const [role, setRole] = useState(agent.role);
  const [model, setModel] = useState(agent.model);
  const [checkin, setCheckin] = useState(agent.checkinModel);
  useEffect(() => { setName(agent.name); setRole(agent.role); setModel(agent.model); setCheckin(agent.checkinModel); }, [agent.id]);

  const remove = async () => {
    if (!confirm(`Delete ${agent.name}? The agent folder is removed; run history is kept.`)) return;
    await store.rpc("agent.delete", { id: agent.id });
    store.closeSheet();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", padding: "8px 12px" }}>
        <KV k="Name"><input className="field" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== agent.name && set({ name: name.trim() })} /></KV>
        <KV k="Role"><input className="field" value={role} onChange={(e) => setRole(e.target.value)} onBlur={() => role.trim() && role !== agent.role && set({ role: role.trim() })} /></KV>
        <KV k="Color">
          <span style={{ display: "flex", gap: 6 }}>
            {SWATCHES.map((c) => (
              <button key={c} onClick={() => set({ color: c })} title={c} style={{ width: 20, height: 20, borderRadius: 999, background: c, border: agent.color.toLowerCase() === c.toLowerCase() ? "2px solid var(--accent)" : "1px solid #cfcbc3", padding: 0 }} />
            ))}
          </span>
        </KV>
        <KV k="Paused">
          <Switch on={agent.paused} onChange={(v) => void store.pauseAgent(agent.id, v)} />
          <span style={{ fontSize: 11, color: "var(--ink-4)" }}>{agent.paused ? "Sleeping until you resume" : "Wakes on schedule and events"}</span>
        </KV>
      </div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", padding: "8px 12px" }}>
        <div className="grp-t" style={{ marginTop: 4 }}>Model</div>
        <KV k="Model"><ModelPicker value={agent.model} provider={agent.provider} width={260} onChange={(m, provider) => { const d = DEFAULT_MODEL[provider]; setModel(m); if (provider !== agent.provider) setCheckin(d.checkin); set({ provider, model: m, ...(provider !== agent.provider ? { checkinModel: d.checkin } : {}) }); }} /></KV>
        <KV k="Check-ins on"><ModelPicker value={agent.checkinModel} provider={agent.provider} width={260} onChange={(m) => { setCheckin(m); set({ checkinModel: m }); }} /></KV>
        <div style={{ fontSize: 11, color: "var(--ink-4)", padding: "4px 0 6px 102px" }}>Check-ins run on the small model and only escalate when there is real work.</div>
      </div>
      <div style={{ marginTop: "auto" }}>
        <Button danger onClick={() => void remove()}>Delete agent…</Button>
      </div>
    </div>
  );
}

// ---------- Soul / Rules text / Memory ----------

function FileTab({ agent, files, file, intro, compact }: { agent: Agent; files: AgentFiles | null; file: keyof AgentFiles; intro: string; compact?: boolean }) {
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (files) { setText(files[file]); setLoaded(true); }
  }, [files, file]);
  const dirty = loaded && files !== null && text !== files[file];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: compact ? undefined : 1, minHeight: compact ? 220 : 0 }}>
      <div style={{ fontSize: 12, color: "var(--ink-4)" }}>{intro}</div>
      <textarea className="field mono" spellCheck={false} style={{ flex: 1, minHeight: compact ? 160 : 300, width: "100%" }} value={loaded ? text : ""} placeholder={loaded ? "" : "Loading…"} onChange={(e) => setText(e.target.value)} />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: "var(--ink-4)" }}>{file === "memory" ? `${agent.memoryCount} notes` : `${file.toUpperCase()}.md`}</span>
        <span className="grow" />
        {dirty && <Button onClick={() => files && setText(files[file])}>Revert</Button>}
        <Button primary disabled={!dirty} onClick={() => { void store.saveAgentFile(agent.id, file, text); if (files) files[file] = text; }}>Save</Button>
      </div>
    </div>
  );
}

// ---------- Permission rules ----------

function RulesEditor({ agent }: { agent: Agent }) {
  const [pattern, setPattern] = useState("");
  const [behavior, setBehavior] = useState<PermissionBehavior>("ask");
  const save = (permissions: PermissionRule[]) => void store.updateAgent(agent.id, { permissions });
  const update = (i: number, patch: Partial<PermissionRule>) => save(agent.permissions.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => save(agent.permissions.filter((_, j) => j !== i));
  const add = () => {
    if (!pattern.trim()) return;
    save([{ pattern: pattern.trim(), behavior }, ...agent.permissions]);
    setPattern("");
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", overflow: "hidden", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", height: 28, padding: "0 10px", background: "var(--bg)", borderBottom: "1px solid var(--border)", fontSize: 11, fontWeight: 700, color: "var(--ink-5)", gap: 8 }}>
        <span style={{ flex: 1 }}>Rules {agent.name} can't break</span>
        <span style={{ fontWeight: 500 }}>Enforced by the app, not the model</span>
      </div>
      {agent.permissions.map((r, i) => (
        <div key={r.pattern + i} className="rule">
          <span className="mono" style={{ width: 200, flexShrink: 0 }} title={r.pattern}>{r.pattern}</span>
          <input className="field" style={{ flex: 1 }} placeholder="Label shown in approvals" value={r.label ?? ""} onChange={(e) => update(i, { label: e.target.value })} />
          <Popup value={r.behavior} options={PERM} onChange={(v) => update(i, { behavior: v })} ask={r.behavior !== "allow"} />
          <IconButton onClick={() => remove(i)} title="Remove"><Ic.X size={12} /></IconButton>
        </div>
      ))}
      <div className="rule" style={{ borderBottom: "none" }}>
        <input className="field mono" style={{ width: 200, flexShrink: 0 }} placeholder="Bash(git push*)" value={pattern} onChange={(e) => setPattern(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <span style={{ flex: 1, fontSize: 11, color: "var(--ink-4)" }}>Tool name or Tool(glob). First match wins, most specific first.</span>
        <Popup value={behavior} options={PERM} onChange={setBehavior} />
        <Button sm icon={<Ic.Plus size={11} />} onClick={add} disabled={!pattern.trim()}>Add rule</Button>
      </div>
    </div>
  );
}

// ---------- Wake-ups ----------

function WakeupsTab({ agent }: { agent: Agent }) {
  const set = (patch: Partial<Agent>) => void store.updateAgent(agent.id, patch);
  const wh = agent.heartbeat.workHours;
  const setCron = (cron: CronTrigger[]) => set({ triggers: { ...agent.triggers, cron } });
  const updateCron = (i: number, patch: Partial<CronTrigger>) => setCron(agent.triggers.cron.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", padding: "8px 12px" }}>
        <div className="grp-t" style={{ marginTop: 4 }}>Check-ins</div>
        <KV k="Check in every">
          <Popup value={String(agent.heartbeat.everyMinutes)} options={["10", "15", "30", "60", "120", "240"].map((m) => ({ value: m, label: `${m} min` }))} onChange={(v) => set({ heartbeat: { ...agent.heartbeat, everyMinutes: Number(v) } })} />
        </KV>
        <KV k="Work hours">
          {wh ? (
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input className="field mono" style={{ width: 58 }} value={wh.start} onChange={(e) => set({ heartbeat: { ...agent.heartbeat, workHours: { ...wh, start: e.target.value } } })} />–
              <input className="field mono" style={{ width: 58 }} value={wh.end} onChange={(e) => set({ heartbeat: { ...agent.heartbeat, workHours: { ...wh, end: e.target.value } } })} />
            </span>
          ) : (
            <span>Around the clock</span>
          )}
          <Switch on={wh === null} onChange={(v) => set({ heartbeat: { ...agent.heartbeat, workHours: v ? null : { start: "08:00", end: "22:00" } } })} />
          <span style={{ fontSize: 11, color: "var(--ink-4)" }}>24/7</span>
        </KV>
        <KV k="On events">
          <span style={{ display: "flex", flexDirection: "column", gap: 5, padding: "4px 0" }}>
            <Checkbox checked={agent.triggers.onMention} onChange={(v) => set({ triggers: { ...agent.triggers, onMention: v } })} label="Mentioned in a channel" />
            <Checkbox checked label="Asked a question by a teammate" />
            <Checkbox checked label="Given a task" />
            <Checkbox checked label="A question they asked was answered" />
          </span>
        </KV>
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", height: 28, padding: "0 10px", background: "var(--bg)", borderBottom: "1px solid var(--border)", fontSize: 11, fontWeight: 700, color: "var(--ink-5)", gap: 8 }}>
          <span style={{ flex: 1 }}>Schedules</span>
          <span style={{ fontWeight: 500 }}>cron, local time</span>
        </div>
        {agent.triggers.cron.length === 0 && <div style={{ padding: "10px 10px", fontSize: 12, color: "var(--ink-5)" }}>No schedules. Check-ins still happen.</div>}
        {agent.triggers.cron.map((c, i) => (
          <div key={i} className="rule">
            <input className="field" style={{ width: 140, flexShrink: 0 }} value={c.name} onChange={(e) => updateCron(i, { name: e.target.value })} />
            <input className="field mono" style={{ width: 120, flexShrink: 0 }} value={c.expr} onChange={(e) => updateCron(i, { expr: e.target.value })} />
            <input className="field" style={{ flex: 1 }} value={c.prompt} onChange={(e) => updateCron(i, { prompt: e.target.value })} />
            <IconButton onClick={() => setCron(agent.triggers.cron.filter((_, j) => j !== i))} title="Remove"><Ic.X size={12} /></IconButton>
          </div>
        ))}
        <div className="rule" style={{ borderBottom: "none", color: "var(--accent)" }}>
          <Button sm icon={<Ic.Plus size={11} />} onClick={() => setCron([...agent.triggers.cron, { name: "Daily standup", expr: "0 9 * * 1-5", prompt: "Post today's plan in #general." }])}>Add schedule</Button>
        </div>
      </div>
    </div>
  );
}

// ---------- Budget ----------

function BudgetTab({ agent }: { agent: Agent }) {
  const spend = useStore((s) => s.spend);
  const used = spend?.perAgent[agent.id] ?? agent.spentTodayUsd;
  const set = (patch: Partial<Agent>) => void store.updateAgent(agent.id, patch);
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", padding: "12px 12px" }}>
      <BudgetEditor budget={agent.budget} used={used} workHours={workHoursOf(agent.heartbeat.workHours)} onChange={(budget) => set({ budget })} />
      <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 10 }}>Set it the way you think about it: a daily cap, an hourly rate, or a limit per job. Every limit that is set is enforced; when one is reached {agent.name} sleeps until it clears.</div>
    </div>
  );
}
