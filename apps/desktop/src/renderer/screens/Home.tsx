import { useState } from "react";
import { defaultModelsFor, type Agent, type Question } from "@crew/shared";
import { store, useStore } from "../state/store";
import { Ic } from "../ui/icons";
import { Avatar, Button, Checkbox, Group, IconButton, KindPill, KV, Popup, SearchField, StatusPill, Toolbar, ago, dur, modelLabel } from "../ui/kit";
import { Money } from "../ui/kit";
import { ModelPicker } from "../components/ModelPicker";
import { BudgetEditor, workHoursOf } from "../components/BudgetEditor";

export function HomeScreen() {
  const agents = useStore((s) => s.agents);
  const team = useStore((s) => s.team);
  const status = useStore((s) => s.status);
  const selectedId = useStore((s) => s.selectedAgentId);
  const [showInspector, setShowInspector] = useState(true);
  const [filter, setFilter] = useState("");
  const selected = agents.find((a) => a.id === selectedId) ?? agents[0];
  const working = agents.filter((a) => a.status === "working").length;
  const needs = agents.filter((a) => a.status === "needs_you").length;
  const idle = agents.filter((a) => a.status === "idle").length;
  const shown = filter ? agents.filter((a) => (a.name + " " + a.role + " " + a.statusText).toLowerCase().includes(filter.toLowerCase())) : agents;

  return (
    <>
      <Toolbar title="Home" subtitle={team ? `${agents.length} agents · ${working} working · ${needs} need${needs === 1 ? "s" : ""} you · ${idle} idle` : "Describe a team to get started"}>
        <SearchField value={filter} onChange={setFilter} />
        {status?.pausedAll ? (
          <Button icon={<Ic.Play size={12} />} onClick={() => void store.resumeAll()}>Resume All</Button>
        ) : (
          <Button icon={<Ic.Pause size={12} />} onClick={() => void store.pauseAll()} disabled={!team}>Pause All</Button>
        )}
        <Button primary icon={<Ic.Plus size={12} />} onClick={() => store.openSheet({ kind: "onboarding" })}>New Team…</Button>
        <IconButton on={showInspector} onClick={() => setShowInspector((v) => !v)}><Ic.Sidebar size={15} /></IconButton>
      </Toolbar>

      <div className="body">
        <div className="split-v">
          {!team ? (
            <div className="empty">
              <Ic.Team size={36} stroke="var(--ink-6)" strokeWidth={1.6} />
              <span>No team yet</span>
              <Button primary onClick={() => store.openSheet({ kind: "onboarding" })}>Create a team…</Button>
            </div>
          ) : (
            <>
              <div className="th">
                <span style={{ width: 190 }}>Agent</span>
                <span style={{ width: 110 }}>Status</span>
                <span style={{ flex: 1 }}>Doing now</span>
                <span style={{ width: 110 }}>Model</span>
                <span style={{ width: 64 }}>Since</span>
                <span style={{ width: 64, textAlign: "right" }}>Today</span>
              </div>
              <div className="scroll" style={{ flex: 1, minHeight: 0, background: "var(--surface)" }}>
                {shown.map((a, i) => (
                  <AgentRow key={a.id} agent={a} alt={i % 2 === 1} selected={selected?.id === a.id} onSelect={() => store.selectAgent(a.id)} />
                ))}
                {shown.length === 0 && <div style={{ padding: "18px 12px", color: "var(--ink-5)", fontSize: 12 }}>No agent matches "{filter}".</div>}
                <FirstSteps />
              </div>
              <div className="divider" />
              <NeedsYou />
            </>
          )}
        </div>
        {showInspector && selected && <AgentInspector agent={selected} />}
      </div>
    </>
  );
}

/**
 * Shown once, on a team that has not done anything yet: a brand new team is a table of idle
 * agents, which tells a first-time owner nothing about how to start. Disappears for good as
 * soon as the first run exists, or when dismissed.
 */
function FirstSteps() {
  const runs = useStore((s) => s.runs);
  const dismissed = useStore((s) => s.firstStepsDismissed);
  const agents = useStore((s) => s.agents);
  const team = useStore((s) => s.team);
  const channels = useStore((s) => s.channels);
  if (dismissed || runs.length > 0 || agents.length === 0) return null;
  const lead = agents[0]!;
  const firstChannel = channels.find((c) => c.kind !== "dm");
  return (
    <div className="first">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Ic.Sparkle size={16} stroke="var(--accent)" />
        <b style={{ fontWeight: 600 }}>Your team is ready. Here's how to start it.</b>
        <span className="grow" />
        <a onClick={() => store.dismissFirstSteps()} style={{ fontSize: 12 }}>Got it</a>
      </div>
      <ol>
        <li>
          <b>Give them the first job.</b> Write what you want done in{firstChannel ? <> <a onClick={() => store.navigate({ name: "channel", channelId: firstChannel.id })}>#{firstChannel.name}</a></> : " a channel"} and type <b>@</b> to pick who takes it, or talk to <a onClick={() => store.navigate({ name: "dm", agentId: lead.id })}>{lead.name}</a> directly.
        </li>
        <li><b>They keep going on their own.</b> Each agent checks in every {lead.heartbeat.everyMinutes} minutes{lead.heartbeat.workHours ? ` between ${lead.heartbeat.workHours.start} and ${lead.heartbeat.workHours.end}` : " around the clock"}, and wakes up when someone mentions it or hands it a task.</li>
        <li><b>They ask you when a decision is yours.</b> Those land in the <a onClick={() => store.navigate({ name: "inbox" })}>Inbox</a> with a default they'll fall back to if you're away.</li>
        <li><b>Watch the work.</b> <a onClick={() => store.navigate({ name: "runs" })}>Runs</a> shows every file read, command run and message posted, with what it cost. The team stops at ${team?.dailyCapUsd ?? 10} a day.</li>
      </ol>
    </div>
  );
}

/** True when the clock is outside the agent's work hours, so "idle" means asleep rather than free. */
export function asleepNow(agent: Agent): boolean {
  const wh = agent.heartbeat.workHours;
  if (!wh) return false;
  const [sh = 0, sm = 0] = wh.start.split(":").map(Number);
  const [eh = 24, em = 0] = wh.end.split(":").map(Number);
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins < sh * 60 + sm || mins >= eh * 60 + em;
}

function AgentRow({ agent, alt, selected, onSelect }: { agent: Agent; alt: boolean; selected: boolean; onSelect: () => void }) {
  const runs = useStore((s) => s.runs);
  const current = agent.currentRunId ? runs.find((r) => r.id === agent.currentRunId) : null;
  const doing =
    agent.status === "working" ? agent.statusText || "Working"
    : agent.status === "needs_you" ? agent.statusText || "Waiting for you"
    : agent.status === "paused" ? "Paused"
    : agent.status === "failed" ? agent.statusText
    : agent.status === "over_budget" ? "Daily budget reached, sleeping until tomorrow"
    : agent.nextWakeAt ? `${asleepNow(agent) ? "Outside work hours" : "Idle"}. Next check-in ${new Date(agent.nextWakeAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Idle";
  return (
    <div className={["tr", alt && "tr-alt", selected && "tr-sel"].filter(Boolean).join(" ")} onClick={onSelect} onDoubleClick={() => store.openSheet({ kind: "agent", agentId: agent.id })}>
      <span style={{ width: 190, display: "flex", alignItems: "center", gap: 8 }}>
        <Avatar agent={agent} size={22} />
        <span className="cell"><span style={{ fontWeight: 500 }}>{agent.name}</span><span style={{ color: "var(--ink-4)" }}> · {agent.role}</span></span>
      </span>
      <span style={{ width: 110 }}><StatusPill status={agent.status} /></span>
      <span className="cell" style={{ flex: 1, color: agent.status === "idle" ? "var(--ink-4)" : "var(--ink-2)" }}>{doing}</span>
      <span style={{ width: 110, color: "var(--ink-3)" }} className="cell">{modelLabel(agent.model)}</span>
      <span className="mono" style={{ width: 64, fontSize: 11, color: "var(--ink-4)" }}>{current ? dur(current.startedAt, null) : agent.lastRunAt ? ago(agent.lastRunAt) : ""}</span>
      <span style={{ width: 64, textAlign: "right" }}><Money v={agent.spentTodayUsd} muted={agent.spentTodayUsd === 0} /></span>
    </div>
  );
}

function NeedsYou() {
  const questions = useStore((s) => s.questions);
  const agents = useStore((s) => s.agents);
  const open = questions.filter((q) => q.status === "open" && q.toId === "user").slice(0, 3);
  const answeredToday = questions.filter((q) => q.status === "answered" && q.toId === "user" && q.answeredAt && Date.now() - new Date(q.answeredAt).getTime() < 86400000).length;
  return (
    <div style={{ height: 300, flexShrink: 0, display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <div className="pane-h">
        <span>Needs you</span>
        {open.length > 0 && <span className="badge">{questions.filter((q) => q.status === "open" && q.toId === "user").length}</span>}
        <span className="grow" />
        <a onClick={() => store.navigate({ name: "inbox" })} style={{ fontWeight: 400 }}>Open Inbox</a>
      </div>
      <div className="scroll" style={{ flex: 1 }}>
        {open.length === 0 && <div style={{ padding: "18px 12px", color: "var(--ink-5)", fontSize: 12 }}>Nothing waiting on you. When an agent needs a decision it lands here and in the Inbox, with a default it will fall back to if you're away.</div>}
        {open.map((q) => <NeedRow key={q.id} q={q} agent={agents.find((a) => a.id === q.fromAgentId)} />)}
        {answeredToday > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", color: "var(--ink-4)", fontSize: 12 }}>
            <Ic.Check size={14} stroke="var(--green)" strokeWidth={2.4} />
            <span>Today: {answeredToday} answered</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function NeedRow({ q, agent }: { q: Question; agent?: Agent }) {
  const [remember, setRemember] = useState(q.kind === "question");
  const quick = q.options.length ? q.options.slice(0, 3) : q.kind === "approval" || q.kind === "hire" ? ["Approve", "Decline"] : [];
  return (
    <div className="need">
      <Avatar agent={agent} size={24} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600 }}>{agent?.name ?? q.fromAgentId}</span>
          <KindPill kind={q.kind} />
          <span style={{ fontSize: 11, color: "var(--ink-4)" }}>{ago(q.createdAt)} ago{q.channelId ? ` in #${q.channelId}` : ""}</span>
        </div>
        <div style={{ marginTop: 2, fontWeight: 500 }} className="cell" title={q.title}>{q.title}</div>
        {q.body && q.body !== q.title && <div className="clamp2" style={{ color: "var(--ink-3)", marginTop: 1 }} title={q.body}>{q.body}</div>}
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 3, display: "flex", gap: 12, minWidth: 0 }}>
          {q.defaultAt && <span className="cell" title={q.defaultAnswer ?? undefined}>If you don't answer: {(q.defaultAnswer ?? "").length > 40 ? (q.defaultAnswer ?? "").slice(0, 39) + "…" : q.defaultAnswer} at {new Date(q.defaultAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
          {q.kind === "question" && <Checkbox checked={remember} onChange={setRemember} label={<span style={{ fontFamily: "inherit" }}>remember as a decision</span>} />}
        </div>
      </div>
      {/* Long options can't be judged from a truncated button, so they only get answered in the Inbox, where the full text is readable. */}
      <div className="actions" style={{ flexShrink: 0, maxWidth: 300, justifyContent: "flex-end" }}>
        {quick.every((o) => o.length <= 24) && quick.map((o, i) => (
          <Button key={o} title={o} primary={i === 0 && (o === q.recommended || (!q.recommended && i === 0))} onClick={() => void store.answerQuestion(q.id, o, remember)}>{o}</Button>
        ))}
        <Button primary={!quick.every((o) => o.length <= 24)} onClick={() => store.navigate({ name: "inbox", questionId: q.id })}>{quick.every((o) => o.length <= 24) ? "Reply…" : "Read & answer…"}</Button>
      </div>
    </div>
  );
}

function AgentInspector({ agent }: { agent: Agent }) {
  const spend = useStore((s) => s.spend);
  const providers = useStore((s) => s.providers);
  const used = spend?.perAgent[agent.id] ?? agent.spentTodayUsd;
  const set = (patch: Partial<Agent>) => void store.updateAgent(agent.id, patch);
  const rule = (pattern: string) => agent.permissions.find((r) => r.pattern === pattern)?.behavior ?? "allow";
  const setRule = (pattern: string, behavior: "allow" | "ask" | "block") =>
    set({ permissions: agent.permissions.some((r) => r.pattern === pattern) ? agent.permissions.map((r) => (r.pattern === pattern ? { ...r, behavior } : r)) : [{ pattern, behavior }, ...agent.permissions] });
  const wh = agent.heartbeat.workHours;
  return (
    <div className="insp">
      <div className="grp" style={{ display: "flex", alignItems: "center", gap: 10, padding: 14 }}>
        <Avatar agent={agent} size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{agent.name}</div>
          <div style={{ fontSize: 11, color: "var(--ink-4)" }} className="cell">{agent.role} · since {new Date(agent.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}</div>
        </div>
        <IconButton title={agent.paused ? "Resume" : "Pause"} onClick={() => void store.pauseAgent(agent.id, !agent.paused)}>{agent.paused ? <Ic.Play size={14} /> : <Ic.Pause size={14} />}</IconButton>
      </div>
      <Group title="Model">
        {/* Switching provider carries the check-in model with it; the old id means nothing on the new endpoint. */}
        <KV k="Model"><ModelPicker value={agent.model} provider={agent.provider} onChange={(model, provider) => set({ model, provider, ...(provider !== agent.provider ? { checkinModel: providers?.[provider]?.checkinModel || defaultModelsFor(provider).checkin || model } : {}) })} width={168} /></KV>
        <KV k="Check-ins on"><ModelPicker value={agent.checkinModel} provider={agent.provider} onChange={(checkinModel) => set({ checkinModel })} width={168} /></KV>
      </Group>
      <Group title="Wake-ups">
        <KV k="Check in every">
          <Popup value={String(agent.heartbeat.everyMinutes)} options={["10", "15", "30", "60", "120", "240"].map((m) => ({ value: m, label: `${m} min` }))} onChange={(v) => set({ heartbeat: { ...agent.heartbeat, everyMinutes: Number(v) } })} />
        </KV>
        <KV k="Work hours">
          {wh ? (
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input className="field mono" style={{ width: 58 }} value={wh.start} onChange={(e) => set({ heartbeat: { ...agent.heartbeat, workHours: { ...wh, start: e.target.value } } })} />–
              <input className="field mono" style={{ width: 58 }} value={wh.end} onChange={(e) => set({ heartbeat: { ...agent.heartbeat, workHours: { ...wh, end: e.target.value } } })} />
              <a onClick={() => set({ heartbeat: { ...agent.heartbeat, workHours: null } })} style={{ fontSize: 11 }}>24/7</a>
            </span>
          ) : (
            <span>Around the clock · <a onClick={() => set({ heartbeat: { ...agent.heartbeat, workHours: { start: "08:00", end: "22:00" } } })} style={{ fontSize: 11 }}>set hours</a></span>
          )}
        </KV>
        <KV k="On events">
          <span style={{ display: "flex", flexDirection: "column", gap: 5, padding: "4px 0" }}>
            <Checkbox checked={agent.triggers.onMention} onChange={(v) => set({ triggers: { ...agent.triggers, onMention: v } })} label="Mentioned in a channel" />
            <Checkbox checked label="Asked a question by a teammate" />
            <Checkbox checked label="Given a task" />
          </span>
        </KV>
      </Group>
      <Group title="Permissions">
        <KV k="Edit repo"><Popup value={rule("Edit")} options={PERM} onChange={(v) => setRule("Edit", v)} ask={rule("Edit") !== "allow"} /></KV>
        <KV k="Run commands"><Popup value={rule("Bash(*)")} options={PERM} onChange={(v) => setRule("Bash(*)", v)} ask={rule("Bash(*)") !== "allow"} /></KV>
        <KV k="Push to main"><Popup value={rule("Bash(git push*main*)")} options={PERM} onChange={(v) => setRule("Bash(git push*main*)", v)} ask={rule("Bash(git push*main*)") !== "allow"} /></KV>
        <KV k="Network"><Popup value={rule("Bash(curl*)")} options={PERM} onChange={(v) => setRule("Bash(curl*)", v)} ask={rule("Bash(curl*)") !== "allow"} /></KV>
      </Group>
      <Group title="Budget">
        <BudgetEditor budget={agent.budget} used={used} workHours={workHoursOf(agent.heartbeat.workHours)} onChange={(budget) => set({ budget })} />
      </Group>
      <div style={{ padding: "12px 14px", display: "flex", gap: 6 }}>
        <Button style={{ flex: 1 }} onClick={() => store.openSheet({ kind: "agent", agentId: agent.id, tab: "soul" })}>Soul &amp; Rules…</Button>
        <Button style={{ flex: 1 }} onClick={() => store.openSheet({ kind: "agent", agentId: agent.id, tab: "memory" })}>Memory ({agent.memoryCount})</Button>
      </div>
      <div style={{ padding: "0 14px 12px", display: "flex", gap: 6 }}>
        <Button style={{ flex: 1 }} onClick={() => store.openSheet({ kind: "wake", agentId: agent.id })}>Talk to {agent.name}…</Button>
        <Button style={{ flex: 1 }} onClick={() => void store.checkinAgent(agent.id)} disabled={Boolean(agent.currentRunId)}>Check in now</Button>
      </div>
    </div>
  );
}

const PERM: { value: "allow" | "ask" | "block"; label: string }[] = [{ value: "allow", label: "Allow" }, { value: "ask", label: "Ask me" }, { value: "block", label: "Block" }];
